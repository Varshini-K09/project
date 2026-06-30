from django.db import models
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Employee
from ..serializers import (
    EmployeeSerializer,
    EmployeeCreateSerializer,
    EmployeePublicSerializer,
    EmployeeRecruiterSerializer,
)
from ..utils import is_admin, is_recruiter
import logging

logger = logging.getLogger(__name__)

class EmployeeListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = request.user

        if is_admin(employee):
            qs = Employee.objects.select_related("department", "role").filter(is_active=True)
            return Response(EmployeeSerializer(qs, many=True).data)

        if is_recruiter(employee):
            qs = Employee.objects.select_related("department", "role").filter(
                is_active=True
            ).filter(
                models.Q(id=employee.id) | models.Q(created_by_employee=employee)
            )
            return Response(EmployeeRecruiterSerializer(qs, many=True).data)

        return Response(EmployeePublicSerializer(employee).data)

    def post(self, request):
        if not is_recruiter(request.user):
            return Response(
                {"detail": "Recruiter or Admin access required."},
                status=status.HTTP_403_FORBIDDEN,
            )
        data = request.data.copy()
        data["created_by_employee"] = request.user.id
        serializer = EmployeeCreateSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            logger.info("Employee created successfully")
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        logger.warning("Failed to create employee")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class EmployeeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, pk):
        try:
            return Employee.objects.select_related("department", "role").get(pk=pk)
        except Employee.DoesNotExist:
            return None

    def _serialize(self, requester, emp):
        if is_admin(requester):
            return EmployeeSerializer(emp).data
        if is_recruiter(requester):
            if emp.id == requester.id or emp.created_by_employee_id == requester.id:
                return EmployeeRecruiterSerializer(emp).data
            return None
        if emp.id == requester.id:
            return EmployeePublicSerializer(emp).data
        return None

    def get(self, request, pk):
        emp = self.get_object(pk)
        if not emp:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        data = self._serialize(request.user, emp)
        if data is None:
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
        return Response(data)

    def put(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        emp = self.get_object(pk)
        if not emp:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if emp.id == request.user.id and ("role" in request.data or "department" in request.data):
            return Response(
                {"detail": "You cannot change your own role or department."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = EmployeeSerializer(emp, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            logger.info(f"Employee updated successfully: {emp.first_name} {emp.last_name}")
            return Response(serializer.data)
        logger.warning("Failed to update employee")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        emp = self.get_object(pk)
        if not emp:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        emp.is_active = False
        emp.save()
        logger.info(f"Employee deactivated: {emp.first_name} {emp.last_name}")
        return Response({"detail": "Employee deactivated."}, status=status.HTTP_200_OK)


class VerifyEmployeeView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_admin(request.user):
            return Response({"error": "Only admin can verify employees"}, status=status.HTTP_403_FORBIDDEN)
        try:
            employee = Employee.objects.get(pk=pk)
        except Employee.DoesNotExist:
            return Response({"error": "Employee not found"}, status=status.HTTP_404_NOT_FOUND)
        employee.is_verified = True
        employee.is_active = True
        employee.save()
        logger.info(f"Employee verified successfully: {employee.first_name} {employee.last_name}")
        return Response({"message": "Employee verified successfully"}, status=status.HTTP_200_OK)