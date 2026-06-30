import os
import re
import io
import json
import logging
from pathlib import Path
from typing import Optional

from rapidfuzz import process, fuzz
from django.conf import settings
from sentence_transformers import SentenceTransformer
import chromadb

log = logging.getLogger(__name__)

TESSERACT_PATH = r"C:\Users\VarshiniKatukojwala\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"
POPPLER_PATH   = r"C:\Users\VarshiniKatukojwala\Downloads\Release-26.02.0-0\poppler-26.02.0\Library\bin"

def _get_chroma_client():
    persist_dir = getattr(
        settings,
        "CHROMA_PERSIST_DIR",
        os.path.join(getattr(settings, "BASE_DIR", "."), "chroma_store"),
    )
    os.makedirs(persist_dir, exist_ok=True)
    return chromadb.PersistentClient(path=persist_dir)


def _get_collection(client=None):
    if client is None:
        client = _get_chroma_client()
    return client.get_or_create_collection(
        name="resumes",
        metadata={"hnsw:space": "cosine"},
    )

_embedding_model: Optional[SentenceTransformer] = None


def _get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model

def _ocr_pdf(file_field) -> str:
    try:
        import pytesseract
        from pdf2image import convert_from_bytes

        pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
        

        if hasattr(file_field, "seek"):
            file_field.seek(0)
        pdf_bytes = file_field.read() if hasattr(file_field, "read") else file_field

        images = convert_from_bytes(pdf_bytes, dpi=300, poppler_path=POPPLER_PATH)
        pages  = [pytesseract.image_to_string(img, lang="eng") for img in images]
        text   = "\n".join(pages).strip()

        log.debug("OCR extracted %d chars", len(text))
        return text[:12_000]

    except ImportError as e:
        log.warning("OCR unavailable — missing library: %s", e)
        return ""
    except Exception as exc:
        log.error("OCR failed: %s", exc)
        return ""


def _extract_text_from_pdf(file_field) -> str:
    try:
        import pypdf

        if hasattr(file_field, "seek"):
            file_field.seek(0)

        reader = pypdf.PdfReader(file_field)
        if reader.is_encrypted:
            try:
                if reader.decrypt("") == 0:
                    log.warning("PDF is password-protected")
                    return ""
            except Exception as e:
                log.error("PDF decrypt failed: %s", e)
                return ""

        pages = [p.extract_text() or "" for p in reader.pages]
        text  = "\n".join(pages).strip()

        if len(text) >= 100:
            log.debug("pypdf extracted %d chars", len(text))
            return text

        log.debug("Low pypdf yield, trying OCR")
        return _ocr_pdf(file_field)

    except Exception as exc:
        log.error("_extract_text_from_pdf exception: %s", exc)
        return ""

def _remove_pii(text: str) -> str:
    text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', '[EMAIL]', text)
    text = re.sub(r'(\+?\d[\d\s\-]{8,15}\d)',                              '[PHONE]', text)
    text = re.sub(r'https?://(?:www\.)?linkedin\.com/in/[^\s]+',           '[LINKEDIN]', text, flags=re.IGNORECASE)
    text = re.sub(r'https?://(?:www\.)?github\.com/[^\s]+',                '[GITHUB]',   text, flags=re.IGNORECASE)
    return text

def extract_candidate_info(resume_text: str) -> dict:
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    phone_pattern = r'(\+?\d[\d\s\-]{8,15}\d)'

    lines           = [l.strip() for l in resume_text.splitlines() if l.strip()]
    candidate_name  = lines[0] if lines else "Unknown"
    email_match     = re.search(email_pattern, resume_text)
    phone_match     = re.search(phone_pattern, resume_text)

    candidate_phone = ""
    if phone_match:
        phone  = phone_match.group(0)
        digits = re.sub(r"\D", "", phone)
        if len(digits) >= 10:
            candidate_phone = phone

    return {
        "candidate_name":  candidate_name,
        "candidate_email": email_match.group(0) if email_match else "",
        "candidate_phone": candidate_phone,
    }

def section_chunk_resume(resume_text: str) -> dict:
    SECTION_MAPPING = {
        "summary":        ["summary", "professional summary", "career objective", "objective", "profile", "about me"],
        "skills":         ["skills", "technical skills", "core skills", "technical competencies", "key skills"],
        "experience":     ["experience", "work experience", "professional experience", "employment history", "work history"],
        "projects":       ["projects", "project experience", "academic projects", "personal projects"],
        "education":      ["education", "academic background", "qualifications", "academic qualifications"],
        "certifications": ["certifications", "certificates", "licenses", "courses"],
        "achievements":   ["achievements", "accomplishments", "awards", "honors"],
        "languages":      ["languages", "language proficiency"],
    }

    def normalize(line: str) -> str:
        return line.lower().strip().rstrip(":")

    def clean(line: str) -> str:
        return re.sub(r'[^a-z\s]', '', normalize(line)).strip()

    header_lookup = {}
    for section, aliases in SECTION_MAPPING.items():
        for alias in aliases:
            header_lookup[normalize(alias)] = section

    def detect_section(line: str):
        if len(line) > 50:
            return None
        normalized = normalize(line)
        cleaned    = clean(line)
        if normalized in header_lookup:
            return header_lookup[normalized]
        if cleaned in header_lookup:
            return header_lookup[cleaned]
        for alias, section in header_lookup.items():
            if cleaned.startswith(alias) or cleaned.endswith(alias):
                return section
        result = process.extractOne(cleaned, header_lookup.keys(), scorer=fuzz.ratio, score_cutoff=85)
        if result:
            matched_alias, _, _ = result
            return header_lookup[matched_alias]
        return None

    lines           = resume_text.splitlines()
    chunks          = {"general": []}
    current_section = "general"

    for line in lines:
        line = line.strip()
        if not line:
            continue
        detected = detect_section(line)
        if detected:
            current_section = detected
            if current_section not in chunks:
                chunks[current_section] = []
        else:
            chunks[current_section].append(line)

    return {
        section: "\n".join(content).strip()
        for section, content in chunks.items()
        if "\n".join(content).strip()
    }


def create_embedding(chunks: dict, embedding_model=None) -> list[dict]:
    if embedding_model is None:
        embedding_model = _get_embedding_model()
    if not chunks:
        log.warning("No chunks provided for embedding")
        return []

    embeddings = []
    for section, text in chunks.items():
        if not text.strip():
            continue
        try:
            vector = embedding_model.encode(text)
            embeddings.append({
                "section":   section,
                "text":      text,
                "embedding": vector.tolist(),
            })
        except Exception as e:
            log.error("Failed to embed section '%s': %s", section, e)

    log.info("Created embeddings for %d sections", len(embeddings))
    return embeddings

def store_resume_to_vectordb(resume_id: int,resume_text: str,candidate_name: str = "",requirement_id: int = None,) -> bool:
    if not resume_text or len(resume_text.strip()) < 50:
        log.warning("[VectorDB] Skipping resume %s — insufficient text", resume_id)
        return False
    try:
        clean_text = _remove_pii(resume_text)
        chunks     = section_chunk_resume(clean_text)

        if not chunks:
            log.warning("[VectorDB] No chunks for resume %s", resume_id)
            return False

        model      = _get_embedding_model()
        collection = _get_collection()

        ids, embeddings_list, documents, metadatas = [], [], [], []

        for section, text in chunks.items():
            if not text.strip():
                continue
            vector = model.encode(text).tolist()
            ids.append(f"{resume_id}_{section}")
            embeddings_list.append(vector)
            documents.append(text)
            metadatas.append({
                "resume_id":      str(resume_id),
                "candidate_name": candidate_name,
                "section":        section,
                "requirement_id": str(requirement_id) if requirement_id else "",
            })

        if not ids:
            return False

        collection.upsert(
            ids=ids,
            embeddings=embeddings_list,
            documents=documents,
            metadatas=metadatas,
        )

        log.info("[VectorDB] Stored resume %s (%s) — %d sections", resume_id, candidate_name, len(ids))
        return True

    except Exception as exc:
        log.error("[VectorDB] Failed to store resume %s: %s", resume_id, exc)
        return False

def fetch_top_resumes_for_jd(job_description: str,requirement_id: int = None,top_n: int = 15,) -> list[int]:
    if not job_description or not job_description.strip():
        raise ValueError("job_description must not be empty")

    model      = _get_embedding_model()
    collection = _get_collection()

    total_docs = collection.count()
    if total_docs == 0:
        log.warning("[VectorSearch] Collection is empty — nothing to query")
        return []

    query_n = min(total_docs, top_n * 8)

    jd_vector = model.encode(job_description).tolist()

    query_kwargs = dict(
    query_embeddings=[jd_vector],
    n_results=query_n,
    
    include=["metadatas", "distances"],
    )

    results = collection.query(**query_kwargs)

    metadatas = results["metadatas"][0]
    distances = results["distances"][0]  

    best_score: dict[int, float] = {}
    for meta, dist in zip(metadatas, distances):
        rid = int(meta["resume_id"])
        if rid not in best_score or dist < best_score[rid]:
            best_score[rid] = dist

    ranked  = sorted(best_score.items(), key=lambda x: x[1])
    top_ids = [rid for rid, _ in ranked[:top_n]]

    log.info("[VectorSearch] Top %d resumes for JD (req=%s): %s", len(top_ids), requirement_id, top_ids)
    return top_ids

def _call_groq(prompt: str, max_tokens: int = 1024) -> str:
    from groq import Groq
    api_key = getattr(settings, "GROQ_API_KEY", os.getenv("GROQ_API_KEY", ""))
    if not api_key:
        raise ValueError("GROQ_API_KEY not configured.")

    client   = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=0.0,
    )
    return response.choices[0].message.content.strip()

def extract_skills(resume_text: str) -> list:
    prompt = f"""
Extract all technical skills from the resume.
Return ONLY valid JSON — no markdown, no explanation.

{{
    "skills": ["Python", "Django", "REST API"]
}}

RESUME:
{resume_text[:5000]}
"""
    try:
        raw    = _call_groq(prompt, max_tokens=500)
        raw    = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        result = json.loads(raw)
        return result.get("skills", [])
    except Exception as exc:
        log.error("Skill extraction failed: %s", exc)
        return []

def screen_resume(resume, resume_text: str = None, requirement=None) -> dict:
    if resume_text is None:
        try:
            if resume.resume_pdf_bytes:
                pdf_bytes = bytes(resume.resume_pdf_bytes)
                resume_text = _extract_text_from_pdf(io.BytesIO(pdf_bytes))
            elif resume.resume_file and resume.resume_file.name:
                resume.resume_file.open("rb")
                resume_text = _extract_text_from_pdf(resume.resume_file)
                resume.resume_file.close()
            else:
                log.warning("Resume %s has no file attached", resume.id)
                resume_text = ""
        except Exception as exc:
            log.error("Failed to read file for resume %s: %s", resume.id, exc)
            resume_text = ""

    extraction_failed = (
        not resume_text
        or len(resume_text.strip()) < 50
        or resume_text.strip().startswith("[")
    )

    if extraction_failed:
        result = {
            "score": 0,
            "hiring_recommendation": "Pending — PDF unreadable",
            "matched": [], "missing": [],
            "summary": (
                "Resume text could not be extracted. The PDF may be scanned, "
                "image-based, password-protected, or corrupted."
            ),
            "extraction_failed": True,
            "skills": {
                "matched_exact": [], "matched_partial": [], "matched_demonstrated": [],
                "missing_critical": [], "missing_minor": [], "bonus_skills": [],
            },
        }
        resume.screening_done   = False
        resume.screening_result = result
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    req = requirement or resume.requirement
    if req is None:
        result = {
            "score": 0, "matched": [], "missing": [],
            "summary": "No requirement linked; cannot compute match score.",
        }
        resume.screening_result = result
        resume.screening_done   = True
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    skill_names = [s.skill_name for s in req.skills.all()]
    experience  = req.experience_required or "not specified"
    job_title   = req.requirement_title

    prompt = f"""You are a senior technical recruiter with 15+ years of experience. Perform a rigorous, multi-dimensional resume screening — not just keyword matching.

════════════════════════════════════════
JOB REQUIREMENT
════════════════════════════════════════
Job Title        : {job_title}
Experience Needed: {experience}
Required Skills  : {', '.join(skill_names) if skill_names else 'Not specified'}

════════════════════════════════════════
CANDIDATE RESUME
════════════════════════════════════════
{resume_text}

════════════════════════════════════════
SCREENING INSTRUCTIONS
════════════════════════════════════════
Evaluate across ALL dimensions:

1. SKILL MATCH — exact, alias/partial, and demonstrated vs listed-only
2. EXPERIENCE DEPTH — does candidate meet required {experience}?
3. PROJECT & ACHIEVEMENT QUALITY — quantified results, real complexity?
4. ROLE ALIGNMENT — title, responsibilities, industry fit
5. RED FLAGS & POSITIVE SIGNALS
6. OVERALL HIRING RECOMMENDATION: Strong Yes / Yes / Maybe / No

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
Respond ONLY with valid JSON. No markdown, no text outside the JSON.

{{
  "score": <int 0-100>,
  "hiring_recommendation": "<Strong Yes | Yes | Maybe | No>",
  "experience_verdict": {{
    "required": "{experience}",
    "actual": "<estimated years from resume>",
    "meets_requirement": <true | false>
  }},
  "skills": {{
    "matched_exact":        [<direct matches>],
    "matched_partial":      [<alias/variant matches>],
    "matched_demonstrated": [<skills used in projects/roles>],
    "missing_critical":     [<required skills with no evidence>],
    "missing_minor":        [<nice-to-have missing skills>],
    "bonus_skills":         [<valuable extra skills found>]
  }},
  "depth_assessment": {{
    "seniority_level_inferred": "<Junior | Mid | Senior | Staff | Lead>",
    "achievement_quality": "<Strong | Moderate | Weak>",
    "ownership_signals": "<description>",
    "project_complexity": "<High | Medium | Low>"
  }},
  "role_alignment": {{
    "title_match": "<Exact | Close | Adjacent | Mismatch>",
    "industry_relevance": "<High | Medium | Low>",
    "career_trajectory": "<Step Up | Lateral | Step Down>"
  }},
  "red_flags":        [<concerns or empty array>],
  "positive_signals": [<standout qualities or empty array>],
  "summary": "<3-4 sentence verdict: overall fit, key strengths, main gaps.>"
}}"""

    api_key = getattr(settings, "GROQ_API_KEY", os.getenv("GROQ_API_KEY", ""))
    if not api_key:
        result = {
            "score": 0, "matched": [], "missing": skill_names,
            "summary": "Screening unavailable: GROQ_API_KEY not configured.",
        }
        resume.screening_result = result
        resume.screening_done   = True
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    try:
        raw = _call_groq(prompt, max_tokens=1500)
        log.debug("Groq raw response (first 300): %s", raw[:300])
    except Exception as exc:
        log.error("Groq API error for resume %s: %s", resume.id, exc)
        result = {
            "score": 0, "matched": [], "missing": skill_names,
            "summary": f"Groq API error: {exc}",
        }
        resume.screening_result = result
        resume.screening_done   = True
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    try:
        raw    = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        result = json.loads(raw)
        result["score"] = max(0, min(100, int(result.get("score", 0))))

        skills = result.get("skills", {})
        result["matched"] = list(dict.fromkeys(
            skills.get("matched_exact",        []) +
            skills.get("matched_partial",      []) +
            skills.get("matched_demonstrated", [])
        ))
        result["missing"] = list(dict.fromkeys(
            skills.get("missing_critical", []) +
            skills.get("missing_minor",    [])
        ))
        result["summary"] = str(result.get("summary", ""))

    except Exception as e:
        log.error("JSON parse error for resume %s: %s | raw: %s", resume.id, e, raw[:300])
        result = {
            "score": 0, "matched": [], "missing": skill_names,
            "summary": f"Parsing error — raw response: {raw[:300]}",
        }

    resume.screening_result = result
    resume.screening_done   = True
    resume.save(update_fields=["screening_result", "screening_done"])
    return result

def screen_and_shortlist(requirement_id: int,top_n: int = 15,score_threshold: int = 75,) -> dict:

    from .models import Resume, Requirement  

    try:
        req = Requirement.objects.prefetch_related("skills").get(pk=requirement_id)
    except Requirement.DoesNotExist:
        raise ValueError(f"Requirement {requirement_id} not found")

    skill_names = [s.skill_name for s in req.skills.all()]
    jd_text = (
        f"Job Title: {req.requirement_title}\n"
        f"Experience Required: {req.experience_required or 'not specified'}\n"
        f"Skills: {', '.join(skill_names)}\n"
        f"Description: {req.job_description or ''}"
    )

    top_ids = fetch_top_resumes_for_jd(
        job_description=jd_text,
        requirement_id=requirement_id,
        top_n=top_n,
    )

    if not top_ids:
        return {
            "requirement_id":  requirement_id,
            "retrieved":       0,
            "screened":        0,
            "score_threshold": score_threshold,
            "note":            "No resumes found in vector DB for this requirement. Upload resumes first.",
            "results":         [],
        }

    resumes = (
        Resume.objects
        .filter(pk__in=top_ids, is_active=True)
        .select_related("requirement")
        .prefetch_related("requirement__skills")
    )
    resume_map = {r.pk: r for r in resumes}

    results  = []
    screened = 0

    for rid in top_ids:
        resume = resume_map.get(rid)
        if not resume:
            log.warning("[ScreenPipeline] resume_id=%s found in ChromaDB but missing from SQLite", rid)
            continue

        try:
            if resume.resume_pdf_bytes:
                pdf_bytes = bytes(resume.resume_pdf_bytes)
                resume_text = _extract_text_from_pdf(io.BytesIO(pdf_bytes))
            elif resume.resume_file and resume.resume_file.name:
                resume.resume_file.open("rb")
                resume_text = _extract_text_from_pdf(resume.resume_file)
                resume.resume_file.close()
            else:
                resume_text = ""

            result = screen_resume(resume, resume_text=resume_text, requirement=req)
            screened += 1
        except Exception as exc:
            log.error("[ScreenPipeline] Failed screening resume %s: %s", rid, exc)
            results.append({
                "resume_id":      rid,
                "candidate_name": resume.candidate_name,
                "score":          0,
                "error":          str(exc),
            })
            continue

        if resume.stage == "applied":
            resume.stage = "screening"
            resume.save(update_fields=["stage", "updated_at"])
        results.append({
            "resume_id":             rid,
            "candidate_name":        resume.candidate_name,
            "score":                 result.get("score", 0),
            "hiring_recommendation": result.get("hiring_recommendation", ""),
            "summary":               result.get("summary", ""),
            "current_stage":         resume.stage,  
            "above_threshold":       result.get("score", 0) >= score_threshold,
        })
    log.info(
        "[ScreenPipeline] req=%s: %d retrieved, %d screened",
        requirement_id, len(top_ids), screened,
    )
    return {
        "requirement_id":  requirement_id,
        "retrieved":       len(top_ids),
        "screened":        screened,
        "score_threshold": score_threshold,
        "note": (
            f"Scores saved to SQLite. Move candidates with score >= {score_threshold} "
            "to 'shortlisted' via PATCH /resumes/<id>/stage/ — SharePoint upload triggers automatically."
        ),
        "results": results,
    }
