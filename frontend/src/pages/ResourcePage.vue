<template><q-page padding><div class="row items-center justify-between q-mb-lg"><h4 class="q-my-md">{{title}}</h4><q-btn v-if="editable" color="deep-purple" icon="add" :label="'Add '+singular" @click="openCreate"/></div><q-banner v-if="error" class="bg-negative q-mb-md">{{error}}</q-banner><q-input v-if="resource==='vendors'" v-model="search" dark outlined dense debounce="250" label="Search vendors" class="q-mb-md" @update:model-value="load"/><q-table :rows="rows" :columns="columns" row-key="_id" :loading="loading" dark flat bordered><template #body-cell-actions="props"><q-td :props="props"><q-btn dense flat icon="visibility" @click="detail=props.row"/><q-btn v-if="editable" dense flat icon="edit" @click="edit(props.row)"/><q-btn v-if="deletable" dense flat color="negative" icon="delete" @click="del(props.row)"/><q-btn v-if="resource==='rfqs'" dense flat color="primary" label="Send" @click="send(props.row)"/><q-btn v-if="resource==='quotations'" dense flat color="positive" label="Select" @click="selectQ(props.row)"/><q-btn v-if="['purchase-orders','invoices'].includes(resource)" dense flat color="primary" label="Status" @click="statusChange(props.row)"/></q-td></template></q-table><q-dialog v-model="dialog"><q-card style="min-width:min(650px,90vw)"><q-card-section class="text-h6">{{editing?'Edit':'Create'}} {{singular}}</q-card-section><q-card-section class="q-gutter-md"><q-input v-for="field in fields" :key="field" v-model="form[field]" dark outlined :label="field" :type="['totalPrice','totalAmount','subTotal','rating','validityDays'].includes(field)?'number':'text'"/><q-input v-if="['rfqs','quotations','purchase-orders','invoices','inventory'].includes(resource)" v-model="itemsText" type="textarea" dark outlined label="Items (JSON array)" hint="Example: [{&quot;description&quot;:&quot;Laptop&quot;,&quot;quantity&quot;:2}]"/></q-card-section><q-card-actions align="right"><q-btn flat label="Cancel" v-close-popup/><q-btn color="deep-purple" label="Save" @click="save"/></q-card-actions></q-card></q-dialog><q-dialog :model-value="!!detail" @update:model-value="detail=null"><q-card style="min-width:min(600px,90vw)"><q-card-section class="text-h6">Details</q-card-section><q-card-section><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{JSON.stringify(detail,null,2)}}</pre></q-card-section><q-card-actions align="right"><q-btn flat label="Close" @click="detail=null"/></q-card-actions></q-card></q-dialog></q-page></template>
<script setup>
import {ref,computed,watch,onMounted,onUnmounted} from 'vue';import {useQuasar} from 'quasar';import {API,getAll,create,update,remove} from '../api';
import {registerFormController, VENDOR_FORM} from '../voice/adapters/vendorpro/formBridge.js';
const props=defineProps({resource:{type:String,required:true}}),$q=useQuasar(),rows=ref([]),error=ref(''),loading=ref(false),dialog=ref(false),editing=ref(null),detail=ref(null),form=ref({}),itemsText=ref('[]'),search=ref('');
const labels={'vendors':'Vendors','rfqs':'RFQs','quotations':'Quotations','purchase-orders':'Purchase Orders','invoices':'Invoices','inventory':'Inventory'};
const fieldMap={'vendors':['name','company','email','phone','gst','pan','category','bankName','accountNumber','ifsc','rating','status','address'],'rfqs':['title','description','deadline','status'],'quotations':['rfq','vendor','totalPrice','validityDays','terms','deliveryDays'],'purchase-orders':['vendor','totalAmount','deliveryDate','notes'],'invoices':['purchaseOrder','vendor','subTotal','gstRate','dueDate'],'inventory':['purchaseOrder','vendor','notes']};
const title=computed(()=>labels[props.resource]),singular=computed(()=>title.value.replace(/s$/,'')),fields=computed(()=>fieldMap[props.resource]||[]),editable=computed(()=>true),deletable=computed(()=>['vendors','rfqs','purchase-orders','invoices'].includes(props.resource));
const columns=computed(()=>{const first={vendors:['name','company','email','category','status'],rfqs:['rfqNumber','title','deadline','status'],quotations:['rfq','vendor','totalPrice','status'], 'purchase-orders':['poNumber','vendor','totalAmount','status'],invoices:['invoiceNumber','vendor','totalAmount','status'],inventory:['purchaseOrder','vendor','receivedDate']}[props.resource];return [...first.map(name=>({name,label:name,field:r=>typeof r[name]==='object'&&r[name]!==null?(r[name].name||r[name].title||r[name].poNumber||r[name]._id||JSON.stringify(r[name])):r[name],align:'left',sortable:true})),{name:'actions',label:'Actions',field:'_id'}]});
async function load(){loading.value=true;error.value='';try{rows.value=await getAll(props.resource,search.value?{search:search.value}:undefined)}catch(e){error.value=e.response?.data?.message||e.message}finally{loading.value=false}}
function openCreate(){editing.value=null;form.value={};itemsText.value='[]';dialog.value=true}function edit(row){editing.value=row._id;form.value={...row};itemsText.value=JSON.stringify(row.items||[]);dialog.value=true}
async function save(){try{const data={...form.value};delete data._id;delete data.id;delete data.createdAt;delete data.updatedAt;for(const k of ['rfq','vendor','purchaseOrder','quotation'])if(data[k]&&typeof data[k]==='object')data[k]=data[k]._id;if(props.resource!=='vendors')data.items=JSON.parse(itemsText.value);if(editing.value)await update(props.resource,editing.value,data);else await create(props.resource,data);dialog.value=false;await load();$q.notify({type:'positive',message:'Saved'})}catch(e){$q.notify({type:'negative',message:e.response?.data?.message||e.message})}}
async function del(row){if(!confirm('Delete this record?'))return;try{await remove(props.resource,row._id);await load()}catch(e){error.value=e.response?.data?.message||e.message}}
async function send(row){const ids=prompt('Vendor IDs, comma separated','');if(ids===null)return;try{await API.post(`/rfqs/${row._id}/send`,{vendorIds:ids.split(',').map(x=>Number(x.trim())).filter(Boolean)});await load()}catch(e){error.value=e.response?.data?.message||e.message}}
async function selectQ(row){try{await API.post(`/quotations/${row._id}/select`);await load()}catch(e){error.value=e.response?.data?.message||e.message}}
async function statusChange(row){const values=props.resource==='invoices'?'Pending, Paid, Cancelled':'Pending, Approved, Rejected, Completed';const status=prompt('Choose status: '+values,row.status);if(!status)return;try{await API.patch(`/${props.resource}/${row._id}/status`,{status});await load()}catch(e){error.value=e.response?.data?.message||e.message}}

// Form bridge integration for interactive assistant form opening & field filling
let unregisterForm = null;
watch(() => props.resource, (res) => {
  if (unregisterForm) { unregisterForm(); unregisterForm = null; }
  if (res === 'vendors') {
    unregisterForm = registerFormController(VENDOR_FORM, {
      getState() {
        return {
          open: dialog.value,
          mode: editing.value ? 'edit' : (dialog.value ? 'add' : null),
          blockedBy: detail.value ? 'detail-dialog' : null
        };
      },
      openAdd() {
        if (detail.value) return { opened: false, reason: 'blocked', blockedBy: 'detail-dialog' };
        if (dialog.value) return { opened: false, reason: 'already-open' };
        openCreate();
        return { opened: true };
      },
      setFields(values) {
        if (detail.value) return { success: false, reason: 'blocked', blockedBy: 'detail-dialog' };
        if (editing.value) return { success: false, reason: 'edit-in-progress' };
        if (!dialog.value) openCreate();
        const allowed = ['name', 'company', 'email', 'phone', 'category', 'address'];
        for (const [k, v] of Object.entries(values)) {
          if (allowed.includes(k) && v !== undefined) {
            form.value[k] = v;
          }
        }
        return { success: true, values: { ...form.value } };
      },
      getValues() {
        return { ...form.value };
      },
      async save() {
        if (detail.value) return { success: false, reason: 'blocked', blockedBy: 'detail-dialog' };
        if (editing.value) return { success: false, reason: 'edit-in-progress' };
        if (!dialog.value) return { success: false, reason: 'not-open' };
        await save();
        return { success: true };
      },
      close() {
        dialog.value = false;
        return { success: true };
      }
    });
  }
}, { immediate: true });

onUnmounted(() => {
  if (unregisterForm) unregisterForm();
});

watch(()=>props.resource,load);onMounted(load);
</script>