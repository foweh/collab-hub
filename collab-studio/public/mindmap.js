// ─── 思维导图编辑器 ──────────────────────────────────────
(function() {

let currentProject = null;
let nodes = [];       // [{ id, x, y, text, color, parentId }]
let edges = [];       // [{ from, to }]
let selectedNodeId = null;
let dragging = false;
let dragNodeId = null;
let dragOffset = { x: 0, y: 0 };
let panX = 0, panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let nodeCounter = 0;

const canvas = $('#mindmap-canvas');
const ctx = canvas.getContext('2d');
const titleEl = $('#mindmap-title');
const addNodeBtn = $('#mm-add-root');
const addChildBtn = $('#mm-add-child');
const addSiblingBtn = $('#mm-add-sibling');
const delNodeBtn = $('#mm-delete-node');
const colorPicker = $('#mm-color');

// ─── 尺寸 ────────────────────────────────────────────────
window.mmResize = function() {
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  render();
};

window.addEventListener('resize', () => {
  if (currentProject) window.mmResize();
});

// ─── 打开导图 ────────────────────────────────────────────
window.openMindMapEditor = function(project) {
  currentProject = project;
  titleEl.textContent = `🧠 ${esc(project.name)}`;
  const data = project.data || { nodes: [], edges: [] };
  nodes = data.nodes || [];
  edges = data.edges || [];
  // 重建计数器
  nodeCounter = nodes.reduce((max, n) => Math.max(max, parseInt(n.id.replace('n','')) || 0), 0);
  selectedNodeId = null;
  panX = 0; panY = 0;
  setTimeout(window.mmResize, 50);
};

// ─── Canvas 事件 ─────────────────────────────────────────
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('dblclick', onDoubleClick);
canvas.addEventListener('wheel', onWheel, { passive: false });

function getCanvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function toWorld(screen) {
  return { x: screen.x - panX, y: screen.y - panY };
}

function toScreen(world) {
  return { x: world.x + panX, y: world.y + panY };
}

// ─── 节点渲染 ────────────────────────────────────────────
const NODE_W = 120;
const NODE_H = 40;

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 绘制连线
  edges.forEach(edge => {
    const from = nodes.find(n => n.id === edge.from);
    const to = nodes.find(n => n.id === edge.to);
    if (!from || !to) return;
    const p1 = toScreen(from);
    const p2 = toScreen(to);
    ctx.beginPath();
    ctx.moveTo(p1.x + NODE_W / 2, p1.y + NODE_H / 2);
    ctx.lineTo(p2.x + NODE_W / 2, p2.y + NODE_H / 2);
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // 绘制节点
  nodes.forEach(node => {
    const pos = toScreen(node);
    const isSelected = node.id === selectedNodeId;
    const color = node.color || '#4fc3f7';

    // 阴影
    ctx.shadowColor = isSelected ? '#4fc3f7' : 'transparent';
    ctx.shadowBlur = isSelected ? 12 : 0;

    // 圆角矩形
    const radius = 8;
    ctx.beginPath();
    ctx.roundRect(pos.x, pos.y, NODE_W, NODE_H, radius);
    ctx.fillStyle = node.color || '#1e1e3a';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#4fc3f7' : (node.color || '#333366');
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // 文字
    ctx.fillStyle = '#e0e0f0';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayText = node.text.length > 12 ? node.text.slice(0, 12) + '…' : node.text;
    ctx.fillText(displayText, pos.x + NODE_W / 2, pos.y + NODE_H / 2);
  });
}

// 添加 roundRect polyfill if needed
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    return this;
  };
}

// ─── 鼠标交互 ────────────────────────────────────────────
function hitTest(pos) {
  // 反向遍历（上层优先）
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const s = toScreen(n);
    if (pos.x >= s.x && pos.x <= s.x + NODE_W && pos.y >= s.y && pos.y <= s.y + NODE_H) {
      return n;
    }
  }
  return null;
}

function onMouseDown(e) {
  const pos = getCanvasPos(e);
  const hit = hitTest(pos);

  if (hit) {
    selectedNodeId = hit.id;
    dragging = true;
    dragNodeId = hit.id;
    dragOffset = { x: pos.x - toScreen(hit).x, y: pos.y - toScreen(hit).y };
    render();
  } else {
    selectedNodeId = null;
    isPanning = true;
    panStart = { x: e.clientX - panX, y: e.clientY - panY };
    render();
  }
}

function onMouseMove(e) {
  if (dragging && dragNodeId) {
    const pos = getCanvasPos(e);
    const node = nodes.find(n => n.id === dragNodeId);
    if (node) {
      // 限制在 canvas 内
      node.x = Math.max(0, Math.min(canvas.width - NODE_W, pos.x - dragOffset.x - panX));
      node.y = Math.max(0, Math.min(canvas.height - NODE_H, pos.y - dragOffset.y - panY));
      render();
    }
  } else if (isPanning) {
    panX = e.clientX - panStart.x;
    panY = e.clientY - panStart.y;
    render();
  }
}

function onMouseUp(_e) {
  if (dragging && dragNodeId) {
    // 保存位置
    saveData();
  }
  dragging = false;
  dragNodeId = null;
  isPanning = false;
}

function onDoubleClick(e) {
  const pos = getCanvasPos(e);
  const hit = hitTest(pos);

  if (hit) {
    // 编辑文字
    const world = toScreen(hit);
    showTextInput(world.x, world.y, hit);
  } else {
    // 在点击位置创建新节点
    const world = toWorld(pos);
    const id = 'n' + (++nodeCounter);
    const newNode = {
      id,
      x: world.x,
      y: world.y,
      text: '新节点',
      color: colorPicker.value,
      parentId: null,
    };
    nodes.push(newNode);
    selectedNodeId = id;
    render();
    saveData();
    // 立即编辑文字
    showTextInput(pos.x, pos.y, newNode);
  }
}

function onWheel(e) {
  e.preventDefault();
  // 简单的上下平移
  panY -= e.deltaY * 0.5;
  render();
}

// ─── 文字编辑浮层 ────────────────────────────────────────
let inputOverlay = null;

function showTextInput(x, y, node) {
  if (inputOverlay) inputOverlay.remove();

  const input = document.createElement('input');
  input.className = 'mm-input-overlay';
  input.value = node.text;
  input.style.left = x + 'px';
  input.style.top = y + 'px';
  input.style.width = NODE_W + 'px';
  canvas.parentElement.appendChild(input);
  input.focus();
  input.select();
  inputOverlay = input;

  const finish = () => {
    node.text = input.value || '节点';
    input.remove();
    inputOverlay = null;
    render();
    saveData();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = node.text; input.blur(); }
  });
}

// ─── 工具栏 ──────────────────────────────────────────────
addNodeBtn.addEventListener('click', () => {
  const id = 'n' + (++nodeCounter);
  const w = canvas.width / 2 - NODE_W / 2 - panX;
  const h = canvas.height / 2 - NODE_H / 2 - panY;
  const newNode = {
    id,
    x: Math.max(0, w),
    y: Math.max(0, h),
    text: '新节点',
    color: colorPicker.value,
    parentId: null,
  };
  nodes.push(newNode);
  selectedNodeId = id;
  render();
  saveData();
  // 显示编辑
  const s = toScreen(newNode);
  showTextInput(s.x, s.y, newNode);
});

addChildBtn.addEventListener('click', () => {
  if (!selectedNodeId) return alert('请先选中一个父节点');
  const parent = nodes.find(n => n.id === selectedNodeId);
  if (!parent) return;
  const id = 'n' + (++nodeCounter);
  const child = {
    id,
    x: parent.x + NODE_W + 20,
    y: parent.y + (nodes.filter(n => n.parentId === selectedNodeId).length * (NODE_H + 10)),
    text: '子节点',
    color: colorPicker.value,
    parentId: selectedNodeId,
  };
  nodes.push(child);
  edges.push({ from: selectedNodeId, to: id });
  selectedNodeId = id;
  render();
  saveData();
  const s = toScreen(child);
  showTextInput(s.x, s.y, child);
});

addSiblingBtn.addEventListener('click', () => {
  if (!selectedNodeId) return alert('请先选中一个节点');
  const ref = nodes.find(n => n.id === selectedNodeId);
  if (!ref) return;
  const parentId = ref.parentId;
  const id = 'n' + (++nodeCounter);
  const sibling = {
    id,
    x: ref.x,
    y: ref.y + NODE_H + 10,
    text: '同级节点',
    color: colorPicker.value,
    parentId,
  };
  nodes.push(sibling);
  if (parentId) edges.push({ from: parentId, to: id });
  selectedNodeId = id;
  render();
  saveData();
  const s = toScreen(sibling);
  showTextInput(s.x, s.y, sibling);
});

delNodeBtn.addEventListener('click', () => {
  if (!selectedNodeId) return alert('请先选中要删除的节点');
  // 删除所有子节点递归
  function delRecursive(id) {
    const children = nodes.filter(n => n.parentId === id);
    children.forEach(c => delRecursive(c.id));
    nodes = nodes.filter(n => n.id !== id);
    edges = edges.filter(e => e.from !== id && e.to !== id);
  }
  delRecursive(selectedNodeId);
  selectedNodeId = null;
  render();
  saveData();
});

// ─── 数据保存 ────────────────────────────────────────────
function saveData() {
  if (!currentProject) return;
  currentProject.data = { nodes: nodes.map(n => ({...n})), edges: edges.map(e => ({...e})) };
  socket.emit('project-update', {
    id: currentProject.id,
    data: currentProject.data,
  });
  socket.emit('realtime-event', {
    module: 'mindmap',
    event: 'mindmap-updated',
    payload: { id: currentProject.id, data: currentProject.data },
  });
}

// 实时同步
socket.on('mindmap-updated', (data) => {
  if (currentProject && currentProject.id === data.id) {
    currentProject.data = data.data;
    nodes = (data.data.nodes || []).map(n => ({...n}));
    edges = (data.data.edges || []).map(e => ({...e}));
    nodeCounter = nodes.reduce((max, n) => Math.max(max, parseInt(n.id.replace('n','')) || 0), 0);
    render();
  }
});

})();
