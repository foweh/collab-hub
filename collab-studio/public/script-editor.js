// ─── 剧本编辑器 ──────────────────────────────────────────
// 挂载到 window 上供 app.js 调用

(function() {

let currentProject = null;

const container = $('#script-editor');
const scriptTitle = $('#script-title');
const addActBtn = $('#script-add-act');

// ─── 打开剧本 ────────────────────────────────────────────
window.openScriptEditor = function(project) {
  currentProject = project;
  scriptTitle.textContent = `📜 ${esc(project.name)}`;
  renderScript();
};

// ─── 渲染 ────────────────────────────────────────────────
function renderScript() {
  if (!currentProject) return;
  const data = currentProject.data || { acts: [] };
  container.innerHTML = '';

  if (data.acts.length === 0) {
    // 自动创建第一幕
    data.acts.push({ title: '第一幕', scenes: [] });
    saveData();
  }

  data.acts.forEach((act, ai) => {
    const sec = document.createElement('div');
    sec.className = 'act-section';
    sec.innerHTML = `
      <div class="act-header">
        <input class="act-title" value="${esc(act.title)}" data-ai="${ai}" placeholder="幕标题...">
        <button class="toolbar-btn danger add-scene-btn" data-ai="${ai}" style="font-size:12px;padding:2px 8px">+ 场</button>
        <button class="tool-btn danger del-act-btn" data-ai="${ai}" style="font-size:12px;padding:2px 8px">× 删幕</button>
      </div>
      <div class="scenes-list"></div>
    `;

    const scenesList = sec.querySelector('.scenes-list');

    act.scenes.forEach((scene, si) => {
      const sc = document.createElement('div');
      sc.className = 'scene-card';
      sc.innerHTML = `
        <div class="scene-header">
          <span style="color:var(--text-dim);font-size:12px">场 ${si + 1}</span>
          <input class="scene-location" value="${esc(scene.location || '')}" data-ai="${ai}" data-si="${si}" placeholder="场景地点...">
          <input class="scene-time" value="${esc(scene.time || '')}" data-ai="${ai}" data-si="${si}" placeholder="时间...">
          <button class="tool-btn danger del-scene-btn" data-ai="${ai}" data-si="${si}" style="font-size:12px;padding:2px 6px">×</button>
          <button class="tool-btn add-dialogue-btn" data-ai="${ai}" data-si="${si}" style="font-size:12px;padding:2px 6px">+ 对白</button>
        </div>
        <div class="dialogues-list"></div>
      `;

      const dList = sc.querySelector('.dialogues-list');

      (scene.dialogues || []).forEach((dlg, di) => {
        const d = document.createElement('div');
        d.className = 'dialogue';
        d.innerHTML = `
          <input class="dialogue-char" value="${esc(dlg.character || '')}" data-ai="${ai}" data-si="${si}" data-di="${di}" placeholder="角色">
          <textarea class="dialogue-text" rows="1" data-ai="${ai}" data-si="${si}" data-di="${di}" placeholder="对白...">${esc(dlg.text || '')}</textarea>
          <button class="dialogue-del" data-ai="${ai}" data-si="${si}" data-di="${di}">×</button>
        `;
        dList.appendChild(d);

        // 自动调整 textarea 高度
        const ta = d.querySelector('.dialogue-text');
        autoResize(ta);
      });

      scenesList.appendChild(sc);
    });

    container.appendChild(sec);
  });

  // ── 绑定事件 ──
  bindScriptEvents();
}

function bindScriptEvents() {
  // 幕标题
  container.querySelectorAll('.act-title').forEach(inp => {
    inp.addEventListener('change', () => {
      const ai = parseInt(inp.dataset.ai);
      if (currentProject.data.acts[ai]) {
        currentProject.data.acts[ai].title = inp.value;
        saveData();
      }
    });
  });

  // 添加场
  container.querySelectorAll('.add-scene-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ai = parseInt(btn.dataset.ai);
      const act = currentProject.data.acts[ai];
      if (act) {
        act.scenes.push({ location: '', time: '', dialogues: [] });
        renderScript();
        saveData();
      }
    });
  });

  // 删除幕
  container.querySelectorAll('.del-act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ai = parseInt(btn.dataset.ai);
      if (confirm('删除此幕？')) {
        currentProject.data.acts.splice(ai, 1);
        renderScript();
        saveData();
      }
    });
  });

  // 场景地点
  container.querySelectorAll('.scene-location').forEach(inp => {
    inp.addEventListener('change', () => {
      updateSceneField(inp, 'location');
    });
  });

  // 场景时间
  container.querySelectorAll('.scene-time').forEach(inp => {
    inp.addEventListener('change', () => {
      updateSceneField(inp, 'time');
    });
  });

  // 删除场
  container.querySelectorAll('.del-scene-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ai = parseInt(btn.dataset.ai);
      const si = parseInt(btn.dataset.si);
      const act = currentProject.data.acts[ai];
      if (act && confirm('删除此场？')) {
        act.scenes.splice(si, 1);
        renderScript();
        saveData();
      }
    });
  });

  // 添加对白
  container.querySelectorAll('.add-dialogue-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ai = parseInt(btn.dataset.ai);
      const si = parseInt(btn.dataset.si);
      const scene = currentProject.data.acts[ai]?.scenes[si];
      if (scene) {
        if (!scene.dialogues) scene.dialogues = [];
        scene.dialogues.push({ character: '', text: '' });
        renderScript();
        saveData();
      }
    });
  });

  // 角色名
  container.querySelectorAll('.dialogue-char').forEach(inp => {
    inp.addEventListener('change', () => {
      updateDialogueField(inp, 'character');
    });
  });

  // 对白文本
  container.querySelectorAll('.dialogue-text').forEach(ta => {
    ta.addEventListener('input', () => {
      autoResize(ta);
    });
    ta.addEventListener('change', () => {
      updateDialogueField(ta, 'text');
    });
  });

  // 删除对白
  container.querySelectorAll('.dialogue-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const ai = parseInt(btn.dataset.ai);
      const si = parseInt(btn.dataset.si);
      const di = parseInt(btn.dataset.di);
      const scene = currentProject.data.acts[ai]?.scenes[si];
      if (scene && scene.dialogues) {
        scene.dialogues.splice(di, 1);
        renderScript();
        saveData();
      }
    });
  });
}

function updateSceneField(inp, field) {
  const ai = parseInt(inp.dataset.ai);
  const si = parseInt(inp.dataset.si);
  const scene = currentProject.data.acts[ai]?.scenes[si];
  if (scene) {
    scene[field] = inp.value;
    saveData();
  }
}

function updateDialogueField(inp, field) {
  const ai = parseInt(inp.dataset.ai);
  const si = parseInt(inp.dataset.si);
  const di = parseInt(inp.dataset.di);
  const dlg = currentProject.data.acts[ai]?.scenes[si]?.dialogues?.[di];
  if (dlg) {
    dlg[field] = inp.value;
    saveData();
  }
}

function saveData() {
  if (!currentProject) return;
  socket.emit('project-update', {
    id: currentProject.id,
    data: currentProject.data,
  });
  // 实时同步给对方
  socket.emit('realtime-event', {
    module: 'script',
    event: 'script-updated',
    payload: { id: currentProject.id, data: currentProject.data },
  });
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

// 监听实时同步
socket.on('script-updated', (data) => {
  if (currentProject && currentProject.id === data.id) {
    currentProject.data = data.data;
    renderScript();
  }
});

// ─── 新增幕（顶部按钮） ──────────────────────────────────
addActBtn.addEventListener('click', () => {
  if (!currentProject) return;
  currentProject.data.acts.push({ title: `第${currentProject.data.acts.length + 1}幕`, scenes: [] });
  renderScript();
  saveData();
});

})();
