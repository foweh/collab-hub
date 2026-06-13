import type { WhiteboardElement } from '../types/whiteboard'

/**
 * 对齐与分布工具
 */

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'
export type DistributeMode = 'horizontal' | 'vertical'

/** 对齐操作 */
export function alignElements(elements: WhiteboardElement[], mode: AlignMode): void {
  if (elements.length < 2) return

  // 以第一个选中元素为基准
  const ref = elements[0]

  for (let i = 1; i < elements.length; i++) {
    const el = elements[i]
    switch (mode) {
      case 'left':
        el.x = ref.x
        break
      case 'center-h':
        el.x = ref.x + (ref.width - el.width) / 2
        break
      case 'right':
        el.x = ref.x + ref.width - el.width
        break
      case 'top':
        el.y = ref.y
        break
      case 'center-v':
        el.y = ref.y + (ref.height - el.height) / 2
        break
      case 'bottom':
        el.y = ref.y + ref.height - el.height
        break
    }
  }
}

/** 分布操作 */
export function distributeElements(elements: WhiteboardElement[], mode: DistributeMode): void {
  if (elements.length < 3) return

  const sorted = [...elements].sort((a, b) =>
    mode === 'horizontal' ? a.x - b.x : a.y - b.y
  )

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const totalSpace = mode === 'horizontal'
    ? (last.x + last.width) - first.x
    : (last.y + last.height) - first.y

  const totalElementSize = sorted.reduce((sum, el) =>
    sum + (mode === 'horizontal' ? el.width : el.height), 0
  )

  const gap = sorted.length > 1
    ? (totalSpace - totalElementSize) / (sorted.length - 1)
    : 0

  let cursor = mode === 'horizontal' ? first.x : first.y
  for (let i = 1; i < sorted.length - 1; i++) {
    const el = sorted[i]
    cursor += (mode === 'horizontal' ? sorted[i - 1].width : sorted[i - 1].height) + gap
    if (mode === 'horizontal') {
      el.x = cursor
    } else {
      el.y = cursor
    }
  }
}

/** 使元素适应内容（根据文本自动调整尺寸） */
export function fitToContent(el: WhiteboardElement, textLength: number): void {
  const charW = 8 // 近似字符宽度
  const lineH = 20
  const padding = 12
  el.width = Math.max(40, textLength * charW + padding * 2)
  el.height = Math.max(30, lineH + padding * 2)
}
