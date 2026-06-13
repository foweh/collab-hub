<template>
  <div class="minimap" :style="{ width: size + 'px', height: (size * ratio) + 'px' }">
    <div class="mm-header">导航</div>
    <canvas ref="canvasRef" :width="size" :height="size * ratio" class="mm-canvas"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useWhiteboardStore } from '../../stores/whiteboard'

const props = withDefaults(defineProps<{ size?: number }>(), { size: 160 })
const store = useWhiteboardStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

const ratio = computed(() => {
  if (store.elements.length === 0) return 0.75
  let maxX = 0, maxY = 0
  for (const el of store.elements) {
    maxX = Math.max(maxX, el.x + el.width)
    maxY = Math.max(maxY, el.y + el.height)
  }
  return Math.max(0.5, Math.min(2, maxY / Math.max(maxX, 1)))
})

function render() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#f0f0f0'
  ctx.fillRect(0, 0, w, h)

  if (store.elements.length === 0) return

  let maxX = 0, maxY = 0
  for (const el of store.elements) {
    maxX = Math.max(maxX, el.x + el.width)
    maxY = Math.max(maxY, el.y + el.height)
  }
  const scaleX = (w - 20) / Math.max(maxX, 1)
  const scaleY = (h - 20) / Math.max(maxY, 1)
  const s = Math.min(scaleX, scaleY)
  const pad = 10

  // 绘制元素
  for (const el of store.elements) {
    ctx.fillStyle = el.fill || '#ccc'
    ctx.fillRect(pad + el.x * s, pad + el.y * s, Math.max(el.width * s, 2), Math.max(el.height * s, 2))
    if (el === store.selectedElements[0]) {
      ctx.strokeStyle = '#1a73e8'
      ctx.lineWidth = 2
      ctx.strokeRect(pad + el.x * s, pad + el.y * s, Math.max(el.width * s, 2), Math.max(el.height * s, 2))
    }
  }

  // 绘制视口
  const vw = 800 / store.scale
  const vh = 600 / store.scale
  ctx.strokeStyle = 'rgba(26,115,232,0.5)'
  ctx.lineWidth = 1
  const vx = pad + (-store.offsetX / store.scale) * s
  const vy = pad + (-store.offsetY / store.scale) * s
  ctx.strokeRect(vx, vy, vw * s, vh * s)
}

watch(() => [store.elements.length, store.scale, store.offsetX, store.offsetY], () => {
  nextTick(render)
}, { deep: true })

onMounted(() => {
  nextTick(render)
})
</script>

<style scoped>
.minimap {
  position: absolute;
  bottom: 60px;
  right: 16px;
  background: white;
  border: 1px solid #dadce0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  z-index: 10;
  overflow: hidden;
}

.mm-header {
  padding: 4px 8px;
  font-size: 11px;
  color: #666;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
  text-align: center;
}

.mm-canvas {
  display: block;
}
</style>
