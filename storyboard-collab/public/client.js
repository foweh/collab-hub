// ─── Socket.IO 连接 ─────────────────────────────────────
const socket = io();
let myName = '';
let currentFrameId = null;
let isDrawing = false;
let currentStroke = [];
let frameOrder = [];
let frames = {};
let users = [];

// ─── DOM ─────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const joinOverlay     = $('#join-overlay');
const app             = $('#app');
const nameInput       = $('#name-input');
const joinBtn         = $('#join-btn');
const projectNameIn   = $('#project-name');
const onlineBadge     = $('#online-badge');
const addFrameBtn     = $('#add-frame-btn');
const clearAllBtn     = $('#clear-all-btn');
const frameList       = $('#frame-list');
const canvas          = $('#draw-canvas');
const ctx             = canvas.getContext('2d');
const frameLabel      = $('#current-frame-label');
const notesTa         = $('#notes-textarea');
const chatMsgList     = $('#chat-messages');
const chatInput       = $('#chat-input');
const chatSendBtn     = $('#chat-send-btn');
const undoBtn         = $('#undo-btn');
const clearCanvasBtn  = $('#clear-canvas-btn');
const colorPicker     = $('#color-picker');
const sizeSlider      = $('#size-slider');
const sizeDisplay     = $('#size-display');

// ─── Canvas 尺寸管理 ────────────────────────────────────
function resizeCanvas() {
  const parent = canvas.parentElement;
  const w = parent.clientWidth - 24;
  const h = parent.clientHeight - 74;
  if (w <= 0 || h <= 0) return;
  canvas.width = Math.min(w, 960);
  canvas.height = Math.min(h, 640);
  redrawCurrentFrame();
}
window.addEventListener('resize', resizeCanvas);

// ─── 绘制引擎 ────────────────────────────────────────────
let currentTool = 'brush';

function getPos(e) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
}

function drawStroke(s) {
  const pts = s.points;
  if (pts.length < 2) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
    ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    ctx.fillStyle = s.eraser ? 'rgba(0,0,0,1)' : s.color;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.eraser ? 'rgba(0,0,0,1)' : s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.eraser ? s.size * 3 : s.size;
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

function redrawCurrentFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const f = frames[currentFrameId];
  if (f) f.strokes.forEach(drawStroke);
}

// ─── 缩略图 ──────────────────────────────────────────────
function updateThumb(id) {
  const el = document.querySelector(`.frame-thumb[data-id="${id}"]`);
  if (!el) return;
  const tc = el.querySelector('canvas');
  const tctx = tc.getContext('2d');
  const f = frames[id];
  if (!f) return;

  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0, 0, tc.width, tc.height);

  const sx = tc.width / (canvas.width || 1);
  const sy = tc.height / (canvas.height || 1);

  for (const s of f.strokes) {
    const pts = s.points;
    if (pts.length < 2) {
      tctx.beginPath();
      tctx.arc(pts[0].x * sx, pts[0].y * sy, (s.size / 2) * Math.min(sx, sy), 0, Math.PI * 2);
      tctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
      tctx.fillStyle = s.eraser ? 'rgba(0,0,0,1)' : s.color;
      tctx.fill();
      tctx.globalCompositeOperation = 'source-over';
      continue;
    }
    tctx.beginPath();
    tctx.moveTo(pts[0].x * sx, pts[0].y * sy);
    for (let i = 1; i < pts.length; i++) tctx.lineTo(pts[i].x * sx, pts[i].y * sy);
    tctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
    tctx.strokeStyle = s.eraser ? 'rgba(0,0,0,1)' : s.color;
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';
    tctx.lineWidth = s.eraser ? s.size * 3 * Math.min(sx, sy) : s.size * Math.min(sx, sy);
    tctx.stroke();
    tctx.globalCompositeOperation = 'source-over';
  }
}

// ─── Canvas 事件 ────────────────────────────────────────
canvas.addEventListener('mousedown',   startDraw);
canvas.addEventListener('mousemove',   doDraw);
canvas.addEventListener('mouseup',     endDraw);
canvas.addEventListener('mouseleave',  endDraw);
canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener('touchmove',  e => { e.preventDefault(); doDraw(e); },   { passive: false });
canvas.addEventListener('touchend',   e => { e.preventDefault(); endDraw(e); },   { passive: false });

function startDraw(e) {
  if (!currentFrameId) return;
  isDrawing = true;
  currentStroke = [getPos(e)];
}

function doDraw(e) {
  if (!isDrawing || !currentFrameId) return;
  currentStroke.push(getPos(e));
  // 实时渲染: 清空画布 → 重绘所有已保存笔触 → 再绘制当前笔触
  const f = frames[currentFrameId];
  if (!f) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  f.strokes.forEach(drawStroke);
  drawStroke({
    points: currentStroke,
    color: currentTool === 'eraser' ? '#000' : colorPicker.value,
    size: parseInt(sizeSlider.value),
    eraser: currentTool === 'eraser',
  });
}

function endDraw(_e) {
  if (!isDrawing || !currentFrameId || currentStroke.length === 0) {
    isDrawing = false;
    return;
  }
  isDrawing = false;

  const stroke = {
    points: currentStroke,
    color: currentTool === 'eraser' ? '#000' : colorPicker.value,
    size: parseInt(sizeSlider.value),
    eraser: currentTool === 'eraser',
  };

  const f = frames[currentFrameId];
  if (f) f.strokes.push(stroke);

  socket.emit('draw-stroke', { frameId: currentFrameId, stroke });
  redrawCurrentFrame();
  updateThumb(currentFrameId);
  currentStroke = [];
}

// ─── 帧列表渲染 ──────────────────────────────────────────
function renderFrameList() {
  frameList.innerHTML = '';
  for (const id of frameOrder) {
    const f = frames[id];
    if (!f) continue;

    const div = document.createElement('div');
    div.className = `frame-thumb${id === currentFrameId ? ' active' : ''}`;
    div.dataset.id = id;
    div.draggable = true;

    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    div.appendChild(c);

    const lbl = document.createElement('div');
    lbl.className = 'frame-label';
    lbl.textContent = `#${id}`;
    div.appendChild(lbl);

    const del = document.createElement('button');
    del.className = 'frame-del';
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); delFrame(id); });
    div.appendChild(del);

    div.addEventListener('click', () => selFrame(id));

    // 拖拽排序
    div.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      div.classList.add('dragging');
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      document.querySelectorAll('.frame-thumb').forEach(el => el.classList.remove('drag-over'));
    });
    div.addEventListener('dragover', e => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => {
      e.preventDefault();
      div.classList.remove('drag-over');
      const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
      if (draggedId === id) return;
      const oi = frameOrder.indexOf(draggedId);
      const ni = frameOrder.indexOf(id);
      if (oi === -1 || ni === -1) return;
      frameOrder.splice(oi, 1);
      frameOrder.splice(frameOrder.indexOf(id), 0, draggedId);
      renderFrameList();
      socket.emit('reorder-frames', frameOrder);
    });

    frameList.appendChild(div);
    setTimeout(() => updateThumb(id), 50);
  }
}

// ─── 帧操作 ──────────────────────────────────────────────
function addFrame()  { socket.emit('add-frame'); }

function delFrame(id) {
  if (frameOrder.length <= 1) addFrame();
  socket.emit('delete-frame', id);
  if (currentFrameId === id) {
    const idx = frameOrder.indexOf(id);
    selFrame(frameOrder[idx + 1] || frameOrder[idx - 1] || null);
  }
}

function selFrame(id) {
  currentFrameId = id;
  frameLabel.textContent = id ? `帧 #${id}` : '';
  document.querySelectorAll('.frame-thumb').forEach(
    el => el.classList.toggle('active', parseInt(el.dataset.id) === id)
  );
  const f = frames[id];
  notesTa.value = f ? (f.notes || '') : '';
  redrawCurrentFrame();
}

function clearAll() {
  if (!confirm('确定清空所有分镜？此操作不可撤销！')) return;
  socket.emit('clear-frames');
}

// ─── Socket 事件 ────────────────────────────────────────
socket.on('state-sync', state => {
  frames = {};
  state.frames.forEach(f => { frames[f.id] = f; });
  frameOrder = state.frames.map(f => f.id);
  users = state.users || [];
  projectNameIn.value = state.projectName || '未命名分镜';
  onlineBadge.textContent = `🟢 ${users.length} 在线`;

  renderFrameList();
  if (frameOrder.length === 0) addFrame();
  else selFrame(frameOrder[0]);

  chatMsgList.innerHTML = '';
  (state.messages || []).forEach(addChatMsg);
});

socket.on('frame-added', frame => {
  frames[frame.id] = frame;
  frameOrder.push(frame.id);
  renderFrameList();
  selFrame(frame.id);
});

socket.on('frame-deleted', id => {
  delete frames[id];
  frameOrder = frameOrder.filter(fid => fid !== id);
  if (currentFrameId === id) selFrame(frameOrder[0] || null);
  renderFrameList();
});

socket.on('frames-cleared', () => {
  frames = {};
  frameOrder = [];
  renderFrameList();
  addFrame();
});

socket.on('frames-reordered', order => {
  frameOrder = order;
  renderFrameList();
});

socket.on('stroke-drawn', ({ frameId, stroke }) => {
  const f = frames[frameId];
  if (!f) return;
  f.strokes.push(stroke);
  if (frameId === currentFrameId) redrawCurrentFrame();
  updateThumb(frameId);
});

socket.on('stroke-undone', ({ frameId }) => {
  const f = frames[frameId];
  if (f && f.strokes.length > 0) {
    f.strokes.pop();
    if (frameId === currentFrameId) redrawCurrentFrame();
    updateThumb(frameId);
  }
});

socket.on('canvas-frame-cleared', ({ frameId }) => {
  const f = frames[frameId];
  if (!f) return;
  f.strokes = [];
  if (frameId === currentFrameId) redrawCurrentFrame();
  updateThumb(frameId);
});

socket.on('notes-updated', ({ frameId, notes }) => {
  const f = frames[frameId];
  if (!f) return;
  f.notes = notes;
  if (frameId === currentFrameId) notesTa.value = notes;
});

socket.on('project-name-updated', name => { projectNameIn.value = name; });
socket.on('user-joined', u => addSysMsg(`${u.name} 加入了协作 🎉`));
socket.on('user-left',   uid => {
  const u = users.find(x => x.id === uid);
  if (u) addSysMsg(`${u.name} 离开了协作 👋`);
});
socket.on('users-update', list => {
  users = list;
  onlineBadge.textContent = `🟢 ${users.length} 在线`;
});
socket.on('chat-message', addChatMsg);

// ─── 聊天 ────────────────────────────────────────────────
function addChatMsg(msg) {
  const d = document.createElement('div');
  d.className = 'chat-msg';
  const t = new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  d.innerHTML = `<span class="chat-name">${esc(msg.userName)}</span>${esc(msg.text)}<span class="chat-time">${t}</span>`;
  chatMsgList.appendChild(d);
  chatMsgList.scrollTop = chatMsgList.scrollHeight;
}

function addSysMsg(text) {
  const d = document.createElement('div');
  d.className = 'chat-msg system';
  d.textContent = text;
  chatMsgList.appendChild(d);
  chatMsgList.scrollTop = chatMsgList.scrollHeight;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function sendChat() {
  const t = chatInput.value.trim();
  if (!t) return;
  socket.emit('chat-message', t);
  chatInput.value = '';
}
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

// ─── 工具栏 ──────────────────────────────────────────────
$$('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    canvas.style.cursor = currentTool === 'eraser' ? 'cell' : 'crosshair';
  });
});

sizeSlider.addEventListener('input', () => { sizeDisplay.textContent = sizeSlider.value; });

undoBtn.addEventListener('click', () => {
  if (currentFrameId) socket.emit('undo-stroke', currentFrameId);
});

clearCanvasBtn.addEventListener('click', () => {
  if (!currentFrameId) return;
  const f = frames[currentFrameId];
  if (!f || f.strokes.length === 0) return;
  f.strokes = [];
  redrawCurrentFrame();
  updateThumb(currentFrameId);
  socket.emit('clear-canvas-frame', { frameId: currentFrameId });
});

// ─── 备注同步（debounce 300ms） ──────────────────────────
let notesTimer = null;
notesTa.addEventListener('input', () => {
  if (!currentFrameId) return;
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => {
    const f = frames[currentFrameId];
    if (!f) return;
    f.notes = notesTa.value;
    socket.emit('update-notes', { frameId: currentFrameId, notes: notesTa.value });
  }, 300);
});

// ─── 项目名同步（debounce 500ms） ────────────────────────
let projTimer = null;
projectNameIn.addEventListener('input', () => {
  clearTimeout(projTimer);
  projTimer = setTimeout(() => socket.emit('update-project-name', projectNameIn.value), 500);
});

// ─── 入场 ────────────────────────────────────────────────
joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

function join() {
  myName = nameInput.value.trim() || `用户_${Math.random().toString(36).slice(2, 6)}`;
  joinOverlay.style.display = 'none';
  app.style.display = 'flex';
  socket.emit('join', myName);
  setTimeout(resizeCanvas, 100);
  addFrame();
}

addFrameBtn.addEventListener('click', addFrame);
clearAllBtn.addEventListener('click', clearAll);
