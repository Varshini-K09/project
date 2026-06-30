import base64
import io
import os
import time
import zipfile
from datetime import datetime

import requests
from django.conf import settings
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse


from ..models import Requirement, Resume
from ..serializers import ResumeSerializer
from ..screening import (
    _extract_text_from_pdf,
    _remove_pii,
    create_embedding,
    extract_candidate_info,
    extract_skills,
    screen_resume,
    screen_and_shortlist,
    section_chunk_resume,
    store_resume_to_vectordb,
)
from ..utils import is_admin, is_recruiter, _is_hr
import logging

logger = logging.getLogger(__name__)

def _can_move_cards(employee):
    return is_admin(employee) or _is_hr(employee)


def _post_resume_to_sharepoint(resume, pdf_bytes: bytes, resume_text: str) -> dict:
    sharepoint_post_url = getattr(settings, "SHAREPOINT_API_POST_URL", "").strip()
    if not sharepoint_post_url:
        return {"success": False, "error": "SHAREPOINT_API_POST_URL not configured in settings."}

    try:
        skills   = extract_skills(resume_text)
        skillset = ", ".join(skills)

        timestamp    = datetime.now().strftime("%Y%m%d_%H%M%S")
        sp_file_name = f"{resume.candidate_name.replace(' ', '_')}_{timestamp}.pdf"

        payload = {
            "fileName":       sp_file_name,
            "fileContent":    base64.b64encode(pdf_bytes).decode("utf-8"),
            "SkillSet":       skillset,
            "CandidateName":  resume.candidate_name,
            "CandidateEmail": resume.candidate_email or "",
            "Score":          resume.screening_result.get("score", "") if resume.screening_result else "",
        }

        resp = requests.post(sharepoint_post_url, json=payload, timeout=120)

        if resp.status_code != 200:
            return {
                "success": False,
                "error":   f"SharePoint returned HTTP {resp.status_code}: {resp.text[:300]}",
            }

        logger.info("[SharePoint] Uploaded resume %s as %s", resume.pk, sp_file_name)
        return {"success": True, "sharepoint_file": sp_file_name, "skillset": skillset}

    except Exception as exc:
        logger.error("[SharePoint] Upload failed for resume %s: %s", resume.pk, exc)
        return {"success": False, "error": str(exc)}


def _get_pdf_bytes_for_resume(resume) -> tuple[bytes, str]:
    if resume.resume_pdf_bytes:
        pdf_bytes   = bytes(resume.resume_pdf_bytes)
        resume_text = _extract_text_from_pdf(io.BytesIO(pdf_bytes))
        return pdf_bytes, resume_text

    if resume.resume_file and resume.resume_file.name:
        resume.resume_file.open("rb")
        pdf_bytes = resume.resume_file.read()
        resume.resume_file.close()
        resume_text = _extract_text_from_pdf(io.BytesIO(pdf_bytes))
        return pdf_bytes, resume_text

    raise Exception("No resume file found.")

def _extract_with_retry(resume_text: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        info = extract_candidate_info(resume_text)
        if info.get("candidate_name") and info["candidate_name"] != "Unknown":
            return info
        if attempt < retries - 1:
            wait = 5 * (attempt + 1)
            logger.debug("Contact info returned Unknown, retrying in %ds (attempt %d)", wait, attempt + 1)
            time.sleep(wait)
    return info

def _screen_with_retry(resume, resume_text: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            result = screen_resume(resume, resume_text=resume_text)
            if result.get("score", 0) > 0:
                return result
            if "Groq API error" in result.get("summary", ""):
                raise Exception(result["summary"])
            return result
        except Exception as exc:
            if attempt < retries - 1:
                wait = 20 * (attempt + 1)
                logger.debug("Screening failed, retrying in %ds: %s", wait, exc)
                time.sleep(wait)
            else:
                logger.error("Screening gave up after %d attempts: %s", retries, exc)
                return {"score": 0, "summary": str(exc)}

VALID_STAGES = {
    "applied",
    "screening",
    "shortlisted",
    "interview_scheduled",
    "selected",
    "rejected",
}

class ResumeListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = request.user

        if is_admin(employee):
            qs = Resume.objects.select_related("requirement", "uploaded_by").filter(is_active=True)
        elif is_recruiter(employee):
            qs = Resume.objects.select_related("requirement", "uploaded_by").filter(
                uploaded_by=employee, is_active=True
            )
        else:
            return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)

        req_id = request.query_params.get("requirement")
        if req_id:
            qs = qs.filter(requirement_id=req_id)

        return Response(
            ResumeSerializer(qs.order_by("-created_at"), many=True, context={"request": request}).data
        )

    def post(self, request):
        if not (is_admin(request.user) or is_recruiter(request.user)):
            return Response(
                {"detail": "Recruiter or Admin access required."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = ResumeSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        resume = serializer.save(
            uploaded_by=request.user,
            is_active=True,
            stage=Resume.STAGE_APPLIED,
        )

        if resume.resume_file and resume.resume_file.name:
            try:
                resume.resume_file.open("rb")
                resume_text = _extract_text_from_pdf(resume.resume_file)
                resume.resume_file.close()

                store_resume_to_vectordb(
                    resume_id=resume.pk,
                    resume_text=resume_text,
                    candidate_name=resume.candidate_name,
                    requirement_id=resume.requirement_id,
                )

                screen_resume(resume, resume_text=resume_text)

            except Exception as exc:
                logger.warning("Post-upload processing failed for resume %s: %s", resume.pk, exc)

        logger.info("Single resume created: %s", resume.pk)
        return Response(
            ResumeSerializer(resume, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

class ResumeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_object(self, pk, user):
        try:
            obj = Resume.objects.select_related("requirement", "uploaded_by").get(pk=pk)
        except Resume.DoesNotExist:
            return None
        if is_admin(user):
            return obj
        if is_recruiter(user) and obj.uploaded_by == user:
            return obj
        return None

    def get(self, request, pk):
        obj = self._get_object(pk, request.user)
        if not obj:
            return Response({"detail": "Not found or access denied."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ResumeSerializer(obj, context={"request": request}).data)

    def delete(self, request, pk):
        obj = self._get_object(pk, request.user)
        if not obj:
            return Response({"detail": "Not found or access denied."}, status=status.HTTP_404_NOT_FOUND)
        if obj.resume_file and obj.resume_file.name:
            try:
                if os.path.isfile(obj.resume_file.path):
                    os.remove(obj.resume_file.path)
            except Exception:
                pass

        try:
            from ..screening import _get_collection
            collection = _get_collection()
            all_ids = collection.get(where={"resume_id": str(pk)})["ids"]
            if all_ids:
                collection.delete(ids=all_ids)
                logger.info("Removed %d ChromaDB chunks for resume %s", len(all_ids), pk)
        except Exception as exc:
            logger.warning("Could not remove ChromaDB chunks for resume %s: %s", pk, exc)

        obj.delete()
        logger.info("Resume deleted: %s", obj.id)
        return Response({"detail": "Resume removed."}, status=status.HTTP_200_OK)

class ResumeScreenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            resume = Resume.objects.select_related("requirement").prefetch_related(
                "requirement__skills"
            ).get(pk=pk)
        except Resume.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(screen_resume(resume), status=status.HTTP_200_OK)

class RequirementResumesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        resumes = (
            Resume.objects
            .filter(requirement_id=pk, is_active=True)
            .select_related("uploaded_by")
            .order_by("-created_at")
        )
        return Response(ResumeSerializer(resumes, many=True, context={"request": request}).data)

class ResumeStageUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not _can_move_cards(request.user):
            return Response(
                {"detail": "Only Admin or HR can update candidate stages."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            resume = Resume.objects.select_related("requirement").get(pk=pk)
        except Resume.DoesNotExist:
            return Response({"detail": "Resume not found."}, status=status.HTTP_404_NOT_FOUND)

        new_stage = request.data.get("stage", "").strip().lower()
        if new_stage not in VALID_STAGES:
            return Response(
                {"detail": f"Invalid stage. Must be one of: {', '.join(sorted(VALID_STAGES))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_stage = resume.stage
        resume.stage = new_stage
        resume.save(update_fields=["stage", "updated_at"])
        logger.info("Resume %s stage: %s → %s", pk, old_stage, new_stage)

        response_data = {
            "detail":    "Stage updated.",
            "id":        resume.pk,
            "stage":     resume.stage,
            "sharepoint": None,
        }

        if new_stage == Resume.STAGE_SHORTLISTED:
            try:
                pdf_bytes, resume_text = _get_pdf_bytes_for_resume(resume)
                sp_result = _post_resume_to_sharepoint(resume, pdf_bytes, resume_text)
                response_data["sharepoint"] = sp_result

                if sp_result.get("success") and sp_result.get("sharepoint_file"):
                    resume.sharepoint_file = sp_result["sharepoint_file"]
                    resume.save(update_fields=["sharepoint_file", "updated_at"])
                    logger.info("Saved sharepoint_file '%s' for resume %s", sp_result["sharepoint_file"], pk)
                else:
                    logger.warning(
                        "Resume %s moved to shortlisted but SharePoint upload failed: %s",
                        pk, sp_result.get("error"),
                    )
            except Exception as exc:
                logger.error("Could not post resume %s to SharePoint: %s", pk, exc)
                response_data["sharepoint"] = {"success": False, "error": str(exc)}

        return Response(response_data, status=status.HTTP_200_OK)

class BulkResumeUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not (is_admin(request.user) or is_recruiter(request.user)):
            return Response(
                {"detail": "Recruiter or Admin access required."},
                status=status.HTTP_403_FORBIDDEN,
            )

        requirement_id = request.data.get("requirement")
        zip_file       = request.FILES.get("zip_file")

        if not zip_file:
            return Response(
                {"error": "zip_file is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requirement = None
        if requirement_id:
            try:
                requirement = Requirement.objects.get(pk=requirement_id)
            except Requirement.DoesNotExist:
                return Response({"error": "Requirement not found."}, status=status.HTTP_404_NOT_FOUND)

        if not zipfile.is_zipfile(zip_file):
            return Response(
                {"error": "Uploaded file is not a valid ZIP."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results, errors = [], []

        with zipfile.ZipFile(zip_file, "r") as zf:
            pdf_names = [
                n for n in zf.namelist()
                if n.lower().endswith(".pdf") and not n.startswith("__")
            ]

            if not pdf_names:
                return Response(
                    {"error": "No PDF files found inside the ZIP."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            for index, pdf_name in enumerate(pdf_names):
                try:
                    pdf_bytes   = zf.read(pdf_name)
                    pdf_io      = io.BytesIO(pdf_bytes)
                    resume_text = _extract_text_from_pdf(pdf_io)

                    info = _extract_with_retry(resume_text)

                    resume = Resume(
                        requirement     = requirement,
                        candidate_name  = info.get("candidate_name") or "Unknown",
                        candidate_email = info.get("candidate_email") or "",
                        candidate_phone = info.get("candidate_phone") or "",
                        uploaded_by     = request.user,
                        is_active       = True,
                        stage           = Resume.STAGE_APPLIED,
                        notes           = f"[BulkUpload] {os.path.basename(pdf_name)}",
                    )
                    resume.save()
                    if resume.candidate_name == "Unknown":
                        retry_info = _extract_with_retry(resume_text, retries=2)
                        update_fields = []
                        if retry_info.get("candidate_name") and retry_info["candidate_name"] != "Unknown":
                            resume.candidate_name = retry_info["candidate_name"]
                            update_fields.append("candidate_name")
                        if retry_info.get("candidate_email"):
                            resume.candidate_email = retry_info["candidate_email"]
                            update_fields.append("candidate_email")
                        if retry_info.get("candidate_phone"):
                            resume.candidate_phone = retry_info["candidate_phone"]
                            update_fields.append("candidate_phone")
                        if update_fields:
                            resume.save(update_fields=update_fields)
                    
                    resume.resume_pdf_bytes = pdf_bytes
                    resume.save(update_fields=["resume_pdf_bytes"])
                    # Embed into ChromaDB (PII stripped inside store_resume_to_vectordb)
                    store_resume_to_vectordb(
                        resume_id      = resume.pk,
                        resume_text    = resume_text,
                        candidate_name = resume.candidate_name,
                        requirement_id = requirement_id,
                    )

                    results.append({
                        "file":           pdf_name,
                        "candidate_name": resume.candidate_name,
                        "candidate_email":resume.candidate_email,
                        "candidate_phone":resume.candidate_phone,
                        "resume_id":      resume.pk,
                    })
                except Exception as exc:
                    logger.error("BulkUpload failed on %s: %s", pdf_name, exc)
                    errors.append({"file": pdf_name, "error": str(exc)})

        return Response(
            {
                "processed": len(results),
                "failed":    len(errors),
                "results":   results,
                "errors":    errors,
            },
            status=status.HTTP_207_MULTI_STATUS if errors else status.HTTP_200_OK,
        )

class FetchAndScreenByJDView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)

        requirement_id = request.data.get("requirement")
        top_n          = int(request.data.get("top_n", 15))
        score_threshold = int(request.data.get("score_threshold", 75))

        if not requirement_id:
            return Response(
                {"error": "'requirement' is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if top_n < 1 or top_n > 100:
            return Response(
                {"error": "'top_n' must be between 1 and 100."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = screen_and_shortlist(
                requirement_id  = int(requirement_id),
                top_n           = top_n,
                score_threshold = score_threshold,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            logger.exception("fetch-and-screen failed: %s", exc)
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(result, status=status.HTTP_200_OK)

class TextViewDebug(APIView):
    def post(self, request):
        pdf_file = request.FILES.get("resume_file")
        if not pdf_file:
            return Response({"error": "resume_file is required"}, status=status.HTTP_400_BAD_REQUEST)

        resume_text     = _extract_text_from_pdf(pdf_file)
        candidate_info  = extract_candidate_info(resume_text)
        clean_text      = _remove_pii(resume_text)
        section_chunks  = section_chunk_resume(resume_text)
        embedded_chunks = create_embedding(section_chunks)

        return Response({"embedded_chunks": embedded_chunks}, status=status.HTTP_200_OK)
    
class ResumeFileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            resume = Resume.objects.get(pk=pk)
        except Resume.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if not (is_admin(request.user) or is_recruiter(request.user) or _is_hr(request.user)):
            return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)

        if resume.resume_pdf_bytes:
            return HttpResponse(
                bytes(resume.resume_pdf_bytes),
                content_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{resume.candidate_name}.pdf"'},
            )
        
        return Response({"detail": "No file available."}, status=status.HTTP_404_NOT_FOUND)
    
class ResumeSharePointFileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            resume = Resume.objects.get(pk=pk)
        except Resume.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)

        if not (is_admin(request.user) or is_recruiter(request.user) or _is_hr(request.user)):
            return Response({"detail": "Access denied."}, status=403)

        if not resume.sharepoint_file:
            return Response({"detail": "No SharePoint file linked."}, status=404)

        if resume.resume_pdf_bytes:
            logger.info("[ResumeSharePointFileView] Serving from DB bytes for resume %s", pk)
            return HttpResponse(
                bytes(resume.resume_pdf_bytes),
                content_type="application/pdf",
                headers={
                    "Content-Disposition": f'inline; filename="{resume.sharepoint_file}"',
                    "Access-Control-Allow-Origin": "*",
                },
            )

        if resume.resume_file and resume.resume_file.name:
            try:
                resume.resume_file.open("rb")
                pdf_bytes = resume.resume_file.read()
                resume.resume_file.close()
                logger.info("[ResumeSharePointFileView] Serving from disk for resume %s", pk)
                return HttpResponse(
                    pdf_bytes,
                    content_type="application/pdf",
                    headers={
                        "Content-Disposition": f'inline; filename="{resume.sharepoint_file}"',
                        "Access-Control-Allow-Origin": "*",
                    },
                )
            except Exception as e:
                logger.error("[ResumeSharePointFileView] Disk read failed for resume %s: %s", pk, e)

        logger.warning("[ResumeSharePointFileView] No PDF available for resume %s", pk)
        return Response({"detail": "File not available."}, status=404)