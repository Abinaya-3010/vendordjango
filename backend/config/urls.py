from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from vms.views import endpoint
from assistant.urls import urlpatterns as assistant_urls
urlpatterns=[
 *assistant_urls,
 path('api/quotations/compare/<int:pk>',endpoint,{'resource':'quotations','action':'compare'}),
 path('api/<str:resource>',endpoint),
 path('api/<str:resource>/<int:pk>',endpoint),
 path('api/<str:resource>/<int:pk>/<str:action>',endpoint),
]
if settings.DEBUG:urlpatterns+=static(settings.MEDIA_URL,document_root=settings.MEDIA_ROOT)
