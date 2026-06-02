from rest_framework import serializers
from .models import Department, Role, Skill, Employee, Requirement, Resume, Interview


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "department_name", "description", "is_active", "created_at", "updated_at"]



class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "role_name", "role_description", "is_active", "created_at", "updated_at"]



class SkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = Skill
        fields = ["id", "skill_name", "is_active", "created_at", "updated_at"]



class EmployeeSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.department_name", read_only=True)
    role_name = serializers.CharField(source="role.role_name", read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id", "emp_id", "emp_name", "emp_email", "phone_number",
            "department", "department_name",
            "role", "role_name",
            "created_by_employee",
            "is_verified", "is_active",
            "created_at", "updated_at",
        ]
        extra_kwargs = {"password": {"write_only": True}}

# Public/self-view: no sensitive fields
class EmployeePublicSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.department_name", read_only=True)
    role_name = serializers.CharField(source="role.role_name", read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id", "emp_id", "emp_name", "emp_email", "phone_number",
            "department", "department_name",
            "role", "role_name",
            "created_at", "updated_at",
        ]


# Recruiter view: adds is_active, created_by_employee — still no is_verified
class EmployeeRecruiterSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.department_name", read_only=True)
    role_name = serializers.CharField(source="role.role_name", read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id", "emp_id", "emp_name", "emp_email", "phone_number",
            "department", "department_name",
            "role", "role_name",
            "created_by_employee",
            "is_active",
            "created_at", "updated_at",
        ]


# Admin view: full fields (existing EmployeeSerializer is already correct)
# Keep EmployeeSerializer as-is for admin use

class EmployeeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = [
            "emp_id", "emp_name", "emp_email", "phone_number",
            "password", "department", "role", "created_by_employee",
        ]
        extra_kwargs = {"password": {"write_only": True}}

    def create(self, validated_data):

        password = validated_data.pop("password")

        employee = Employee(**validated_data)

        employee.set_password(password)

        employee.save()

        return employee



class LoginSerializer(serializers.Serializer):
    emp_email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class RequirementSerializer(serializers.ModelSerializer):
    skills = SkillSerializer(many=True, read_only=True)
    skill_ids = serializers.PrimaryKeyRelatedField(
        queryset=Skill.objects.all(), many=True, write_only=True, source="skills"
    )
    department_name = serializers.CharField(source="department.department_name", read_only=True)
    requested_by_name = serializers.CharField(source="requested_by_employee.emp_name", read_only=True)
    recruiter_name = serializers.CharField(source="recruiter.emp_name", read_only=True)

    class Meta:
        model = Requirement
        fields = [
            "id", "requirement_title",
            "department", "department_name",
            "requested_by_employee", "requested_by_name",
            "recruiter", "recruiter_name",
            "vacancies", "experience_required", "location",
            "employment_type", "work_mode", "salary_range",
            "skills", "skill_ids",
            "job_description", "requested_new_skill",
            "recruiter_comments", "status",
            "is_active", "approved_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "requested_by_employee",  
            "recruiter",              
            "status",                 
            "approved_at",            
        ]


class RequirementStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Requirement
        fields = ["status", "recruiter_comments", "approved_at"]



class JobSerializer(serializers.ModelSerializer):
    skills = SkillSerializer(many=True, read_only=True)
    department_name = serializers.CharField(source="department.department_name", read_only=True)

    class Meta:
        model = Requirement
        fields = [
            "id", "requirement_title",
            "department_name",
            "vacancies", "experience_required", "location",
            "employment_type", "work_mode", "salary_range",
            "skills", "job_description",
            "status", "created_at",
        ]
# ─────────────────────────────────────────────────────────────────────────────
# ADD THIS to your existing api/serializers.py
# ─────────────────────────────────────────────────────────────────────────────

from .models import Resume   # add Resume to your existing import


class ResumeSerializer(serializers.ModelSerializer):
    requirement_title  = serializers.CharField(source="requirement.requirement_title", read_only=True)
    uploaded_by_name   = serializers.CharField(source="uploaded_by.emp_name",          read_only=True)
    resume_url         = serializers.SerializerMethodField()

    class Meta:
        model  = Resume
        fields = [
            "id",
            "requirement", "requirement_title",
            "uploaded_by", "uploaded_by_name",
            "candidate_name", "candidate_email", "candidate_phone",
            "notes",
            "resume_file", "resume_url",
            "screening_result", "screening_done",
            "stage",
            "is_active",
            "created_at", "updated_at",
        ]
        read_only_fields = ["uploaded_by", "screening_result", "screening_done"]

    def get_resume_url(self, obj):
        request = self.context.get("request")
        if obj.resume_file and request:
            return request.build_absolute_uri(obj.resume_file.url)
        return None
    
class InterviewSerializer(serializers.ModelSerializer):
    candidate_name     = serializers.CharField(source="resume.candidate_name",               read_only=True)
    candidate_email    = serializers.CharField(source="resume.candidate_email",              read_only=True)
    requirement_title  = serializers.CharField(source="resume.requirement.requirement_title",read_only=True)
    screening_score    = serializers.IntegerField(source="resume.screening_result.score",   read_only=True, default=None)
    scheduled_by_name  = serializers.CharField(source="scheduled_by.emp_name",              read_only=True)
 
    class Meta:
        model  = Interview
        fields = [
            "id",
            "resume",
            "candidate_name", "candidate_email",
            "requirement_title",
            "screening_score",
            "scheduled_at", "venue",
            "interviewer_notes",
            "status",
            "email_sent",
            "scheduled_by", "scheduled_by_name",
            "is_active",
            "created_at", "updated_at",
        ]
        read_only_fields = ["scheduled_by", "email_sent"]
 
 
class InterviewPublicSerializer(serializers.ModelSerializer):
    """For non-admin viewers — no timing, no internal notes."""
    candidate_name    = serializers.CharField(source="resume.candidate_name",               read_only=True)
    requirement_title = serializers.CharField(source="resume.requirement.requirement_title",read_only=True)
    screening_score   = serializers.SerializerMethodField()
 
    class Meta:
        model  = Interview
        fields = [
            "id",
            "candidate_name",
            "requirement_title",
            "screening_score",
            "status",
            "created_at",
        ]
 
    def get_screening_score(self, obj):
        result = obj.resume.screening_result
        if isinstance(result, dict):
            return result.get("score")
        return None