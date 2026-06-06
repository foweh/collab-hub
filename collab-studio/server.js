// ─── 多机协作创作工作室 服务端 ──────────────────────────
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { io: SocketIOClient } = require('socket.io-client');
const { v4: uuid } = require('uuid');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { ensureDataDir, loadJSON, saveJSON, DATA_DIR } = require('./utils/persist');
const { checkRateLimit } = require('./utils/ratelimit');

const SALT_ROUNDS = 10;

// ─── 文件路径 ────────────────────────────────────────────
ensureDataDir();
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FENJING_FILE = path.join(DATA_DIR, 'fenjing-state.json');
const PWD_RESETS_FILE = path.join(DATA_DIR, 'password-resets.json');
const MSG_PERM_FILE = path.join(DATA_DIR, 'message-permissions.json');
const ANNOTATIONS_FILE = path.join(DATA_DIR, 'annotations.json');
const LOG_FILE = path.join(DATA_DIR, 'operation-log.json');

// ─── 配置 & CLI ─────────────────────────────────────────
let HTTP_PORT = parseInt(process.env.PORT) || 3000;
const UDP_PORT = 41234;
const SCAN_DURATION = 5 * 60 * 1000;

const args = process.argv.slice(2);
let JOIN_TARGET = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port'  && args[i+1]) { HTTP_PORT = parseInt(args[i+1]); i++; }
  if (args[i] === '--join'  && args[i+1]) { JOIN_TARGET = args[i+1]; i++; }
}

const SERVER_ID = uuid().slice(0, 8);
let SERVER_NAME = os.hostname();

// ─── 用户管理 ────────────────────────────────────────────
let users = loadJSON(USERS_FILE, {});

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function ensureAdminAccount() {
  if (users['热合曼']) {
    const ex = users['热合曼'];
    // 取现有的哈希字段（新 bcrypt 或旧 SHA256）
    const curHash = ex.passwordHash || ex.password || '';
    let needReset = false;

    if (curHash.length >= 20) {
      // 有 bcrypt 哈希 → 校验是否匹配默认密码
      try {
        needReset = !bcrypt.compareSync(ADMIN_DEFAULT_PASSWORD, curHash);
      } catch (_) { needReset = true; }
    } else if (curHash.length > 0) {
      // 旧版 SHA256 → 需要升级
      needReset = true;
    }

    if (needReset) {
      ex.passwordHash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, SALT_ROUNDS);
      ex.pwdLegacy = false;
      saveUsers();
      console.log('[用户] 管理员密码已重置');
    }
    return;
  }
  // 首次创建管理员
  const hash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, SALT_ROUNDS);
  users['热合曼'] = { passwordHash: hash, isAdmin: true, fingerprint: '', isBanned: false, pwdLegacy: false };
  saveUsers();
  console.log('[用户] 管理员账号已创建');
}
let adminReady = ensureAdminAccount().catch(e => console.error('[用户] 管理员初始化失败', e));

function saveUsers() { saveJSON(USERS_FILE, users); }

async function hashPwd(pwd) { return await bcrypt.hash(pwd || '', SALT_ROUNDS); }

async function validatePassword(name, pwd) {
  if (!users[name]) return false;
  const record = users[name];
  // 用 passwordHash 优先，其次退回到旧 password 字段
  const hashField = record.passwordHash || record.password;
  if (!hashField) return !pwd;
  if (hashField.length < 20) {
    const oldHash = crypto.createHash('sha256').update(pwd || '').digest('hex').slice(0, 16);
    if (hashField === oldHash) {
      record.passwordHash = await bcrypt.hash(pwd || '', SALT_ROUNDS);
      record.pwdLegacy = false;
      saveUsers();
      return true;
    }
    return false;
  }
  return await bcrypt.compare(pwd || '', hashField);
}

function isNameBanned(name) { return users[name] && users[name].isBanned; }

function isFingerprintBanned(fp) {
  for (const n in users) if (users[n].fingerprint === fp && users[n].isBanned) return true;
  return false;
}

// ─── 角色权限校验 ──────────────────────────────────────────
function getUserRole(name) {
  if (!users[name]) return 'viewer';
  if (users[name].isAdmin) return 'editor';
  return users[name].role || 'commenter';
}

function canEdit(name) {
  return users[name] && (users[name].isAdmin || getUserRole(name) === 'editor');
}

function canComment(name) {
  if (!users[name]) return false;
  if (users[name].isAdmin) return true;
  const role = getUserRole(name);
  return role === 'editor' || role === 'commenter';
}

function canView(name) {
  return users[name] && true;
}

// ─── 项目存储 ────────────────────────────────────────────
let projects = loadJSON(PROJECTS_FILE, []);

function saveProjects() {
  const data = projects.map(p => ({
    id: p.id, type: p.type, name: p.name, data: p.data,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
    owner: p.owner, parentId: p.parentId || undefined,
  }));
  saveJSON(PROJECTS_FILE, data);
}

// ─── 密码重置申请 ──────────────────────────────────────
let passwordResets = loadJSON(PWD_RESETS_FILE, []);
let pwdResetId = passwordResets.length > 0 ? Math.max(...passwordResets.map(r => r.id || 0)) : 0;
function savePasswordResets() { saveJSON(PWD_RESETS_FILE, passwordResets); }

// ─── 消息权限 ──────────────────────────────────────────
let messagePermissions = loadJSON(MSG_PERM_FILE, {});
function saveMsgPermissions() { saveJSON(MSG_PERM_FILE, messagePermissions); }

// ─── 分镜状态 ──────────────────────────────────────────
function loadFenjingState() { return loadJSON(FENJING_FILE, null); }
function saveFenjingState(state) { saveJSON(FENJING_FILE, state); }

// ─── 批注存储 ────────────────────────────────────────────
let annotations = loadJSON(ANNOTATIONS_FILE, []);
function saveAnnotations() { saveJSON(ANNOTATIONS_FILE, annotations); }

// ─── 对等节点 ────────────────────────────────────────────
const peers = new Map(); // serverId → { socket, name, ip, port, connected, note }

// ─── 扫描状态 ────────────────────────────────────────────
let scanState = 'idle';
let scanTimer = null;
let scanInterval = null;

function startScan() {
  scanState = 'scanning';
  io.emit('scan-state', { state: scanState });
  scanTimer = setTimeout(() => {
    if (peers.size === 0) {
      scanState = 'nobody';
      io.emit('scan-state', { state: scanState });
      if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
      console.log('[扫描] 5分钟结束，未发现设备');
    }
  }, SCAN_DURATION);
}

function stopScan() {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (scanState === 'scanning') scanState = 'idle';
  io.emit('scan-state', { state: scanState });
}

function foundPeer() {
  if (scanState === 'scanning') {
    scanState = 'found';
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    io.emit('scan-state', { state: scanState });
    console.log('[扫描] 发现设备');
  }
}

// ─── 在线用户追踪 ────────────────────────────────────────
const onlineUsers = new Map(); // socket.id → { name, joinedAt, isAdmin, fingerprint }

function broadcastOnlineUsers() {
  const list = [];
  for (const [sid, u] of onlineUsers) {
    list.push({ id: sid, name: u.name, joinedAt: u.joinedAt, isAdmin: u.isAdmin || false });
  }
  io.emit('online-users', list);
}

// ─── 操作审计日志 ────────────────────────────────────────
const operationLog = [];
const MAX_LOG = 500;
let logId = 0;

function loadOperationLog() {
  const data = loadJSON(LOG_FILE, []);
  if (Array.isArray(data)) {
    data.forEach(e => { if (e.id > logId) logId = e.id; });
    return data;
  }
  return [];
}

function appendOperationLog(entry) {
  let log = loadJSON(LOG_FILE, []);
  log.push(entry);
  if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
  saveJSON(LOG_FILE, log);
}

const savedLogs = loadOperationLog();
savedLogs.forEach(e => operationLog.push(e));

function addLog(userId, userName, action, module, target) {
  const entry = {
    id: ++logId,
    userId: userId || 'system',
    userName: userName || '系统',
    action, module: module || '', target: target || '',
    timestamp: Date.now(),
  };
  operationLog.push(entry);
  if (operationLog.length > MAX_LOG) operationLog.splice(0, 100);
  appendOperationLog(entry);
  io.emit('operation-log', entry);
  return entry;
}

function getRecentLogs(count = 50) { return operationLog.slice(-count); }

// ─── 消息去重 ────────────────────────────────────────────
const seenMessages = new Map();
function isDuplicate(msgId) {
  if (!msgId) return false;
  if (seenMessages.has(msgId)) return true;
  seenMessages.set(msgId, Date.now());
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of seenMessages) if (now - ts > 30000) seenMessages.delete(id);
}, 60000);

// ─── Express + Socket.IO ─────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024,
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/fenjing', express.static(path.join(__dirname, 'public/fenjing')));

// ─── UDP 发现 ────────────────────────────────────────────
let broadcastDiscover = () => {};
if (!JOIN_TARGET) {
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', () => {});
  udp.on('message', (msg, rinfo) => {
    try {
      const pkt = JSON.parse(msg.toString());
      if (pkt.type === 'discover') {
        udp.send(JSON.stringify({ type: 'hello', serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT }),
          rinfo.port, rinfo.address);
      } else if (pkt.type === 'hello' && pkt.serverId !== SERVER_ID && !peers.has(pkt.serverId)) {
        console.log(`[发现] ${pkt.name} @ ${rinfo.address}:${pkt.port}`);
        if (SERVER_ID < pkt.serverId)
          connectToPeer(pkt.serverId, pkt.name, rinfo.address, pkt.port);
        else
          console.log('  → 等待对方连接');
      }
    } catch (_) {}
  });
  udp.bind(UDP_PORT, () => { udp.setBroadcast(true); console.log('[UDP] 发现服务已启动'); });
  broadcastDiscover = () => {
    udp.send(JSON.stringify({ type: 'discover', serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT }),
      UDP_PORT, '255.255.255.255');
  };
  setInterval(broadcastDiscover, 5000);
  setTimeout(broadcastDiscover, 1000);
} else {
  console.log(`[测试] --join 模式：将自动连接 ${JOIN_TARGET}`);
}

// ─── 5分钟重连守护 ───────────────────────────────────────
const RECONNECT_TIMEOUT = 5 * 60 * 1000;

function handlePeerDisconnect(serverId) {
  const p = peers.get(serverId);
  if (!p) return;
  console.log(`[桥接] ${p.name} 断开，${RECONNECT_TIMEOUT/60000}分钟内重连有效...`);
  p.connected = false;
  p.socket = null;
  broadcastPeers();
  p.reconnectTimer = setTimeout(() => {
    console.log(`[桥接] ${p.name} 重连超时，已移除`);
    peers.delete(serverId);
    broadcastPeers();
  }, RECONNECT_TIMEOUT);
}

// ─── 桥接：处理入站桥接连接 ────────────────────────────
function setupBridge(bridgeSocket, remoteIp, isIncoming) {
  let done = false;
  bridgeSocket.on('handshake', (data) => {
    if (done || data.serverId === SERVER_ID) return;
    done = true;

    if (peers.has(data.serverId)) {
      const ex = peers.get(data.serverId);
      if (ex.connected) { bridgeSocket.disconnect(); return; }
      console.log(`[桥接] ${data.name} 重新连接`);
      clearTimeout(ex.reconnectTimer);
      ex.socket = bridgeSocket; ex.connected = true; ex.name = data.name; ex.reconnectTimer = null;
      broadcastPeers();
      bridgeSocket.emit('handshake-ack', { serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
      sendToPeer(data.serverId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
      bridgeSocket.on('bridge-msg', (msg) => handleBridgeMessage(data.serverId, msg));
      bridgeSocket.on('disconnect', () => handlePeerDisconnect(data.serverId));
      return;
    }

    const p = { socket: bridgeSocket, name: data.name, ip: remoteIp, port: data.port, connected: true, note: '', reconnectTimer: null };
    peers.set(data.serverId, p);
    console.log(`[桥接] ${isIncoming ? '接受' : '连接'} ${data.name}`);
    foundPeer();
    bridgeSocket.emit('handshake-ack', { serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
    sendToPeer(data.serverId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
    broadcastPeers();
    bridgeSocket.on('bridge-msg', (msg) => handleBridgeMessage(data.serverId, msg));
    bridgeSocket.on('disconnect', () => handlePeerDisconnect(data.serverId));
  });
}

// ─── Socket.IO 统一入口 ─────────────────────────────────
io.on('connection', (socket) => {
  if (socket.handshake.query && socket.handshake.query.bridge === 'true') {
    const rip = (socket.handshake.address || '').replace(/^::ffff:/, '');
    console.log(`[桥接] 收到桥接连接 ${socket.id} 来自 ${rip}`);
    setupBridge(socket, rip, true);
    return;
  }

  console.log(`[浏览器] ${socket.id}`);
  const peerList = [];
  for (const [sid, p] of peers) if (p.connected) peerList.push({ serverId: sid, name: p.name, ip: p.ip, port: p.port, connected: true, note: p.note || '' });
  const userList = [];
  for (const [sid, u] of onlineUsers) {
    userList.push({ id: sid, name: u.name, joinedAt: u.joinedAt, isAdmin: u.isAdmin || false });
  }
  socket.emit('init', {
    serverId: SERVER_ID, serverName: SERVER_NAME,
    projects: projects.map(p => ({...p})), peers: peerList,
    scanState, onlineUsers: userList,
    operationLog: getRecentLogs(50),
  });

  // ── 认证 ──
  socket.on('join', async ({ name, password, fingerprint }) => {
    const userName = (name || '').trim();
    if (!userName) return;
    const ip = (socket.handshake.address || '').replace(/^::ffff:/, '');
    if (!checkRateLimit(`login:${ip}`, 20, 60000)) {
      socket.emit('login-error', '登录尝试过于频繁，请稍后再试');
      socket.disconnect();
      return;
    }
    if (fingerprint && isFingerprintBanned(fingerprint)) {
      socket.emit('login-error', '你的设备已被拉黑，无法进入');
      socket.disconnect();
      return;
    }
    if (isNameBanned(userName)) {
      socket.emit('login-error', '该用户已被拉黑');
      socket.disconnect();
      return;
    }

    SERVER_NAME = userName; socket.userName = userName;
    let isAdmin = false;

    if (users[userName] && users[userName].isAdmin) {
      if (await validatePassword(userName, password || '')) {
        isAdmin = true;
      } else {
        socket.emit('login-error', '管理员密码错误');
        return;
      }
    } else {
      if (users[userName]) {
        const record = users[userName];
        if (record.passwordHash) {
          if (!(await validatePassword(userName, password || ''))) {
            socket.emit('login-error', '密码错误，请重试');
            return;
          }
        } else if (password) {
          record.passwordHash = await hashPwd(password);
        }
      } else {
        users[userName] = {
          passwordHash: password ? await hashPwd(password) : '',
          isAdmin: false, fingerprint: '', isBanned: false,
          role: 'commenter'
        };
      }
    }
    if (fingerprint) users[userName].fingerprint = fingerprint;
    saveUsers();

    socket.isAdmin = isAdmin;
    onlineUsers.set(socket.id, { name: userName, joinedAt: Date.now(), isAdmin, fingerprint: fingerprint || '' });
    broadcastOnlineUsers();
    addLog(socket.id, userName, 'joined', 'system', '');
    socket.emit('login-success', { userName, isAdmin, hasPassword: !!users[userName]?.passwordHash });
  });

  socket.on('set-server-name', (name) => {
    SERVER_NAME = name || SERVER_NAME; socket.userName = SERVER_NAME; broadcastDiscover();
    for (const [sid, p] of peers) {
      if (p && p.socket) p.socket.emit('bridge-msg', { type: 'peer-rename', serverId: SERVER_ID, name: SERVER_NAME });
    }
  });
  socket.on('lan-toggle', (on) => {
    if (on && scanState === 'idle') { startScan(); broadcastDiscover(); scanInterval = setInterval(broadcastDiscover, 5000); }
    else if (!on) stopScan();
  });
  socket.on('refresh-lan', () => {
    if (scanState === 'nobody' || scanState === 'idle') { startScan(); broadcastDiscover(); scanInterval = setInterval(broadcastDiscover, 5000); }
    else broadcastDiscover();
  });
  socket.on('peer-note', ({ serverId, note }) => {
    if (peers.has(serverId)) { peers.get(serverId).note = note || ''; broadcastPeers(); }
  });

  // ── 项目管理 ──
  socket.on('project-create', (data) => {
    const p = { id: uuid().slice(0, 12), type: data.type, name: data.name || '未命名', data: data.data || getDefaultData(data.type), createdAt: Date.now(), updatedAt: Date.now(), owner: SERVER_NAME };
    projects.push(p); socket.emit('project-created', p);
    addLog(socket.id, socket.userName || SERVER_NAME, 'created', p.type, p.name);
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
    saveProjects();
  });
  socket.on('project-create-batch', (data) => {
    const { name, children } = data;
    if (!name) return;
    const folder = { id: uuid().slice(0, 12), type: 'folder', name, data: { children: [] }, createdAt: Date.now(), updatedAt: Date.now(), owner: SERVER_NAME };
    projects.push(folder);
    socket.emit('project-created', folder);
    addLog(socket.id, socket.userName || SERVER_NAME, 'created', 'folder', folder.name);
    const created = [folder];
    (children || []).forEach(c => {
      const child = { id: uuid().slice(0, 12), type: c.type, name: c.name || '未命名', data: getDefaultData(c.type), createdAt: Date.now(), updatedAt: Date.now(), owner: SERVER_NAME, parentId: folder.id };
      projects.push(child);
      socket.emit('project-created', child);
      created.push(child);
      folder.data.children.push(child.id);
    });
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
    saveProjects();
  });
  socket.on('project-update', (data) => {
    const p = projects.find(x => x.id === data.id); if (!p) return;
    // 只有 editor 及以上角色可以修改正式内容
    if (data.data !== undefined && !canEdit(socket.userName)) {
      socket.emit('project-update-error', '你没有修改正式内容的权限');
      return;
    }
    if (data.name !== undefined) p.name = data.name;
    if (data.data !== undefined) p.data = data.data;
    p.updatedAt = Date.now();
    socket.emit('project-updated', { id: p.id, name: p.name, data: p.data, updatedAt: p.updatedAt });
    addLog(socket.id, socket.userName || SERVER_NAME, 'updated', p.type, p.name);
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
    saveProjects();
  });
  socket.on('project-delete', (id) => {
    const p = projects.find(x => x.id === id);
    projects = projects.filter(x => x.id !== id); socket.emit('project-deleted', id);
    if (p) addLog(socket.id, socket.userName || SERVER_NAME, 'deleted', p.type, p.name);
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
    saveProjects();
  });
  socket.on('project-transfer', ({ ids, targetServerId }) => {
    const toSend = projects.filter(p => ids.includes(p.id)); if (!toSend.length) return;
    const tp = peers.get(targetServerId);
    if (tp && tp.connected) {
      tp.socket.emit('bridge-msg', { type: 'project-transfer', projects: toSend.map(p => ({...p})), fromName: SERVER_NAME, fromId: SERVER_ID });
      socket.emit('transfer-sent', { count: toSend.length, to: tp.name });
    } else socket.emit('transfer-failed', { reason: '对方不在线' });
  });

  // ── 操作锁 ──
  socket.on('focus-lock', ({ type, id }) => {
    const name = socket.userName || SERVER_NAME;
    socket.broadcast.emit('focus-lock', { type, id, user: name });
    broadcastToPeers({ type: 'focus-lock', lockType: type, lockId: id, user: name }, null);
  });
  socket.on('focus-release', ({ type, id }) => {
    const name = socket.userName || SERVER_NAME;
    socket.broadcast.emit('focus-release', { type, id, user: name });
    broadcastToPeers({ type: 'focus-release', lockType: type, lockId: id, user: name }, null);
  });
  socket.on('realtime-event', (data) => {
    const msg = { type: 'realtime', _msgId: uuid(), origin: SERVER_ID, event: data.event, data: data.payload };
    socket.broadcast.emit(data.event, data.payload);
    broadcastToPeers(msg, null);
  });

  // ── 管理操作 ──
  socket.on('admin-list-users', () => {
    if (!socket.isAdmin) return;
    const list = Object.entries(users).map(([name, u]) => ({
      name, isAdmin: u.isAdmin, hasPassword: !!u.passwordHash,
      isBanned: u.isBanned, fingerprint: u.fingerprint || '',
      role: u.isAdmin ? 'editor' : (u.role || 'commenter'),
    }));
    socket.emit('admin-users-list', list);
  });
  socket.on('admin-change-password', async ({ targetName, newPassword }) => {
    if (!socket.isAdmin || !users[targetName] || users[targetName].isAdmin || !newPassword) return;
    users[targetName].passwordHash = await hashPwd(newPassword);
    users[targetName].pwdLegacy = false;
    saveUsers();
    broadcastOnlineUsers();
    addLog(socket.id, socket.userName, 'changed password for', 'system', targetName);
  });
  socket.on('admin-ban-user', ({ targetName, fingerprint }) => {
    if (!socket.isAdmin) return;
    if (targetName && users[targetName]) {
      if (users[targetName].isAdmin) return;
      users[targetName].isBanned = true;
      saveUsers();
      for (const [sid, u] of onlineUsers) {
        if (u.name === targetName) {
          io.to(sid).emit('kicked', '你已被管理员拉黑');
          io.sockets.sockets.get(sid)?.disconnect();
          break;
        }
      }
      addLog(socket.id, socket.userName, 'banned', 'system', targetName);
    }
    if (fingerprint) {
      for (const n in users) {
        if (users[n].fingerprint === fingerprint && !users[n].isAdmin) users[n].isBanned = true;
      }
      saveUsers();
      for (const [sid, u] of onlineUsers) {
        if (u.fingerprint === fingerprint) {
          io.to(sid).emit('kicked', '你的设备已被拉黑');
          io.sockets.sockets.get(sid)?.disconnect();
        }
      }
    }
    broadcastOnlineUsers();
  });
  socket.on('admin-unban-user', ({ targetName }) => {
    if (!socket.isAdmin || !users[targetName]) return;
    users[targetName].isBanned = false;
    saveUsers();
    addLog(socket.id, socket.userName, 'unbanned', 'system', targetName);
    broadcastOnlineUsers();
  });

  // ── 角色管理 ──
  socket.on('admin-set-role', ({ targetName, role }) => {
    if (!socket.isAdmin || !users[targetName] || users[targetName].isAdmin) return;
    if (!['editor', 'commenter', 'viewer'].includes(role)) return;
    users[targetName].role = role;
    saveUsers();
    addLog(socket.id, socket.userName, 'set role', 'system', `${targetName} → ${role}`);
    broadcastOnlineUsers();
    // 通知目标用户角色变更
    for (const [sid, u] of onlineUsers) {
      if (u.name === targetName) io.to(sid).emit('role-changed', { role });
    }
  });

  // ── 角色查询 ──
  socket.on('admin-get-roles', () => {
    if (!socket.isAdmin) return;
    const roleList = [];
    for (const name in users) {
      if (users[name].isAdmin) continue;
      roleList.push({ name, role: getUserRole(name) });
    }
    socket.emit('admin-roles-list', roleList);
  });

  socket.on('get-my-role', () => {
    if (!socket.userName) return;
    socket.emit('my-role', { role: getUserRole(socket.userName) });
  });

  socket.on('check-edit-permission', () => {
    if (!socket.userName) { socket.emit('edit-permission', { allowed: false }); return; }
    socket.emit('edit-permission', { allowed: canEdit(socket.userName) });
  });

  socket.on('check-comment-permission', () => {
    if (!socket.userName) { socket.emit('comment-permission', { allowed: false }); return; }
    socket.emit('comment-permission', { allowed: canComment(socket.userName) });
  });

  // ── 用户 → 管理员消息 ──
  socket.on('user-message-to-admin', (text) => {
    if (!socket.userName) return;
    const msg = { from: socket.userName, text: text.trim(), time: Date.now() };
    if (!msg.text) return;
    for (const [sid, u] of onlineUsers) {
      if (u.isAdmin) io.to(sid).emit('admin-incoming-msg', msg);
    }
    addLog(socket.id, socket.userName, 'sent message to admin', 'system', msg.text.slice(0, 30));
  });

  // ── 忘记密码 ──
  socket.on('forgot-password-request', ({ name, newPassword, reason }) => {
    const userName = (name || '').trim();
    if (!userName || !users[userName]) {
      socket.emit('forgot-password-result', { ok: false, error: '用户不存在' });
      return;
    }
    const ip = (socket.handshake.address || '').replace(/^::ffff:/, '');
    if (!checkRateLimit(`forgot:${ip}`, 3, 300000)) {
      socket.emit('forgot-password-result', { ok: false, error: '申请过于频繁，请5分钟后再试' });
      return;
    }
    if (users[userName] && users[userName].isAdmin) {
      socket.emit('forgot-password-result', { ok: false, error: '管理员不能通过此方式重置密码' });
      return;
    }
    const req = { id: ++pwdResetId, name: userName, newPassword: newPassword || '', reason: reason || '', time: Date.now() };
    passwordResets.push(req);
    savePasswordResets();
    socket.emit('forgot-password-result', { ok: true });
    addLog(socket.id, socket.userName, 'requested password reset', 'system', userName);
    for (const [sid, u] of onlineUsers) {
      if (u.isAdmin) io.to(sid).emit('admin-reset-request', req);
    }
  });
  socket.on('admin-list-resets', () => {
    if (!socket.isAdmin) return;
    socket.emit('admin-resets-list', passwordResets);
  });
  socket.on('admin-approve-reset', async ({ requestId, name, newPassword, approve }) => {
    if (!socket.isAdmin) return;
    passwordResets = passwordResets.filter(r => r.id !== requestId);
    savePasswordResets();
    if (approve && name && users[name] && !users[name].isAdmin) {
      users[name].passwordHash = await hashPwd(newPassword || '');
      users[name].pwdLegacy = false;
      saveUsers();
      addLog(socket.id, socket.userName, 'approved password reset', 'system', name);
      for (const [sid, u] of onlineUsers) {
        if (u.name === name) io.to(sid).emit('kicked', '管理员已重置你的密码，请重新登录');
      }
    } else {
      addLog(socket.id, socket.userName, 'rejected password reset', 'system', name || 'unknown');
    }
  });

  // ── 用户对用户私聊 ──
  socket.on('user-message-to-user', ({ target, text }) => {
    if (!socket.userName || !target || !text) return;
    const msg = { from: socket.userName, text: text.trim(), time: Date.now() };
    if (!msg.text) return;
    for (const [sid, u] of onlineUsers) {
      if (u.name === target) { io.to(sid).emit('user-incoming-msg', msg); break; }
    }
    addLog(socket.id, socket.userName, 'sent message to', 'system', target);
  });
  socket.on('check-message-permission', ({ target }) => {
    if (!socket.userName) return;
    const key = `${socket.userName}→${target}`;
    socket.emit('message-permission-status', { target, permitted: !!messagePermissions[key] });
  });
  socket.on('request-message-permission', ({ target }) => {
    if (!socket.userName) return;
    const from = socket.userName;
    const key = `${from}→${target}`;
    if (messagePermissions[key]) { socket.emit('message-permission-granted', { target }); return; }
    for (const [sid, u] of onlineUsers) {
      if (u.isAdmin) io.to(sid).emit('admin-permission-request', { from, target });
    }
  });
  socket.on('admin-approve-permission', ({ from, target, approve }) => {
    if (!socket.isAdmin) return;
    const key = `${from}→${target}`;
    if (approve) {
      messagePermissions[key] = true;
      saveMsgPermissions();
      for (const [sid, u] of onlineUsers) {
        if (u.name === from) { io.to(sid).emit('message-permission-granted', { target }); break; }
      }
      addLog(socket.id, socket.userName, 'approved message permission', 'system', `${from}→${target}`);
    } else {
      for (const [sid, u] of onlineUsers) {
        if (u.name === from) { io.to(sid).emit('message-permission-denied', { target }); break; }
      }
      addLog(socket.id, socket.userName, 'rejected message permission', 'system', `${from}→${target}`);
    }
  });

  // ── 统计 ──
  socket.on('admin-get-stats', () => {
    if (!socket.isAdmin) return;
    socket.emit('admin-stats', {
      onlineUsers: onlineUsers.size, peers: peers.size,
      projects: projects.length, logCount: operationLog.length,
    });
  });

  // ── 批注系统 ──
  socket.on('annotation-list', ({ documentId }) => {
    if (!socket.userName) return;
    const docAnnotations = annotations.filter(a => a.documentId === documentId);
    socket.emit('annotation-list-result', { documentId, annotations: docAnnotations });
  });

  socket.on('annotation-create', ({ documentId, anchor, content }) => {
    if (!socket.userName) { socket.emit('annotation-error', '请先登录'); return; }
    if (!canComment(socket.userName)) { socket.emit('annotation-error', '你没有评论权限'); return; }
    if (!documentId || !content || !content.text) { socket.emit('annotation-error', '批注内容不能为空'); return; }
    const ann = {
      id: uuid().slice(0, 12),
      documentId,
      userId: socket.userName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
      anchor: anchor || { type: 'text-range', startOffset: 0, endOffset: 0, text: '' },
      content: { text: content.text, attachments: content.attachments || [] },
      replyThread: [],
    };
    annotations.push(ann);
    saveAnnotations();
    io.emit('annotation-created', ann);
    addLog(socket.id, socket.userName, 'created annotation', documentId, content.text.slice(0, 30));
  });

  socket.on('annotation-reply', ({ annotationId, text }) => {
    if (!socket.userName) { socket.emit('annotation-error', '请先登录'); return; }
    if (!canComment(socket.userName)) { socket.emit('annotation-error', '你没有评论权限'); return; }
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) { socket.emit('annotation-error', '批注不存在'); return; }
    const reply = { userId: socket.userName, text: text.trim(), timestamp: Date.now() };
    ann.replyThread.push(reply);
    ann.updatedAt = Date.now();
    saveAnnotations();
    io.emit('annotation-replied', { annotationId, reply });
    addLog(socket.id, socket.userName, 'replied annotation', annotationId, text.slice(0, 30));
  });

  socket.on('annotation-update-status', ({ annotationId, status }) => {
    if (!socket.userName) return;
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) { socket.emit('annotation-error', '批注不存在'); return; }
    // 仅批注作者或管理员可以修改状态
    if (ann.userId !== socket.userName && !socket.isAdmin) { socket.emit('annotation-error', '你没有权限修改此批注状态'); return; }
    if (!['open', 'resolved', 'rejected', 'pending'].includes(status)) return;
    ann.status = status;
    ann.updatedAt = Date.now();
    saveAnnotations();
    io.emit('annotation-status-updated', { annotationId, status, updatedBy: socket.userName });
    addLog(socket.id, socket.userName, 'changed annotation status', annotationId, status);
  });

  socket.on('annotation-delete', ({ annotationId }) => {
    if (!socket.userName) return;
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) return;
    // 仅批注作者或管理员可以删除
    if (ann.userId !== socket.userName && !socket.isAdmin) { socket.emit('annotation-error', '你没有权限删除此批注'); return; }
    annotations = annotations.filter(a => a.id !== annotationId);
    saveAnnotations();
    io.emit('annotation-deleted', { annotationId });
    addLog(socket.id, socket.userName, 'deleted annotation', annotationId, '');
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
    broadcastToPeers({ type: 'focus-release-all', user: socket.userName || SERVER_NAME }, null);
  });
});

// ─── 桥接消息处理 ────────────────────────────────────────
function handleBridgeMessage(fromId, msg) {
  try {
    switch (msg.type) {
      case 'projects-sync':
        mergeProjects(msg.projects);
        broadcastToBrowsers({ type: 'projects-update' });
        broadcastToPeers(msg, fromId);
        break;
      case 'project-transfer':
        const newOnes = [];
        msg.projects.forEach(p => { if (!projects.find(x => x.id === p.id)) { projects.push({...p}); newOnes.push(p); } });
        broadcastToBrowsers({ type: 'projects-received', projects: newOnes, from: msg.fromName });
        broadcastToBrowsers({ type: 'projects-update' });
        broadcastToPeers(msg, fromId);
        break;
      case 'realtime':
        if (msg._msgId && isDuplicate(msg._msgId)) break;
        broadcastToBrowsers({ type: 'realtime', origin: msg.origin, event: msg.event, data: msg.data });
        if (msg.origin !== SERVER_ID) io.emit(msg.event, msg.data);
        if (msg._msgId) broadcastToPeers(msg, fromId);
        break;
      case 'focus-lock':
        io.emit('focus-lock', { type: msg.lockType, id: msg.lockId, user: msg.user });
        broadcastToPeers(msg, fromId);
        break;
      case 'focus-release':
        io.emit('focus-release', { type: msg.lockType, id: msg.lockId, user: msg.user });
        broadcastToPeers(msg, fromId);
        break;
      case 'focus-release-all':
        io.emit('focus-release-all', { user: msg.user });
        broadcastToPeers(msg, fromId);
        break;
      case 'peer-rename':
        const p = peers.get(fromId);
        if (p) { p.name = msg.name; broadcastPeers(); }
        break;
      case 'fenjing-sync':
        if (msg.state) {
          fenjingState = msg.state;
          fenjingNsp.emit('fenjing:state-sync', fenjingState);
        }
        break;
    }
  } catch (e) { console.error('[桥接] 处理消息异常:', e.message); }
}

// ─── 工具函数 ────────────────────────────────────────────
function mergeProjects(remoteList) {
  remoteList.forEach(rp => {
    const local = projects.find(p => p.id === rp.id);
    if (!local) projects.push({...rp});
    else if (rp.updatedAt > local.updatedAt) Object.assign(local, rp);
  });
}

function broadcastToBrowsers(data) { io.emit('bridge-message', data); }

function broadcastToPeers(msg, excludeId) {
  for (const [sid, p] of peers) {
    if (sid !== excludeId && p.connected) sendToPeer(sid, msg);
  }
}

function sendToPeer(serverId, msg) {
  const p = peers.get(serverId);
  if (p && p.connected) p.socket.emit('bridge-msg', msg);
}

function broadcastPeers() {
  const list = [];
  for (const [sid, p] of peers) {
    list.push({
      serverId: sid, name: p.name, ip: p.ip, port: p.port,
      connected: p.connected, note: p.note || '',
      reconnecting: !p.connected && p.reconnectTimer !== null,
    });
  }
  broadcastToBrowsers({ type: 'peers-update', peers: list });
}

// ─── 分镜工具 namespace ────────────────────────────────────
const fenjingNsp = io.of('/fenjing');
let fenjingState = loadFenjingState() || { projectName: '未命名项目', scenes: [], shots: [] };

fenjingNsp.on('connection', (socket) => {
  console.log(`[fenjing连接] ${socket.id}`);
  socket.emit('fenjing:state-sync', fenjingState);
  socket.on('fenjing:shots-update', (shots) => {
    fenjingState.shots = shots;
    socket.broadcast.emit('fenjing:shots-update', shots);
    saveFenjingState(fenjingState);
    broadcastToPeers({ type: 'fenjing-sync', state: fenjingState }, null);
  });
  socket.on('fenjing:scenes-update', (scenes) => {
    fenjingState.scenes = scenes;
    socket.broadcast.emit('fenjing:scenes-update', scenes);
    saveFenjingState(fenjingState);
    broadcastToPeers({ type: 'fenjing-sync', state: fenjingState }, null);
  });
  socket.on('fenjing:project-rename', (name) => {
    fenjingState.projectName = name;
    socket.broadcast.emit('fenjing:project-rename', name);
    saveFenjingState(fenjingState);
    broadcastToPeers({ type: 'fenjing-sync', state: fenjingState }, null);
  });
});

function getDefaultData(type) {
  switch (type) {
    case 'script': return { acts: [] };
    case 'mindmap': return { nodes: [], edges: [] };
    case 'story': return { chapters: [] };
    case 'folder': return { children: [] };
    default: return {};
  }
}

// ─── 主动连接对方（UDP 发现后调用） ────────────────────
let connectPeerId = 0;

function connectToPeer(serverId, name, ip, port) {
  const tempId = serverId || `tmp_${++connectPeerId}`;
  if (peers.has(tempId) || (serverId && peers.has(serverId))) return;

  console.log(`[桥接] 连接 ${name} @ ${ip}:${port}...`);
  const url = `http://${ip}:${port}`;
  const sock = SocketIOClient(url, {
    query: { bridge: 'true' }, transports: ['websocket'],
    reconnection: true, reconnectionDelay: 2000, reconnectionAttempts: Infinity,
  });

  let realServerId = serverId;

  sock.on('connect', () => {
    console.log(`[桥接] Socket.IO 连到 ${name}`);
    sock.emit('handshake', { serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
  });

  sock.on('handshake-ack', (data) => {
    realServerId = data.serverId;
    if (peers.has(realServerId)) {
      const ex = peers.get(realServerId);
      if (ex.connected) { sock.disconnect(); return; }
      console.log(`[桥接] ${data.name} 重连成功`);
      clearTimeout(ex.reconnectTimer);
      ex.socket = sock; ex.connected = true; ex.reconnectTimer = null;
      broadcastPeers();
      sendToPeer(realServerId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
      sock.on('bridge-msg', (msg) => handleBridgeMessage(realServerId, msg));
      sock.on('disconnect', () => handlePeerDisconnect(realServerId));
      return;
    }
    const p = { socket: sock, name: data.name, ip, port, connected: true, note: '', reconnectTimer: null };
    peers.set(realServerId, p);
    if (tempId !== realServerId) peers.delete(tempId);
    console.log(`[桥接] 握手完成，已加入 ${data.name}`);
    foundPeer();
    sendToPeer(realServerId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
    broadcastPeers();
    sock.on('bridge-msg', (msg) => handleBridgeMessage(realServerId, msg));
    sock.on('disconnect', () => handlePeerDisconnect(realServerId));
  });

  sock.on('connect_error', () => {});
  setTimeout(() => { if (!sock.connected) sock.close(); }, 10000);
}

function autoJoin() {
  if (!JOIN_TARGET) return;
  const [host, portStr] = JOIN_TARGET.split(':');
  const port = parseInt(portStr) || 3000;
  connectToPeer(null, host, host, port);
}

// ─── 全局异常兜底 ──────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[崩溃] 未捕获异常:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[崩溃] 未处理的 Promise 拒绝:', reason);
});

// ─── 启动 ────────────────────────────────────────────────
function startServer(port) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ 端口 ${port} 已被占用！`);
      console.error('   可能已有另一个服务在运行。');
      console.error('   解决方案：');
      console.error(`     1. 关闭已运行的服务`);
      console.error(`     2. 或换一个端口: node server.js --port ${port + 1}`);
      console.error('');
      process.exit(1);
    } else {
      console.error('[崩溃] 服务器错误:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
  if (JOIN_TARGET) setTimeout(autoJoin, 1500);
  let ip = 'localhost';
  try {
    for (const name of Object.keys(os.networkInterfaces()))
      for (const iface of os.networkInterfaces()[name])
        if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; break; }
  } catch (_) {}
  console.log('╔══════════════════════════════════════════╗');
  console.log(JOIN_TARGET ? '║    🧪 测试实例 (--join 模式)              ║' : '║    🎬 多机协作创作工作室 v2.0            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  服务ID: ${SERVER_ID.padEnd(28)}║`);
  console.log(`║  本机:   http://localhost:${HTTP_PORT}${' '.repeat(13 - String(HTTP_PORT).length)}║`);
  if (JOIN_TARGET) console.log(`║  加入:   ${JOIN_TARGET.padEnd(27)}║`);
  else console.log(`║  局域网: http://${ip}:${HTTP_PORT}${' '.repeat(Math.max(0, 23 - ip.length - String(HTTP_PORT).length))}║`);
  console.log('║                                        ║');
  if (JOIN_TARGET) {
    console.log('║  浏览器1 → http://localhost:3000         ║');
    console.log(`║  浏览器2 → http://localhost:${HTTP_PORT}${' '.repeat(15 - String(HTTP_PORT).length)}║`);
  } else {
    console.log('║  多台电脑打开页面 → 开启局域网          ║');
    console.log('║  自动发现并组建协作网络                  ║');
  }
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  👑 管理员: 热合曼                        ║`);
  console.log(`║  🔑 密码:    ${ADMIN_DEFAULT_PASSWORD.padEnd(28)}║`);
  console.log('║  💡 登录后可在右侧面板修改密码           ║');
  console.log('╚══════════════════════════════════════════╝');
  });
}

startServer(HTTP_PORT);
