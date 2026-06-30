def is_admin(employee):
    role_name = (getattr(employee.role, 'role_name', '') or '').strip().lower()
    return role_name == 'admin' or employee.is_superuser

def is_recruiter(employee):
    role_name = (getattr(employee.role, 'role_name', '') or '').strip().lower()
    return role_name == 'recruiter' or employee.is_superuser or employee.is_staff

def _is_hr(employee):
    role = (getattr(employee.role, "role_name", "") or "").lower()
    return role == "hr"