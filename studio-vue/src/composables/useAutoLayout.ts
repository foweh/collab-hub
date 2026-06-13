import type { WhiteboardElement, AutoLayoutConfig } from '../types/whiteboard'

/**
 * Flexbox 式自动布局引擎
 * 递归计算容器内子元素的位置
 */

export interface LayoutChild {
  id: string
  width: number
  height: number
  /** 弹性比例（flex-grow） */
  flexGrow: number
  /** 固定尺寸覆盖 */
  fixedWidth?: number
  fixedHeight?: number
}

export interface LayoutResult {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * 计算容器自动布局
 * @param containerWidth 容器宽度
 * @param containerHeight 容器高度
 * @param config 布局配置
 * @param children 子元素信息
 * @returns 每个子元素的新位置
 */
export function computeAutoLayout(
  containerWidth: number,
  containerHeight: number,
  config: AutoLayoutConfig,
  children: LayoutChild[],
): LayoutResult[] {
  if (children.length === 0) return []

  const { direction, gap, padding, align, sizing } = config
  const results: LayoutResult[] = []

  if (direction === 'horizontal') {
    // ── 水平布局 ──
    const contentW = containerWidth - padding * 2
    let totalFlex = 0
    let fixedW = 0

    for (const child of children) {
      if (child.fixedWidth) fixedW += child.fixedWidth
      else totalFlex += child.flexGrow
    }

    const remainingW = contentW - fixedW - gap * (children.length - 1)
    const flexUnitW = totalFlex > 0 ? Math.max(0, remainingW) / totalFlex : 0

    let cursorX = padding
    for (const child of children) {
      const w = child.fixedWidth || flexUnitW * child.flexGrow
      const h = align === 'stretch' ? containerHeight - padding * 2 : (child.fixedHeight || child.height)

      let y: number
      switch (align) {
        case 'start': y = padding; break
        case 'center': y = (containerHeight - h) / 2; break
        case 'end': y = containerHeight - padding - h; break
        case 'stretch': y = padding; break
        default: y = padding
      }

      results.push({ id: child.id, x: cursorX, y, width: w, height: h })
      cursorX += w + gap
    }
  } else if (direction === 'vertical') {
    // ── 垂直布局 ──
    const contentH = containerHeight - padding * 2
    let totalFlex = 0
    let fixedH = 0

    for (const child of children) {
      if (child.fixedHeight) fixedH += child.fixedHeight
      else totalFlex += child.flexGrow
    }

    const remainingH = contentH - fixedH - gap * (children.length - 1)
    const flexUnitH = totalFlex > 0 ? Math.max(0, remainingH) / totalFlex : 0

    let cursorY = padding
    for (const child of children) {
      const h = child.fixedHeight || flexUnitH * child.flexGrow
      const w = align === 'stretch' ? containerWidth - padding * 2 : (child.fixedWidth || child.width)

      let x: number
      switch (align) {
        case 'start': x = padding; break
        case 'center': x = (containerWidth - w) / 2; break
        case 'end': x = containerWidth - padding - w; break
        case 'stretch': x = padding; break
        default: x = padding
      }

      results.push({ id: child.id, x, y: cursorY, width: w, height: h })
      cursorY += h + gap
    }
  } else if (direction === 'wrap') {
    // ── 自动换行布局 ──
    const contentW = containerWidth - padding * 2
    const rowH = children[0]?.height || 40
    let cursorX = padding
    let cursorY = padding
    let rowMaxH = 0

    for (const child of children) {
      const w = child.fixedWidth || child.width
      const h = child.fixedHeight || child.height

      if (cursorX + w > containerWidth - padding) {
        cursorX = padding
        cursorY += rowMaxH + gap
        rowMaxH = 0
      }

      results.push({ id: child.id, x: cursorX, y: cursorY, width: w, height: h })
      cursorX += w + gap
      rowMaxH = Math.max(rowMaxH, h)
    }
  }

  return results
}

/**
 * 计算自动尺寸（容器根据子元素自适应）
 */
export function computeAutoSize(
  config: AutoLayoutConfig,
  children: LayoutChild[],
): { width: number; height: number } {
  if (children.length === 0) return { width: 200, height: 200 }

  const { direction, gap, padding } = config

  if (direction === 'horizontal') {
    let totalW = 0
    let maxH = 0
    for (const child of children) {
      totalW += (child.fixedWidth || child.width) + gap
      maxH = Math.max(maxH, child.fixedHeight || child.height)
    }
    return {
      width: totalW + padding * 2,
      height: maxH + padding * 2,
    }
  }

  if (direction === 'vertical') {
    let totalH = 0
    let maxW = 0
    for (const child of children) {
      totalH += (child.fixedHeight || child.height) + gap
      maxW = Math.max(maxW, child.fixedWidth || child.width)
    }
    return {
      width: maxW + padding * 2,
      height: totalH + padding * 2,
    }
  }

  // wrap
  return { width: 300, height: 300 }
}

/**
 * 从 WhiteboardElement 提取子元素数据
 */
export function extractChildren(
  container: WhiteboardElement,
  allElements: WhiteboardElement[],
): LayoutChild[] {
  const attrs = container.attrs as any
  const childIds: string[] = attrs?.children || []
  return childIds
    .map(id => allElements.find(e => e.id === id))
    .filter((e): e is WhiteboardElement => !!e)
    .map(e => ({
      id: e.id,
      width: e.width,
      height: e.height,
      flexGrow: 1,
    }))
}
