<template>
  <div class="story-editor">
    <div class="se-toolbar">
      <button class="se-btn" @click="addChapter">+ 章节</button>
      <span class="se-stats">{{ data.chapters.length }} 章</span>
    </div>
    <div class="se-content">
      <div v-for="(ch, ci) in data.chapters" :key="ci" class="chapter-card">
        <div class="chapter-header" @click="toggleChapter(ci)">
          <span class="ch-arrow">{{ ch._collapsed ? '▶' : '▼' }}</span>
          <input class="ch-title" :value="ch.title" @input="updateChapter(ci, 'title', $event)" placeholder="章节标题..." @click.stop />
          <button class="se-btn sm danger" @click.stop="deleteChapter(ci)">×</button>
        </div>
        <div v-if="!ch._collapsed" class="chapter-body">
          <textarea class="ch-content" :value="ch.content" @input="updateChapter(ci, 'content', $event)" placeholder="在此书写故事内容..." rows="8"></textarea>
          <div class="ch-meta">
            <input class="ch-note" :value="ch.note || ''" @input="updateChapter(ci, 'note', $event)" placeholder="备注（可选）..." />
          </div>
        </div>
      </div>
      <div v-if="data.chapters.length === 0" class="se-empty">
        暂无内容，点击"+ 章节"开始写作
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useProjectStore } from '../../stores/project'

interface Chapter { title: string; content: string; note?: string; _collapsed?: boolean }
interface StoryData { chapters: Chapter[] }

const projectStore = useProjectStore()

const data = ref<StoryData>({ chapters: [] })

watch(() => projectStore.currentItem, (item) => {
  if (item && item.data) {
    data.value = item.data.chapters ? { chapters: item.data.chapters.map((c: any) => ({ ...c })) } : { chapters: [] }
  }
}, { immediate: true })

function save() {
  const item = projectStore.currentItem
  if (!item || !projectStore.currentProjectId) return
  item.data = { chapters: data.value.chapters }
  projectStore.update(projectStore.currentProjectId, { chapters: data.value.chapters })
}

function addChapter() {
  data.value.chapters.push({ title: `第${data.value.chapters.length + 1}章`, content: '' })
  save()
}

function deleteChapter(ci: number) {
  data.value.chapters.splice(ci, 1)
  save()
}

function toggleChapter(ci: number) {
  data.value.chapters[ci]._collapsed = !data.value.chapters[ci]._collapsed
}

function updateChapter(ci: number, field: string, e: Event) {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement
  ;(data.value.chapters[ci] as any)[field] = el.value
  save()
}
</script>

<style scoped>
.story-editor { display: flex; flex-direction: column; height: 100%; background: #fafafa; }
.se-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: white; border-bottom: 1px solid #eee; flex-shrink: 0; }
.se-btn { padding: 4px 12px; border: 1px solid #dadce0; background: white; border-radius: 4px; cursor: pointer; font-size: 12px; }
.se-btn.sm { padding: 2px 8px; font-size: 11px; }
.se-btn.danger { color: #c62828; border-color: #f8bbd0; }
.se-stats { font-size: 11px; color: #888; margin-left: auto; }
.se-content { flex: 1; overflow-y: auto; padding: 16px; }
.se-empty { text-align: center; padding: 40px; color: #999; }
.chapter-card { margin-bottom: 12px; background: white; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.chapter-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f5f5f5; cursor: pointer; }
.ch-arrow { font-size: 10px; color: #888; width: 12px; }
.ch-title { flex: 1; border: none; background: transparent; font-size: 14px; font-weight: 600; outline: none; }
.chapter-body { padding: 12px; }
.ch-content { width: 100%; padding: 8px; border: 1px solid #eee; border-radius: 4px; font-size: 13px; line-height: 1.6; resize: vertical; outline: none; font-family: inherit; box-sizing: border-box; }
.ch-content:focus { border-color: #1a73e8; }
.ch-meta { margin-top: 6px; }
.ch-note { width: 100%; padding: 4px 8px; border: 1px solid #eee; border-radius: 3px; font-size: 11px; color: #888; outline: none; box-sizing: border-box; }
</style>
