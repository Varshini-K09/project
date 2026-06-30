# Synergy — AI-Powered Applicant Tracking System

A full-stack recruitment management platform built with Django REST Framework. Synergy streamlines the end-to-end hiring pipeline — from job requisition approval to interview scheduling — with AI-assisted resume screening powered by the Groq LLM API.

---

## Features

- **Role-based access** — HR managers, recruiters, and interviewers each have scoped permissions via custom DRF permission classes
- **Job requisition workflow** — departments raise hiring requirements; HR approves or rejects with comments before recruiting begins
- **Resume management** — single and bulk PDF resume uploads with OCR fallback for scanned documents (Tesseract + pdf2image)
- **AI resume screening** — resumes are scored against job requirements using the Groq LLM; results are cached on the model to avoid repeated API calls
- **Kanban pipeline** — candidates move through stages: Applied → Screening → Shortlisted → Interview Scheduled → Selected / Rejected
- **Interview scheduling** — schedule interviews, record interviewer notes, and send confirmation emails via Mailtrap (dev) or any SMTP provider
- **JWT authentication** — access + refresh tokens with rotation and blacklisting on logout
- **Auto-generated API docs** — Swagger UI available at `/api/docs/`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Django 6.0.5, Django REST Framework |
| Auth | djangorestframework-simplejwt |
| Database | SQLite (dev) |
| AI Screening | Groq API (LLaMA) |
| PDF Parsing | pypdf, pdf2image, pytesseract |
| Email | Mailtrap SMTP (dev) |
| API Docs | drf-spectacular (Swagger) |
| Frontend | Vanilla JS + HTML templates (served by Django) |

---

## Project Structure

```
project/
├── api/
│   ├── models.py          # Employee, Department, Role, Skill, Requirement, Resume, Interview
│   ├── serializers.py
│   ├── permissions.py
│   ├── screening.py       # Groq LLM screening logic + OCR fallback
│   ├── email_utils.py
│   ├── views/
│   │   ├── auth_views.py
│   │   ├── employee_views.py
│   │   ├── department_views.py
│   │   ├── requirement_views.py
│   │   ├── resume_views.py
│   │   ├── interview_views.py
│   │   └── role_skill_views.py
│   └── migrations/
├── project/
│   ├── settings.py
│   └── urls.py
└── templates/             # Dashboard, Jobs, Resumes, Login pages
    └── static/
        ├── css/
        └── js/
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- pip
- (Optional) Tesseract OCR installed locally for scanned PDF support

### Installation

```bash
git clone <repo-url>
cd project

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
```

### Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key

EMAIL_HOST_USER=your_mailtrap_username
EMAIL_HOST_PASSWORD=your_mailtrap_password
```

### Run

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

The app will be available at `http://localhost:8000`.

| URL | Description |
|---|---|
| `/api/docs/` | Swagger API documentation |
| `/api/dashboard/` | HR dashboard |
| `/api/login-page/` | Login page |
| `/api/jobs-page/` | Job listings |
| `/api/resumes-page/` | Resume kanban board |

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login/` | Obtain JWT tokens |
| POST | `/api/auth/logout/` | Blacklist refresh token |
| GET/POST | `/api/requirements/` | List or create job requirements |
| PATCH | `/api/requirements/<id>/update-status/` | Approve or reject a requirement |
| GET/POST | `/api/resumes/` | List or upload a resume |
| POST | `/api/resumes/bulk-upload/` | Upload multiple resumes as ZIP |
| POST | `/api/resumes/<id>/screen/` | Trigger AI screening for a resume |
| PATCH | `/api/resumes/<id>/stage/` | Move candidate to next pipeline stage |
| GET/POST | `/api/interviews/` | Schedule interviews |
| POST | `/api/interviews/<id>/send-email/` | Send interview invite email |

---

## Notes

- OCR paths for Tesseract and Poppler in `screening.py` are hardcoded to a Windows dev machine. Update `TESSERACT_PATH` and `POPPLER_PATH` before deploying on another machine.
- `DEBUG=True` and a hardcoded `SECRET_KEY` are present — replace both before any production deployment.
- The database is SQLite by default; switch to PostgreSQL for production by updating the `DATABASES` config in `settings.py`.
