import { reactive } from 'vue'
import type { WhiteboardElement } from '../types/whiteboard'

/** 在画布上从鼠标拖拽创建新元素 */
export function useDrawing() {
  const drawing = reactive({
    active: false as boolean,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    type: 'rectangle' as WhiteboardElement['type'],
  })

  function startDraw(type: WhiteboardElement['type'], x: number, y: number) {
    drawing.active = true
    drawing.type = type
    drawing.startX = x
    drawing.startY = y
    drawing.currentX = x
    drawing.currentY = y
  }

  function updateDraw(x: number, y: number) {
    if (!drawing.active) return
    drawing.currentX = x
    drawing.currentY = y
  }

  function endDraw(userId: string): WhiteboardElement | null {
    if (!drawing.active) return null

    const x = Math.min(drawing.startX, drawing.currentX)
    const y = Math.min(drawing.startY, drawing.currentY)
    const w = Math.abs(drawing.currentX - drawing.startX) || 50
    const h = Math.abs(drawing.currentY - drawing.startY) || 50

    drawing.active = false

    const now = Date.now()
    const el: WhiteboardElement = {
      id: 'el_' + crypto.randomUUID().slice(0, 8),
      type: drawing.type,
      x, y, width: w, height: h,
      rotation: 0,
      opacity: 1,
      fill: '#e8f0fe',
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

    return el
  }

  function cancelDraw() {
    drawing.active = false
  }

  return {
    drawing,
    startDraw,
    updateDraw,
    endDraw,
    cancelDraw,
  }
}
