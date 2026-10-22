import { createApp } from 'vue'
import { Quasar, Notify, Dialog } from 'quasar'
import 'quasar/src/css/index.sass'
import './app.css'
import App from './App.vue'
import createAppRouter from './router'

const router = createAppRouter()

createApp(App)
  .use(Quasar, { plugins: { Notify, Dialog } })
  .use(router)
  .mount('#q-app')

