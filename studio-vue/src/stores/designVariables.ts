import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DesignVariable, Theme } from '../types/whiteboard'

const DEFAULT_VARIABLES: DesignVariable[] = [
  { id: 'primary', name: '主色', type: 'color', value: '#1a73e8' },
  { id: 'secondary', name: '次要色', type: 'color', value: '#34a853' },
  { id: 'danger', name: '危险色', type: 'color', value: '#ea4335' },
  { id: 'warning', name: '警告色', type: 'color', value: '#fbbc04' },
  { id: 'bg', name: '背景色', type: 'color', value: '#ffffff' },
  { id: 'text', name: '文本色', type: 'color', value: '#1a1a1a' },
  { id: 'text-secondary', name: '次要文本', type: 'color', value: '#666666' },
  { id: 'border', name: '边框色', type: 'color', value: '#dadce0' },
  { id: 'spacing-xs', name: '间距 XS', type: 'spacing', value: '4px' },
  { id: 'spacing-sm', name: '间距 SM', type: 'spacing', value: '8px' },
  { id: 'spacing-md', name: '间距 MD', type: 'spacing', value: '16px' },
  { id: 'spacing-lg', name: '间距 LG', type: 'spacing', value: '24px' },
  { id: 'font-sm', name: '小字号', type: 'font-size', value: '12px' },
  { id: 'font-md', name: '中字号', type: 'font-size', value: '14px' },
  { id: 'font-lg', name: '大字号', type: 'font-size', value: '18px' },
  { id: 'font-xl', name: '标题字号', type: 'font-size', value: '24px' },
  { id: 'font-family', name: '字体', type: 'font-family', value: '-apple-system, sans-serif' },
  { id: 'radius-sm', name: '小圆角', type: 'border-radius', value: '4px' },
  { id: 'radius-md', name: '中圆角', type: 'border-radius', value: '8px' },
  { id: 'shadow-sm', name: '小阴影', type: 'shadow', value: '0 1px 3px rgba(0,0,0,0.12)' },
  { id: 'shadow-md', name: '中阴影', type: 'shadow', value: '0 4px 12px rgba(0,0,0,0.15)' },
]

export const useDesignVariablesStore = defineStore('designVariables', () => {
  const variables = ref<DesignVariable[]>([...DEFAULT_VARIABLES])
  const themes = ref<Theme[]>([])
  const activeThemeId = ref<string | null>(null)

  // 颜色变量（按类型分组）
  const colorVars = computed(() => variables.value.filter(v => v.type === 'color'))
  const spacingVars = computed(() => variables.value.filter(v => v.type === 'spacing'))
  const fontVars = computed(() => variables.value.filter(v => v.type === 'font-size' || v.type === 'font-family'))
  const shadowVars = computed(() => variables.value.filter(v => v.type === 'shadow'))
  const radiusVars = computed(() => variables.value.filter(v => v.type === 'border-radius'))

  const activeTheme = computed(() => themes.value.find(t => t.id === activeThemeId.value) || null)

  // 解析变量值（支持引用 $varName）
  function resolveValue(value: string): string {
    if (!value.startsWith('$')) return value
    const varName = value.slice(1)
    const v = variables.value.find(v => v.name === varName || v.id === varName)
    return v ? resolveValue(v.value) : value
  }

  // 创建变量
  function addVariable(v: DesignVariable) {
    variables.value.push(v)
  }

  function updateVariable(id: string, patch: Partial<DesignVariable>) {
    const idx = variables.value.findIndex(v => v.id === id)
    if (idx !== -1) Object.assign(variables.value[idx], patch)
  }

  function deleteVariable(id: string) {
    variables.value = variables.value.filter(v => v.id !== id)
  }

  // 主题
  function createTheme(name: string, isDark = false): Theme {
    const theme: Theme = {
      id: crypto.randomUUID().slice(0, 8),
      name,
      isDark,
      overrides: {},
      scope: [],
    }
    // 为暗色模式设置默认覆盖
    if (isDark) {
      theme.overrides = {
        'bg': '#1a1a2e',
        'text': '#e0e0e0',
        'text-secondary': '#999',
        'border': '#333',
      }
    }
    themes.value.push(theme)
    return theme
  }

  function deleteTheme(id: string) {
    themes.value = themes.value.filter(t => t.id !== id)
    if (activeThemeId.value === id) activeThemeId.value = null
  }

  function setActiveTheme(id: string | null) {
    activeThemeId.value = id
  }

  function applyThemeOverrides(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const v of variables.value) {
      result[v.id] = resolveValue(v.value)
    }
    if (activeTheme.value) {
      for (const [key, val] of Object.entries(activeTheme.value.overrides)) {
        const idx = result.hasOwnProperty(key)
        if (idx) result[key] = val
      }
    }
    return result
  }

  return {
    variables, themes, activeThemeId,
    colorVars, spacingVars, fontVars, shadowVars, radiusVars,
    activeTheme,
    addVariable, updateVariable, deleteVariable,
    createTheme, deleteTheme, setActiveTheme,
    resolveValue, applyThemeOverrides,
  }
})
