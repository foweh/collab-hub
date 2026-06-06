// ─── 绘画板 ──────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('draw-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let tool = 'brush'; // 'brush' | 'eraser'

  // 离屏画布：保存绘画内容，避免 resize 丢失
  let offscreen = document.createElement('canvas');

  // DOM
  const brushBtn   = document.getElementById('draw-brush');
  const eraserBtn  = document.getElementById('draw-eraser');
  const colorInput = document.getElementById('draw-color');
  const sizeInput  = document.getElementById('draw-size');
  const sizeVal    = document.getElementById('draw-size-val');
  const clearBtn   = document.getElementById('draw-clear');
  const exportBtn  = document.getElementById('draw-export');

  // ─── 画布自适应 ──────────────────────────────────────────
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (canvas.width === w && canvas.height === h) return;

    // 保存当前内容到离屏画布（按比例缩放）
    if (canvas.width > 0 && canvas.height > 0) {
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(canvas, 0, 0);
      offscreen = tmp;
    }

    canvas.width  = w;
    canvas.height = h;

    // 恢复背景 + 绘画内容
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);
    if (offscreen.width > 0 && offscreen.height > 0) {
      ctx.drawImage(offscreen, 0, 0, w, h);
    }
  }

  // ResizeObserver
  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas.parentElement);

  // 首次渲染
  setTimeout(resizeCanvas, 200);

  // ─── 坐标转换（考虑 DPI） ────────────────────────────────
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);

    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = parseInt(sizeInput.value) * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = colorInput.value;
      ctx.lineWidth = parseInt(sizeInput.value);
    }

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
  }

  function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 鼠标
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  // 触屏
  canvas.addEventListener('touchstart', startDrawing, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);

  // ─── 工具切换 ────────────────────────────────────────────
  brushBtn.addEventListener('click', () => {
    tool = 'brush';
    brushBtn.classList.add('active');
    eraserBtn.classList.remove('active');
    canvas.style.cursor = 'crosshair';
  });

  eraserBtn.addEventListener('click', () => {
    tool = 'eraser';
    eraserBtn.classList.add('active');
    brushBtn.classList.remove('active');
    canvas.style.cursor = 'cell';
  });

  // ─── 粗细 ────────────────────────────────────────────────
  sizeInput.addEventListener('input', () => {
    sizeVal.textContent = sizeInput.value;
  });

  // ─── 清空 ────────────────────────────────────────────────
  clearBtn.addEventListener('click', async () => {
    if (typeof showConfirm === 'function') {
      if (!await showConfirm('清空所有绘画内容？', '清空确认', '🗑️')) return;
    }
    offscreen.width  = 0;
    offscreen.height = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });

  // ─── 导出 PNG ───────────────────────────────────────────
  exportBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `分镜_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // ─── 面板激活时自动 resize ──────────────────────────────
  const drawNavBtn = document.querySelector('.nav-btn[data-module="draw"]');
  if (drawNavBtn) {
    const observer = new MutationObserver(() => {
      if (drawNavBtn.classList.contains('active')) {
        setTimeout(resizeCanvas, 80);
      }
    });
    observer.observe(drawNavBtn, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('resize', () => {
    if (drawNavBtn && drawNavBtn.classList.contains('active')) {
      resizeCanvas();
    }
  });

  console.log('[绘画] 绘画板已加载');
})();
