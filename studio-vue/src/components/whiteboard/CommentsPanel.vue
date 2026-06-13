<template>
  <div class="comments-panel">
    <div class="cp-header">
      <span>批注 <span class="cp-badge" v-if="store.openCount > 0">{{ store.openCount }}</span></span>
      <button :class="['cp-mode-btn', { active: store.commentMode }]" @click="store.toggleCommentMode()" title="按 M 切换评论模式">
        {{ store.commentMode ? '📝 评论中' : '💬 评论' }}
      </button>
    </div>

    <div class="cp-filter">
      <button :class="['cp-filter-btn', { active: store.filterStatus === 'all' }]" @click="store.filterStatus = 'all'">全部</button>
      <button :class="['cp-filter-btn', { active: store.filterStatus === 'open' }]" @click="store.filterStatus = 'open'">待处理</button>
      <button :class="['cp-filter-btn', { active: store.filterStatus === 'resolved' }]" @click="store.filterStatus = 'resolved'">已解决</button>
    </div>

    <div class="cp-list" v-if="store.filteredAnnotations.length > 0">
      <div v-for="ann in store.filteredAnnotations" :key="ann.id" :class="['cp-item', { 'cp-resolved': ann.status === 'resolved' }]">
        <div class="cp-item-header">
          <span class="cp-user">{{ ann.userId }}</span>
          <span :class="['cp-status', ann.status]">{{ statusLabel(ann.status) }}</span>
          <span class="cp-time">{{ timeAgo(ann.createdAt) }}</span>
        </div>
        <div class="cp-text">{{ ann.content.text }}</div>
        <div class="cp-actions">
          <button v-if="ann.status !== 'resolved'" class="cp-action-btn" @click="store.setStatus(ann.id, 'resolved')">✓ 解决</button>
          <button v-if="ann.status === 'resolved'" class="cp-action-btn" @click="store.setStatus(ann.id, 'open')">↩ 重新打开</button>
          <button class="cp-action-btn danger" @click="store.remove(ann.id)">🗑 删除</button>
        </div>

        <!-- 回复列表 -->
        <div class="cp-replies" v-if="ann.replyThread.length > 0">
          <div v-for="(r, i) in ann.replyThread" :key="i" class="cp-reply">
            <span class="cp-reply-user">{{ r.userId }}</span>
            <span class="cp-reply-text">{{ r.text }}</span>
            <span class="cp-reply-time">{{ timeAgo(r.timestamp) }}</span>
          </div>
        </div>

        <!-- 回复输入 -->
        <div class="cp-reply-input">
          <input v-model="replyTexts[ann.id]" @keydown.enter="sendReply(ann.id)" placeholder="回复..." class="cp-input" />
        </div>
      </div>
    </div>
    <div class="cp-empty" v-else>
      {{ store.commentMode ? '在画布上点击添加批注' : '按 M 键进入评论模式' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { useCommentsStore } from '../../stores/comments'

const store = useCommentsStore()
const replyTexts = reactive<Record<string, string>>({})

function sendReply(annotationId: string) {
  const text = replyTexts[annotationId]?.trim()
  if (!text) return
  store.reply(annotationId, text)
  replyTexts[annotationId] = ''
}

function statusLabel(status: string): string {
  switch (status) {
    case 'open': return '待处理'
    case 'resolved': return '已解决'
    case 'rejected': return '已拒绝'
    case 'pending': return '待审批'
    default: return status
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return mins + '分钟前'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + '小时前'
  return Math.floor(hours / 24) + '天前'
}
</script>

<style scoped>
.comments-panel { display: flex; flex-direction: column; height: 100%; font-size: 12px; }
.cp-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: 600; }
.cp-badge { background: #1a73e8; color: white; border-radius: 10px; padding: 1px 6px; font-size: 10px; margin-left: 4px; }
.cp-mode-btn { padding: 3px 8px; border: 1px solid #dadce0; border-radius: 4px; background: white; cursor: pointer; font-size: 11px; }
.cp-mode-btn.active { background: #d2e3fc; border-color: #1a73e8; color: #1a73e8; }
.cp-filter { display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid #eee; }
.cp-filter-btn { padding: 2px 8px; border: none; background: transparent; border-radius: 4px; cursor: pointer; font-size: 11px; color: #666; }
.cp-filter-btn.active { background: #e8eaed; color: #333; }
.cp-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.cp-item { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
.cp-item.cp-resolved { opacity: 0.55; }
.cp-item-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.cp-user { font-weight: 600; color: #333; font-size: 11px; }
.cp-status { font-size: 10px; padding: 1px 5px; border-radius: 3px; }
.cp-status.open { background: #fff3e0; color: #e65100; }
.cp-status.resolved { background: #e8f5e9; color: #2e7d32; }
.cp-status.rejected { background: #fce4ec; color: #c62828; }
.cp-time { font-size: 10px; color: #999; margin-left: auto; }
.cp-text { font-size: 12px; color: #444; margin-bottom: 4px; line-height: 1.4; }
.cp-actions { display: flex; gap: 4px; margin-bottom: 4px; }
.cp-action-btn { padding: 2px 6px; border: none; background: transparent; border-radius: 3px; cursor: pointer; font-size: 10px; color: #1a73e8; }
.cp-action-btn:hover { background: #e8eaed; }
.cp-action-btn.danger { color: #c62828; }
.cp-replies { margin: 4px 0 4px 8px; padding-left: 8px; border-left: 2px solid #ddd; }
.cp-reply { margin-bottom: 3px; font-size: 11px; }
.cp-reply-user { font-weight: 600; color: #555; margin-right: 4px; }
.cp-reply-text { color: #444; }
.cp-reply-time { font-size: 9px; color: #aaa; margin-left: 4px; }
.cp-reply-input { margin-top: 4px; }
.cp-input { width: 100%; padding: 4px 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 11px; box-sizing: border-box; }
.cp-empty { text-align: center; padding: 24px 12px; color: #999; font-size: 12px; }
</style>
