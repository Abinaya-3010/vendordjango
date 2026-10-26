
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    Vendor,
    RFQ,
    Quotation,
    PurchaseOrder,
    Invoice,
    Inventory,
)
from .serializers import (
    VendorSerializer,
    RFQSerializer,
    QuotationSerializer,
    POSerializer,
    InvoiceSerializer,
    InventorySerializer,
)


REG = {
    "vendors": (Vendor, VendorSerializer),
    "rfqs": (RFQ, RFQSerializer),
    "quotations": (Quotation, QuotationSerializer),
    "purchase-orders": (PurchaseOrder, POSerializer),
    "invoices": (Invoice, InvoiceSerializer),
    "inventory": (Inventory, InventorySerializer),
}


def ok(data=None, message=None, code=200):
    result = {"success": True}

    if data is not None:
        result["data"] = data

    if message:
        result["message"] = message

    return Response(result, status=code)


def err(message, code=400):
    return Response(
        {"success": False, "message": message},
        status=code,
    )


def number(obj, prefix, field):
    # Use the database-generated primary key for the display number.
    setattr(obj, field, f"{prefix}-{obj.pk:04d}")
    obj.save(update_fields=[field])


def serialize(resource, obj):
    serializer_class = REG[resource][1]
    return serializer_class(obj).data


def input_data(request):
    return request.data.copy()


def relationship_id(value):
    """Accept either a relationship ID or a serialized relationship object."""
    if isinstance(value, dict):
        return value.get("_id") or value.get("id") or value.get("pk")

    return value


def relationship_value(data, key):
    """Normalize a relationship field without changing other submitted data."""
    if key in data:
        data[key] = relationship_id(data[key])

    return data


def get_related(model, value, label):
    value = relationship_id(value)

    if value in (None, ""):
        return None

    try:
        obj = model.objects.filter(pk=value).first()
    except (ValueError, TypeError):
        obj = None

    if obj is None:
        raise ValueError(f"{label} not found")

    return obj


@api_view(["GET", "POST", "PUT", "PATCH", "DELETE"])
def endpoint(request, resource, pk=None, action=None):
    if resource not in REG:
        return err("Unknown resource", 404)

    model, serializer_class = REG[resource]

    try:
        with transaction.atomic():
            obj = (
                model.objects.filter(pk=pk).first()
                if pk is not None
                else None
            )

            if (
                pk is not None
                and obj is None
                and action != "compare"
            ):
                return err("Not found", 404)

            # ---------------------------------------------------------
            # Vendor document upload
            # ---------------------------------------------------------
            if (
                action == "upload"
                and resource == "vendors"
                and request.method == "POST"
            ):
                uploaded_file = request.FILES.get("document")

                if not uploaded_file:
                    return err("No file uploaded")

                media_path = Path(settings.MEDIA_ROOT)
                media_path.mkdir(parents=True, exist_ok=True)

                filename = (
                    f"{uuid.uuid4().hex}"
                    f"{Path(uploaded_file.name).suffix}"
                )

                with (media_path / filename).open("wb") as target:
                    for chunk in uploaded_file.chunks():
                        target.write(chunk)

                obj.documentUrl = f"/uploads/{filename}"
                obj.save()

                return ok(serialize(resource, obj))

            # ---------------------------------------------------------
            # Send RFQ to selected vendors
            # ---------------------------------------------------------
            if (
                action == "send"
                and resource == "rfqs"
                and request.method == "POST"
            ):
                vendor_ids = request.data.get("vendorIds", [])

                if not isinstance(vendor_ids, list):
                    return err("vendorIds must be a list")

                valid_vendors = Vendor.objects.filter(pk__in=vendor_ids)

                if valid_vendors.count() != len(set(map(str, vendor_ids))):
                    # Check IDs individually below to support string PKs
                    # and avoid silently ignoring invalid vendor IDs.
                    valid_ids = {str(v.pk) for v in valid_vendors}
                    requested_ids = {str(v) for v in vendor_ids}

                    if valid_ids != requested_ids:
                        return err("One or more vendors were not found")

                obj.vendors.set(valid_vendors)
                obj.status = "Sent"
                obj.save()

                return ok(
                    serialize(resource, obj),
                    "RFQ sent to vendors",
                )

            # ---------------------------------------------------------
            # Status updates
            # ---------------------------------------------------------
            if (
                action == "status"
                and request.method == "PATCH"
            ):
                new_status = request.data.get("status", obj.status)

                obj.status = new_status

                if resource == "invoices" and new_status == "Paid":
                    obj.paidDate = timezone.now()

                obj.save()

                return ok(serialize(resource, obj))

            # ---------------------------------------------------------
            # Select a quotation
            # ---------------------------------------------------------
            if (
                action == "select"
                and resource == "quotations"
                and request.method == "POST"
            ):
                with transaction.atomic():
                    Quotation.objects.filter(
                        rfq=obj.rfq
                    ).exclude(pk=obj.pk).update(status="Rejected")

                    obj.status = "Selected"
                    obj.save()

                    obj.rfq.status = "Closed"
                    obj.rfq.save()

                return ok(serialize(resource, obj))

            # ---------------------------------------------------------
            # Compare quotations for an RFQ
            # ---------------------------------------------------------
            if (
                action == "compare"
                and resource == "quotations"
                and request.method == "GET"
            ):
                rfq = RFQ.objects.filter(pk=pk).first()

                if not rfq:
                    return err("RFQ not found", 404)

                quotations = Quotation.objects.filter(
                    rfq=rfq
                ).order_by("totalPrice")

                return ok({
                    "rfq": serialize("rfqs", rfq),
                    "quotations": [
                        serialize("quotations", quotation)
                        for quotation in quotations
                    ],
                })

            # ---------------------------------------------------------
            # GET one or all records
            # ---------------------------------------------------------
            if request.method == "GET":
                if obj:
                    return ok(serialize(resource, obj))

                queryset = model.objects.all().order_by("-createdAt")

                for key in ("category", "status", "vendor", "rfq"):
                    if (
                        request.query_params.get(key)
                        and key in [
                            field.name
                            for field in model._meta.fields
                        ]
                    ):
                        queryset = queryset.filter(
                            **{key: request.query_params[key]}
                        )

                if resource == "vendors" and request.query_params.get("search"):
                    search_term = request.query_params["search"]

                    queryset = queryset.filter(
                        Q(name__icontains=search_term)
                        | Q(company__icontains=search_term)
                        | Q(email__icontains=search_term)
                    )

                if resource == "quotations":
                    queryset = queryset.order_by("totalPrice")

                return ok([
                    serialize(resource, record)
                    for record in queryset
                ])

            # ---------------------------------------------------------
            # DELETE
            # ---------------------------------------------------------
            if request.method == "DELETE":
                if obj:
                    obj.delete()

                return ok(message=f"{resource} deleted")

            # ---------------------------------------------------------
            # CREATE / UPDATE
            # ---------------------------------------------------------
            if request.method in ("POST", "PUT", "PATCH"):
                data = input_data(request)

                # Normalize relationship values sent as serialized objects.
                for field in (
                    "rfq",
                    "vendor",
                    "quotation",
                    "purchaseOrder",
                ):
                    relationship_value(data, field)

                # -----------------------------------------------------
                # Purchase Order: derive values from selected quotation
                # Frontend should send quotationId.
                # -----------------------------------------------------
                if (
                    resource == "purchase-orders"
                    and data.get("quotationId")
                ):
                    quotation = get_related(
                        Quotation,
                        data.get("quotationId"),
                        "Quotation",
                    )

                    data = {
                        "rfq": quotation.rfq_id,
                        "quotation": quotation.pk,
                        "vendor": quotation.vendor_id,
                        "items": quotation.items,
                        "totalAmount": quotation.totalPrice,
                        "deliveryDate": data.get("deliveryDate"),
                        "notes": data.get("notes", ""),
                    }

                # -----------------------------------------------------
                # Invoice: derive vendor/items/subtotal from selected PO
                # Preserve the user-selected GST rate and due date.
                # Frontend should send poId.
                # -----------------------------------------------------
                if (
                    resource == "invoices"
                    and data.get("poId")
                ):
                    purchase_order = get_related(
                        PurchaseOrder,
                        data.get("poId"),
                        "Purchase Order",
                    )

                    submitted_gst_rate = data.get("gstRate", 18)
                    submitted_due_date = data.get("dueDate")

                    data = {
                        "purchaseOrder": purchase_order.pk,
                        "vendor": purchase_order.vendor_id,
                        "items": purchase_order.items,
                        "subTotal": purchase_order.totalAmount,
                        "gstRate": submitted_gst_rate,
                        "dueDate": submitted_due_date or None,
                    }

                # -----------------------------------------------------
                # Inventory: derive PO relationship and vendor
                # Keep inventory item quantities if the UI submitted them.
                # Frontend should send poId.
                # -----------------------------------------------------
                if (
                    resource == "inventory"
                    and data.get("poId")
                ):
                    purchase_order = get_related(
                        PurchaseOrder,
                        data.get("poId"),
                        "Purchase Order",
                    )

                    submitted_items = data.get("items")

                    if not submitted_items:
                        submitted_items = [
                            {
                                "description": item.get("description", ""),
                                "orderedQty": item.get("quantity", 0),
                                "receivedQty": 0,
                                "returnedQty": 0,
                                "isReturned": False,
                            }
                            for item in (purchase_order.items or [])
                        ]

                    data = {
                        "purchaseOrder": purchase_order.pk,
                        "vendor": purchase_order.vendor_id,
                        "items": submitted_items,
                        "notes": data.get("notes", ""),
                    }

                    # Do not mark the PO Completed just because an
                    # inventory record was created. Status should be
                    # changed explicitly when the receiving process ends.

                # -----------------------------------------------------
                # RFQ required fields
                # -----------------------------------------------------
                if resource == "rfqs" and request.method == "POST":
                    if (
                        not data.get("title")
                        or not data.get("deadline")
                        or not data.get("items")
                    ):
                        return err(
                            "Title, deadline, and items are required"
                        )

                # -----------------------------------------------------
                # Vendor required fields
                # -----------------------------------------------------
                if resource == "vendors" and request.method == "POST":
                    if any(
                        not data.get(field)
                        for field in ("name", "company", "email")
                    ):
                        return err(
                            "Name, company, and email are required"
                        )

                # -----------------------------------------------------
                # Quotation: validate RFQ and Vendor relationships
                # -----------------------------------------------------
                if resource == "quotations":
                    if request.method == "POST":
                        if any(
                            data.get(field) in (None, "")
                            for field in (
                                "rfq",
                                "vendor",
                                "totalPrice",
                            )
                        ):
                            return err(
                                "RFQ, vendor and totalPrice are required"
                            )

                    if data.get("rfq") not in (None, ""):
                        rfq = get_related(
                            RFQ,
                            data["rfq"],
                            "RFQ",
                        )
                        data["rfq"] = rfq.pk

                    if data.get("vendor") not in (None, ""):
                        vendor = get_related(
                            Vendor,
                            data["vendor"],
                            "Vendor",
                        )
                        data["vendor"] = vendor.pk

                    # Avoid creating duplicate quotations for the same
                    # RFQ/vendor pair. Existing record is updated instead.
                    if (
                        request.method == "POST"
                        and not obj
                        and data.get("rfq")
                        and data.get("vendor")
                    ):
                        obj = Quotation.objects.filter(
                            rfq_id=data["rfq"],
                            vendor_id=data["vendor"],
                        ).first()

                # -----------------------------------------------------
                # Invoice: calculate GST from subtotal and rate
                # -----------------------------------------------------
                if resource == "invoices":
                    subtotal_value = data.get(
                        "subTotal",
                        obj.subTotal if obj else 0,
                    )
                    rate_value = data.get(
                        "gstRate",
                        obj.gstRate if obj else 18,
                    )

                    subtotal = Decimal(str(subtotal_value or 0))
                    rate = Decimal(str(rate_value or 0))

                    if subtotal < 0 or rate < 0:
                        return err(
                            "Subtotal and GST rate cannot be negative"
                        )

                    gst_amount = (
                        subtotal * rate / Decimal("100")
                    ).quantize(
                        Decimal("0.01"),
                        rounding=ROUND_HALF_UP,
                    )

                    data["subTotal"] = float(subtotal)
                    data["gstRate"] = float(rate)
                    data["gstAmount"] = float(gst_amount)
                    data["totalAmount"] = float(
                        subtotal + gst_amount
                    )

                # -----------------------------------------------------
                # RFQ vendor IDs
                # -----------------------------------------------------
                if (
                    resource == "rfqs"
                    and "vendors" in data
                    and isinstance(data["vendors"], list)
                ):
                    data["vendors"] = [
                        relationship_id(vendor)
                        for vendor in data["vendors"]
                    ]

                # -----------------------------------------------------
                # Save using the existing serializer and schema
                # -----------------------------------------------------
                serializer = serializer_class(
                    obj,
                    data=data,
                    partial=bool(obj) or request.method == "PATCH",
                )

                if not serializer.is_valid():
                    return err(str(serializer.errors))

                created = obj is None
                saved = serializer.save()

                if created and resource in (
                    "rfqs",
                    "purchase-orders",
                    "invoices",
                ):
                    prefix, number_field = {
                        "rfqs": ("RFQ", "rfqNumber"),
                        "purchase-orders": ("PO", "poNumber"),
                        "invoices": ("INV", "invoiceNumber"),
                    }[resource]

                    number(saved, prefix, number_field)

                # Recalculate the lowest quotation marker after a
                # quotation is created or updated.
                if resource == "quotations":
                    quotations = Quotation.objects.filter(
                        rfq=saved.rfq
                    ).order_by("totalPrice")

                    quotations.update(isLowest=False)

                    lowest = quotations.first()

                    if lowest:
                        Quotation.objects.filter(
                            pk=lowest.pk
                        ).update(isLowest=True)

                return ok(
                    serialize(resource, saved),
                    code=201 if created else 200,
                )

            return err("Method not allowed", 405)

    except ValueError as exc:
        return err(str(exc), 400)

    except (TypeError, IntegrityError) as exc:
        return err(str(exc), 400)
