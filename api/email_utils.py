import logging
from django.core.mail import send_mail
from django.conf import settings
 
logger = logging.getLogger(__name__)
 
 
def send_interview_invite(interview):
    candidate = interview.resume.candidate_name
    requirement = ""
    if interview.resume.requirement:
        requirement = interview.resume.requirement.requirement_title
 
    # Build a safe mailinator address
    slug = candidate.lower().replace(" ", ".").replace(",", "")
    to_email = f"{slug}@mailinator.com"
 
    # Also send to the real candidate email if one is on file
    recipients = [to_email]
    if interview.resume.candidate_email:
        recipients.append(interview.resume.candidate_email)
 
    scheduled_str = interview.scheduled_at.strftime("%A, %d %B %Y at %I:%M %p")
    venue = interview.venue or "To be communicated separately"
 
    subject = f"Interview Invitation — {requirement} at Synergy"
 
    body = f"""Dear {candidate},
 
We are pleased to inform you that you have been shortlisted for the position of
{requirement} at Synergy.
 
Your interview has been scheduled as follows:
 
  Date & Time : {scheduled_str}
  Venue       : {venue}
 
Please confirm your availability by replying to this email.
If you have any questions, feel free to reach out.
 
We look forward to meeting you.
 
Best regards,
Synergy Recruitment Team
"""
 
    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@synergy.com"),
            recipient_list=recipients,
            fail_silently=False,
        )
        interview.email_sent = True
        interview.save(update_fields=["email_sent"])
        logger.info("Interview invite sent to %s", recipients)
        return True
    except Exception as exc:
        logger.error("Failed to send interview invite: %s", exc)
        return False