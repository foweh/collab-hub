// ─── 主应用（多机版） ────────────────────────────────────
const socket = io();
let myName = '';
let serverId = '';
let serverName = '';
let projects = [];
let peers = [];         // 所有在线对等设备 [{ serverId, name, ip, port, connected, note }]

// DOM
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const joinOverlay     = $('#join-overlay');
const app             = $('#app');
const nameInput       = $('#name-input');
const joinBtn         = $('#join-btn');
const selfBadge       = $('#self-badge');
const peerBadge       = $('#peer-badge');
const lanCb           = $('#lan-toggle-cb');
const lanStatus       = $('#lan-status');
const refreshLanBtn   = $('#refresh-lan-btn');
const navBtns         = $$('.nav-btn[data-module]');
const panels          = $$('.module-panel');
const projectList     = $('#project-list');
const peerStatusArea  = $('#peer-status-area');
const transferSection = $('#transfer-section');
const transferList    = $('#transfer-list');
const transferBtn     = $('#transfer-btn');
const noteSection     = $('#note-section');
const peerNoteInput   = $('#peer-note-input');
const peerNoteSave    = $('#peer-note-save');
const receiveModal    = $('#receive-modal');
const receiveInfo     = $('#receive-info');
const receiveList     = $('#receive-list');
const receiveOk       = $('#receive-ok');
const chatMsgs        = $('#chat-msgs');
const chatInput       = $('#chat-input');
const chatSendBtn     = $('#chat-send-btn');

// ─── 扫描状态 ────────────────────────────────────────────
let scanState = 'idle';

function showScanStatus() {
  if (scanState === 'scanning') {
    peerStatusArea.innerHTML += `<div class="scan-status scanning">🔍 正在扫描…还剩 ${getScanRemaining()}</div>`;
  } else if (scanState === 'nobody') {
    peerStatusArea.innerHTML += `<div class="scan-status nobody">⏰ 扫描结束，未发现设备</div>`;
    // 自动关闭局域网开关
    lanCb.checked = false;
    lanStatus.textContent = '🔴 局域网: 关闭';
  } else if (scanState === 'found') {
    // 已被 updatePeersUI 处理
  }
}

let scanStartTime = null;

// ─── 操作锁系统 ─────────────────────────────────────────
// lockKey → userName，如 "mindmap-node:n5" → "小明"
const locks = new Map();

function lockKey(type, id) { return `${type}:${id}`; }

function isLocked(type, id) { return locks.has(lockKey(type, id)); }

function getLockUser(type, id) { return locks.get(lockKey(type, id)) || null; }

// 获取锁（零延迟广播）
function acquireLock(type, id) {
  socket.emit('focus-lock', { type, id });
}

// 释放锁
function releaseLock(type, id) {
  socket.emit('focus-release', { type, id });
}

// Socket 事件监听
socket.on('focus-lock', ({ type, id, user }) => {
  if (user !== myName) {
    locks.set(lockKey(type, id), user);
    // 通知当前模块刷新锁状态
    window.dispatchEvent(new CustomEvent('locks-changed'));
  }
});

socket.on('focus-release', ({ type, id, user }) => {
  locks.delete(lockKey(type, id));
  window.dispatchEvent(new CustomEvent('locks-changed'));
});

socket.on('focus-release-all', ({ user }) => {
  // 释放某个用户的所有锁
  for (const [key, u] of locks) {
    if (u === user) locks.delete(key);
  }
  window.dispatchEvent(new CustomEvent('locks-changed'));
});

function getScanRemaining() {
  if (!scanStartTime) return '<1 分钟';
  const elapsed = Date.now() - scanStartTime;
  const remaining = Math.ceil((5 * 60 * 1000 - elapsed) / 1000);
  if (remaining <= 0) return '即将结束';
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  return `${min}分${sec}秒`;
}

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
  peers = data.peers || [];
  scanState = data.scanState || 'idle';
  renderProjects();
  updatePeersUI();
  // 加载聊天历史
  if (data.chatHistory) data.chatHistory.forEach(addChatLine);
});

socket.on('bridge-message', (msg) => {
  switch (msg.type) {
    case 'peers-update':
      peers = msg.peers || [];
      updatePeersUI();
      break;
    case 'projects-update':
      // 项目列表有变化，从服务器重新获取
      // 实际上服务器会发单独的 project-created/updated/deleted 事件
      break;
    case 'projects-received':
      showReceiveModal(msg);
      break;
    case 'realtime':
      // 来自对等设备的实时事件，只转发给各模块（各模块自己监听 socket 事件）
      // 服务器已经通过 io.emit 发送了原始事件
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

// ── 扫描状态 ──
socket.on('scan-state', (data) => {
  scanState = data.state;
  if (data.state === 'scanning') {
    scanStartTime = Date.now();
    // 定期更新倒计时
    if (window.scanTimer) clearInterval(window.scanTimer);
    window.scanTimer = setInterval(() => {
      if (scanState === 'scanning' && peers.length === 0) {
        updatePeersUI();
      } else {
        clearInterval(window.scanTimer);
      }
    }, 1000);
  }
  updatePeersUI();
});

// ── 群聊 ──
socket.on('chat-message', (msg) => {
  addChatLine(msg);
});

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
    if (mod === 'devices') setTimeout(() => window.renderDevices && window.renderDevices(), 100);
  });
});

function initUI() {
  if (projects.length === 0) {
    createDefaultProject('script', '📜 未命名剧本');
    createDefaultProject('mindmap', '🧠 未命名导图');
    createDefaultProject('story', '📖 未命名故事');
  }
  renderProjects();
  updatePeersUI();
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
    const icons = { script: '📜', mindmap: '🧠', story: '📖' };
    const names = { script: '剧本', mindmap: '思维导图', story: '故事' };
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <span class="p-type">${icons[p.type] || '📄'}</span>
      <button class="p-del" data-id="${p.id}">×</button>
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-meta">${names[p.type] || p.type} · ${timeAgo(p.updatedAt)}</div>
      <div class="p-owner">${esc(p.owner || '我')}</div>
    `;
    card.querySelector('.p-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`删除「${p.name}」？`)) socket.emit('project-delete', p.id);
    });
    card.addEventListener('click', () => openProject(p));
    projectList.appendChild(card);
  });
  updateTransferList();
}

function openProject(p) {
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(pl => pl.classList.remove('active'));
  const panel = document.getElementById(`panel-${p.type}`);
  if (panel) {
    panel.classList.add('active');
    const btn = document.querySelector(`.nav-btn[data-module="${p.type}"]`);
    if (btn) btn.classList.add('active');
  }
  switch (p.type) {
    case 'script':  window.openScriptEditor(p); break;
    case 'mindmap': window.openMindMapEditor(p); break;
    case 'story':   window.openStoryEditor(p); break;
  }
}

// ─── 局域网开关 ──────────────────────────────────────────
lanCb.addEventListener('change', () => {
  lanStatus.textContent = lanCb.checked ? '🟢 局域网: 开启' : '🔴 局域网: 关闭';
  if (lanCb.checked) scanStartTime = Date.now();
  socket.emit('lan-toggle', lanCb.checked);
});
refreshLanBtn.addEventListener('click', () => socket.emit('refresh-lan'));
document.getElementById('lang-toggle-btn').addEventListener('click', () => {
  toggleLang();
  document.getElementById('lang-toggle-btn').textContent = currentLang === 'zh' ? '🇨🇳 中文' : '🇬🇧 English';
});

// ─── 多设备 UI ──────────────────────────────────────────
function updatePeersUI() {
  if (peers.length > 0) {
    let html = '';
    peers.forEach(p => {
      const noteHtml = p.note ? `<br><small>📝 ${esc(p.note)}</small>` : '';
      html += `<div style="margin-bottom:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div class="peer-name">${esc(p.name)}</div>
        <div class="d-meta">IP: ${p.ip} · ID: ${p.serverId}</div>
        ${noteHtml}
      </div>`;
    });
    peerStatusArea.innerHTML = `<div class="status-connected">🟢 ${peers.length} 台设备在线</div>${html}`;
    peerBadge.style.display = 'inline';
    peerBadge.className = 'badge online';
    peerBadge.textContent = `🤝 ${peers.length} 在线`;
    transferSection.style.display = 'block';
    noteSection.style.display = 'block';
    updateNoteSection();
    updateTransferList();
  } else {
    let html = `<div class="status-none">🔄 等待发现设备…<br><small>多台电脑都打开"开启局域网"</small></div>`;
    // 扫描状态提示
    if (scanState === 'scanning') {
      html += `<div class="scan-status scanning">🔍 正在扫描…还剩 ${getScanRemaining()}</div>`;
    } else if (scanState === 'nobody') {
      html += `<div class="scan-status nobody">⏰ 扫描 5 分钟结束，未发现设备</div>`;
      // 自动关闭开关
      lanCb.checked = false;
      lanStatus.textContent = '🔴 局域网: 关闭';
    }
    peerStatusArea.innerHTML = html;
    peerBadge.style.display = 'inline';
    peerBadge.className = 'badge offline';
    peerBadge.textContent = '💻 未连接';
    transferSection.style.display = 'none';
    noteSection.style.display = 'none';
  }
}

function updateNoteSection() {
  if (peers.length === 0) { noteSection.style.display = 'none'; return; }
  noteSection.style.display = 'block';

  let html = '<h3>📝 设备备注</h3>';
  peers.forEach(p => {
    html += `<div style="margin-bottom:6px">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:2px">${esc(p.name)}</div>
      <input class="peer-note-input" data-id="${p.serverId}" value="${esc(p.note || '')}" placeholder="备注..." style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);font-size:12px;outline:none">
    </div>`;
  });
  noteSection.innerHTML = html;

  // 自动保存备注
  noteSection.querySelectorAll('.peer-note-input').forEach(inp => {
    inp.addEventListener('change', () => {
      socket.emit('peer-note', { serverId: inp.dataset.id, note: inp.value.trim() });
    });
  });
}

// ─── 项目发送（多目标） ──────────────────────────────────
function updateTransferList() {
  transferList.innerHTML = '';
  if (peers.length === 0) { transferSection.style.display = 'none'; return; }

  // 目标选择
  let targetHtml = '<div style="margin-bottom:6px"><select id="transfer-target" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);font-size:12px">';
  peers.forEach(p => {
    targetHtml += `<option value="${p.serverId}">📤 发给 ${esc(p.name)}</option>`;
  });
  targetHtml += '</select></div>';
  transferList.innerHTML = targetHtml;

  // 项目选择
  projects.forEach(p => {
    const icons = { script: '📜', mindmap: '🧠', story: '📖' };
    const item = document.createElement('div');
    item.className = 'transfer-item';
    item.innerHTML = `<input type="checkbox" class="transfer-cb" value="${p.id}"><span>${icons[p.type] || '📄'} ${esc(p.name)}</span>`;
    item.querySelector('.transfer-cb').addEventListener('change', updateTransferBtn);
    transferList.appendChild(item);
  });
  updateTransferBtn();
}

function updateTransferBtn() {
  const checked = document.querySelectorAll('.transfer-cb:checked');
  transferBtn.disabled = checked.length === 0;
}

transferBtn.addEventListener('click', () => {
  const checked = document.querySelectorAll('.transfer-cb:checked');
  if (checked.length === 0) return;
  const ids = Array.from(checked).map(cb => cb.value);
  const target = document.getElementById('transfer-target');
  const targetServerId = target ? target.value : (peers[0] ? peers[0].serverId : null);
  if (!targetServerId) return alert('没有可发送的目标');
  const targetName = peers.find(p => p.serverId === targetServerId)?.name || '对方';
  if (confirm(`发送 ${ids.length} 个项目给 ${targetName}？`)) {
    socket.emit('project-transfer', { ids, targetServerId });
  }
});

// ─── 接收弹窗 ────────────────────────────────────────────
function showReceiveModal(msg) {
  receiveInfo.textContent = `${esc(msg.from)} 给你发了 ${msg.projects.length} 个项目：`;
  receiveList.innerHTML = '';
  msg.projects.forEach(p => {
    const icons = { script: '📜', mindmap: '🧠', story: '📖' };
    const div = document.createElement('div');
    div.className = 'rp-item';
    div.textContent = `${icons[p.type] || '📄'} ${p.name}`;
    receiveList.appendChild(div);
  });
  receiveModal.style.display = 'flex';
}
receiveOk.addEventListener('click', () => {
  receiveModal.style.display = 'none';
  renderProjects();
});

// ─── 工具 ────────────────────────────────────────────────
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

// ─── 群聊 ────────────────────────────────────────────────
function addChatLine(msg) {
  const d = document.createElement('div');
  d.className = 'chat-line';
  if (msg.system) {
    d.classList.add('cl-system');
    d.textContent = msg.text;
  } else {
    const t = new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    d.innerHTML = `<span class="cl-name">${esc(msg.userName)}</span>${esc(msg.text)}<span class="cl-time">${t}</span>`;
  }
  chatMsgs.appendChild(d);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  chatInput.value = '';
}

chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

// ─── 返回项目列表 ────────────────────────────────────────
document.querySelectorAll('#script-back, #mindmap-back, #story-back').forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    document.querySelector('.nav-btn[data-module="projects"]').classList.add('active');
    document.getElementById('panel-projects').classList.add('active');
    renderProjects();
  });
});
