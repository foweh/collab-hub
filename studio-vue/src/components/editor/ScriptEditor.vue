<template>
  <div class="script-editor">
    <div class="se-toolbar">
      <button class="se-btn" @click="addAct">+ 幕</button>
      <span class="se-stats">{{ totalScenes }} 场 · {{ totalLines }} 行</span>
    </div>
    <div class="se-content" ref="contentRef">
      <div v-for="(act, ai) in data.acts" :key="ai" class="act-section">
        <div class="act-header" @click="toggleAct(ai)">
          <span class="act-arrow">{{ act._collapsed ? '▶' : '▼' }}</span>
          <input class="act-title" :value="act.title" @input="updateActTitle(ai, $event)" placeholder="幕标题..." />
          <button class="se-btn sm" @click.stop="addScene(ai)">+ 场</button>
          <button class="se-btn sm danger" @click.stop="deleteAct(ai)">删幕</button>
        </div>
        <div v-if="!act._collapsed" class="scenes-list">
          <div v-for="(scene, si) in act.scenes" :key="si" class="scene-card">
            <div class="scene-header">
              <input class="scene-location" :value="scene.location" @input="updateScene(ai, si, 'location', $event)" placeholder="场景地点..." />
              <input class="scene-time" :value="scene.time" @input="updateScene(ai, si, 'time', $event)" placeholder="时间..." />
              <button class="se-btn xs" @click="addLine(ai, si, 'action')">✍️动</button>
              <button class="se-btn xs" @click="addLine(ai, si, 'env')">🌄环</button>
              <button class="se-btn xs" @click="addLine(ai, si, 'dialogue')">🎭对白</button>
              <button class="se-btn xs danger" @click="deleteScene(ai, si)">×</button>
            </div>
            <div class="scene-lines">
              <div v-for="(line, li) in scene.lines" :key="li" :class="['line', 'line-' + line.type]">
                <template v-if="line.type === 'dialogue'">
                  <input class="line-char" :value="line.character" @input="updateLine(ai, si, li, 'character', $event)" placeholder="角色" list="char-suggest" />
                  <textarea class="line-text" :value="line.text" @input="updateLine(ai, si, li, 'text', $event)" placeholder="对白..." rows="1"></textarea>
                  <button class="line-del" @click="deleteLine(ai, si, li)">×</button>
                </template>
                <template v-else>
                  <span class="line-badge">{{ line.type === 'action' ? '✍️' : '🌄' }}</span>
                  <textarea class="line-text wide" :value="line.text" @input="updateLine(ai, si, li, 'text', $event)" :placeholder="line.type === 'action' ? '动作...' : '环境描写...'" rows="2"></textarea>
                  <button class="line-del" @click="deleteLine(ai, si, li)">×</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <datalist id="char-suggest">
      <option v-for="c in characters" :key="c" :value="c" />
    </datalist>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectStore } from '../../stores/project'
import { useSocketStore } from '../../stores/socket'

interface ScriptLine { type: string; character?: string; text: string }
interface Scene { location: string; time: string; lines: ScriptLine[] }
interface Act { title: string; scenes: Scene[]; _collapsed?: boolean }

const projectStore = useProjectStore()
const socketStore = useSocketStore()

const data = ref<{ acts: Act[] }>({ acts: [] })
const contentRef = ref<HTMLDivElement | null>(null)

// 从项目数据加载
watch(() => projectStore.currentItem, (item) => {
  if (item && item.data) {
    data.value = item.data.acts ? { acts: item.data.acts } : { acts: [] }
    ensureDefault()
  }
}, { immediate: true })

const characters = computed(() => {
  const set = new Set<string>()
  for (const act of data.value.acts) {
    for (const scene of act.scenes) {
      for (const line of scene.lines) {
        if (line.type === 'dialogue' && line.character) set.add(line.character)
      }
    }
  }
  return [...set]
})

const totalScenes = computed(() => {
  let n = 0
  for (const act of data.value.acts) n += act.scenes.length
  return n
})

const totalLines = computed(() => {
  let n = 0
  for (const act of data.value.acts) {
    for (const scene of act.scenes) n += scene.lines.length
  }
  return n
})

function ensureDefault() {
  if (data.value.acts.length === 0) {
    data.value.acts.push({ title: '第一幕', scenes: [{ location: '', time: '', lines: [] }] })
  }
}

function save() {
  const item = projectStore.currentItem
  if (!item || !projectStore.currentProjectId) return
  item.data = { acts: data.value.acts }
  projectStore.update(projectStore.currentProjectId, { acts: data.value.acts })
}

function addAct() {
  data.value.acts.push({ title: `第${data.value.acts.length + 1}幕`, scenes: [{ location: '', time: '', lines: [] }] })
  save()
}

function deleteAct(ai: number) {
  data.value.acts.splice(ai, 1)
  save()
}

function toggleAct(ai: number) {
  const act = data.value.acts[ai]
  act._collapsed = !act._collapsed
}

function addScene(ai: number) {
  data.value.acts[ai].scenes.push({ location: '', time: '', lines: [] })
  save()
}

function deleteScene(ai: number, si: number) {
  data.value.acts[ai].scenes.splice(si, 1)
  save()
}

function updateScene(ai: number, si: number, field: string, e: Event) {
  const el = e.target as HTMLInputElement
  ;(data.value.acts[ai].scenes[si] as any)[field] = el.value
  save()
}

function updateActTitle(ai: number, e: Event) {
  data.value.acts[ai].title = (e.target as HTMLInputElement).value
  save()
}

function addLine(ai: number, si: number, type: string) {
  data.value.acts[ai].scenes[si].lines.push({ type, text: '', character: type === 'dialogue' ? '' : undefined })
  save()
}

function deleteLine(ai: number, si: number, li: number) {
  data.value.acts[ai].scenes[si].lines.splice(li, 1)
  save()
}

function updateLine(ai: number, si: number, li: number, field: string, e: Event) {
  const el = e.target as HTMLInputElement
  ;(data.value.acts[ai].scenes[si].lines[li] as any)[field] = el.value
  save()
}
</script>

<style scoped>
.script-editor { display: flex; flex-direction: column; height: 100%; background: #fafafa; }
.se-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: white; border-bottom: 1px solid #eee; flex-shrink: 0; }
.se-btn { padding: 4px 12px; border: 1px solid #dadce0; background: white; border-radius: 4px; cursor: pointer; font-size: 12px; }
.se-btn.sm { padding: 2px 8px; font-size: 11px; }
.se-btn.xs { padding: 1px 6px; font-size: 10px; }
.se-btn.danger { color: #c62828; border-color: #f8bbd0; }
.se-stats { font-size: 11px; color: #888; margin-left: auto; }
.se-content { flex: 1; overflow-y: auto; padding: 16px; }
.act-section { margin-bottom: 16px; background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.act-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f5f5f5; cursor: pointer; }
.act-arrow { font-size: 10px; color: #888; width: 12px; }
.act-title { flex: 1; border: none; background: transparent; font-size: 14px; font-weight: 600; outline: none; }
.scenes-list { padding: 8px; }
.scene-card { margin-bottom: 8px; border: 1px solid #eee; border-radius: 6px; padding: 8px; }
.scene-header { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }
.scene-location, .scene-time { padding: 3px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px; outline: none; }
.scene-location { flex: 1; min-width: 100px; }
.scene-time { width: 80px; }
.scene-lines { display: flex; flex-direction: column; gap: 4px; }
.line { display: flex; align-items: flex-start; gap: 6px; padding: 4px 6px; border-radius: 4px; }
.line-dialogue { background: #fff8e1; }
.line-action { background: #f3e5f5; }
.line-env { background: #e8f5e9; }
.line-char { width: 80px; padding: 3px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px; font-weight: 500; flex-shrink: 0; }
.line-text { flex: 1; border: none; background: transparent; resize: vertical; font-size: 12px; line-height: 1.4; outline: none; font-family: inherit; min-height: 20px; }
.line-badge { font-size: 14px; padding-top: 2px; }
.line-del { border: none; background: transparent; cursor: pointer; color: #ccc; font-size: 14px; padding: 2px; }
.line-del:hover { color: #c62828; }
</style>
