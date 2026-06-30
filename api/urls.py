from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from api.views.requirement_views import RequirementJDUpdateView
from api.views.resume_views import ResumeFileView,  ResumeSharePointFileView

from api.views.resume_views import (
    ResumeListCreateView,
    ResumeDetailView,
    ResumeScreenView,
    RequirementResumesView,
    ResumeStageUpdateView,
    BulkResumeUploadView,
    FetchAndScreenByJDView,
    TextViewDebug,
)

from .views import (
    LoginView,
    DepartmentListCreateView,
    DepartmentDetailView,
    RoleListCreateView,
    RoleDetailView,
    SkillListCreateView,
    SkillDetailView,
    EmployeeListCreateView,
    EmployeeDetailView,
    JobListView,
    JobDetailView,
    RequirementListCreateView,
    RequirementDetailView,
    RequirementStatusUpdateView,
    LogoutView,
    RequirementToggleActiveView,
    VerifyEmployeeView,
    InterviewListCreateView,
    InterviewDetailView,
    InterviewSendEmailView,
    InterviewSendAllEmailsView,
    resumes_page,
    login_page,
    dashboard_page,
    jobs_page,
)

urlpatterns = [
    path("test/",         TextViewDebug.as_view(), name="test"),
    path("login-page/",   login_page),
    path("dashboard/",    dashboard_page),
    path("jobs-page/",    jobs_page),
    path("resumes-page/", resumes_page),

    path("auth/login/",         LoginView.as_view(),        name="login"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/logout/",        LogoutView.as_view(),       name="logout"),

    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/",   SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),

    path("employees/",                 EmployeeListCreateView.as_view(), name="employee_list_create"),
    path("employees/<int:pk>/",        EmployeeDetailView.as_view(),     name="employee_detail"),
    path("employees/<int:pk>/verify/", VerifyEmployeeView.as_view(),     name="employee_verify"),

    path("departments/",          DepartmentListCreateView.as_view(), name="department_list_create"),
    path("departments/<int:pk>/", DepartmentDetailView.as_view(),     name="department_detail"),

    path("roles/",          RoleListCreateView.as_view(), name="role_list_create"),
    path("roles/<int:pk>/", RoleDetailView.as_view(),     name="role_detail"),

    path("skills/",          SkillListCreateView.as_view(), name="skill_list_create"),
    path("skills/<int:pk>/", SkillDetailView.as_view(),     name="skill_detail"),

    path("jobs/",          JobListView.as_view(),   name="job_list"),
    path("jobs/<int:pk>/", JobDetailView.as_view(), name="job_detail"),

    path("requirements/",                        RequirementListCreateView.as_view(),   name="requirement_list_create"),
    path("requirements/<int:pk>/",               RequirementDetailView.as_view(),       name="requirement_detail"),
    path("requirements/<int:pk>/update-status/", RequirementStatusUpdateView.as_view(), name="requirement_status_update"),
    path("requirements/<int:pk>/toggle-active/", RequirementToggleActiveView.as_view(), name="requirement_toggle_active"),
    path("requirements/<int:pk>/update-jd/",     RequirementJDUpdateView.as_view(),     name="requirement_update_jd"),
    path("requirements/<int:pk>/resumes/",       RequirementResumesView.as_view(),      name="requirement_resumes"),

    path("resumes/",              ResumeListCreateView.as_view(),  name="resume_list_create"),
    path("resumes/bulk-upload/",  BulkResumeUploadView.as_view(),  name="bulk_upload_resumes"),
    path("resumes/fetch-and-screen/", FetchAndScreenByJDView.as_view(), name="fetch_and_screen"),
    path("resumes/<int:pk>/",     ResumeDetailView.as_view(),      name="resume_detail"),
    path("resumes/<int:pk>/screen/", ResumeScreenView.as_view(),   name="resume_screen"),
    path("resumes/<int:pk>/stage/",  ResumeStageUpdateView.as_view(), name="resume_stage_update"),
    path("resumes/<int:pk>/file/", ResumeFileView.as_view(), name="resume_file"),
    path('resumes/<int:pk>/sharepoint-file/', ResumeSharePointFileView.as_view()),

    path("interviews/send-all-emails/",     InterviewSendAllEmailsView.as_view(), name="send_all_emails"),
    path("interviews/",                     InterviewListCreateView.as_view(),    name="interview_list_create"),
    path("interviews/<int:pk>/",            InterviewDetailView.as_view(),        name="interview_detail"),
    path("interviews/<int:pk>/send-email/", InterviewSendEmailView.as_view(),     name="interview_send_email"),
]