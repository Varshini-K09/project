import os
import io
import zipfile
from django.core.files.base import ContentFile
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Resume
from ..serializers import ResumeSerializer
from ..screening import screen_resume, _extract_text_from_pdf, extract_candidate_info
from ..utils import is_admin, is_recruiter


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

        return Response(ResumeSerializer(qs.order_by("-created_at"), many=True, context={"request": request}).data)

    def post(self, request):
        if not (is_admin(request.user) or is_recruiter(request.user)):
            return Response(
                {"detail": "Recruiter or Admin access required."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = ResumeSerializer(data=request.data, context={"request": request})
        if serializer.is_valid():
            resume = serializer.save(uploaded_by=request.user, is_active=True)
            return Response(
                ResumeSerializer(resume, context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ResumeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, pk, user):
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
        obj = self.get_object(pk, request.user)
        if not obj:
            return Response({"detail": "Not found or access denied."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ResumeSerializer(obj, context={"request": request}).data)

    def delete(self, request, pk):
        obj = self.get_object(pk, request.user)
        if not obj:
            return Response({"detail": "Not found or access denied."}, status=status.HTTP_404_NOT_FOUND)
        if obj.resume_file and os.path.isfile(obj.resume_file.path):
            os.remove(obj.resume_file.path)
        obj.delete()
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
    """Returns all resumes for a given requirement. Admin only."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        resumes = Resume.objects.filter(requirement_id=pk, is_active=True).select_related(
            "uploaded_by"
        ).order_by("-created_at")
        return Response(ResumeSerializer(resumes, many=True, context={"request": request}).data)
    
"""
api/views/resume_views.py  — add / replace the existing file with this version.

New endpoint added:
  PATCH /api/resumes/<pk>/stage/   → update candidate pipeline stage
  Allowed roles: admin, hr (drag-and-drop)
  Read-only roles: recruiter, employee (can call GET only)
"""




VALID_STAGES = {
    "applied",
    "screening",
    "shortlisted",
    "interview_scheduled",
    "selected",
    "rejected",
}


def _is_hr(employee):
    """Return True if the employee's role is 'hr'."""
    role = (getattr(employee.role, "role_name", "") or "").lower()
    return role == "hr"


def _can_move_cards(employee):
    """Admin and HR can drag-and-drop; everyone else is read-only."""
    return is_admin(employee) or _is_hr(employee)


# ─────────────────────────────────────────────────────────────────────────────
#  Existing list/create view — keep all your original logic, just ensure the
#  serializer now includes the `stage` field (see serializers.py notes below).
# ─────────────────────────────────────────────────────────────────────────────
class ResumeStageUpdateView(APIView):
    """
    PATCH /api/resumes/<pk>/stage/
    Body: { "stage": "shortlisted" }

    • Admin / HR  → allowed
    • Everyone else → 403
    """
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

        resume.stage = new_stage
        resume.save(update_fields=["stage", "updated_at"])

        return Response(
            {
                "detail": "Stage updated.",
                "id":     resume.pk,
                "stage":  resume.stage,
            },
            status=status.HTTP_200_OK,
        )
    
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

        if not requirement_id or not zip_file:
            return Response(
                {"error": "requirement and zip_file are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from ..models import Requirement
            requirement = Requirement.objects.get(pk=requirement_id)
        except Exception:
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

            for pdf_name in pdf_names:
                try:
                    pdf_bytes   = zf.read(pdf_name)
                    pdf_io      = io.BytesIO(pdf_bytes)

                    # ── Extract text & candidate info in memory ───────────
                    resume_text = _extract_text_from_pdf(pdf_io)
                    info        = extract_candidate_info(resume_text)

                    # ── Save record WITHOUT storing the file ──────────────
                    resume = Resume(
                        requirement     = requirement,
                        candidate_name  = info.get("candidate_name", "Unknown"),
                        candidate_email = info.get("candidate_email", ""),
                        candidate_phone = info.get("candidate_phone", ""),
                        uploaded_by     = request.user,
                        is_active       = True,
                        # Store original filename in notes for reference
                        notes           = f"[Bulk upload] {os.path.basename(pdf_name)}",
                        # resume_file intentionally left blank
                    )
                    resume.save()   # ← no resume_file.save() at all

                    # ── Run screening on the in-memory text ───────────────
                    result = screen_resume(resume, resume_text=resume_text)

                    results.append({
                        "file":                  pdf_name,
                        "candidate_name":        resume.candidate_name,
                        "candidate_email":       resume.candidate_email,
                        "score":                 result.get("score"),
                        "hiring_recommendation": result.get("hiring_recommendation"),
                        "resume_id":             resume.pk,
                    })

                except Exception as exc:
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