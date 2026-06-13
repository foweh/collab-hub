import { defineStore } from 'pinia'
import { ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { useWhiteboardStore } from './whiteboard'
import type { WhiteboardElement, WhiteboardOp, RemoteCursor } from '../types/whiteboard'

export const useSocketStore = defineStore('socket', () => {
  const socket = ref<Socket | null>(null)
  const connected = ref(false)
  const serverId = ref('')
  const myUserId = ref('')
  const myUserName = ref('')

  function connect(url: string, userId: string, userName: string) {
    myUserId.value = userId
    myUserName.value = userName

    const s = io(url, {
      query: { userId, userName },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 5000,
    })

    s.on('connect', () => {
      connected.value = true
      console.log('[socket] connected', s.id)
    })

    s.on('disconnect', () => {
      connected.value = false
    })

    s.on('connect_error', (err) => {
      console.warn('[socket] connection error:', err.message)
      connected.value = false
    })

    // --- 白板事件 ---
    s.on('whiteboard:init', (els: WhiteboardElement[]) => {
      const store = useWhiteboardStore()
      store.loadElements(els)
    })

    s.on('whiteboard:op', (op: WhiteboardOp) => {
      const store = useWhiteboardStore()
      store.applyRemoteOp(op)
    })

    s.on('whiteboard:cursor', (cursor: RemoteCursor) => {
      const store = useWhiteboardStore()
      store.updateCursor(cursor)
    })

    s.on('whiteboard:cursor-leave', (userId: string) => {
      const store = useWhiteboardStore()
      store.removeCursor(userId)
    })

    socket.value = s
  }

  function emitOp(op: WhiteboardOp) {
    socket.value?.emit('whiteboard:op', op)
  }

  function emitCursor(cursor: { x: number; y: number }) {
    socket.value?.emit('whiteboard:cursor', cursor)
  }

  function emitElementAdd(el: WhiteboardElement) {
    socket.value?.emit('whiteboard:add', el)
  }

  function emitElementUpdate(id: string, patch: Partial<WhiteboardElement>) {
    socket.value?.emit('whiteboard:update', { id, patch })
  }

  function emitElementDelete(id: string) {
    socket.value?.emit('whiteboard:delete', id)
  }

  function disconnect() {
    socket.value?.disconnect()
    socket.value = null
    connected.value = false
  }

  return {
    socket, connected, serverId, myUserId, myUserName,
    connect, disconnect,
    emitOp, emitCursor,
    emitElementAdd, emitElementUpdate, emitElementDelete,
  }
})
