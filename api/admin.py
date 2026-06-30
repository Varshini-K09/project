from django.contrib import admin
from .models import Department, Role, Skill, Employee, Requirement, Resume

admin.site.register(Department)
admin.site.register(Role)
admin.site.register(Skill)
admin.site.register(Employee)
admin.site.register(Requirement)

@admin.register(Resume)
class ResumeAdmin(admin.ModelAdmin):
    list_display  = ['candidate_name', 'candidate_email', 'requirement', 'uploaded_by', 'screening_done', 'is_active', 'created_at']
    list_filter   = ['screening_done', 'is_active']
    search_fields = ['candidate_name', 'candidate_email']
    readonly_fields = ['screening_result', 'screening_done', 'created_at', 'updated_at']