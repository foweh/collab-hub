<template>
  <div class="project-page">
    <header class="pp-header">
      <div class="pp-title">
        <h1>协作设计工作室</h1>
        <span class="pp-subtitle">白板 / 原型 / 设计 / 代码</span>
      </div>
      <div class="pp-actions">
        <button class="pp-btn primary" @click="showCreateModal = true">+ 新建项目</button>
      </div>
    </header>

    <div class="pp-content">
      <!-- 项目列表 -->
      <div class="pp-projects">
        <div v-for="p in store.visibleProjects" :key="p.id" :class="['pp-project', { active: store.currentProjectId === p.id }]"
          @click="store.selectProject(p.id)">
          <div class="pp-project-row">
            <span class="pp-project-icon">{{ projectIcon(p.type) }}</span>
            <span class="pp-project-name">{{ p.name }}</span>
            <span class="pp-project-type">{{ typeLabel(p.type) }}</span>
            <span class="pp-project-owner">{{ p.owner }}</span>
          </div>
          <!-- 子项列表（容器项目） -->
          <div v-if="store.currentProjectId === p.id && p.data?.items" class="pp-items">
            <div v-for="item in p.data.items" :key="item.id"
              :class="['pp-item', { active: store.currentItemId === item.id }]"
              @click.stop="openItem(p, item)">
              <span class="pp-item-icon">{{ projectIcon(item.type) }}</span>
              <span class="pp-item-name">{{ item.name }}</span>
              <span class="pp-item-type">{{ typeLabel(item.type) }}</span>
              <button class="pp-item-del" @click.stop="deleteItem(p.id, item.id)" title="删除子项">✕</button>
            </div>
            <!-- 添加子项按钮 -->
            <div class="pp-add-item">
              <select v-model="newItemType" class="pp-item-type-select">
                <option value="mindmap">思维导图</option>
                <option value="script">剧本</option>
                <option value="story">故事</option>
                <option value="storyboard">分镜</option>
              </select>
              <button class="pp-btn sm" @click="addItemToProject(p.id)">+ 添加</button>
            </div>
          </div>
        </div>
        <div v-if="store.visibleProjects.length === 0" class="pp-empty">
          暂无项目，点击"新建项目"创建
        </div>
      </div>

      <!-- 右侧：内容区域 -->
      <div class="pp-detail">
        <div v-if="!store.currentProject" class="pp-detail-empty">
          <p>选择一个项目开始协作</p>
        </div>
        <div v-else-if="store.currentItem" class="pp-detail-content">
          <WhiteboardView :user-id="userId" :user-name="userName"
            :project-id="store.currentProjectId!"
            :item-id="store.currentItemId!" />
        </div>
        <div v-else class="pp-detail-empty">
          <p>{{ store.currentProject.name }}</p>
          <p class="dim">选择一个子项或添加新内容</p>
        </div>
      </div>
    </div>

    <!-- 新建项目弹窗 -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <span class="modal-title">新建项目</span>
          <button class="modal-close" @click="showCreateModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>项目名称</label>
            <input v-model="newProjectName" placeholder="输入项目名称..." class="form-input" ref="nameInput" maxlength="50" />
          </div>
          <div class="form-field">
            <label>项目类型</label>
            <div class="type-options">
              <label class="type-option" v-for="t in projectTypes" :key="t.value"
                :class="{ selected: newProjectType === t.value }"
                @click="newProjectType = t.value">
                <span class="type-icon">{{ t.icon }}</span>
                <span class="type-label">{{ t.label }}</span>
                <span class="type-desc">{{ t.desc }}</span>
              </label>
            </div>
          </div>
          <!-- 容器项目：可选子项 -->
          <div v-if="newProjectType === 'project'" class="form-field">
            <label>初始内容（可选）</label>
            <div class="init-items">
              <label v-for="t in itemTypes" :key="t.value" class="init-item">
                <input type="checkbox" :value="t.value" v-model="newProjectItems" />
                <span>{{ t.icon }} {{ t.label }}</span>
              </label>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="pp-btn" @click="showCreateModal = false">取消</button>
          <button class="pp-btn primary" @click="doCreateProject" :disabled="!newProjectName.trim()">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useProjectStore, type Project, type ProjectItem } from '../stores/project'
import { useSocketStore } from '../stores/socket'
import WhiteboardView from '../components/whiteboard/WhiteboardView.vue'

const store = useProjectStore()
const socketStore = useSocketStore()

// 用户信息
const userName = ref(localStorage.getItem('studio-user-name') || '')
const userId = ref(localStorage.getItem('studio-user-id') || 'u' + Date.now().toString(36))

// 弹窗状态
const showCreateModal = ref(false)
const newProjectName = ref('')
const newProjectType = ref<'project' | 'script' | 'mindmap' | 'story' | 'storyboard'>('project')
const newProjectItems = ref<string[]>([])
const nameInput = ref<HTMLInputElement | null>(null)

const projectTypes = [
  { value: 'project', icon: '📦', label: '容器项目', desc: '包含多个子项' },
  { value: 'mindmap', icon: '🧠', label: '思维导图', desc: '树状结构' },
  { value: 'script', icon: '📜', label: '剧本', desc: '幕/场结构' },
  { value: 'story', icon: '📖', label: '故事', desc: '分章编写' },
  { value: 'storyboard', icon: '🎬', label: '分镜', desc: '镜头编排' },
]

const itemTypes = [
  { value: 'mindmap', icon: '🧠', label: '思维导图' },
  { value: 'script', icon: '📜', label: '剧本' },
  { value: 'story', icon: '📖', label: '故事' },
  { value: 'storyboard', icon: '🎬', label: '分镜' },
]

const newItemType = ref('mindmap')

function projectIcon(type: string): string {
  const map: Record<string, string> = {
    project: '📦', folder: '📁', script: '📜', mindmap: '🧠',
    story: '📖', storyboard: '🎬',
  }
  return map[type] || '📄'
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    project: '项目', folder: '文件夹', script: '剧本', mindmap: '导图',
    story: '故事', storyboard: '分镜',
  }
  return map[type] || type
}

function doCreateProject() {
  const name = newProjectName.value.trim()
  if (!name) return

  if (newProjectType.value === 'project' && newProjectItems.value.length > 0) {
    const children = newProjectItems.value.map(t => ({ type: t, name: store.getDefaultData(t) ? typeLabel(t) : t }))
    store.createWithItems(name, children)
  } else {
    store.create(newProjectType.value, name)
  }

  showCreateModal.value = false
  newProjectName.value = ''
  newProjectItems.value = []
}

function addItemToProject(projectId: string) {
  const name = prompt('输入子项名称:', typeLabel(newItemType.value))
  if (name) {
    store.addItem(projectId, newItemType.value, name)
  }
}

function deleteItem(projectId: string, itemId: string) {
  if (confirm('确定删除这个子项？')) {
    store.removeItem(projectId, itemId)
  }
}

function openItem(p: Project, item: ProjectItem) {
  store.selectProject(p.id)
  store.selectItem(item.id)
}

// Socket 连接
watch(() => socketStore.connected, (val) => {
  if (val && socketStore.socket) {
    store.setupSocket(socketStore.socket)
  }
}, { immediate: true })

// 弹窗打开时聚焦输入框
watch(showCreateModal, (val) => {
  if (val) nextTick(() => nameInput.value?.focus())
})
</script>

<style scoped>
.project-page { display: flex; flex-direction: column; height: 100vh; background: #f0f2f5; }
.pp-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: white; border-bottom: 1px solid #dadce0; flex-shrink: 0; }
.pp-title h1 { font-size: 20px; margin: 0; color: #1a1a1a; }
.pp-subtitle { font-size: 12px; color: #888; }
.pp-content { display: flex; flex: 1; overflow: hidden; }
.pp-projects { width: 340px; overflow-y: auto; background: white; border-right: 1px solid #dadce0; padding: 8px; flex-shrink: 0; }
.pp-project { padding: 8px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; }
.pp-project:hover { background: #f0f2f5; }
.pp-project.active { background: #d2e3fc; }
.pp-project-row { display: flex; align-items: center; gap: 8px; }
.pp-project-icon { font-size: 18px; }
.pp-project-name { flex: 1; font-size: 13px; font-weight: 500; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-project-type { font-size: 10px; color: #888; background: #f0f2f5; padding: 1px 6px; border-radius: 3px; }
.pp-project-owner { font-size: 11px; color: #999; }
.pp-items { margin-left: 24px; margin-top: 4px; border-left: 2px solid #e0e0e0; padding-left: 8px; }
.pp-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.pp-item:hover { background: #e8eaed; }
.pp-item.active { background: #d2e3fc; font-weight: 500; }
.pp-item-icon { font-size: 14px; }
.pp-item-name { flex: 1; }
.pp-item-type { font-size: 10px; color: #888; }
.pp-item-del { border: none; background: transparent; cursor: pointer; color: #999; font-size: 11px; padding: 2px; opacity: 0; }
.pp-item:hover .pp-item-del { opacity: 1; }
.pp-add-item { display: flex; gap: 4px; margin-top: 4px; padding-left: 4px; }
.pp-item-type-select { font-size: 11px; padding: 2px 4px; border: 1px solid #dadce0; border-radius: 3px; flex: 1; }
.pp-btn { padding: 8px 16px; border: 1px solid #dadce0; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; }
.pp-btn.primary { background: #1a73e8; color: white; border: none; }
.pp-btn.sm { padding: 3px 8px; font-size: 11px; }
.pp-btn:disabled { opacity: 0.4; cursor: default; }
.pp-detail { flex: 1; overflow: hidden; }
.pp-detail-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 14px; flex-direction: column; gap: 8px; }
.pp-detail-empty p.dim { font-size: 12px; color: #aaa; }
.pp-empty { text-align: center; padding: 40px; color: #999; font-size: 13px; }

/* 弹窗 */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-card { background: white; border-radius: 12px; width: 480px; max-width: 90vw; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-title { font-size: 16px; font-weight: 600; }
.modal-close { border: none; background: transparent; cursor: pointer; font-size: 18px; color: #888; padding: 4px; }
.modal-body { padding: 16px 20px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid #eee; }
.form-field { margin-bottom: 16px; }
.form-field label { display: block; font-size: 12px; color: #666; margin-bottom: 6px; font-weight: 500; }
.form-input { width: 100%; padding: 8px 12px; border: 1px solid #dadce0; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
.type-options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.type-option { padding: 10px; border: 1px solid #dadce0; border-radius: 8px; cursor: pointer; transition: all 0.15s; }
.type-option:hover { border-color: #1a73e8; }
.type-option.selected { border-color: #1a73e8; background: #e8f0fe; }
.type-icon { font-size: 20px; display: block; margin-bottom: 4px; }
.type-label { font-size: 13px; font-weight: 500; display: block; color: #333; }
.type-desc { font-size: 10px; color: #888; display: block; margin-top: 2px; }
.init-items { display: flex; flex-wrap: wrap; gap: 8px; }
.init-item { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; padding: 4px 8px; border: 1px solid #dadce0; border-radius: 4px; }
.init-item:hover { border-color: #1a73e8; }
</style>
