from rest_framework.permissions import BasePermission


class IsAdminEmployee(BasePermission):

    def has_permission(self, request, view):
        employee = request.user

        return (
            employee and
            employee.is_authenticated and
            employee.role and
            employee.role.role_name.lower() == 'admin'
        )