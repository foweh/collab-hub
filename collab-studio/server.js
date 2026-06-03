// ─── 局域网协作创作工作室 服务端 ──────────────────────────
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
const UDP_PORT = 41234;       // UDP 发现端口
const BRIDGE_PATH = '/bridge'; // server↔server WebSocket 路径

const SERVER_ID = uuid().slice(0, 8);
let SERVER_NAME = os.hostname();

// ─── 存储 ────────────────────────────────────────────────
// 本地项目（不在 localStorage 里，存在内存 + 周期性写入文件简化版本）
let projects = [];      // [{ id, type, name, data, createdAt, updatedAt, owner }]
let peerInfo = null;    // { serverId, name, ip, port, connected }
let peerBridge = null;  // WebSocket 连接到对方的连接

// ─── Express + Socket.IO ─────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for project transfer
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── UDP 局域网发现 ──────────────────────────────────────
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

udp.on('error', (err) => {
  console.log(`[UDP] 错误: ${err.message}`);
});

udp.on('message', (msg, rinfo) => {
  try {
    const pkt = JSON.parse(msg.toString());
    if (pkt.type === 'discover') {
      // 对方在找我们，回复 hello
      const reply = JSON.stringify({
        type: 'hello',
        serverId: SERVER_ID,
        name: SERVER_NAME,
        port: HTTP_PORT,
      });
      udp.send(reply, rinfo.port, rinfo.address, (err) => {
        if (err) console.log(`[UDP] 回复失败: ${err.message}`);
      });
    } else if (pkt.type === 'hello') {
      // 收到对方回复
      if (pkt.serverId !== SERVER_ID) {
        console.log(`\n[发现] 检测到设备: ${pkt.name} (${pkt.serverId}) @ ${rinfo.address}:${pkt.port}`);
        connectToPeer(pkt.serverId, pkt.name, rinfo.address, pkt.port);
      }
    }
  } catch (e) {
    // ignore malformed
  }
});

udp.bind(UDP_PORT, () => {
  udp.setBroadcast(true);
  console.log(`[UDP] 发现服务已启动 (端口 ${UDP_PORT})`);
});

// 定时广播发现包
function broadcastDiscover() {
  const pkt = JSON.stringify({ type: 'discover', serverId: SERVER_ID, name: SERVER_NAME, port: HTTP_PORT });
  udp.send(pkt, UDP_PORT, '255.255.255.255', (err) => {
    if (err) /* ignore */;
  });
}
// 每 5 秒广播一次
setInterval(broadcastDiscover, 5000);
// 启动后 1 秒发第一次
setTimeout(broadcastDiscover, 1000);

// ─── Server↔Server WebSocket 桥接 ────────────────────────
// 在 Express server 上创建 raw WebSocket server 用于桥接
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

// 对方连接过来
bridgeWss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress.replace(/^::ffff:/, '');
  console.log(`[桥接] 对方从 ${remoteIp} 连接过来`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleBridgeMessage(ws, msg);
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    console.log('[桥接] 对方断开连接');
    peerBridge = null;
    if (peerInfo) {
      peerInfo.connected = false;
      broadcastToBrowsers({ type: 'peer-status', peer: peerInfo });
    }
  });

  // 发送 handshake
  ws.send(JSON.stringify({
    type: 'handshake',
    serverId: SERVER_ID,
    name: SERVER_NAME,
    port: HTTP_PORT,
  }));
});

// 主动连接对方
function connectToPeer(serverId, name, ip, port) {
  if (peerBridge && peerInfo && peerInfo.serverId === serverId && peerInfo.connected) {
    return; // 已连接
  }

  const url = `ws://${ip}:${port}${BRIDGE_PATH}`;
  console.log(`[桥接] 正在连接 ${name} (${url})...`);

  // 用轻量级 ws 连接
  const ws = new WebSocket(url);
  let connected = false;

  ws.on('open', () => {
    connected = true;
    peerBridge = ws;
    peerInfo = { serverId, name, ip, port, connected: true };
    console.log(`[桥接] ✅ 已连接到 ${name}`);

    // 发送 handshake
    ws.send(JSON.stringify({
      type: 'handshake',
      serverId: SERVER_ID,
      name: SERVER_NAME,
      port: HTTP_PORT,
    }));

    // 通知浏览器
    broadcastToBrowsers({ type: 'peer-status', peer: peerInfo });
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleBridgeMessage(ws, msg);
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    if (connected) {
      console.log(`[桥接] ${name} 断开连接`);
    }
    peerBridge = null;
    if (peerInfo) {
      peerInfo.connected = false;
      broadcastToBrowsers({ type: 'peer-status', peer: peerInfo });
    }
  });

  ws.on('error', (err) => {
    // 连接失败是正常的（对方可能未启动）
    if (!connected) {
      // 静默忽略首次连接失败
    }
  });

  // 10秒超时
  setTimeout(() => {
    if (!connected) {
      ws.close();
    }
  }, 10000);
}

// ─── 桥接消息处理 ────────────────────────────────────────
function handleBridgeMessage(ws, msg) {
  switch (msg.type) {
    case 'handshake':
      if (!peerInfo) {
        peerInfo = {
          serverId: msg.serverId,
          name: msg.name,
          port: msg.port,
          connected: true,
        };
        peerBridge = ws;
        console.log(`[桥接] ✅ 握手成功: ${msg.name}`);
        // 同步项目给对方
        ws.send(JSON.stringify({
          type: 'projects-sync',
          projects: projects,
        }));
        broadcastToBrowsers({ type: 'peer-status', peer: peerInfo });
      }
      break;

    case 'projects-sync':
      // 收到对方发来的项目列表（全量同步）
      console.log(`[同步] 收到 ${msg.projects.length} 个项目`);
      // 合并：对方的项目如果本地没有则添加
      msg.projects.forEach(remoteP => {
        const existing = projects.find(p => p.id === remoteP.id);
        if (!existing) {
          projects.push(remoteP);
        } else if (remoteP.updatedAt > existing.updatedAt) {
          Object.assign(existing, remoteP);
        }
      });
      broadcastToBrowsers({ type: 'projects-update', projects: getLocalProjects() });
      break;

    case 'project-transfer':
      // 对方发送项目给我们
      console.log(`[传输] 收到 ${msg.projects.length} 个项目`);
      const newOnes = [];
      msg.projects.forEach(p => {
        const existing = projects.find(x => x.id === p.id);
        if (!existing) {
          projects.push(p);
          newOnes.push(p);
        }
      });
      broadcastToBrowsers({ type: 'projects-received', projects: newOnes, from: msg.fromName });
      broadcastToBrowsers({ type: 'projects-update', projects: getLocalProjects() });
      break;

    case 'realtime':
      // 对方转发过来的实时编辑事件 → 广播给所有浏览器客户端
      io.emit(msg.event, msg.data);
      break;

    case 'forward-to-peer':
      // 浏览器发来要转发给对方的
      if (peerBridge && peerBridge.readyState === WebSocket.OPEN) {
        peerBridge.send(JSON.stringify(msg.payload));
      }
      break;
  }
}

// 广播消息给所有浏览器客户端
function broadcastToBrowsers(data) {
  io.emit('bridge-message', data);
}

// 获取本地项目（去掉内部字段）
function getLocalProjects() {
  return projects.map(p => ({ ...p }));
}

// ─── Socket.IO (浏览器客户端) ────────────────────────────
io.on('connection', (socket) => {
  console.log(`[浏览器] 客户端连接 ${socket.id}`);

  // 发送当前状态
  socket.emit('init', {
    serverId: SERVER_ID,
    serverName: SERVER_NAME,
    projects: getLocalProjects(),
    peer: peerInfo ? { ...peerInfo } : null,
  });

  // 用户加入/命名
  socket.on('join', (name) => {
    if (name) SERVER_NAME = name;
    socket.userName = name || SERVER_NAME;
    console.log(`[用户] ${socket.userName} 加入`);
  });

  socket.on('set-server-name', (name) => {
    SERVER_NAME = name || SERVER_NAME;
    socket.userName = SERVER_NAME;
    broadcastDiscover(); // 让对方知道新名字
  });

  socket.on('lan-toggle', (on) => {
    // UDP 广播始终在运行；这里只是客户端状态
  });

  socket.on('refresh-lan', () => {
    broadcastDiscover();
  });

  socket.on('peer-note', (data) => {
    if (peerInfo) {
      peerInfo.note = data.note || '';
      broadcastToBrowsers({ type: 'peer-status', peer: { ...peerInfo } });
    }
  });

  // 项目操作
  socket.on('project-create', (data) => {
    const p = {
      id: uuid().slice(0, 12),
      type: data.type,
      name: data.name || '未命名',
      data: data.data || getDefaultData(data.type),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      owner: SERVER_NAME,
    };
    projects.push(p);
    socket.emit('project-created', p);
    broadcastToAllPeers({ type: 'projects-sync', projects: getLocalProjects() });
  });

  socket.on('project-update', (data) => {
    const p = projects.find(x => x.id === data.id);
    if (p) {
      if (data.name !== undefined) p.name = data.name;
      if (data.data !== undefined) p.data = data.data;
      p.updatedAt = Date.now();
      socket.emit('project-updated', { id: p.id, name: p.name, data: p.data, updatedAt: p.updatedAt });
      // 实时转发给对方
      forwardToPeer({ type: 'projects-sync', projects: getLocalProjects() });
    }
  });

  socket.on('project-delete', (id) => {
    projects = projects.filter(p => p.id !== id);
    socket.emit('project-deleted', id);
    forwardToPeer({ type: 'projects-sync', projects: getLocalProjects() });
  });

  socket.on('project-transfer', (data) => {
    // 选择项目发送给对方
    const toSend = projects.filter(p => data.ids.includes(p.id));
    if (toSend.length > 0 && peerBridge && peerBridge.readyState === WebSocket.OPEN) {
      peerBridge.send(JSON.stringify({
        type: 'project-transfer',
        projects: toSend.map(p => ({ ...p })),
        fromName: SERVER_NAME,
      }));
      socket.emit('transfer-sent', { count: toSend.length, to: peerInfo.name });
    } else {
      socket.emit('transfer-failed', { reason: peerInfo ? '对方不在线' : '未发现设备' });
    }
  });

  // 实时编辑转发（剧本/思维导图/故事）
  socket.on('realtime-event', (data) => {
    // data: { module, event, payload }
    // 转发给所有浏览器（包括自己）
    io.emit(data.event, data.payload);
    // 转发给对方服务器
    forwardToPeer({
      type: 'realtime',
      event: data.event,
      data: data.payload,
    });
  });


});

function forwardToPeer(msg) {
  if (peerBridge && peerBridge.readyState === WebSocket.OPEN) {
    peerBridge.send(JSON.stringify(msg));
  }
}

// 广播给所有连接的对等服务器
function broadcastToAllPeers(msg) {
  forwardToPeer(msg);
}

// 默认数据模板
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
        ip = iface.address;
        break;
      }
    }
  }
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     🎬 协作创作工作室 v1.0               ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  服务ID: ${SERVER_ID.padEnd(28)}║`);
  console.log(`║  本机名: ${SERVER_NAME.padEnd(27)}║`);
  console.log(`║  本机:   http://localhost:${HTTP_PORT}${' '.repeat(16 - String(HTTP_PORT).length)}║`);
  console.log(`║  局域网: http://${ip}:${HTTP_PORT}${' '.repeat(Math.max(0, 26 - ip.length - String(HTTP_PORT).length))}║`);
  console.log('║                                        ║');
  console.log('║  打开页面后点击"开启局域网"按钮        ║');
  console.log('║  两台电脑在同一网段即可自动发现对方     ║');
  console.log('╚══════════════════════════════════════════╝');
});
