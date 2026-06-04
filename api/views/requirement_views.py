from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Requirement
from ..serializers import RequirementSerializer, RequirementStatusSerializer
from ..utils import is_admin, is_recruiter, _is_hr
import logging

logger = logging.getLogger(__name__)

class RequirementListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = request.user
        qs = Requirement.objects.select_related(
            "department", "requested_by_employee", "recruiter"
        ).prefetch_related("skills")

        if is_admin(employee):
            requirements = qs.all()
        elif is_recruiter(employee):
            requirements = qs.filter(recruiter=employee)
        else:
            requirements = qs.filter(requested_by_employee=employee)

        return Response(RequirementSerializer(requirements, many=True).data)

    def post(self, request):
        serializer = RequirementSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(
                requested_by_employee=request.user,
                status=Requirement.STATUS_PENDING,
            )
            logger.info(f"Requirement created successfully: {serializer.instance.id}")
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        logger.warning("Failed to create requirement")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class RequirementDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, pk):
        try:
            return Requirement.objects.select_related(
                "department", "requested_by_employee", "recruiter"
            ).prefetch_related("skills").get(pk=pk)
        except Requirement.DoesNotExist:
            return None

    def _has_access(self, employee, req):
        return (
            is_admin(employee)
            or (is_recruiter(employee) and req.recruiter == employee)
            or req.requested_by_employee == employee
        )

    def get(self, request, pk):
        req = self.get_object(pk)
        if not req:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if not self._has_access(request.user, req):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        return Response(RequirementSerializer(req).data)

    def put(self, request, pk):
        employee = request.user
        req = self.get_object(pk)
        if not req:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if req.requested_by_employee != employee and not is_admin(employee):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        serializer = RequirementSerializer(req, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            logger.info(f"Requirement updated successfully: {req.id}")
            return Response(serializer.data)
        logger.warning("Failed to update requirement")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        employee = request.user
        req = self.get_object(pk)
        if not req:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if req.requested_by_employee != employee and not is_admin(employee):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        req.is_active = False
        logger.info(f"Requirement deactivated: {req.id}")
        req.save()
        return Response({"detail": "Requirement deactivated."}, status=status.HTTP_200_OK)


class RequirementStatusUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_recruiter(request.user):
            return Response(
                {"detail": "Recruiter or Admin access required."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            req = Requirement.objects.get(pk=pk)
        except Requirement.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        new_status = request.data.get("status")
        if new_status not in [Requirement.STATUS_APPROVED, Requirement.STATUS_REJECTED]:
            return Response(
                {"detail": "Status must be 'approved' or 'rejected'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        req.status = new_status
        req.recruiter_comments = request.data.get("recruiter_comments", req.recruiter_comments)
        req.recruiter = request.user
        if new_status == Requirement.STATUS_APPROVED:
            req.approved_at = timezone.now()
        req.save()
        logger.info(f"Requirement status updated: {req.id}")
        return Response(RequirementStatusSerializer(req).data, status=status.HTTP_200_OK)


class RequirementToggleActiveView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        employee = request.user
        req = Requirement.objects.filter(id=pk).first()
        if not req:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if req.requested_by_employee != employee and not is_admin(employee):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        req.is_active = not req.is_active
        req.save()
        logger.info(f"Requirement active status toggled: {req.id}")
        return Response({"detail": "Updated successfully", "is_active": req.is_active})
    
"""
Add this class to api/views/requirement_views.py
(or paste it at the bottom of that file).

New endpoint:
  PATCH /api/requirements/<pk>/update-jd/
  Body: { "job_description": "..." }
  Allowed: admin, hr only
"""



class RequirementJDUpdateView(APIView):
    """
    PATCH /api/requirements/<pk>/update-jd/
    Allows admin / HR to update ONLY the job_description field.
    """
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not (is_admin(request.user) or _is_hr(request.user)):
            return Response(
                {"detail": "Only Admin or HR can edit the job description."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            req = Requirement.objects.get(pk=pk)
        except Requirement.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        jd = request.data.get("job_description")
        if jd is None:
            return Response(
                {"detail": "job_description field is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        req.job_description = jd
        req.save(update_fields=["job_description", "updated_at"])
        logger.info(f"Requirement job description updated: {req.id}")

        return Response(
            {"detail": "Job description updated.", "job_description": req.job_description},
            status=status.HTTP_200_OK,
        )