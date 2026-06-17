# Collab Studio

> **局域网实时协作创作工作室** — 剧本 / 思维导图 / 故事/ 分镜，零配置，无需云端。

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-LAN-%23FF6B6B)

---

## 功能

| 模块 | 说明 |
|------|------|
| **剧本编辑器** | 按幕/场结构编写剧本，支持实时同步 |
| **思维导图** | 类 xmind 体验，拖拽节点、自由缩放、连线 |
| **故事编辑器** | 分章编写故事，适合小说/叙事创作 |
| **多机协作** | Socket.IO + UDP 发现，局域网内多设备实时同步 |
| **中英双语** | 内置 i18n，一键切换语言 |
| **设备面板** | 查看所有在线协作者，跨设备通信状态 |

---

## 快速开始

```bash
# 启动服务（默认端口 3000）
node server.js

# 或指定端口
node server.js --port 3001

# 连接到已有的工作室
node server.js --join 192.168.1.100:3000
```

打开浏览器访问 `http://localhost:3000`，输入名字即可进入。

### 多人协作

- 每台机器运行 `node server.js` 启动节点
- 所有节点通过 **UDP 广播**（端口 `41234`）自动发现
- 一个节点进入后，整个工作室内的剧本/导图/故事实时同步
- 支持 `--join` 方式手动加入指定节点

---

## 项目结构

```
collab-studio/
├── server.js                 # 服务端入口 — Express + Socket.IO + UDP 发现
├── public/
│   ├── index.html            # 主页面
│   ├── app.js                # 全局客户端 API + 多机协作核心
│   ├── style.css             # 样式
│   ├── script-editor.js      # 剧本编辑器
│   ├── story-editor.js       # 故事编辑器
│   ├── mindmap.js            # 思维导图引擎
│   ├── mindmap-full.html     # 全屏思维导图版
│   ├── devices.js            # 设备管理面板
│   └── i18n.js               # 中英双语国际化
├── package.json
├── LICENSE
└── README.md
```

### 配套项目

| 项目 | 说明 |
|------|------|
| [`fenjing/`](fenjing/) | 分镜工具 — 在线分镜脚本工具 |
| [`fenjing-local/`](fenjing-local/) | 分镜工具桌面版 (Vue 3 + TypeScript + Pinia) |
| [`storyboard-collab/`](storyboard-collab/) | 协作分镜编辑器 |
| [`github-projects/`](github-projects/) | GitHub 小工具集 — 代码片段、资料统计、PR 审查、周报等 |

---

## 技术栈

- **后端：** Node.js + Express + Socket.IO + WebSocket
- **前端：** 原生 JavaScript (ES Modules) + Canvas 渲染
- **网络发现：** UDP dgram 广播 (端口 `41234`)
- **实时同步：** Socket.IO 事件驱动，UUID 标识持久化

---

## 展示

（启动后截图或录屏可放在这里）

| 思维导图 | 剧本编辑器 | 故事编辑器 |
|----------|------------|------------|
| 拖拽节点、缩放、连线 | 场次管理、角色标注 | 分章叙事 |
| Canvas 渲染 | 结构化编辑 | 简洁写作界面 |

---

## 测试

```bash
# 启动测试服务（端口 3001，自动加入主服务）
node server.js --port 3001 --join localhost:3000
```

---

## 许可证

[MIT](LICENSE) © CollabStudio
