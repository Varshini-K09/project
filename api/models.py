from django.db import models
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager
from .validations import validate_email, validate_password, validate_phone_number


class BaseModel(models.Model):
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Department(BaseModel):
    department_name = models.CharField(max_length=100)
    description     = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return self.department_name


class Role(BaseModel):
    role_name        = models.CharField(max_length=50)
    role_description = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return self.role_name


class Skill(BaseModel):
    skill_name = models.CharField(max_length=100)

    def __str__(self):
        return self.skill_name


class EmployeeManager(BaseUserManager):

    def create_user(self, emp_email, password=None, **extra_fields):
        if not emp_email:
            raise ValueError("Email is required")
        emp_email = self.normalize_email(emp_email)
        user = self.model(emp_email=emp_email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, emp_email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff",      True)
        extra_fields.setdefault("is_superuser",  True)
        extra_fields.setdefault("is_verified",   True)
        extra_fields.setdefault("is_active",     True)
        return self.create_user(emp_email, password, **extra_fields)


class Employee(AbstractBaseUser, PermissionsMixin, BaseModel):

    emp_id    = models.CharField(max_length=20, unique=True)
    emp_name  = models.CharField(max_length=100)
    emp_email = models.EmailField(max_length=150, unique=True, validators=[validate_email])

    phone_number = models.CharField(
        max_length=15, blank=True, null=True, unique=True,
        validators=[validate_phone_number],
    )

    password = models.CharField(max_length=255, validators=[validate_password])

    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="employees",
    )
    role = models.ForeignKey(
        Role, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="employees",
    )
    created_by_employee = models.ForeignKey(
        "self", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="created_employees",
    )

    is_verified = models.BooleanField(default=False)
    is_staff    = models.BooleanField(default=False)

    USERNAME_FIELD  = "emp_email"
    REQUIRED_FIELDS = ["emp_name", "emp_id"]
    objects         = EmployeeManager()

    def __str__(self):
        return self.emp_name


class Requirement(BaseModel):

    STATUS_PENDING  = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"

    STATUS_CHOICES = [
        (STATUS_PENDING,  "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    requirement_title = models.CharField(max_length=150)

    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="requirements",
    )
    requested_by_employee = models.ForeignKey(
        Employee, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="requested_requirements",
    )
    recruiter = models.ForeignKey(
        Employee, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="assigned_requirements",
    )

    vacancies           = models.IntegerField(default=1)
    experience_required = models.CharField(max_length=50,  blank=True, null=True)
    location            = models.CharField(max_length=100, blank=True, null=True)
    employment_type     = models.CharField(max_length=50,  blank=True, null=True)
    work_mode           = models.CharField(max_length=50,  blank=True, null=True)
    salary_range        = models.CharField(max_length=100, blank=True, null=True)

    skills = models.ManyToManyField(Skill, related_name="requirements")

    job_description     = models.TextField(blank=True, null=True)
    requested_new_skill = models.CharField(max_length=100, blank=True, null=True)
    recruiter_comments  = models.TextField(blank=True, null=True)

    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING,
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.requirement_title


class Resume(BaseModel):

    # ── Hiring pipeline stage ──────────────────────────────────────────────
    STAGE_APPLIED             = "applied"
    STAGE_SCREENING           = "screening"
    STAGE_SHORTLISTED         = "shortlisted"
    STAGE_INTERVIEW_SCHEDULED = "interview_scheduled"
    STAGE_SELECTED            = "selected"
    STAGE_REJECTED            = "rejected"

    STAGE_CHOICES = [
        (STAGE_APPLIED,             "Applied"),
        (STAGE_SCREENING,           "Screening"),
        (STAGE_SHORTLISTED,         "Shortlisted"),
        (STAGE_INTERVIEW_SCHEDULED, "Interview Scheduled"),
        (STAGE_SELECTED,            "Selected"),
        (STAGE_REJECTED,            "Rejected"),
    ]

    requirement = models.ForeignKey(
        Requirement, on_delete=models.CASCADE,
        related_name="resumes", null=True, blank=True,
    )
    uploaded_by = models.ForeignKey(
        "Employee", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="uploaded_resumes",
    )

    candidate_name  = models.CharField(max_length=150)
    candidate_email = models.EmailField(blank=True, null=True)
    candidate_phone = models.CharField(max_length=20, blank=True, null=True)
    notes           = models.TextField(blank=True, null=True)
    resume_file     = models.FileField(upload_to="resumes/",blank=True, null=True)

    # ── LLM screening cache ───────────────────────────────────────────────
    screening_result = models.JSONField(null=True, blank=True)
    screening_done   = models.BooleanField(default=False)

    # ── Kanban stage ──────────────────────────────────────────────────────
    stage = models.CharField(
        max_length=30,
        choices=STAGE_CHOICES,
        default=STAGE_APPLIED,
        db_index=True,
    )

    def __str__(self):
        return f"{self.candidate_name} – {self.requirement}"


class Interview(BaseModel):

    STATUS_SCHEDULED = "scheduled"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    resume = models.OneToOneField(
        Resume, on_delete=models.CASCADE, related_name="interview",
    )
    scheduled_at      = models.DateTimeField()
    venue             = models.CharField(max_length=255, blank=True, null=True)
    interviewer_notes = models.TextField(blank=True, null=True)
    status            = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_SCHEDULED,
    )
    email_sent    = models.BooleanField(default=False)
    scheduled_by  = models.ForeignKey(
        Employee, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="scheduled_interviews",
    )

    def __str__(self):
        return f"Interview: {self.resume.candidate_name} @ {self.scheduled_at}"