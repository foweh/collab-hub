import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WhiteboardElement, RemoteCursor, WhiteboardOp } from '../types/whiteboard'

export const useWhiteboardStore = defineStore('whiteboard', () => {
  // --- 状态 ---
  const elements = ref<WhiteboardElement[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const remoteCursors = ref<Map<string, RemoteCursor>>(new Map())
  const opHistory = ref<WhiteboardOp[]>([])           // 撤回栈
  const redoStack = ref<WhiteboardOp[]>([])            // 恢复栈
  const scale = ref(1)
  const offsetX = ref(0)
  const offsetY = ref(0)
  const activeTool = ref<'select' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'pencil' | 'text' | 'connector'>('select')
  const clipboard = ref<WhiteboardElement[]>([])

  // --- 计算属性 ---
  const selectedElements = computed(() =>
    elements.value.filter(e => selectedIds.value.has(e.id))
  )

  // --- 操作 ---
  function addElement(el: WhiteboardElement) {
    elements.value.push(el)
    opHistory.value.push({ type: 'add', elementId: el.id, userId: el.createdBy, timestamp: Date.now() })
    redoStack.value = []
  }

  function updateElement(id: string, patch: Partial<WhiteboardElement>) {
    const idx = elements.value.findIndex(e => e.id === id)
    if (idx === -1) return
    const before = { ...elements.value[idx] }
    elements.value[idx] = { ...elements.value[idx], ...patch, modifiedAt: Date.now() }
    opHistory.value.push({ type: 'update', elementId: id, before, after: patch, userId: patch.modifiedBy || '', timestamp: Date.now() })
    redoStack.value = []
  }

  function deleteElement(id: string) {
    const idx = elements.value.findIndex(e => e.id === id)
    if (idx === -1) return
    const removed = elements.value[idx]
    elements.value.splice(idx, 1)
    selectedIds.value.delete(id)
    opHistory.value.push({ type: 'delete', elementId: id, before: removed, userId: '', timestamp: Date.now() })
    redoStack.value = []
  }

  function undo() {
    const op = opHistory.value.pop()
    if (!op) return
    if (op.type === 'add') {
      const idx = elements.value.findIndex(e => e.id === op.elementId)
      if (idx !== -1) elements.value.splice(idx, 1)
    } else if (op.type === 'update' && op.before) {
      const idx = elements.value.findIndex(e => e.id === op.elementId)
      if (idx !== -1) elements.value[idx] = { ...elements.value[idx], ...op.before }
    } else if (op.type === 'delete' && op.before) {
      elements.value.push(op.before as WhiteboardElement)
    }
    redoStack.value.push(op)
  }

  function redo() {
    const op = redoStack.value.pop()
    if (!op) return
    if (op.type === 'add' && op.after) {
      elements.value.push(op.after as WhiteboardElement)
    } else if (op.type === 'update' && op.after) {
      const idx = elements.value.findIndex(e => e.id === op.elementId)
      if (idx !== -1) elements.value[idx] = { ...elements.value[idx], ...op.after }
    } else if (op.type === 'delete') {
      const idx = elements.value.findIndex(e => e.id === op.elementId)
      if (idx !== -1) elements.value.splice(idx, 1)
    }
    opHistory.value.push(op)
  }

  function select(id: string | null, multi = false) {
    if (!multi) selectedIds.value = new Set()
    if (id) {
      if (selectedIds.value.has(id)) selectedIds.value.delete(id)
      else selectedIds.value.add(id)
    }
  }

  function setActiveTool(tool: typeof activeTool.value) {
    activeTool.value = tool
  }

  function updateCursor(cursor: RemoteCursor) {
    remoteCursors.value.set(cursor.userId, cursor)
  }

  function removeCursor(userId: string) {
    remoteCursors.value.delete(userId)
  }

  function setViewTransform(s: number, ox: number, oy: number) {
    scale.value = s
    offsetX.value = ox
    offsetY.value = oy
  }

  function copySelected() {
    clipboard.value = selectedElements.value.map(e => ({ ...e }))
  }

  function pasteElements(userId: string) {
    const now = Date.now()
    clipboard.value.forEach(el => {
      const newEl: WhiteboardElement = {
        ...el,
        id: crypto.randomUUID(),
        x: el.x + 20,
        y: el.y + 20,
        createdBy: userId,
        modifiedBy: userId,
        createdAt: now,
        modifiedAt: now,
      }
      addElement(newEl)
    })
  }

  /** 从远程操作同步 */
  function applyRemoteOp(op: WhiteboardOp) {
    if (op.type === 'add' && op.after) {
      elements.value.push(op.after as WhiteboardElement)
    } else if (op.type === 'update') {
      const idx = elements.value.findIndex(e => e.id === op.elementId)
      if (idx !== -1 && op.after) {
        elements.value[idx] = { ...elements.value[idx], ...op.after }
      }
    } else if (op.type === 'delete') {
      const idx = elements.value.findIndex(e => e.id === op.elementId)
      if (idx !== -1) elements.value.splice(idx, 1)
    }
  }

  function loadElements(els: WhiteboardElement[]) {
    elements.value = els
  }

  return {
    // state
    elements, selectedIds, remoteCursors, opHistory, redoStack,
    scale, offsetX, offsetY, activeTool, clipboard,
    // computed
    selectedElements,
    // actions
    addElement, updateElement, deleteElement,
    undo, redo, select, setActiveTool,
    updateCursor, removeCursor, setViewTransform,
    copySelected, pasteElements, applyRemoteOp, loadElements,
  }
})
