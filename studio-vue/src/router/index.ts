import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'projects',
      component: () => import('../views/ProjectView.vue'),
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
