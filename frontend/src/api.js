import axios from 'axios'
export const API=axios.create({baseURL:import.meta.env.VITE_API_URL||'http://localhost:8000/api'})
export const resources=['vendors','rfqs','quotations','purchase-orders','invoices','inventory']
export const getAll=(r,params)=>API.get('/'+r,{params}).then(x=>x.data.data)
export const create=(r,data)=>API.post('/'+r,data).then(x=>x.data.data)
export const update=(r,id,data)=>API.put('/'+r+'/'+id,data).then(x=>x.data.data)
export const remove=(r,id)=>API.delete('/'+r+'/'+id)
