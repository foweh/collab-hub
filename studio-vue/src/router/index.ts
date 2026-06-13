import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/whiteboard',
      name: 'whiteboard',
      component: () => import('../views/WhiteboardView.vue'),
    },
    {
      path: '/mindmap',
      name: 'mindmap',
      component: () => import('../views/MindmapView.vue'),
    },
  ],
})

export default router
