import os
import json
import re

from django.conf import settings


def _extract_text_from_pdf(file_field) -> str:
    try:
        import pypdf
        file_field.seek(0)
        reader = pypdf.PdfReader(file_field)
        pages  = [p.extract_text() or "" for p in reader.pages]
        return "\n".join(pages)[:12_000]  # cap at ~12k chars
    except Exception as exc:
        return f"[PDF extraction failed: {exc}]"


def extract_candidate_info(resume_text: str) -> dict:
    """Use LLM to extract name/email/phone from resume text."""
    api_key = getattr(settings, "GEMINI_API_KEY", os.getenv("GEMINI_API_KEY", ""))
    if not api_key:
        return {"candidate_name": "Unknown", "candidate_email": "", "candidate_phone": ""}

    prompt = f"""Extract the candidate's contact information from the resume below.
Respond ONLY with a valid JSON object — no markdown, no commentary.

{{"candidate_name": "<full name>", "candidate_email": "<email or empty string>", "candidate_phone": "<phone or empty string>"}}

RESUME:
{resume_text[:3000]}"""

    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model="gemini-2.5-flash-lite", contents=prompt)
        raw = re.sub(r"^```(?:json)?|```$", "", response.text.strip(), flags=re.MULTILINE).strip()
        return json.loads(raw)
    except Exception:
        return {"candidate_name": "Unknown", "candidate_email": "", "candidate_phone": ""}


def screen_resume(resume, resume_text: str = None) -> dict:
    # ── 1. Extract text — skip if already provided (bulk upload path) ──────
    if resume_text is None:
        resume.resume_file.open("rb")
        resume_text = _extract_text_from_pdf(resume.resume_file)
        resume.resume_file.close()

    # ── 2. Build skill + context list from the linked requirement ──────────
    req = resume.requirement
    if req is None:
        result = {
            "score":   0,
            "matched": [],
            "missing": [],
            "summary": "No requirement linked; cannot compute match score.",
        }
        resume.screening_result = result
        resume.screening_done   = True
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    skill_names = [s.skill_name for s in req.skills.all()]
    experience  = req.experience_required or "not specified"
    job_title   = req.requirement_title

    # ── 3. Build the prompt ────────────────────────────────────────────────
    prompt = f"""You are a senior technical recruiter and engineering hiring manager with 15+ years of experience evaluating candidates for technical roles. Your job is to perform a rigorous, multi-dimensional resume screening — not just keyword matching.

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
    Perform a thorough evaluation across ALL of the following dimensions:

    1. SKILL MATCH ANALYSIS
    - Identify exact matches, partial/alias matches (e.g. "React" = "ReactJS" = "React.js"), and inferred matches (e.g. "built REST APIs" implies knowledge of HTTP/REST).
    - Flag skills that are mentioned superficially (listed only) vs. demonstrated (used in a project/role).
    - Note any adjacent/transferable skills that partially satisfy a requirement.

    2. EXPERIENCE DEPTH
    - Does the candidate's total relevant experience meet, exceed, or fall short of the required {experience}?
    - Assess seniority signals: scope of ownership, team size led, system scale, decision-making authority.
    - Look for progression (junior → senior signals) vs. stagnation.

    3. PROJECT & ACHIEVEMENT QUALITY
    - Are accomplishments quantified (e.g. "reduced latency by 40%", "scaled to 1M users")?
    - Do projects reflect real-world complexity or are they toy/tutorial projects?
    - Is there evidence of end-to-end ownership (design → build → deploy → maintain)?

    4. ROLE ALIGNMENT
    - How closely do past job titles, responsibilities, and industries align with this role?
    - Would this be a lateral move, step up, or step down for the candidate?

    5. RED FLAGS & POSITIVE SIGNALS
    - Red flags: unexplained gaps, frequent short tenures (<1 yr), vague descriptions, buzzword overload without substance.
    - Positive signals: open source contributions, publications, recognizable companies/products, leadership, mentoring.

    6. OVERALL HIRING RECOMMENDATION
    - Strong Yes / Yes / Maybe / No — with clear reasoning.

    ════════════════════════════════════════
    OUTPUT FORMAT
    ════════════════════════════════════════
    Respond ONLY with a valid JSON object. No markdown fences, no commentary outside the JSON.

    {{
    "score": <int 0-100>,
    "hiring_recommendation": "<Strong Yes | Yes | Maybe | No>",
    "experience_verdict": {{
        "required": "{experience}",
        "actual": "<estimated years of relevant experience from resume>",
        "meets_requirement": <true | false>
    }},
    "skills": {{
        "matched_exact":       [<skills that are a direct match>],
        "matched_partial":     [<skills matched by alias, variant, or inference — include mapping e.g. "React → ReactJS">],
        "matched_demonstrated":[<skills actively used in projects/roles, not just listed>],
        "missing_critical":    [<required skills with no evidence at all>],
        "missing_minor":       [<nice-to-have or less critical missing skills>],
        "bonus_skills":        [<valuable skills found in resume beyond what was required>]
    }},
    "depth_assessment": {{
        "seniority_level_inferred": "<Junior | Mid | Senior | Staff | Lead>",
        "achievement_quality": "<Strong | Moderate | Weak>",
        "ownership_signals": "<description of scope and ownership demonstrated>",
        "project_complexity": "<High | Medium | Low>"
    }},
    "role_alignment": {{
        "title_match": "<Exact | Close | Adjacent | Mismatch>",
        "industry_relevance": "<High | Medium | Low>",
        "career_trajectory": "<Step Up | Lateral | Step Down>"
    }},
    "red_flags":       [<list of concerns, or empty array>],
    "positive_signals":[<list of standout qualities, or empty array>],
    "summary": "<3-4 sentence verdict covering overall fit, key strengths, and main gaps. Be direct and opinionated — a recruiter reading this should immediately know whether to proceed.>"
    }}"""

    # ── 4. Call Gemini API ─────────────────────────────────────────────────
    api_key = getattr(settings, "GEMINI_API_KEY", os.getenv("GEMINI_API_KEY", ""))
    if not api_key:
        result = {
            "score":   0,
            "matched": [],
            "missing": skill_names,
            "summary": "Screening unavailable: GEMINI_API_KEY not configured.",
        }
        resume.screening_result = result
        resume.screening_done   = True
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    try:
        from google import genai
        client   = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
        )
        raw = response.text.strip()
        print(f"DEBUG screening - raw response: {raw[:300]}")
    except Exception as exc:
        print(f"DEBUG screening - GEMINI ERROR: {exc}")
        result = {
            "score":   0,
            "matched": [],
            "missing": skill_names,
            "summary": f"Gemini API error: {exc}",
        }
        resume.screening_result = result
        resume.screening_done   = True
        resume.save(update_fields=["screening_result", "screening_done"])
        return result

    # ── 5. Parse the JSON response ─────────────────────────────────────────
    try:
        # Strip any accidental ```json fences
        raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        result = json.loads(raw)
        # Validate / normalise
        result["score"]   = max(0, min(100, int(result.get("score", 0))))
        result["matched"] = list(result.get("matched", []))
        result["missing"] = list(result.get("missing", []))
        result["summary"] = str(result.get("summary", ""))
    except Exception:
        result = {
            "score":   0,
            "matched": [],
            "missing": skill_names,
            "summary": f"Parsing error – raw response: {raw[:300]}",
        }

    # ── 6. Persist and return ──────────────────────────────────────────────
    resume.screening_result = result
    resume.screening_done   = True
    resume.save(update_fields=["screening_result", "screening_done"])
    return result 