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

// 不自动连接——用户需要先点击首页"连接"按钮
// if (!socketStore.connected) { ... } 已移除
</script>

<style scoped>
.whiteboard-page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
