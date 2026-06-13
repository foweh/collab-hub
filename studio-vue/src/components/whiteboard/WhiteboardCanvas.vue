<template>
  <div ref="containerRef" class="whiteboard-container" @contextmenu.prevent>
    <!-- 工具栏 -->
    <div class="wb-toolbar">
      <button v-for="tool in tools" :key="tool.id"
        :class="['wb-tool-btn', { active: store.activeTool === tool.id }]"
        :title="tool.label"
        @click="store.setActiveTool(tool.id as any)">
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

      <!-- 连接线层 -->
      <v-layer ref="connectorLayer">
        <!-- 已有连接线 -->
        <template v-for="conn in connectors" :key="conn.id">
          <v-line v-if="conn.path.length >= 2"
            :config="connectorLineConfig(conn)"
            @click="selectConnector(conn.id)" />
        </template>
        <!-- 正在拖拽的连接线预览 -->
        <v-line v-if="drawingConnector.active"
          :config="drawingConnectorLine" />
      </v-layer>

      <!-- 元素层 -->
      <v-layer ref="elementLayer">
        <template v-for="el in store.elements" :key="el.id">
          <!-- 矩形 / BPMN 活动 -->
          <v-group v-if="['rectangle','bpmn-activity','er-entity'].includes(el.type)"
            :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)"
            @dragstart="emit('element-drag-start', el.id)"
            @dragend="emit('element-drag-end', el.id)">
            <v-rect :config="rectConfig(el)" />
          </v-group>

          <!-- 椭圆 -->
          <v-group v-else-if="el.type==='ellipse'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-ellipse :config="ellipseConfig(el)" />
          </v-group>

          <!-- BPMN 事件 -->
          <v-group v-else-if="el.type==='bpmn-event'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-circle :config="bpmnEventConfig(el)" />
            <v-circle :config="bpmnEventInnerConfig(el)" />
          </v-group>

          <!-- BPMN 网关 -->
          <v-group v-else-if="el.type==='bpmn-gateway'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-line :config="diamondConfig(el)" />
          </v-group>

          <!-- 泳道 -->
          <v-group v-else-if="el.type==='swimlane'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-rect v-for="(lane,li) in swimlaneLanes(el)" :key="'lane-'+li" :config="lane" />
            <v-text v-for="(label,li) in swimlaneLabels(el)" :key="'lbl-'+li" :config="label" />
          </v-group>

          <!-- UML 类图 -->
          <v-group v-else-if="el.type==='uml-class'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-rect :config="umlBgConfig(el)" />
            <v-rect :config="umlHeaderConfig(el)" />
            <v-text :config="umlTitleConfig(el)" />
            <v-line :config="umlDivider1Config(el)" />
            <v-text v-for="(f,fi) in umlFields(el)" :key="'f-'+fi" :config="f" />
            <v-line v-if="umlMethods(el).length" :config="umlDivider2Config(el)" />
            <v-text v-for="(m,mi) in umlMethods(el)" :key="'m-'+mi" :config="m" />
          </v-group>

          <!-- 线条 -->
          <v-group v-else-if="el.type==='line'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-line :config="lineConfig(el)" />
          </v-group>

          <!-- 箭头 -->
          <v-group v-else-if="el.type==='arrow'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-line :config="arrowLineConfig(el)" />
            <v-line :config="arrowHeadConfig(el)" />
          </v-group>

          <!-- 矢量路径 -->
          <v-group v-else-if="el.type==='path'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-line :config="pathLineConfig(el)" />
          </v-group>

          <!-- 容器组（自动布局） -->
          <v-group v-else-if="el.type==='group'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-rect :config="groupBgConfig(el)" />
          </v-group>

          <!-- 思维导图节点 -->
          <v-group v-else-if="el.type==='mindmap-node'" :config="groupConfig(el)" :draggable="isDraggable"
            @click="select(el.id)" @dragstart="emit('element-drag-start', el.id)" @dragend="emit('element-drag-end', el.id)">
            <v-rect v-if="mindmapShape(el)==='rounded-rect'"
              :config="mindmapRectConfig(el)" />
            <v-ellipse v-else-if="mindmapShape(el)==='ellipse'"
              :config="mindmapEllipseConfig(el)" />
            <v-line v-else
              :config="mindmapDiamondConfig(el)" />
            <v-text :config="mindmapTextConfig(el)" />
          </v-group>
        </template>

        <!-- 正在绘制的形状预览 -->
        <template v-if="drawing.active">
          <v-rect v-if="['rectangle','bpmn-activity','er-entity','swimlane'].includes(drawing.type)"
            :config="drawPreviewRect" />
          <v-ellipse v-else-if="drawing.type==='ellipse'" :config="drawPreviewEllipse" />
          <v-circle v-else-if="drawing.type==='bpmn-event'" :config="drawPreviewCircle" />
          <v-line v-else-if="drawing.type==='bpmn-gateway'" :config="drawPreviewDiamond" />
          <v-line v-else-if="drawing.type==='line'" :config="drawPreviewLine" />
        </template>

        <!-- 远程光标 -->
        <template v-for="[uid, cursor] in store.remoteCursors" :key="uid">
          <v-text :config="cursorLabelConfig(cursor)" />
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
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue'
import Konva from 'konva'
import { useWhiteboardStore } from '../../stores/whiteboard'
import { useCanvas } from '../../composables/useCanvas'
import { useDrawing } from '../../composables/useDrawing'
import { findNearestAnchor, generateBezierPath, type Connector } from '../../composables/useConnector'
import type { WhiteboardElement, RemoteCursor } from '../../types/whiteboard'

const props = defineProps<{ userId: string; userName: string }>()
const store = useWhiteboardStore()
const { handleWheel, handlePointerDown: canvasPointerDown, handlePointerMove: canvasPointerMove, handlePointerUp: canvasPointerUp } = useCanvas()
const { drawing, startDraw, updateDraw, endDraw, cancelDraw } = useDrawing()

const containerRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<any>(null)
const containerSize = reactive({ width: 1200, height: 800 })

// 连接器状态
const connectors = ref<Connector[]>([])
const drawingConnector = reactive<{ active: boolean; fromId: string; fromAnchor: string; currentX: number; currentY: number }>({
  active: false, fromId: '', fromAnchor: '', currentX: 0, currentY: 0,
})

const tools = [
  { id: 'select', label: '选择 (V)', icon: '⬆' },
  { id: 'rectangle', label: '矩形 (R)', icon: '▬' },
  { id: 'ellipse', label: '椭圆 (O)', icon: '⬮' },
  { id: 'line', label: '线条 (L)', icon: '╱' },
  { id: 'arrow', label: '箭头 (A)', icon: '→' },
  { id: 'pencil', label: '铅笔 (P)', icon: '✎' },
  { id: 'connector', label: '连接线 (C)', icon: '⚡' },
]

const isDraggable = computed(() => store.activeTool === 'select')

const stageConfig = computed(() => ({
  width: containerSize.width,
  height: containerSize.height,
  draggable: false,
}))

// ── 网格线 ──
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

// ── 元素配置函数 ──
function groupConfig(el: WhiteboardElement) {
  return { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity, visible: el.visible }
}

function rectConfig(el: WhiteboardElement) {
  const cr = el.type === 'er-entity' ? 8 : el.type === 'bpmn-activity' ? 4 : 0
  return { width: el.width, height: el.height, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, cornerRadius: cr === 0 ? undefined : cr }
}

function ellipseConfig(el: WhiteboardElement) {
  return { x: el.width / 2, y: el.height / 2, radiusX: el.width / 2, radiusY: el.height / 2, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth }
}

function bpmnEventConfig(el: WhiteboardElement) {
  const r = Math.min(el.width, el.height) / 2
  return { x: el.width / 2, y: el.height / 2, radius: r, fill: el.fill, stroke: el.stroke, strokeWidth: 4 }
}

function bpmnEventInnerConfig(el: WhiteboardElement) {
  const r = Math.min(el.width, el.height) / 2 - 6
  return { x: el.width / 2, y: el.height / 2, radius: Math.max(r, 6), stroke: el.stroke, strokeWidth: 1.5, fill: 'transparent' }
}

function diamondConfig(el: WhiteboardElement) {
  const cx = el.width / 2, cy = el.height / 2
  const rx = el.width / 2, ry = el.height / 2
  return { points: [cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy], closed: true, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, lineJoin: 'round' }
}

function swimlaneLanes(el: WhiteboardElement) {
  const attrs = el.attrs as any
  const count = Math.max(1, attrs?.lanes?.length || 2)
  const laneH = el.height / count
  return Array.from({ length: count }, (_, i) => ({
    x: 0, y: i * laneH, width: el.width, height: laneH,
    fill: i % 2 === 0 ? '#f8f9fa' : '#fff', stroke: '#ccc', strokeWidth: 1,
  }))
}

function swimlaneLabels(el: WhiteboardElement) {
  const attrs = el.attrs as any
  const lanes = attrs?.lanes || [{ label: '泳道1' }, { label: '泳道2' }]
  const laneH = el.height / lanes.length
  return lanes.map((l: any, i: number) => ({
    x: 4, y: i * laneH + laneH / 2 - 6, text: l.label, fontSize: 11, fill: '#666', fontFamily: 'sans-serif',
  }))
}

function umlBgConfig(el: WhiteboardElement) {
  return { width: el.width, height: el.height, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth }
}

function umlHeaderConfig(el: WhiteboardElement) {
  return { width: el.width, height: 28, fill: el.stroke, stroke: 'transparent' }
}

function umlTitleConfig(el: WhiteboardElement) {
  const attrs = el.attrs as any
  return { x: 8, y: 6, text: attrs?.className || 'Class', fontSize: 13, fill: '#fff', fontStyle: 'bold', fontFamily: 'monospace' }
}

function umlDivider1Config(el: WhiteboardElement) {
  return { points: [0, 28, el.width, 28], stroke: el.stroke, strokeWidth: 1 }
}

function umlDivider2Config(el: WhiteboardElement) {
  const attrs = el.attrs as any
  const fieldH = (attrs?.fields?.length || 0) * 18
  return { points: [0, 28 + fieldH + 4, el.width, 28 + fieldH + 4], stroke: el.stroke, strokeWidth: 1 }
}

function umlFields(el: WhiteboardElement) {
  const attrs = el.attrs as any
  return (attrs?.fields || []).map((f: any, i: number) => ({
    x: 8, y: 32 + i * 18, text: `+ ${f.name}: ${f.type}`, fontSize: 11, fill: '#555', fontFamily: 'monospace',
  }))
}

function umlMethods(el: WhiteboardElement) {
  const attrs = el.attrs as any
  const fieldH = (attrs?.fields?.length || 0) * 18 + 4
  return (attrs?.methods || []).map((m: any, i: number) => ({
    x: 8, y: 32 + fieldH + i * 18, text: `+ ${m.name}(): ${m.returnType}`, fontSize: 11, fill: '#555', fontFamily: 'monospace',
  }))
}

function lineConfig(el: WhiteboardElement) {
  return { points: [0, el.height / 2, el.width, el.height / 2], stroke: el.stroke, strokeWidth: el.strokeWidth, lineCap: 'round' }
}

function arrowLineConfig(el: WhiteboardElement) {
  return { points: [0, el.height / 2, el.width - 10, el.height / 2], stroke: el.stroke, strokeWidth: el.strokeWidth, lineCap: 'round' }
}

function arrowHeadConfig(el: WhiteboardElement) {
  return { points: [el.width - 10, el.height / 2 - 6, el.width, el.height / 2, el.width - 10, el.height / 2 + 6], closed: true, fill: el.stroke, stroke: el.stroke, strokeWidth: 1 }
}

function mindmapShape(el: WhiteboardElement) {
  const attrs = el.attrs as any
  return attrs?.shape || 'rounded-rect'
}

function mindmapRectConfig(el: WhiteboardElement) {
  return { width: el.width, height: el.height, fill: el.fill, stroke: '#333', strokeWidth: 1.5, cornerRadius: 8, shadowColor: 'rgba(0,0,0,0.1)', shadowBlur: 4, shadowOffsetY: 2 }
}

function mindmapEllipseConfig(el: WhiteboardElement) {
  return { x: el.width / 2, y: el.height / 2, radiusX: el.width / 2, radiusY: el.height / 2, fill: el.fill, stroke: '#333', strokeWidth: 1.5 }
}

function mindmapDiamondConfig(el: WhiteboardElement) {
  const cx = el.width / 2, cy = el.height / 2
  return { points: [cx, 0, el.width, cy, cx, el.height, 0, cy], closed: true, fill: el.fill, stroke: '#333', strokeWidth: 1.5, lineJoin: 'round' }
}

function mindmapTextConfig(el: WhiteboardElement) {
  const attrs = el.attrs as any
  return { x: el.width / 2, y: el.height / 2, text: attrs?.text || '节点', fontSize: 12, fill: '#fff', fontFamily: 'sans-serif', align: 'center', verticalAlign: 'middle' }
}

function pathLineConfig(el: WhiteboardElement) {
  const attrs = el.attrs as any
  const anchors: any[] = attrs?.anchors || []
  const pts: number[] = []
  for (const a of anchors) { pts.push(a.x, a.y) }
  return { points: pts, stroke: el.stroke, strokeWidth: el.strokeWidth, fill: el.fill, closed: attrs?.closed || false, tension: 0.3, lineCap: 'round', lineJoin: 'round' }
}

function groupBgConfig(el: WhiteboardElement) {
  const attrs = el.attrs as any
  const layout = attrs?.layout || {}
  return { width: el.width, height: el.height, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, dash: [4, 4], cornerRadius: 4 }
}

// ── 连接线 ──
function connectorLineConfig(conn: Connector): any {
  if (conn.path.length < 2) return { points: [], stroke: '#1a73e8', strokeWidth: 2 }
  const points: number[] = []
  for (const p of conn.path) { points.push(p.x, p.y) }
  return {
    points,
    stroke: '#1a73e8',
    strokeWidth: 2,
    lineCap: 'round',
    tension: 0.3,
    hitStrokeWidth: 10,
  }
}

const drawingConnectorLine = computed(() => ({
  points: [0, 0, drawingConnector.currentX, drawingConnector.currentY],
  stroke: '#1a73e8',
  strokeWidth: 2,
  dash: [6, 4],
  lineCap: 'round',
}))

function selectConnector(id: string) {
  // 连接线选择
}

// ── 预览形状 ──
const drawPreviewRect = computed(() => ({
  x: Math.min(drawing.startX, drawing.currentX), y: Math.min(drawing.startY, drawing.currentY),
  width: Math.abs(drawing.currentX - drawing.startX) || 1, height: Math.abs(drawing.currentY - drawing.startY) || 1,
  fill: 'rgba(26,115,232,0.12)', stroke: '#1a73e8', strokeWidth: 1.5, dash: [5, 5],
}))

const drawPreviewEllipse = computed(() => ({
  x: (drawing.startX + drawing.currentX) / 2, y: (drawing.startY + drawing.currentY) / 2,
  radiusX: Math.abs(drawing.currentX - drawing.startX) / 2 || 1,
  radiusY: Math.abs(drawing.currentY - drawing.startY) / 2 || 1,
  fill: 'rgba(26,115,232,0.12)', stroke: '#1a73e8', strokeWidth: 1.5, dash: [5, 5],
}))

const drawPreviewCircle = computed(() => {
  const r = Math.max(Math.abs(drawing.currentX - drawing.startX), Math.abs(drawing.currentY - drawing.startY)) / 2 || 10
  return { x: (drawing.startX + drawing.currentX) / 2, y: (drawing.startY + drawing.currentY) / 2, radius: r, fill: 'rgba(26,115,232,0.12)', stroke: '#1a73e8', strokeWidth: 1.5, dash: [5, 5] }
})

const drawPreviewDiamond = computed(() => {
  const cx = (drawing.startX + drawing.currentX) / 2, cy = (drawing.startY + drawing.currentY) / 2
  const rx = Math.abs(drawing.currentX - drawing.startX) / 2 || 10, ry = Math.abs(drawing.currentY - drawing.startY) / 2 || 10
  return { points: [cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy], closed: true, fill: 'rgba(26,115,232,0.12)', stroke: '#1a73e8', strokeWidth: 1.5, dash: [5, 5] }
})

const drawPreviewLine = computed(() => ({
  points: [drawing.startX, drawing.startY, drawing.currentX, drawing.currentY],
  stroke: '#1a73e8', strokeWidth: 2, dash: [5, 5],
}))

function cursorLabelConfig(cursor: RemoteCursor) {
  return {
    x: cursor.x + 12, y: cursor.y - 8, text: cursor.userName,
    fontSize: 11, fill: cursor.color, fontFamily: 'sans-serif',
  }
}

// ── 事件处理 ──
function onWheel(e: any) { handleWheel(e) }

function getStagePoint(e: any): { x: number; y: number } | null {
  const stage = e.target?.getStage()
  const pointer = stage?.getPointerPosition()
  if (!stage || !pointer) return null
  return {
    x: (pointer.x - stage.x()) / stage.scaleX(),
    y: (pointer.y - stage.y()) / stage.scaleY(),
  }
}

function onPointerDown(e: any) {
  const p = getStagePoint(e)
  if (!p) return

  const tool = store.activeTool

  if (tool === 'connector') {
    // 连接线模式：找到最近元素开始绘制
    const hit = findNearestAnchor(p.x, p.y, store.elements, undefined, 30)
    if (hit) {
      drawingConnector.active = true
      drawingConnector.fromId = hit.elId
      drawingConnector.fromAnchor = hit.pos
      drawingConnector.currentX = p.x
      drawingConnector.currentY = p.y
    }
    return
  }

  if (tool !== 'select') {
    startDraw(tool as any, p.x, p.y)
  } else {
    canvasPointerDown(e)
  }
}

function onPointerMove(e: any) {
  const p = getStagePoint(e)

  if (drawingConnector.active && p) {
    drawingConnector.currentX = p.x
    drawingConnector.currentY = p.y
  }

  if (drawing.active && p) {
    updateDraw(p.x, p.y)
  } else {
    canvasPointerMove(e)
  }

  // 发送光标位置
  if (p) {
    emit('cursor-move', { x: p.x * store.scale + store.offsetX, y: p.y * store.scale + store.offsetY })
  }
}

function onPointerUp(e: any) {
  canvasPointerUp()

  // 完成连接线
  if (drawingConnector.active) {
    const p = getStagePoint(e)
    if (p) {
      const hit = findNearestAnchor(p.x, p.y, store.elements, drawingConnector.fromId, 30)
      if (hit && hit.elId !== drawingConnector.fromId) {
        const fromEl = store.elements.find(el => el.id === drawingConnector.fromId)
        const toEl = store.elements.find(el => el.id === hit.elId)
        if (fromEl && toEl) {
          // 这里创建一个连接线对象（简化版）
          const fromPt = { x: fromEl.x + fromEl.width / 2, y: fromEl.y + fromEl.height / 2 }
          const toPt = { x: toEl.x + toEl.width / 2, y: toEl.y + toEl.height / 2 }
          const path = generateBezierPath(fromPt, toPt)
          const conn: Connector = {
            id: 'conn_' + crypto.randomUUID().slice(0, 8),
            fromId: drawingConnector.fromId,
            fromAnchor: drawingConnector.fromAnchor as any,
            toId: hit.elId,
            toAnchor: hit.pos,
            path: [fromPt, ...path],
            style: 'bezier',
          }
          connectors.value.push(conn)
        }
      }
    }
    drawingConnector.active = false
    return
  }

  // 完成绘图
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

function resetView() {
  const stage = stageRef.value?.getNode()
  if (!stage) return
  stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 })
  store.setViewTransform(1, 0, 0)
}

function zoomIn() {
  const stage = stageRef.value?.getNode()
  if (!stage) return
  const ns = Math.min(5, store.scale * 1.2)
  stage.scale({ x: ns, y: ns }); store.setViewTransform(ns, stage.x(), stage.y())
}

function zoomOut() {
  const stage = stageRef.value?.getNode()
  if (!stage) return
  const ns = Math.max(0.1, store.scale / 1.2)
  stage.scale({ x: ns, y: ns }); store.setViewTransform(ns, stage.x(), stage.y())
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
    if (entry) { containerSize.width = entry.contentRect.width; containerSize.height = entry.contentRect.height }
  })
  if (containerRef.value) observer.observe(containerRef.value)
})

function onKeyDown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { store.undo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'z' && e.shiftKey) { store.redo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'y') { store.redo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'c') { store.copySelected(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'v') { store.pasteElements(props.userId); e.preventDefault() }
  const km: Record<string, string> = { v: 'select', r: 'rectangle', o: 'ellipse', l: 'line', a: 'arrow', c: 'connector' }
  const t = km[e.key.toLowerCase()]
  if (t) { store.setActiveTool(t as any); e.preventDefault() }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    store.selectedIds.forEach(id => { store.deleteElement(id); emit('element-drag-end', id) })
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.whiteboard-container { position: relative; width: 100%; height: 100%; background: #f8f9fa; overflow: hidden; }
.wb-toolbar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 4px 8px; background: rgba(255,255,255,0.95); border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 10; }
.wb-tool-btn { width: 36px; height: 36px; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; color: #444; }
.wb-tool-btn:hover { background: #e8eaed; }
.wb-tool-btn.active { background: #d2e3fc; color: #1a73e8; }
.toolbar-separator { width: 1px; height: 24px; background: #dadce0; margin: 0 4px; }
.zoom-label { font-size: 12px; color: #666; min-width: 36px; text-align: center; }
.wb-zoom-controls { position: absolute; bottom: 16px; right: 16px; display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.9); padding: 4px 12px; border-radius: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.12); z-index: 10; }
.zoom-btn { width: 28px; height: 28px; border: 1px solid #dadce0; background: white; border-radius: 50%; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; color: #444; }
.zoom-val { font-size: 13px; color: #666; min-width: 36px; text-align: center; }
</style>
