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
const crypto = require('crypto');

// ─── 文件持久化 ─────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FENJING_FILE = path.join(DATA_DIR, 'fenjing-state.json');
const PWD_RESETS_FILE = path.join(DATA_DIR, 'password-resets.json');
const MSG_PERM_FILE = path.join(DATA_DIR, 'message-permissions.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch (e) { console.error('[持久化] 读取失败', e.message); }
  return [];
}

function saveProjects() {
  try {
    const data = projects.map(p => ({
      id: p.id, type: p.type, name: p.name,
      data: p.data,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      owner: p.owner,
      parentId: p.parentId || undefined,
    }));
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error('[持久化] 写入失败', e.message); }
}

function loadFenjingState() {
  try {
    if (fs.existsSync(FENJING_FILE)) {
      const raw = fs.readFileSync(FENJING_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') return data;
    }
  } catch (e) { console.error('[分镜持久化] 读取失败', e.message); }
  return null;
}

function saveFenjingState(state) {
  try {
    fs.writeFileSync(FENJING_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) { console.error('[分镜持久化] 写入失败', e.message); }
}

// ─── 密码重置申请持久化 ──────────────────────────────
let passwordResets = []; // { id, name, newPassword, reason, time }
let pwdResetId = 0;

function loadPasswordResets() {
  try {
    if (fs.existsSync(PWD_RESETS_FILE)) {
      const raw = fs.readFileSync(PWD_RESETS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) { console.error('[密码重置] 读取失败', e.message); }
  return [];
}
passwordResets = loadPasswordResets();
if (passwordResets.length > 0) {
  pwdResetId = Math.max(...passwordResets.map(r => r.id || 0));
}

function savePasswordResets() {
  try {
    fs.writeFileSync(PWD_RESETS_FILE, JSON.stringify(passwordResets, null, 2), 'utf-8');
  } catch (e) { console.error('[密码重置] 写入失败', e.message); }
}

// ─── 消息权限持久化 ──────────────────────────────────
let messagePermissions = {}; // "from→to" → true

function loadMsgPermissions() {
  try {
    if (fs.existsSync(MSG_PERM_FILE)) {
      return JSON.parse(fs.readFileSync(MSG_PERM_FILE, 'utf-8'));
    }
  } catch (e) { console.error('[消息权限] 读取失败', e.message); }
  return {};
}
messagePermissions = loadMsgPermissions();

function saveMsgPermissions() {
  try {
    fs.writeFileSync(MSG_PERM_FILE, JSON.stringify(messagePermissions, null, 2), 'utf-8');
  } catch (e) { console.error('[消息权限] 写入失败', e.message); }
}

// ─── 用户管理（密码/指纹/拉黑）────────────────────────
let users = {}; // name → { password, isAdmin, fingerprint, isBanned }
try {
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }
} catch (e) { console.error('[用户] 加载失败', e.message); }

// 确保管理员账号存在
if (!users['热合曼']) {
  users['热合曼'] = { password: hashPwd('26275265'), isAdmin: true, fingerprint: '', isBanned: false };
} else if (users['热合曼'].password && users['热合曼'].password.length < 20) {
  // 迁移旧版明文密码
  users['热合曼'].password = hashPwd(users['热合曼'].password);
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd || '').digest('hex').slice(0, 16);
}
function validatePassword(name, pwd) {
  if (!users[name]) return false;
  return users[name].password === hashPwd(pwd);
}

function isNameBanned(name) {
  return users[name] && users[name].isBanned;
}

function isFingerprintBanned(fp) {
  for (const n in users) {
    if (users[n].fingerprint === fp && users[n].isBanned) return true;
  }
  return false;
}

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

// ─── 存储 ────────────────────────────────────────────────
const peers = new Map(); // serverId → { socket, name, ip, port, connected, note }
let projects = loadProjects();

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
    console.log('[扫描] ✅ 发现设备');
  }
}

// ─── 在线用户追踪 ────────────────────────────────────────
const onlineUsers = new Map(); // socket.id → { name, joinedAt }

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
const LOG_FILE = path.join(DATA_DIR, 'operation-log.json');

// 从文件加载历史日志
function loadOperationLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        data.forEach(e => { if (e.id > logId) logId = e.id; });
        return data;
      }
    }
  } catch (e) { console.error('[日志持久化] 读取失败', e.message); }
  return [];
}
// 追加写入（文件只保留最近的 MAX_LOG 条）
function appendOperationLog(entry) {
  try {
    let log = [];
    if (fs.existsSync(LOG_FILE)) {
      try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')); } catch(_) {}
    }
    log.push(entry);
    if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
  } catch (e) { /* 静默 */ }
}

// 初始化时加载历史日志到内存
const savedLogs = loadOperationLog();
savedLogs.forEach(e => operationLog.push(e));

function addLog(userId, userName, action, module, target) {
  const entry = {
    id: ++logId,
    userId: userId || 'system',
    userName: userName || '系统',
    action,
    module: module || '',
    target: target || '',
    timestamp: Date.now(),
  };
  operationLog.push(entry);
  if (operationLog.length > MAX_LOG) operationLog.splice(0, 100);
  // 持久化到文件
  appendOperationLog(entry);
  // 广播给所有浏览器
  io.emit('operation-log', entry);
  return entry;
}

// 广播历史日志给新连接的客户端
function getRecentLogs(count = 50) {
  return operationLog.slice(-count);
}

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
app.use(express.static(path.join(__dirname, 'public')));
app.use('/fenjing', express.static(path.join(__dirname, 'public/fenjing')));

// ─── UDP 发现 ────────────────────────────────────────────
function broadcastDiscover() {}
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
        console.log(`\n[发现] ${pkt.name} @ ${rinfo.address}:${pkt.port}`);
        if (SERVER_ID < pkt.serverId)
          connectToPeer(pkt.serverId, pkt.name, rinfo.address, pkt.port);
        else
          console.log(`  → 等待对方连接`);
      }
    } catch (_) {}
  });
  udp.bind(UDP_PORT, () => { udp.setBroadcast(true); console.log(`[UDP] 发现服务已启动`); });
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
  console.log(`[桥接] 🔌 ${p.name} 断开，${RECONNECT_TIMEOUT/60000}分钟内重连有效...`);
  p.connected = false;
  p.socket = null;
  broadcastPeers();
  p.reconnectTimer = setTimeout(() => {
    console.log(`[桥接] ⏰ ${p.name} 重连超时，已移除`);
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

    // 已有此 peer：重连 or 重复连接
    if (peers.has(data.serverId)) {
      const ex = peers.get(data.serverId);
      if (ex.connected) { bridgeSocket.disconnect(); return; }
      // 🔄 重连！更新 socket，取消删除定时器
      console.log(`[桥接] 🔄 ${data.name} 重新连接`);
      clearTimeout(ex.reconnectTimer);
      ex.socket = bridgeSocket; ex.connected = true; ex.name = data.name; ex.reconnectTimer = null;
      broadcastPeers();
      bridgeSocket.emit('handshake-ack', { serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
      sendToPeer(data.serverId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
      bridgeSocket.on('bridge-msg', (msg) => handleBridgeMessage(data.serverId, msg));
      bridgeSocket.on('disconnect', () => handlePeerDisconnect(data.serverId));
      return;
    }

    // 全新连接
    const p = { socket: bridgeSocket, name: data.name, ip: remoteIp, port: data.port, connected: true, note: '', reconnectTimer: null };
    peers.set(data.serverId, p);
    console.log(`[桥接] ✅ ${isIncoming ? '接受' : '连接'} ${data.name}`);
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
  // 桥接连接？
  if (socket.handshake.query && socket.handshake.query.bridge === 'true') {
    const rip = (socket.handshake.address || '').replace(/^::ffff:/, '');
    console.log(`[桥接] 收到桥接连接 ${socket.id} 来自 ${rip}`);
    setupBridge(socket, rip, true);
    return;
  }

  // ═══ 浏览器连接 ═══
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

  // 验证用户身份并拉黑检查
  socket.on('join', ({ name, password, fingerprint }) => {
    const userName = (name || '').trim();
    if (!userName) return;
    
    // 拉黑检查（指纹）
    if (fingerprint && isFingerprintBanned(fingerprint)) {
      socket.emit('login-error', '你的设备已被拉黑，无法进入');
      socket.disconnect();
      return;
    }
    // 拉黑检查（名字）
    if (isNameBanned(userName)) {
      socket.emit('login-error', '该用户已被拉黑');
      socket.disconnect();
      return;
    }
    
    SERVER_NAME = userName; socket.userName = userName;
    
    // 检查管理员身份
    let isAdmin = false;
    if (users[userName] && users[userName].isAdmin) {
      if (validatePassword(userName, password || '')) {
        isAdmin = true;
      } else {
        socket.emit('login-error', '管理员密码错误');
        return;
      }
    } else {
      // 普通用户
      if (users[userName]) {
        // 已存在 → 验证密码
        if (!validatePassword(userName, password || '')) {
          socket.emit('login-error', '密码错误，请重试');
          return;
        }
      } else {
        // 新用户 → 需要密码注册
        if (!password) {
          socket.emit('login-error', '新用户需要设置密码');
          return;
        }
        users[userName] = { password: hashPwd(password), isAdmin: false, fingerprint: '', isBanned: false };
      }
    }
    // 更新指纹
    if (fingerprint) {
      users[userName].fingerprint = fingerprint;
    }
    saveUsers();
    
    socket.isAdmin = isAdmin;
    onlineUsers.set(socket.id, { name: userName, joinedAt: Date.now(), isAdmin, fingerprint: fingerprint || '' });
    broadcastOnlineUsers();
    addLog(socket.id, userName, 'joined', 'system', '');
    
    // 告知客户端身份
    socket.emit('login-success', { userName, isAdmin });
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

  // 项目
  socket.on('project-create', (data) => {
    const p = { id: uuid().slice(0, 12), type: data.type, name: data.name || '未命名', data: data.data || getDefaultData(data.type), createdAt: Date.now(), updatedAt: Date.now(), owner: SERVER_NAME };
    projects.push(p); socket.emit('project-created', p);
    addLog(socket.id, socket.userName || SERVER_NAME, 'created', p.type, p.name);
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
    saveProjects();
  });
  // ── 批量创建（文件夹 + 子项目） ──
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
  // ── 操作锁：零延迟广播谁在编辑什么 ──
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

  // ── 管理员操作 ──
  socket.on('admin-list-users', () => {
    if (!socket.isAdmin) return;
    const list = Object.entries(users).map(([name, u]) => ({
      name,
      isAdmin: u.isAdmin,
      isBanned: u.isBanned,
      fingerprint: u.fingerprint || '',
    }));
    socket.emit('admin-users-list', list);
  });
  
  socket.on('admin-change-password', ({ targetName, newPassword }) => {
    if (!socket.isAdmin) return;
    if (!users[targetName] || users[targetName].isAdmin) return; // 不能改管理员密码
    users[targetName].password = hashPwd(newPassword || '');
    saveUsers();
    io.emit('online-users', []); // 刷新客户端
    broadcastOnlineUsers();
    addLog(socket.id, socket.userName, 'changed password for', 'system', targetName);
  });
  
  socket.on('admin-ban-user', ({ targetName, fingerprint }) => {
    if (!socket.isAdmin) return;
    if (targetName && users[targetName]) {
      if (users[targetName].isAdmin) return; // 不能拉黑管理员
      users[targetName].isBanned = true;
      saveUsers();
      // 踢掉此人
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
      // 按指纹拉黑所有匹配用户
      for (const n in users) {
        if (users[n].fingerprint === fingerprint && !users[n].isAdmin) {
          users[n].isBanned = true;
        }
      }
      saveUsers();
      // 踢掉该指纹的所有在线用户
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
    if (!socket.isAdmin) return;
    if (users[targetName]) {
      users[targetName].isBanned = false;
      saveUsers();
      addLog(socket.id, socket.userName, 'unbanned', 'system', targetName);
    }
    broadcastOnlineUsers();
  });
  
  // ── 用户发消息给管理员 ──
  socket.on('user-message-to-admin', (text) => {
    if (!socket.userName) return; // 未登录不发
    const name = socket.userName || '未知';
    const msg = { from: name, text: text.trim(), time: Date.now() };
    if (!msg.text) return;
    // 转发给所有管理员
    for (const [sid, u] of onlineUsers) {
      if (u.isAdmin) {
        io.to(sid).emit('admin-incoming-msg', msg);
      }
    }
    addLog(socket.id, name, 'sent message to admin', 'system', msg.text.slice(0, 30));
  });

  // ── 忘记密码申请 ──
  socket.on('forgot-password-request', ({ name, newPassword, reason }) => {
    const userName = (name || '').trim();
    if (!userName || !users[userName]) {
      socket.emit('forgot-password-result', { ok: false, error: '用户不存在' });
      return;
    }
    if (users[userName] && users[userName].isAdmin) {
      socket.emit('forgot-password-result', { ok: false, error: '管理员不能通过此方式重置密码' });
      return;
    }
    const req = {
      id: ++pwdResetId,
      name: userName,
      newPassword: newPassword || '',
      reason: reason || '',
      time: Date.now(),
    };
    passwordResets.push(req);
    savePasswordResets();
    socket.emit('forgot-password-result', { ok: true });
    addLog(socket.id, socket.userName, 'requested password reset', 'system', userName);
    // 通知所有管理员
    for (const [sid, u] of onlineUsers) {
      if (u.isAdmin) {
        io.to(sid).emit('admin-reset-request', req);
      }
    }
  });

  // ── 管理员查看所有重置申请 ──
  socket.on('admin-list-resets', () => {
    if (!socket.isAdmin) return;
    socket.emit('admin-resets-list', passwordResets);
  });

  // ── 管理员审批密码重置 ──
  socket.on('admin-approve-reset', ({ requestId, name, newPassword, approve }) => {
    if (!socket.isAdmin) return;
    // 移除申请
    passwordResets = passwordResets.filter(r => r.id !== requestId);
    savePasswordResets();
    if (approve && name && users[name] && !users[name].isAdmin) {
      users[name].password = hashPwd(newPassword || '');
      saveUsers();
      addLog(socket.id, socket.userName, 'approved password reset', 'system', name);
      // 通知被改密码的用户
      for (const [sid, u] of onlineUsers) {
        if (u.name === name) {
          io.to(sid).emit('kicked', '管理员已重置你的密码，请重新登录');
        }
      }
    } else {
      addLog(socket.id, socket.userName, 'rejected password reset', 'system', name || 'unknown');
    }
  });

  // ── 用户对用户私聊 ──
  socket.on('user-message-to-user', ({ target, text }) => {
    if (!socket.userName || !target || !text) return;
    const from = socket.userName;
    const msg = { from, text: text.trim(), time: Date.now() };
    if (!msg.text) return;
    // 发送给目标用户
    for (const [sid, u] of onlineUsers) {
      if (u.name === target) {
        io.to(sid).emit('user-incoming-msg', msg);
        break;
      }
    }
    addLog(socket.id, from, 'sent message to', 'system', target);
  });

  // ── 检查消息权限 ──
  socket.on('check-message-permission', ({ target }) => {
    if (!socket.userName) return;
    const from = socket.userName;
    const key = `${from}→${target}`;
    const permitted = !!messagePermissions[key];
    socket.emit('message-permission-status', { target, permitted });
  });

  // ── 请求消息权限 ──
  socket.on('request-message-permission', ({ target }) => {
    if (!socket.userName) return;
    const from = socket.userName;
    const key = `${from}→${target}`;
    if (messagePermissions[key]) {
      socket.emit('message-permission-granted', { target });
      return;
    }
    // 通知所有管理员
    for (const [sid, u] of onlineUsers) {
      if (u.isAdmin) {
        io.to(sid).emit('admin-permission-request', { from, target });
      }
    }
  });

  // ── 管理员审批消息权限 ──
  socket.on('admin-approve-permission', ({ from, target, approve }) => {
    if (!socket.isAdmin) return;
    const key = `${from}→${target}`;
    if (approve) {
      messagePermissions[key] = true;
      saveMsgPermissions();
      // 通知申请人
      for (const [sid, u] of onlineUsers) {
        if (u.name === from) {
          io.to(sid).emit('message-permission-granted', { target });
          break;
        }
      }
      addLog(socket.id, socket.userName, 'approved message permission', 'system', `${from}→${target}`);
    } else {
      // 通知申请人被拒绝
      for (const [sid, u] of onlineUsers) {
        if (u.name === from) {
          io.to(sid).emit('message-permission-denied', { target });
          break;
        }
      }
      addLog(socket.id, socket.userName, 'rejected message permission', 'system', `${from}→${target}`);
    }
  });

  // ── 管理员获取统计信息 ──
  socket.on('admin-get-stats', () => {
    if (!socket.isAdmin) return;
    socket.emit('admin-stats', {
      onlineUsers: onlineUsers.size,
      peers: peers.size,
      projects: projects.length,
      logCount: operationLog.length,
    });
  });

  // 断开连接时自动释放此 socket 的所有锁
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
    // 通知所有 peer 释放此用户的操作锁
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
      // 对方改了名字
      const p = peers.get(fromId);
      if (p) { p.name = msg.name; broadcastPeers(); }
      break;
    case 'fenjing-sync':
      // 来自 peer 的分镜状态同步 → 转发给本地所有 fenjing 客户端
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
      connected: p.connected,
      note: p.note || '',
      reconnecting: !p.connected && p.reconnectTimer !== null,
    });
  }
  broadcastToBrowsers({ type: 'peers-update', peers: list });
}

// ─── 分镜工具 namespace ────────────────────────────────────
const fenjingNsp = io.of('/fenjing');
let fenjingState = loadFenjingState() || {
  projectName: '未命名项目',
  scenes: [],
  shots: [],
};

fenjingNsp.on('connection', (socket) => {
  console.log(`[fenjing连接] ${socket.id}`);

  // 新客户端 → 发送全量状态
  socket.emit('fenjing:state-sync', fenjingState);

  // 全量 shots 更新（增删改都在一次提交中）
  socket.on('fenjing:shots-update', (shots) => {
    fenjingState.shots = shots;
    socket.broadcast.emit('fenjing:shots-update', shots);
    saveFenjingState(fenjingState);
    // 桥接到其他 collab-studio 节点
    broadcastToPeers({ type: 'fenjing-sync', state: fenjingState }, null);
  });

  // 全量 scenes 更新
  socket.on('fenjing:scenes-update', (scenes) => {
    fenjingState.scenes = scenes;
    socket.broadcast.emit('fenjing:scenes-update', scenes);
    saveFenjingState(fenjingState);
    broadcastToPeers({ type: 'fenjing-sync', state: fenjingState }, null);
  });

  // 项目名更新
  socket.on('fenjing:project-rename', (name) => {
    fenjingState.projectName = name;
    socket.broadcast.emit('fenjing:project-rename', name);
    saveFenjingState(fenjingState);
    broadcastToPeers({ type: 'fenjing-sync', state: fenjingState }, null);
  });
});

// 桥接：收到 peer 的 fenjing 同步 → 转发给本地 fenjing 客户端
// 在 handleBridgeMessage 中处理

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
let connectPeerId = 0; // 用于 --join 模式生成临时 serverId

function connectToPeer(serverId, name, ip, port) {
  // serverId 可能为 null（--join 模式），用临时 id 占位
  const tempId = serverId || `tmp_${++connectPeerId}`;
  // 已有连接（包括重连等待中），不再新建
  if (peers.has(tempId) || (serverId && peers.has(serverId))) return;

  console.log(`[桥接] 连接 ${name} @ ${ip}:${port}...`);
  const url = `http://${ip}:${port}`;
  const sock = SocketIOClient(url, {
    query: { bridge: 'true' },
    transports: ['websocket'],
    reconnection: true,           // 启用自动重连
    reconnectionDelay: 2000,      // 2秒后开始重试
    reconnectionAttempts: Infinity, // 一直重试
  });

  // 真正的 serverId 在 handshake-ack 中才能知道
  let realServerId = serverId;

  sock.on('connect', () => {
    console.log(`[桥接] ✅ Socket.IO 连到 ${name}`);
    sock.emit('handshake', { serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
  });

  sock.on('handshake-ack', (data) => {
    realServerId = data.serverId;

    // 重连：已有 peer 记录在 grace period 中
    if (peers.has(realServerId)) {
      const ex = peers.get(realServerId);
      if (ex.connected) { sock.disconnect(); return; }
      // 🔄 重连成功
      console.log(`[桥接] 🔄 ${data.name} 重连成功`);
      clearTimeout(ex.reconnectTimer);
      ex.socket = sock; ex.connected = true; ex.reconnectTimer = null;
      broadcastPeers();
      sendToPeer(realServerId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
      sock.on('bridge-msg', (msg) => handleBridgeMessage(realServerId, msg));
      sock.on('disconnect', () => handlePeerDisconnect(realServerId));
      return;
    }

    // 全新连接
    const p = { socket: sock, name: data.name, ip, port, connected: true, note: '', reconnectTimer: null };
    peers.set(realServerId, p);
    if (tempId !== realServerId) peers.delete(tempId); // 清理临时 id
    console.log(`[桥接] ✅ 握手完成，已加入 ${data.name}`);
    foundPeer();
    sendToPeer(realServerId, { type: 'projects-sync', projects: projects.map(x => ({...x})) });
    broadcastPeers();
    sock.on('bridge-msg', (msg) => handleBridgeMessage(realServerId, msg));
    sock.on('disconnect', () => handlePeerDisconnect(realServerId));
  });

  sock.on('connect_error', () => {}); // 静默
  setTimeout(() => { if (!sock.connected) sock.close(); }, 10000);
}

// ─── --join 模式：自动连接目标 ────────────────────────────
function autoJoin() {
  if (!JOIN_TARGET) return;
  const [host, portStr] = JOIN_TARGET.split(':');
  const port = parseInt(portStr) || 3000;
  // serverId 未知，传 null；connectToPeer 会在 handshake-ack 中获得对方的 serverId
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
server.listen(HTTP_PORT, '0.0.0.0', () => {
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
  console.log('╚══════════════════════════════════════════╝');
});
