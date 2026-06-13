/** 白板元素基类（序列化后存储 & 同步） */
export interface WhiteboardElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  fill: string
  stroke: string
  strokeWidth: number
  visible: boolean
  locked: boolean
  /** 自定义属性（不同元素类型不同） */
  attrs: Record<string, unknown>
  /** 创建者 userId */
  createdBy: string
  /** 最后修改者 userId */
  modifiedBy: string
  createdAt: number
  modifiedAt: number
}

export type ElementType =
  | 'rectangle' | 'ellipse' | 'line' | 'arrow'
  | 'text' | 'image' | 'pencil' | 'connector'
  | 'bpmn-event' | 'bpmn-activity' | 'bpmn-gateway'
  | 'swimlane' | 'uml-class' | 'er-entity'
  | 'mindmap-node'
  | 'path'           // 矢量路径（贝塞尔曲线）
  | 'group'          // 容器组（用于布尔运算结果/自动布局）

/** 连接线 */
export interface Connector {
  id: string
  fromId: string      // 源元素 id
  fromAnchor: AnchorPos
  toId: string        // 目标元素 id
  toAnchor: AnchorPos
  path: { x: number; y: number }[]   // 实际路径点
  style: 'straight' | 'bezier' | 'orthogonal'
}

export type AnchorPos = 'top' | 'right' | 'bottom' | 'left'

/** BPMN 事件 */
export interface BpmnEventAttrs {
  eventType: 'start' | 'end' | 'intermediate' | 'boundary'
  subType?: 'message' | 'timer' | 'signal' | 'error' | 'none'
}

/** BPMN 活动 */
export interface BpmnActivityAttrs {
  activityType: 'task' | 'subprocess' | 'call-activity'
  taskType?: 'user' | 'service' | 'script' | 'manual'
}

/** BPMN 网关 */
export interface BpmnGatewayAttrs {
  gatewayType: 'exclusive' | 'parallel' | 'inclusive' | 'event'
}

/** UML 类 */
export interface UmlClassAttrs {
  className: string
  fields: { name: string; type: string; visibility: 'public' | 'private' | 'protected' }[]
  methods: { name: string; returnType: string; params: string[]; visibility: 'public' | 'private' | 'protected' }[]
}

/** 泳道 */
export interface SwimlaneAttrs {
  direction: 'horizontal' | 'vertical'
  lanes: { label: string; elements: string[] }[]
}

/** 思维导图节点 */
export interface MindmapNodeAttrs {
  text: string
  color: string
  shape: 'rect' | 'ellipse' | 'diamond' | 'rounded-rect'
  children: string[]      // 子节点 id 列表
  collapsed: boolean
  level: number
}

/** 远程光标 */
export interface RemoteCursor {
  userId: string
  userName: string
  x: number
  y: number
  color: string
  lastUpdate: number
}

/** 操作变更 */
export interface WhiteboardOp {
  type: 'add' | 'update' | 'delete' | 'move' | 'reorder'
  elementId: string
  before?: Partial<WhiteboardElement>
  after?: Partial<WhiteboardElement>
  userId: string
  timestamp: number
}

// ─── UI 设计类型 ─────────────────────────────────────

/** 矢量路径点（贝塞尔曲线锚点） */
export interface VectorAnchor {
  x: number
  y: number
  /** 控制点1（相对于锚点） */
  cp1x: number
  cp1y: number
  /** 控制点2（相对于锚点） */
  cp2x: number
  cp2y: number
  /** 是否平滑（控制点共线） */
  smooth: boolean
}

/** 矢量路径元素属性 */
export interface PathAttrs {
  anchors: VectorAnchor[]
  closed: boolean
  fillRule: 'nonzero' | 'evenodd'
}

/** 自动布局配置 */
export interface AutoLayoutConfig {
  direction: 'horizontal' | 'vertical' | 'wrap'
  gap: number
  padding: number
  align: 'start' | 'center' | 'end' | 'stretch'
  /** 子元素响应式：固定宽度/弹性/比例 */
  sizing: 'fixed' | 'flex' | 'ratio'
}

/** 设计变量 */
export interface DesignVariable {
  id: string
  name: string
  type: 'color' | 'spacing' | 'font-size' | 'font-family' | 'shadow' | 'border-radius'
  value: string
  /** 变量引用链（如 "$primary"） */
  references?: string[]
  description?: string
}

/** 主题 */
export interface Theme {
  id: string
  name: string
  /** key=变量ID, value=具体值 */
  overrides: Record<string, string>
  isDark: boolean
  /** 应用于哪些页面 */
  scope: string[]
}

/** 自动布局元素属性 */
export interface GroupAttrs {
  layout: AutoLayoutConfig
  children: string[]       // 子元素 ID 列表
}
