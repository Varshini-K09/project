from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Role, Skill
from ..serializers import RoleSerializer, SkillSerializer
from ..permissions import IsAdminEmployee  # ✅ replaced is_admin import


class RoleListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        return [IsAdminEmployee()]

    def get(self, request):
        roles = Role.objects.filter(is_active=True)
        return Response(RoleSerializer(roles, many=True).data)

    def post(self, request):
        serializer = RoleSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class RoleDetailView(APIView):

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        return [IsAdminEmployee()]

    def get_object(self, pk):
        try:
            return Role.objects.get(pk=pk)
        except Role.DoesNotExist:
            return None

    def get(self, request, pk):
        role = self.get_object(pk)
        if not role:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(RoleSerializer(role).data)

    def put(self, request, pk):
        role = self.get_object(pk)
        if not role:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = RoleSerializer(role, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SkillListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        return [IsAdminEmployee()]

    def get(self, request):
        skills = Skill.objects.filter(is_active=True)
        return Response(SkillSerializer(skills, many=True).data)

    def post(self, request):
        serializer = SkillSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SkillDetailView(APIView):

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsAuthenticated()]
        return [IsAdminEmployee()]

    def get_object(self, pk):
        try:
            return Skill.objects.get(pk=pk)
        except Skill.DoesNotExist:
            return None

    def get(self, request, pk):
        skill = self.get_object(pk)
        if not skill:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(SkillSerializer(skill).data)

    def put(self, request, pk):
        skill = self.get_object(pk)
        if not skill:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = SkillSerializer(skill, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)