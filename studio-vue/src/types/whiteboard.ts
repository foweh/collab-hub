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
