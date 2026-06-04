// ─── 分镜编辑器 Storyboard Editor ────────────────────────
(function() {

let currentProject = null;
let scenes = [];
let shots = [];
let currentSceneId = null;
let selectedShotIds = new Set();
let shotCounter = 0;

// 列配置
const COLUMNS = [
  { key: 'select', width: 36 },
  { key: 'order',  label: '#',     width: 40 },
  { key: 'number', label: '镜号',  width: 50 },
  { key: 'image',  label: '画面',  width: 100 },
  { key: 'frame',  label: '景别',  width: 60 },
  { key: 'duration', label: '时长', width: 50 },
  { key: 'content', label: '内容', width: 120, flex: true },
  { key: 'notes',  label: '备注',  width: 80, flex: true },
  { key: 'reference', label: '参考', width: 80, flex: true },
  { key: 'sceneExpect', label: '场面期待', width: 80, flex: true },
  { key: 'sound',  label: '声音',  width: 60 },
  { key: 'camera', label: '运镜',  width: 60 },
];

// DOM
const titleEl = document.getElementById('storyboard-title');
const sceneList = document.getElementById('sb-scene-list');
const shotBody = document.getElementById('sb-shot-body');
const shotCount = document.getElementById('sb-shot-count');
const selectAllCb = document.getElementById('sb-select-all');

// ─── 工具 ────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function uid() {
  return 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveData() {
  if (!currentProject) return;
  currentProject.data = { scenes, shots };
  // 更新到服务端
  if (window.CollabStudio && CollabStudio.socket) {
    CollabStudio.socket.emit('project-update', {
      id: currentProject.id,
      data: { scenes, shots },
    });
  }
}

// ─── 场次管理 ────────────────────────────────────────────
function renderScenes() {
  sceneList.innerHTML = '';
  if (scenes.length === 0) {
    sceneList.innerHTML = '<div class="editor-placeholder">无场次，点击上方添加</div>';
    return;
  }
  scenes.forEach(s => {
    const div = document.createElement('div');
    div.className = 'sb-scene-item' + (s.id === currentSceneId ? ' active' : '');
    const shotCount = shots.filter(sh => sh.sceneId === s.id).length;
    div.innerHTML = `
      <div class="sb-scene-name" title="双击重命名">${esc(s.name)} <span class="sb-scene-count">${shotCount}</span></div>
      <button class="sb-scene-del" data-id="${s.id}" title="删除场次">×</button>
    `;
    div.addEventListener('click', () => selectScene(s.id));
    div.querySelector('.sb-scene-name').addEventListener('dblclick', () => renameScene(s.id));
    div.querySelector('.sb-scene-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`删除场次「${s.name}」？将同时删除该场次下所有镜头。`)) {
        scenes = scenes.filter(x => x.id !== s.id);
        shots = shots.filter(x => x.sceneId !== s.id);
        if (currentSceneId === s.id) currentSceneId = scenes.length > 0 ? scenes[0].id : null;
        renderScenes();
        renderShots();
        saveData();
      }
    });
    sceneList.appendChild(div);
  });
}

function selectScene(sceneId) {
  currentSceneId = sceneId;
  selectedShotIds.clear();
  if (selectAllCb) selectAllCb.checked = false;
  renderScenes();
  renderShots();
}

function renameScene(sceneId) {
  const s = scenes.find(x => x.id === sceneId);
  if (!s) return;
  const name = prompt('场次名称:', s.name);
  if (name && name.trim()) {
    s.name = name.trim();
    renderScenes();
    saveData();
  }
}

document.getElementById('sb-add-scene').addEventListener('click', () => {
  const name = prompt('场次名称:', `第 ${scenes.length + 1} 场`);
  if (!name || !name.trim()) return;
  const scene = { id: uid(), name: name.trim(), order: scenes.length + 1 };
  scenes.push(scene);
  currentSceneId = scene.id;
  renderScenes();
  renderShots();
  saveData();
});

// ─── 镜头表格 ────────────────────────────────────────────
function renderShots() {
  if (!currentSceneId) {
    shotBody.innerHTML = '<tr><td colspan="12" class="editor-placeholder">请先选择场次</td></tr>';
    if (shotCount) shotCount.textContent = '';
    return;
  }
  const sceneShots = shots
    .filter(s => s.sceneId === currentSceneId)
    .sort((a, b) => a.order - b.order);

  if (shotCount) shotCount.textContent = `${sceneShots.length} 个镜头`;

  if (sceneShots.length === 0) {
    shotBody.innerHTML = '<tr><td colspan="12" class="editor-placeholder">暂无镜头，点击上方添加</td></tr>';
    return;
  }

  let html = '';
  sceneShots.forEach(s => {
    const sel = selectedShotIds.has(s.id) ? ' checked' : '';
    html += `<tr class="sb-shot-row${selectedShotIds.has(s.id) ? ' selected' : ''}" data-id="${s.id}">
      <td><input type="checkbox" class="sb-shot-cb"${sel}></td>
      <td class="sb-cell-order">${s.order}</td>
      <td class="sb-cell-num">${s.number}</td>
      <td class="sb-cell-img">${s.image ? `<img src="${esc(s.image)}" class="sb-thumb" title="点击更换">` : `<span class="sb-img-placeholder" title="点击添加画面">+</span>`}</td>
      <td class="sb-cell-text" data-field="frame">${esc(s.frame)}</td>
      <td class="sb-cell-text" data-field="duration">${s.duration}</td>
      <td class="sb-cell-text" data-field="content">${esc(s.content)}</td>
      <td class="sb-cell-text" data-field="notes">${esc(s.notes)}</td>
      <td class="sb-cell-text" data-field="reference">${esc(s.reference)}</td>
      <td class="sb-cell-text" data-field="sceneExpect">${esc(s.sceneExpect)}</td>
      <td class="sb-cell-text" data-field="sound">${esc(s.sound)}</td>
      <td class="sb-cell-text" data-field="camera">${esc(s.camera)}</td>
    </tr>`;
  });
  shotBody.innerHTML = html;

  // 绑定事件
  shotBody.querySelectorAll('.sb-shot-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('tr').dataset.id;
      if (e.target.checked) selectedShotIds.add(id);
      else selectedShotIds.delete(id);
      e.target.closest('tr').classList.toggle('selected', e.target.checked);
      updateSelectAll();
    });
  });

  // 点击图片上传
  shotBody.querySelectorAll('.sb-cell-img').forEach(cell => {
    cell.addEventListener('click', (e) => {
      const id = e.currentTarget.closest('tr').dataset.id;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const shot = shots.find(x => x.id === id);
            if (shot) {
              shot.image = ev.target.result;
              renderShots();
              saveData();
            }
          };
          reader.readAsDataURL(input.files[0]);
        }
      });
      input.click();
    });
  });

  // 点击空白占位符上传
  shotBody.querySelectorAll('.sb-img-placeholder').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.closest('tr').dataset.id;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const shot = shots.find(x => x.id === id);
            if (shot) {
              shot.image = ev.target.result;
              renderShots();
              saveData();
            }
          };
          reader.readAsDataURL(input.files[0]);
        }
      });
      input.click();
    });
  });

  // 可编辑单元格
  shotBody.querySelectorAll('.sb-cell-text').forEach(cell => {
    cell.addEventListener('dblclick', () => {
      const id = cell.closest('tr').dataset.id;
      const field = cell.dataset.field;
      const shot = shots.find(x => x.id === id);
      if (!shot) return;
      const current = String(shot[field] || '');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sb-cell-input';
      input.value = current;
      input.dataset.field = field;
      input.dataset.shotId = id;
      cell.innerHTML = '';
      cell.appendChild(input);
      input.focus();
      input.select();
      input.addEventListener('blur', () => finishCellEdit(input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  });
}

function finishCellEdit(input) {
  const id = input.dataset.shotId;
  const field = input.dataset.field;
  const shot = shots.find(x => x.id === id);
  if (!shot) return;
  const val = field === 'duration' ? Number(input.value) || 0 : input.value;
  shot[field] = val;
  renderShots();
  saveData();
}

function updateSelectAll() {
  if (!selectAllCb) return;
  const cbs = shotBody.querySelectorAll('.sb-shot-cb');
  const checked = shotBody.querySelectorAll('.sb-shot-cb:checked');
  selectAllCb.checked = cbs.length > 0 && checked.length === cbs.length;
  selectAllCb.indeterminate = checked.length > 0 && checked.length < cbs.length;
}

selectAllCb && selectAllCb.addEventListener('change', (e) => {
  shotBody.querySelectorAll('.sb-shot-cb').forEach(cb => {
    cb.checked = e.target.checked;
    cb.dispatchEvent(new Event('change'));
  });
});

// 添加镜头
document.getElementById('sb-add-shot').addEventListener('click', () => {
  if (!currentSceneId) {
    if (scenes.length === 0) {
      alert('请先添加场次');
      return;
    }
    currentSceneId = scenes[0].id;
    renderScenes();
  }
  const sceneShots = shots.filter(s => s.sceneId === currentSceneId);
  const maxNum = Math.max(0, ...shots.map(s => s.number));
  const shot = {
    id: uid(),
    sceneId: currentSceneId,
    order: sceneShots.length + 1,
    number: maxNum + 1,
    image: null,
    frame: '',
    duration: 0,
    content: '',
    notes: '',
    reference: '',
    sceneExpect: '',
    sound: '',
    camera: '',
  };
  shots.push(shot);
  renderShots();
  saveData();
  // 滚动到底部
  const wrap = document.getElementById('sb-shot-table-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
});

// 删除选中镜头
document.getElementById('sb-del-shot').addEventListener('click', () => {
  if (selectedShotIds.size === 0) return;
  if (!confirm(`删除 ${selectedShotIds.size} 个镜头？`)) return;
  shots = shots.filter(s => !selectedShotIds.has(s.id));
  selectedShotIds.clear();
  if (selectAllCb) selectAllCb.checked = false;
  // 重新编号
  const sceneShots = shots.filter(s => s.sceneId === currentSceneId).sort((a, b) => a.order - b.order);
  sceneShots.forEach((s, i) => { s.order = i + 1; });
  renderShots();
  saveData();
});

// ─── 实时候时同步 ────────────────────────────────────────
if (window.CollabStudio) {
  const socket = CollabStudio.socket;
  socket.on('project-updated', (data) => {
    if (currentProject && currentProject.id === data.id && data.data) {
      scenes = data.data.scenes || [];
      shots = data.data.shots || [];
      // 保持当前选中的场次
      if (currentSceneId && !scenes.find(s => s.id === currentSceneId)) {
        currentSceneId = scenes.length > 0 ? scenes[0].id : null;
      }
      renderScenes();
      renderShots();
    }
  });
}

// ─── 导出 API ────────────────────────────────────────────
window.openStoryboardEditor = function(project) {
  currentProject = project;
  scenes = (project.data && project.data.scenes) || [];
  shots = (project.data && project.data.shots) || [];
  currentSceneId = scenes.length > 0 ? scenes[0].id : null;
  selectedShotIds.clear();
  if (selectAllCb) selectAllCb.checked = false;

  titleEl.textContent = '🎞 ' + esc(project.name);

  renderScenes();
  renderShots();
};

})();
