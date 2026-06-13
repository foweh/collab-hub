<template>
  <div class="whiteboard-page">
    <WhiteboardView :user-id="userId" :user-name="userName" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import WhiteboardView from '../components/whiteboard/WhiteboardView.vue'
import { useSocketStore } from '../stores/socket'

const socketStore = useSocketStore()
const userId = ref(socketStore.myUserId || localStorage.getItem('studio-user-id') || 'unknown')
const userName = ref(socketStore.myUserName || localStorage.getItem('studio-user-name') || '匿名')

// 如果还没连接，自动尝试
if (!socketStore.connected) {
  const savedId = localStorage.getItem('studio-user-id')
  const savedName = localStorage.getItem('studio-user-name')
  if (savedId && savedName) {
    const wsUrl = `http://${window.location.hostname}:3000`
    socketStore.connect(wsUrl, savedId, savedName)
  }
}
</script>

<style scoped>
.whiteboard-page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
