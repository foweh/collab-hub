<template>
  <div class="mindmap-page">
    <header class="mm-toolbar">
      <h2>思维导图</h2>
      <div class="mm-actions">
        <button class="mm-btn" @click="addRootNode">添加根节点</button>
        <button class="mm-btn" @click="addChildNode">添加子节点</button>
        <button class="mm-btn" @click="autoLayout">自动布局</button>
        <button class="mm-btn" @click="collapseAll">全部折叠</button>
        <button class="mm-btn" @click="expandAll">全部展开</button>
      </div>
      <router-link to="/whiteboard" class="mm-back">← 返回白板</router-link>
    </header>
    <div ref="containerRef" class="mm-canvas-container">
      <v-stage ref="stageRef" :config="stageConfig" @wheel="onWheel">
        <v-layer>
          <v-line v-for="conn in connLines" :key="'c-'+conn.from" :config="conn.config" />
        </v-layer>
        <v-layer>
          <v-group v-for="node in layoutNodes" :key="node.id" :config="nodeGroupConfig(node)"
            :draggable="true" @dragend="onDragEnd(node, $event)"
            @dblclick="editNode(node)">
            <v-rect v-if="node.shape==='rounded-rect'" :config="nodeRectConfig(node)" />
            <v-ellipse v-else-if="node.shape==='ellipse'" :config="nodeEllipseConfig(node)" />
            <v-line v-else :config="nodeDiamondConfig(node)" />
            <v-text :config="nodeTextConfig(node)" />
          </v-group>
        </v-layer>
      </v-stage>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useWhiteboardStore } from '../stores/whiteboard'
import { useSocketStore } from '../stores/socket'
import { layoutMindmap, getMindmapConnector, type MindmapNode } from '../composables/useMindmap'

const store = useWhiteboardStore()
const socketStore = useSocketStore()

const containerRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<any>(null)
const containerSize = reactive({ width: 800, height: 600 })

const stageConfig = computed(() => ({ width: containerSize.width, height: containerSize.height }))

// 从 store 中提取导图节点
const mmNodes = computed(() => {
  const mindmapEls = store.elements.filter(e => e.type === 'mindmap-node')
  return mindmapEls.map(el => ({
    id: el.id,
    text: (el.attrs as any)?.text || '节点',
    color: (el.attrs as any)?.color || '#4a90d9',
    shape: ((el.attrs as any)?.shape || 'rounded-rect') as MindmapNode['shape'],
    children: (el.attrs as any)?.children || [],
    collapsed: (el.attrs as any)?.collapsed || false,
    level: (el.attrs as any)?.level || 0,
    parentId: (el.attrs as any)?.parentId || null,
    x: el.x,
    y: el.y,
    width: el.width || 120,
    height: el.height || 40,
  }))
})

// 自动布局后的节点
const layoutNodes = ref<MindmapNode[]>([])

// 连接线
const connLines = computed(() => {
  const lines: { from: string; to: string; config: any }[] = []
  for (const node of layoutNodes.value) {
    if (node.collapsed) continue
    for (const childId of node.children) {
      const child = layoutNodes.value.find(n => n.id === childId)
      if (!child) continue
      const conn = getMindmapConnector(node, child)
      lines.push({
        from: node.id,
        to: childId,
        config: { ...conn, stroke: '#999', strokeWidth: 1.5, lineJoin: 'round', tension: 0.3 },
      })
    }
  }
  return lines
})

function nodeGroupConfig(node: MindmapNode) {
  return { x: node.x, y: node.y, draggable: true }
}

function nodeRectConfig(node: MindmapNode) {
  return { width: node.width, height: node.height, fill: node.color, stroke: '#333', strokeWidth: 1.5, cornerRadius: 8, shadowColor: 'rgba(0,0,0,0.1)', shadowBlur: 4, shadowOffsetY: 2 }
}

function nodeEllipseConfig(node: MindmapNode) {
  return { x: node.width / 2, y: node.height / 2, radiusX: node.width / 2, radiusY: node.height / 2, fill: node.color, stroke: '#333', strokeWidth: 1.5 }
}

function nodeDiamondConfig(node: MindmapNode) {
  const cx = node.width / 2, cy = node.height / 2
  return { points: [cx, 0, node.width, cy, cx, node.height, 0, cy], closed: true, fill: node.color, stroke: '#333', strokeWidth: 1.5 }
}

function nodeTextConfig(node: MindmapNode) {
  return { x: node.width / 2, y: node.height / 2, text: node.text, fontSize: 12, fill: '#fff', fontFamily: 'sans-serif', align: 'center', verticalAlign: 'middle' }
}

function addRootNode() {
  const id = 'mm_' + crypto.randomUUID().slice(0, 8)
  const node: MindmapNode = { id, text: '中心主题', color: '#4a90d9', shape: 'rounded-rect', children: [], collapsed: false, level: 0, parentId: null, x: 50, y: 50, width: 140, height: 44 }
  layoutNodes.value.push(node)
  syncToStore()
}

function addChildNode() {
  const selected = store.selectedElements[0]
  if (!selected || selected.type !== 'mindmap-node') {
    const root = layoutNodes.value.find(n => n.level === 0)
    if (!root) { addRootNode(); return }
    const id = 'mm_' + crypto.randomUUID().slice(0, 8)
    const node: MindmapNode = { id, text: '子节点', color: '#7eb8da', shape: 'rounded-rect', children: [], collapsed: false, level: 1, parentId: root.id, x: root.x + 160, y: root.y + 60, width: 120, height: 36 }
    root.children.push(id)
    layoutNodes.value.push(node)
    syncToStore()
    return
  }
  const parent = layoutNodes.value.find(n => n.id === selected.id)
  if (!parent) return
  const id = 'mm_' + crypto.randomUUID().slice(0, 8)
  const node: MindmapNode = { id, text: '子节点', color: parent.level < 2 ? '#7eb8da' : '#b8d4f0', shape: 'rounded-rect', children: [], collapsed: false, level: parent.level + 1, parentId: parent.id, x: parent.x + 160, y: parent.y + 60, width: 110, height: 32 }
  parent.children.push(id)
  layoutNodes.value.push(node)
  syncToStore()
}

function autoLayout() {
  layoutNodes.value = layoutMindmap(layoutNodes.value, 50, 50, 50, 16, 140, 44)
  syncToStore()
}

function collapseAll() {
  layoutNodes.value.forEach(n => { if (n.children.length > 0) n.collapsed = true })
}

function expandAll() {
  layoutNodes.value.forEach(n => n.collapsed = false)
}

function onDragEnd(node: MindmapNode, e: any) {
  node.x = e.target.x()
  node.y = e.target.y()
  syncToStore()
}

function editNode(node: MindmapNode) {
  const newText = prompt('编辑节点文字:', node.text)
  if (newText && newText.trim()) {
    node.text = newText.trim()
    syncToStore()
  }
}

function syncToStore() {
  // 清除旧 mindmap 节点
  const oldIds = new Set(store.elements.filter(e => e.type === 'mindmap-node').map(e => e.id))
  // 更新
  const now = Date.now()
  const userId = socketStore.myUserId
  for (const node of layoutNodes.value) {
    oldIds.delete(node.id)
    const existing = store.elements.find(e => e.id === node.id)
    if (existing) {
      Object.assign(existing, {
        x: node.x, y: node.y, width: node.width, height: node.height,
        fill: node.color, modifiedAt: now,
        attrs: { text: node.text, color: node.color, shape: node.shape, children: node.children, collapsed: node.collapsed, level: node.level, parentId: node.parentId },
      })
    } else {
      store.addElement({
        id: node.id,
        type: 'mindmap-node',
        x: node.x, y: node.y, width: node.width, height: node.height,
        rotation: 0, opacity: 1, fill: node.color,
        stroke: '#333', strokeWidth: 1.5,
        visible: true, locked: false,
        attrs: { text: node.text, color: node.color, shape: node.shape, children: node.children, collapsed: node.collapsed, level: node.level, parentId: node.parentId },
        createdBy: userId, modifiedBy: userId, createdAt: now, modifiedAt: now,
      })
    }
  }
  // 删除多余的
  for (const id of oldIds) {
    store.deleteElement(id)
  }
}

function onWheel(e: any) {
  e.evt.preventDefault()
  const stage = e.target.getStage()
  if (!stage) return
  const oldScale = stage.scaleX()
  const pointer = stage.getPointerPosition()
  if (!pointer) return
  const factor = e.evt.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.1, Math.min(5, oldScale * factor))
  const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale }
  stage.scale({ x: newScale, y: newScale })
  stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale })
}

onMounted(() => {
  const observer = new ResizeObserver(entries => {
    const entry = entries[0]
    if (entry) { containerSize.width = entry.contentRect.width; containerSize.height = entry.contentRect.height }
  })
  if (containerRef.value) observer.observe(containerRef.value)

  // 从 store 加载已有节点
  const existing = store.elements.filter(e => e.type === 'mindmap-node')
  if (existing.length > 0) {
    layoutNodes.value = existing.map(el => ({
      id: el.id,
      text: (el.attrs as any)?.text || '节点',
      color: (el.attrs as any)?.color || '#4a90d9',
      shape: ((el.attrs as any)?.shape || 'rounded-rect') as MindmapNode['shape'],
      children: (el.attrs as any)?.children || [],
      collapsed: (el.attrs as any)?.collapsed || false,
      level: (el.attrs as any)?.level || 0,
      parentId: (el.attrs as any)?.parentId || null,
      x: el.x, y: el.y, width: el.width || 120, height: el.height || 40,
    }))
  }
})
</script>

<style scoped>
.mindmap-page { display: flex; flex-direction: column; height: 100vh; }
.mm-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #f8f9fa; border-bottom: 1px solid #dadce0; flex-shrink: 0; }
.mm-toolbar h2 { font-size: 16px; color: #333; margin: 0; margin-right: 16px; }
.mm-actions { display: flex; gap: 4px; flex: 1; }
.mm-btn { padding: 6px 12px; background: white; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px; color: #444; }
.mm-btn:hover { background: #e8eaed; }
.mm-back { font-size: 12px; color: #1a73e8; text-decoration: none; }
.mm-canvas-container { flex: 1; overflow: hidden; background: #f0f2f5; }
</style>
