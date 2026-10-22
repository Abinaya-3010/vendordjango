from django.urls import path

from . import views

urlpatterns = [path('api/assistant/chat', views.chat)]
