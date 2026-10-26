
<template>
  <q-page padding>
    <div class="row items-center justify-between q-mb-lg">
      <h4 class="q-my-md">{{ title }}</h4>
      <q-btn
        v-if="editable"
        color="deep-purple"
        icon="add"
        :label="'Add ' + singular"
        @click="openCreate"
      />
    </div>

    <q-banner
      v-if="error"
      class="bg-negative text-white q-mb-md"
      rounded
    >
      {{ error }}
    </q-banner>

    <q-input
      v-if="resource === 'vendors'"
      v-model="search"
      dark
      outlined
      dense
      debounce="250"
      label="Search vendors"
      placeholder="Search by vendor name or company"
      class="q-mb-md"
      @update:model-value="load"
    />

    <q-table
      :rows="rows"
      :columns="columns"
      row-key="_id"
      :loading="loading"
      dark
      flat
      bordered
    >
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn
            dense
            flat
            icon="visibility"
            aria-label="View details"
            @click="detail = props.row"
          />

          <q-btn
            v-if="editable"
            dense
            flat
            icon="edit"
            aria-label="Edit record"
            @click="edit(props.row)"
          />

          <q-btn
            v-if="deletable"
            dense
            flat
            color="negative"
            icon="delete"
            aria-label="Delete record"
            @click="del(props.row)"
          />

          <q-btn
            v-if="resource === 'rfqs'"
            dense
            flat
            color="primary"
            label="Send"
            @click="send(props.row)"
          />

          <q-btn
            v-if="resource === 'quotations'"
            dense
            flat
            color="positive"
            label="Select"
            @click="selectQ(props.row)"
          />

          <q-btn
            v-if="['purchase-orders', 'invoices'].includes(resource)"
            dense
            flat
            color="primary"
            label="Status"
            @click="statusChange(props.row)"
          />
        </q-td>
      </template>
    </q-table>

    <!-- Create / Edit form -->
    <q-dialog v-model="dialog" persistent>
      <q-card style="width: 700px; max-width: 95vw">
        <q-card-section class="text-h6">
          {{ editing ? 'Edit' : 'Create' }} {{ singular }}
        </q-card-section>

        <q-banner
          v-if="formError"
          class="bg-negative text-white q-mx-md"
          rounded
        >
          {{ formError }}
        </q-banner>

        <q-card-section
          class="q-gutter-md"
          style="max-height: 70vh; overflow-y: auto"
        >
          <template v-for="field in fields" :key="field">
            <!-- RFQ deadline uses DD/MM/YYYY -->
            <q-input
              v-if="resource === 'rfqs' && field === 'deadline'"
              :model-value="form.deadline || ''"
              dark
              outlined
              readonly
              stack-label
              label="Deadline"
              placeholder="DD/MM/YYYY"
              hint="Select the RFQ deadline"
              :error="!!fieldErrors.deadline"
              :error-message="fieldErrors.deadline"
            >
              <template #append>
                <q-icon name="event" class="cursor-pointer">
                  <q-popup-proxy
                    cover
                    transition-show="scale"
                    transition-hide="scale"
                  >
                    <q-date
                      v-model="form.deadline"
                      mask="DD/MM/YYYY"
                      minimal
                    >
                      <div class="row justify-end">
                        <q-btn
                          v-close-popup
                          flat
                          color="deep-purple"
                          label="Done"
                        />
                      </div>
                    </q-date>
                  </q-popup-proxy>
                </q-icon>
              </template>
            </q-input>

            <!-- Purchase Order delivery date -->
            <q-input
              v-else-if="
                resource === 'purchase-orders' &&
                field === 'deliveryDate'
              "
              v-model="form.deliveryDate"
              dark
              outlined
              type="date"
              stack-label
              label="Delivery Date"
              hint="Select the expected delivery date"
              :error="!!fieldErrors.deliveryDate"
              :error-message="fieldErrors.deliveryDate"
            >
              <template #prepend>
                <q-icon name="event" />
              </template>
            </q-input>

            <!-- Invoice due date: send YYYY-MM-DD -->
            <q-input
              v-else-if="
                resource === 'invoices' &&
                field === 'dueDate'
              "
              v-model="form.dueDate"
              dark
              outlined
              type="date"
              stack-label
              label="Due Date"
              hint="Select the invoice due date"
              :error="!!fieldErrors.dueDate"
              :error-message="fieldErrors.dueDate"
            >
              <template #prepend>
                <q-icon name="event" />
              </template>
            </q-input>

            <!-- Numeric fields -->
            <q-input
              v-else-if="numericFields.includes(field)"
              v-model.number="form[field]"
              dark
              outlined
              type="number"
              :label="labelFor(field)"
              :placeholder="placeholderFor(field)"
              :step="decimalFields.includes(field) ? '0.01' : '1'"
              :min="minFor(field)"
              :error="!!fieldErrors[field]"
              :error-message="fieldErrors[field]"
            />

            <!-- Other fields -->
            <q-input
              v-else
              v-model="form[field]"
              dark
              outlined
              :label="labelFor(field)"
              :placeholder="placeholderFor(field)"
              :type="inputTypeFor(field)"
              :error="!!fieldErrors[field]"
              :error-message="fieldErrors[field]"
              :autocomplete="autocompleteFor(field)"
            />
          </template>

          <!-- Items -->
          <div v-if="hasItems" class="q-mt-lg">
            <div class="text-h6 q-mb-md">
              {{ singular }} Items
            </div>

            <div
              v-for="(item, index) in itemRows"
              :key="index"
              class="q-pa-md q-mb-md"
              style="border: 1px solid #777; border-radius: 8px"
            >
              <div class="row items-center justify-between q-mb-md">
                <div class="text-subtitle1">
                  Item {{ index + 1 }}
                </div>

                <q-btn
                  flat
                  dense
                  color="negative"
                  icon="delete"
                  aria-label="Remove item"
                  :disable="itemRows.length === 1"
                  @click="removeItem(index)"
                />
              </div>

              <q-input
                v-model="item.description"
                dark
                outlined
                label="Item Description"
                placeholder="e.g. Office chairs"
                class="q-mb-md"
                :error="!!itemErrors[index]?.description"
                :error-message="itemErrors[index]?.description || ''"
              />

              <template v-if="resource !== 'inventory'">
                <q-input
                  v-model.number="item.quantity"
                  dark
                  outlined
                  type="number"
                  min="1"
                  step="1"
                  label="Quantity"
                  placeholder="e.g. 10"
                  class="q-mb-md"
                  :error="!!itemErrors[index]?.quantity"
                  :error-message="itemErrors[index]?.quantity || ''"
                />

                <template v-if="resource !== 'rfqs'">
                  <q-input
                    v-model.number="item.unitPrice"
                    dark
                    outlined
                    type="number"
                    min="0"
                    step="0.01"
                    label="Unit Price"
                    placeholder="e.g. 1250.00"
                    prefix="₹"
                    class="q-mb-md"
                    :error="!!itemErrors[index]?.unitPrice"
                    :error-message="itemErrors[index]?.unitPrice || ''"
                  />

                  <div class="text-weight-medium">
                    Item Total: ₹{{ money(itemTotal(item)) }}
                  </div>
                </template>
              </template>

              <template v-else>
                <q-input
                  v-model.number="item.orderedQty"
                  dark
                  outlined
                  type="number"
                  min="0"
                  step="1"
                  label="Ordered Quantity"
                  placeholder="e.g. 10"
                  class="q-mb-md"
                />

                <q-input
                  v-model.number="item.receivedQty"
                  dark
                  outlined
                  type="number"
                  min="0"
                  step="1"
                  label="Received Quantity"
                  placeholder="e.g. 8"
                  class="q-mb-md"
                />

                <q-input
                  v-model.number="item.returnedQty"
                  dark
                  outlined
                  type="number"
                  min="0"
                  step="1"
                  label="Returned Quantity"
                  placeholder="e.g. 1"
                  class="q-mb-md"
                />

                <q-checkbox
                  v-model="item.isReturned"
                  dark
                  label="Item Returned"
                />
              </template>
            </div>

            <q-btn
              outline
              color="deep-purple"
              icon="add"
              label="Add Item"
              @click="addItem"
            />

            <div v-if="isPricedResource" class="text-h6 q-mt-lg">
              Grand Total: ₹{{ money(grandTotal) }}
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            flat
            label="Cancel"
            :disable="saving"
            @click="closeForm"
          />

          <q-btn
            color="deep-purple"
            label="Save"
            :loading="saving"
            :disable="saving"
            @click="save"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Details -->
    <q-dialog
      :model-value="!!detail"
      @update:model-value="detail = null"
    >
      <q-card style="min-width: min(600px, 90vw)">
        <q-card-section class="text-h6">
          Details
        </q-card-section>

        <q-card-section>
          <pre
            style="white-space: pre-wrap; overflow-wrap: anywhere"
          >{{ JSON.stringify(detail, null, 2) }}</pre>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" @click="detail = null" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted
} from 'vue';

import { useQuasar } from 'quasar';
import { API, getAll, create, update, remove } from '../api';

import {
  registerFormController,
  VENDOR_FORM
} from '../voice/adapters/vendorpro/formBridge.js';

const props = defineProps({
  resource: {
    type: String,
    required: true
  }
});

const $q = useQuasar();

const rows = ref([]);
const error = ref('');
const formError = ref('');
const fieldErrors = ref({});
const itemErrors = ref([]);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const editing = ref(null);
const detail = ref(null);
const form = ref({});
const search = ref('');
const itemRows = ref([]);

const labels = {
  vendors: 'Vendors',
  rfqs: 'RFQs',
  quotations: 'Quotations',
  'purchase-orders': 'Purchase Orders',
  invoices: 'Invoices',
  inventory: 'Inventory'
};

const fieldMap = {
  vendors: [
    'name', 'company', 'email', 'phone',
    'gst', 'pan', 'category', 'bankName',
    'accountNumber', 'ifsc', 'rating',
    'status', 'address'
  ],
  rfqs: [
    'title', 'description', 'deadline', 'status'
  ],
  quotations: [
    'rfq', 'vendor', 'validityDays',
    'terms', 'deliveryDays'
  ],
  'purchase-orders': [
    'vendor', 'deliveryDate', 'notes'
  ],
  invoices: [
    'purchaseOrder', 'vendor', 'gstRate', 'dueDate'
  ],
  inventory: [
    'purchaseOrder', 'vendor', 'notes'
  ]
};

const numericFields = [
  'totalPrice', 'totalAmount', 'subTotal',
  'rating', 'validityDays', 'deliveryDays',
  'gstRate'
];

const decimalFields = [
  'totalPrice', 'totalAmount', 'subTotal',
  'gstRate', 'rating'
];

const title = computed(
  () => labels[props.resource] || props.resource
);

const singular = computed(() => {
  const names = {
    vendors: 'Vendor',
    rfqs: 'RFQ',
    quotations: 'Quotation',
    'purchase-orders': 'Purchase Order',
    invoices: 'Invoice',
    inventory: 'Inventory'
  };

  return names[props.resource] || props.resource;
});

const fields = computed(
  () => fieldMap[props.resource] || []
);

const editable = computed(() => true);

const deletable = computed(() =>
  ['vendors', 'rfqs', 'purchase-orders', 'invoices']
    .includes(props.resource)
);

const hasItems = computed(() =>
  [
    'rfqs', 'quotations', 'purchase-orders',
    'invoices', 'inventory'
  ].includes(props.resource)
);

const isPricedResource = computed(() =>
  ['quotations', 'purchase-orders', 'invoices']
    .includes(props.resource)
);

const columns = computed(() => {
  const first = {
    vendors: ['name', 'company', 'email', 'category', 'status'],
    rfqs: ['rfqNumber', 'title', 'deadline', 'status'],
    quotations: ['rfq', 'vendor', 'totalPrice', 'status'],
    'purchase-orders': [
      'poNumber', 'vendor', 'totalAmount', 'status'
    ],
    invoices: [
      'invoiceNumber', 'vendor', 'totalAmount', 'status'
    ],
    inventory: ['purchaseOrder', 'vendor', 'receivedDate']
  }[props.resource] || [];

  return [
    ...first.map(name => ({
      name,
      label: labelFor(name),
      field: row => {
        const value = row[name];

        if (typeof value === 'object' && value !== null) {
          return (
            value.name ||
            value.title ||
            value.poNumber ||
            value._id ||
            JSON.stringify(value)
          );
        }

        return value;
      },
      align: 'left',
      sortable: true
    })),
    {
      name: 'actions',
      label: 'Actions',
      field: '_id'
    }
  ];
});

// Human-readable labels and placeholders
function labelFor(field) {
  const overrides = {
    gst: 'GSTIN',
    pan: 'PAN',
    ifsc: 'IFSC Code',
    bankName: 'Bank Name',
    accountNumber: 'Account Number',
    rfq: 'RFQ',
    purchaseOrder: 'Purchase Order',
    validityDays: 'Validity (Days)',
    deliveryDays: 'Delivery (Days)',
    deliveryDate: 'Delivery Date',
    dueDate: 'Due Date',
    gstRate: 'GST Rate (%)',
    totalPrice: 'Total Price',
    totalAmount: 'Total Amount',
    subTotal: 'Subtotal'
  };

  if (overrides[field]) return overrides[field];

  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, character => character.toUpperCase());
}

function placeholderFor(field) {
  const placeholders = {
    name: 'e.g. ABC Enterprises',
    company: 'e.g. ABC Technologies Pvt Ltd',
    email: 'e.g. contact@example.com',
    phone: 'e.g. 9876543210',
    gst: 'Enter GSTIN',
    pan: 'Enter PAN',
    category: 'e.g. Electronics',
    bankName: 'Enter bank name',
    accountNumber: 'Enter account number',
    ifsc: 'e.g. SBIN0001234',
    rating: 'e.g. 4',
    status: 'Enter a valid status',
    address: 'Enter business address',
    title: 'e.g. Office equipment supply',
    description: 'Describe the requirement',
    rfq: 'Enter or select an existing RFQ ID',
    vendor: 'Enter or select an existing vendor ID',
    validityDays: 'e.g. 30',
    terms: 'e.g. Payment within 30 days',
    deliveryDays: 'e.g. 7',
    notes: 'Enter additional notes',
    purchaseOrder: 'Enter or select an existing PO ID',
    gstRate: 'e.g. 18',
    totalPrice: 'e.g. 25000.00',
    totalAmount: 'e.g. 25000.00',
    subTotal: 'e.g. 20000.00'
  };

  return placeholders[field] || `Enter ${labelFor(field)}`;
}

function inputTypeFor(field) {
  if (field === 'email') return 'email';
  if (field === 'phone') return 'tel';
  if (field === 'address' || field === 'notes' ||
      field === 'terms' || field === 'description') {
    return 'textarea';
  }

  return 'text';
}

function autocompleteFor(field) {
  if (field === 'email') return 'email';
  if (field === 'phone') return 'tel';
  if (field === 'name') return 'organization';

  return 'off';
}

function minFor(field) {
  if (field === 'rating') return 0;
  if (numericFields.includes(field)) return 0;

  return undefined;
}

// Item helpers
function blankItem() {
  if (props.resource === 'inventory') {
    return {
      description: '',
      orderedQty: 0,
      receivedQty: 0,
      returnedQty: 0,
      isReturned: false
    };
  }

  if (props.resource === 'rfqs') {
    return {
      description: '',
      quantity: 1
    };
  }

  return {
    description: '',
    quantity: 1,
    unitPrice: 0
  };
}

function addItem() {
  itemRows.value.push(blankItem());
  itemErrors.value.push({});
}

function removeItem(index) {
  if (itemRows.value.length <= 1) return;

  itemRows.value.splice(index, 1);
  itemErrors.value.splice(index, 1);
}

function itemTotal(item) {
  return Number(item.quantity || 0) *
    Number(item.unitPrice || 0);
}

const grandTotal = computed(() =>
  itemRows.value.reduce(
    (total, item) => total + itemTotal(item),
    0
  )
);

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];

  return items.map(item => {
    if (props.resource === 'inventory') {
      return {
        ...item,
        description: item.description || '',
        orderedQty: Number(item.orderedQty ?? 0),
        receivedQty: Number(item.receivedQty ?? 0),
        returnedQty: Number(item.returnedQty ?? 0),
        isReturned: Boolean(item.isReturned)
      };
    }

    if (props.resource === 'rfqs') {
      return {
        ...item,
        description: item.description || '',
        quantity: Number(item.quantity ?? 1)
      };
    }

    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(
      item.unitPrice ??
      (
        quantity > 0
          ? Number(item.totalPrice ?? 0) / quantity
          : 0
      )
    );

    return {
      ...item,
      description: item.description || '',
      quantity,
      unitPrice
    };
  });
}

function validateItems() {
  itemErrors.value = itemRows.value.map(() => ({}));

  if (itemRows.value.length === 0) {
    throw new Error('Please add at least one item');
  }

  for (let index = 0; index < itemRows.value.length; index++) {
    const item = itemRows.value[index];
    const number = index + 1;
    const itemError = itemErrors.value[index];

    if (!String(item.description || '').trim()) {
      itemError.description = 'Description is required';
      throw new Error(`Item ${number}: Description is required`);
    }

    if (props.resource === 'inventory') {
      for (const field of [
        'orderedQty', 'receivedQty', 'returnedQty'
      ]) {
        const value = Number(item[field]);

        if (
          item[field] === '' ||
          item[field] === null ||
          !Number.isInteger(value) ||
          value < 0
        ) {
          itemError[field] = 'Enter a non-negative whole number';
          throw new Error(
            `Item ${number}: ${field} must be a non-negative integer`
          );
        }
      }

      if (Number(item.receivedQty) > Number(item.orderedQty)) {
        itemError.receivedQty = 'Cannot exceed ordered quantity';
        throw new Error(
          `Item ${number}: Received quantity exceeds ordered quantity`
        );
      }

      if (Number(item.returnedQty) > Number(item.receivedQty)) {
        itemError.returnedQty = 'Cannot exceed received quantity';
        throw new Error(
          `Item ${number}: Returned quantity exceeds received quantity`
        );
      }

      continue;
    }

    const quantity = Number(item.quantity);

    if (
      item.quantity === '' ||
      item.quantity === null ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      itemError.quantity = 'Enter a positive whole number';
      throw new Error(
        `Item ${number}: Quantity must be a positive whole number`
      );
    }

    if (isPricedResource.value) {
      const price = Number(item.unitPrice);

      if (
        item.unitPrice === '' ||
        item.unitPrice === null ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        itemError.unitPrice = 'Enter a valid non-negative price';
        throw new Error(
          `Item ${number}: Enter a valid unit price`
        );
      }
    }
  }
}

function buildItems() {
  return itemRows.value.map(item => {
    const description = String(item.description).trim();

    if (props.resource === 'inventory') {
      return {
        ...item,
        description,
        orderedQty: Number(item.orderedQty),
        receivedQty: Number(item.receivedQty),
        returnedQty: Number(item.returnedQty),
        isReturned: Boolean(item.isReturned)
      };
    }

    if (props.resource === 'rfqs') {
      return {
        ...item,
        description,
        quantity: Number(item.quantity)
      };
    }

    return {
      ...item,
      description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: itemTotal(item)
    };
  });
}

// Date helpers
function toDisplayDate(value) {
  if (!value) return '';

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }

  return '';
}

function toDateInput(value) {
  if (!value) return '';

  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : '';
}

function toApiDate(value) {
  const match = String(value || '')
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    throw new Error('Please select a valid RFQ deadline');
  }

  const [, day, month, year] = match;

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day)
  );

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    throw new Error('Invalid RFQ deadline');
  }

  // ISO datetime; avoids timezone shifting the selected calendar date.
  return `${year}-${month}-${day}T00:00:00`;
}

function toApiDateTime(value) {
  if (!value) return '';

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) {
    throw new Error('Please select a valid delivery date');
  }

  const [, year, month, day] = match;

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day)
  );

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    throw new Error('Invalid delivery date');
  }

  return `${year}-${month}-${day}T00:00:00`;
}

// Backend validation error formatter
function errorText(value) {
  if (Array.isArray(value)) {
    return value.map(errorText).join(', ');
  }

  if (value && typeof value === 'object') {
    if (typeof value.string === 'string') {
      return value.string;
    }

    if (typeof value.message === 'string') {
      return value.message;
    }

    return Object.entries(value)
      .map(([key, item]) => `${key}: ${errorText(item)}`)
      .join('; ');
  }

  return String(value ?? '');
}

function getApiErrorMessage(error) {
  const data = error?.response?.data;

  if (!data) {
    return error?.message || 'Something went wrong';
  }

  if (typeof data.message === 'string') {
    return data.message;
  }

  if (typeof data.detail === 'string') {
    return data.detail;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'object') {
    return Object.entries(data)
      .map(([field, messages]) =>
        `${labelFor(field)}: ${errorText(messages)}`
      )
      .join('\n');
  }

  return 'Unable to save the record';
}

function clearFormErrors() {
  formError.value = '';
  fieldErrors.value = {};
  itemErrors.value = itemRows.value.map(() => ({}));
}

// CRUD
async function load() {
  loading.value = true;
  error.value = '';

  try {
    rows.value = await getAll(
      props.resource,
      search.value
        ? { search: search.value }
        : undefined
    );
  } catch (e) {
    error.value = getApiErrorMessage(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.value = {};
  formError.value = '';
  fieldErrors.value = {};
  itemRows.value = hasItems.value ? [blankItem()] : [];
  itemErrors.value = itemRows.value.map(() => ({}));
  dialog.value = true;
}

function edit(row) {
  editing.value = row._id;
  form.value = { ...row };
  formError.value = '';
  fieldErrors.value = {};

  itemRows.value = hasItems.value
    ? normalizeItems(row.items)
    : [];

  itemErrors.value = itemRows.value.map(() => ({}));

  if (props.resource === 'rfqs' && row.deadline) {
    form.value.deadline = toDisplayDate(row.deadline);
  }

  if (
    props.resource === 'purchase-orders' &&
    row.deliveryDate
  ) {
    form.value.deliveryDate = toDateInput(row.deliveryDate);
  }

  if (props.resource === 'invoices' && row.dueDate) {
    form.value.dueDate = toDateInput(row.dueDate);
  }

  dialog.value = true;
}

function closeForm() {
  if (saving.value) return;

  dialog.value = false;
  formError.value = '';
  fieldErrors.value = {};
}

async function save() {
  if (saving.value) return;

  saving.value = true;
  clearFormErrors();

  try {
    const data = { ...form.value };

    delete data._id;
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    for (const key of [
      'rfq', 'vendor', 'purchaseOrder', 'quotation'
    ]) {
      if (data[key] && typeof data[key] === 'object') {
        data[key] = data[key]._id ?? data[key].id ?? data[key];
      }
    }

    if (props.resource === 'rfqs') {
      data.title = String(data.title || '').trim();

      if (!data.title) {
        fieldErrors.value.title = 'RFQ title is required';
        throw new Error('RFQ title is required');
      }

      data.deadline = toApiDate(data.deadline);
    }

    if (
      props.resource === 'purchase-orders' &&
      data.deliveryDate
    ) {
      data.deliveryDate = toApiDateTime(data.deliveryDate);
    }

    // dueDate is kept as YYYY-MM-DD for a backend DateField.
    // If the serializer defines it as DateTimeField, adapt this
    // conversion after confirming the backend field type.

    if (hasItems.value) {
      validateItems();
      data.items = buildItems();
    }

    if (isPricedResource.value) {
      if (props.resource === 'quotations') {
        data.totalPrice = grandTotal.value;
      } else if (props.resource === 'purchase-orders') {
        data.totalAmount = grandTotal.value;
      } else if (props.resource === 'invoices') {
        data.subTotal = grandTotal.value;
      }
    }

    if (editing.value) {
      await update(props.resource, editing.value, data);
    } else {
      await create(props.resource, data);
    }

    dialog.value = false;

    $q.notify({
      type: 'positive',
      message: editing.value ? 'Updated successfully' : 'Created successfully'
    });

    await load();

    return { success: true };
  } catch (e) {
    const data = e?.response?.data;

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const mapped = {};

      for (const [key, value] of Object.entries(data)) {
        if (key === 'items' && Array.isArray(value)) {
          itemErrors.value = value.map(itemError => {
            if (!itemError || typeof itemError !== 'object') {
              return {};
            }

            const result = {};

            for (const [itemKey, itemValue] of Object.entries(itemError)) {
              result[itemKey] = errorText(itemValue);
            }

            return result;
          });
        } else {
          mapped[key] = errorText(value);
        }
      }

      fieldErrors.value = {
        ...fieldErrors.value,
        ...mapped
      };
    }

    formError.value = getApiErrorMessage(e);

    $q.notify({
      type: 'negative',
      message: formError.value,
      timeout: 6000
    });

    return { success: false, error: formError.value };
  } finally {
    saving.value = false;
  }
}

async function del(row) {
  if (!confirm('Delete this record?')) return;

  try {
    await remove(props.resource, row._id);
    await load();

    $q.notify({
      type: 'positive',
      message: 'Deleted successfully'
    });
  } catch (e) {
    error.value = getApiErrorMessage(e);
  }
}

async function send(row) {
  const ids = prompt('Vendor IDs, comma separated', '');

  if (ids === null) return;

  const vendorIds = ids
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value > 0);

  if (vendorIds.length === 0) {
    error.value = 'Enter at least one valid vendor ID';
    return;
  }

  try {
    await API.post(`/rfqs/${row._id}/send`, { vendorIds });
    await load();
  } catch (e) {
    error.value = getApiErrorMessage(e);
  }
}

async function selectQ(row) {
  try {
    await API.post(`/quotations/${row._id}/select`);
    await load();
  } catch (e) {
    error.value = getApiErrorMessage(e);
  }
}

async function statusChange(row) {
  const values = props.resource === 'invoices'
    ? 'Pending, Paid, Cancelled'
    : 'Pending, Approved, Rejected, Completed';

  const status = prompt('Choose status: ' + values, row.status);

  if (!status) return;

  try {
    await API.patch(
      `/${props.resource}/${row._id}/status`,
      { status }
    );

    await load();
  } catch (e) {
    error.value = getApiErrorMessage(e);
  }
}

// Vendor AI Assistant form bridge
let unregisterForm = null;

watch(
  () => props.resource,
  res => {
    if (unregisterForm) {
      unregisterForm();
      unregisterForm = null;
    }

    if (res === 'vendors') {
      unregisterForm = registerFormController(VENDOR_FORM, {
        getState() {
          return {
            open: dialog.value,
            mode: editing.value
              ? 'edit'
              : dialog.value ? 'add' : null,
            blockedBy: detail.value
              ? 'detail-dialog'
              : null
          };
        },

        openAdd() {
          if (detail.value) {
            return {
              opened: false,
              reason: 'blocked',
              blockedBy: 'detail-dialog'
            };
          }

          if (dialog.value) {
            return {
              opened: false,
              reason: 'already-open'
            };
          }

          openCreate();

          return { opened: true };
        },

        setFields(values) {
          if (detail.value) {
            return {
              success: false,
              reason: 'blocked',
              blockedBy: 'detail-dialog'
            };
          }

          if (editing.value) {
            return {
              success: false,
              reason: 'edit-in-progress'
            };
          }

          if (!dialog.value) openCreate();

          // Deliberately exclude sensitive bank/tax identifiers
          // from AI-assisted form filling.
          const allowed = [
            'name', 'company', 'email',
            'phone', 'category', 'address'
          ];

          for (const [key, value] of Object.entries(values)) {
            if (allowed.includes(key) && value !== undefined) {
              form.value[key] = value;
            }
          }

          return {
            success: true,
            values: { ...form.value }
          };
        },

        getValues() {
          return { ...form.value };
        },

        async save() {
          if (detail.value) {
            return {
              success: false,
              reason: 'blocked',
              blockedBy: 'detail-dialog'
            };
          }

          if (editing.value) {
            return {
              success: false,
              reason: 'edit-in-progress'
            };
          }

          if (!dialog.value) {
            return {
              success: false,
              reason: 'not-open'
            };
          }

          return await save();
        },

        close() {
          if (saving.value) {
            return {
              success: false,
              reason: 'save-in-progress'
            };
          }

          dialog.value = false;

          return { success: true };
        }
      });
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (unregisterForm) unregisterForm();
});

watch(() => props.resource, load);
onMounted(load);
</script>
