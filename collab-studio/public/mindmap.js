// ─── 思维导图 v3 — 类 XMind 完整版 ──────────────────────
(function() {

let currentProject = null;
let nodes = [];
let edges = [];
let selectedIds = new Set();
let nodeCounter = 0;

// 摄像机
const camera = { x: 0, y: 0, zoom: 1 };

// 拖拽
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
const LEVEL_GAP = 50;
const VERT_GAP = 12;
const FONT = '14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const COLORS = ['#4fc3f7','#7c4dff','#ff7043','#66bb6a','#ffca28','#ec407a','#26c6da','#ab47bc'];
const MARKERS = { 'priority1':'🔴','priority2':'🟠','priority3':'🟡','priority4':'🔵','priority5':'⚪','done':'✅','progress':'🔄','star':'⭐','important':'❗','question':'❓','idea':'💡','warning':'⚠️' };

// ─── 撤销栈 ──────────────────────────────────────────────
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

function pushUndo() {
  undoStack.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
  const state = undoStack.pop();
  nodes = state.nodes; edges = state.edges;
  nodeCounter = nodes.reduce((m, n) => Math.max(m, parseInt(n.id.replace('n','')) || 0), 0);
  selectedIds.clear();
  render(); saveData();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) });
  const state = redoStack.pop();
  nodes = state.nodes; edges = state.edges;
  nodeCounter = nodes.reduce((m, n) => Math.max(m, parseInt(n.id.replace('n','')) || 0), 0);
  selectedIds.clear();
  render(); saveData();
}

// ─── 搜索 ────────────────────────────────────────────────
let searchActive = false;
let searchQuery = '';

function startSearch() {
  const q = prompt('搜索节点:', searchQuery);
  if (q === null) { searchActive = false; render(); return; }
  searchQuery = q.trim();
  searchActive = !!searchQuery;
  render();
  if (searchActive) {
    const found = nodes.filter(n => (n.text||'').includes(searchQuery));
    if (found.length > 0) {
      selectedIds.clear();
      selectedIds.add(found[0].id);
      // 定位到第一个结果
      const n = found[0];
      camera.x = canvas.width / 2 - (n.x + (n.width||NODE_MIN_W)/2) * camera.zoom;
      camera.y = canvas.height / 2 - (n.y + NODE_H/2) * camera.zoom;
      render();
    }
  }
}

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
  undoStack = []; redoStack = [];
  if (nodes.length === 0) addNodeInternal(null, '中心主题', COLORS[0]);
  autoLayout();
  const root = nodes.find(n => !n.parentId);
  if (root) { camera.x = canvas.width / 2 - root.x; camera.y = canvas.height / 3 - root.y; camera.zoom = 1; }
  selectedIds.clear();
  setTimeout(mmResize, 50);
};

// ─── 布局引擎 ────────────────────────────────────────────
function autoLayout() {
  const root = nodes.find(n => !n.parentId);
  if (!root) return;
  nodes.forEach(n => {
    n.textWidth = measureText(n.text || '节点');
    n.width = Math.max(NODE_MIN_W, n.textWidth + NODE_PAD * 2);
    n.height = NODE_H;
  });
  function layoutSubtree(nodeId, x, depth) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { totalH: 0 };
    if (node.collapsed) return { totalH: node.height + VERT_GAP };
    const children = nodes.filter(n => n.parentId === nodeId && !!n.parentId);
    if (children.length === 0) return { totalH: node.height + VERT_GAP };
    const results = children.map(c => layoutSubtree(c.id, x + LEVEL_GAP + node.width, depth + 1));
    const totalH = results.reduce((sum, r) => sum + r.totalH, 0);
    let yOff = -totalH / 2;
    children.forEach((c, i) => {
      c.x = x + LEVEL_GAP + (node.width / 2);
      c.y = yOff + results[i].totalH / 2 - c.height / 2;
      yOff += results[i].totalH;
    });
    return { totalH: Math.max(totalH, node.height + VERT_GAP) };
  }
  root.x = 60; root.y = 0;
  layoutSubtree(root.id, root.x, 0);
  const bounds = getBounds();
  if (bounds.minY !== Infinity) {
    const shiftY = -bounds.minY + 30;
    nodes.forEach(n => { n.y += shiftY; });
  }
}

function autoLayoutAll() { pushUndo(); autoLayout(); render(); saveData(); }

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

function measureText(text) { ctx.font = FONT; return ctx.measureText(text).width; }

// ─── 渲染引擎 ────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  drawGrid();
  edges.forEach(e => {
    if (isCollapsed(e.from) && !isCollapsedAncestorVisible(e.from)) return;
    if (isCollapsed(e.from)) return;
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    if (isCollapsed(to)) return;
    if (isCollapsedAncestor(to)) return;
    drawEdge(from, to);
  });
  // 先渲染未被选中的节点
  nodes.forEach(n => { if (!selectedIds.has(n.id)) drawNode(n, false); });
  // 再渲染选中的节点（在顶层）
  nodes.forEach(n => { if (selectedIds.has(n.id)) drawNode(n, true); });
  ctx.restore();
  drawHUD();
}

function isCollapsed(id) {
  const n = nodes.find(x => x.id === id);
  return n && n.collapsed;
}

function isCollapsedAncestor(id) {
  let n = nodes.find(x => x.id === id);
  while (n && n.parentId) {
    const parent = nodes.find(x => x.id === n.parentId);
    if (parent && parent.collapsed) return true;
    n = parent;
  }
  return false;
}

function drawGrid() {
  const gridSize = 40 * camera.zoom;
  const offsetX = camera.x % gridSize;
  const offsetY = camera.y % gridSize;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = offsetX; x < canvas.width; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = offsetY; y < canvas.height; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
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
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.25)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(79, 195, 247, 0.35)'; ctx.fill();
}

function drawNode(node, selected) {
  const x = node.x, y = node.y, w = node.width || NODE_MIN_W, h = node.height || NODE_H;
  const color = node.color || '#4fc3f7';
  const r = 8;

  ctx.save();
  ctx.shadowColor = selected ? 'rgba(79, 195, 247, 0.5)' : 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = selected ? 20 : 6;
  ctx.shadowOffsetY = selected ? 0 : 2;

  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, selected ? '#2a3a6a' : '#1e2a4a');
  grad.addColorStop(1, selected ? '#1e2a50' : '#162040');

  ctx.beginPath(); ctx.roundRect(x, y, 4, h, { upperLeft: r, lowerLeft: r });
  ctx.fillStyle = color; ctx.fill();

  ctx.beginPath(); ctx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r });
  ctx.fillStyle = grad; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? '#4fc3f7' : 'rgba(255,255,255,0.08)';
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.beginPath(); ctx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r }); ctx.stroke();

  if (selected) {
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.roundRect(x - 3, y - 3, w + 6, h + 6, r + 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // 文字
  ctx.fillStyle = '#e8e8f0'; ctx.font = FONT;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const displayText = node.text || '节点';
  const maxW = w - NODE_PAD * 2 - 4;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r }); ctx.clip();
  ctx.fillText(displayText, x + NODE_PAD + 4, y + h / 2, maxW);
  ctx.restore();

  // 标记（右上角）
  if (node.marker && MARKERS[node.marker]) {
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(MARKERS[node.marker], x + w - 6, y - 18);
  }

  // 折叠按钮
  const children = nodes.filter(n => n.parentId === node.id);
  if (children.length > 0) {
    const bx = x + w + 4, by = y + h / 2 - 7;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(79, 195, 247, 0.3)';
    ctx.beginPath(); ctx.roundRect(bx, by, 14, 14, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(node.collapsed ? '+' : '−', bx + 7, by + 7);
  }

  // 折叠提示线
  if (node.collapsed && children.length > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x + w + 22, y + h / 2);
    ctx.lineTo(x + w + 60, y + h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${children.length}个子节点`, x + w + 26, y + h / 2);
  }

  // 搜索高亮
  if (searchActive && searchQuery && (node.text||'').toLowerCase().includes(searchQuery.toLowerCase())) {
    ctx.strokeStyle = '#ffca28'; ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, r + 1); ctx.stroke();
  }

  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '12px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(camera.zoom * 100)}%`, canvas.width - 12, canvas.height - 8);
  if (searchActive) {
    ctx.fillStyle = 'rgba(255, 202, 40, 0.6)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`🔍 "${searchQuery}"`, 12, 12);
  }
}

// ─── 坐标系 ──────────────────────────────────────────────
function screenToWorld(sx, sy) { return { x: (sx - camera.x) / camera.zoom, y: (sy - camera.y) / camera.zoom }; }
function worldToScreen(wx, wy) { return { x: wx * camera.zoom + camera.x, y: wy * camera.zoom + camera.y }; }

function hitTest(sx, sy) {
  const w = screenToWorld(sx, sy);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const nw = n.width || NODE_MIN_W, nh = n.height || NODE_H;
    if (w.x >= n.x && w.x <= n.x + nw && w.y >= n.y && w.y <= n.y + nh) return n;
  }
  return null;
}

function hitCollapseButton(sx, sy) {
  const w = screenToWorld(sx, sy);
  for (const n of nodes) {
    const children = nodes.filter(c => c.parentId === n.id);
    if (children.length === 0) continue;
    const bx = n.x + (n.width||NODE_MIN_W) + 4, by = n.y + (n.height||NODE_H)/2 - 7;
    if (w.x >= bx && w.x <= bx + 14 && w.y >= by && w.y <= by + 14) return n;
  }
  return null;
}

// ─── 鼠标事件 ────────────────────────────────────────────
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('dblclick', onDblClick);
canvas.addEventListener('contextmenu', onContextMenu);

function onMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const collapseHit = hitCollapseButton(sx, sy);
  if (collapseHit) {
    toggleCollapse(collapseHit.id);
    return;
  }
  const hit = hitTest(sx, sy);
  if (hit) {
    if (e.shiftKey) {
      if (selectedIds.has(hit.id)) selectedIds.delete(hit.id); else selectedIds.add(hit.id);
      render(); return;
    }
    selectedIds.clear(); selectedIds.add(hit.id); render();
    drag.active = true; drag.nodeId = hit.id; drag.type = 'node';
    const ws = worldToScreen(hit.x, hit.y);
    drag.offX = sx - ws.x; drag.offY = sy - ws.y;
  } else {
    selectedIds.clear(); render();
    pan.active = true; pan.startX = sx; pan.startY = sy;
    pan.camX = camera.x; pan.camY = camera.y;
    canvas.style.cursor = 'grabbing';
  }
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (drag.active && drag.nodeId) {
    const node = nodes.find(n => n.id === drag.nodeId);
    if (node) {
      const wPos = screenToWorld(sx - drag.offX, sy - drag.offY);
      const dx = wPos.x - node.x, dy = wPos.y - node.y;
      for (const id of selectedIds) { const n = nodes.find(nd => nd.id === id); if (n) { n.x += dx; n.y += dy; } }
      render();
    }
  } else if (pan.active) {
    camera.x = pan.camX + (sx - pan.startX); camera.y = pan.camY + (sy - pan.startY);
    render();
  } else {
    canvas.style.cursor = hitTest(sx, sy) ? 'pointer' : 'grab';
  }
}

function onMouseUp(_e) {
  if (drag.active) { saveData(); }
  drag.active = false; drag.nodeId = null;
  pan.active = false; canvas.style.cursor = 'grab';
}

function onWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const oldZoom = camera.zoom;
    camera.zoom = Math.max(0.2, Math.min(3, camera.zoom + delta));
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    camera.x = mx - (mx - camera.x) * (camera.zoom / oldZoom);
    camera.y = my - (my - camera.y) * (camera.zoom / oldZoom);
    render();
  } else {
    camera.y -= e.deltaY * 0.5; render();
  }
}

function onDblClick(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const hit = hitTest(sx, sy);
  if (hit) { showEditor(hit); }
  else {
    const w = screenToWorld(sx, sy);
    pushUndo();
    const id = addNodeInternal(null, '新节点', COLORS[nodeCounter % COLORS.length]);
    const node = nodes.find(n => n.id === id);
    if (node) { node.x = w.x - 50; node.y = w.y - NODE_H / 2; }
    selectedIds.clear(); selectedIds.add(id);
    render(); saveData(); showEditor(node);
  }
}

// ─── 右键菜单 ────────────────────────────────────────────
let contextMenu = null;

function onContextMenu(e) {
  e.preventDefault();
  hideContextMenu();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const hit = hitTest(sx, sy);
  // 如果没点到节点但有选中的，用选中节点
  const targetNode = hit || (selectedIds.size > 0 ? nodes.find(n => n.id === [...selectedIds][0]) : null);
  if (!targetNode) return;
  if (!selectedIds.has(targetNode.id)) { selectedIds.clear(); selectedIds.add(targetNode.id); render(); }

  const menu = document.createElement('div');
  menu.className = 'mm-context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.dataset.nodeId = targetNode.id;

  const items = [
    { label: '✏️ 编辑文字', shortcut: 'F2', action: () => showEditor(targetNode) },
    { label: '👶 子节点', shortcut: 'Tab', action: addChild },
    { label: '↔️ 同级节点', shortcut: 'Enter', action: addSibling },
    { label: '👆 上级节点', action: addParent },
    { label: '---' },
    { label: targetNode.collapsed ? '▶️ 展开' : '▼ 折叠', action: () => toggleCollapse(targetNode.id) },
    { label: '🔽 展开全部', action: expandAll },
    { label: '---' },
    { label: '📋 复制', shortcut: 'Ctrl+C', action: copySelected },
    { label: '📄 粘贴', shortcut: 'Ctrl+V', action: pasteNodes },
    { label: '✂️ 剪切', shortcut: 'Ctrl+X', action: cutSelected },
    { label: '---' },
    { label: '🎨 颜色', children: COLORS.map(c => ({ label: '', color: c, action: () => setNodeColor(targetNode.id, c) })) },
    { label: '🏷️ 标记', children: Object.keys(MARKERS).map(k => ({ label: `${MARKERS[k]} ${k}`, action: () => setMarker(targetNode.id, targetNode.marker === k ? null : k) })) },
    { label: '🗑️ 删除', shortcut: 'Del', action: deleteSelected },
    { label: '---' },
    { label: '📝 备注', action: () => showNote(targetNode) },
    { label: '🔍 搜索', shortcut: 'Ctrl+F', action: startSearch },
    { label: '---' },
    { label: '⊞ 自动布局', action: autoLayoutAll },
    { label: '⬆️ 适应屏幕', action: fitToScreen },
    { label: '⛶ 全屏', action: openFullscreen },
  ];

  menu.innerHTML = buildMenuHTML(items);
  document.body.appendChild(menu);
  contextMenu = menu;

  // 防止菜单超出屏幕
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = (window.innerWidth - mr.width - 10) + 'px';
  if (mr.bottom > window.innerHeight) menu.style.top = (window.innerHeight - mr.height - 10) + 'px';
}

function buildMenuHTML(items) {
  let html = '<ul>';
  for (const item of items) {
    if (item.label === '---') { html += '<li class="mm-menu-sep"></li>'; continue; }
    if (item.children) {
      html += `<li class="mm-menu-has-sub"><span>${item.label}</span><span class="mm-menu-arrow">▶</span><ul>`;
      for (const sub of item.children) {
        if (sub.color) {
          html += `<li data-action="color" data-color="${sub.color}"><span class="mm-color-swatch" style="background:${sub.color}"></span></li>`;
        } else {
          html += `<li data-action="marker" data-marker="${sub.label.split(' ')[1]}">${sub.label}</li>`;
        }
      }
      html += '</ul></li>';
    } else {
      html += `<li data-action="${item.action ? 'exec' : ''}"><span>${item.label}</span>${item.shortcut ? `<span class="mm-menu-shortcut">${item.shortcut}</span>` : ''}</li>`;
    }
  }
  html += '</ul>';
  return html;
}

document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) hideContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

function hideContextMenu() {
  if (contextMenu) { contextMenu.remove(); contextMenu = null; }
}

// 菜单点击事件（委托）
document.addEventListener('click', (e) => {
  if (!contextMenu) return;
  const li = e.target.closest('li');
  if (!li || !contextMenu.contains(li)) return;
  if (li.classList.contains('mm-menu-has-sub') || li.querySelector('.mm-menu-arrow')) return;

  if (li.dataset.action === 'color') {
    const color = li.dataset.color;
    setNodeColor(contextMenu.dataset.nodeId, color);
    hideContextMenu();
    return;
  }
  if (li.dataset.action === 'marker') {
    const marker = li.dataset.marker;
    const node = nodes.find(n => n.id === contextMenu.dataset.nodeId);
    if (node) setMarker(node.id, node.marker === marker ? null : marker);
    hideContextMenu();
    return;
  }

  const text = li.textContent.trim();
  hideContextMenu();
  // Match by label
  const actions = {
    '✏️ 编辑文字': () => { const n = nodes.find(x => x.id === contextMenu.dataset.nodeId); if (n) showEditor(n); },
    '👶 子节点': addChild,
    '↔️ 同级节点': addSibling,
    '👆 上级节点': addParent,
    '▼ 折叠': () => toggleCollapse(contextMenu.dataset.nodeId),
    '▶️ 展开': () => toggleCollapse(contextMenu.dataset.nodeId),
    '🔽 展开全部': expandAll,
    '📋 复制': copySelected,
    '📄 粘贴': pasteNodes,
    '✂️ 剪切': cutSelected,
    '🗑️ 删除': deleteSelected,
    '📝 备注': () => { const n = nodes.find(x => x.id === contextMenu.dataset.nodeId); if (n) showNote(n); },
    '🔍 搜索': startSearch,
    '⊞ 自动布局': autoLayoutAll,
    '⬆️ 适应屏幕': fitToScreen,
    '⛶ 全屏': openFullscreen,
  };
  const act = actions[text];
  if (act) act();
});

// ─── 节点操作 ────────────────────────────────────────────
function addNodeInternal(parentId, text, color) {
  const id = 'n' + (++nodeCounter);
  const nw = measureText(text) + NODE_PAD * 2 + 10;
  nodes.push({ id, text: text || '节点', x: 0, y: 0, width: Math.max(NODE_MIN_W, nw), height: NODE_H, color: color || COLORS[0], parentId: parentId || null, collapsed: false, marker: null, note: '' });
  if (parentId) edges.push({ from: parentId, to: id });
  return id;
}

function getSelectedNode() {
  if (selectedIds.size === 0) return null;
  return nodes.find(n => n.id === [...selectedIds][0]);
}

function addChild() {
  const parent = getSelectedNode(); if (!parent) return;
  pushUndo();
  const id = addNodeInternal(parent.id, '子节点', COLORS[++nodeCounter % COLORS.length]);
  const child = nodes.find(n => n.id === id);
  child.x = parent.x + (parent.width || NODE_MIN_W) + LEVEL_GAP;
  child.y = parent.y + 30;
  autoLayout();
  selectedIds.clear(); selectedIds.add(id);
  render(); saveData();
  const s = worldToScreen(child.x, child.y);
  showEditor(child);
}

function addSibling() {
  const ref = getSelectedNode(); if (!ref || !ref.parentId) return;
  pushUndo();
  const id = addNodeInternal(ref.parentId, '同级节点', COLORS[nodeCounter % COLORS.length]);
  const sibling = nodes.find(n => n.id === id);
  sibling.x = ref.x; sibling.y = ref.y + (ref.height || NODE_H) + VERT_GAP;
  autoLayout();
  selectedIds.clear(); selectedIds.add(id);
  render(); saveData(); showEditor(sibling);
}

function addParent() {
  const child = getSelectedNode(); if (!child) return;
  pushUndo();
  const oldParentId = child.parentId;
  const id = addNodeInternal(oldParentId, '上级节点', COLORS[nodeCounter % COLORS.length]);
  const parent = nodes.find(n => n.id === id);
  child.parentId = id;
  // 更新边
  if (oldParentId) {
    const oldEdge = edges.find(e => e.from === oldParentId && e.to === child.id);
    if (oldEdge) oldEdge.to = id;
  }
  edges.push({ from: id, to: child.id });
  parent.x = child.x - 120; parent.y = child.y;
  autoLayout();
  selectedIds.clear(); selectedIds.add(id);
  render(); saveData();
}

function deleteSelected() {
  if (selectedIds.size === 0) return;
  pushUndo();
  const toDelete = new Set(selectedIds);
  function collectChildren(id) { nodes.filter(n => n.parentId === id).forEach(c => { toDelete.add(c.id); collectChildren(c.id); }); }
  for (const id of selectedIds) collectChildren(id);
  nodes = nodes.filter(n => !toDelete.has(n.id));
  edges = edges.filter(e => !toDelete.has(e.from) && !toDelete.has(e.to));
  selectedIds.clear();
  autoLayout(); render(); saveData();
}

function toggleCollapse(id) {
  pushUndo();
  const node = nodes.find(n => n.id === id);
  if (node) { node.collapsed = !node.collapsed; autoLayout(); render(); saveData(); }
}

function expandAll() {
  pushUndo();
  nodes.forEach(n => { n.collapsed = false; });
  autoLayout(); render(); saveData();
}

function setNodeColor(id, color) {
  pushUndo();
  const node = nodes.find(n => n.id === id);
  if (node) { node.color = color; render(); saveData(); }
}

function setMarker(id, marker) {
  pushUndo();
  const node = nodes.find(n => n.id === id);
  if (node) { node.marker = marker; render(); saveData(); }
}

// ─── 复制 / 粘贴 / 剪切 ─────────────────────────────────
let clipboard = null;

function copySelected() {
  if (selectedIds.size === 0) return;
  const rootId = [...selectedIds][0];
  const toCopy = new Set();
  function collect(id) { toCopy.add(id); nodes.filter(n => n.parentId === id).forEach(c => collect(c.id)); }
  collect(rootId);
  clipboard = {
    nodes: nodes.filter(n => toCopy.has(n.id)).map(n => ({...n, id: undefined, parentId: undefined })),
    edges: edges.filter(e => toCopy.has(e.from) && toCopy.has(e.to)).map(e => ({...e})),
  };
  showToast(`📋 已复制 ${clipboard.nodes.length} 个节点`);
}

function cutSelected() {
  if (selectedIds.size === 0) return;
  copySelected();
  deleteSelected();
}

function pasteNodes() {
  if (!clipboard || clipboard.nodes.length === 0) return;
  const parent = getSelectedNode();
  if (!parent) return;
  pushUndo();
  const idMap = {};
  const newNodes = clipboard.nodes.map(n => {
    const newId = 'n' + (++nodeCounter);
    idMap[n.id || 'old'] = newId;
    return { ...n, id: newId };
  });
  // 重建父子关系
  const oldIds = clipboard.nodes.map(n => n.id);
  newNodes.forEach(n => {
    if (n.parentId && idMap[n.parentId]) n.parentId = idMap[n.parentId];
    else n.parentId = parent.id;
  });
  // 重建边
  const newEdges = clipboard.edges.map(e => ({
    from: idMap[e.from] || parent.id,
    to: idMap[e.to] || (newNodes[0] ? newNodes[0].id : ''),
  })).filter(e => e.to);

  nodes.push(...newNodes);
  edges.push(...newEdges);
  autoLayout();
  selectedIds.clear();
  if (newNodes[0]) selectedIds.add(newNodes[0].id);
  render(); saveData();
  showToast(`📄 已粘贴 ${newNodes.length} 个节点`);
}

// ─── 节点备注 ────────────────────────────────────────────
let noteOverlay = null;

function showNote(node) {
  hideNote();
  noteOverlay = document.createElement('div');
  noteOverlay.className = 'mm-note-overlay';
  noteOverlay.innerHTML = `
    <div class="mm-note-card">
      <div class="mm-note-header">
        <strong>📝 ${esc(node.text||'节点')}</strong>
        <button class="mm-note-close">×</button>
      </div>
      <textarea class="mm-note-textarea" rows="4" placeholder="写备注...">${esc(node.note||'')}</textarea>
    </div>
  `;
  document.body.appendChild(noteOverlay);

  const textarea = noteOverlay.querySelector('.mm-note-textarea');
  const close = noteOverlay.querySelector('.mm-note-close');

  let noteTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      node.note = textarea.value;
      saveData();
    }, 500);
  });

  const finish = () => { hideNote(); };
  close.addEventListener('click', finish);
  noteOverlay.addEventListener('click', (e) => { if (e.target === noteOverlay) finish(); });
  textarea.focus();
}

function hideNote() {
  if (noteOverlay) { noteOverlay.remove(); noteOverlay = null; }
}

// ─── 文字编辑浮层 ────────────────────────────────────────
let editorInput = null;
let currentEditNodeId = null;

function showEditor(node) {
  if (isLocked('mindmap-node', node.id)) {
    const user = getLockUser('mindmap-node', node.id);
    showToast(`🔒 ${user} 正在编辑`); return;
  }
  hideEditor();
  acquireLock('mindmap-node', node.id);
  currentEditNodeId = node.id;

  const s = worldToScreen(node.x + 4, node.y);
  const sw = (node.width || NODE_MIN_W) * camera.zoom - 4;
  const sh = (node.height || NODE_H) * camera.zoom;

  const input = document.createElement('input');
  input.className = 'mm-inline-editor';
  input.value = node.text || '';
  input.style.left = s.x + 'px'; input.style.top = s.y + 'px';
  input.style.width = sw + 'px'; input.style.height = sh + 'px';
  input.style.fontSize = Math.round(14 * camera.zoom) + 'px';
  canvas.parentElement.appendChild(input);
  input.focus(); input.select();
  editorInput = input;

  const finish = () => {
    if (currentEditNodeId) { releaseLock('mindmap-node', currentEditNodeId); currentEditNodeId = null; }
    if (node.text !== input.value) pushUndo();
    node.text = input.value || '节点';
    node.textWidth = measureText(node.text);
    node.width = Math.max(NODE_MIN_W, node.textWidth + NODE_PAD * 2);
    input.remove(); editorInput = null;
    render(); saveData();
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
    if (currentEditNodeId) { releaseLock('mindmap-node', currentEditNodeId); currentEditNodeId = null; }
    editorInput.remove(); editorInput = null;
  }
}

// ─── Toast ────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('mm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mm-toast';
    el.style.cssText = 'position:absolute;bottom:60px;left:50%;transform:translateX(-50%);background:#1a2a3a;color:#e0e0f0;padding:8px 16px;border-radius:8px;font-size:13px;z-index:100;border:1px solid #4fc3f7;box-shadow:0 2px 12px rgba(0,0,0,0.4);transition:opacity 0.3s';
    canvas.parentElement.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

window.addEventListener('locks-changed', () => {
  if (currentEditNodeId && isLocked('mindmap-node', currentEditNodeId)) {
    const user = getLockUser('mindmap-node', currentEditNodeId);
    if (user && user !== myName) { hideEditor(); showToast(`🔒 ${user} 正在编辑`); }
  }
  if (document.getElementById('panel-mindmap').classList.contains('active')) render();
});

// ─── 保存 ────────────────────────────────────────────────
function saveData() {
  if (!currentProject) return;
  currentProject.data = { nodes: nodes.map(n => ({...n})), edges: edges.map(e => ({...e})) };
  socket.emit('project-update', { id: currentProject.id, data: currentProject.data });
}

// ─── 实时同步 ────────────────────────────────────────────
socket.on('project-updated', (data) => {
  if (currentProject && currentProject.id === data.id && data.data) {
    currentProject.data = data.data;
    nodes = JSON.parse(JSON.stringify(data.data.nodes || []));
    edges = JSON.parse(JSON.stringify(data.data.edges || []));
    nodeCounter = nodes.reduce((m, n) => Math.max(m, parseInt(n.id.replace('n','')) || 0), 0);
    render();
  }
});

// ─── 键盘快捷键 ──────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (editorInput || noteOverlay || contextMenu) return;
  const panel = document.getElementById('panel-mindmap');
  if (!panel || !panel.classList.contains('active')) return;

  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z': e.preventDefault(); if (e.shiftKey) redo(); else undo(); break;
      case 'y': e.preventDefault(); redo(); break;
      case 'c': e.preventDefault(); copySelected(); break;
      case 'v': e.preventDefault(); pasteNodes(); break;
      case 'x': e.preventDefault(); cutSelected(); break;
      case 'f': e.preventDefault(); startSearch(); break;
      case 's': e.preventDefault(); saveData(); showToast('💾 已保存'); break;
    }
    return;
  }

  switch (e.key) {
    case 'Tab': e.preventDefault(); addChild(); break;
    case 'Enter': e.preventDefault(); addSibling(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break;
    case ' ': case 'F2': e.preventDefault(); const n = getSelectedNode(); if (n) showEditor(n); break;
  }
});

// ─── 工具栏 ──────────────────────────────────────────────
document.getElementById('mm-add-root').addEventListener('click', () => {
  pushUndo();
  const id = addNodeInternal(null, '中心主题', COLORS[0]);
  autoLayout();
  selectedIds.clear(); selectedIds.add(id);
  render(); saveData();
});
document.getElementById('mm-add-child').addEventListener('click', addChild);
document.getElementById('mm-add-sibling').addEventListener('click', addSibling);
document.getElementById('mm-delete-node').addEventListener('click', deleteSelected);

// 撤销/重做按钮
const toolbar = document.getElementById('mindmap-toolbar');
const undoBtn = document.createElement('button');
undoBtn.className = 'tool-btn'; undoBtn.textContent = '↩ 撤销';
undoBtn.title = '撤销 (Ctrl+Z)';
undoBtn.addEventListener('click', undo);
toolbar.insertBefore(undoBtn, toolbar.firstChild);

const redoBtn = document.createElement('button');
redoBtn.className = 'tool-btn'; redoBtn.textContent = '↪ 重做';
redoBtn.title = '重做 (Ctrl+Shift+Z)';
redoBtn.addEventListener('click', redo);
toolbar.insertBefore(redoBtn, toolbar.firstChild);

const searchBtn = document.createElement('button');
searchBtn.className = 'tool-btn'; searchBtn.textContent = '🔍 搜索';
searchBtn.title = '搜索节点 (Ctrl+F)';
searchBtn.addEventListener('click', startSearch);
toolbar.insertBefore(searchBtn, toolbar.firstChild);

// 缩放按钮
const zoomOutBtn = document.createElement('button');
zoomOutBtn.className = 'tool-btn'; zoomOutBtn.textContent = '🔍-';
zoomOutBtn.title = '缩小'; zoomOutBtn.addEventListener('click', () => { camera.zoom = Math.max(0.2, camera.zoom - 0.2); render(); });
toolbar.insertBefore(zoomOutBtn, toolbar.firstChild);

const zoomInBtn = document.createElement('button');
zoomInBtn.className = 'tool-btn'; zoomInBtn.textContent = '🔍+';
zoomInBtn.title = '放大'; zoomInBtn.addEventListener('click', () => { camera.zoom = Math.min(3, camera.zoom + 0.2); render(); });
toolbar.insertBefore(zoomInBtn, toolbar.firstChild);

const fitBtn = document.createElement('button');
fitBtn.className = 'tool-btn'; fitBtn.textContent = '⊞ 适应';
fitBtn.title = '适应屏幕'; fitBtn.addEventListener('click', fitToScreen);
toolbar.insertBefore(fitBtn, toolbar.firstChild);

const fullBtn = document.createElement('button');
fullBtn.className = 'tool-btn'; fullBtn.textContent = '⛶ 全屏';
fullBtn.title = '全屏页面'; fullBtn.addEventListener('click', openFullscreen);
toolbar.appendChild(fullBtn);

const exportBtn = document.createElement('button');
exportBtn.className = 'tool-btn'; exportBtn.textContent = '📤 导出';
exportBtn.title = '导出为图片';
exportBtn.addEventListener('click', exportImage);
toolbar.appendChild(exportBtn);

function fitToScreen() {
  const bounds = getBounds();
  if (bounds.minX === Infinity) return;
  const pad = 40;
  const bw = bounds.maxX - bounds.minX + pad * 2;
  const bh = bounds.maxY - bounds.minY + pad * 2;
  const zoomX = canvas.width / bw, zoomY = canvas.height / bh;
  camera.zoom = Math.min(zoomX, zoomY, 1.5);
  camera.x = -bounds.minX * camera.zoom + pad * camera.zoom;
  camera.y = -bounds.minY * camera.zoom + pad * camera.zoom;
  render();
}

function openFullscreen() {
  if (!currentProject) return;
  const base = window.location.origin;
  window.open(`${base}/mindmap-full.html?project=${currentProject.id}&serverId=${serverId}`, 'mindmap-full', 'width=1400,height=900');
}

function exportImage() {
  // 先适应屏幕来算边界，再等比例渲染
  const bounds = getBounds();
  if (bounds.minX === Infinity) return;
  const pad = 60;
  const w = bounds.maxX - bounds.minX + pad * 2;
  const h = bounds.maxY - bounds.minY + pad * 2;
  const scale = 2; // 2x 高清
  const expCanvas = document.createElement('canvas');
  expCanvas.width = w * scale;
  expCanvas.height = h * scale;
  const expCtx = expCanvas.getContext('2d');

  // 深色背景
  expCtx.fillStyle = '#0d0d1a'; expCtx.fillRect(0, 0, expCanvas.width, expCanvas.height);

  // 绘制网格
  expCtx.strokeStyle = 'rgba(255,255,255,0.03)'; expCtx.lineWidth = 1;
  for (let x = 0; x < expCanvas.width; x += 40 * scale) { expCtx.beginPath(); expCtx.moveTo(x, 0); expCtx.lineTo(x, expCanvas.height); expCtx.stroke(); }
  for (let y = 0; y < expCanvas.height; y += 40 * scale) { expCtx.beginPath(); expCtx.moveTo(0, y); expCtx.lineTo(expCanvas.width, y); expCtx.stroke(); }

  expCtx.translate(pad * scale, pad * scale);
  expCtx.scale(scale, scale);

  // 临时替换渲染函数在导出画布上绘制
  const origNodes = nodes, origEdges = edges;
  nodes.forEach(n => { n._x = n.x; n._y = n.y; n.x -= bounds.minX - pad; n.y -= bounds.minY - pad; });

  // 使用 exportCtx 替换当前 canvas ctx 来绘制
  const savedCtx = ctx;
  // 简单方法：直接在导出 canvas 上重绘
  edges.forEach(e => {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (!from || !to) return;
    if (isCollapsed(e.from) || isCollapsed(e.to) || isCollapsedAncestor(e.to)) return;
    const fx = from.x + (from.width || NODE_MIN_W);
    const fy = from.y + (from.height || NODE_H) / 2;
    const tx = to.x, ty = to.y + (to.height || NODE_H) / 2;
    const cx = (fx + tx) / 2;
    expCtx.beginPath(); expCtx.moveTo(fx, fy); expCtx.bezierCurveTo(cx, fy, cx, ty, tx, ty);
    expCtx.strokeStyle = 'rgba(79, 195, 247, 0.25)'; expCtx.lineWidth = 2.5; expCtx.stroke();
  });

  nodes.forEach(n => {
    const x = n.x, y = n.y, w = n.width || NODE_MIN_W, h = n.height || NODE_H;
    const color = n.color || '#4fc3f7';
    const r = 8;
    expCtx.shadowColor = 'rgba(0,0,0,0.3)'; expCtx.shadowBlur = 6; expCtx.shadowOffsetY = 2;
    const grad = expCtx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#1e2a4a'); grad.addColorStop(1, '#162040');
    expCtx.beginPath(); expCtx.roundRect(x, y, 4, h, { upperLeft: r, lowerLeft: r });
    expCtx.fillStyle = color; expCtx.fill();
    expCtx.beginPath(); expCtx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r });
    expCtx.fillStyle = grad; expCtx.fill();
    expCtx.shadowBlur = 0;
    expCtx.fillStyle = '#e8e8f0'; expCtx.font = FONT;
    expCtx.textAlign = 'left'; expCtx.textBaseline = 'middle';
    expCtx.save();
    expCtx.beginPath(); expCtx.roundRect(x + 4, y, w - 4, h, { upperRight: r, lowerRight: r }); expCtx.clip();
    expCtx.fillText(n.text || '节点', x + NODE_PAD + 4, y + h / 2, w - NODE_PAD * 2 - 4);
    expCtx.restore();
  });

  // 恢复坐标
  nodes.forEach(n => { n.x = n._x; n.y = n._y; delete n._x; delete n._y; });

  // 下载
  expCanvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(currentProject&&currentProject.name)||'思维导图'}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('📤 导出完成');
  });
}

// ─── 导出 ────────────────────────────────────────────────
window.renderMindMap = render;
window.loadMindMapData = function(data) {
  nodes = JSON.parse(JSON.stringify(data.nodes || []));
  edges = JSON.parse(JSON.stringify(data.edges || []));
  render();
};

// 初始渲染
setTimeout(mmResize, 100);

})();
