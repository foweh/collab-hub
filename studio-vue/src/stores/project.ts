import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSocketStore } from './socket'

export interface Project {
  id: string
  type: 'script' | 'mindmap' | 'story' | 'storyboard' | 'folder' | 'project'
  name: string
  data: any
  owner: string
  visibility: 'private' | 'public-read' | 'public-edit'
  createdAt: number
  updatedAt: number
  deleted?: boolean
  parentId?: string
}

export interface ProjectItem {
  id: string
  type: 'script' | 'mindmap' | 'story' | 'storyboard'
  name: string
  data: any
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([])
  const currentProjectId = ref<string | null>(null)
  const currentItemId = ref<string | null>(null)

  // 已登录的用户名
  const myName = ref('')

  // 计算属性
  const currentProject = computed(() =>
    projects.value.find(p => p.id === currentProjectId.value) || null
  )
  const currentItem = computed(() => {
    if (!currentProject.value) return null
    const items: ProjectItem[] = currentProject.value.data?.items || []
    return items.find(i => i.id === currentItemId.value) || null
  })

  // 可见项目（排除已删除）
  const visibleProjects = computed(() =>
    projects.value.filter(p => !p.deleted)
  )

  // 容器项目列表（type=project 或 folder）
  const containerProjects = computed(() =>
    visibleProjects.value.filter(p => p.type === 'project' || p.type === 'folder')
  )

  // 设置 Socket 事件监听
  function setupSocket(socket: any) {
    if (!socket) return

    socket.on('init', (data: any) => {
      if (data.projects) {
        projects.value = data.projects
      }
    })

    socket.on('project-created', (p: Project) => {
      const idx = projects.value.findIndex(x => x.id === p.id)
      if (idx === -1) projects.value.push(p)
    })

    socket.on('project-updated', ({ id, name, data }: any) => {
      const p = projects.value.find(x => x.id === id)
      if (p) {
        if (name !== undefined) p.name = name
        if (data !== undefined) p.data = data
        p.updatedAt = Date.now()
      }
    })

    socket.on('project-deleted', (id: string) => {
      const p = projects.value.find(x => x.id === id)
      if (p) p.deleted = true
    })

    socket.on('project-restored', (id: string) => {
      const p = projects.value.find(x => x.id === id)
      if (p) p.deleted = false
    })

    socket.on('project-item-added', ({ projectId, item }: { projectId: string; item: ProjectItem }) => {
      const p = projects.value.find(x => x.id === projectId)
      if (p) {
        if (!p.data.items) p.data.items = []
        p.data.items.push(item)
      }
    })

    socket.on('project-item-removed', ({ projectId, itemId }: { projectId: string; itemId: string }) => {
      const p = projects.value.find(x => x.id === projectId)
      if (p && p.data.items) {
        p.data.items = p.data.items.filter((i: ProjectItem) => i.id !== itemId)
      }
    })

    socket.on('project-visibility-changed', ({ projectId, visibility }: any) => {
      const p = projects.value.find(x => x.id === projectId)
      if (p) p.visibility = visibility
    })

    // 批量同步（来自局域网对等节点）
    socket.on('bridge-message', (msg: any) => {
      if (msg.type === 'projects-update') {
        socket.emit('request-projects')
      }
    })
  }

  // 创建项目
  function create(type: Project['type'], name: string) {
    const socket = useSocketStore()
    socket.socket?.emit('project-create', { type, name })
  }

  // 创建容器项目（含子项）
  function createWithItems(name: string, items: { type: string; name: string }[]) {
    const socket = useSocketStore()
    socket.socket?.emit('project-create-batch', { name, children: items })
  }

  // 添加子项
  function addItem(projectId: string, itemType: string, itemName: string) {
    const socket = useSocketStore()
    socket.socket?.emit('project-add-item', { projectId, itemType, itemName })
  }

  // 删除子项
  function removeItem(projectId: string, itemId: string) {
    const socket = useSocketStore()
    socket.socket?.emit('project-remove-item', { projectId, itemId })
  }

  // 更新项目
  function update(projectId: string, data: any) {
    const socket = useSocketStore()
    socket.socket?.emit('project-update', { id: projectId, data })
  }

  // 删除项目
  function remove(projectId: string) {
    const socket = useSocketStore()
    socket.socket?.emit('project-delete', projectId)
  }

  // 选择当前项目/子项
  function selectProject(id: string | null) {
    currentProjectId.value = id
    currentItemId.value = null
  }

  function selectItem(id: string | null) {
    currentItemId.value = id
  }

  // 获取默认数据
  function getDefaultData(type: string): any {
    switch (type) {
      case 'script': return { acts: [] }
      case 'mindmap': return { nodes: [], edges: [] }
      case 'story': return { chapters: [] }
      case 'storyboard': return { scenes: [], shots: [] }
      case 'project': return { items: [] }
      case 'folder': return { children: [] }
      default: return {}
    }
  }

  return {
    projects, currentProjectId, currentItemId, myName,
    currentProject, currentItem, visibleProjects, containerProjects,
    setupSocket,
    create, createWithItems, addItem, removeItem,
    update, remove,
    selectProject, selectItem,
    getDefaultData,
  }
})
