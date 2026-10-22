from django.db import transaction,IntegrityError
from django.utils import timezone
from django.http import JsonResponse
from rest_framework.decorators import api_view,parser_classes
from rest_framework.parsers import MultiPartParser,FormParser
from rest_framework.response import Response
from rest_framework import status
from .models import Vendor,RFQ,Quotation,PurchaseOrder,Invoice,Inventory
from .serializers import VendorSerializer,RFQSerializer,QuotationSerializer,POSerializer,InvoiceSerializer,InventorySerializer
from pathlib import Path
import uuid
REG={'vendors':(Vendor,VendorSerializer),'rfqs':(RFQ,RFQSerializer),'quotations':(Quotation,QuotationSerializer),'purchase-orders':(PurchaseOrder,POSerializer),'invoices':(Invoice,InvoiceSerializer),'inventory':(Inventory,InventorySerializer)}
def ok(data=None,message=None,code=200):
 d={'success':True}
 if data is not None:d['data']=data
 if message:d['message']=message
 return Response(d,status=code)
def err(msg,code=400):return Response({'success':False,'message':msg},status=code)
def number(obj,prefix,field):
 # fresh PostgreSQL numeric PK supplies a monotonic collision-resistant sequence
 setattr(obj,field,f'{prefix}-{obj.pk:04d}')
 obj.save(update_fields=[field])
def serialize(resource,obj):return REG[resource][1](obj).data
def input_data(request):return request.data.copy()
@api_view(['GET','POST','PUT','PATCH','DELETE'])
def endpoint(request,resource,pk=None,action=None):
 if resource not in REG:return err('Unknown resource',404)
 model,ser=REG[resource]
 try:
  with transaction.atomic():
   obj=model.objects.filter(pk=pk).first() if pk is not None else None
   if pk is not None and obj is None and action!='compare':return err('Not found',404)
   if action=='upload' and resource=='vendors' and request.method=='POST':
    file=request.FILES.get('document')
    if not file:return err('No file uploaded')
    from django.conf import settings
    path=Path(settings.MEDIA_ROOT);path.mkdir(parents=True,exist_ok=True)
    name=f'{uuid.uuid4().hex}{Path(file.name).suffix}'
    with (path/name).open('wb') as target:
     for chunk in file.chunks():target.write(chunk)
    obj.documentUrl=f'/uploads/{name}';obj.save();return ok(serialize(resource,obj))
   if action=='send' and resource=='rfqs' and request.method=='POST':
    obj.vendors.set(request.data.get('vendorIds',[]));obj.status='Sent';obj.save();return ok(serialize(resource,obj),'RFQ sent to vendors')
   if action=='status' and request.method=='PATCH':
    obj.status=request.data.get('status',obj.status)
    if resource=='invoices' and obj.status=='Paid':obj.paidDate=timezone.now()
    obj.save();return ok(serialize(resource,obj))
   if action=='select' and resource=='quotations' and request.method=='POST':
    Quotation.objects.filter(rfq=obj.rfq).update(status='Rejected')
    obj.status='Selected';obj.save();obj.rfq.status='Closed';obj.rfq.save()
    return ok(serialize(resource,obj))
   if action=='compare' and resource=='quotations' and request.method=='GET':
    rfq=RFQ.objects.filter(pk=pk).first()
    if not rfq:return err('RFQ not found',404)
    qs=Quotation.objects.filter(rfq=rfq).order_by('totalPrice')
    return ok({'rfq':serialize('rfqs',rfq),'quotations':[serialize(resource,q) for q in qs]})
   if request.method=='GET':
    if obj:return ok(serialize(resource,obj))
    qs=model.objects.all().order_by('-createdAt')
    for key in ('category','status','vendor','rfq'):
     if request.query_params.get(key) and key in [f.name for f in model._meta.fields]:qs=qs.filter(**{key:request.query_params[key]})
    if resource=='vendors' and request.query_params.get('search'):
     from django.db.models import Q
     s=request.query_params['search'];qs=qs.filter(Q(name__icontains=s)|Q(company__icontains=s)|Q(email__icontains=s))
    if resource=='quotations':qs=qs.order_by('totalPrice')
    return ok([serialize(resource,o) for o in qs])
   if request.method=='DELETE':
    if obj:obj.delete()
    return ok(message=f'{resource} deleted')
   if request.method in ('POST','PUT','PATCH'):
    data=input_data(request)
    if resource=='purchase-orders' and data.get('quotationId'):
     q=Quotation.objects.filter(pk=data['quotationId']).first()
     if not q:return err('Quotation not found',404)
     data={'rfq':q.rfq_id,'quotation':q.pk,'vendor':q.vendor_id,'items':q.items,'totalAmount':q.totalPrice,'deliveryDate':data.get('deliveryDate'),'notes':data.get('notes','')}
    if resource=='invoices' and data.get('poId'):
     po=PurchaseOrder.objects.filter(pk=data['poId']).first()
     if not po:return err('PO not found',404)
     data={'purchaseOrder':po.pk,'vendor':po.vendor_id,'items':po.items,'subTotal':po.totalAmount,'dueDate':data.get('dueDate')}
    if resource=='inventory' and data.get('poId'):
     po=PurchaseOrder.objects.filter(pk=data['poId']).first()
     if not po:return err('PO not found',404)
     data={'purchaseOrder':po.pk,'vendor':po.vendor_id,'items':data.get('items') or [{'description':i.get('description'),'orderedQty':i.get('quantity'),'receivedQty':i.get('quantity'),'returnedQty':0,'isReturned':False} for i in po.items],'notes':data.get('notes','')}
     po.status='Completed';po.save()
    if resource=='rfqs' and request.method=='POST' and (not data.get('title') or not data.get('deadline') or not data.get('items')):return err('Title, deadline, and items are required')
    if resource=='vendors' and request.method=='POST' and any(not data.get(k) for k in ('name','company','email')):return err('Name, company, and email are required')
    if resource=='quotations' and request.method=='POST':
     if any(not data.get(k) for k in ('rfq','vendor','totalPrice')):return err('RFQ, vendor and totalPrice are required')
     old=Quotation.objects.filter(rfq_id=data['rfq'],vendor_id=data['vendor']).first()
     if old:obj=old
    if resource=='invoices':
     from decimal import Decimal,ROUND_HALF_UP
     subtotal=Decimal(str(data.get('subTotal',obj.subTotal if obj else 0)))
     rate=Decimal(str(data.get('gstRate',obj.gstRate if obj else 18)))
     gst=(subtotal*rate/100).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
     data['gstAmount']=float(gst);data['totalAmount']=float(subtotal+gst)
    if resource=='rfqs' and 'vendors' in data and isinstance(data['vendors'],list):
     data['vendors']=[v.get('_id') if isinstance(v,dict) else v for v in data['vendors']]
    serializer=ser(obj,data=data,partial=bool(obj))
    if not serializer.is_valid():return err(str(serializer.errors))
    created=obj is None
    saved=serializer.save()
    if created and resource in ('rfqs','purchase-orders','invoices'):
     prefix,field={'rfqs':('RFQ','rfqNumber'),'purchase-orders':('PO','poNumber'),'invoices':('INV','invoiceNumber')}[resource]
     number(saved,prefix,field)
    if resource=='quotations' and created:
     qs=Quotation.objects.filter(rfq=saved.rfq).order_by('totalPrice')
     qs.update(isLowest=False);first=qs.first()
     if first:Quotation.objects.filter(pk=first.pk).update(isLowest=True)
    return ok(serialize(resource,saved),code=201 if created else 200)
 except (ValueError,TypeError,IntegrityError) as ex:return err(str(ex))
