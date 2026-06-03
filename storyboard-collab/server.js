const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── 共享状态 ──────────────────────────────────────────────
let state = {
  projectName: '未命名分镜',
  frames: [],       // [{ id, strokes: [{points, color, size, eraser}], notes }]
  users: [],        // [{ id, name }]
  messages: [],     // [{ userId, userName, text, time }]
};

let frameCounter = 0;

// ── Socket.IO ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // 新用户获取完整状态 + 分配名字
  socket.emit('state-sync', state);

  // ── 用户加入 ──
  socket.on('join', (name) => {
    const displayName = name || `用户_${socket.id.slice(0, 4)}`;
    const user = { id: socket.id, name: displayName };
    state.users.push(user);
    socket.userData = user;

    // 广播给所有人
    io.emit('user-joined', user);
    io.emit('users-update', state.users.map(u => ({ id: u.id, name: u.name })));
    console.log(`[加入] ${displayName}`);
  });

  // ── 添加帧 ──
  socket.on('add-frame', () => {
    const frame = {
      id: ++frameCounter,
      strokes: [],
      notes: '',
    };
    state.frames.push(frame);
    socket.broadcast.emit('frame-added', frame);
    socket.emit('frame-added', frame);
    console.log(`[帧] 添加 #${frame.id}`);
  });

  // ── 删除帧 ──
  socket.on('delete-frame', (frameId) => {
    state.frames = state.frames.filter(f => f.id !== frameId);
    io.emit('frame-deleted', frameId);
    console.log(`[帧] 删除 #${frameId}`);
  });

  // ── 清空所有帧 ──
  socket.on('clear-frames', () => {
    state.frames = [];
    frameCounter = 0;
    io.emit('frames-cleared');
    console.log(`[帧] 全部清空`);
  });

  // ── 重排帧 ──
  socket.on('reorder-frames', (newOrder) => {
    // newOrder: [id1, id2, id3, ...]
    const map = {};
    state.frames.forEach(f => { map[f.id] = f; });
    state.frames = newOrder.map(id => map[id]).filter(Boolean);
    socket.broadcast.emit('frames-reordered', newOrder);
    console.log(`[帧] 重排`);
  });

  // ── 绘制一笔 ──
  socket.on('draw-stroke', ({ frameId, stroke }) => {
    const frame = state.frames.find(f => f.id === frameId);
    if (frame) {
      frame.strokes.push(stroke);
      // 广播给其他人（排除发送者）
      socket.broadcast.emit('stroke-drawn', { frameId, stroke });
    }
  });

  // ── 撤销 ──
  socket.on('undo-stroke', (frameId) => {
    const frame = state.frames.find(f => f.id === frameId);
    if (frame && frame.strokes.length > 0) {
      const removed = frame.strokes.pop();
      socket.broadcast.emit('stroke-undone', { frameId });
      socket.emit('stroke-undone', { frameId });
    }
  });

  // ── 清空单帧画布 ──
  socket.on('clear-canvas-frame', ({ frameId }) => {
    const frame = state.frames.find(f => f.id === frameId);
    if (frame) {
      frame.strokes = [];
      socket.broadcast.emit('canvas-frame-cleared', { frameId });
      socket.emit('canvas-frame-cleared', { frameId });
      console.log(`[帧] 清空画布 #${frameId}`);
    }
  });

  // ── 更新备注 ──
  socket.on('update-notes', ({ frameId, notes }) => {
    const frame = state.frames.find(f => f.id === frameId);
    if (frame) {
      frame.notes = notes;
      socket.broadcast.emit('notes-updated', { frameId, notes });
    }
  });

  // ── 更新项目名 ──
  socket.on('update-project-name', (name) => {
    state.projectName = name;
    socket.broadcast.emit('project-name-updated', name);
  });

  // ── 聊天 ──
  socket.on('chat-message', (text) => {
    if (!socket.userData) return;
    const msg = {
      userId: socket.userData.id,
      userName: socket.userData.name,
      text,
      time: Date.now(),
    };
    state.messages.push(msg);
    // 保留最近200条
    if (state.messages.length > 200) state.messages.splice(0, 100);
    io.emit('chat-message', msg);
  });

  // ── 断开 ──
  socket.on('disconnect', () => {
    if (socket.userData) {
      state.users = state.users.filter(u => u.id !== socket.id);
      io.emit('user-left', socket.userData.id);
      io.emit('users-update', state.users.map(u => ({ id: u.id, name: u.name })));
      console.log(`[离开] ${socket.userData.name}`);
    }
  });
});

// ── 启动 ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const networkInterfaces = os.networkInterfaces();
  let ip = 'localhost';
  for (const name of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address;
        break;
      }
    }
  }
  console.log('─'.repeat(40));
  console.log('  🎬 分镜协作工具已启动');
  console.log(`  本机:    http://localhost:${PORT}`);
  console.log(`  局域网:  http://${ip}:${PORT}`);
  console.log('  另一台电脑浏览器打开上面地址即可协作');
  console.log('─'.repeat(40));
});
