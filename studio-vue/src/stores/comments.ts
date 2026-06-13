import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Annotation, AnnotationReply } from '../types/whiteboard'
import { useSocketStore } from './socket'

export const useCommentsStore = defineStore('comments', () => {
  const annotations = ref<Annotation[]>([])
  const commentMode = ref(false)          // M 键切换
  const filterStatus = ref<'all' | 'open' | 'resolved'>('all')
  const documentId = ref('whiteboard-1')  // 当前文档 ID

  // 计算属性
  const openCount = computed(() => annotations.value.filter(a => a.status === 'open').length)

  const filteredAnnotations = computed(() => {
    if (filterStatus.value === 'all') return annotations.value
    return annotations.value.filter(a => a.status === filterStatus.value)
  })

  // 初始化：从服务端加载批注
  function init(docId: string) {
    documentId.value = docId
    const socket = useSocketStore()
    if (socket.connected) {
      socket.socket?.emit('annotation-list', { documentId: docId })
    }
  }

  // 设置 Socket 事件监听
  function setupSocket(socket: any) {
    if (!socket) return

    socket.on('annotation-list-result', ({ documentId: docId, annotations: list }: { documentId: string; annotations: Annotation[] }) => {
      if (docId === documentId.value) {
        annotations.value = list
      }
    })

    socket.on('annotation-created', (ann: Annotation) => {
      if (ann.documentId === documentId.value) {
        annotations.value.push(ann)
      }
    })

    socket.on('annotation-replied', ({ annotationId, reply }: { annotationId: string; reply: AnnotationReply }) => {
      const ann = annotations.value.find(a => a.id === annotationId)
      if (ann) {
        ann.replyThread.push(reply)
        ann.updatedAt = Date.now()
      }
    })

    socket.on('annotation-status-updated', ({ annotationId, status }: { annotationId: string; status: string }) => {
      const ann = annotations.value.find(a => a.id === annotationId)
      if (ann) {
        ann.status = status as Annotation['status']
        ann.updatedAt = Date.now()
      }
    })

    socket.on('annotation-deleted', ({ annotationId }: { annotationId: string }) => {
      annotations.value = annotations.value.filter(a => a.id !== annotationId)
    })
  }

  // 创建批注
  function create(x: number, y: number, text: string, elementId?: string) {
    const socket = useSocketStore()
    socket.socket?.emit('annotation-create', {
      documentId: documentId.value,
      anchor: { x, y, elementId },
      content: { text },
    })
  }

  // 回复批注
  function reply(annotationId: string, text: string) {
    const socket = useSocketStore()
    socket.socket?.emit('annotation-reply', { annotationId, text })
  }

  // 更新状态
  function setStatus(annotationId: string, status: 'open' | 'resolved' | 'rejected') {
    const socket = useSocketStore()
    socket.socket?.emit('annotation-update-status', { annotationId, status })
  }

  // 删除批注
  function remove(annotationId: string) {
    const socket = useSocketStore()
    socket.socket?.emit('annotation-delete', { annotationId })
  }

  function toggleCommentMode() {
    commentMode.value = !commentMode.value
  }

  return {
    annotations, commentMode, filterStatus, documentId,
    openCount, filteredAnnotations,
    init, setupSocket,
    create, reply, setStatus, remove,
    toggleCommentMode,
  }
})
