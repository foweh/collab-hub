<template>
  <div class="whiteboard-view">
    <!-- 左侧：元素面板 -->
    <aside class="wb-sidebar">
      <div class="sidebar-section">
        <div class="section-title">基础图形</div>
        <div class="shape-grid">
          <button class="shape-btn" title="矩形" @click="addShape('rectangle')">
            <svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="5" width="18" height="14" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="shape-btn" title="椭圆" @click="addShape('ellipse')">
            <svg viewBox="0 0 24 24" width="24" height="24"><ellipse cx="12" cy="12" rx="9" ry="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="shape-btn" title="线条" @click="addShape('line')">
            <svg viewBox="0 0 24 24" width="24" height="24"><line x1="3" y1="19" x2="21" y2="5" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="shape-btn" title="箭头" @click="addShape('arrow')">
            <svg viewBox="0 0 24 24" width="24" height="24"><line x1="3" y1="19" x2="18" y2="6" stroke="currentColor" stroke-width="1.5"/><polyline points="14,6 19,6 19,11" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
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

    <!-- 右侧：属性面板 -->
    <aside v-if="selectedEl" class="wb-props-panel">
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
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWhiteboardStore } from '../../stores/whiteboard'
import { useSocketStore } from '../../stores/socket'
import WhiteboardCanvas from './WhiteboardCanvas.vue'
import Minimap from './Minimap.vue'
import type { WhiteboardElement } from '../../types/whiteboard'

const props = defineProps<{ userId: string; userName: string }>()
const store = useWhiteboardStore()
const socketStore = useSocketStore()

const selectedEl = computed(() => store.selectedElements[0] || null)

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
    attrs: {},
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

function onCursorMove(pos: { x: number; y: number }) {
  socketStore.emitCursor(pos)
}

function onElementAdd(el: WhiteboardElement) {
  socketStore.emitElementAdd(el)
}

function onDragStart(id: string) {
  // 暂不处理
}

function onDragEnd(id: string) {
  const el = store.elements.find(e => e.id === id)
  if (el) {
    socketStore.emitElementUpdate(id, { x: el.x, y: el.y, modifiedBy: props.userId })
  }
}
</script>

<style scoped>
.whiteboard-view {
  display: flex;
  width: 100%;
  height: 100%;
}

.wb-sidebar {
  width: 68px;
  background: #f8f9fa;
  border-right: 1px solid #dadce0;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 12px;
  overflow-y: auto;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  font-size: 10px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 0;
}

.shape-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.shape-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #dadce0;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #444;
  transition: all 0.15s;
}

.shape-btn:hover {
  background: #e8eaed;
  border-color: #bbb;
}

.wb-canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.wb-props-panel {
  width: 220px;
  background: #f8f9fa;
  border-left: 1px solid #dadce0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.prop-group {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 4px 8px;
  align-items: center;
}

.prop-group label {
  font-size: 11px;
  color: #666;
  text-align: right;
}

.prop-group input[type="number"],
.prop-group input[type="color"] {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font-size: 12px;
}

.prop-group input[type="range"] {
  width: 100%;
}

.prop-delete {
  margin-top: 8px;
  padding: 6px 12px;
  background: #fce4ec;
  border: 1px solid #f8bbd0;
  border-radius: 4px;
  color: #c62828;
  cursor: pointer;
  font-size: 12px;
}
</style>
