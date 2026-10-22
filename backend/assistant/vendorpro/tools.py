"""VendorPro domain tools: allowlisted, READ-ONLY, ORM-only. (Domain layer - not part of the reusable core.)

Security model
--------------
* The model can only name a tool registered in ``build_registry()`` and pass the arguments declared
  in that tool's schema; the generic ``ToolRegistry`` rejects everything else.
* Every handler uses the Django ORM with fixed filters. No raw SQL, no filesystem access, no dynamic
  field names, no model-controlled lookups.
* Every handler builds its output from an explicit field list. Bank details, IFSC, PAN, GST,
  addresses, document URLs and notes/terms are never returned.
* Result sizes are capped (``MAX_LIMIT``).
"""
from django.db.models import Count, Q
from django.utils import timezone

from vms.models import Inventory, Invoice, PurchaseOrder, Quotation, RFQ, Vendor

from ..core.tools import Param, Tool, ToolRegistry
from ..core.types import ToolError  # noqa: F401  (re-exported for callers/tests)

DEFAULT_LIMIT = 10
MAX_LIMIT = 25
MAX_STRING = 100
INVENTORY_SCAN_CAP = 500

# page key -> router path. The frontend re-checks against its own explicit allowlist and router.
NAV_PAGES = {
    'dashboard': '/',
    'vendors': '/vendors',
    'rfqs': '/rfqs',
    'quotations': '/quotations',
    'purchase-orders': '/purchase-orders',
    'invoices': '/invoices',
    'inventory': '/inventory',
}


# --------------------------------------------------------------------------- helpers
def _iso(v):
    return v.isoformat() if v is not None else None


def _limit(a):
    return a.get('limit', DEFAULT_LIMIT)


def _wrap(rows, limit, extra=None):
    out = {'count': min(len(rows), limit), 'truncated': len(rows) > limit, 'results': rows[:limit]}
    if extra:
        out.update(extra)
    return out


def _vendor_ref(v):
    return {'id': v.pk, 'name': v.name, 'company': v.company} if v else None


def _vendor_row(v):
    # Deliberately excludes gst, pan, bankName, accountNumber, ifsc, address, documentUrl.
    return {'id': v.pk, 'name': v.name, 'company': v.company, 'email': v.email, 'phone': v.phone,
            'category': v.category, 'status': v.status, 'rating': v.rating}


def _rfq_row(r, with_items=False):
    d = {'id': r.pk, 'rfqNumber': r.rfqNumber, 'title': r.title, 'status': r.status,
         'deadline': _iso(r.deadline), 'vendorCount': r.vendors.count() if r.pk else 0}
    if with_items:
        d['items'] = _items(r.items)
        d['vendors'] = [_vendor_ref(v) for v in r.vendors.all()[:MAX_LIMIT]]
    return d


def _items(raw, cap=20):
    out = []
    if isinstance(raw, list):
        for i in raw[:cap]:
            if isinstance(i, dict):
                out.append({k: i.get(k) for k in ('description', 'quantity', 'unit') if k in i})
    return out


def _quotation_row(q):
    return {'id': q.pk, 'rfqId': q.rfq_id, 'rfqNumber': q.rfq.rfqNumber, 'rfqTitle': q.rfq.title,
            'vendor': _vendor_ref(q.vendor), 'totalPrice': q.totalPrice, 'deliveryDays': q.deliveryDays,
            'validityDays': q.validityDays, 'status': q.status, 'isLowest': q.isLowest}


def _po_row(p):
    return {'id': p.pk, 'poNumber': p.poNumber, 'vendor': _vendor_ref(p.vendor), 'totalAmount': p.totalAmount,
            'status': p.status, 'deliveryDate': _iso(p.deliveryDate),
            'rfqNumber': p.rfq.rfqNumber if p.rfq else None}


def _invoice_row(i, now):
    overdue = bool(i.dueDate and i.dueDate < now and i.status not in ('Paid', 'Cancelled'))
    return {'id': i.pk, 'invoiceNumber': i.invoiceNumber, 'poNumber': i.purchaseOrder.poNumber,
            'vendor': _vendor_ref(i.vendor), 'totalAmount': i.totalAmount, 'status': i.status,
            'dueDate': _iso(i.dueDate), 'paidDate': _iso(i.paidDate), 'isOverdue': overdue}


def _num(v):
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return v
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


# --------------------------------------------------------------------------- handlers
def describe_data(a):
    def statuses(model):
        return {r['status']: r['n'] for r in model.objects.values('status').annotate(n=Count('id')).order_by('status')}
    return {
        'vendors': {'total': Vendor.objects.count(), 'byStatus': statuses(Vendor)},
        'rfqs': {'total': RFQ.objects.count(), 'byStatus': statuses(RFQ)},
        'quotations': {'total': Quotation.objects.count(), 'byStatus': statuses(Quotation)},
        'purchaseOrders': {'total': PurchaseOrder.objects.count(), 'byStatus': statuses(PurchaseOrder)},
        'invoices': {'total': Invoice.objects.count(), 'byStatus': statuses(Invoice)},
        'inventoryRecords': {'total': Inventory.objects.count()},
    }


def search_vendors(a):
    qs = Vendor.objects.all().order_by('name', 'id')
    if a.get('name'):
        s = a['name']
        qs = qs.filter(Q(name__icontains=s) | Q(company__icontains=s))
    if a.get('category'):
        qs = qs.filter(category__iexact=a['category'])
    if a.get('status'):
        qs = qs.filter(status__iexact=a['status'])
    lim = _limit(a)
    return _wrap([_vendor_row(v) for v in qs[:lim + 1]], lim, {'total': qs.count()})


def get_vendor(a):
    v = Vendor.objects.filter(pk=a['vendor_id']).first()
    if not v:
        return {'found': False, 'message': f'No vendor with id {a["vendor_id"]}.'}
    return {'found': True, 'vendor': _vendor_row(v)}


def list_rfqs(a):
    qs = RFQ.objects.all().order_by('-createdAt', '-id')
    if a.get('status'):
        qs = qs.filter(status__iexact=a['status'])
    if a.get('title'):
        qs = qs.filter(Q(title__icontains=a['title']) | Q(rfqNumber__icontains=a['title']))
    lim = _limit(a)
    return _wrap([_rfq_row(r) for r in qs[:lim + 1]], lim, {'total': qs.count()})


def get_rfq(a):
    qs = RFQ.objects.all()
    if a.get('rfq_id') is not None:
        qs = qs.filter(pk=a['rfq_id'])
    elif a.get('rfq_number'):
        qs = qs.filter(rfqNumber__iexact=a['rfq_number'])
    else:
        raise ToolError('Provide rfq_id or rfq_number.')
    r = qs.first()
    if not r:
        return {'found': False, 'message': 'RFQ not found.'}
    return {'found': True, 'rfq': _rfq_row(r, with_items=True)}


def list_quotations(a):
    qs = Quotation.objects.select_related('rfq', 'vendor').order_by('totalPrice', 'id')
    if a.get('rfq_id') is not None:
        qs = qs.filter(rfq_id=a['rfq_id'])
    if a.get('rfq_number'):
        qs = qs.filter(rfq__rfqNumber__iexact=a['rfq_number'])
    if a.get('vendor_id') is not None:
        qs = qs.filter(vendor_id=a['vendor_id'])
    if a.get('status'):
        qs = qs.filter(status__iexact=a['status'])
    lim = _limit(a)
    return _wrap([_quotation_row(q) for q in qs[:lim + 1]], lim, {'total': qs.count()})


def list_purchase_orders(a):
    qs = PurchaseOrder.objects.select_related('vendor', 'rfq').order_by('-createdAt', '-id')
    if a.get('status'):
        qs = qs.filter(status__iexact=a['status'])
    if a.get('vendor_id') is not None:
        qs = qs.filter(vendor_id=a['vendor_id'])
    if a.get('po_number'):
        qs = qs.filter(poNumber__iexact=a['po_number'])
    lim = _limit(a)
    return _wrap([_po_row(p) for p in qs[:lim + 1]], lim, {'total': qs.count()})


def list_invoices(a):
    now = timezone.now()
    qs = Invoice.objects.select_related('vendor', 'purchaseOrder').order_by('dueDate', 'id')
    if a.get('status'):
        qs = qs.filter(status__iexact=a['status'])
    if a.get('vendor_id') is not None:
        qs = qs.filter(vendor_id=a['vendor_id'])
    if a.get('overdue_only'):
        qs = qs.filter(dueDate__isnull=False, dueDate__lt=now).exclude(status__in=['Paid', 'Cancelled'])
    lim = _limit(a)
    return _wrap([_invoice_row(i, now) for i in qs[:lim + 1]], lim,
                 {'total': qs.count(), 'asOf': _iso(now)})


def list_inventory_items(a):
    threshold = a.get('low_stock_threshold', 10)
    low_only = a.get('low_stock_only', False)
    text = a.get('description', '').lower()
    lim = _limit(a)
    rows, scanned = [], 0
    qs = Inventory.objects.select_related('vendor', 'purchaseOrder').order_by('-createdAt', '-id')[:INVENTORY_SCAN_CAP]
    for inv in qs:
        scanned += 1
        if not isinstance(inv.items, list):
            continue
        for it in inv.items:
            if not isinstance(it, dict):
                continue
            desc = str(it.get('description') or '')
            if text and text not in desc.lower():
                continue
            received, returned = _num(it.get('receivedQty')), _num(it.get('returnedQty'))
            available = received - returned
            if low_only and available > threshold:
                continue
            rows.append({'inventoryId': inv.pk, 'description': desc[:200], 'receivedQty': received,
                         'returnedQty': returned, 'availableQty': available,
                         'poNumber': inv.purchaseOrder.poNumber, 'vendor': _vendor_ref(inv.vendor)})
    rows.sort(key=lambda r: r['availableQty'])
    return _wrap(rows[:lim + 1], lim, {
        'lowStockThreshold': threshold if low_only else None,
        'note': ('availableQty = receivedQty - returnedQty from received-goods records; the system has no '
                 'stock-issued or reorder-level data.'),
        'recordsScanned': scanned,
    })


def navigate(a):
    page = a['page']
    return {'navigated': True, 'page': page, 'path': NAV_PAGES[page]}


def open_vendor_form(a):
    allowed_fields = ('name', 'company', 'email', 'phone', 'category', 'address')
    fields = {k: a[k] for k in allowed_fields if a.get(k)}
    return {'opened': True, 'page': 'vendors', 'path': NAV_PAGES['vendors'], 'fields': fields}


# --------------------------------------------------------------------------- registry
def _navigate_action(out):
    return {'type': 'navigate', 'page': out['page'], 'path': out['path']}


def _open_vendor_form_action(out):
    return {'type': 'open_vendor_form', 'page': out['page'], 'path': out['path'], 'fields': out['fields']}


_L = Param('integer', f'Max rows to return (default {DEFAULT_LIMIT}, max {MAX_LIMIT}).',
           minimum=1, maximum=MAX_LIMIT, clamp=True)
_S = lambda d: Param('string', d)  # noqa: E731
_I = lambda d: Param('integer', d, minimum=1)  # noqa: E731

_TOOLS = [
    Tool('describe_data', 'Counts of records per module and the status values actually used. Call this first '
         'when you are unsure which status values exist (e.g. what "pending" maps to).', {}, describe_data),
    Tool('search_vendors', 'Find vendors by name/company text, category or status.',
         {'name': _S('Text to match in vendor name or company.'), 'category': _S('Vendor category.'),
          'status': _S('Vendor status.'), 'limit': _L}, search_vendors),
    Tool('get_vendor', 'Get one vendor by numeric id.', {'vendor_id': _I('Vendor id.')}, get_vendor,
         required=('vendor_id',)),
    Tool('list_rfqs', 'List RFQs, optionally by status or title/RFQ-number text.',
         {'status': _S('RFQ status (e.g. Draft, Sent, Closed).'), 'title': _S('Text in title or RFQ number.'),
          'limit': _L}, list_rfqs),
    Tool('get_rfq', 'Get one RFQ with its items and invited vendors, by id or RFQ number.',
         {'rfq_id': _I('RFQ id.'), 'rfq_number': _S('RFQ number, e.g. RFQ-0001.')}, get_rfq),
    Tool('list_quotations', 'List quotations (cheapest first) for an RFQ and/or vendor and/or status.',
         {'rfq_id': _I('RFQ id.'), 'rfq_number': _S('RFQ number.'), 'vendor_id': _I('Vendor id.'),
          'status': _S('Quotation status (e.g. Submitted, Selected, Rejected).'), 'limit': _L}, list_quotations),
    Tool('list_purchase_orders', 'List purchase orders by status, vendor id or PO number.',
         {'status': _S('PO status (e.g. Pending, Approved, Rejected, Completed).'),
          'vendor_id': _I('Vendor id.'), 'po_number': _S('PO number, e.g. PO-0001.'), 'limit': _L},
         list_purchase_orders),
    Tool('list_invoices', 'List invoices by status/vendor. Set overdue_only to get invoices past their due date '
         'that are not Paid or Cancelled.',
         {'status': _S('Invoice status (e.g. Pending, Paid, Cancelled).'), 'vendor_id': _I('Vendor id.'),
          'overdue_only': Param('boolean', 'Only overdue invoices.'), 'limit': _L}, list_invoices),
    Tool('list_inventory_items', 'List received inventory line items; can filter low stock or text.',
         {'description': _S('Text in item description.'),
          'low_stock_only': Param('boolean', 'Only items at or below the threshold.'),
          'low_stock_threshold': Param('integer', 'Quantity threshold for low stock (default 10).',
                                       minimum=0, maximum=1000000),
          'limit': _L}, list_inventory_items),
    Tool('navigate', 'Open one page of the application. Only the listed pages exist.',
         {'page': Param('string', 'Page to open.', enum=tuple(NAV_PAGES))}, navigate, required=('page',),
         to_action=_navigate_action),
    Tool('open_vendor_form', 'Open the Add Vendor form dialog on the Vendors page, optionally pre-filling '
         'fields (name, company, email, phone, category, address) provided by the user. Does not save to database.',
         {
             'name': _S('Vendor contact name.'),
             'company': _S('Vendor company name.'),
             'email': _S('Vendor email address.'),
             'phone': _S('Vendor phone number.'),
             'category': _S('Vendor category.'),
             'address': _S('Vendor physical address.'),
         },
         open_vendor_form,
         to_action=_open_vendor_form_action),
]


def build_registry() -> ToolRegistry:
    return ToolRegistry(_TOOLS, max_string=MAX_STRING)
