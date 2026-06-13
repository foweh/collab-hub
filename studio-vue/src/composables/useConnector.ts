import { ref, computed } from 'vue'
import { useWhiteboardStore } from '../stores/whiteboard'
import type { WhiteboardElement, AnchorPos, Connector } from '../types/whiteboard'

/** 元素的锚点位置（基于元素边界框） */
export function getAnchorPoint(el: WhiteboardElement, anchor: AnchorPos): { x: number; y: number } {
  switch (anchor) {
    case 'top':    return { x: el.x + el.width / 2, y: el.y }
    case 'bottom': return { x: el.x + el.width / 2, y: el.y + el.height }
    case 'left':   return { x: el.x, y: el.y + el.height / 2 }
    case 'right':  return { x: el.x + el.width, y: el.y + el.height / 2 }
  }
}

/** 获取所有可见锚点（用于渲染吸附标记） */
export function getAllAnchorPoints(elements: WhiteboardElement[]): { elId: string; pos: AnchorPos; x: number; y: number }[] {
  const result: { elId: string; pos: AnchorPos; x: number; y: number }[] = []
  for (const el of elements) {
    if (el.locked || el.type === 'connector') continue
    for (const pos of ['top', 'right', 'bottom', 'left'] as AnchorPos[]) {
      const pt = getAnchorPoint(el, pos)
      result.push({ elId: el.id, pos, x: pt.x, y: pt.y })
    }
  }
  return result
}

/** 找到距离给定点最近的目标锚点 */
export function findNearestAnchor(
  x: number, y: number,
  elements: WhiteboardElement[],
  excludeId?: string,
  threshold = 20
): { elId: string; pos: AnchorPos; x: number; y: number } | null {
  let nearest: { elId: string; pos: AnchorPos; x: number; y: number } | null = null
  let minDist = threshold

  for (const el of elements) {
    if (el.id === excludeId || el.locked || el.type === 'connector') continue
    for (const pos of ['top', 'right', 'bottom', 'left'] as AnchorPos[]) {
      const pt = getAnchorPoint(el, pos)
      const dist = Math.hypot(pt.x - x, pt.y - y)
      if (dist < minDist) {
        minDist = dist
        nearest = { elId: el.id, pos, x: pt.x, y: pt.y }
      }
    }
  }
  return nearest
}

/** 生成正交连接路径（避开障碍物，简单正交路由） */
export function generateOrthogonalPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromAnchor?: AnchorPos,
  toAnchor?: AnchorPos,
): { x: number; y: number }[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const points: { x: number; y: number }[] = []

  // 简单正交：走 L 形或 Z 形
  const midX = from.x + dx / 2

  // 根据源/目标锚点方向优化路径
  const fromDir = fromAnchor || (adx > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top'))
  const toDir = toAnchor || (adx > ady ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom'))

  // 如果方向相对（左右相对或上下相对），走直线 L 形
  if ((fromDir === 'right' && toDir === 'left') || (fromDir === 'left' && toDir === 'right')) {
    points.push({ x: from.x + dx / 2, y: from.y })
    points.push({ x: from.x + dx / 2, y: to.y })
  } else if ((fromDir === 'top' && toDir === 'bottom') || (fromDir === 'bottom' && toDir === 'top')) {
    points.push({ x: from.x, y: from.y + dy / 2 })
    points.push({ x: to.x, y: from.y + dy / 2 })
  } else {
    // 默认 Z 形
    points.push({ x: midX, y: from.y })
    points.push({ x: midX, y: to.y })
  }

  return points
}

/** 生成贝塞尔曲线控制点 */
export function generateBezierPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromAnchor?: AnchorPos,
  toAnchor?: AnchorPos,
): { x: number; y: number }[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const cpOffset = Math.max(50, dist * 0.4)

  let cp1x = from.x, cp1y = from.y
  let cp2x = to.x, cp2y = to.y

  const fa = fromAnchor || 'right'
  const ta = toAnchor || 'left'

  // 根据锚点方向设置控制点偏移
  switch (fa) {
    case 'top':    cp1y = from.y - cpOffset; break
    case 'bottom': cp1y = from.y + cpOffset; break
    case 'left':   cp1x = from.x - cpOffset; break
    case 'right':  cp1x = from.x + cpOffset; break
  }
  switch (ta) {
    case 'top':    cp2y = to.y - cpOffset; break
    case 'bottom': cp2y = to.y + cpOffset; break
    case 'left':   cp2x = to.x - cpOffset; break
    case 'right':  cp2x = to.x + cpOffset; break
  }

  // 返回控制点路径（用于 Konva Bezier 曲线）
  return [
    { x: cp1x, y: cp1y },
    { x: cp2x, y: cp2y },
    { x: to.x, y: to.y },
  ]
}
