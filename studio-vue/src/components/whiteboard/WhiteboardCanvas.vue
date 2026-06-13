<template>
  <div ref="containerRef" class="whiteboard-container" @contextmenu.prevent>
    <!-- 工具栏 -->
    <div class="wb-toolbar">
      <button v-for="tool in tools" :key="tool.id"
        :class="['wb-tool-btn', { active: store.activeTool === tool.id }]"
        :title="tool.label"
        @click="store.setActiveTool(tool.id)">
        <span v-html="tool.icon"></span>
      </button>
      <div class="toolbar-separator"></div>
      <button class="wb-tool-btn" title="撤销 (Ctrl+Z)" @click="store.undo()">↩</button>
      <button class="wb-tool-btn" title="恢复 (Ctrl+Shift+Z)" @click="store.redo()">↪</button>
      <button class="wb-tool-btn" title="复制 (Ctrl+C)" @click="store.copySelected()">📋</button>
      <button class="wb-tool-btn" title="粘贴 (Ctrl+V)" @click="store.pasteElements(userId)">📄</button>
      <div class="toolbar-separator"></div>
      <span class="zoom-label">{{ Math.round(store.scale * 100) }}%</span>
      <button class="wb-tool-btn" title="重置视图" @click="resetView">⊞</button>
    </div>

    <!-- Konva Stage -->
    <v-stage ref="stageRef" :config="stageConfig"
      @wheel="onWheel"
      @mousedown="onPointerDown"
      @mousemove="onPointerMove"
      @mouseup="onPointerUp"
      @touchstart="onPointerDown"
      @touchmove="onPointerMove"
      @touchend="onPointerUp"
    >
      <!-- 网格层 -->
      <v-layer ref="gridLayer">
        <v-line v-for="(line, i) in gridLines" :key="'g-'+i" :config="line" />
      </v-layer>

      <!-- 元素层 -->
      <v-layer ref="elementLayer">
        <!-- 已添加的元素 -->
        <template v-for="el in store.elements" :key="el.id">
          <!-- 矩形 -->
          <v-rect v-if="el.type === 'rectangle'"
            :config="shapeConfig(el)"
            @click="select(el.id)"
            @dragstart="onDragStart(el)"
            @dragend="onDragEnd(el)"
          />
        </template>

        <!-- 正在绘制的预览 -->
        <v-rect v-if="drawing.active && (drawing.type==='rectangle')"
          :config="drawPreviewRect" />

        <!-- 远程光标 -->
        <template v-for="cursor in store.remoteCursors" :key="cursor[0]">
          <v-circle v-if="false" :config="cursorConfig(cursor[1])" />
          <v-text :config="cursorLabelConfig(cursor[1])" />
        </template>
      </v-layer>
    </v-stage>

    <!-- 右下角：缩放控件 -->
    <div class="wb-zoom-controls">
      <button class="zoom-btn" @click="zoomIn">+</button>
      <span class="zoom-val">{{ Math.round(store.scale * 100) }}%</span>
      <button class="zoom-btn" @click="zoomOut">−</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue'
import Konva from 'konva'
import { useWhiteboardStore } from '../../stores/whiteboard'
import { useCanvas } from '../../composables/useCanvas'
import { useDrawing } from '../../composables/useDrawing'
import type { WhiteboardElement, RemoteCursor } from '../../types/whiteboard'

const props = defineProps<{ userId: string; userName: string }>()
const store = useWhiteboardStore()
const { handleWheel, handlePointerDown, handlePointerMove, handlePointerUp, createElement } = useCanvas()
const { drawing, startDraw, updateDraw, endDraw, cancelDraw } = useDrawing()

const containerRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<any>(null)
const gridLayer = ref<any>(null)
const elementLayer = ref<any>(null)
const containerSize = reactive({ width: 1200, height: 800 })

const tools = [
  { id: 'select', label: '选择 (V)', icon: '⬆' },
  { id: 'rectangle', label: '矩形 (R)', icon: '▬' },
  { id: 'ellipse', label: '椭圆 (O)', icon: '⬮' },
  { id: 'line', label: '线条 (L)', icon: '╱' },
  { id: 'arrow', label: '箭头 (A)', icon: '→' },
  { id: 'pencil', label: '铅笔 (P)', icon: '✎' },
  { id: 'text', label: '文本 (T)', icon: 'T' },
  { id: 'connector', label: '连接线 (C)', icon: '⚡' },
]

const stageConfig = computed(() => ({
  width: containerSize.width,
  height: containerSize.height,
  draggable: false,
}))

// 网格线
const gridLines = computed(() => {
  const lines: any[] = []
  const gridSize = 20 * store.scale
  if (gridSize < 5) return lines
  const w = containerSize.width / store.scale
  const h = containerSize.height / store.scale
  const ox = (-store.offsetX) / store.scale
  const oy = (-store.offsetY) / store.scale
  const startX = Math.floor(ox / gridSize) * gridSize
  const startY = Math.floor(oy / gridSize) * gridSize
  for (let x = startX; x < ox + w; x += gridSize) {
    lines.push({ x, y: oy, points: [0, 0, 0, h], stroke: '#e0e0e0', strokeWidth: 0.5 })
  }
  for (let y = startY; y < oy + h; y += gridSize) {
    lines.push({ x: ox, y, points: [0, 0, w, 0], stroke: '#e0e0e0', strokeWidth: 0.5 })
  }
  return lines
})

function shapeConfig(el: WhiteboardElement): any {
  return {
    x: el.x, y: el.y,
    width: el.width, height: el.height,
    fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth,
    draggable: store.activeTool === 'select',
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible,
  }
}

const drawPreviewRect = computed(() => ({
  x: Math.min(drawing.startX, drawing.currentX),
  y: Math.min(drawing.startY, drawing.currentY),
  width: Math.abs(drawing.currentX - drawing.startX),
  height: Math.abs(drawing.currentY - drawing.startY),
  fill: 'rgba(26, 115, 232, 0.15)',
  stroke: '#1a73e8',
  strokeWidth: 1,
  dash: [5, 5],
}))

function cursorConfig(cursor: RemoteCursor) {
  return { x: cursor.x, y: cursor.y, radius: 3, fill: cursor.color }
}

function cursorLabelConfig(cursor: RemoteCursor) {
  return {
    x: cursor.x + 8, y: cursor.y - 8,
    text: cursor.userName,
    fontSize: 11,
    fill: cursor.color,
    fontFamily: 'sans-serif',
  }
}

function onWheel(e: any) {
  handleWheel(e)
}

function onPointerDown(e: any) {
  const pointer = e.target.getStage()?.getPointerPosition()
  if (!pointer) return

  if (store.activeTool !== 'select') {
    const stage = e.target.getStage()
    const p = { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() }
    startDraw(store.activeTool, p.x, p.y)
  } else {
    handlePointerDown(e)
  }
}

function onPointerMove(e: any) {
  if (drawing.active) {
    const stage = e.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (pointer) {
      const p = { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() }
      updateDraw(p.x, p.y)
    }
  } else {
    handlePointerMove(e)
  }

  // 发送光标位置
  const stage = e.target.getStage()
  const pointer = stage?.getPointerPosition()
  if (pointer) {
    emit('cursor-move', { x: pointer.x, y: pointer.y })
  }
}

function onPointerUp(e: any) {
  handlePointerUp()
  if (drawing.active) {
    const el = endDraw(props.userId)
    if (el && (el.width > 5 || el.height > 5)) {
      store.addElement(el)
      emit('element-add', el)
    } else {
      cancelDraw()
    }
  }
}

function select(id: string) {
  store.select(id, false)
}

function onDragStart(el: WhiteboardElement) {
  emit('element-drag-start', el.id)
}

function onDragEnd(el: WhiteboardElement) {
  emit('element-drag-end', el.id)
}

function resetView() {
  const stage = stageRef.value?.getNode()
  if (!stage) return
  stage.scale({ x: 1, y: 1 })
  stage.position({ x: 0, y: 0 })
  store.setViewTransform(1, 0, 0)
}

function zoomIn() {
  const stage = stageRef.value?.getNode()
  if (!stage) return
  const newScale = Math.min(5, store.scale * 1.2)
  stage.scale({ x: newScale, y: newScale })
  store.setViewTransform(newScale, stage.x(), stage.y())
}

function zoomOut() {
  const stage = stageRef.value?.getNode()
  if (!stage) return
  const newScale = Math.max(0.1, store.scale / 1.2)
  stage.scale({ x: newScale, y: newScale })
  store.setViewTransform(newScale, stage.x(), stage.y())
}

const emit = defineEmits<{
  'cursor-move': [pos: { x: number; y: number }]
  'element-add': [el: WhiteboardElement]
  'element-drag-start': [id: string]
  'element-drag-end': [id: string]
}>()

onMounted(() => {
  const observer = new ResizeObserver(entries => {
    const entry = entries[0]
    if (entry) {
      containerSize.width = entry.contentRect.width
      containerSize.height = entry.contentRect.height
    }
  })
  if (containerRef.value) observer.observe(containerRef.value)
})

// 键盘快捷键
function onKeyDown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { store.undo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'z' && e.shiftKey) { store.redo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'y') { store.redo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'c') { store.copySelected(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'v') { store.pasteElements(props.userId); e.preventDefault() }
  // 快捷键切换工具
  const keyMap: Record<string, string> = { v: 'select', r: 'rectangle', o: 'ellipse', l: 'line', a: 'arrow', p: 'pencil', t: 'text', c: 'connector' }
  const tool = keyMap[e.key.toLowerCase()]
  if (tool) { store.setActiveTool(tool as any); e.preventDefault() }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    store.selectedIds.forEach(id => store.deleteElement(id))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.whiteboard-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #f8f9fa;
  overflow: hidden;
}

.wb-toolbar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: rgba(255,255,255,0.95);
  border: 1px solid #dadce0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 10;
}

.wb-tool-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  color: #444;
}

.wb-tool-btn:hover { background: #e8eaed; }
.wb-tool-btn.active { background: #d2e3fc; color: #1a73e8; }

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: #dadce0;
  margin: 0 4px;
}

.zoom-label {
  font-size: 12px;
  color: #666;
  min-width: 36px;
  text-align: center;
}

.wb-zoom-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.9);
  padding: 4px 12px;
  border-radius: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  z-index: 10;
}

.zoom-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #dadce0;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #444;
}

.zoom-val { font-size: 13px; color: #666; min-width: 36px; text-align: center; }
</style>
