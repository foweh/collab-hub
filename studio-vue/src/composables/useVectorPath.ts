import { ref, reactive } from 'vue'
import type { VectorAnchor, WhiteboardElement } from '../types/whiteboard'

/**
 * 矢量路径编辑（钢笔工具）
 * 管理贝塞尔曲线锚点的添加、移动、控制点调整
 */

export function useVectorPath() {
  /** 当前正在编辑的路径锚点 */
  const currentPath = ref<VectorAnchor[]>([])
  const isDrawingPath = ref(false)
  const activeAnchorIndex = ref(-1)
  const isPathClosed = ref(false)

  // 临时拖拽状态
  const dragState = reactive({
    active: false as boolean,
    anchorIdx: -1,
    handle: 'anchor' as 'anchor' | 'cp1' | 'cp2',
    startX: 0,
    startY: 0,
  })

  /** 开始绘制新路径 */
  function startPath(x: number, y: number) {
    currentPath.value = [{ x, y, cp1x: 0, cp1y: 0, cp2x: 0, cp2y: 0, smooth: true }]
    isDrawingPath.value = true
    isPathClosed.value = false
    activeAnchorIndex.value = 0
  }

  /** 添加锚点（点击时调用） */
  function addAnchor(x: number, y: number, smooth = true) {
    const prev = currentPath.value[currentPath.value.length - 1]
    if (!prev) return

    // 如果点击位置接近起始点 → 闭合路径
    const first = currentPath.value[0]
    if (first && currentPath.value.length > 2 &&
        Math.abs(x - first.x) < 10 && Math.abs(y - first.y) < 10) {
      isPathClosed.value = true
      isDrawingPath.value = false
      return
    }

    const dx = x - prev.x
    const dy = y - prev.y
    const cpOffset = Math.sqrt(dx * dx + dy * dy) * 0.3

    currentPath.value.push({
      x, y,
      cp1x: -cpOffset, cp1y: -cpOffset * (dy / Math.max(Math.abs(dx), 1)),
      cp2x: cpOffset, cp2y: cpOffset * (dy / Math.max(Math.abs(dx), 1)),
      smooth,
    })
    activeAnchorIndex.value = currentPath.value.length - 1
  }

  /** 完成路径绘制（双击/回车） */
  function finishPath(): VectorAnchor[] {
    const result = [...currentPath.value]
    resetPath()
    return result
  }

  function resetPath() {
    currentPath.value = []
    isDrawingPath.value = false
    isPathClosed.value = false
    activeAnchorIndex.value = -1
  }

  /** 开始拖拽锚点/控制点 */
  function startDrag(anchorIdx: number, handle: 'anchor' | 'cp1' | 'cp2', x: number, y: number) {
    dragState.active = true
    dragState.anchorIdx = anchorIdx
    dragState.handle = handle
    dragState.startX = x
    dragState.startY = y
    activeAnchorIndex.value = anchorIdx
  }

  /** 更新拖拽 */
  function updateDrag(x: number, y: number) {
    if (!dragState.active) return
    const dx = x - dragState.startX
    const dy = y - dragState.startY
    const anchor = currentPath.value[dragState.anchorIdx]
    if (!anchor) return

    if (dragState.handle === 'anchor') {
      anchor.x += dx
      anchor.y += dy
    } else if (dragState.handle === 'cp1') {
      anchor.cp1x += dx
      anchor.cp1y += dy
      if (anchor.smooth) {
        anchor.cp2x -= dx
        anchor.cp2y -= dy
      }
    } else if (dragState.handle === 'cp2') {
      anchor.cp2x += dx
      anchor.cp2y += dy
      if (anchor.smooth) {
        anchor.cp1x -= dx
        anchor.cp1y -= dy
      }
    }
    dragState.startX = x
    dragState.startY = y
  }

  function endDrag() {
    dragState.active = false
  }

  /** 切换锚点平滑模式 */
  function toggleSmooth(anchorIdx: number) {
    const anchor = currentPath.value[anchorIdx]
    if (!anchor) return
    anchor.smooth = !anchor.smooth
  }

  /** 删除锚点 */
  function deleteAnchor(anchorIdx: number) {
    if (currentPath.value.length <= 1) {
      resetPath()
      return
    }
    currentPath.value.splice(anchorIdx, 1)
    activeAnchorIndex.value = Math.min(anchorIdx, currentPath.value.length - 1)
  }

  /** 将路径转换为 Konva Line 的 points 数组 */
  function toKonvaPoints(anchors: VectorAnchor[], closed: boolean): number[] {
    if (anchors.length === 0) return []
    const pts: number[] = []
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      const next = anchors[(i + 1) % anchors.length]
      if (!next) break
      // 贝塞尔曲线：当前锚点 → 当前控制点2 → 下一控制点1 → 下一锚点
      // Konva Line with tension doesn't support individual control points.
      // For true bezier we'd use multiple Line segments or SVG path.
      // Simplified: use anchor points directly for now
      pts.push(a.x, a.y)
    }
    if (closed && anchors.length > 0) {
      const a = anchors[0]
      pts.push(a.x, a.y)
    }
    return pts
  }

  /** 将路径转为 SVG path string（用于更精确渲染） */
  function toSvgPath(anchors: VectorAnchor[], closed: boolean): string {
    if (anchors.length === 0) return ''
    let d = `M ${anchors[0].x} ${anchors[0].y}`
    for (let i = 1; i < anchors.length; i++) {
      const prev = anchors[i - 1]
      const curr = anchors[i]
      const cx1 = prev.x + prev.cp2x
      const cy1 = prev.y + prev.cp2y
      const cx2 = curr.x + curr.cp1x
      const cy2 = curr.y + curr.cp1y
      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${curr.x} ${curr.y}`
    }
    if (closed && anchors.length > 0) {
      const last = anchors[anchors.length - 1]
      const first = anchors[0]
      const cx1 = last.x + last.cp2x
      const cy1 = last.y + last.cp2y
      const cx2 = first.x + first.cp1x
      const cy2 = first.y + first.cp1y
      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${first.x} ${first.y} Z`
    }
    return d
  }

  return {
    currentPath,
    isDrawingPath,
    activeAnchorIndex,
    isPathClosed,
    dragState,
    startPath,
    addAnchor,
    finishPath,
    resetPath,
    startDrag,
    updateDrag,
    endDrag,
    toggleSmooth,
    deleteAnchor,
    toKonvaPoints,
    toSvgPath,
  }
}

/** 从已有的 WhiteboardElement 加载路径 */
export function loadPathFromElement(el: WhiteboardElement): VectorAnchor[] {
  const attrs = el.attrs as any
  return attrs?.anchors || []
}
