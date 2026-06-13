import type { WhiteboardElement } from '../types/whiteboard'

/**
 * 根据元素类型生成 Konva 兼容的形状渲染配置。
 * 返回对象包含 { shape, config }，其中 shape 是 Konva 组件名，
 * config 是传递给该组件的 Konva 配置。
 */

export interface ShapeRenderResult {
  /** Konva 节点类型，如 'v-rect', 'v-ellipse', 'v-circle', 'v-line', 'v-path' 等 */
  nodeType: string
  /** 传递给节点的配置 */
  config: Record<string, any>
  /** 子节点（用于 UML 类等复杂元素） */
  children?: { nodeType: string; config: Record<string, any> }[]
}

export function getShapeRenderer(el: WhiteboardElement): ShapeRenderResult {
  switch (el.type) {
    case 'rectangle':
    case 'bpmn-activity':
      return renderRect(el)
    case 'ellipse':
      return renderEllipse(el)
    case 'bpmn-event':
      return renderCircle(el, true)
    case 'bpmn-gateway':
      return renderDiamond(el)
    case 'swimlane':
      return renderSwimlane(el)
    case 'uml-class':
      return renderUmlClass(el)
    case 'er-entity':
      return renderRect(el)  // ER 实体用圆角矩形
    case 'line':
      return renderLine(el)
    case 'arrow':
      return renderArrow(el)
    default:
      return renderRect(el)
  }
}

function renderRect(el: WhiteboardElement): ShapeRenderResult {
  const attrs = el.attrs as any
  const cornerRadius = el.type === 'bpmn-activity' ? 4 : el.type === 'er-entity' ? 8 : 0
  return {
    nodeType: 'v-rect',
    config: {
      x: 0, y: 0,
      width: el.width, height: el.height,
      fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth,
      cornerRadius,
      shadowColor: 'rgba(0,0,0,0.08)',
      shadowBlur: 4,
      shadowOffsetY: 2,
    },
    children: el.type === 'bpmn-activity' ? [
      { nodeType: 'v-text', config: { x: 8, y: el.height / 2 - 6, text: (attrs.activityType || 'task').replace('-', ' '), fontSize: 11, fill: '#666', fontFamily: 'sans-serif' } },
    ] : undefined,
  }
}

function renderEllipse(el: WhiteboardElement): ShapeRenderResult {
  return {
    nodeType: 'v-ellipse',
    config: {
      x: el.width / 2, y: el.height / 2,
      radiusX: el.width / 2, radiusY: el.height / 2,
      fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth,
    },
  }
}

function renderCircle(el: WhiteboardElement, doubleBorder: boolean): ShapeRenderResult {
  const r = Math.min(el.width, el.height) / 2
  return {
    nodeType: 'v-circle',
    config: {
      x: el.width / 2, y: el.height / 2,
      radius: r,
      fill: el.fill, stroke: el.stroke, strokeWidth: doubleBorder ? 4 : el.strokeWidth,
      dash: doubleBorder ? undefined : undefined,
    },
    children: doubleBorder ? [
      { nodeType: 'v-circle', config: { x: el.width / 2, y: el.height / 2, radius: r - 6, stroke: el.stroke, strokeWidth: 1.5, fill: 'transparent' } },
    ] : undefined,
  }
}

function renderDiamond(el: WhiteboardElement): ShapeRenderResult {
  const cx = el.width / 2
  const cy = el.height / 2
  const rx = el.width / 2
  const ry = el.height / 2
  const points = [cx, cy - ry, cx + rx, cy, cx, cy + ry, cx - rx, cy]

  const attrs = el.attrs as any
  const isXor = attrs?.gatewayType === 'exclusive'

  return {
    nodeType: 'v-line',
    config: {
      points,
      closed: true,
      fill: el.fill,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      lineJoin: 'round',
    },
    children: isXor ? [
      { nodeType: 'v-text', config: { x: cx - 5, y: cy - 7, text: 'X', fontSize: 14, fill: el.stroke, fontStyle: 'bold' } },
    ] : [
      { nodeType: 'v-text', config: { x: cx - 5, y: cy - 7, text: '+', fontSize: 14, fill: el.stroke, fontStyle: 'bold' } },
    ],
  }
}

function renderSwimlane(el: WhiteboardElement): ShapeRenderResult {
  const attrs = el.attrs as any
  const isHorizontal = attrs?.direction !== 'vertical'
  const lanes = attrs?.lanes || [{ label: '泳道1' }, { label: '泳道2' }]
  const laneSize = isHorizontal ? el.height / lanes.length : el.width / lanes.length

  const children: { nodeType: string; config: Record<string, any> }[] = []

  lanes.forEach((lane: any, i: number) => {
    if (isHorizontal) {
      children.push({
        nodeType: 'v-rect',
        config: {
          x: 0, y: i * laneSize,
          width: el.width, height: laneSize,
          fill: i % 2 === 0 ? '#f8f9fa' : '#fff',
          stroke: '#ccc', strokeWidth: 1,
        },
      })
      children.push({
        nodeType: 'v-text',
        config: { x: 4, y: i * laneSize + laneSize / 2 - 6, text: lane.label, fontSize: 11, fill: '#666', width: 20, fontFamily: 'sans-serif' },
      })
    } else {
      children.push({
        nodeType: 'v-rect',
        config: {
          x: i * laneSize, y: 0,
          width: laneSize, height: el.height,
          fill: i % 2 === 0 ? '#f8f9fa' : '#fff',
          stroke: '#ccc', strokeWidth: 1,
        },
      })
    }
  })

  return {
    nodeType: 'v-group',
    config: { x: 0, y: 0 },
    children,
  }
}

function renderUmlClass(el: WhiteboardElement): ShapeRenderResult {
  const attrs = el.attrs as any
  const className = attrs?.className || 'Class'
  const fields: { name: string; type: string }[] = attrs?.fields || []
  const methods: { name: string; returnType: string }[] = attrs?.methods || []
  const headerH = 28
  const fieldH = fields.length * 18 + 4
  const methodH = methods.length * 18 + 4

  return {
    nodeType: 'v-group',
    config: { x: 0, y: 0 },
    children: [
      { nodeType: 'v-rect', config: { width: el.width, height: Math.max(el.height, headerH + fieldH + methodH), fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth } },
      { nodeType: 'v-rect', config: { width: el.width, height: headerH, fill: el.stroke, stroke: 'transparent' } },
      { nodeType: 'v-text', config: { x: 8, y: 6, text: className, fontSize: 13, fill: '#fff', fontStyle: 'bold', fontFamily: 'monospace' } },
      // 分割线
      { nodeType: 'v-line', config: { points: [0, headerH, el.width, headerH], stroke: el.stroke, strokeWidth: 1 } },
      // 字段
      ...fields.map((f, i) => ({
        nodeType: 'v-text' as const,
        config: { x: 8, y: headerH + 4 + i * 18, text: `+ ${f.name}: ${f.type}`, fontSize: 11, fill: '#555', fontFamily: 'monospace' },
      })),
      // 方法分割线
      { nodeType: 'v-line', config: { points: [0, headerH + fieldH, el.width, headerH + fieldH], stroke: el.stroke, strokeWidth: 1 } },
      ...methods.map((m, i) => ({
        nodeType: 'v-text' as const,
        config: { x: 8, y: headerH + fieldH + 4 + i * 18, text: `+ ${m.name}(): ${m.returnType}`, fontSize: 11, fill: '#555', fontFamily: 'monospace' },
      })),
    ],
  }
}

function renderLine(el: WhiteboardElement): ShapeRenderResult {
  return {
    nodeType: 'v-line',
    config: {
      points: [0, el.height / 2, el.width, el.height / 2],
      stroke: el.stroke, strokeWidth: el.strokeWidth,
      lineCap: 'round',
    },
  }
}

function renderArrow(el: WhiteboardElement): ShapeRenderResult {
  return {
    nodeType: 'v-group',
    config: { x: 0, y: 0 },
    children: [
      { nodeType: 'v-line', config: { points: [0, el.height / 2, el.width - 10, el.height / 2], stroke: el.stroke, strokeWidth: el.strokeWidth, lineCap: 'round' } },
      { nodeType: 'v-line', config: { points: [el.width - 10, el.height / 2 - 6, el.width, el.height / 2, el.width - 10, el.height / 2 + 6], closed: true, fill: el.stroke, stroke: el.stroke, strokeWidth: 1 } },
    ],
  }
}
