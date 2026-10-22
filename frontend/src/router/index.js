import { createRouter, createWebHistory } from 'vue-router'
import ResourcePage from '../pages/ResourcePage.vue'
import Dashboard from '../pages/DashboardPage.vue'

const paths = [
  'vendors',
  'rfqs',
  'quotations',
  'purchase-orders',
  'invoices',
  'inventory',
]

const routes = [
  { path: '/', component: Dashboard },
  ...paths.map((path) => ({
    path: `/${path}`,
    component: ResourcePage,
    props: { resource: path },
  })),
]

export default function createAppRouter() {
  return createRouter({
    history: createWebHistory(),
    routes,
  })
}
