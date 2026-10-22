import { defineConfig } from '#q-app/wrappers'

export default defineConfig(() => ({
  css: ['app.css'],
  extras: ['roboto-font', 'material-icons'],
  build: {
    vueRouterMode: 'history',
  },
  devServer: {
    port: 9000,
  },
  framework: {
    plugins: ['Notify', 'Dialog'],
  },
}))


