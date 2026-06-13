import type { WhiteboardElement } from '../types/whiteboard'

/**
 * 布尔运算工具（并集/交集/差集/排除）
 * 基于元素的边界框进行简化运算。
 * 完整图形学实现需要参考 clipper2 等库，这里做边界框级运算。
 */

export type BooleanOp = 'union' | 'intersect' | 'subtract' | 'exclude'

interface BBox {
  x: number; y: number
  width: number; height: number
}

function toBBox(el: WhiteboardElement): BBox {
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

function fromBBox(bbox: BBox, userId: string): Partial<WhiteboardElement> {
  return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height, modifiedBy: userId }
}

/** 边界框并集 */
function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x, y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/** 边界框交集 */
function intersect(a: BBox, b: BBox): BBox | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (x >= right || y >= bottom) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** 边界框差集（A - B，返回 A 被 B 切掉后的剩余部分） */
function subtract(a: BBox, b: BBox): BBox[] {
  const inter = intersect(a, b)
  if (!inter) return [a]

  const result: BBox[] = []

  // 左
  if (a.x < inter.x) {
    result.push({ x: a.x, y: a.y, width: inter.x - a.x, height: a.height })
  }
  // 右
  if (a.x + a.width > inter.x + inter.width) {
    result.push({
      x: inter.x + inter.width, y: a.y,
      width: (a.x + a.width) - (inter.x + inter.width), height: a.height,
    })
  }
  // 上
  if (a.y < inter.y) {
    result.push({ x: inter.x, y: a.y, width: inter.width, height: inter.y - a.y })
  }
  // 下
  if (a.y + a.height > inter.y + inter.height) {
    result.push({
      x: inter.x, y: inter.y + inter.height,
      width: inter.width, height: (a.y + a.height) - (inter.y + inter.height),
    })
  }

  return result.length > 0 ? result : [a]
}

/** 执行布尔运算 */
export function performBooleanOp(
  op: BooleanOp,
  selected: WhiteboardElement[],
  userId: string,
): { result: Partial<WhiteboardElement>[]; deleteIds: string[] } {
  if (selected.length < 2) return { result: [], deleteIds: [] }

  const a = toBBox(selected[0])
  const b = toBBox(selected[1])

  let resultBBoxes: BBox[]

  switch (op) {
    case 'union':
      resultBBoxes = [union(a, b)]
      break
    case 'intersect': {
      const inter = intersect(a, b)
      if (inter) resultBBoxes = [inter]
      else return { result: [], deleteIds: [] }
      break
    }
    case 'subtract':
      resultBBoxes = subtract(a, b)
      break
    case 'exclude': {
      // 异或 = 并集 - 交集
      const u = union(a, b)
      const inter = intersect(a, b)
      if (inter) {
        resultBBoxes = subtract(u, inter)
      } else {
        resultBBoxes = [u]
      }
      break
    }
  }

  return {
    result: resultBBoxes.map(bbox => ({
      ...fromBBox(bbox, userId),
      fill: selected[0].fill,
      stroke: selected[0].stroke,
      strokeWidth: selected[0].strokeWidth,
    })),
    deleteIds: selected.slice(0, Math.min(2, selected.length)).map(e => e.id),
  }
}
