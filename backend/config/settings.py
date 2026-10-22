from pathlib import Path
import os
from dotenv import load_dotenv
BASE_DIR=Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR/'.env')
SECRET_KEY=os.getenv('DJANGO_SECRET_KEY','dev-only-insecure-key')
DEBUG=os.getenv('DEBUG','False').lower()=='true'
ALLOWED_HOSTS=['localhost','127.0.0.1']
INSTALLED_APPS=['django.contrib.auth','django.contrib.contenttypes','django.contrib.sessions','django.contrib.staticfiles','rest_framework','corsheaders','vms','assistant']
MIDDLEWARE=['corsheaders.middleware.CorsMiddleware','django.middleware.common.CommonMiddleware','django.contrib.sessions.middleware.SessionMiddleware']
ROOT_URLCONF='config.urls'
DATABASES={'default':{'ENGINE':'django.db.backends.postgresql','NAME':os.getenv('DB_NAME','vendorpro_db'),'USER':os.getenv('DB_USER','postgres'),'PASSWORD':os.getenv('DB_PASSWORD',''),'HOST':os.getenv('DB_HOST','localhost'),'PORT':os.getenv('DB_PORT','5432')}}
CORS_ALLOWED_ORIGINS=['http://localhost:9000','http://localhost:5173']
REST_FRAMEWORK={'DEFAULT_AUTHENTICATION_CLASSES':[],'DEFAULT_PERMISSION_CLASSES':['rest_framework.permissions.AllowAny'],'DEFAULT_THROTTLE_RATES':{'assistant':'30/min'}}
DEFAULT_AUTO_FIELD='django.db.models.BigAutoField'
MEDIA_ROOT=BASE_DIR/'uploads'
MEDIA_URL='/uploads/'
USE_TZ=True
TIME_ZONE='UTC'
# Static files configuration
STATIC_URL = "/static/"

# --- AI assistant (Gemini). The key stays on the server; set it in backend/.env, never commit it.
ASSISTANT_PROVIDER=os.getenv('ASSISTANT_PROVIDER','gemini')
GEMINI_API_KEY=os.getenv('GEMINI_API_KEY','')
GEMINI_MODEL=os.getenv('GEMINI_MODEL','gemini-2.5-flash')
GEMINI_TIMEOUT_SECONDS=float(os.getenv('GEMINI_TIMEOUT_SECONDS','20'))  # per Gemini call
GEMINI_MAX_OUTPUT_TOKENS=int(os.getenv('GEMINI_MAX_OUTPUT_TOKENS','4096'))
# Whole-request budget across all tool steps. Keep the frontend timeout (VITE_ASSISTANT_TIMEOUT_MS)
# above: total - 5 + GEMINI_TIMEOUT_SECONDS.
ASSISTANT_TOTAL_TIMEOUT_SECONDS=float(os.getenv('ASSISTANT_TOTAL_TIMEOUT_SECONDS','45'))
