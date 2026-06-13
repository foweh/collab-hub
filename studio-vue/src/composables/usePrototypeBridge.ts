import type { WhiteboardElement } from '../types/whiteboard'

/**
 * 白板 → 原型序列化桥接
 * 将白板元素转换为原型设计中的页面/组件结构，
 * 为后续原型设计模块提供数据基础。
 */

/** 原型页面 */
export interface PrototypePage {
  id: string
  name: string
  width: number
  height: number
  elements: PrototypeComponent[]
  createdAt: number
  modifiedAt: number
}

/** 原型组件 */
export interface PrototypeComponent {
  id: string
  /** 组件类型（映射到原型组件库） */
  componentType: 'rect' | 'text' | 'image' | 'button' | 'input' | 'list' | 'card' | 'icon' | 'custom'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  /** 视觉属性 */
  style: {
    backgroundColor?: string
    borderColor?: string
    borderWidth?: number
    borderRadius?: number
    color?: string
    fontSize?: number
    fontWeight?: string
    textAlign?: 'left' | 'center' | 'right'
    shadowColor?: string
    shadowBlur?: number
    shadowOffsetX?: number
    shadowOffsetY?: number
  }
  /** 文本内容 */
  text?: string
  /** 图片 URL */
  imageUrl?: string
  /** 子组件（嵌套结构） */
  children?: PrototypeComponent[]
  /** 交互事件 */
  interactions?: PrototypeInteraction[]
  /** 原始白板元素 ID（可追溯） */
  sourceElementId?: string
}

/** 交互事件（原型跳转/弹窗等） */
export interface PrototypeInteraction {
  eventType: 'click' | 'hover' | 'longpress' | 'swipe'
  actionType: 'navigate' | 'popup' | 'toggle' | 'set-variable' | 'link'
  targetId?: string   // 目标页面/组件 ID
  targetUrl?: string  // 外部链接
  animation?: 'push' | 'slide' | 'fade' | 'zoom' | 'none'
  duration?: number
}

/** 白板元素 → 原型组件转换映射表 */
const ELEMENT_TYPE_MAP: Record<string, string> = {
  'rectangle': 'rect',
  'ellipse': 'rect',
  'text': 'text',
  'image': 'image',
  'bpmn-activity': 'rect',
  'bpmn-event': 'icon',
  'bpmn-gateway': 'icon',
  'swimlane': 'custom',
  'uml-class': 'custom',
  'er-entity': 'card',
  'mindmap-node': 'card',
}

/**
 * 将单个白板元素转换为原型组件
 */
export function whiteboardElementToComponent(el: WhiteboardElement): PrototypeComponent {
  const componentType = (ELEMENT_TYPE_MAP[el.type] || 'rect') as PrototypeComponent['componentType']

  const component: PrototypeComponent = {
    id: 'comp_' + crypto.randomUUID().slice(0, 8),
    componentType,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    opacity: el.opacity,
    style: {
      backgroundColor: el.fill || undefined,
      borderColor: el.stroke || undefined,
      borderWidth: el.strokeWidth || undefined,
      borderRadius: el.type === 'bpmn-activity' ? 4 : el.type === 'er-entity' ? 8 : undefined,
      shadowColor: 'rgba(0,0,0,0.08)',
      shadowBlur: 4,
      shadowOffsetY: 2,
    },
    interactions: [],
    sourceElementId: el.id,
  }

  // 从 attrs 提取文本
  const attrs = el.attrs as any
  if (attrs?.text) {
    component.text = attrs.text
    component.style.fontSize = 14
    component.style.color = '#333'
    component.style.textAlign = 'center'
  }

  // UML 类图特殊处理：创建标题为文本
  if (el.type === 'uml-class' && attrs?.className) {
    component.text = attrs.className
    component.style.fontSize = 13
    component.style.fontWeight = 'bold'
    component.style.textAlign = 'center'
  }

  // BPMN 事件
  if (el.type === 'bpmn-event') {
    component.style.borderRadius = 50  // 圆形
    component.style.borderWidth = 3
  }

  // BPMN 网关
  if (el.type === 'bpmn-gateway') {
    component.style.borderRadius = 0  // 菱形
  }

  return component
}

/**
 * 将一组白板元素转换为原型页面
 * @param elements 白板中的元素列表
 * @param pageName 页面名称
 * @param pageWidth 页面宽度（默认手机 375）
 * @param pageHeight 页面高度（默认 812）
 */
export function createPrototypePage(
  elements: WhiteboardElement[],
  pageName = '白板导入',
  pageWidth = 375,
  pageHeight = 812,
): PrototypePage {
  const now = Date.now()

  const components: PrototypeComponent[] = elements
    .filter(el => el.type !== 'line' && el.type !== 'connector' && el.visible)
    .map(el => whiteboardElementToComponent(el))

  return {
    id: 'page_' + crypto.randomUUID().slice(0, 8),
    name: pageName,
    width: pageWidth,
    height: pageHeight,
    elements: components,
    createdAt: now,
    modifiedAt: now,
  }
}

/**
 * 构建白板页面与原型页面之间的关联
 * 用于"白板内容一键迁入原型"
 */
export interface WhiteboardPrototypeLink {
  whiteboardId: string
  prototypePageId: string
  mappedAt: number
  elementCount: number
}

/**
 * 从原型组件反向生成白板元素
 * （原型编辑后同步回白板）
 */
export function componentToWhiteboardElement(
  comp: PrototypeComponent,
  userId: string,
): WhiteboardElement {
  const now = Date.now()
  let type: WhiteboardElement['type'] = 'rectangle'

  // 映射回白板类型
  switch (comp.componentType) {
    case 'text': type = 'rectangle'; break
    case 'icon': type = 'bpmn-event'; break
    case 'card': type = 'er-entity'; break
    case 'button': type = 'rectangle'; break
    default: type = 'rectangle'
  }

  return {
    id: comp.id.replace('comp_', 'el_'),
    type,
    x: comp.x,
    y: comp.y,
    width: comp.width,
    height: comp.height,
    rotation: comp.rotation,
    opacity: comp.opacity,
    fill: comp.style.backgroundColor || '#ffffff',
    stroke: comp.style.borderColor || '#cccccc',
    strokeWidth: comp.style.borderWidth || 1,
    visible: true,
    locked: false,
    attrs: {
      text: comp.text,
      componentType: comp.componentType,
      prototypeId: comp.id,
    },
    createdBy: userId,
    modifiedBy: userId,
    createdAt: now,
    modifiedAt: now,
  }
}
