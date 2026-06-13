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

const socket = io();
CollabStudio.socket = socket;

// 持久身份 ID（localStorage，跨会话不变）
let myUserId = localStorage.getItem('collab-user-id');
if (!myUserId) {
  myUserId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  localStorage.setItem('collab-user-id', myUserId);
}

let serverId = '';
let serverName = '';
let projects = [];
let peers = [];         // 所有在线对等设备 [{ serverId, name, ip, port, connected, note }]

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
  // 给用户反馈
  const orig = input.placeholder;
  input.placeholder = '✅ 已发送';
  setTimeout(() => { input.placeholder = orig; }, 1500);
}

// 管理员的收件箱
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

// 显示/隐藏联系管理员和管理面板
function updateUIBasedOnRole() {
  const contactSection = document.getElementById('contact-admin-section');
  const adminNavBtn = document.getElementById('nav-admin-btn');
  if (contactSection) contactSection.style.display = isAdmin ? 'none' : 'block';
  if (adminNavBtn) adminNavBtn.style.display = isAdmin ? '' : 'none';
  // 更新自我标识上的角色图标
  if (selfBadge) {
    const roleLabel = isAdmin ? '👑' : (myRole === 'editor' ? '✏️' : (myRole === 'commenter' ? '💬' : '👁️'));
    selfBadge.textContent = `${roleLabel} ${myName}`;
  }
}

// ─── 浏览器指纹 ────────────────────────────────────────
const myFingerprint = window.CollabStudioFingerprint ? window.CollabStudioFingerprint() : '';

// ─── 入场 ────────────────────────────────────────────────

// 从 sessionStorage 读取登录凭证
let savedAuth = null;
try {
  const raw = sessionStorage.getItem('collab-auth');
  if (raw) savedAuth = JSON.parse(raw);
} catch(_) {}

if (!savedAuth || !savedAuth.name) {
  // 未登录，跳转到登录页
  window.location.href = '/';
}

let myName = savedAuth ? savedAuth.name : '';
let isAdmin = savedAuth ? savedAuth.isAdmin : false;
let myRole = savedAuth ? (savedAuth.role || (isAdmin ? 'editor' : 'commenter')) : 'commenter';
let myToken = savedAuth ? savedAuth.token : '';

// 连接后自动用已保存的身份重新登录
socket.on('connect', () => {
  if (myName) {
    socket.emit('join', { name: myName, token: myToken, fingerprint: myFingerprint });
  }
});

// 服务器验证结果

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
    // 数据在点击管理按钮时加载
  }
  
  // 绑定联系管理员事件
  const contactBtn = document.getElementById('contact-admin-btn');
  const contactInput = document.getElementById('contact-admin-input');
  if (contactBtn) contactBtn.onclick = sendToAdmin;
  if (contactInput) contactInput.onkeydown = (e) => { if (e.key === 'Enter') sendToAdmin(); };
  
  // 请求管理员统计
  if (isAdmin) {
    socket.emit('admin-get-stats');
  }
  
  // 请求密码重置审批列表
  if (isAdmin) {
    socket.emit('admin-list-resets');
  }
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
  // 更新 selfBadge 图标
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

socket.on('project-update-error', (msg) => {
  showAlert(msg, '权限不足', '🚫');
});

socket.on('project-deleted', (id) => {
  projects = projects.filter(p => p.id !== id);
  renderProjects();
});

function canDeleteProject(p) {
  return isAdmin;
}

socket.on('transfer-sent', (data) => {
  showAlert(`${data.count} 个项目已发送给 ${data.to}`, '发送成功', '✅');
});

socket.on('transfer-failed', (data) => {
  showAlert(`发送失败: ${data.reason}`, '发送失败', '❌');
});

socket.on('project-restored', (id) => {
  const p = projects.find(x => x.id === id);
  if (p) p.deleted = false;
  renderProjects();
});

socket.on('project-permanently-deleted', (id) => {
  projects = projects.filter(x => x.id !== id);
  renderProjects();
});

// ── 子项变更 ──
socket.on('project-item-added', ({ projectId, item }) => {
  const p = projects.find(x => x.id === projectId);
  if (p) {
    if (!p.data.items) p.data.items = [];
    p.data.items.push(item);
    p.updatedAt = Date.now();
  }
  if (currentDetailProject && currentDetailProject.id === projectId) {
    renderProjectDetail(currentDetailProject);
  }
  renderProjects();
});

socket.on('project-item-removed', ({ projectId, itemId }) => {
  const p = projects.find(x => x.id === projectId);
  if (p && p.data.items) {
    p.data.items = p.data.items.filter(it => it.id !== itemId);
    p.updatedAt = Date.now();
  }
  if (currentDetailProject && currentDetailProject.id === projectId) {
    renderProjectDetail(currentDetailProject);
  }
  renderProjects();
});

// ── 可见性变更 ──
socket.on('project-visibility-changed', ({ projectId, visibility }) => {
  const p = projects.find(x => x.id === projectId);
  if (p) p.visibility = visibility;
  renderProjects();
});

// ── 撤回/恢复结果 ──
socket.on('project-undo-result', (data) => {
  if (data.ok) showAlert('操作已撤回', '撤回成功', '↩️');
});
socket.on('project-redo-result', (data) => {
  if (data.ok) showAlert('操作已恢复', '恢复成功', '↪️');
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

// ── 在线用户 ──
socket.on('online-users', (list) => {
  onlineUsers = list;
  renderOnlineUsers();
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
    if (mod === 'mindmap') {
      setTimeout(() => {
        if (window.mmResize) window.mmResize();
        // 自动打开上次的导图（仅当导图面板未加载过项目时）
        const mmTitle = document.getElementById('mindmap-title');
        const hasLoaded = mmTitle && !mmTitle.textContent.includes('思维导图');
        if (!hasLoaded) {
          const lastId = localStorage.getItem('mm-last-id');
          let target = null;
          if (lastId) target = projects.find(p => p.id === lastId && p.type === 'mindmap');
          if (!target) target = (projects||[]).filter(p => p.type === 'mindmap').sort((a, b) => (b.updatedAt||0) - (a.updatedAt||0))[0];
          if (target) window.openMindMapEditor(target);
        }
      }, 100);
    }
    if (mod === 'devices') setTimeout(() => window.renderDevices && window.renderDevices(), 100);
    if (mod === 'admin') {
      if (window.setAnnotationDocument) window.setAnnotationDocument(null);
      socket.emit('admin-get-stats');
      socket.emit('admin-list-users');
    }
  });
});


function initUI() {
  if (projects.length === 0) {
    createDefaultProject('script', '未命名剧本');
    createDefaultProject('mindmap', '未命名导图');
    createDefaultProject('story', '未命名故事');
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
    case 'folder': return { children: [] };
    default: return {};
  }
}

function createDefaultProject(type, name) {
  socket.emit('project-create', { type, name, data: getDefaultData(type) });
}

// ─── 新建项目通用弹窗 ──────────────────────────────────
const createModal    = document.getElementById('create-modal');
const createIcon     = document.getElementById('create-icon');
const createTitle    = document.getElementById('create-title');
const createHint     = document.getElementById('create-hint');
const createInput    = document.getElementById('create-input');
const createConfirm  = document.getElementById('create-confirm');
const createCancel   = document.getElementById('create-cancel');
const createClose    = document.getElementById('create-close');

let createCallback = null; // 确认时调用的函数

function showCreateModal(opts) {
  // opts: { icon, title, hint, placeholder, defaultName, confirmText, callback(name) }
  createIcon.textContent    = opts.icon || '📄';
  createTitle.textContent   = opts.title || '新建项目';
  createHint.textContent    = opts.hint || '输入项目名称后点击确认。';
  createInput.placeholder   = opts.placeholder || '输入项目名称...';
  createInput.value         = opts.defaultName || '';
  createConfirm.textContent = opts.confirmText || '创建';
  createCallback            = opts.callback || null;
  createModal.style.display = 'flex';
  setTimeout(() => createInput.focus(), 100);
}

function closeCreateModal() {
  createModal.style.display = 'none';
  createCallback = null;
}

function confirmCreate() {
  const name = createInput.value.trim();
  const defaultName = createInput.placeholder.replace('输入', '').replace('名称...', '').trim() || '未命名';
  const finalName = name || defaultName;
  closeCreateModal();
  if (createCallback) createCallback(finalName);
}

createConfirm.addEventListener('click', confirmCreate);
createCancel.addEventListener('click', closeCreateModal);
createClose.addEventListener('click', closeCreateModal);
createModal.addEventListener('click', (e) => {
  if (e.target === createModal) closeCreateModal();
});
createInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreate();
  if (e.key === 'Escape') closeCreateModal();
});

// 新建项目按钮
$('#new-project-btn').addEventListener('click', () => {
  showCreateModal({
    icon: '📂', title: '新建项目', hint: '创建一个空白项目，可在项目中添加剧本、导图、故事等。',
    placeholder: '输入项目名称...', defaultName: '新项目',
    callback: (name) => {
      // 检查名称重复
      if (projects.some(p => p.name === name && !p.deleted)) {
        showAlert('项目名称已存在，请换一个', '提示', '⚠️');
        return;
      }
      socket.emit('project-create', { type: 'project', name, data: { items: [] } });
    },
  });
});

// ─── 项目详情按钮 ──────────────────────────────────────
function pdAddItem(type) {
  if (!currentDetailProject) return;
  showCreateModal({
    icon: {script:'📜',mindmap:'🧠',story:'📖',storyboard:'🎬'}[type] || '📄',
    title: '新建' + {script:'剧本',mindmap:'导图',story:'故事',storyboard:'分镜'}[type],
    hint: '输入名称后创建',
    placeholder: '输入名称...',
    defaultName: '新' + {script:'剧本',mindmap:'导图',story:'故事',storyboard:'分镜'}[type],
    callback: (name) => socket.emit('project-add-item', { projectId: currentDetailProject.id, itemType: type, itemName: name }),
  });
}
document.getElementById('pd-add-script')?.addEventListener('click', () => pdAddItem('script'));
document.getElementById('pd-add-mindmap')?.addEventListener('click', () => pdAddItem('mindmap'));
document.getElementById('pd-add-story')?.addEventListener('click', () => pdAddItem('story'));
document.getElementById('pd-add-storyboard')?.addEventListener('click', () => pdAddItem('storyboard'));

// ─── 回收站按钮 ─────────────────────────────────────────
$('#trash-btn').addEventListener('click', () => {
  showingTrash = !showingTrash;
  const btn = $('#trash-btn');
  if (showingTrash) {
    btn.textContent = '📂 项目';
    btn.style.borderColor = 'var(--accent)';
    document.querySelectorAll('#panel-projects .panel-actions > button:not(#trash-btn)').forEach(b => b.style.display = 'none');
  } else {
    btn.textContent = '🗑️';
    btn.style.borderColor = '';
    document.querySelectorAll('#panel-projects .panel-actions > button').forEach(b => b.style.display = '');
  }
  renderProjects();
});


let showingTrash = false;

function renderProjects() {
  projectList.innerHTML = '';

  const visibleProjects = showingTrash
    ? projects.filter(p => p.deleted)
    : projects.filter(p => !p.deleted && (isAdmin || p.owner === myName || (p.visibility && p.visibility !== 'private')));

  if (visibleProjects.length === 0) {
    projectList.innerHTML = showingTrash
      ? '<div class="editor-placeholder">回收站是空的</div>'
      : '<div class="editor-placeholder">暂无项目，点击上方按钮创建</div>';
    return;
  }

  const visIcons = { 'private': '🔒', 'public-read': '👁️', 'public-edit': '✏️' };
  const visLabels = { 'private': '私密', 'public-read': '公开-只读', 'public-edit': '公开-可编辑' };

  if (!showingTrash) {
    const folders = visibleProjects.filter(p => p.type === 'folder');
    const standalone = visibleProjects.filter(p => p.type !== 'folder' && !p.parentId);
    folders.forEach(f => {
      const card = document.createElement('div');
      card.className = 'project-card folder';
      const childCount = (f.data && f.data.children) ? f.data.children.length : 0;
      const canChange = isAdmin || f.owner === myName;
      const visOpts = ['private', 'public-read', 'public-edit'].map(v =>
        `<option value="${v}"${(f.visibility||'private') === v ? ' selected' : ''}>${visLabels[v]}</option>`
      ).join('');
      card.innerHTML = `
        <span class="p-type">📁</span>
        <button class="p-del" data-id="${f.id}">×</button>
        <div class="p-name">${esc(cleanProjectName(f.name))}</div>
        <div class="p-meta">文件夹 · ${childCount} 个项目 · ${timeAgo(f.updatedAt)}</div>
        <div class="p-owner">${esc(f.owner || '我')}</div>
      `;
      if (canDeleteProject(f)) {
        card.querySelector('.p-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await showConfirm(`删除文件夹「${f.name}」及其所有子项目？`, '删除确认', '🗑️')) {
            (f.data && f.data.children || []).forEach(cid => socket.emit('project-delete', cid));
            socket.emit('project-delete', f.id);
          }
        });
      } else { card.querySelector('.p-del').style.display = 'none'; }
      card.addEventListener('click', () => openProject(f));
      projectList.appendChild(card);
    });
    // 渲染独立项目
    standalone.forEach(p => {
      const icons = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁' };
      const names = { script: '剧本', mindmap: '思维导图', story: '故事', folder: '文件夹' };
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
      if (isAdmin) {
        card.querySelector('.p-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await showConfirm(`删除「${p.name}」？`, '删除确认', '🗑️')) socket.emit('project-delete', p.id);
        });
      } else {
        card.querySelector('.p-del').style.display = 'none';
      }
      card.addEventListener('click', () => openProject(p));
      // 可见性切换
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
    // 回收站视图
    visibleProjects.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    visibleProjects.forEach(p => {
      const icons = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁' };
      const names = { script: '剧本', mindmap: '思维导图', story: '故事', folder: '文件夹' };
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
        if (await showConfirm(`永久删除「${p.name}」？无法恢复！`, '永久删除', '⚠️')) {
          socket.emit('project-permanent-delete', p.id);
        }
      });
      projectList.appendChild(card);
    });
  }
  updateTransferList();
}

function openProject(p) {
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(pl => pl.classList.remove('active'));
  // 文件夹：展开显示子项目
  if (p.type === 'folder') {
    const panel = document.getElementById('panel-projects');
    panel.classList.add('active');
    document.querySelector(`.nav-btn[data-module="projects"]`).classList.add('active');
    // 高亮该文件夹的子项目
    const children = p.data && p.data.children || [];
    renderProjects();
    // 滚动到子项目并标记
    if (children.length > 0) {
      setTimeout(() => {
        const cards = projectList.querySelectorAll('.project-card');
        cards.forEach(c => {
          const nameEl = c.querySelector('.p-name');
          if (nameEl) {
            const child = projects.find(pp => children.includes(pp.id));
            if (child && nameEl.textContent.includes(cleanProjectName(child.name).slice(0, 6))) {
              c.style.borderColor = 'var(--accent)';
              c.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        });
      }, 100);
    }
    return;
  }
  const panel = document.getElementById(`panel-${p.type}`);
  if (panel) {
    panel.classList.add('active');
    const btn = document.querySelector(`.nav-btn[data-module="${p.type}"]`);
    if (btn) btn.classList.add('active');
  }
  if (p.type === 'project') {
    renderProjectDetail(p);
    return;
  }
  switch (p.type) {
    case 'script':  window.openScriptEditor(p); break;
    case 'mindmap': window.openMindMapEditor(p); break;
    case 'story':   window.openStoryEditor(p); break;
  }
}

let currentDetailProject = null;

function renderProjectDetail(p) {
  currentDetailProject = p;
  document.getElementById('project-detail-title').textContent = `📂 ${esc(p.name)}`;
  
  const visIcons = { 'private': '🔒', 'public-read': '👁️', 'public-edit': '✏️' };
  const visLabels = { 'private': '私密', 'public-read': '公开-只读', 'public-edit': '公开-可编辑' };
  const vis = p.visibility || 'private';
  document.getElementById('pd-visibility').innerHTML = `${visIcons[vis]} ${visLabels[vis]}`;
  document.getElementById('pd-owner').textContent = `创建者: ${p.owner || '未知'}`;
  document.getElementById('pd-created').textContent = `创建于 ${new Date(p.createdAt).toLocaleString('zh-CN')}`;

  const items = p.data && p.data.items ? p.data.items : [];
  const container = document.getElementById('pd-items');
  const empty = document.getElementById('pd-empty');
  
  container.innerHTML = '';
  if (items.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  
  const itemIcons = { script: '📜', mindmap: '🧠', story: '📖', storyboard: '🎬' };
  const itemNames = { script: '剧本', mindmap: '导图', story: '故事', storyboard: '分镜' };
  
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <span class="p-type">${itemIcons[item.type] || '📄'}</span>
      <button class="p-del" data-project="${p.id}" data-item="${item.id}">×</button>
      <div class="p-name">${esc(item.name)}</div>
      <div class="p-meta">${itemNames[item.type] || item.type}</div>
    `;
    card.addEventListener('click', () => openProjectItem(p, item));
    card.querySelector('.p-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await showConfirm(`删除「${item.name}」？`, '删除确认', '🗑️')) {
        socket.emit('project-remove-item', { projectId: p.id, itemId: item.id });
      }
    });
    container.appendChild(card);
  });
}

function openProjectItem(project, item) {
  navBtns.forEach(b => b.classList.remove('active'));
  panels.forEach(pl => pl.classList.remove('active'));
  const panel = document.getElementById(`panel-${item.type}`);
  if (panel) {
    panel.classList.add('active');
    if (item.type === 'storyboard') {
      // 分镜特殊处理
      document.getElementById('nav-storyboard').classList.add('active');
      const frame = document.querySelector('#storyboard-frame iframe');
      if (frame) {
        const src = frame.src;
        frame.src = '';
        setTimeout(() => { frame.src = src; }, 50);
      }
    }
  }
  // 把 item 包装成编辑器可识别的格式
  const fakeProject = {
    id: item.id,
    type: item.type,
    name: item.name,
    data: item.data || {},
    parentProject: project,
  };
  switch (item.type) {
    case 'script':  window.openScriptEditor(fakeProject); break;
    case 'mindmap': window.openMindMapEditor(fakeProject); break;
    case 'story':   window.openStoryEditor(fakeProject); break;
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

// ─── 管理员登录 ────────────────────────────────────────
document.getElementById('admin-login-btn').addEventListener('click', () => {
  if (isAdmin) { showAlert('你已是管理员', '提示', '👑'); return; }
  sessionStorage.removeItem('collab-auth');
  window.location.href = '/';
});

// ─── 多设备 UI ──────────────────────────────────────────
function updatePeersUI() {
  if (peers.length > 0) {
    let html = '';
    peers.forEach(p => {
      if (!p.connected && !p.reconnecting) return; // 已彻底离线的不显示
      const statusIcon = p.reconnecting ? '🔄' : (p.connected ? '🟢' : '🔴');
      const statusText = p.reconnecting ? '重连中...' : '';
      const noteHtml = p.note ? `<br><small>📝 ${esc(p.note)}</small>` : '';
      html += `<div style="margin-bottom:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div class="peer-name">${statusIcon} ${esc(p.name)} ${statusText}</div>
        <div class="d-meta">IP: ${p.ip} · ID: ${p.serverId}</div>
        ${noteHtml}
      </div>`;
    });
    const onlineCount = peers.filter(p => p.connected).length;
    const reconnectingCount = peers.filter(p => p.reconnecting).length;
    const statusLine = onlineCount > 0
      ? `🟢 ${onlineCount} 台设备在线${reconnectingCount > 0 ? ` · 🔄 ${reconnectingCount} 重连中` : ''}`
      : `🔄 ${reconnectingCount} 台设备重连中...`;
    peerStatusArea.innerHTML = `<div class="status-connected">${statusLine}</div>${html}`;
    peerBadge.style.display = 'inline';
    peerBadge.className = onlineCount > 0 ? 'badge online' : 'badge';
    peerBadge.textContent = onlineCount > 0 ? `🤝 ${onlineCount} 在线` : '🔄 重连中';
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
    const icons = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁' };
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

transferBtn.addEventListener('click', async () => {
  const checked = document.querySelectorAll('.transfer-cb:checked');
  if (checked.length === 0) return;
  const ids = Array.from(checked).map(cb => cb.value);
  const target = document.getElementById('transfer-target');
  const targetServerId = target ? target.value : (peers[0] ? peers[0].serverId : null);
  if (!targetServerId) return showAlert('没有可发送的目标', '提示', '⚠️');
  const targetName = peers.find(p => p.serverId === targetServerId)?.name || '对方';
  if (await showConfirm(`发送 ${ids.length} 个项目给 ${targetName}？`, '发送确认', '📤')) {
    socket.emit('project-transfer', { ids, targetServerId });
  }
});

// ─── 接收弹窗 ────────────────────────────────────────────
function showReceiveModal(msg) {
  receiveInfo.textContent = `${esc(msg.from)} 给你发了 ${msg.projects.length} 个项目：`;
  receiveList.innerHTML = '';
  msg.projects.forEach(p => {
    const icons = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁' };
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
function cleanProjectName(name) {
  return (name || '').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2702}-\u{27B0}\s]+/u, '');
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

// ─── 自定义 alert ────────────────────────────────────────
const alertModal    = document.getElementById('alert-modal');
const alertIcon     = document.getElementById('alert-icon');
const alertTitle    = document.getElementById('alert-title');
const alertText     = document.getElementById('alert-text');
const alertOk       = document.getElementById('alert-ok');

function showAlert(text, title, icon) {
  alertTitle.textContent  = title || '提示';
  alertIcon.textContent   = icon || 'ℹ️';
  alertText.textContent   = text;
  alertModal.style.display = 'flex';
  // 点击外部关闭
  alertModal.onclick = (e) => {
    if (e.target === alertModal) alertModal.style.display = 'none';
  };
}

alertOk.addEventListener('click', () => {
  alertModal.style.display = 'none';
});

// ─── 自定义 confirm ──────────────────────────────────────
const confirmModal   = document.getElementById('confirm-modal');
const confirmIcon    = document.getElementById('confirm-icon');
const confirmTitle   = document.getElementById('confirm-title');
const confirmText    = document.getElementById('confirm-text');
const confirmOk      = document.getElementById('confirm-ok');
const confirmCancel  = document.getElementById('confirm-cancel');

function showConfirm(text, title, icon) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title || '确认操作';
    confirmIcon.textContent  = icon || '❓';
    confirmText.textContent  = text;
    confirmModal.style.display = 'flex';

    const cleanup = () => {
      confirmModal.style.display = 'none';
      confirmOk.onclick = null;
      confirmCancel.onclick = null;
      confirmModal.onclick = null;
    };

    confirmOk.onclick = () => { cleanup(); resolve(true); };
    confirmCancel.onclick = () => { cleanup(); resolve(false); };
    confirmModal.onclick = (e) => {
      if (e.target === confirmModal) { cleanup(); resolve(false); }
    };
  });
}

// ─── 管理员免密登录失败 → 内联密码输入 ────────────────────
function showAdminPasswordPrompt() {
  const modal = document.getElementById('admin-pwd-modal');
  const input = document.getElementById('admin-pwd-input');
  const error = document.getElementById('admin-pwd-error');
  if (!modal || !input) return;

  modal.style.display = 'flex';
  input.value = '';
  error.style.display = 'none';
  setTimeout(() => input.focus(), 200);

  const confirmBtn = document.getElementById('admin-pwd-confirm');
  const cancelBtn = document.getElementById('admin-pwd-cancel');

  const doLogin = () => {
    const pwd = input.value.trim();
    if (!pwd) {
      error.textContent = '请输入密码';
      error.style.display = 'block';
      return;
    }
    error.style.display = 'none';
    socket.emit('join', { name: myName, password: pwd, fingerprint: myFingerprint });
    modal.style.display = 'none';
  };

  confirmBtn.onclick = doLogin;
  cancelBtn.onclick = () => {
    modal.style.display = 'none';
    sessionStorage.removeItem('collab-auth');
    window.location.href = '/';
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  modal.onclick = (e) => { if (e.target === modal) { modal.style.display = 'none'; } };
}

// ─── 模块注册 ────────────────────────────────────────────
// 各编辑器模块在加载时将自己注册到 CollabStudio.modules
// 格式: { name, open, save, getData, setData }
window.registerCollabModule = function(name, api) {
  CollabStudio.modules[name] = api;
};

function renderAdminPanel() {
  const container = document.getElementById('admin-panel');
  if (!container) return;
  container.style.display = 'block';
  
  // 请求用户列表
  socket.emit('admin-list-users');
  
  // 刷新按钮
  const refreshBtn = container.querySelector('#admin-refresh-btn');
  if (refreshBtn) {
    refreshBtn.onclick = () => socket.emit('admin-list-users');
  }
}

socket.on('admin-users-list', (list) => {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  list.forEach(u => {
    if (u.isAdmin) return; // 不显示管理员自己
    const roleOptions = ['editor', 'commenter', 'viewer'].map(r =>
      `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`
    ).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(u.name)}</td>
      <td>${u.isBanned ? '🚫 已拉黑' : '✅ 正常'}</td>
      <td><select class="admin-role-select" data-name="${esc(u.name)}" style="padding:1px 4px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text);font-size:11px;outline:none">${roleOptions}</select></td>
      <td><code style="font-size:11px;color:var(--text-dim)">${esc(u.fingerprint || '—')}</code></td>
      <td>
        <input type="password" class="admin-new-pwd" data-name="${esc(u.name)}" placeholder="新密码" style="width:80px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text);font-size:11px;outline:none">
        <button class="admin-pwd-btn" data-name="${esc(u.name)}" style="padding:2px 6px;font-size:11px">修改</button>
      </td>
      <td>
        ${u.isBanned
          ? `<button class="admin-unban-btn" data-name="${esc(u.name)}" style="padding:2px 6px;font-size:11px;background:var(--green);border:none;border-radius:3px;color:#000;cursor:pointer">解禁</button>`
          : `<button class="admin-ban-btn" data-name="${esc(u.name)}" data-fp="${esc(u.fingerprint || '')}" style="padding:2px 6px;font-size:11px;background:var(--danger);border:none;border-radius:3px;color:#fff;cursor:pointer">拉黑</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // 角色变更
  tbody.querySelectorAll('.admin-role-select').forEach(sel => {
    sel.onchange = async () => {
      const name = sel.dataset.name;
      const role = sel.value;
      if (!await showConfirm(`将 ${name} 的角色设为 "${role}"？`, '修改角色', '🎭')) { return; }
      socket.emit('admin-set-role', { targetName: name, role });
    };
  });
  
  // 修改密码
  tbody.querySelectorAll('.admin-pwd-btn').forEach(btn => {
    btn.onclick = async () => {
      const inp = btn.parentElement.querySelector('.admin-new-pwd');
      const pwd = inp.value.trim();
      if (!pwd) return;
      if (!await showConfirm(`将 ${btn.dataset.name} 的密码改为 "${pwd}"？`, '修改密码', '🔑')) return;
      socket.emit('admin-change-password', { targetName: btn.dataset.name, newPassword: pwd });
      inp.value = '';
    };
  });
  
  // 拉黑
  tbody.querySelectorAll('.admin-ban-btn').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.name;
      const fp = btn.dataset.fp;
      if (!await showConfirm(`拉黑 ${name}？${fp ? '（同时拉黑该设备所有账号）' : ''}`, '拉黑确认', '🚫')) return;
      socket.emit('admin-ban-user', { targetName: name, fingerprint: fp || undefined });
    };
  });
  
  // 解禁
  tbody.querySelectorAll('.admin-unban-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!await showConfirm(`解禁 ${btn.dataset.name}？`, '解禁确认', '✅')) return;
      socket.emit('admin-unban-user', { targetName: btn.dataset.name });
    };
  });
});

// ─── 活动日志 ────────────────────────────────────────────
function renderActivityLog() {
  const container = document.getElementById('activity-log');
  if (!container) return;
  container.innerHTML = '';
  const logs = [...operationLog].reverse();
  if (logs.length === 0) {
    container.innerHTML = '<div class="editor-placeholder">暂无操作记录</div>';
    return;
  }
  logs.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const icons = { joined: '🟢', left: '🔴', created: '📄', updated: '✏️', deleted: '🗑️', sent: '📤', received: '📥' };
    const icon = icons[entry.action] || '•';
    div.innerHTML = `<span class="log-time">${time}</span> <span class="log-user">${esc(entry.userName)}</span> ${icon} ${esc(formatLog(entry))}`;
    container.appendChild(div);
  });
}
function formatLog(entry) {
  const mi = { script: '📜', mindmap: '🧠', story: '📖', folder: '📁', system: '⚙️' };
  const m = mi[entry.module] || '';
  switch (entry.action) {
    case 'joined': return '加入了协作';
    case 'left':   return '离开了协作';
    case 'created': return `${m} 创建了 ${entry.target}`;
    case 'updated': return `${m} 修改了 ${entry.target}`;
    case 'deleted': return `${m} 删除了 ${entry.target}`;
    case 'sent':    return `📤 发送了项目给 ${entry.target}`;
    case 'received':return `📥 收到了来自 ${entry.target} 的项目`;
    default: return `${m} ${entry.action} ${entry.target}`;
  }
}
window.addEventListener('log-entry', () => {
  const p = document.getElementById('panel-activity');
  if (p && p.classList.contains('active')) renderActivityLog();
});
document.querySelector('.nav-btn[data-module="activity"]').addEventListener('click', () => {
  setTimeout(renderActivityLog, 100);
});
document.getElementById('log-clear-btn').addEventListener('click', () => {
  operationLog = []; renderActivityLog();
});

// ─── 返回项目列表 ────────────────────────────────────────
document.querySelectorAll('#script-back, #mindmap-back, #story-back, #sb-back, #admin-back, #pd-back').forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    document.querySelector('.nav-btn[data-module="projects"]').classList.add('active');
    document.getElementById('panel-projects').classList.add('active');
    renderProjects();
    // 清除上下文
    currentDetailProject = null;
    if (window.setAnnotationDocument) window.setAnnotationDocument(null);
  });
});

socket.on('admin-stats', (stats) => {
  document.getElementById('ctl-users').textContent = stats.onlineUsers || 0;
  document.getElementById('ctl-peers').textContent = stats.peers || 0;
  document.getElementById('ctl-projects').textContent = stats.projects || 0;
  document.getElementById('ctl-logs').textContent = stats.logCount || 0;
});

// 管理员收到密码重置申请
socket.on('admin-reset-request', (req) => {
  const container = document.getElementById('admin-resets');
  const list = document.getElementById('admin-resets-list');
  if (!container || !list) return;
  container.style.display = 'block';
  const div = document.createElement('div');
  div.className = 'approve-item';
  div.innerHTML = `
    <span class="ai-name">${esc(req.name)}</span>
    <span class="ai-text">请求重置密码: ${esc(req.reason)}</span>
    <button class="ai-approve" data-id="${req.id}" data-name="${esc(req.name)}" data-pwd="${esc(req.newPassword)}">批准</button>
    <button class="ai-reject" data-id="${req.id}" data-name="${esc(req.name)}">拒绝</button>
  `;
  list.appendChild(div);
  div.querySelector('.ai-approve').addEventListener('click', () => {
    socket.emit('admin-approve-reset', { requestId: req.id, name: req.name, newPassword: req.newPassword, approve: true });
    div.remove();
    if (list.children.length === 0) container.style.display = 'none';
  });
  div.querySelector('.ai-reject').addEventListener('click', () => {
    socket.emit('admin-approve-reset', { requestId: req.id, name: req.name, approve: false });
    div.remove();
    if (list.children.length === 0) container.style.display = 'none';
  });
});

// 管理员批量接收重置申请列表
socket.on('admin-resets-list', (requests) => {
  const container = document.getElementById('admin-resets');
  const list = document.getElementById('admin-resets-list');
  if (!container || !list) return;
  list.innerHTML = '';
  if (!requests || requests.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  requests.forEach(req => {
    const div = document.createElement('div');
    div.className = 'approve-item';
    div.innerHTML = `
      <span class="ai-name">${esc(req.name)}</span>
      <span class="ai-text">请求重置密码: ${esc(req.reason)}</span>
      <button class="ai-approve" data-id="${req.id}" data-name="${esc(req.name)}" data-pwd="${esc(req.newPassword)}">批准</button>
      <button class="ai-reject" data-id="${req.id}" data-name="${esc(req.name)}">拒绝</button>
    `;
    list.appendChild(div);
    div.querySelector('.ai-approve').addEventListener('click', () => {
      socket.emit('admin-approve-reset', { requestId: req.id, name: req.name, newPassword: req.newPassword, approve: true });
      div.remove();
      if (list.children.length === 0) container.style.display = 'none';
    });
    div.querySelector('.ai-reject').addEventListener('click', () => {
      socket.emit('admin-approve-reset', { requestId: req.id, name: req.name, approve: false });
      div.remove();
      if (list.children.length === 0) container.style.display = 'none';
    });
  });
});

// ─── 私聊系统 ──────────────────────────────────────────
const chatModal = document.getElementById('chat-modal');
const chatModalTitle = document.getElementById('chat-modal-title');
const chatMsgs = document.getElementById('chat-msgs');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
let chatTargetUser = null;
let chatPartnerName = '';
let hasMsgPermit = false; // 是否有发消息权限
let msgPermitRequested = false;

// 关闭私聊
document.getElementById('chat-modal-close').addEventListener('click', () => {
  chatModal.style.display = 'none';
});

// 点击在线用户 → 打开私聊
function renderOnlineUsers() {
  const container = document.getElementById('online-users-area');
  if (!container) return;
  
  const count = onlineUsers.length;
  const badge = document.getElementById('online-badge');
  if (badge) {
    if (count > 0) {
      badge.style.display = 'inline';
      badge.className = 'badge online';
      badge.textContent = `👥 ${count} 人在线`;
    } else {
      badge.style.display = 'none';
    }
  }
  
  if (count === 0) {
    container.innerHTML = '<div class="status-none">⏳ 等待其他人加入…</div>';
    return;
  }
  
  let html = '';
  onlineUsers.forEach(u => {
    const isMe = u.name === myName;
    const isAdminUser = u.isAdmin;
    let icon, label;
    if (isMe && isAdminUser) { icon = '👑'; label = `${esc(u.name)} (管理员/我)`; }
    else if (isMe)           { icon = '⭐'; label = `${esc(u.name)} (我)`; }
    else if (isAdminUser)    { icon = '👑'; label = `${esc(u.name)} (管理员)`; }
    else                     { icon = '🟢'; label = esc(u.name); }
    const chatBtn = isMe ? '' : `<button class="chat-start-btn" data-name="${esc(u.name)}" style="margin-left:auto;padding:1px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text-dim);cursor:pointer;font-size:11px">💬</button>`;
    html += `<div class="online-user-item">
      <span class="online-user-dot">${icon}</span>
      <span class="online-user-name">${label}</span>
      ${chatBtn}
    </div>`;
  });
  container.innerHTML = html;
  
  // 绑定私聊按钮
  container.querySelectorAll('.chat-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetName = btn.dataset.name;
      openChat(targetName);
    });
  });
}

function openChat(targetName) {
  chatTargetUser = onlineUsers.find(u => u.name === targetName);
  chatPartnerName = targetName;
  chatModalTitle.textContent = `💬 与 ${esc(targetName)} 聊天`;
  chatMsgs.innerHTML = '';
  
  // 检查是否是管理员（管理员不需要权限）
  if (isAdmin) {
    hasMsgPermit = true;
    chatSendBtn.disabled = false;
  } else {
    // 非管理员需要权限
    checkMsgPermission(targetName);
  }
  
  chatInput.value = '';
  chatModal.style.display = 'flex';
  setTimeout(() => chatInput.focus(), 200);
}

function checkMsgPermission(targetName) {
  // 检查是否有缓存权限
  const permitKey = `msg-permit-${targetName}`;
  const cached = sessionStorage.getItem(permitKey);
  if (cached === 'true') {
    hasMsgPermit = true;
    chatSendBtn.disabled = false;
    return;
  }
  
  // 请求服务器检查权限
  socket.emit('check-message-permission', { target: targetName });
}

socket.on('message-permission-status', ({ target, permitted }) => {
  if (target !== chatPartnerName) return;
  hasMsgPermit = permitted;
  chatSendBtn.disabled = !permitted;
  if (!permitted && !msgPermitRequested) {
    // 显示提示，并自动请求
    const hint = document.createElement('div');
    hint.className = 'chat-msg system';
    hint.textContent = '⏳ 需要管理员批准才能发送消息，正在请求权限…';
    chatMsgs.appendChild(hint);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    msgPermitRequested = true;
    socket.emit('request-message-permission', { target });
  }
});

socket.on('message-permission-granted', ({ target }) => {
  if (target !== chatPartnerName && target !== myName) return;
  hasMsgPermit = true;
  chatSendBtn.disabled = false;
  const permitKey = `msg-permit-${chatPartnerName}`;
  sessionStorage.setItem(permitKey, 'true');
  const hint = document.createElement('div');
  hint.className = 'chat-msg system';
  hint.textContent = '✅ 管理员已批准消息权限，现在可以发送消息了';
  chatMsgs.appendChild(hint);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
});

socket.on('message-permission-denied', ({ target }) => {
  if (target !== chatPartnerName) return;
  hasMsgPermit = false;
  chatSendBtn.disabled = true;
  msgPermitRequested = false;
  const hint = document.createElement('div');
  hint.className = 'chat-msg system';
  hint.textContent = '❌ 管理员拒绝了消息权限申请';
  chatMsgs.appendChild(hint);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
});

// 发送私聊消息
function sendChatMsg() {
  const text = chatInput.value.trim();
  if (!text || !chatTargetUser) return;
  if (!hasMsgPermit && !isAdmin) {
    showAlert('需要管理员批准才能发送消息', '提示', '⚠️');
    return;
  }
  chatInput.value = '';
  
  // 本地显示
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="cm-from">我</span> <span class="cm-text">${esc(text)}</span> <span class="cm-time">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>`;
  chatMsgs.appendChild(div);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  
  // 通过服务器转发
  socket.emit('user-message-to-user', { target: chatPartnerName, text });
}

chatSendBtn.addEventListener('click', sendChatMsg);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMsg(); });

// 收到私聊消息
socket.on('user-incoming-msg', (msg) => {
  const from = msg.from;
  
  // 如果聊天窗口已打开且是对应人，直接显示
  if (chatModal.style.display === 'flex' && chatPartnerName === from) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="cm-from">${esc(from)}</span> <span class="cm-text">${esc(msg.text)}</span> <span class="cm-time">${new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  } else {
    // 否则显示通知
    showAlert(`来自 ${esc(from)} 的消息: ${esc(msg.text)}`, '新消息', '💬');
  }
});

// ─── 管理员审批消息权限 ──────────────────────────────
socket.on('admin-permission-request', ({ from, target }) => {
  if (!isAdmin) return;
  showConfirm(
    `用户 ${esc(from)} 请求向 ${esc(target)} 发送消息，是否批准？`,
    '消息权限申请',
    '💬'
  ).then(approved => {
    socket.emit('admin-approve-permission', { from, target, approve: approved });
  });
});

// ═══════════════════════════════════════════════════════════
// ─── 批注系统 ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

let currentAnnotationDocId = null;
let currentAnnotations = [];

window.setAnnotationDocument = function(documentId) {
  currentAnnotationDocId = documentId;
  if (documentId) {
    socket.emit('annotation-list', { documentId });
  } else {
    currentAnnotations = [];
    renderAnnotationList();
  }
};

socket.on('annotation-list-result', ({ documentId, annotations }) => {
  if (documentId !== currentAnnotationDocId) return;
  currentAnnotations = annotations || [];
  renderAnnotationList();
});

socket.on('annotation-created', (ann) => {
  if (ann.documentId === currentAnnotationDocId) {
    currentAnnotations.push(ann);
    renderAnnotationList();
  }
});

socket.on('annotation-replied', ({ annotationId, reply }) => {
  const ann = currentAnnotations.find(a => a.id === annotationId);
  if (ann) {
    ann.replyThread.push(reply);
    ann.updatedAt = Date.now();
    renderAnnotationList();
  }
});

socket.on('annotation-status-updated', ({ annotationId, status }) => {
  const ann = currentAnnotations.find(a => a.id === annotationId);
  if (ann) {
    ann.status = status;
    renderAnnotationList();
  }
});

socket.on('annotation-deleted', ({ annotationId }) => {
  currentAnnotations = currentAnnotations.filter(a => a.id !== annotationId);
  renderAnnotationList();
});

function renderAnnotationList() {
  const container = document.getElementById('annotation-list');
  const emptyEl = document.getElementById('annotation-empty');
  const countEl = document.getElementById('annotation-count');
  if (!container) return;

  const filter = document.getElementById('annotation-filter-select');
  const filterVal = filter ? filter.value : 'all';

  let filtered = currentAnnotations;
  if (filterVal !== 'all') {
    filtered = currentAnnotations.filter(a => a.status === filterVal);
  }
  filtered = [...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (countEl) {
    const openCount = currentAnnotations.filter(a => a.status === 'open' || a.status === 'pending').length;
    countEl.textContent = openCount > 0 ? '(' + openCount + ' 未解决)' : '';
  }

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  container.innerHTML = filtered.map(ann => {
    const statusIcons = { open: '\ud83d\udfe1', resolved: '\u2705', rejected: '\u274c', pending: '\u23f3' };
    const statusLabels = { open: '未解决', resolved: '已解决', rejected: '已拒绝', pending: '待讨论' };
    const time = new Date(ann.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const replies = (ann.replyThread || []).map(r =>
      '<div class="ann-reply"><span class="ann-reply-author">' + esc(r.userId) + '</span> ' + esc(r.text) + ' <span class="ann-reply-time">' + new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</span></div>'
    ).join('');

    const canModify = isAdmin || ann.userId === myName;
    const anchorHtml = ann.anchor && ann.anchor.text
      ? '<div class="ann-anchor">📎 "' + esc(ann.anchor.text.slice(0, 40)) + (ann.anchor.text.length > 40 ? '…' : '') + '"</div>'
      : '';

    let actionsHtml = '<input type="text" class="ann-reply-input" data-id="' + ann.id + '" placeholder="回复..." maxlength="500">'
      + '<button class="ann-reply-btn" data-id="' + ann.id + '" style="padding:1px 6px;font-size:11px">回复</button>';
    if (canModify) {
      const opts = ['open', 'resolved', 'rejected', 'pending'].map(v =>
        '<option value="' + v + '"' + (ann.status === v ? ' selected' : '') + '>' + statusLabels[v] + '</option>'
      ).join('');
      actionsHtml += '<select class="ann-status-select" data-id="' + ann.id + '" style="padding:1px 4px;font-size:10px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text)">' + opts + '</select>'
        + '<button class="ann-delete-btn" data-id="' + ann.id + '" style="padding:1px 6px;font-size:11px;color:var(--danger)">✕</button>';
    }

    return '<div class="ann-card" data-id="' + ann.id + '">'
      + '<div class="ann-header"><span class="ann-author">' + esc(ann.userId) + '</span>'
      + '<span class="ann-status" style="font-size:11px">' + (statusIcons[ann.status] || '🟡') + ' ' + (statusLabels[ann.status] || ann.status) + '</span>'
      + '<span class="ann-time">' + time + '</span></div>'
      + '<div class="ann-text">' + esc(ann.content.text) + '</div>'
      + anchorHtml
      + '<div class="ann-replies">' + replies + '</div>'
      + '<div class="ann-actions">' + actionsHtml + '</div>'
      + '</div>';
  }).join('');

  // 回复
  container.querySelectorAll('.ann-reply-btn').forEach(btn => {
    btn.onclick = function() {
      const input = this.parentElement.querySelector('.ann-reply-input');
      const text = input.value.trim();
      if (!text) return;
      socket.emit('annotation-reply', { annotationId: this.dataset.id, text: text });
      input.value = '';
    };
  });
  container.querySelectorAll('.ann-reply-input').forEach(inp => {
    inp.onkeydown = function(e) {
      if (e.key === 'Enter') {
        const btn = this.parentElement.querySelector('.ann-reply-btn');
        if (btn) btn.click();
      }
    };
  });

  // 状态变更
  container.querySelectorAll('.ann-status-select').forEach(sel => {
    sel.onchange = function() {
      socket.emit('annotation-update-status', { annotationId: this.dataset.id, status: this.value });
    };
  });

  // 删除
  container.querySelectorAll('.ann-delete-btn').forEach(btn => {
    btn.onclick = async function() {
      if (await showConfirm('确定删除此批注？', '删除批注', '🗑️')) {
        socket.emit('annotation-delete', { annotationId: this.dataset.id });
      }
    };
  });
}

document.addEventListener('DOMContentLoaded', function() {
  const filterSel = document.getElementById('annotation-filter-select');
  if (filterSel) {
    filterSel.onchange = renderAnnotationList;
  }
});

// ─── 批注创建逻辑 ─────────────────────────────────────────

let annSelectedText = ''; // 当前选中的文本
let annDocumentId = '';   // 当前文档 ID

// 脚本编辑器批注按钮
document.getElementById('script-add-annotation')?.addEventListener('click', function() {
  if (!currentAnnotationDocId) {
    showAlert('请先打开一个剧本项目', '提示', '📜');
    return;
  }
  annDocumentId = currentAnnotationDocId;
  showAnnotationCreateModal();
});

// 故事编辑器批注按钮
document.getElementById('story-add-annotation')?.addEventListener('click', function() {
  if (!currentAnnotationDocId) {
    showAlert('请先打开一个故事项目', '提示', '📖');
    return;
  }
  annDocumentId = currentAnnotationDocId;
  showAnnotationCreateModal();
});

function showAnnotationCreateModal() {
  // 获取用户选中的文本
  const sel = window.getSelection();
  annSelectedText = sel ? sel.toString().trim() : '';

  // 尝试获取实际选择范围偏移
  let startOffset = 0, endOffset = annSelectedText.length;
  try {
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      startOffset = range.startOffset;
      endOffset = range.endOffset;
    }
  } catch(_) {}

  const selDisplay = document.getElementById('ann-selected-text');
  if (selDisplay) {
    selDisplay.textContent = annSelectedText || '(未选中文本 - 批注将作为全局评论)';
    selDisplay.style.color = annSelectedText ? 'var(--text)' : 'var(--text-dim)';
  }

  const input = document.getElementById('ann-create-input');
  if (input) input.value = '';

  document.getElementById('annotation-create-modal').style.display = 'flex';
  setTimeout(() => { if (input) input.focus(); }, 200);
}

function closeAnnotationCreateModal() {
  document.getElementById('annotation-create-modal').style.display = 'none';
}

document.getElementById('ann-create-close')?.addEventListener('click', closeAnnotationCreateModal);
document.getElementById('ann-create-cancel')?.addEventListener('click', closeAnnotationCreateModal);
document.getElementById('ann-create-confirm')?.addEventListener('click', function() {
  const input = document.getElementById('ann-create-input');
  const text = input ? input.value.trim() : '';
  if (!text) {
    showAlert('请输入批注内容', '提示', '💬');
    return;
  }

  const anchor = annSelectedText ? {
    type: 'text-range',
    startOffset: startOffset,
    endOffset: endOffset,
    text: annSelectedText
  } : { type: 'text-range', startOffset: 0, endOffset: 0, text: '' };

  socket.emit('annotation-create', {
    documentId: annDocumentId,
    anchor: anchor,
    content: { text, attachments: [] }
  });

  closeAnnotationCreateModal();
  showAlert('批注已添加', '成功', '✅');
});

// 点击模态框外部关闭
document.getElementById('annotation-create-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeAnnotationCreateModal();
});

// ─── 全局快捷键：撤回/恢复 ───────────────────────────────
document.addEventListener('keydown', function(e) {
  // Ctrl+Z 撤回
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    const activePanel = document.querySelector('.module-panel.active');
    if (!activePanel) return;
    // 找当前打开的项目 ID
    const projectId = currentAnnotationDocId;
    if (!projectId) return;
    socket.emit('project-undo', { projectId });
  }
  // Ctrl+Shift+Z 恢复
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    const projectId = currentAnnotationDocId;
    if (!projectId) return;
    socket.emit('project-redo', { projectId });
  }
});

// ─── 撤回/恢复按钮 ─────────────────────────────────────
document.getElementById('script-undo-btn')?.addEventListener('click', () => {
  if (currentAnnotationDocId) socket.emit('project-undo', { projectId: currentAnnotationDocId });
});
document.getElementById('script-redo-btn')?.addEventListener('click', () => {
  if (currentAnnotationDocId) socket.emit('project-redo', { projectId: currentAnnotationDocId });
});
document.getElementById('story-undo-btn')?.addEventListener('click', () => {
  if (currentAnnotationDocId) socket.emit('project-undo', { projectId: currentAnnotationDocId });
});
document.getElementById('story-redo-btn')?.addEventListener('click', () => {
  if (currentAnnotationDocId) socket.emit('project-redo', { projectId: currentAnnotationDocId });
});
