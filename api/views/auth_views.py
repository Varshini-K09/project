from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate

from ..models import Employee
from ..serializers import LoginSerializer, EmployeeSerializer
import logging

logger = logging.getLogger(__name__)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        emp_email = serializer.validated_data["emp_email"]
        password = serializer.validated_data["password"]

        logger.info(f"Attempting login for employee: {emp_email}")
        employee = authenticate(request, username=emp_email, password=password)
        if employee is None:
            logger.warning("Login failed: Invalid credentials")
            return Response({"detail": "Invalid credentials."}, status=status.HTTP_401_UNAUTHORIZED)

        if not employee.is_verified:
            logger.warning("Login failed: Account not verified")
            return Response({"detail": "Account not verified."}, status=status.HTTP_403_FORBIDDEN)

        refresh = RefreshToken.for_user(employee)
        logger.info(f"Login successful for employee: {emp_email}")
        return Response(
            {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "employee": EmployeeSerializer(employee).data,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logger.info("Attempting logout")
        try:
            token = RefreshToken(request.data["refresh"])
            token.blacklist()
            logger.info("Logout successful")
            return Response({"detail": "Logout successful"}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.error(f"Logout failed: {e}")
            return Response({"detail": "Invalid token"}, status=status.HTTP_400_BAD_REQUEST)