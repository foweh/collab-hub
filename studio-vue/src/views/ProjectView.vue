<template>
  <div class="project-page">
    <header class="pp-header">
      <div class="pp-title">
        <h1>协作设计工作室</h1>
        <span class="pp-subtitle">白板 / 原型 / 设计 / 代码</span>
      </div>
      <div class="pp-actions">
        <div class="pp-connection">
          <span :class="['pp-dot', socketStore.connected ? 'online' : 'offline']"></span>
          <span class="pp-conn-text">{{ socketStore.connected ? '已连接' : '未连接' }}</span>
        </div>
        <button v-if="!socketStore.connected" class="pp-btn" @click="connectServer">连接</button>
        <button class="pp-btn primary" @click="showCreateModal = true">+ 新建项目</button>
      </div>
    </header>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="pp-error">{{ errorMsg }}</div>

    <div class="pp-content">
      <!-- 项目列表 -->
      <div class="pp-projects">
        <div v-for="p in store.visibleProjects" :key="p.id" :class="['pp-project', { active: store.currentProjectId === p.id }]"
          @click="store.selectProject(p.id)">
          <div class="pp-project-row" @dblclick="startRenameProject(p)">
            <span class="pp-project-icon">{{ projectIcon(p.type) }}</span>
            <span class="pp-project-name">{{ p.name }}</span>
            <span class="pp-project-type">{{ typeLabel(p.type) }}</span>
            <span class="pp-project-owner">{{ p.owner }}</span>
          </div>
        </div>
        <div v-if="store.visibleProjects.length === 0" class="pp-empty">
          暂无项目，点击右上角"新建项目"创建
        </div>
      </div>

      <!-- 右侧：项目详情/内容 -->
      <div class="pp-detail">
        <!-- 未选中项目 -->
        <div v-if="!store.currentProject" class="pp-detail-empty">
          <p>选择一个项目开始协作</p>
        </div>

        <!-- 选中了项目但没选子项 → 展示项目详情 -->
        <div v-else-if="!store.currentItem" class="pp-detail-project">
          <div class="pd-header">
            <span class="pd-icon">{{ projectIcon(store.currentProject.type) }}</span>
            <div class="pd-info">
              <span class="pd-name">{{ store.currentProject.name }}</span>
              <span class="pd-meta">{{ typeLabel(store.currentProject.type) }} · {{ store.currentProject.owner }}</span>
            </div>
          </div>

          <!-- 子项列表 -->
          <div class="pd-section">
            <div class="pd-section-title">内容</div>
            <div v-if="projectItems.length > 0" class="pd-items">
              <div v-for="item in projectItems" :key="item.id"
                :class="['pd-item', { active: store.currentItemId === item.id }]"
                @click="openItem(store.currentProject!, item)">
                <span class="pd-item-icon">{{ projectIcon(item.type) }}</span>
                <span class="pd-item-name" @dblclick.stop="startRenameItem(item)">{{ item.name }}</span>
                <span class="pd-item-type">{{ typeLabel(item.type) }}</span>
                <button class="pd-item-del" @click.stop="deleteItem(store.currentProject!.id, item.id)" title="删除">✕</button>
              </div>
            </div>
            <div v-else class="pd-items-empty">暂无内容，点击下方按钮添加</div>
          </div>

          <!-- 添加入口：4个独立按钮 -->
          <div class="pd-section">
            <div class="pd-section-title">添加</div>
            <div class="pd-add-grid">
              <button class="pd-add-btn" @click="addItemToProject('script')">
                <span class="pd-add-icon">📜</span>
                <span class="pd-add-label">剧本</span>
              </button>
              <button class="pd-add-btn" @click="addItemToProject('mindmap')">
                <span class="pd-add-icon">🧠</span>
                <span class="pd-add-label">导图</span>
              </button>
              <button class="pd-add-btn" @click="addItemToProject('story')">
                <span class="pd-add-icon">📖</span>
                <span class="pd-add-label">故事</span>
              </button>
              <button class="pd-add-btn" @click="addItemToProject('storyboard')">
                <span class="pd-add-icon">🎬</span>
                <span class="pd-add-label">分镜</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 选中子项 → 展示编辑器 -->
        <div v-else class="pp-detail-content">
          <ScriptEditor v-if="store.currentItem?.type === 'script'"
            :key="store.currentItemId" />
          <StoryEditor v-else-if="store.currentItem?.type === 'story'"
            :key="store.currentItemId" />
          <div v-else-if="store.currentItem?.type === 'mindmap'" class="pp-detail-full">
            <MindmapView />
          </div>
          <div v-else-if="store.currentItem?.type === 'storyboard'" class="pp-detail-full">
            <iframe :src="storyboardUrl" class="pp-storyboard-frame" frameborder="0"></iframe>
          </div>
          <WhiteboardView v-else :user-id="userId" :user-name="userName"
            :project-id="store.currentProjectId!"
            :item-id="store.currentItemId!" />
        </div>
      </div>
    </div>

    <!-- 新建项目弹窗（极简：只问名称） -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-card modal-sm">
        <div class="modal-header">
          <span class="modal-title">新建项目</span>
          <button class="modal-close" @click="showCreateModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>项目名称</label>
            <input v-model="newProjectName" placeholder="输入项目名称..." class="form-input" ref="nameInput" maxlength="50"
              @keydown.enter="doCreateProject" />
          </div>
          <p class="form-hint">创建容器项目，之后可添加剧本、导图、故事、分镜等子项</p>
        </div>
        <div class="modal-footer">
          <button class="pp-btn" @click="showCreateModal = false">取消</button>
          <button class="pp-btn primary" @click="doCreateProject" :disabled="!newProjectName.trim()">创建</button>
        </div>
      </div>
    </div>

    <!-- 添加子项弹窗 -->
    <div v-if="showItemModal" class="modal-overlay" @click.self="showItemModal = false">
      <div class="modal-card modal-sm">
        <div class="modal-header">
          <span class="modal-title">新建{{ itemModalLabel }}</span>
          <button class="modal-close" @click="showItemModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>名称</label>
            <input v-model="newItemName" :placeholder="'输入' + itemModalLabel + '名称...'" class="form-input" ref="itemNameInput" maxlength="50"
              @keydown.enter="doAddItem" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="pp-btn" @click="showItemModal = false">取消</button>
          <button class="pp-btn primary" @click="doAddItem" :disabled="!newItemName.trim()">创建</button>
        </div>
      </div>
    </div>

    <!-- 重命名弹窗 -->
    <div v-if="showRenameModal" class="modal-overlay" @click.self="showRenameModal = false">
      <div class="modal-card modal-sm">
        <div class="modal-header">
          <span class="modal-title">重命名</span>
          <button class="modal-close" @click="showRenameModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>新名称</label>
            <input v-model="renameValue" placeholder="输入新名称..." class="form-input" ref="renameInput" maxlength="50"
              @keydown.enter="doRename" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="pp-btn" @click="showRenameModal = false">取消</button>
          <button class="pp-btn primary" @click="doRename" :disabled="!renameValue.trim()">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useProjectStore, type Project, type ProjectItem } from '../stores/project'
import { useSocketStore } from '../stores/socket'
import WhiteboardView from '../components/whiteboard/WhiteboardView.vue'
import ScriptEditor from '../components/editor/ScriptEditor.vue'
import StoryEditor from '../components/editor/StoryEditor.vue'
import MindmapView from '../views/MindmapView.vue'

const store = useProjectStore()
const socketStore = useSocketStore()

// 错误提示
const errorMsg = ref('')
let errorTimer: any = null
function showError(msg: string) {
  errorMsg.value = msg
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => { errorMsg.value = '' }, 4000)
}

// Socket 错误监听
watch(() => socketStore.socket, (s) => {
  if (s) {
    s.off('project-update-error')
    s.on('project-update-error', (msg: string) => showError(msg))
    store.setupSocket(s)
  }
})

const userName = ref(localStorage.getItem('studio-user-name') || '')
const userId = ref(localStorage.getItem('studio-user-id') || 'u' + Date.now().toString(36))

// ── 当前项目的子项 ──
const projectItems = computed(() => {
  const p = store.currentProject
  return p?.data?.items || []
})

// 分镜 iframe URL
const storyboardUrl = computed(() => {
  const item = store.currentItem
  if (item?.type !== 'storyboard' || !store.currentProjectId) return ''
  return `/storyboard?project=${store.currentProjectId}&item=${item.id}`
})

// ── 新建项目弹窗 ──
const showCreateModal = ref(false)
const newProjectName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

function doCreateProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  store.create('project', name)
  showCreateModal.value = false
  newProjectName.value = ''
}

// ── 添加子项弹窗 ──
const showItemModal = ref(false)
const newItemName = ref('')
const newItemType = ref('script')
const itemNameInput = ref<HTMLInputElement | null>(null)

const ITEM_LABELS: Record<string, string> = { script: '剧本', mindmap: '导图', story: '故事', storyboard: '分镜' }
const itemModalLabel = computed(() => ITEM_LABELS[newItemType.value] || '项目')

function addItemToProject(type: string) {
  if (!store.currentProjectId) return
  newItemType.value = type
  newItemName.value = ''
  showItemModal.value = true
  nextTick(() => itemNameInput.value?.focus())
}

function doAddItem() {
  const name = newItemName.value.trim()
  if (!name || !store.currentProjectId) return
  store.addItem(store.currentProjectId, newItemType.value, name)
  showItemModal.value = false
  newItemName.value = ''
}

// ── 其他操作 ──
function deleteItem(projectId: string, itemId: string) {
  if (confirm('确定删除这个子项？')) {
    store.removeItem(projectId, itemId)
  }
}

function openItem(p: Project, item: ProjectItem) {
  store.selectProject(p.id)
  store.selectItem(item.id)
  // 分镜项目在当前页内嵌 iframe 显示，不跳新窗口
}

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

// Socket 连接
function connectServer() {
  const wsUrl = `http://${window.location.hostname}:3000`
  let uid = localStorage.getItem('studio-user-id')
  if (!uid) {
    uid = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    localStorage.setItem('studio-user-id', uid)
  }
  const uname = localStorage.getItem('studio-user-name') || '用户' + uid.slice(0, 4)
  socketStore.connect(wsUrl, uid, uname)
}

// ── 重命名 ──
const showRenameModal = ref(false)
const renameValue = ref('')
const renameTarget = ref<{ type: 'project'; id: string } | { type: 'item'; projectId: string; itemId: string } | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)

function startRenameProject(p: Project) {
  renameTarget.value = { type: 'project', id: p.id }
  renameValue.value = p.name
  showRenameModal.value = true
  nextTick(() => renameInput.value?.focus())
}

function startRenameItem(item: ProjectItem) {
  if (!store.currentProjectId) return
  renameTarget.value = { type: 'item', projectId: store.currentProjectId, itemId: item.id }
  renameValue.value = item.name
  showRenameModal.value = true
  nextTick(() => renameInput.value?.focus())
}

function doRename() {
  const name = renameValue.value.trim()
  if (!name || !renameTarget.value) return
  if (renameTarget.value.type === 'project') {
    store.renameProject(renameTarget.value.id, name)
  } else {
    store.renameItem(renameTarget.value.projectId, renameTarget.value.itemId, name)
  }
  showRenameModal.value = false
}
watch(() => socketStore.connected, (val) => {
  if (val && socketStore.socket) {
    store.setupSocket(socketStore.socket)
  }
}, { immediate: true })

// 弹窗打开聚焦
watch(showCreateModal, (val) => {
  if (val) nextTick(() => nameInput.value?.focus())
})
</script>

<style scoped>
.project-page { display: flex; flex-direction: column; height: 100vh; background: #f0f2f5; }

/* 顶栏 */
.pp-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: white; border-bottom: 1px solid #dadce0; flex-shrink: 0; }
.pp-title h1 { font-size: 20px; margin: 0; color: #1a1a1a; }
.pp-subtitle { font-size: 12px; color: #888; }

/* 内容区 */
.pp-content { display: flex; flex: 1; overflow: hidden; }

/* 左侧项目列表 */
.pp-projects { width: 280px; overflow-y: auto; background: white; border-right: 1px solid #dadce0; padding: 8px; flex-shrink: 0; }
.pp-project { padding: 10px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; }
.pp-project:hover { background: #f0f2f5; }
.pp-project.active { background: #d2e3fc; }
.pp-project-row { display: flex; align-items: center; gap: 8px; }
.pp-project-icon { font-size: 18px; }
.pp-project-name { flex: 1; font-size: 13px; font-weight: 500; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-project-type { font-size: 10px; color: #888; background: #f0f2f5; padding: 1px 6px; border-radius: 3px; }
.pp-project-owner { font-size: 11px; color: #999; }
.pp-empty { text-align: center; padding: 40px; color: #999; font-size: 13px; }

/* 右侧详情 */
.pp-detail { flex: 1; overflow-y: auto; }
.pp-detail-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 14px; }
.pp-detail-content { height: 100%; }
.pp-detail-full { height: 100%; }
.pp-storyboard-frame { width: 100%; height: 100%; border: none; } /* WhiteboardView 填满 */

/* 项目详情 */
.pp-detail-project { padding: 24px; max-width: 600px; }
.pd-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.pd-icon { font-size: 36px; }
.pd-info { display: flex; flex-direction: column; }
.pd-name { font-size: 20px; font-weight: 600; color: #1a1a1a; }
.pd-meta { font-size: 12px; color: #888; margin-top: 2px; }
.pd-section { margin-bottom: 24px; }
.pd-section-title { font-size: 12px; color: #888; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

/* 子项列表 */
.pd-items { display: flex; flex-direction: column; gap: 4px; }
.pd-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 6px; cursor: pointer; border: 1px solid #eee; }
.pd-item:hover { background: #f0f2f5; border-color: #dadce0; }
.pd-item.active { background: #d2e3fc; border-color: #1a73e8; }
.pd-item-icon { font-size: 18px; }
.pd-item-name { flex: 1; font-size: 14px; color: #333; }
.pd-item-type { font-size: 11px; color: #888; }
.pd-item-del { border: none; background: transparent; cursor: pointer; color: #ccc; font-size: 14px; padding: 2px 6px; opacity: 0; }
.pd-item:hover .pd-item-del { opacity: 1; }
.pd-item-del:hover { color: #c62828; }
.pd-items-empty { color: #aaa; font-size: 13px; padding: 12px; text-align: center; }

/* 4个添加按钮 */
.pd-add-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.pd-add-btn { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 8px; border: 1px solid #dadce0; border-radius: 8px; background: white; cursor: pointer; transition: all 0.15s; }
.pd-add-btn:hover { border-color: #1a73e8; background: #e8f0fe; }
.pd-add-icon { font-size: 24px; }
.pd-add-label { font-size: 12px; color: #555; font-weight: 500; }

/* 按钮 */
.pp-actions { display: flex; align-items: center; gap: 8px; }
.pp-connection { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: #f0f2f5; border-radius: 12px; }
.pp-dot { width: 8px; height: 8px; border-radius: 50%; }
.pp-dot.online { background: #34a853; }
.pp-dot.offline { background: #ea4335; }
.pp-conn-text { font-size: 11px; color: #666; }
.pp-error { position: fixed; top: 60px; left: 50%; transform: translateX(-50%); background: #fce4ec; color: #c62828; padding: 8px 20px; border-radius: 8px; font-size: 13px; z-index: 1001; border: 1px solid #f8bbd0; box-shadow: 0 2px 12px rgba(0,0,0,0.1); animation: fadeIn 0.2s; }
@keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
.pp-btn { padding: 8px 16px; border: 1px solid #dadce0; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; }
.pp-btn.primary { background: #1a73e8; color: white; border: none; }
.pp-btn:disabled { opacity: 0.4; cursor: default; }

/* 弹窗 */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-card { background: white; border-radius: 12px; max-width: 90vw; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-sm { width: 400px; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-title { font-size: 16px; font-weight: 600; }
.modal-close { border: none; background: transparent; cursor: pointer; font-size: 18px; color: #888; padding: 4px; }
.modal-body { padding: 20px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid #eee; }
.form-field { margin-bottom: 12px; }
.form-field label { display: block; font-size: 12px; color: #666; margin-bottom: 6px; font-weight: 500; }
.form-input { width: 100%; padding: 8px 12px; border: 1px solid #dadce0; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
.form-input:focus { border-color: #1a73e8; outline: none; box-shadow: 0 0 0 2px rgba(26,115,232,0.12); }
.form-hint { font-size: 12px; color: #999; margin: 0; }
</style>
