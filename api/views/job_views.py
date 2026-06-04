from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from ..models import Requirement
from ..serializers import JobSerializer
import logging

logger = logging.getLogger(__name__)

class JobListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = JobSerializer

    def get_queryset(self):
        qs = (
            Requirement.objects
            .select_related("department")
            .prefetch_related("skills")
            .filter(status=Requirement.STATUS_APPROVED, is_active=True)
        )
        department = self.request.query_params.get("department")
        if department:
            qs = qs.filter(department__department_name=department)
        logger.info(f"Retrieving job listings for department: {department}")
        return qs


class JobDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = JobSerializer

    def get_queryset(self):
        return (
            Requirement.objects
            .select_related("department")
            .prefetch_related("skills")
            .filter(status=Requirement.STATUS_APPROVED, is_active=True)
        )