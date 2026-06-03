// ─── 主应用 ──────────────────────────────────────────────
const socket = io();
let myName = '';
let serverId = '';
let serverName = '';
let projects = [];
let peer = null;        // 对等设备信息
let lanEnabled = false;

// DOM
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const joinOverlay    = $('#join-overlay');
const app            = $('#app');
const nameInput      = $('#name-input');
const joinBtn        = $('#join-btn');
const selfBadge      = $('#self-badge');
const peerBadge      = $('#peer-badge');
const lanCb          = $('#lan-toggle-cb');
const lanStatus      = $('#lan-status');
const refreshLanBtn  = $('#refresh-lan-btn');
const navBtns        = $$('.nav-btn[data-module]');
const panels         = $$('.module-panel');
const projectList    = $('#project-list');
const peerStatusArea = $('#peer-status-area');
const transferSection = $('#transfer-section');
const transferList   = $('#transfer-list');
const transferBtn    = $('#transfer-btn');
const noteSection    = $('#note-section');
const peerNoteInput  = $('#peer-note-input');
const peerNoteSave   = $('#peer-note-save');
const receiveModal   = $('#receive-modal');
const receiveInfo    = $('#receive-info');
const receiveList    = $('#receive-list');
const receiveOk      = $('#receive-ok');

// ─── 入场 ────────────────────────────────────────────────
joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

function join() {
  myName = nameInput.value.trim() || `用户_${Math.random().toString(36).slice(2, 5)}`;
  joinOverlay.style.display = 'none';
  app.style.display = 'flex';
  socket.emit('join', myName);
  socket.emit('set-server-name', myName);
  selfBadge.textContent = `👤 ${myName}`;
  initUI();
}

// ─── Socket 事件 ─────────────────────────────────────────
socket.on('init', (data) => {
  serverId = data.serverId;
  serverName = data.serverName;
  projects = data.projects || [];
  peer = data.peer;

  renderProjects();
  updatePeerUI();
});

socket.on('bridge-message', (msg) => {
  switch (msg.type) {
    case 'peer-status':
      peer = msg.peer;
      updatePeerUI();
      break;
    case 'projects-update':
      // 对方同步了项目列表
      break;
    case 'projects-received':
      // 对方发了项目给我们
      showReceiveModal(msg);
      break;
  }
});

socket.on('project-created', (p) => {
  projects.push(p);
  renderProjects();
});

socket.on('project-updated', (data) => {
  const p = projects.find(x => x.id === data.id);
  if (p) {
    if (data.name) p.name = data.name;
    if (data.data) p.data = data.data;
    p.updatedAt = data.updatedAt;
  }
  renderProjects();
});

socket.on('project-deleted', (id) => {
  projects = projects.filter(p => p.id !== id);
  renderProjects();
});

socket.on('transfer-sent', (data) => {
  alert(`✅ ${data.count} 个项目已发送给 ${data.to}`);
});

socket.on('transfer-failed', (data) => {
  alert(`❌ 发送失败: ${data.reason}`);
});

// 各模块的实时事件也通过这里中转
// 剧本/思维导图/故事的事件由各模块自行监听

// ─── 导航切换 ────────────────────────────────────────────
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mod = btn.dataset.module;
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    panels.forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${mod}`);
    if (panel) panel.classList.add('active');
    if (mod === 'mindmap') setTimeout(() => window.mmResize && window.mmResize(), 100);
  });
});

function initUI() {
  // 创建默认项目
  if (projects.length === 0) {
    createDefaultProject('script', '📜 未命名剧本');
    createDefaultProject('mindmap', '🧠 未命名导图');
    createDefaultProject('story', '📖 未命名故事');
  }
  renderProjects();
  updatePeerUI();
}

// ─── 项目管理 ────────────────────────────────────────────
function getDefaultData(type) {
  switch (type) {
    case 'script': return { acts: [] };
    case 'mindmap': return { nodes: [], edges: [] };
    case 'story': return { chapters: [] };
    default: return {};
  }
}

function createDefaultProject(type, name) {
  socket.emit('project-create', { type, name, data: getDefaultData(type) });
}

// 新建项目按钮
$('#new-script-btn').addEventListener('click', () => {
  const name = prompt('剧本名称:', '新剧本');
  if (name) socket.emit('project-create', { type: 'script', name, data: getDefaultData('script') });
});
$('#new-mindmap-btn').addEventListener('click', () => {
  const name = prompt('思维导图名称:', '新思维导图');
  if (name) socket.emit('project-create', { type: 'mindmap', name, data: getDefaultData('mindmap') });
});
$('#new-story-btn').addEventListener('click', () => {
  const name = prompt('故事名称:', '新故事');
  if (name) socket.emit('project-create', { type: 'story', name, data: getDefaultData('story') });
});

function renderProjects() {
  projectList.innerHTML = '';
  if (projects.length === 0) {
    projectList.innerHTML = '<div class="editor-placeholder">暂无项目，点击上方按钮创建</div>';
    return;
  }
  projects.forEach(p => {
    const typeIcons = { script: '📜', mindmap: '🧠', story: '📖' };
    const typeNames = { script: '剧本', mindmap: '思维导图', story: '故事' };
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <span class="p-type">${typeIcons[p.type] || '📄'}</span>
      <button class="p-del" data-id="${p.id}">×</button>
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-meta">${typeNames[p.type] || p.type} · ${timeAgo(p.updatedAt)}</div>
      <div class="p-owner">${esc(p.owner || '我')}</div>
    `;
    card.querySelector('.p-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`删除项目「${p.name}」？`)) socket.emit('project-delete', p.id);
    });
    card.addEventListener('click', () => openProject(p));
    projectList.appendChild(card);
  });
  updateTransferList();
}

function openProject(p) {
  // 切换到对应模块
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(pl => pl.classList.remove('active'));

  let mod = p.type;
  const panel = document.getElementById(`panel-${mod}`);
  if (panel) {
    panel.classList.add('active');
    const navBtn = document.querySelector(`.nav-btn[data-module="${mod}"]`);
    if (navBtn) navBtn.classList.add('active');
  }

  // 根据类型打开编辑器
  switch (p.type) {
    case 'script': window.openScriptEditor(p); break;
    case 'mindmap': window.openMindMapEditor(p); break;
    case 'story': window.openStoryEditor(p); break;
  }
}

// ─── 局域网开关 ──────────────────────────────────────────
lanCb.addEventListener('change', () => {
  lanEnabled = lanCb.checked;
  if (lanEnabled) {
    lanStatus.textContent = '🟢 局域网: 开启';
    // 通知服务器开启广播（服务器默认就在广播）
    socket.emit('lan-toggle', true);
  } else {
    lanStatus.textContent = '🔴 局域网: 关闭';
    socket.emit('lan-toggle', false);
  }
});

refreshLanBtn.addEventListener('click', () => {
  // 服务器每5秒自动广播，手动触发一次
  socket.emit('refresh-lan');
});

// ─── 对方 UI ────────────────────────────────────────────
function updatePeerUI() {
  if (peer && peer.connected) {
    const noteHtml = peer.note ? `<br><small>📝 ${esc(peer.note)}</small>` : '';
    peerStatusArea.innerHTML = `
      <div class="status-connected">🟢 已连接</div>
      <div class="peer-name">${esc(peer.name)}</div>
      <div class="d-meta">ID: ${peer.serverId} · IP: ${peer.ip}</div>
      ${noteHtml}
    `;
    peerBadge.style.display = 'inline';
    peerBadge.className = 'badge online';
    peerBadge.textContent = `🤝 ${esc(peer.name)}`;
    transferSection.style.display = 'block';
    noteSection.style.display = 'block';
    // 加载对方备注
    peerNoteInput.value = peer.note || '';
    updateTransferList();
  } else {
    peerStatusArea.innerHTML = `<div class="status-none">🔄 等待发现设备…<br><small>双方都打开"开启局域网"</small></div>`;
    peerBadge.style.display = 'inline';
    peerBadge.className = 'badge offline';
    peerBadge.textContent = '💻 未连接';
    transferSection.style.display = 'none';
    noteSection.style.display = 'none';
  }
}

// 对方备注
peerNoteSave.addEventListener('click', () => {
  const note = peerNoteInput.value.trim();
  socket.emit('peer-note', { note });
});

// ─── 项目发送 ────────────────────────────────────────────
function updateTransferList() {
  transferList.innerHTML = '';
  projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'transfer-item';
    const typeIcons = { script: '📜', mindmap: '🧠', story: '📖' };
    item.innerHTML = `
      <input type="checkbox" class="transfer-cb" value="${p.id}">
      <span>${typeIcons[p.type] || '📄'} ${esc(p.name)}</span>
    `;
    item.querySelector('.transfer-cb').addEventListener('change', updateTransferBtn);
    transferList.appendChild(item);
  });
}

function updateTransferBtn() {
  const checked = document.querySelectorAll('.transfer-cb:checked');
  transferBtn.disabled = checked.length === 0;
}

transferBtn.addEventListener('click', () => {
  const checked = document.querySelectorAll('.transfer-cb:checked');
  if (checked.length === 0) return;
  const ids = Array.from(checked).map(cb => cb.value);
  if (confirm(`发送 ${ids.length} 个项目给对方？`)) {
    socket.emit('project-transfer', { ids });
  }
});

// ─── 接收弹窗 ────────────────────────────────────────────
function showReceiveModal(msg) {
  receiveInfo.textContent = `${esc(msg.from)} 给你发了 ${msg.projects.length} 个项目：`;
  receiveList.innerHTML = '';
  msg.projects.forEach(p => {
    const typeIcons = { script: '📜', mindmap: '🧠', story: '📖' };
    const div = document.createElement('div');
    div.className = 'rp-item';
    div.textContent = `${typeIcons[p.type] || '📄'} ${p.name}`;
    receiveList.appendChild(div);
  });
  receiveModal.style.display = 'flex';
}

receiveOk.addEventListener('click', () => {
  receiveModal.style.display = 'none';
  // 刷新项目列表
  renderProjects();
});

// ─── 工具函数 ────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

// ─── 工具按钮 ────────────────────────────────────────────
document.querySelectorAll('#script-back, #mindmap-back, #story-back').forEach(btn => {
  btn.addEventListener('click', () => {
    // 返回项目列表
    navBtns.forEach(b => b.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    document.querySelector('.nav-btn[data-module="projects"]').classList.add('active');
    document.getElementById('panel-projects').classList.add('active');
    renderProjects();
  });
});
