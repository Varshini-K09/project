from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Department
from ..serializers import DepartmentSerializer
from ..permissions import IsAdminEmployee  
import logging

logger = logging.getLogger(__name__)

class DepartmentListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]       
        return [IsAdminEmployee()]           

    def get(self, request):
        departments = Department.objects.filter(is_active=True)
        return Response(DepartmentSerializer(departments, many=True).data)

    def post(self, request):
        serializer = DepartmentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            logger.info("Department created successfully")
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        logger.warning("Failed to create department")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class DepartmentDetailView(APIView):

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]     
        return [IsAdminEmployee()]           

    def get_object(self, pk):
        try:
            return Department.objects.get(pk=pk)
        except Department.DoesNotExist:
            return None

    def get(self, request, pk):
        dept = self.get_object(pk)
        if not dept:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(DepartmentSerializer(dept).data)

    def put(self, request, pk):
        dept = self.get_object(pk)
        if not dept:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = DepartmentSerializer(dept, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            logger.info(f"Department updated successfully: {dept.name}")
            return Response(serializer.data)
        logger.warning("Failed to update department")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        dept = self.get_object(pk)
        if not dept:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        dept.is_active = False
        dept.save()
        logger.info(f"Department deactivated: {dept.name}")
        return Response({"detail": "Department deactivated."}, status=status.HTTP_200_OK)