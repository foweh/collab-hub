// ─── 多机协作创作工作室 服务端 ──────────────────────────
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { io: SocketIOClient } = require('socket.io-client');
const { v4: uuid } = require('uuid');
const path = require('path');
const os = require('os');
const dgram = require('dgram');

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
let projects = [];

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

// ─── 聊天记录 ────────────────────────────────────────────
const chatHistory = [];
const MAX_CHAT = 200;
function addChat(userName, text) {
  const msg = { userName, text, time: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT) chatHistory.splice(0, 100);
  return msg;
}

// ─── 操作审计日志 ────────────────────────────────────────
const operationLog = [];
const MAX_LOG = 500;
let logId = 0;

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
  socket.emit('init', {
    serverId: SERVER_ID, serverName: SERVER_NAME,
    projects: projects.map(p => ({...p})), peers: peerList,
    scanState, chatHistory: chatHistory.slice(-50),
    operationLog: getRecentLogs(50),
  });

  socket.on('join', (name) => {
    SERVER_NAME = name || SERVER_NAME; socket.userName = SERVER_NAME;
    addLog(socket.id, SERVER_NAME, 'joined', 'system', '');
  });
  socket.on('set-server-name', (name) => {
    SERVER_NAME = name || SERVER_NAME; socket.userName = SERVER_NAME; broadcastDiscover();
    for (const [sid, p] of peers) p.socket.emit('bridge-msg', { type: 'peer-rename', serverId: SERVER_ID, name: SERVER_NAME });
  });
  socket.on('lan-toggle', (on) => {
    if (on && scanState === 'idle') { startScan(); broadcastDiscover(); scanInterval = setInterval(broadcastDiscover, 5000); }
    else if (!on) stopScan();
  });
  socket.on('refresh-lan', () => {
    if (scanState === 'nobody' || scanState === 'idle') { startScan(); broadcastDiscover(); scanInterval = setInterval(broadcastDiscover, 5000); }
    else broadcastDiscover();
  });
  socket.on('chat-message', (text) => {
    const name = socket.userName || SERVER_NAME; if (!text || !text.trim()) return;
    const msg = addChat(name, text.trim());
    io.emit('chat-message', msg);
    broadcastToPeers({ type: 'chat', msg }, null);
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
  });
  socket.on('project-update', (data) => {
    const p = projects.find(x => x.id === data.id); if (!p) return;
    if (data.name !== undefined) p.name = data.name;
    if (data.data !== undefined) p.data = data.data;
    p.updatedAt = Date.now();
    socket.emit('project-updated', { id: p.id, name: p.name, data: p.data, updatedAt: p.updatedAt });
    addLog(socket.id, socket.userName || SERVER_NAME, 'updated', p.type, p.name);
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
  });
  socket.on('project-delete', (id) => {
    const p = projects.find(x => x.id === id);
    projects = projects.filter(x => x.id !== id); socket.emit('project-deleted', id);
    if (p) addLog(socket.id, socket.userName || SERVER_NAME, 'deleted', p.type, p.name);
    broadcastToPeers({ type: 'projects-sync', projects: projects.map(x => ({...x})) }, null);
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

  // 断开连接时自动释放此 socket 的所有锁
  socket.on('disconnect', () => {
    // 通知所有 peer 释放此用户的操作锁
    broadcastToPeers({ type: 'focus-release-all', user: socket.userName || SERVER_NAME }, null);
  });
});

// ─── 桥接消息处理 ────────────────────────────────────────
function handleBridgeMessage(fromId, msg) {
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
    case 'chat':
      if (msg.msg) io.emit('chat-message', msg.msg);
      broadcastToPeers(msg, fromId);
      break;
    case 'peer-rename':
      // 对方改了名字
      const p = peers.get(fromId);
      if (p) { p.name = msg.name; broadcastPeers(); }
      break;
  }
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

function getDefaultData(type) {
  switch (type) {
    case 'script': return { acts: [] };
    case 'mindmap': return { nodes: [], edges: [] };
    case 'story': return { chapters: [] };
    case 'storyboard': return { scenes: [], shots: [] };
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
