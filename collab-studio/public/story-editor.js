// ─── 故事编辑器 ──────────────────────────────────────────
(function() {

let currentProject = null;
let currentChapterIdx = 0;

const titleEl = $('#story-title');
const chapterList = $('#story-chapter-list');
const storyTextarea = $('#story-textarea');
const addChapterBtn = $('#story-add-chapter');

// ─── 打开故事 ────────────────────────────────────────────
window.openStoryEditor = function(project) {
  currentProject = project;
  titleEl.textContent = `📖 ${esc(project.name)}`;
  const data = project.data || { chapters: [] };
  if (data.chapters.length === 0) {
    data.chapters.push({ title: '第一章', content: '' });
    saveData();
  }
  currentChapterIdx = 0;
  renderChapters();
  renderContent();
};

// ─── 章节列表 ────────────────────────────────────────────
function renderChapters() {
  if (!currentProject) return;
  const data = currentProject.data;
  chapterList.innerHTML = '';
  data.chapters.forEach((ch, i) => {
    const div = document.createElement('div');
    div.className = `chapter-item${i === currentChapterIdx ? ' active' : ''}`;
    div.innerHTML = `
      <input class="chapter-title-input" value="${esc(ch.title)}" data-idx="${i}">
      <button class="ch-del" data-idx="${i}">×</button>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
        currentChapterIdx = i;
        renderChapters();
        renderContent();
      }
    });
    // 标题编辑
    const titleInput = div.querySelector('.chapter-title-input');
    titleInput.addEventListener('change', () => {
      data.chapters[i].title = titleInput.value;
      saveData();
    });
    titleInput.addEventListener('click', (e) => e.stopPropagation());
    // 删除章节
    const delBtn = div.querySelector('.ch-del');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (data.chapters.length <= 1) return alert('至少保留一个章节');
      data.chapters.splice(i, 1);
      if (currentChapterIdx >= data.chapters.length) currentChapterIdx = data.chapters.length - 1;
      renderChapters();
      renderContent();
      saveData();
    });
    chapterList.appendChild(div);
  });
}

// ─── 内容编辑 ────────────────────────────────────────────
function renderContent() {
  if (!currentProject) return;
  const data = currentProject.data;
  const ch = data.chapters[currentChapterIdx];
  if (!ch) return;
  storyTextarea.value = ch.content || '';
}

// 内容变更
let contentTimer = null;
storyTextarea.addEventListener('input', () => {
  if (!currentProject) return;
  clearTimeout(contentTimer);
  contentTimer = setTimeout(() => {
    const data = currentProject.data;
    const ch = data.chapters[currentChapterIdx];
    if (ch) {
      ch.content = storyTextarea.value;
      saveData();
    }
  }, 400);
});

// ─── 添加章节 ────────────────────────────────────────────
addChapterBtn.addEventListener('click', () => {
  if (!currentProject) return;
  const data = currentProject.data;
  data.chapters.push({ title: `第${data.chapters.length + 1}章`, content: '' });
  currentChapterIdx = data.chapters.length - 1;
  renderChapters();
  renderContent();
  saveData();
});

// ─── 数据保存 ────────────────────────────────────────────
function saveData() {
  if (!currentProject) return;
  socket.emit('project-update', {
    id: currentProject.id,
    data: currentProject.data,
  });
  socket.emit('realtime-event', {
    module: 'story',
    event: 'story-updated',
    payload: { id: currentProject.id, data: currentProject.data },
  });
}

// 实时同步
socket.on('story-updated', (data) => {
  if (currentProject && currentProject.id === data.id) {
    currentProject.data = data.data;
    renderChapters();
    renderContent();
  }
});

})();
