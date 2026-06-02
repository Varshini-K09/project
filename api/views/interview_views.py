from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from ..models import Interview
from ..serializers import InterviewSerializer, InterviewPublicSerializer
from ..email_utils import send_interview_invite
from ..utils import is_admin, is_recruiter


class InterviewListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = request.user
        qs = (
            Interview.objects
            .select_related("resume__requirement", "resume", "scheduled_by")
            .filter(is_active=True)
            .order_by("scheduled_at")
        )

        req_id = request.query_params.get("requirement")
        if req_id:
            qs = qs.filter(resume__requirement_id=req_id)

        if is_admin(employee):
            return Response(InterviewSerializer(qs, many=True).data)
        if is_recruiter(employee):
            return Response(InterviewPublicSerializer(qs, many=True).data)
        return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)

    def post(self, request):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        serializer = InterviewSerializer(data=request.data)
        if serializer.is_valid():
            interview = serializer.save(scheduled_by=request.user)
            if request.data.get("send_email", False):
                send_interview_invite(interview)
            return Response(InterviewSerializer(interview).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class InterviewDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, pk):
        try:
            return Interview.objects.select_related(
                "resume__requirement", "resume", "scheduled_by"
            ).get(pk=pk)
        except Interview.DoesNotExist:
            return None

    def get(self, request, pk):
        obj = self.get_object(pk)
        if not obj:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if is_admin(request.user):
            return Response(InterviewSerializer(obj).data)
        if is_recruiter(request.user):
            return Response(InterviewPublicSerializer(obj).data)
        return Response({"detail": "Access denied."}, status=status.HTTP_403_FORBIDDEN)

    def put(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object(pk)
        if not obj:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = InterviewSerializer(obj, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # def delete(self, request, pk):
    #     if not is_admin(request.user):
    #         return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
    #     obj = self.get_object(pk)
    #     if not obj:
    #         return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    #     obj.is_active = False
    #     obj.save()
    #     return Response({"detail": "Interview cancelled."}, status=status.HTTP_200_OK)
    def delete(self, request, pk):
        if not is_admin(request.user):
            return Response(
                {"detail": "Admin access required."},
                status=status.HTTP_403_FORBIDDEN
            )

        obj = self.get_object(pk)

        if not obj:
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        obj.delete()

        return Response(
            {"detail": "Interview deleted permanently."},
            status=status.HTTP_200_OK
        )

class InterviewSendEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            interview = Interview.objects.select_related(
                "resume__requirement", "resume"
            ).get(pk=pk)
        except Interview.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        ok = send_interview_invite(interview)
        if ok:
            return Response({"detail": "Email sent successfully."})
        return Response({"detail": "Email sending failed."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
class InterviewSendAllEmailsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_admin(request.user):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        
        pending = Interview.objects.select_related(
            "resume__requirement", "resume"
        ).filter(email_sent=False, is_active=True)

        success, failed, failed_list = 0, 0, []

        for interview in pending:
            ok = send_interview_invite(interview)
            if ok:
                success += 1
            else:
                failed += 1
                failed_list.append(interview.resume.candidate_name)

        return Response({
            "success": success,
            "failed": failed,
            "failed_candidates": failed_list
        })