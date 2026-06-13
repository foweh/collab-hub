<template>
  <div class="whiteboard-page" v-if="!projectId">
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
const projectId = ref<string | null>(null)
</script>

<style scoped>
.whiteboard-page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
