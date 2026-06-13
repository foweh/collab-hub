<template>
  <div class="dv-panel">
    <div class="panel-header">设计变量</div>

    <!-- 颜色变量 -->
    <div class="dv-section">
      <div class="dv-section-title">颜色</div>
      <div v-for="v in store.colorVars" :key="v.id" class="dv-row">
        <div class="dv-color-swatch" :style="{ background: store.resolveValue(v.value) }"></div>
        <span class="dv-name">{{ v.name }}</span>
        <input type="color" :value="v.value" @input="store.updateVariable(v.id, { value: ($event.target as HTMLInputElement).value })" class="dv-color-input" />
      </div>
    </div>

    <!-- 间距变量 -->
    <div class="dv-section">
      <div class="dv-section-title">间距</div>
      <div v-for="v in store.spacingVars" :key="v.id" class="dv-row">
        <span class="dv-name">{{ v.name }}</span>
        <input :value="v.value" @input="store.updateVariable(v.id, { value: ($event.target as HTMLInputElement).value })" class="dv-input" />
      </div>
    </div>

    <!-- 字体变量 -->
    <div class="dv-section">
      <div class="dv-section-title">字体</div>
      <div v-for="v in store.fontVars" :key="v.id" class="dv-row">
        <span class="dv-name">{{ v.name }}</span>
        <input :value="v.value" @input="store.updateVariable(v.id, { value: ($event.target as HTMLInputElement).value })" class="dv-input" />
      </div>
    </div>

    <!-- 主题切换 -->
    <div class="dv-section">
      <div class="dv-section-title">主题</div>
      <div class="dv-theme-list">
        <div v-for="t in store.themes" :key="t.id"
          :class="['dv-theme-item', { active: store.activeThemeId === t.id }]"
          @click="store.setActiveTheme(t.id)">
          <span>{{ t.name }}</span>
          <span class="dv-theme-badge" v-if="t.isDark">🌙</span>
        </div>
      </div>
      <div class="dv-theme-actions">
        <button class="dv-btn" @click="store.createTheme('浅色')">+ 浅色</button>
        <button class="dv-btn" @click="store.createTheme('暗色', true)">+ 暗色</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDesignVariablesStore } from '../../stores/designVariables'

const store = useDesignVariablesStore()
</script>

<style scoped>
.dv-panel { width: 100%; font-size: 12px; overflow-y: auto; }
.panel-header { font-size: 13px; font-weight: 600; padding: 8px 12px; border-bottom: 1px solid #eee; }
.dv-section { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
.dv-section-title { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.dv-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.dv-color-swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid #ddd; flex-shrink: 0; }
.dv-name { flex: 1; color: #555; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv-color-input { width: 28px; height: 22px; padding: 0; border: none; cursor: pointer; }
.dv-input { width: 80px; padding: 2px 4px; border: 1px solid #dadce0; border-radius: 3px; font-size: 11px; }
.dv-theme-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.dv-theme-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.dv-theme-item:hover { background: #f0f0f0; }
.dv-theme-item.active { background: #d2e3fc; color: #1a73e8; }
.dv-theme-actions { display: flex; gap: 4px; }
.dv-btn { padding: 4px 8px; background: white; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 10px; }
.dv-btn:hover { background: #e8eaed; }
</style>
