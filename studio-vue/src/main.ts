import { createApp } from 'vue'
import { createPinia } from 'pinia'
import VueKonva from 'vue-konva'
import App from './App.vue'
import router from './router'

// 全局错误处理
window.addEventListener('error', (e) => {
  console.error('[全局错误]', e.message, e.filename, e.lineno)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[未处理 Promise]', e.reason)
})

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(VueKonva)

app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue 错误]', err, info)
}

app.mount('#app')

console.log('[Vue] 应用已挂载')
