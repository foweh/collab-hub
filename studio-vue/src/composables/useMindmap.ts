import type { WhiteboardElement } from '../../types/whiteboard'

/** 思维导图节点 */
export interface MindmapNode {
  id: string
  text: string
  color: string
  shape: 'rounded-rect' | 'ellipse' | 'diamond'
  children: string[]
  collapsed: boolean
  level: number
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
}

/** 从白板元素列表构建导图节点树 */
export function buildMindmapTree(elements: WhiteboardElement[]): MindmapNode[] {
  const mindmapEls = elements.filter(e => e.type === 'mindmap-node')
  const nodes: MindmapNode[] = mindmapEls.map(el => {
    const attrs = el.attrs as any
    return {
      id: el.id,
      text: attrs?.text || '节点',
      color: attrs?.color || '#4a90d9',
      shape: attrs?.shape || 'rounded-rect',
      children: attrs?.children || [],
      collapsed: attrs?.collapsed || false,
      level: attrs?.level || 0,
      parentId: attrs?.parentId || null,
      x: el.x,
      y: el.y,
      width: el.width || 120,
      height: el.height || 40,
    }
  })
  return nodes
}

/** 计算子树大小（用于自动布局） */
function calcSubtreeSize(
  node: MindmapNode,
  allNodes: Map<string, MindmapNode>,
  nodeWidth: number,
  nodeHeight: number,
  hGap: number,
  vGap: number,
): { width: number; height: number } {
  if (node.collapsed || node.children.length === 0) {
    return { width: nodeWidth, height: nodeHeight }
  }

  let totalW = 0
  let totalH = 0
  for (const childId of node.children) {
    const child = allNodes.get(childId)
    if (!child) continue
    const childSize = calcSubtreeSize(child, allNodes, nodeWidth, nodeHeight, hGap, vGap)
    totalW = Math.max(totalW, childSize.width)
    totalH += childSize.height + vGap
  }

  return {
    width: nodeWidth + hGap + totalW,
    height: Math.max(nodeHeight, totalH - vGap),
  }
}

/** 树状布局计算（从左到右展开） */
export function layoutMindmap(
  nodes: MindmapNode[],
  startX = 50,
  startY = 50,
  hGap = 60,
  vGap = 20,
  nodeWidth = 120,
  nodeHeight = 40,
): MindmapNode[] {
  if (nodes.length === 0) return []

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const root = nodes.find(n => n.level === 0) || nodes[0]
  if (!root) return nodes

  // 从根开始递归布局
  function layoutNode(node: MindmapNode, x: number, y: number): { y: number } {
    node.x = x
    node.y = y

    if (node.collapsed || node.children.length === 0) {
      return { y: y + nodeHeight }
    }

    // 先计算所有子树的垂直空间需求
    const childYPositions: number[] = []
    let currentY = y

    for (const childId of node.children) {
      const child = nodeMap.get(childId)
      if (!child) continue

      const subtreeSize = calcSubtreeSize(child, nodeMap, nodeWidth, nodeHeight, hGap, vGap)
      const childY = currentY + (subtreeSize.height - nodeHeight) / 2
      childYPositions.push(childY)

      // 递归布局子节点
      const result = layoutNode(child, x + nodeWidth + hGap, childY)
      // 修正：子树的垂直跨度
      const actualSubtreeH = child.children.length > 0
        ? result.y - childY
        : nodeHeight
      currentY = Math.max(currentY, childY + actualSubtreeH + vGap)
    }

    return { y: currentY }
  }

  // 居中调整
  layoutNode(root, startX, startY)

  return nodes
}

/** 获取两个节点之间的连接路径（正交线） */
export function getMindmapConnector(
  parent: MindmapNode,
  child: MindmapNode,
): { points: number[] } {
  const parentRight = { x: parent.x + parent.width, y: parent.y + parent.height / 2 }
  const childLeft = { x: child.x, y: child.y + child.height / 2 }
  const midX = (parentRight.x + childLeft.x) / 2

  return {
    points: [
      parentRight.x, parentRight.y,
      midX, parentRight.y,
      midX, childLeft.y,
      childLeft.x, childLeft.y,
    ],
  }
}

/** 从 WhiteboardElement 转换到 MindmapNode */
export function elementToMindmapNode(el: WhiteboardElement): MindmapNode {
  const attrs = el.attrs as any
  return {
    id: el.id,
    text: attrs?.text || '节点',
    color: attrs?.color || '#4a90d9',
    shape: attrs?.shape || 'rounded-rect',
    children: attrs?.children || [],
    collapsed: attrs?.collapsed || false,
    level: attrs?.level || 0,
    parentId: attrs?.parentId || null,
    x: el.x,
    y: el.y,
    width: el.width || 120,
    height: el.height || 40,
  }
}

/** MindmapNode 转 WhiteboardElement */
export function mindmapNodeToElement(
  node: MindmapNode,
  userId: string,
): WhiteboardElement {
  const now = Date.now()
  return {
    id: node.id,
    type: 'mindmap-node',
    x: node.x, y: node.y,
    width: node.width, height: node.height,
    rotation: 0,
    opacity: 1,
    fill: node.color,
    stroke: '#333',
    strokeWidth: 1.5,
    visible: true,
    locked: false,
    attrs: {
      text: node.text,
      color: node.color,
      shape: node.shape,
      children: node.children,
      collapsed: node.collapsed,
      level: node.level,
      parentId: node.parentId,
    },
    createdBy: userId,
    modifiedBy: userId,
    createdAt: now,
    modifiedAt: now,
  }
}
