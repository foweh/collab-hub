// ─── 全局 CollabStudio API ──────────────────────────────
window.CollabStudio = {
  version: '2.0.0',
  socket: null,
  modules: {},
  get userId() { return myUserId; },
  get userName() { return myName; },
  get peers() { return peers; },
  get projects() { return projects; },
  get serverId() { return serverId; },
};

// ─── 模块注册 API ──────────────────────────────────────
// 各个编辑器模块（剧本、故事等）通过此函数注册到 CollabStudio，
// 使得 openProject 可以正确路由到对应模块。
window.registerCollabModule = function(name, api) {
  if (api.open) {
    CollabStudio.modules[name] = { ...api, openProject: api.open };
  } else {
    CollabStudio.modules[name] = api;
  }
};

const socket = io();
CollabStudio.socket = socket;
const fenjingSocket = io('/fenjing');

let myUserId = localStorage.getItem('collab-user-id');
if (!myUserId) {
  myUserId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem('collab-user-id', myUserId);
}

let serverId = '';
let serverName = '';
let projects = [];
let peers = [];
let currentFolderPath = [];

// DOM
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const app             = $('#app');
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
let onlineUsers = [];

let currentStoryboardCtx = null;

// ─── 扫描状态 ────────────────────────────────────────────
let scanState = 'idle';

function showScanStatus() {
  if (scanState === 'scanning') {
    peerStatusArea.innerHTML += `<div class="scan-status scanning">🔍 正在扫描…还剩 ${getScanRemaining()}</div>`;
  } else if (scanState === 'nobody') {
    peerStatusArea.innerHTML += `<div class="scan-status nobody">⏰ 扫描结束，未发现设备</div>`;
    lanCb.checked = false;
    lanStatus.textContent = '🔴 局域网: 关闭';
  } else if (scanState === 'found') {
  }
}

let scanStartTime = null;

// ─── 操作锁系统 ─────────────────────────────────────────
const locks = new Map();

function lockKey(type, id) { return `${type}:${id}`; }
function isLocked(type, id) { return locks.has(lockKey(type, id)); }
function getLockUser(type, id) { return locks.get(lockKey(type, id)) || null; }

function acquireLock(type, id) {
  socket.emit('focus-lock', { type, id });
}

function releaseLock(type, id) {
  socket.emit('focus-release', { type, id });
}

socket.on('focus-lock', ({ type, id, user }) => {
  if (user !== myName) {
    locks.set(lockKey(type, id), user);
    window.dispatchEvent(new CustomEvent('locks-changed'));
  }
});

socket.on('focus-release', ({ type, id, user }) => {
  locks.delete(lockKey(type, id));
  window.dispatchEvent(new CustomEvent('locks-changed'));
});

socket.on('focus-release-all', ({ user }) => {
  for (const [key, u] of locks) {
    if (u === user) locks.delete(key);
  }
  window.dispatchEvent(new CustomEvent('locks-changed'));
});

// ─── 操作审计日志 ───────────────────────────────────────
let operationLog = [];

socket.on('operation-log', (entry) => {
  operationLog.push(entry);
  window.dispatchEvent(new CustomEvent('log-entry', { detail: entry }));
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

// ─── 联系管理员 ────────────────────────────────────────
function sendToAdmin() {
  const input = document.getElementById('contact-admin-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  socket.emit('user-message-to-admin', text);
  input.value = '';
  const orig = input.placeholder;
  input.placeholder = '✅ 已发送';
  setTimeout(() => { input.placeholder = orig; }, 1500);
}

const adminMsgs = [];
socket.on('admin-incoming-msg', (msg) => {
  adminMsgs.push(msg);
  const container = document.getElementById('admin-msgs');
  if (!container) return;
  const time = new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.style.cssText = 'padding:3px 4px;border-bottom:1px solid var(--border);margin-bottom:2px';
  div.innerHTML = `<strong style="color:var(--accent)">${esc(msg.from)}</strong> ${esc(msg.text)} <span style="font-size:10px;color:var(--text-dim);float:right">${time}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
});

function updateUIBasedOnRole() {
  const contactSection = document.getElementById('contact-admin-section');
  const adminNavBtn = document.getElementById('nav-admin-btn');
  if (contactSection) contactSection.style.display = isAdmin ? 'none' : 'block';
  if (adminNavBtn) adminNavBtn.style.display = isAdmin ? '' : 'none';
  if (selfBadge) {
    const roleLabel = isAdmin ? '👑' : (myRole === 'editor' ? '✏️' : (myRole === 'commenter' ? '💬' : '👁️'));
    selfBadge.textContent = `${roleLabel} ${myName}`;
  }
}

// ─── 管理员用户列表 ─────────────────────────────────
let adminUsersCache = []; // 缓存用户列表用于实时更新在线状态

socket.on('admin-users-list', (users) => {
  adminUsersCache = users;
  renderAdminUsers(users);
});

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => {
    const isOnline = u.online;
    const roleLabel = u.isAdmin ? '管理员' : (u.role === 'editor' ? '编辑者' : (u.role === 'commenter' ? '评论者' : '观察者'));
    const statusHtml = isOnline
      ? '<span style="color:#22c55e">● 在线</span>'
      : '<span style="color:#94a3b8">○ 离线</span>';
    let lastSeenText = '从未上线';
    if (u.lastSeen && u.lastSeen > 0) {
      const diff = Date.now() - u.lastSeen;
      if (diff < 60000) lastSeenText = '刚刚';
      else if (diff < 3600000) lastSeenText = Math.floor(diff / 60000) + ' 分钟前';
      else if (diff < 86400000) lastSeenText = Math.floor(diff / 3600000) + ' 小时前';
      else if (diff < 604800000) lastSeenText = Math.floor(diff / 86400000) + ' 天前';
      else lastSeenText = Math.floor(diff / 604800000) + ' 周前';
    }
    const fingerprintShort = u.fingerprint ? u.fingerprint.slice(0, 12) + '...' : '-';
    return `<tr data-username="${esc(u.name)}">
      <td><strong>${esc(u.name)}</strong>${u.isAdmin ? ' 👑' : ''}</td>
      <td class="admin-status">${statusHtml}</td>
      <td style="font-size:11px;color:var(--text-dim)">${u.lastSeen ? lastSeenText : '从未上线'}</td>
      <td>${roleLabel}</td>
      <td style="font-size:10px;color:var(--text-dim)">${fingerprintShort}</td>
      <td>${u.hasPassword ? '<button class="tool-btn" onclick="changeUserPwd(\'' + esc(u.name) + '\')">改密</button>' : '<span style="color:var(--text-dim)">无密码</span>'}</td>
      <td>${u.isBanned
        ? '<button class="tool-btn" onclick="unbanUser(\'' + esc(u.name) + '\')">解封</button>'
        : (u.name !== myName ? '<button class="tool-btn danger" onclick="banUser(\'' + esc(u.name) + '\')">封禁</button>' : '-')
      }</td>
    </tr>`;
  }).join('');
}

// 实时更新管理员表格的在线状态
function refreshAdminStatus() {
  if (!adminUsersCache.length) return;
  const onlineSet = new Set((window.onlineUsers || []).map(u => u.name));
  adminUsersCache.forEach(u => {
    const row = document.querySelector(`#admin-users-tbody tr[data-username="${esc(u.name)}"]`);
    if (!row) return;
    const isOnline = onlineSet.has(u.name);
    row.querySelector('.admin-status').innerHTML = isOnline
      ? '<span style="color:#22c55e">● 在线</span>'
      : '<span style="color:#94a3b8">○ 离线</span>';
  });
}

function changeUserPwd(name) {
  const pwd = prompt('输入新密码给用户: ' + name);
  if (pwd && pwd.length >= 3) {
    socket.emit('admin-change-password', { targetName: name, newPassword: pwd });
    showToast('✅ 密码已修改');
  }
}

function banUser(name) {
  if (confirm('确定封禁用户 ' + name + '？')) {
    socket.emit('admin-ban-user', { targetName: name });
    showToast('🔨 用户 ' + name + ' 已封禁');
  }
}

function unbanUser(name) {
  if (confirm('确定解封用户 ' + name + '？')) {
    socket.emit('admin-unban-user', { targetName: name });
    showToast('✅ 用户 ' + name + ' 已解封');
  }
}

const myFingerprint = window.CollabStudioFingerprint ? window.CollabStudioFingerprint() : '';

// ─── 入场 ────────────────────────────────────────────────
let savedAuth = null;
try {
  const raw = sessionStorage.getItem('collab-auth');
  if (raw) savedAuth = JSON.parse(raw);
} catch(_) {}

if (!savedAuth || !savedAuth.name) {
  window.location.href = '/';
}

let myName = savedAuth ? savedAuth.name : '';
let isAdmin = savedAuth ? savedAuth.isAdmin : false;
let myRole = savedAuth ? (savedAuth.role || (isAdmin ? 'editor' : 'commenter')) : 'commenter';
let myToken = savedAuth ? savedAuth.token : '';

socket.on('connect', () => {
  if (myName) {
    socket.emit('join', { name: myName, token: myToken, fingerprint: myFingerprint });
  }
});

socket.on('login-success', ({ userName, isAdmin: admin, role }) => {
  isAdmin = admin;
  myRole = role || (isAdmin ? 'editor' : 'commenter');
  app.style.display = 'flex';
  const roleLabel = isAdmin ? '👑' : (myRole === 'editor' ? '✏️' : (myRole === 'commenter' ? '💬' : '👁️'));
  selfBadge.textContent = `${roleLabel} ${userName}`;
  if (isAdmin) selfBadge.className = 'badge admin';
  else selfBadge.className = 'badge';
  updateUIBasedOnRole();
  initUI();
  if (isAdmin) {
    socket.emit('admin-get-stats');
    socket.emit('admin-list-resets');
  }
  
  const contactBtn = document.getElementById('contact-admin-btn');
  const contactInput = document.getElementById('contact-admin-input');
  if (contactBtn) contactBtn.onclick = sendToAdmin;
  if (contactInput) contactInput.onkeydown = (e) => { if (e.key === 'Enter') sendToAdmin(); };
});

socket.on('login-error', (msg) => {
  sessionStorage.removeItem('collab-auth');
  showAlert(msg, '登录失败', '❌');
  setTimeout(() => { window.location.href = '/'; }, 2000);
});

socket.on('kicked', (msg) => {
  showAlert(msg, '已被踢出', '🚫');
  sessionStorage.removeItem('collab-auth');
  setTimeout(() => { window.location.href = '/'; }, 2000);
  app.style.display = 'none';
});

socket.on('role-changed', ({ role }) => {
  myRole = role;
  const roleLabel = isAdmin ? '👑' : (myRole === 'editor' ? '✏️' : (myRole === 'commenter' ? '💬' : '👁️'));
  selfBadge.textContent = `${roleLabel} ${myName}`;
  showAlert(`你的角色已变更为: ${role}`, '角色变更', '🎭');
});

// ─── Socket 事件 ─────────────────────────────────────────
socket.on('init', (data) => {
  serverId = data.serverId;
  serverName = data.serverName;
  projects = data.projects || [];
  peers = data.peers || [];
  onlineUsers = data.onlineUsers || [];
  scanState = data.scanState || 'idle';
  renderProjects();
  updatePeersUI();
  renderOnlineUsers();
});

socket.on('bridge-message', (msg) => {
  switch (msg.type) {
    case 'peers-update':
      peers = msg.peers || [];
      updatePeersUI();
      break;
    case 'projects-update':
      break;
    case 'projects-received':
      showReceiveModal(msg);
      break;
    case 'realtime':
      break;
  }
});

socket.on('project-created', (p) => {
  projects.push(p);
  renderProjects();
});

socket.on('project-deleted', (id) => {
  const idx = projects.findIndex(p => p.id === id);
  if (idx >= 0) projects.splice(idx, 1);
  renderProjects();
});

socket.on('project-permanently-deleted', (id) => {
  console.log('收到永久删除响应:', id);
  const idx = projects.findIndex(p => p.id === id);
  if (idx >= 0) projects.splice(idx, 1);
  renderProjects();
});

socket.on('project-updated', (p) => {
  const idx = projects.findIndex(x => x.id === p.id);
  if (idx >= 0) projects[idx] = { ...projects[idx], ...p };
  renderProjects();
});

socket.on('project-restored', (p) => {
  const idx = projects.findIndex(x => x.id === p.id);
  if (idx >= 0) projects[idx] = { ...projects[idx], ...p, deleted: false, deletedAt: undefined };
  renderProjects();
});

socket.on('project-purged', (id) => {
  const idx = projects.findIndex(p => p.id === id);
  if (idx >= 0) projects.splice(idx, 1);
  renderProjects();
});

socket.on('project-update-error', (msg) => {
  showAlert(msg, '操作失败', '❌');
});

socket.on('peer-joined', (peer) => {
  const idx = peers.findIndex(p => p.serverId === peer.serverId);
  if (idx >= 0) peers[idx] = peer;
  else peers.push(peer);
  updatePeersUI();
});

socket.on('peer-left', (serverId) => {
  peers = peers.filter(p => p.serverId !== serverId);
  updatePeersUI();
});

socket.on('scan-status', ({ state, remaining }) => {
  scanState = state;
  showScanStatus();
});

socket.on('online-users', (users) => {
  onlineUsers = users;
  renderOnlineUsers();
  refreshAdminStatus();
});

socket.on('user-joined', (user) => {
  if (!onlineUsers.find(u => u.name === user.name)) {
    onlineUsers.push(user);
  }
  renderOnlineUsers();
  refreshAdminStatus();
});

socket.on('user-left', (userName) => {
  onlineUsers = onlineUsers.filter(u => u.name !== userName);
  renderOnlineUsers();
  refreshAdminStatus();
});

// ─── UI 辅助函数 ────────────────────────────────────────
function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < week) return `${Math.floor(diff / day)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function showAlert(msg, title = '提示', icon = '💡') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:320px;">
      <div style="font-size:24px;margin-bottom:8px">${icon}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(msg)}</p>
      <button class="btn btn-primary" style="margin-top:12px;width:100%" onclick="this.closest('.modal-overlay').remove()">确定</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function showConfirm(msg, title = '确认', icon = '❓') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:320px;">
        <div style="font-size:24px;margin-bottom:8px">${icon}</div>
        <h3>${esc(title)}</h3>
        <p>${esc(msg)}</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn" style="flex:1" id="confirm-cancel">取消</button>
          <button class="btn btn-primary" style="flex:1" id="confirm-ok">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const cancelBtn = overlay.querySelector('#confirm-cancel');
    const okBtn = overlay.querySelector('#confirm-ok');
    
    const cleanup = () => {
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
      overlay.remove();
    };
    
    const onCancel = () => { cleanup(); resolve(false); };
    const onOk = () => { cleanup(); resolve(true); };
    
    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
  });
}

// ─── 在线用户 ───────────────────────────────────────────
function renderOnlineUsers() {
  const container = document.getElementById('online-users');
  if (!container) return;
  container.innerHTML = onlineUsers.map(u => {
    const roleIcon = u.isAdmin ? '👑' : (u.role === 'editor' ? '✏️' : (u.role === 'commenter' ? '💬' : '👁️'));
    return `<div class="online-user">${roleIcon} ${esc(u.name)}</div>`;
  }).join('');
}

// ─── 设备列表 ───────────────────────────────────────────
function updatePeersUI() {
  peerStatusArea.innerHTML = '';
  
  if (peers.length === 0) {
    peerStatusArea.innerHTML = '<div class="empty-peers">暂无连接设备</div>';
    return;
  }
  
  peers.forEach(peer => {
    const status = peer.connected ? 'connected' : 'disconnected';
    const div = document.createElement('div');
    div.className = `peer-item ${status}`;
    div.innerHTML = `
      <div class="peer-name">${esc(peer.name || peer.ip)}</div>
      <div class="peer-ip">${esc(peer.ip)}:${peer.port}</div>
      <div class="peer-status">${peer.connected ? '🟢 在线' : '🔴 离线'}</div>
    `;
    peerStatusArea.appendChild(div);
  });
}

// ─── 项目传输 ───────────────────────────────────────────
function updateTransferList() {
  if (!transferSection || !transferList) return;
  
  const transferable = projects.filter(p => !p.deleted && p.owner !== myName && p.visibility !== 'private');
  
  if (transferable.length === 0) {
    transferList.innerHTML = '<div class="empty-transfer">暂无可接收的项目</div>';
    transferBtn.disabled = true;
    return;
  }
  
  transferList.innerHTML = transferable.map(p => `
    <label class="transfer-item">
      <input type="checkbox" class="transfer-checkbox" data-id="${p.id}">
      <span class="transfer-name">${esc(p.name)}</span>
      <span class="transfer-owner">来自: ${esc(p.owner)}</span>
    </label>
  `).join('');
  transferBtn.disabled = false;
}

function doTransfer() {
  const checked = document.querySelectorAll('.transfer-checkbox:checked');
  if (checked.length === 0) {
    showAlert('请选择要接收的项目', '提示', '💡');
    return;
  }
  
  const ids = Array.from(checked).map(cb => cb.dataset.id);
  socket.emit('projects-receive', ids);
  showAlert('请求已发送，请等待对方确认', '提示', '📤');
}

// ─── 接收项目模态框 ─────────────────────────────────────
function showReceiveModal(msg) {
  if (!receiveModal || !receiveInfo || !receiveList) return;
  
  receiveInfo.textContent = `${msg.from} 想要接收你的 ${msg.projects.length} 个项目`;
  receiveList.innerHTML = msg.projects.map(p => `
    <div class="receive-item">
      <span>${esc(p.name)}</span>
      <span style="color:var(--text-dim);font-size:12px">${p.type}</span>
    </div>
  `).join('');
  
  receiveModal.style.display = 'flex';
  
  receiveOk.onclick = () => {
    receiveModal.style.display = 'none';
    socket.emit('projects-accept-transfer', { from: msg.from, ids: msg.projects.map(p => p.id) });
  };
}

// ─── 导航切换 ───────────────────────────────────────────
function switchModule(moduleName) {
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));
  
  const btn = document.querySelector(`.nav-btn[data-module="${moduleName}"]`);
  const panel = document.getElementById(`panel-${moduleName}`);
  const nav = document.querySelector('.nav');
  const toolbar = document.querySelector('.toolbar');
  
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
  
  if (moduleName === 'projects') {
    // 返回项目页面时恢复导航栏和工具栏显示
    if (nav) nav.style.display = '';
    if (toolbar) toolbar.style.display = '';
    currentFolderPath = [];
    renderProjects();
  }
  if (moduleName === 'admin') {
    socket.emit('admin-list-users');
    socket.emit('admin-get-stats');
    socket.emit('admin-list-resets');
  }
}

// ─── 返回文件夹 ─────────────────────────────────────────
function goBackToFolder() {
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(p => p.classList.remove('active'));

  const projectsPanel = document.getElementById('panel-projects');
  const projectsBtn = document.querySelector('.nav-btn[data-module="projects"]');
  const nav = document.querySelector('.nav');
  const toolbar = document.querySelector('.toolbar');

  if (projectsBtn) projectsBtn.classList.add('active');
  if (projectsPanel) projectsPanel.classList.add('active');
  if (nav) nav.style.display = '';
  if (toolbar) toolbar.style.display = '';
  renderProjects();
}

// ─── 返回按钮绑定 ───────────────────────────────────────
['script', 'mindmap', 'story', 'sb', 'admin'].forEach(id => {
  const btn = document.getElementById(`${id}-back`);
  if (btn) btn.addEventListener('click', goBackToFolder);
});
const pdBack = document.getElementById('pd-back');
if (pdBack) pdBack.addEventListener('click', goBackToFolder);

// ─── 新建文件夹按钮 ──────────────────────────────────────
console.log('正在初始化新建文件夹按钮...');
const newProjectBtn = document.getElementById('new-project-btn');
console.log('newProjectBtn 元素:', newProjectBtn);

if (newProjectBtn) {
  console.log('绑定点击事件...');
  newProjectBtn.addEventListener('click', () => {
    console.log('新建文件夹按钮被点击');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal-card';
    modal.style.maxWidth = '360px';
    modal.innerHTML = `
      <h3 style="margin-bottom:16px">📁 新建文件夹</h3>
      <div style="margin-bottom:16px">
        <label style="display:block;margin-bottom:4px;font-size:13px">文件夹名称</label>
        <input type="text" id="new-folder-name" style="width:100%;padding:8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text)" placeholder="输入文件夹名称..." autofocus>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" id="folder-cancel">取消</button>
        <button class="btn btn-primary" id="folder-confirm" disabled>创建</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    console.log('弹窗已添加到页面');

    const nameInput = document.getElementById('new-folder-name');
    const confirmBtn = document.getElementById('folder-confirm');

    nameInput.addEventListener('input', () => {
      confirmBtn.disabled = !nameInput.value.trim();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && nameInput.value.trim()) {
        confirmBtn.click();
      } else if (e.key === 'Escape') {
        overlay.remove();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.getElementById('folder-cancel').addEventListener('click', () => overlay.remove());

    confirmBtn.addEventListener('click', () => {
      const folderName = nameInput.value.trim() || '新建文件夹';
      console.log('创建文件夹:', folderName);
      overlay.remove();
      socket.emit('project-create', { type: 'folder', name: folderName, data: { children: [] } });
    });
  });
} else {
  console.error('找不到 new-project-btn 元素！');
}

// ─── 回收站切换 ─────────────────────────────────────────
let showingTrash = false;
let savedFolderPath = []; // 保存进入回收站前的路径

const trashBtn = document.getElementById('trash-btn');
const emptyTrashBtn = document.getElementById('empty-trash-btn');
console.log('清空回收站按钮获取结果:', emptyTrashBtn);

if (trashBtn) {
  trashBtn.addEventListener('click', () => {
    showingTrash = !showingTrash;
    trashBtn.textContent = showingTrash ? '📂' : '🗑️';
    trashBtn.style.borderColor = showingTrash ? 'var(--danger)' : '';
    
    // 控制按钮显示/隐藏
    const newProjectBtn = document.getElementById('new-project-btn');
    const separator = newProjectBtn ? newProjectBtn.nextElementSibling : null;
    if (newProjectBtn) newProjectBtn.style.display = showingTrash ? 'none' : '';
    if (separator && separator.tagName === 'SPAN') separator.style.display = showingTrash ? 'none' : '';
    if (emptyTrashBtn) emptyTrashBtn.style.display = showingTrash ? '' : 'none';
    
    if (showingTrash) {
      // 进入回收站：保存当前路径，清空路径回到根目录
      savedFolderPath = [...currentFolderPath];
      currentFolderPath = [];
    } else {
      // 退出回收站：恢复之前的路径
      currentFolderPath = [...savedFolderPath];
      savedFolderPath = [];
    }
    
    renderProjects();
  });
}

// 清空回收站
if (emptyTrashBtn) {
  console.log('绑定清空回收站按钮点击事件');
  emptyTrashBtn.addEventListener('click', async () => {
    console.log('清空回收站按钮被点击');
    const deletedProjects = projects.filter(p => p.deleted);
    console.log('回收站中的项目数量:', deletedProjects.length);
    if (deletedProjects.length === 0) {
      showAlert('回收站已经是空的', '提示', 'ℹ️');
      return;
    }
    if (await showConfirm(`确定要永久删除回收站中的 ${deletedProjects.length} 个项目吗？此操作不可撤销！`, '清空回收站确认', '⚠️')) {
      deletedProjects.forEach(p => {
        socket.emit('project-permanent-delete', p.id);
      });
    }
  });
} else {
  console.error('清空回收站按钮未找到!');
}

// ─── 项目渲染 ───────────────────────────────────────────
function renderProjects() {
  projectList.innerHTML = '';

  const currentFolderId = currentFolderPath.length > 0 
    ? currentFolderPath[currentFolderPath.length - 1].id 
    : null;

  const breadcrumb = document.getElementById('breadcrumb');
  if (currentFolderPath.length > 0) {
    breadcrumb.style.display = 'flex';
    let crumbsHtml = `
      <span class="crumb-item" style="cursor:pointer;color:var(--accent)">📂 我的项目</span>
      ${currentFolderPath.map((f, i) => `
        <span style="color:var(--text-dim)">/</span>
        <span class="crumb-item" data-index="${i}" style="cursor:pointer;color:var(--accent)">${esc(f.name)}</span>
      `).join('')}
    `;
    
    // 在文件夹内添加创建按钮到面包屑导航
    if (!showingTrash && currentFolderId) {
      crumbsHtml += `
        <span style="flex:1"></span>
        <div class="create-buttons-inline">
          <button class="create-btn" data-type="script" title="创建剧本">
            <span class="create-icon">📜</span>
            <span class="create-label">剧本</span>
          </button>
          <button class="create-btn" data-type="mindmap" title="创建思维导图">
            <span class="create-icon">🧠</span>
            <span class="create-label">导图</span>
          </button>
          <button class="create-btn" data-type="story" title="创建故事">
            <span class="create-icon">📖</span>
            <span class="create-label">故事</span>
          </button>
          <button class="create-btn" data-type="storyboard" title="创建分镜">
            <span class="create-icon">🎬</span>
            <span class="create-label">分镜</span>
          </button>
          <button class="create-btn" data-type="folder" title="创建子文件夹">
            <span class="create-icon">📁</span>
            <span class="create-label">文件夹</span>
          </button>
        </div>
      `;
    }
    
    breadcrumb.innerHTML = crumbsHtml;
    
    breadcrumb.querySelectorAll('.crumb-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        if (i === 0) {
          currentFolderPath = [];
        } else {
          currentFolderPath = currentFolderPath.slice(0, i);
        }
        renderProjects();
      });
    });
    
    // 创建按钮点击事件
    breadcrumb.querySelectorAll('.create-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const typeNames = { script: '剧本', mindmap: '思维导图', story: '故事', storyboard: '分镜', folder: '文件夹' };
        const typeIcons = { script: '📜', mindmap: '🧠', story: '📖', storyboard: '🎬', folder: '📁' };
        
        // 获取当前文件夹内的同类型项目名称
        const getExistingNames = () => {
          const currentFolderId = currentFolderPath.length > 0 ? currentFolderPath[currentFolderPath.length - 1].id : null;
          if (currentFolderId) {
            return projects.filter(p => !p.deleted && p.parentId === currentFolderId && p.type === (type === 'storyboard' ? 'project' : type)).map(p => p.name);
          } else {
            return projects.filter(p => !p.deleted && !p.parentId && p.type === (type === 'storyboard' ? 'project' : type)).map(p => p.name);
          }
        };
        
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal-card" style="max-width:360px;">
            <h3 style="margin-bottom:16px">${typeIcons[type]} 新建${typeNames[type]}</h3>
            <div style="margin-bottom:16px">
              <label style="display:block;margin-bottom:4px;font-size:13px;color:var(--text-secondary)">${typeNames[type]}名称</label>
              <input type="text" id="new-item-name" class="modal-input" style="width:100%" placeholder="输入名称..." autofocus>
              <div id="name-error" style="font-size:12px;color:var(--danger);margin-top:4px;display:none">⚠️ 名称已存在</div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
              <button class="btn" id="item-cancel">取消</button>
              <button class="btn btn-primary" id="item-confirm" disabled>创建</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        const nameInput = overlay.querySelector('#new-item-name');
        const confirmBtn = overlay.querySelector('#item-confirm');
        const nameError = overlay.querySelector('#name-error');

        const validateName = () => {
          const name = nameInput.value.trim();
          if (!name) {
            confirmBtn.disabled = true;
            nameError.style.display = 'none';
            return;
          }
          
          const existingNames = getExistingNames();
          if (existingNames.includes(name)) {
            confirmBtn.disabled = true;
            nameError.style.display = 'block';
          } else {
            confirmBtn.disabled = false;
            nameError.style.display = 'none';
          }
        };

        nameInput.addEventListener('input', validateName);

        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !confirmBtn.disabled) {
            confirmBtn.click();
          } else if (e.key === 'Escape') {
            overlay.remove();
          }
        });

        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) overlay.remove();
        });

        overlay.querySelector('#item-cancel').addEventListener('click', () => overlay.remove());

        confirmBtn.addEventListener('click', () => {
          const itemName = nameInput.value.trim() || '未命名';
          overlay.remove();
          const projectData = type === 'folder' ? { children: [] } : undefined;
          const currentFolderId = currentFolderPath.length > 0 ? currentFolderPath[currentFolderPath.length - 1].id : null;
          socket.emit('project-create', { 
            type: type === 'storyboard' ? 'project' : type, 
            name: itemName, 
            parentId: currentFolderId,
            data: projectData 
          });
        });
      });
    });
  } else {
    breadcrumb.style.display = 'none';
  }

  let visibleProjects;
  if (showingTrash) {
    visibleProjects = projects.filter(p => p.deleted);
  } else {
    if (currentFolderId) {
      visibleProjects = projects.filter(p => !p.deleted && p.parentId === currentFolderId);
    } else {
      visibleProjects = projects.filter(p => !p.deleted && !p.parentId);
    }
  }

  const canAccess = (p) => {
    if (p.type === 'folder') return true;
    if (isAdmin || p.owner === myName) return true;
    if (p.visibility && p.visibility !== 'private') return true;
    // 如果父文件夹是公开的，子项目也自动可见
    if (p.parentId) {
      const parent = projects.find(pr => pr.id === p.parentId);
      if (parent && parent.visibility && parent.visibility !== 'private') return true;
    }
    return false;
  };
  visibleProjects = visibleProjects.filter(p => canAccess(p));

  if (visibleProjects.length === 0) {
    projectList.innerHTML += showingTrash
      ? '<div class="editor-placeholder">回收站是空的</div>'
      : currentFolderId 
        ? '<div class="editor-placeholder">文件夹是空的</div>'
        : '<div class="editor-placeholder">暂无项目，点击上方按钮创建</div>';
    return;
  }

  const visIcons = { 'private': '🔒', 'public-read': '👁️', 'public-edit': '✏️' };
  const visLabels = { 'private': '私密', 'public-read': '公开-只读', 'public-edit': '公开-可编辑' };

  if (!showingTrash) {
    const folders = visibleProjects.filter(p => p.type === 'folder');
    const items = visibleProjects.filter(p => p.type !== 'folder');
    
    folders.forEach(f => {
      const vis = f.visibility || 'private';
      const canChange = isAdmin || f.owner === myName;
      const folderVisLabels = { 'private': '不让查看', 'public-read': '查看', 'public-edit': '编辑' };
      const folderVisIcons = { 'private': '🔒', 'public-read': '👁️', 'public-edit': '✏️' };
      const visOpts = ['private', 'public-read', 'public-edit'].map(v =>
        `<option value="${v}"${vis === v ? ' selected' : ''}>${folderVisLabels[v]}</option>`
      ).join('');
      const card = document.createElement('div');
      card.className = 'project-card folder';
      const childCount = (f.data && f.data.children) ? f.data.children.length : 0;
      card.innerHTML = `
        <span class="p-type">📁</span>
        <button class="p-del" data-id="${f.id}">×</button>
        <div class="p-name">${esc(cleanProjectName(f.name))}</div>
        <div class="p-meta">文件夹 · ${childCount} 个项目 · ${timeAgo(f.updatedAt)}</div>
        <div class="p-owner">${esc(f.owner || '我')}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;display:flex;align-items:center;gap:4px">
          <span title="${folderVisLabels[vis]}">${folderVisIcons[vis]}</span>
          ${canChange ? `<select class="vis-select" data-id="${f.id}" style="padding:1px 4px;font-size:10px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text);outline:none">${visOpts}</select>` : `<span style="font-size:10px">${folderVisLabels[vis]}</span>`}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">双击进入</div>
      `;
      if (canDeleteProject(f)) {
        card.querySelector('.p-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          console.log('删除文件夹按钮被点击:', f.name, f.id);
          if (await showConfirm(`删除文件夹「${f.name}」及其所有子项目？`, '删除确认', '🗑️')) {
            console.log('确认删除文件夹:', f.name);
            // 使用 parentId 查找子项目
            const childProjects = projects.filter(p => p.parentId === f.id);
            childProjects.forEach(c => socket.emit('project-delete', c.id));
            socket.emit('project-delete', f.id);
          }
        });
      } else { card.querySelector('.p-del').style.display = 'none'; }
      
      let clickCount = 0;
      let clickTimer = null;
      card.addEventListener('click', () => {
        clickCount++;
        if (clickTimer) clearTimeout(clickTimer);
        if (clickCount === 2) {
          // 双击进入文件夹 - 检查权限
          if (!canViewFolder(f)) {
            showToast('🔒 此文件夹内容不可查看');
            clickCount = 0;
            return;
          }
          currentFolderPath.push({ id: f.id, name: f.name });
          renderProjects();
          clickCount = 0;
        } else {
          clickTimer = setTimeout(() => {
            clickCount = 0;
            // 单击打开 - 检查权限
            if (!canViewFolder(f)) {
              showToast('🔒 此文件夹内容不可查看');
              return;
            }
            openProject(f);
          }, 300);
        }
      });

      // 文件夹可见性选择
      const folderVisSel = card.querySelector('.vis-select');
      if (folderVisSel) {
        folderVisSel.onclick = (e) => e.stopPropagation();
        folderVisSel.onchange = function() {
          socket.emit('project-set-visibility', { projectId: f.id, visibility: this.value });
        };
      }
      
      projectList.appendChild(card);
    });

    items.forEach(p => {
      const icons = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁', project: '🎬' };
      const names = { script: '剧本', mindmap: '思维导图', story: '故事', folder: '文件夹', project: '项目' };
      const vis = p.visibility || 'private';
      const canChange = isAdmin || p.owner === myName;
      const visOpts = ['private', 'public-read', 'public-edit'].map(v =>
        `<option value="${v}"${vis === v ? ' selected' : ''}>${visLabels[v]}</option>`
      ).join('');
      const card = document.createElement('div');
      card.className = 'project-card';
      card.innerHTML = `
        <span class="p-type">${icons[p.type] || '📄'}</span>
        <button class="p-del" data-id="${p.id}">×</button>
        <div class="p-name">${esc(cleanProjectName(p.name))}</div>
        <div class="p-meta" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <span title="${visLabels[vis]}">${visIcons[vis] || '🔒'}</span>
          ${p.type === 'project' ? ('项目 · ' + ((p.data && p.data.items) ? p.data.items.length + '个子项' : '0个子项')) : (names[p.type] || p.type)} · ${timeAgo(p.updatedAt)}
        </div>
        <div class="p-owner">${esc(p.owner || '我')}</div>
        ${canChange ? `<div style="margin-top:4px"><select class="vis-select" data-id="${p.id}" style="padding:1px 4px;font-size:10px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text);outline:none">${visOpts}</select></div>` : `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">${visIcons[vis]} ${visLabels[vis]}</div>`}
      `;
      if (canDeleteProject(p)) {
        card.querySelector('.p-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await showConfirm(`删除「${p.name}」？`, '删除确认', '🗑️')) socket.emit('project-delete', p.id);
        });
      } else {
        card.querySelector('.p-del').style.display = 'none';
      }
      card.addEventListener('click', () => openProject(p));
      const visSel = card.querySelector('.vis-select');
      if (visSel) {
        visSel.onclick = (e) => e.stopPropagation();
        visSel.onchange = function() {
          socket.emit('project-set-visibility', { projectId: p.id, visibility: this.value });
        };
      }
      projectList.appendChild(card);
    });
  } else {
    visibleProjects.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    visibleProjects.forEach(p => {
      const icons = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁', project: '🎬' };
      const names = { script: '剧本', mindmap: '思维导图', story: '故事', folder: '文件夹', project: '项目' };
      const card = document.createElement('div');
      card.className = 'project-card trash';
      card.innerHTML = `
        <span class="p-type">${icons[p.type] || '📄'}</span>
        <div class="p-name" style="color:var(--text-dim);text-decoration:line-through">${esc(cleanProjectName(p.name))}</div>
        <div class="p-meta">${names[p.type] || p.type} · ${timeAgo(p.deletedAt)} 前删除</div>
        <div class="p-owner">${esc(p.owner || '我')}</div>
        <div class="trash-actions" style="margin-top:6px;display:flex;gap:6px">
          <button class="trash-restore-btn" data-id="${p.id}" style="padding:2px 10px;font-size:11px;background:var(--green);border:none;border-radius:4px;color:#000;cursor:pointer">↩ 恢复</button>
          <button class="trash-del-btn" data-id="${p.id}" style="padding:2px 10px;font-size:11px;background:var(--danger);border:none;border-radius:4px;color:#fff;cursor:pointer">🗑️ 永久删除</button>
        </div>
      `;
      card.querySelector('.trash-restore-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        socket.emit('project-restore', p.id);
      });
      card.querySelector('.trash-del-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        console.log('永久删除按钮被点击:', p.id, p.name);
        if (await showConfirm('确定要永久删除吗？此操作不可撤销！', '永久删除确认', '⚠️')) {
          console.log('确认永久删除，发送请求:', p.id);
          socket.emit('project-permanent-delete', p.id);
          // 直接更新本地状态，不等待服务器响应
          const idx = projects.findIndex(item => item.id === p.id);
          if (idx >= 0) projects.splice(idx, 1);
          renderProjects();
        } else {
          console.log('取消永久删除');
        }
      });
      projectList.appendChild(card);
    });
  }
}

function canDeleteProject(p) {
  const result = isAdmin || p.owner === myName;
  return result;
}

function canViewFolder(f) {
  if (f.type !== 'folder') return true;
  if (isAdmin || f.owner === myName) return true;
  return f.visibility && f.visibility !== 'private';
}

function cleanProjectName(name) {
  return (name || '').replace(/[<>:"/\\|?*]/g, '_');
}

function openProject(p) {
  if (p.type === 'folder') {
    currentFolderPath.push({ id: p.id, name: p.name });
    renderProjects();
    return;
  }
  
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(pl => pl.classList.remove('active'));
  
  let moduleName = 'projects';
  switch(p.type) {
    case 'script': moduleName = 'script'; break;
    case 'mindmap': moduleName = 'mindmap'; break;
    case 'story': moduleName = 'story'; break;
    case 'project': 
    case 'storyboard': moduleName = 'storyboard'; break;
  }
  
  const panel = document.getElementById(`panel-${moduleName}`);
  const btn = document.querySelector(`.nav-btn[data-module="${moduleName}"]`);
  const nav = document.querySelector('.nav');
  const toolbar = document.querySelector('.toolbar');
  
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
  
  // 如果是创作工具，隐藏左侧导航和工具栏
  const creativeModules = ['script', 'mindmap', 'story', 'storyboard'];
  if (creativeModules.includes(moduleName)) {
    if (nav) nav.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
  }
  
  if (window.CollabStudio.modules[moduleName] && window.CollabStudio.modules[moduleName].openProject) {
    window.CollabStudio.modules[moduleName].openProject(p);
  }
}

// ─── 初始化 UI ──────────────────────────────────────────
function initUI() {
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchModule(btn.dataset.module);
    });
  });
  
  if (transferBtn) {
    transferBtn.addEventListener('click', doTransfer);
  }
  
  if (receiveOk) {
    receiveOk.addEventListener('click', () => {
      receiveModal.style.display = 'none';
    });
  }
  
  if (peerNoteSave) {
    peerNoteSave.addEventListener('click', () => {
      socket.emit('peer-note', { note: peerNoteInput.value });
    });
  }
  
  if (lanCb) {
    lanCb.addEventListener('change', (e) => {
      socket.emit('lan-toggle', e.target.checked);
      lanStatus.textContent = e.target.checked ? '🟢 局域网: 开启' : '🔴 局域网: 关闭';
    });
  }
  
  if (refreshLanBtn) {
    refreshLanBtn.addEventListener('click', () => {
      socket.emit('lan-scan');
    });
  }
  
  renderProjects();
}

// ─── 帮助按钮 ──────────────────────────────────────────
const helpBtn = document.getElementById('help-btn');
if (helpBtn) {
  helpBtn.addEventListener('click', function() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '400px';
    card.innerHTML = '<h3>帮助中心</h3>';
    card.innerHTML += '<p>新建文件夹：在项目页面创建文件夹容器</p>';
    card.innerHTML += '<p>双击文件夹：进入查看子项目</p>';
    card.innerHTML += '<p>面包屑导航：点击可返回上级</p>';
    card.innerHTML += '<p>文件夹内：可创建剧本、导图、故事、分镜</p>';
    var btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.style.width = '100%';
    btn.style.marginTop = '12px';
    btn.textContent = '知道了';
    btn.onclick = function() { overlay.remove(); };
    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}
