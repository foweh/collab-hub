// ─── 思维导图 v2 — 类 ximind 优雅版 ────────────────────
(function() {

let currentProject = null;
let nodes = [];
let edges = [];
let selectedIds = new Set();
let nodeCounter = 0;

// 摄像机（平移 + 缩放）
const camera = { x: 0, y: 0, zoom: 1 };

// 拖拽状态
let drag = { active: false, nodeId: null, offX: 0, offY: 0, type: null };
let pan = { active: false, startX: 0, startY: 0, camX: 0, camY: 0 };

// DOM
const canvas = document.getElementById('mindmap-canvas');
const ctx = canvas.getContext('2d');
const titleEl = document.getElementById('mindmap-title');

// ─── 常量 ────────────────────────────────────────────────
const NODE_MIN_W = 100;
const NODE_H = 38;
const NODE_PAD = 14;
const LEVEL_GAP = 50;    // 父子层级水平间距
const VERT_GAP = 12;     // 同级垂直间距
const FONT = '14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const COLORS = [
  '#4fc3f7', '#7c4dff', '#ff7043', '#66bb6a',
  '#ffca28', '#ec407a', '#26c6da', '#ab47bc',
];

// ─── 尺寸管理 ────────────────────────────────────────────
window.mmResize = function() {
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  render();
};

window.addEventListener('resize', () => {
  if (document.getElementById('panel-mindmap').classList.contains('active')) mmResize();
});

// ─── 打开导图 ────────────────────────────────────────────
window.openMindMapEditor = function(project) {
  currentProject = project;
  titleEl.textContent = `🧠 ${esc(project.name)}`;
  const data = project.data || { nodes: [], edges: [] };
  nodes = JSON.parse(JSON.stringify(data.nodes || []));
  edges = JSON.parse(JSON.stringify(data.edges || []));
  nodeCounter = nodes.reduce((m, n) => Math.max(m, parseInt(n.id.replace('n','')) || 0), 0);

  // 如果没有节点，创建一个根节点
  if (nodes.length === 0) {
    addNodeInternal(null, '中心主题', COLORS[0]);
  }

  // 自动布局
  autoLayout();

  // 重置摄像机到根节点
  const root = nodes.find(n => !n.parentId);
  if (root) {
    camera.x = canvas.width / 2 - root.x;
    camera.y = canvas.height / 3 - root.y;
    camera.zoom = 1;
  }
  selectedIds.clear();
  setTimeout(mmResize, 50);
};

// ─── 布局引擎 ────────────────────────────────────────────
function autoLayout() {
  const root = nodes.find(n => !n.parentId);
  if (!root) return;

  // 计算每个节点的文本宽度
  nodes.forEach(n => {
    n.textWidth = measureText(n.text || '节点');
    n.width = Math.max(NODE_MIN_W, n.textWidth + NODE_PAD * 2);
    n.height = NODE_H;
  });

  // 从根开始递归计算子树尺寸和位置
  function layoutSubtree(nodeId, x) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { totalH: 0, children: [] };

    const children = nodes.filter(n => n.parentId === nodeId);
    if (children.length === 0) {
      return { totalH: node.height + VERT_GAP, children: [], selfH: node.height };
    }

    // 递归计算每个子树的尺寸
    const results = children.map(c => layoutSubtree(c.id, x + LEVEL_GAP + node.width));
    const totalH = results.reduce((sum, r) => sum + r.totalH, 0);

    // 定位子节点垂直居中
    let yOff = -totalH / 2;
    children.forEach((c, i) => {
      c.x = x + LEVEL_GAP + (node.width / 2);
      c.y = yOff + results[i].totalH / 2 - c.height / 2;
      const r = results[i];
      if (r.children) {
        r.children.forEach(([childId, cx, cy]) => {
          const child = nodes.find(n => n.id === childId);
          if (child && child !== c) { child.x = cx; child.y = cy; }
        });
      }
      yOff += results[i].totalH;
    });

    return { totalH: Math.max(totalH, node.height + VERT_GAP), children: children.map((c, i) => [c.id, c.x, c.y]) };
  }

  // 根节点居中偏左
  root.x = 60;
  root.y = 0;
  layoutSubtree(root.id, root.x);

  // 垂直居中整个树
  const bounds = getBounds();
  const shiftY = -bounds.minY + 30;
  nodes.forEach(n => { n.y += shiftY; });
}

function getBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + (n.width || NODE_MIN_W) > maxX) maxX = n.x + (n.width || NODE_MIN_W);
    if (n.y + (n.height || NODE_H) > maxY) maxY = n.y + (n.height || NODE_H);
  });
  return { minX, minY, maxX, maxY };
}

function measureText(text) {
  ctx.font = FONT;
  return ctx.measureText(text).width;
}

// ─── 渲染引擎 ────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // 绘制背景网格（提升空间感）
  drawGrid();

  // 绘制连线
  edges.forEach(e => {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    drawEdge(from, to);
  });

  // 绘制节点
  nodes.forEach(n => {
    drawNode(n, selectedIds.has(n.id));
  });

  ctx.restore();

  // 顶部叠加缩放信息
  drawHUD();
}

function drawGrid() {
  const gridSize = 40 * camera.zoom;
  const offsetX = camera.x % gridSize;
  const offsetY = camera.y % gridSize;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = offsetX; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = offsetY; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawEdge(from, to) {
  const fx = from.x + (from.width || NODE_MIN_W);
  const fy = from.y + (from.height || NODE_H) / 2;
  const tx = to.x;
  const ty = to.y + (to.height || NODE_H) / 2;
  const cx = (fx + tx) / 2;

  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.bezierCurveTo(cx, fy, cx, ty, tx, ty);
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.2)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 小圆点终点
  ctx.beginPath();
  ctx.arc(tx, ty, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(79, 195, 247, 0.35)';
  ctx.fill();
}

function drawNode(node, selected) {
  const x = node.x;
  const y = node.y;
  const w = node.width || NODE_MIN_W;
  const h = node.height || NODE_H;
  const color = node.color || '#4fc3f7';
  const r = 8; // 圆角

  // 阴影
  ctx.shadowColor = selected ? `rgba(79, 195, 247, 0.5)` : 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = selected ? 20 : 6;
  ctx.shadowOffsetY = selected ? 0 : 2;

  // 渐变背景
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (selected) {
    grad.addColorStop(0, '#2a3a6a');
    grad.addColorStop(1, '#1e2a50');
  } else {
    grad.addColorStop(0, '#1e2a4a');
    grad.addColorStop(1, '#162040');
  }

  // 左侧色条
  ctx.beginPath();
  ctx.roundRect(x, y, 4, h, { upperLeft: r, lowerLeft: r });
  ctx.fillStyle = color;
  ctx.fill();

  // 主体
  ctx.beginPath();
  ctx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r });
  ctx.fillStyle = grad;
  ctx.fill();

  // 边框
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? '#4fc3f7' : 'rgba(255,255,255,0.08)';
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.beginPath();
  ctx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r });
  ctx.stroke();

  // 选中时发光外框
  if (selected) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 3, w + 6, h + 6, r + 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 文字
  ctx.fillStyle = '#e8e8f0';
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const displayText = node.text || '节点';
  const maxW = w - NODE_PAD * 2 - 4;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r });
  ctx.clip();
  ctx.fillText(displayText, x + NODE_PAD + 4, y + h / 2, maxW);
  ctx.restore();

  // 锁标记
  if (isLocked('mindmap-node', node.id)) {
    const lockUser = getLockUser('mindmap-node', node.id);
    if (lockUser && lockUser !== myName) {
      ctx.fillStyle = 'rgba(255, 82, 82, 0.9)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`🔒 ${lockUser}`, x + w - 6, y + h - 4);
    }
  }
}

function drawHUD() {
  // 缩放百分比
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(camera.zoom * 100)}%`, canvas.width - 12, canvas.height - 8);
}

// ─── 坐标系转换 ──────────────────────────────────────────
function screenToWorld(sx, sy) {
  return {
    x: (sx - camera.x) / camera.zoom,
    y: (sy - camera.y) / camera.zoom,
  };
}

function worldToScreen(wx, wy) {
  return { x: wx * camera.zoom + camera.x, y: wy * camera.zoom + camera.y };
}

function hitTest(sx, sy) {
  const w = screenToWorld(sx, sy);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const nw = n.width || NODE_MIN_W;
    const nh = n.height || NODE_H;
    if (w.x >= n.x && w.x <= n.x + nw && w.y >= n.y && w.y <= n.y + nh) {
      return n;
    }
  }
  return null;
}

// ─── 鼠标事件 ────────────────────────────────────────────
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('dblclick', onDblClick);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function onMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const hit = hitTest(sx, sy);

  if (hit) {
    if (e.shiftKey) {
      // Shift+点击：多选切换
      if (selectedIds.has(hit.id)) selectedIds.delete(hit.id);
      else selectedIds.add(hit.id);
      render();
      return;
    }
    selectedIds.clear();
    selectedIds.add(hit.id);
    render();

    drag.active = true;
    drag.nodeId = hit.id;
    drag.type = 'node';
    const w = hitTest(sx, sy);
    drag.offX = sx - worldToScreen(hit.x, hit.y).x;
    drag.offY = sy - worldToScreen(hit.x, hit.y).y;
  } else {
    selectedIds.clear();
    render();
    // 平移画布
    pan.active = true;
    pan.startX = sx;
    pan.startY = sy;
    pan.camX = camera.x;
    pan.camY = camera.y;
    canvas.style.cursor = 'grabbing';
  }
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (drag.active && drag.nodeId) {
    const node = nodes.find(n => n.id === drag.nodeId);
    if (node) {
      const ws = worldToScreen(node.x, node.y);
      const dx = (sx - drag.offX - ws.x + node.x * camera.zoom + camera.x) / camera.zoom;
      const dy = (sy - drag.offY - ws.y + node.y * camera.zoom + camera.y) / camera.zoom;
      // ... actually let me simplify this:
      const wPos = screenToWorld(sx - drag.offX, sy - drag.offY);
      // Move all selected nodes
      const deltaX = wPos.x - node.x;
      const deltaY = wPos.y - node.y;
      for (const id of selectedIds) {
        const n = nodes.find(nd => nd.id === id);
        if (n) { n.x += deltaX; n.y += deltaY; }
      }
      render();
    }
  } else if (pan.active) {
    camera.x = pan.camX + (sx - pan.startX);
    camera.y = pan.camY + (sy - pan.startY);
    render();
  } else {
    // 悬停光标
    canvas.style.cursor = hitTest(sx, sy) ? 'pointer' : 'grab';
  }
}

function onMouseUp(_e) {
  if (drag.active) {
    saveData();
  }
  drag.active = false;
  drag.nodeId = null;
  pan.active = false;
  canvas.style.cursor = 'grab';
}

function onWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const oldZoom = camera.zoom;
    camera.zoom = Math.max(0.2, Math.min(3, camera.zoom + delta));

    // 以鼠标位置为中心缩放
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    camera.x = mx - (mx - camera.x) * (camera.zoom / oldZoom);
    camera.y = my - (my - camera.y) * (camera.zoom / oldZoom);

    render();
  } else {
    // 上下滚动画布
    camera.y -= e.deltaY * 0.5;
    render();
  }
}

function onDblClick(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const hit = hitTest(sx, sy);

  if (hit) {
    showEditor(hit);
  } else {
    // 双击空白创建节点
    const w = screenToWorld(sx, sy);
    const id = addNodeInternal(null, '新节点', COLORS[nodeCounter % COLORS.length]);
    const node = nodes.find(n => n.id === id);
    if (node) {
      node.x = w.x - 50;
      node.y = w.y - NODE_H / 2;
      selectedIds.clear();
      selectedIds.add(id);
      render();
      saveData();
      showEditor(node);
    }
  }
}

// ─── 文字编辑浮层 ────────────────────────────────────────
let editorInput = null;

let currentEditNodeId = null; // 当前正在编辑的节点 ID（用于释放锁）

function showEditor(node) {
  // 检查锁
  if (isLocked('mindmap-node', node.id)) {
    const user = getLockUser('mindmap-node', node.id);
    showToast(`🔒 ${user} 正在编辑此节点`);
    return;
  }
  hideEditor();

  // 获取锁
  acquireLock('mindmap-node', node.id);
  currentEditNodeId = node.id;

  const s = worldToScreen(node.x + 4, node.y);
  const sw = (node.width || NODE_MIN_W) * camera.zoom - 4;
  const sh = (node.height || NODE_H) * camera.zoom;

  const input = document.createElement('input');
  input.className = 'mm-inline-editor';
  input.value = node.text || '';
  input.style.left = s.x + 'px';
  input.style.top = s.y + 'px';
  input.style.width = sw + 'px';
  input.style.height = sh + 'px';
  input.style.fontSize = Math.round(14 * camera.zoom) + 'px';
  canvas.parentElement.appendChild(input);
  input.focus();
  input.select();
  editorInput = input;

  const finish = () => {
    // 释放锁
    if (currentEditNodeId) {
      releaseLock('mindmap-node', currentEditNodeId);
      currentEditNodeId = null;
    }
    node.text = input.value || '节点';
    node.textWidth = measureText(node.text);
    node.width = Math.max(NODE_MIN_W, node.textWidth + NODE_PAD * 2);
    input.remove();
    editorInput = null;
    render();
    saveData();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = node.text; input.blur(); }
    if (e.key === 'Tab') { e.preventDefault(); input.blur(); addChild(); }
  });
}

function hideEditor() {
  if (editorInput) {
    if (currentEditNodeId) {
      releaseLock('mindmap-node', currentEditNodeId);
      currentEditNodeId = null;
    }
    editorInput.remove();
    editorInput = null;
  }
}

// ─── Toast 提示 ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('mm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mm-toast';
    el.style.cssText = 'position:absolute;bottom:60px;left:50%;transform:translateX(-50%);background:#3a1b1b;color:#ff5252;padding:8px 16px;border-radius:8px;font-size:13px;z-index:100;border:1px solid #ff5252;box-shadow:0 2px 12px rgba(0,0,0,0.4);transition:opacity 0.3s';
    canvas.parentElement.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// 监听锁变化：如果当前编辑的节点被其他人锁了，释放编辑
window.addEventListener('locks-changed', () => {
  if (currentEditNodeId && isLocked('mindmap-node', currentEditNodeId)) {
    const user = getLockUser('mindmap-node', currentEditNodeId);
    if (user && user !== myName) {
      hideEditor();
      showToast(`🔒 ${user} 正在编辑此节点`);
    }
  }
  if (document.getElementById('panel-mindmap').classList.contains('active')) {
    render();
  }
});

// ─── 节点操作 ────────────────────────────────────────────
function addNodeInternal(parentId, text, color) {
  const id = 'n' + (++nodeCounter);
  const nw = measureText(text) + NODE_PAD * 2 + 10;
  nodes.push({
    id, text: text || '节点',
    x: 0, y: 0,
    width: Math.max(NODE_MIN_W, nw),
    height: NODE_H,
    color: color || COLORS[0],
    parentId: parentId || null,
  });
  if (parentId) {
    edges.push({ from: parentId, to: id });
  }
  return id;
}

function getSelectedNode() {
  if (selectedIds.size === 0) return null;
  return nodes.find(n => n.id === [...selectedIds][0]);
}

function addChild() {
  const parent = getSelectedNode();
  if (!parent) return;
  const color = COLORS[++nodeCounter % COLORS.length];
  const id = addNodeInternal(parent.id, '子节点', COLORS[nodeCounter % COLORS.length]);
  const child = nodes.find(n => n.id === id);
  const children = nodes.filter(n => n.parentId === parent.id);
  child.x = parent.x + (parent.width || NODE_MIN_W) + LEVEL_GAP;
  child.y = parent.y + (children.length - 1) * (NODE_H + VERT_GAP) - (children.length > 1 ? (children.length - 1) * (NODE_H + VERT_GAP) / 2 : 0);
  // 简单重新布局
  autoLayout();
  selectedIds.clear();
  selectedIds.add(id);
  render();
  saveData();
  const s = worldToScreen(child.x, child.y);
  showEditor(child);
}

function addSibling() {
  const ref = getSelectedNode();
  if (!ref || !ref.parentId) return;
  const children = nodes.filter(n => n.parentId === ref.parentId);
  const lastIdx = children.length - 1;
  const id = addNodeInternal(ref.parentId, '同级节点', COLORS[nodeCounter % COLORS.length]);
  const sibling = nodes.find(n => n.id === id);
  sibling.x = ref.x;
  sibling.y = ref.y + (ref.height || NODE_H) + VERT_GAP;
  autoLayout();
  selectedIds.clear();
  selectedIds.add(id);
  render();
  saveData();
  const s = worldToScreen(sibling.x, sibling.y);
  showEditor(sibling);
}

function deleteSelected() {
  if (selectedIds.size === 0) return;
  const toDelete = new Set(selectedIds);
  // 递归删除子节点
  function collectChildren(id) {
    nodes.filter(n => n.parentId === id).forEach(c => {
      toDelete.add(c.id);
      collectChildren(c.id);
    });
  }
  for (const id of selectedIds) collectChildren(id);

  nodes = nodes.filter(n => !toDelete.has(n.id));
  edges = edges.filter(e => !toDelete.has(e.from) && !toDelete.has(e.to));
  selectedIds.clear();
  autoLayout();
  render();
  saveData();
}

function fitToScreen() {
  const bounds = getBounds();
  if (bounds.minX === Infinity) return;
  const pad = 40;
  const bw = bounds.maxX - bounds.minX + pad * 2;
  const bh = bounds.maxY - bounds.minY + pad * 2;
  const zoomX = canvas.width / bw;
  const zoomY = canvas.height / bh;
  camera.zoom = Math.min(zoomX, zoomY, 1.5);
  camera.x = -bounds.minX * camera.zoom + pad * camera.zoom;
  camera.y = -bounds.minY * camera.zoom + pad * camera.zoom;
  render();
}

function zoomIn() {
  camera.zoom = Math.min(3, camera.zoom + 0.2);
  render();
}

function zoomOut() {
  camera.zoom = Math.max(0.2, camera.zoom - 0.2);
  render();
}

// ─── 键盘快捷键 ──────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (editorInput) return; // 正在编辑文字
  const panel = document.getElementById('panel-mindmap');
  if (!panel || !panel.classList.contains('active')) return;

  switch (e.key) {
    case 'Tab': e.preventDefault(); addChild(); break;
    case 'Enter': e.preventDefault(); addSibling(); break;
    case 'Delete':
    case 'Backspace': e.preventDefault(); deleteSelected(); break;
    case ' ': e.preventDefault(); const n = getSelectedNode(); if (n) showEditor(n); break;
    case 'F2': e.preventDefault(); const n2 = getSelectedNode(); if (n2) showEditor(n2); break;
  }
});

// ─── 工具栏事件绑定 ──────────────────────────────────────
document.getElementById('mm-add-root').addEventListener('click', () => {
  const id = addNodeInternal(null, '中心主题', COLORS[0]);
  autoLayout();
  const node = nodes.find(n => n.id === id);
  selectedIds.clear();
  selectedIds.add(id);
  render();
  saveData();
});

document.getElementById('mm-add-child').addEventListener('click', addChild);
document.getElementById('mm-add-sibling').addEventListener('click', addSibling);
document.getElementById('mm-delete-node').addEventListener('click', deleteSelected);

// 缩放按钮（动态创建）
const toolbar = document.getElementById('mindmap-toolbar');
const zoomOutBtn = document.createElement('button');
zoomOutBtn.className = 'tool-btn'; zoomOutBtn.textContent = '🔍-';
zoomOutBtn.title = '缩小';
zoomOutBtn.addEventListener('click', zoomOut);
toolbar.insertBefore(zoomOutBtn, toolbar.firstChild);

const zoomInBtn = document.createElement('button');
zoomInBtn.className = 'tool-btn'; zoomInBtn.textContent = '🔍+';
zoomInBtn.title = '放大';
zoomInBtn.addEventListener('click', zoomIn);
toolbar.insertBefore(zoomInBtn, toolbar.firstChild);

const fitBtn = document.createElement('button');
fitBtn.className = 'tool-btn'; fitBtn.textContent = '⊞ 适应';
fitBtn.title = '缩放到适应屏幕';
fitBtn.addEventListener('click', fitToScreen);
toolbar.insertBefore(fitBtn, toolbar.firstChild);

// 全屏按钮
const fullBtn = document.createElement('button');
fullBtn.className = 'tool-btn'; fullBtn.textContent = '⛶ 全屏';
fullBtn.title = '独立全屏页面';
fullBtn.addEventListener('click', openFullscreen);
toolbar.appendChild(fullBtn);

function openFullscreen() {
  if (!currentProject) return;
  const base = window.location.origin;
  window.open(`${base}/mindmap-full.html?project=${currentProject.id}&serverId=${serverId}`, 'mindmap-full', 'width=1400,height=900');
}

// ─── 数据保存 ────────────────────────────────────────────
function saveData() {
  if (!currentProject) return;
  currentProject.data = { nodes: nodes.map(n => ({...n})), edges: edges.map(e => ({...e})) };
  socket.emit('project-update', { id: currentProject.id, data: currentProject.data });
  socket.emit('realtime-event', {
    module: 'mindmap', event: 'mindmap-updated',
    payload: { id: currentProject.id, data: currentProject.data },
  });
}

// ─── 实时同步 ────────────────────────────────────────────
socket.on('mindmap-updated', (data) => {
  if (currentProject && currentProject.id === data.id) {
    currentProject.data = data.data;
    nodes = JSON.parse(JSON.stringify(data.data.nodes || []));
    edges = JSON.parse(JSON.stringify(data.data.edges || []));
    nodeCounter = nodes.reduce((m, n) => Math.max(m, parseInt(n.id.replace('n','')) || 0), 0);
    render();
  }
});

// 导出函数供全屏页面使用
window.renderMindMap = render;
window.fitToScreen = fitToScreen;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.loadMindMapData = function(data) {
  nodes = JSON.parse(JSON.stringify(data.nodes || []));
  edges = JSON.parse(JSON.stringify(data.edges || []));
  render();
};

// ─── CollabStudio API 导出 ──────────────────────────────
window.registerCollabModule && window.registerCollabModule('mindmap', {
  name: 'mindmap',
  open: (project) => window.openMindMapEditor(project),
  save: () => saveData(),
  getData: () => currentProject ? { nodes, edges } : null,
  setData: (data) => { nodes = data.nodes || []; edges = data.edges || []; render(); },
  fitToScreen: () => fitToScreen(),
  zoomIn: () => zoomIn(),
  zoomOut: () => zoomOut(),
});

// 初始渲染
setTimeout(mmResize, 100);

})();
