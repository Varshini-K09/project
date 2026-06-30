from .auth_views import LoginView, LogoutView
from .page_views import login_page, dashboard_page, jobs_page, resumes_page
from .department_views import DepartmentListCreateView, DepartmentDetailView
from .role_skill_views import (
    RoleListCreateView,
    RoleDetailView,
    SkillListCreateView,
    SkillDetailView,
)
from .employee_views import EmployeeListCreateView, EmployeeDetailView, VerifyEmployeeView
from .resume_views import (
    ResumeListCreateView,
    ResumeDetailView,
    ResumeScreenView,
    RequirementResumesView,
    ResumeStageUpdateView,
    BulkResumeUploadView,
    FetchAndScreenByJDView,
    TextViewDebug,
)
from .requirement_views import (
    RequirementListCreateView,
    RequirementDetailView,
    RequirementStatusUpdateView,
    RequirementToggleActiveView,
    RequirementJDUpdateView,
)
from .job_views import JobListView, JobDetailView
from .interview_views import (
    InterviewListCreateView,
    InterviewDetailView,
    InterviewSendEmailView,
    InterviewSendAllEmailsView,
)

__all__ = [
    # Auth
    "LoginView", "LogoutView",
    # Pages
    "login_page", "dashboard_page", "jobs_page", "resumes_page",
    # Departments
    "DepartmentListCreateView", "DepartmentDetailView",
    # Roles & Skills
    "RoleListCreateView", "RoleDetailView",
    "SkillListCreateView", "SkillDetailView",
    # Employees
    "EmployeeListCreateView", "EmployeeDetailView", "VerifyEmployeeView",
    # Resumes
    "ResumeListCreateView", "ResumeDetailView", "ResumeScreenView",
    "RequirementResumesView", "ResumeStageUpdateView",
    "BulkResumeUploadView", "FetchAndScreenByJDView", "TextViewDebug",
    # Requirements
    "RequirementListCreateView", "RequirementDetailView",
    "RequirementStatusUpdateView", "RequirementToggleActiveView", "RequirementJDUpdateView",
    # Jobs
    "JobListView", "JobDetailView",
    # Interviews
    "InterviewListCreateView", "InterviewDetailView",
    "InterviewSendEmailView", "InterviewSendAllEmailsView",
]