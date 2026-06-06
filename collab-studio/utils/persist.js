// ─── 文件持久化工具 ──────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try { fs.chmodSync(DATA_DIR, 0o700); } catch (_) {}
  }
  return DATA_DIR;
}

function loadJSON(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`[持久化] 读取失败 ${path.basename(filePath)}:`, e.message);
  }
  return fallback;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  } catch (e) {
    console.error(`[持久化] 写入失败 ${path.basename(filePath)}:`, e.message);
  }
}

module.exports = { ensureDataDir, loadJSON, saveJSON, DATA_DIR };
