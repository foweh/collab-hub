<template>
  <div class="whiteboard-view">
    <!-- 左侧：元素面板 -->
    <aside class="wb-sidebar">
      <div class="sidebar-section">
        <div class="section-title">基础图形</div>
        <div class="shape-grid">
          <button class="shape-btn" title="矩形" @click="addShape('rectangle')">▬</button>
          <button class="shape-btn" title="椭圆" @click="addShape('ellipse')">⬮</button>
          <button class="shape-btn" title="线条" @click="addShape('line')">╱</button>
          <button class="shape-btn" title="箭头" @click="addShape('arrow')">→</button>
          <button class="shape-btn" title="容器组" @click="addShape('group')">▭</button>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="section-title">BPMN 流程</div>
        <div class="shape-grid">
          <button class="shape-btn" title="开始事件" @click="addShape('bpmn-event')">○</button>
          <button class="shape-btn" title="活动" @click="addShape('bpmn-activity')">▭</button>
          <button class="shape-btn" title="网关" @click="addShape('bpmn-gateway')">◇</button>
          <button class="shape-btn" title="泳道" @click="addShape('swimlane')">▬</button>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="section-title">图表</div>
        <div class="shape-grid">
          <button class="shape-btn" title="UML 类" @click="addShape('uml-class')">C</button>
          <button class="shape-btn" title="ER 实体" @click="addShape('er-entity')">E</button>
        </div>
      </div>
    </aside>

    <!-- 中间：画布 -->
    <div class="wb-canvas-area">
      <WhiteboardCanvas
        :user-id="userId"
        :user-name="userName"
        @cursor-move="onCursorMove"
        @element-add="onElementAdd"
        @element-drag-start="onDragStart"
        @element-drag-end="onDragEnd"
      />
      <Minimap />
    </div>

    <!-- 右侧：多标签面板 -->
    <aside class="wb-props-panel">
      <div class="panel-tabs">
        <button :class="['tab-btn', { active: activeTab === 'props' }]" @click="activeTab = 'props'">属性</button>
        <button :class="['tab-btn', { active: activeTab === 'align' }]" @click="activeTab = 'align'">对齐</button>
        <button :class="['tab-btn', { active: activeTab === 'vars' }]" @click="activeTab = 'vars'">变量</button>
        <button :class="['tab-btn', { active: activeTab === 'comments' }]" @click="activeTab = 'comments'">
          批注 <span v-if="commentsStore.openCount > 0" style="background:#1a73e8;color:#fff;border-radius:8px;padding:0 5px;font-size:10px;margin-left:2px">{{ commentsStore.openCount }}</span>
        </button>
      </div>

      <!-- 属性标签 -->
      <div v-if="activeTab === 'props' && selectedEl" class="tab-content">
        <div class="section-title">属性</div>
        <div class="prop-group">
          <label>X</label>
          <input type="number" :value="Math.round(selectedEl.x)" @input="updateProp('x', +($event.target as HTMLInputElement).value)" />
          <label>Y</label>
          <input type="number" :value="Math.round(selectedEl.y)" @input="updateProp('y', +($event.target as HTMLInputElement).value)" />
        </div>
        <div class="prop-group">
          <label>宽度</label>
          <input type="number" :value="Math.round(selectedEl.width)" @input="updateProp('width', +($event.target as HTMLInputElement).value)" />
          <label>高度</label>
          <input type="number" :value="Math.round(selectedEl.height)" @input="updateProp('height', +($event.target as HTMLInputElement).value)" />
        </div>
        <div class="prop-group">
          <label>旋转</label>
          <input type="number" :value="Math.round(selectedEl.rotation)" @input="updateProp('rotation', +($event.target as HTMLInputElement).value)" min="0" max="360" />
        </div>
        <div class="prop-group">
          <label>填充色</label>
          <input type="color" :value="selectedEl.fill" @input="updateProp('fill', ($event.target as HTMLInputElement).value)" />
          <label>描边色</label>
          <input type="color" :value="selectedEl.stroke" @input="updateProp('stroke', ($event.target as HTMLInputElement).value)" />
        </div>
        <div class="prop-group">
          <label>不透明度</label>
          <input type="range" :value="selectedEl.opacity" @input="updateProp('opacity', +($event.target as HTMLInputElement).value)" min="0" max="1" step="0.05" />
        </div>
        <button class="prop-delete" @click="deleteSelected">删除选中</button>
      </div>
      <div v-else-if="activeTab === 'props' && !selectedEl" class="tab-content dim">选中元素以查看属性</div>

      <!-- 对齐标签 -->
      <div v-if="activeTab === 'align'" class="tab-content">
        <div class="section-title">对齐</div>
        <div class="align-grid">
          <button class="align-btn" title="左对齐" @click="doAlign('left')">⇤</button>
          <button class="align-btn" title="水平居中" @click="doAlign('center-h')">↔</button>
          <button class="align-btn" title="右对齐" @click="doAlign('right')">⇥</button>
          <button class="align-btn" title="顶部对齐" @click="doAlign('top')">⇧</button>
          <button class="align-btn" title="垂直居中" @click="doAlign('center-v')">↕</button>
          <button class="align-btn" title="底部对齐" @click="doAlign('bottom')">⇩</button>
        </div>
        <div class="section-title" style="margin-top:8px">分布</div>
        <div class="align-grid">
          <button class="align-btn" title="水平分布" @click="doDistribute('horizontal')">≡</button>
          <button class="align-btn" title="垂直分布" @click="doDistribute('vertical')">≣</button>
        </div>
        <div class="section-title" style="margin-top:8px">布尔运算</div>
        <div class="align-grid">
          <button class="align-btn bo" title="并集" @click="doBooleanOp('union')">∪</button>
          <button class="align-btn bo" title="交集" @click="doBooleanOp('intersect')">∩</button>
          <button class="align-btn bo" title="差集" @click="doBooleanOp('subtract')">−</button>
          <button class="align-btn bo" title="排除" @click="doBooleanOp('exclude')">⊖</button>
        </div>
      </div>

      <!-- 变量标签 -->
      <div v-if="activeTab === 'vars'" class="tab-content" style="padding:0">
        <DesignVariablesPanel />
      </div>

      <!-- 批注标签 -->
      <div v-if="activeTab === 'comments'" class="tab-content" style="padding:0;overflow:hidden">
        <CommentsPanel />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWhiteboardStore } from '../../stores/whiteboard'
import { useSocketStore } from '../../stores/socket'
import { useCommentsStore } from '../../stores/comments'
import WhiteboardCanvas from './WhiteboardCanvas.vue'
import Minimap from './Minimap.vue'
import DesignVariablesPanel from './DesignVariablesPanel.vue'
import CommentsPanel from './CommentsPanel.vue'
import { alignElements, distributeElements } from '../../composables/useAlignment'
import { performBooleanOp, type BooleanOp } from '../../composables/useBooleanOps'
import type { WhiteboardElement } from '../../types/whiteboard'
import type { AlignMode } from '../../composables/useAlignment'

const props = defineProps<{ userId: string; userName: string }>()
const store = useWhiteboardStore()
const socketStore = useSocketStore()
const commentsStore = useCommentsStore()

const selectedEl = computed(() => store.selectedElements[0] || null)
const activeTab = ref<'props' | 'align' | 'vars' | 'comments'>('props')

// 初始化批注
if (socketStore.socket) {
  commentsStore.setupSocket(socketStore.socket)
  commentsStore.init('whiteboard-1')
}

function addShape(type: WhiteboardElement['type']) {
  store.setActiveTool('select')
  const now = Date.now()
  const el: WhiteboardElement = {
    id: 'el_' + crypto.randomUUID().slice(0, 8),
    type,
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
    width: type === 'bpmn-event' ? 60 : type === 'bpmn-gateway' ? 60 : type === 'ellipse' ? 120 : 120,
    height: type === 'bpmn-event' ? 60 : type === 'bpmn-gateway' ? 60 : 80,
    rotation: 0,
    opacity: 1,
    fill: getDefaultFill(type),
    stroke: '#1a73e8',
    strokeWidth: 2,
    visible: true,
    locked: false,
    attrs: type === 'group' ? { layout: { direction: 'horizontal', gap: 8, padding: 12, align: 'center', sizing: 'flex' }, children: [] } : {},
    createdBy: props.userId,
    modifiedBy: props.userName,
    createdAt: now,
    modifiedAt: now,
  }
  store.addElement(el)
  socketStore.emitElementAdd(el)
}

function getDefaultFill(type: string): string {
  switch (type) {
    case 'bpmn-event': return '#fff3e0'
    case 'bpmn-activity': return '#e8f5e9'
    case 'bpmn-gateway': return '#fce4ec'
    case 'swimlane': return '#e3f2fd'
    case 'uml-class': return '#f3e5f5'
    case 'er-entity': return '#e0f2f1'
    case 'group': return 'rgba(26,115,232,0.04)'
    default: return '#e8f0fe'
  }
}

function updateProp(key: string, value: any) {
  if (!selectedEl.value) return
  store.updateElement(selectedEl.value.id, { [key]: value, modifiedBy: props.userId } as any)
}

function deleteSelected() {
  if (!selectedEl.value) return
  store.deleteElement(selectedEl.value.id)
  socketStore.emitElementDelete(selectedEl.value.id)
}

function doAlign(mode: AlignMode) {
  const selected = store.selectedElements
  if (selected.length < 2) return
  alignElements(selected, mode)
  // sync
  selected.forEach(el => {
    socketStore.emitElementUpdate(el.id, { x: el.x, y: el.y })
  })
}

function doDistribute(mode: 'horizontal' | 'vertical') {
  const selected = store.selectedElements
  if (selected.length < 3) return
  distributeElements(selected, mode)
  selected.forEach(el => {
    socketStore.emitElementUpdate(el.id, { x: el.x, y: el.y })
  })
}

function doBooleanOp(op: BooleanOp) {
  const selected = store.selectedElements
  if (selected.length < 2) return
  const { result, deleteIds } = performBooleanOp(op as any, selected, props.userId)
  // 删除原元素
  deleteIds.forEach(id => {
    store.deleteElement(id)
    socketStore.emitElementDelete(id)
  })
  // 创建结果元素
  result.forEach((patch, i) => {
    const now = Date.now()
    const el: WhiteboardElement = {
      id: 'el_' + crypto.randomUUID().slice(0, 8),
      type: 'rectangle',
      x: patch.x || 0,
      y: patch.y || 0,
      width: patch.width || 100,
      height: patch.height || 100,
      rotation: 0,
      opacity: 1,
      fill: patch.fill as string || '#e8f0fe',
      stroke: patch.stroke as string || '#1a73e8',
      strokeWidth: patch.strokeWidth as number || 2,
      visible: true,
      locked: false,
      attrs: {},
      createdBy: props.userId,
      modifiedBy: props.userName,
      createdAt: now,
      modifiedAt: now,
    }
    store.addElement(el)
    socketStore.emitElementAdd(el)
  })
}

function onCursorMove(pos: { x: number; y: number }) {
  socketStore.emitCursor(pos)
}

function onElementAdd(el: WhiteboardElement) {
  socketStore.emitElementAdd(el)
}

function onDragStart(id: string) {
  // noop
}

function onDragEnd(id: string) {
  const el = store.elements.find(e => e.id === id)
  if (el) {
    socketStore.emitElementUpdate(id, { x: el.x, y: el.y, modifiedBy: props.userId })
  }
}
</script>

<style scoped>
.whiteboard-view { display: flex; width: 100%; height: 100%; }
.wb-sidebar { width: 68px; background: #f8f9fa; border-right: 1px solid #dadce0; display: flex; flex-direction: column; padding: 8px; gap: 12px; overflow-y: auto; }
.sidebar-section { display: flex; flex-direction: column; gap: 4px; }
.section-title { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 0; }
.shape-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.shape-btn { width: 28px; height: 28px; border: 1px solid #dadce0; background: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #444; transition: all 0.15s; }
.shape-btn:hover { background: #e8eaed; border-color: #bbb; }
.wb-canvas-area { flex: 1; position: relative; overflow: hidden; }
.wb-props-panel { width: 240px; background: #f8f9fa; border-left: 1px solid #dadce0; display: flex; flex-direction: column; overflow-y: auto; }
.panel-tabs { display: flex; border-bottom: 1px solid #dadce0; flex-shrink: 0; }
.tab-btn { flex: 1; padding: 8px; border: none; background: transparent; cursor: pointer; font-size: 12px; color: #666; border-bottom: 2px solid transparent; }
.tab-btn.active { color: #1a73e8; border-bottom-color: #1a73e8; background: white; }
.tab-content { padding: 12px; flex: 1; overflow-y: auto; }
.tab-content.dim { color: #999; font-size: 12px; text-align: center; padding-top: 24px; }
.prop-group { display: grid; grid-template-columns: 40px 1fr; gap: 4px 8px; align-items: center; margin-bottom: 6px; }
.prop-group label { font-size: 11px; color: #666; text-align: right; }
.prop-group input[type="number"], .prop-group input[type="color"] { width: 100%; padding: 3px 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px; }
.prop-group input[type="range"] { width: 100%; }
.prop-delete { margin-top: 8px; padding: 6px 12px; background: #fce4ec; border: 1px solid #f8bbd0; border-radius: 4px; color: #c62828; cursor: pointer; font-size: 12px; }
.align-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.align-btn { padding: 8px; background: white; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 16px; color: #444; text-align: center; }
.align-btn:hover { background: #e8eaed; }
.align-btn.bo { color: #1a73e8; font-weight: bold; }
</style>
