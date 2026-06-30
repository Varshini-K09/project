import re

from django.core.exceptions import ValidationError

def validate_email(value):
     pattern = r'^[a-zA-Z0-9]+@synergy\.com$'
     if not re.match(pattern, value):
         raise ValidationError('Email must be a valid Synergy mail address')

def validate_password(value):
     if len(value) < 8:
          raise ValidationError('Password must be at least 8 characters long')
     if not re.search(r'[A-Z]', value):
            raise ValidationError('Password must contain at least one uppercase letter')
     if not re.search(r'[a-z]', value):
            raise ValidationError('Password must contain at least one lowercase letter')
     if not re.search(r'[0-9]', value):
            raise ValidationError('Password must contain at least one digit')
     if not re.search(r'[!@#$%^&*(),.?":{}|<>]', value):
            raise ValidationError('Password must contain at least one special character')
     
def validate_phone_number(value):
      if not len(value)==10 or not value.isdigit():
            raise ValidationError('Phone number must contain 10 digits and must not contain characters')