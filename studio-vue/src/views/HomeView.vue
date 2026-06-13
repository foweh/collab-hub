<template>
  <div class="home-view">
    <header class="home-header">
      <h1>协作设计工作室</h1>
      <p class="subtitle">白板 / 原型 / 设计 / 代码 — 局域网实时协作</p>
    </header>
    <main class="home-content">
      <div class="module-grid">
        <router-link to="/whiteboard" class="module-card">
          <div class="card-icon">
            <svg viewBox="0 0 48 48" width="48" height="48">
              <rect x="4" y="8" width="40" height="32" rx="4" fill="none" stroke="#1a73e8" stroke-width="2"/>
              <line x1="4" y1="18" x2="44" y2="18" stroke="#1a73e8" stroke-width="1.5"/>
              <circle cx="12" cy="13" r="2" fill="#1a73e8"/>
              <circle cx="18" cy="13" r="2" fill="#1a73e8"/>
              <rect x="8" y="23" width="14" height="10" rx="1" fill="#e8f0fe" stroke="#1a73e8" stroke-width="1"/>
              <rect x="26" y="23" width="14" height="10" rx="1" fill="#e8f0fe" stroke="#1a73e8" stroke-width="1"/>
            </svg>
          </div>
          <h3>协作白板</h3>
          <p>无限画布、流程图、BPMN、UML — 多人实时协作</p>
        </router-link>

        <router-link to="/mindmap" class="module-card">
          <div class="card-icon">🧠</div>
          <h3>思维导图</h3>
          <p>树状布局、折叠展开、拖拽编辑 — Konva 渲染</p>
        </router-link>

        <div class="module-card disabled">
          <div class="card-icon">📱</div>
          <h3>原型设计</h3>
          <p>组件拖拽、交互连线、高保真原型（即将上线）</p>
        </div>

        <div class="module-card disabled">
          <div class="card-icon">🎨</div>
          <h3>UI 设计</h3>
          <p>矢量编辑、自动布局、变量系统（即将上线）</p>
        </div>

        <div class="module-card disabled">
          <div class="card-icon">&lt;/&gt;</div>
          <h3>D2C 代码</h3>
          <p>一键导出 Vue/React/HTML 代码（即将上线）</p>
        </div>
      </div>

      <div class="connection-bar">
        <span :class="['status-dot', connected ? 'online' : 'offline']"></span>
        <span>{{ connected ? '已连接至服务器' : '未连接' }}</span>
        <input v-model="userName" placeholder="输入昵称" class="name-input" />
        <button class="conn-btn" @click="connect" :disabled="!userName.trim() || connected">
          {{ connected ? '已连接' : '连接' }}
        </button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSocketStore } from '../stores/socket'

const socketStore = useSocketStore()
const userName = ref(localStorage.getItem('studio-user-name') || '')
const connected = ref(false)

function connect() {
  if (!userName.value.trim()) return
  localStorage.setItem('studio-user-name', userName.value.trim())
  let userId = localStorage.getItem('studio-user-id')
  if (!userId) {
    userId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    localStorage.setItem('studio-user-id', userId)
  }
  const wsUrl = `http://${window.location.hostname}:3000`
  socketStore.connect(wsUrl, userId, userName.value.trim())
  connected.value = true
}

// 不自动连接——用户点击"连接"按钮才连
// 之前自动连接逻辑已移除，防止连接风暴
</script>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #f0f2f5;
}

.home-header {
  text-align: center;
  padding: 48px 24px 24px;
}

.home-header h1 {
  font-size: 28px;
  color: #1a1a1a;
  margin: 0;
}

.subtitle {
  color: #666;
  font-size: 14px;
  margin-top: 8px;
}

.home-content {
  flex: 1;
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.module-card {
  background: white;
  border: 1px solid #dadce0;
  border-radius: 12px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
  color: inherit;
  display: block;
}

.module-card:hover:not(.disabled) {
  border-color: #1a73e8;
  box-shadow: 0 2px 12px rgba(26,115,232,0.12);
  transform: translateY(-2px);
}

.module-card.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.card-icon {
  font-size: 36px;
  margin-bottom: 12px;
  width: 48px;
  height: 48px;
}

.module-card h3 {
  font-size: 16px;
  margin: 0 0 8px 0;
  color: #1a1a1a;
}

.module-card p {
  font-size: 12px;
  color: #666;
  margin: 0;
  line-height: 1.5;
}

.connection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  padding: 12px 16px;
  background: white;
  border: 1px solid #dadce0;
  border-radius: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.status-dot.online { background: #34a853; }
.status-dot.offline { background: #ea4335; }

.name-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font-size: 13px;
  max-width: 200px;
}

.conn-btn {
  padding: 6px 16px;
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.conn-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
