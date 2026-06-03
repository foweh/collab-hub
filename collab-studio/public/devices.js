// ─── 设备管理 ────────────────────────────────────────────
(function() {

const deviceList = $('#device-list');
let localPeerNote = '';

// ─── 渲染设备 ────────────────────────────────────────────
function renderDevices() {
  deviceList.innerHTML = '';

  // 本机
  const selfCard = createDeviceCard({
    id: socket.id || 'self',
    name: myName || '我',
    isSelf: true,
    online: true,
    note: '',
    ip: '本机',
    serverId: serverId,
  });
  deviceList.appendChild(selfCard);

  // 对方
  if (peer && peer.connected) {
    const peerCard = createDeviceCard({
      id: peer.serverId,
      name: peer.name || '未知',
      isSelf: false,
      online: true,
      note: peer.note || '',
      ip: peer.ip || '局域网',
      serverId: peer.serverId,
    });
    deviceList.appendChild(peerCard);
  } else {
    const emptyCard = document.createElement('div');
    emptyCard.className = 'device-card';
    emptyCard.innerHTML = `
      <div class="d-status offline"></div>
      <div class="d-info">
        <div class="d-name" style="color:var(--text-dim)">暂无其他设备</div>
        <div class="d-meta">开启局域网模式后自动搜索</div>
      </div>
    `;
    deviceList.appendChild(emptyCard);
  }
}

function createDeviceCard(info) {
  const div = document.createElement('div');
  div.className = 'device-card';
  div.innerHTML = `
    <div class="d-status ${info.online ? 'online' : 'offline'}"></div>
    <div class="d-info">
      <div class="d-name">${info.isSelf ? '🖥️ ' : '💻 '}${esc(info.name)} ${info.isSelf ? '(我)' : ''}</div>
      <div class="d-note" id="d-note-display-${info.id}">${info.note ? `📝 ${esc(info.note)}` : ''}</div>
      <div class="d-meta">${info.ip} · ID: ${info.serverId || info.id}</div>
      ${!info.isSelf ? `
        <input class="d-note-input" id="d-note-input-${info.id}" placeholder="给对方添加备注..." value="${esc(info.note || '')}">
      ` : ''}
    </div>
  `;

  if (!info.isSelf) {
    const noteInput = div.querySelector('.d-note-input');
    const noteDisplay = div.querySelector('.d-note');
    noteInput.addEventListener('change', () => {
      const note = noteInput.value.trim();
      socket.emit('peer-note', { note });
      noteDisplay.textContent = note ? `📝 ${note}` : '';
    });
  }

  return div;
}

// ─── 监听状态变更 ────────────────────────────────────────
socket.on('peer-status', (data) => {
  if (data.peer) peer = data.peer;
  renderDevices();
});

socket.on('users-update', () => {
  renderDevices();
});

// ─── 初始渲染 ────────────────────────────────────────────
// app.js 中 initUI 后会调用
// 每次切换到设备面板时刷新
document.querySelector('.nav-btn[data-module="devices"]').addEventListener('click', () => {
  setTimeout(renderDevices, 100);
});

// 导出
window.renderDevices = renderDevices;

})();
