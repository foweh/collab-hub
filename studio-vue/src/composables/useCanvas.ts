import { ref, type Ref } from 'vue'
import Konva from 'konva'
import { useWhiteboardStore } from '../stores/whiteboard'
import type { WhiteboardElement } from '../types/whiteboard'

export function useCanvas(stageRef: Ref<Konva.Stage | null>) {
  const store = useWhiteboardStore()
  const isPanning = ref(false)
  const lastPointerPos = ref({ x: 0, y: 0 })

  /** 处理滚轮缩放 */
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return

    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const zoomFactor = e.evt.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.1, Math.min(5, oldScale * zoomFactor))

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }

    stage.scale({ x: newScale, y: newScale })
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })

    store.setViewTransform(newScale, stage.x(), stage.y())
  }

  /** 处理鼠标中键/空格+左键 平移 */
  function handlePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
    if (e.evt.button === 1 || e.evt.button === 0 && store.activeTool === 'select') {
      // 检查是否点在空白区域
      if (e.target === e.target.getStage()) {
        isPanning.value = true
        lastPointerPos.value = { x: e.evt.clientX, y: e.evt.clientY }
      }
    }
  }

  function handlePointerMove(e: Konva.KonvaEventObject<PointerEvent>) {
    if (isPanning.value) {
      const stage = e.target.getStage()
      if (!stage) return
      const dx = e.evt.clientX - lastPointerPos.value.x
      const dy = e.evt.clientY - lastPointerPos.value.y
      stage.position({
        x: stage.x() + dx,
        y: stage.y() + dy,
      })
      lastPointerPos.value = { x: e.evt.clientX, y: e.evt.clientY }
      store.setViewTransform(stage.scaleX(), stage.x(), stage.y())
    }
  }

  function handlePointerUp() {
    isPanning.value = false
  }

  /** 生成唯一 ID */
  function generateId(): string {
    return 'el_' + crypto.randomUUID().slice(0, 8)
  }

  /** 创建基础元素 */
  function createElement(
    type: WhiteboardElement['type'],
    x: number, y: number,
    width = 100, height = 100,
    userId: string
  ): WhiteboardElement {
    const now = Date.now()
    return {
      id: generateId(),
      type,
      x, y, width, height,
      rotation: 0,
      opacity: 1,
      fill: type === 'text' ? 'transparent' : '#e8f0fe',
      stroke: '#1a73e8',
      strokeWidth: 2,
      visible: true,
      locked: false,
      attrs: {},
      createdBy: userId,
      modifiedBy: userId,
      createdAt: now,
      modifiedAt: now,
    }
  }

  return {
    isPanning,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    generateId,
    createElement,
  }
}
