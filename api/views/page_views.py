from django.shortcuts import render


def login_page(request):
    return render(request, "login.html")


def dashboard_page(request):
    return render(request, "dashboard.html")


def jobs_page(request):
    return render(request, "jobs.html")


def resumes_page(request):
    return render(request, "resumes.html")