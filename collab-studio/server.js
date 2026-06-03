// ─── 多机协作创作工作室 服务端 ──────────────────────────
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { v4: uuid } = require('uuid');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const WebSocket = require('ws');

// ─── 配置 ────────────────────────────────────────────────
const HTTP_PORT = parseInt(process.env.PORT) || 3000;
const UDP_PORT = 41234;
const BRIDGE_PATH = '/bridge';
const SCAN_DURATION = 5 * 60 * 1000; // 5分钟

const SERVER_ID = uuid().slice(0, 8);
let SERVER_NAME = os.hostname();

// ─── 多 peer 存储 ────────────────────────────────────────
// peers: Map<serverId, { ws, name, ip, port, connected, note, incoming }>
const peers = new Map();
let projects = [];

// ─── 扫描状态 ────────────────────────────────────────────
let scanState = 'idle';   // 'idle' | 'scanning' | 'found' | 'nobody'
let scanTimer = null;
let scanInterval = null;

function startScan() {
  scanState = 'scanning';
  broadcastScanState();

  // 5分钟定时器
  scanTimer = setTimeout(() => {
    if (peers.size === 0) {
      scanState = 'nobody';
      broadcastScanState();
      // 停止广播
      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
      }
      console.log('[扫描] 5分钟结束，未发现设备');
    }
  }, SCAN_DURATION);
}

function stopScan() {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (scanState === 'scanning') scanState = 'idle';
  broadcastScanState();
}

function foundPeer() {
  if (scanState === 'scanning') {
    scanState = 'found';
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    broadcastScanState();
    console.log('[扫描] ✅ 发现设备，扫描结束');
  }
}

function broadcastScanState() {
  io.emit('scan-state', { state: scanState });
}

// ─── 聊天记录 ────────────────────────────────────────────
const chatHistory = []; // [{ userName, text, time }]
const MAX_CHAT = 200;

function addChat(userName, text) {
  const msg = { userName, text, time: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT) chatHistory.splice(0, 100);
  return msg;
}

// ─── 消息去重（防回环） ──────────────────────────────────
const seenMessages = new Map(); // msgId → timestamp
const DEDUP_TTL = 30000;       // 30秒后清理

function isDuplicate(msgId) {
  if (!msgId) return false;
  if (seenMessages.has(msgId)) return true;
  seenMessages.set(msgId, Date.now());
  return false;
}

// 每 60 秒清理过期 msgId
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of seenMessages) {
    if (now - ts > DEDUP_TTL) seenMessages.delete(id);
  }
}, 60000);

// ─── Express + Socket.IO ─────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024,
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── UDP 局域网发现 ──────────────────────────────────────
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udp.on('error', (err) => console.log(`[UDP] 错误: ${err.message}`));

udp.on('message', (msg, rinfo) => {
  try {
    const pkt = JSON.parse(msg.toString());
    if (pkt.type === 'discover') {
      // 回复 hello
      const reply = JSON.stringify({ type: 'hello', serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
      udp.send(reply, rinfo.port, rinfo.address);
    } else if (pkt.type === 'hello') {
      if (pkt.serverId === SERVER_ID) return; // 忽略自己
      if (peers.has(pkt.serverId)) {
        // 已连接，更新名字
        const p = peers.get(pkt.serverId);
        p.name = pkt.name;
        broadcastPeers();
        return;
      }
      console.log(`\n[发现] ${pkt.name} (${pkt.serverId}) @ ${rinfo.address}:${pkt.port}`);
      // 仲裁：serverId 小的主动连接
      if (SERVER_ID < pkt.serverId) {
        console.log(`  → 我(ID较小)主动连接 ${pkt.name}`);
        connectToPeer(pkt.serverId, pkt.name, rinfo.address, pkt.port);
      } else {
        console.log(`  → 等待 ${pkt.name} 连我(ID较大)`);
      }
    }
  } catch (e) { /* ignore */ }
});

udp.bind(UDP_PORT, () => {
  udp.setBroadcast(true);
  console.log(`[UDP] 发现服务已启动 (端口 ${UDP_PORT})`);
});

function broadcastDiscover() {
  const pkt = JSON.stringify({ type: 'discover', serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
  udp.send(pkt, UDP_PORT, '255.255.255.255');
}
setInterval(broadcastDiscover, 5000);
setTimeout(broadcastDiscover, 1000);

// ─── WebSocket 桥接 ──────────────────────────────────────
const bridgeWss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://localhost`);
  if (url.pathname === BRIDGE_PATH) {
    bridgeWss.handleUpgrade(request, socket, head, (ws) => {
      bridgeWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// 对方主动连过来
bridgeWss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress.replace(/^::ffff:/, '');
  console.log(`[桥接] 收到来自 ${remoteIp} 的连接`);
  let handshakeDone = false;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'handshake') {
        if (handshakeDone) return;
        handshakeDone = true;

        const sid = msg.serverId;
        if (sid === SERVER_ID) { ws.close(); return; }

        // 如果已有此 peer 连接，关闭老的
        const existing = peers.get(sid);
        if (existing && existing.connected) {
          console.log(`  → 已有 ${msg.name} 的连接，跳过`);
          ws.close();
          return;
        }

        const p = {
          ws, name: msg.name, ip: remoteIp,
          port: msg.port, connected: true,
          note: '', incoming: true,
        };
        peers.set(sid, p);
        console.log(`[桥接] ✅ 已接受 ${msg.name} 连接`);
        foundPeer(); // 扫描状态下标记已发现

        // 同步项目给对方
        sendToPeer(ws, { type: 'projects-sync', projects: getLocalProjects() });
        broadcastPeers();

        ws.on('close', () => {
          console.log(`[桥接] ${p.name} 断开`);
          peers.delete(sid);
          broadcastPeers();
        });
        return;
      }

      // 普通消息（handshake 之后）
      handleBridgeMessage(ws, msg);

    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    if (handshakeDone) return; // 已在上面处理
  });
});

// 主动连接对方
function connectToPeer(serverId, name, ip, port) {
  if (peers.has(serverId) && peers.get(serverId).connected) return;

  const url = `ws://${ip}:${port}${BRIDGE_PATH}`;
  console.log(`[桥接] 连接 ${name} (${url})...`);
  const ws = new WebSocket(url);
  let connected = false;

  ws.on('open', () => {
    connected = true;
    const p = { ws, name, ip, port, connected: true, note: '', incoming: false };
    peers.set(serverId, p);
    console.log(`[桥接] ✅ 已连接到 ${name}`);
    foundPeer(); // 扫描状态下标记已发现

    ws.send(JSON.stringify({ type: 'handshake', serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT }));
    broadcastPeers();
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleBridgeMessage(ws, msg);
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    if (connected) console.log(`[桥接] ${name} 断开`);
    peers.delete(serverId);
    broadcastPeers();
  });

  ws.on('error', () => { /* 连接失败正常 */ });

  setTimeout(() => { if (!connected) ws.close(); }, 10000);
}

// ─── 桥接消息处理 ────────────────────────────────────────
function handleBridgeMessage(ws, msg) {
  // 找出这个 ws 对应的 peer serverId
  let fromId = null;
  for (const [sid, p] of peers) {
    if (p.ws === ws) { fromId = sid; break; }
  }

  switch (msg.type) {
    case 'projects-sync':
      console.log(`[同步] 收到 ${msg.projects.length} 个项目`);
      mergeProjects(msg.projects);
      broadcastToBrowsers({ type: 'projects-update' });
      // 转发给其他 peer
      broadcastToPeers(msg, fromId);
      break;

    case 'project-transfer':
      console.log(`[传输] 收到 ${msg.projects.length} 个项目`);
      const newOnes = [];
      msg.projects.forEach(p => {
        if (!projects.find(x => x.id === p.id)) {
          projects.push({...p});
          newOnes.push(p);
        }
      });
      broadcastToBrowsers({ type: 'projects-received', projects: newOnes, from: msg.fromName });
      broadcastToBrowsers({ type: 'projects-update' });
      broadcastToPeers(msg, fromId);
      break;

    case 'realtime':
      // 去重：检查 msgId 是否见过
      if (msg._msgId && isDuplicate(msg._msgId)) break;
      // 实时编辑事件 → 广播给本机浏览器 + 转发给其他 peer
      broadcastToBrowsers({ type: 'realtime', origin: msg.origin, event: msg.event, data: msg.data });
      if (msg.origin !== SERVER_ID) {
        io.emit(msg.event, msg.data);
      }
      if (msg._msgId) {
        broadcastToPeers(msg, fromId);
      }
      break;

    case 'chat':
      // 来自 peer 的聊天消息 → 广播给本机所有浏览器
      if (msg.msg) io.emit('chat-message', msg.msg);
      // 继续转发给其他 peer
      broadcastToPeers(msg, fromId);
      break;

    case 'forward-to-peer':
      broadcastToPeers(msg.payload, fromId);
      break;
  }
}

// ─── 项目合并 ────────────────────────────────────────────
function mergeProjects(remoteList) {
  remoteList.forEach(rp => {
    const local = projects.find(p => p.id === rp.id);
    if (!local) {
      projects.push({...rp});
    } else if (rp.updatedAt > local.updatedAt) {
      Object.assign(local, rp);
    }
  });
}

// ─── 广播工具 ────────────────────────────────────────────
function broadcastToBrowsers(data) {
  io.emit('bridge-message', data);
}

function broadcastToPeers(msg, excludeId) {
  for (const [sid, p] of peers) {
    if (sid !== excludeId && p.connected) {
      sendToPeer(p.ws, msg);
    }
  }
}

function sendToPeer(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastPeers() {
  const list = [];
  for (const [sid, p] of peers) {
    if (p.connected) {
      list.push({ serverId: sid, name: p.name, ip: p.ip, port: p.port, connected: true, note: p.note || '' });
    }
  }
  broadcastToBrowsers({ type: 'peers-update', peers: list });
}

function getLocalProjects() {
  return projects.map(p => ({ ...p }));
}

// ─── Socket.IO (浏览器) ──────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[浏览器] ${socket.id}`);

  // 发送初始状态
  const peerList = [];
  for (const [sid, p] of peers) {
    if (p.connected) peerList.push({ serverId: sid, name: p.name, ip: p.ip, port: p.port, connected: true, note: p.note || '' });
  }
  socket.emit('init', {
    serverId: SERVER_ID, serverName: SERVER_NAME,
    projects: getLocalProjects(), peers: peerList,
    scanState, chatHistory: chatHistory.slice(-50),
  });

  socket.on('join', (name) => {
    if (name) SERVER_NAME = name;
    socket.userName = name || SERVER_NAME;
    console.log(`[用户] ${socket.userName}`);
  });

  socket.on('set-server-name', (name) => {
    SERVER_NAME = name || SERVER_NAME;
    socket.userName = SERVER_NAME;
    broadcastDiscover();
    // 更新所有 peer 的名字
    for (const [sid, p] of peers) {
      sendToPeer(p.ws, { type: 'peer-rename', serverId: SERVER_ID, name: SERVER_NAME });
    }
  });

  socket.on('lan-toggle', (on) => {
    if (on && scanState === 'idle') {
      startScan();
      broadcastDiscover();
      scanInterval = setInterval(broadcastDiscover, 5000);
    } else if (!on) {
      stopScan();
    }
  });

  socket.on('refresh-lan', () => {
    if (scanState === 'nobody' || scanState === 'idle') {
      startScan();
      broadcastDiscover();
      scanInterval = setInterval(broadcastDiscover, 5000);
    } else {
      broadcastDiscover();
    }
  });

  // ── 群聊 ──
  socket.on('chat-message', (text) => {
    const name = socket.userName || SERVER_NAME;
    if (!text || !text.trim()) return;
    const msg = addChat(name, text.trim());
    // 广播给所有本机浏览器
    io.emit('chat-message', msg);
    // 转发给所有 peer
    broadcastToPeers({ type: 'chat', msg }, null);
  });

  socket.on('peer-note', ({ serverId, note }) => {
    if (peers.has(serverId)) {
      peers.get(serverId).note = note || '';
      broadcastPeers();
    }
  });

  // ── 项目 CRUD ──
  socket.on('project-create', (data) => {
    const p = {
      id: uuid().slice(0, 12),
      type: data.type, name: data.name || '未命名',
      data: data.data || getDefaultData(data.type),
      createdAt: Date.now(), updatedAt: Date.now(),
      owner: SERVER_NAME,
    };
    projects.push(p);
    socket.emit('project-created', p);
    broadcastToPeers({ type: 'projects-sync', projects: getLocalProjects() }, null);
  });

  socket.on('project-update', (data) => {
    const p = projects.find(x => x.id === data.id);
    if (p) {
      if (data.name !== undefined) p.name = data.name;
      if (data.data !== undefined) p.data = data.data;
      p.updatedAt = Date.now();
      socket.emit('project-updated', { id: p.id, name: p.name, data: p.data, updatedAt: p.updatedAt });
      broadcastToPeers({ type: 'projects-sync', projects: getLocalProjects() }, null);
    }
  });

  socket.on('project-delete', (id) => {
    projects = projects.filter(p => p.id !== id);
    socket.emit('project-deleted', id);
    broadcastToPeers({ type: 'projects-sync', projects: getLocalProjects() }, null);
  });

  socket.on('project-transfer', ({ ids, targetServerId }) => {
    const toSend = projects.filter(p => ids.includes(p.id));
    if (toSend.length === 0) return;
    const targetPeer = peers.get(targetServerId);
    if (targetPeer && targetPeer.connected) {
      sendToPeer(targetPeer.ws, {
        type: 'project-transfer',
        projects: toSend.map(p => ({...p})),
        fromName: SERVER_NAME, fromId: SERVER_ID,
      });
      socket.emit('transfer-sent', { count: toSend.length, to: targetPeer.name });
    } else {
      socket.emit('transfer-failed', { reason: '对方不在线' });
    }
  });

  // ── 实时编辑（带 origin 防回环） ──
  socket.on('realtime-event', (data) => {
    const msg = {
      type: 'realtime',
      _msgId: uuid(),
      origin: SERVER_ID,
      event: data.event,
      data: data.payload,
    };
    // 广播给本机所有浏览器
    socket.broadcast.emit(data.event, data.payload);
    // 转发给所有 peer
    broadcastToPeers(msg, null);
  });
});

// ─── 工具 ────────────────────────────────────────────────
function getDefaultData(type) {
  switch (type) {
    case 'script': return { acts: [] };
    case 'mindmap': return { nodes: [], edges: [] };
    case 'story': return { chapters: [] };
    default: return {};
  }
}

// ─── 启动 ────────────────────────────────────────────────
server.listen(HTTP_PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  let ip = 'localhost';
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address; break;
      }
    }
  }
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    🎬 多机协作创作工作室 v2.0            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  服务ID: ${SERVER_ID.padEnd(28)}║`);
  console.log(`║  本机名: ${SERVER_NAME.padEnd(27)}║`);
  console.log(`║  本机:   http://localhost:${HTTP_PORT}${' '.repeat(16 - String(HTTP_PORT).length)}║`);
  console.log(`║  局域网: http://${ip}:${HTTP_PORT}${' '.repeat(Math.max(0, 26 - ip.length - String(HTTP_PORT).length))}║`);
  console.log('║                                        ║');
  console.log('║  多台电脑打开页面 → 开启局域网          ║');
  console.log('║  自动发现并组建协作网络                  ║');
  console.log('╚══════════════════════════════════════════╝');
});
