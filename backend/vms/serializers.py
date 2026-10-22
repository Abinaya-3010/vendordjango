from rest_framework import serializers
from .models import Vendor,RFQ,Quotation,PurchaseOrder,Invoice,Inventory
class CompatSerializer(serializers.ModelSerializer):
 _id=serializers.IntegerField(source='id',read_only=True)
 def to_representation(self,instance):
  d=super().to_representation(instance)
  for field in instance._meta.fields:
   if field.is_relation and field.name in d and d[field.name] is not None:
    rel=getattr(instance,field.name,None)
    if rel:
     sub={'_id':rel.pk}
     for k in ('name','company','email','phone','rating','title','rfqNumber','poNumber','totalPrice','status','description','items','deadline','validityDays','gst','pan','bankName','accountNumber','ifsc','address'):
      if hasattr(rel,k):
       v=getattr(rel,k)
       if hasattr(v,'isoformat'):v=v.isoformat()
       sub[k]=v
     d[field.name]=sub
  return d
class VendorSerializer(CompatSerializer):
 class Meta: model=Vendor;fields='__all__'
class RFQSerializer(CompatSerializer):
 class Meta: model=RFQ;fields='__all__'
 def to_representation(self,obj):
  d=super().to_representation(obj)
  d['vendors']=[{'_id':v.id,'name':v.name,'company':v.company,'email':v.email,'phone':v.phone} for v in obj.vendors.all()]
  return d
class QuotationSerializer(CompatSerializer):
 class Meta: model=Quotation;fields='__all__'
class POSerializer(CompatSerializer):
 class Meta: model=PurchaseOrder;fields='__all__'
class InvoiceSerializer(CompatSerializer):
 class Meta: model=Invoice;fields='__all__'
class InventorySerializer(CompatSerializer):
 class Meta: model=Inventory;fields='__all__'
