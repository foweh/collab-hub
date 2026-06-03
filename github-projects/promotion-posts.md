# 推广帖子文案

---

## V2EX 版

标题：做了两个 GitHub 小工具，想让你的开发体验更好一点

正文：

前几周业余时间做了两个 GitHub 上的小工具，都是自己平时开发中遇到的痛点，分享给大家。

第一个是 PR 自动审查助手，叫 pr-reviewer。
它是一个 GitHub App，安装到仓库后，每次有人提 Pull Request 就会自动：
- 检查 PR 标题是否符合 Conventional Commits 规范
- 扫描 diff 里有没有遗留的 console.log / debugger / print()
- 提醒是否忘了更新 CHANGELOG
- 大范围改动时提醒是否忘了加测试
- 检测 TODO/FIXME 残留

给人的感觉不是 CI 报错那种冷冰冰的失败，而是像同事帮你 review 一样，说"这里是不是忘了改？"。所有回复都是友好的中文。

项目地址：https://github.com/foweh/pr-reviewer
支持 Docker / Fly.io / Railway 一键部署，README 里有完整的从零创建 GitHub App 的图文步骤。

第二个是 .gitignore 智能生成器，叫 gitignore-wizard。
它是一个纯前端网页，不需要任何后端。你点选项目类型（Python、Node、Go、Rust、React、Vue、Docker 等等 30 多种），它自动生成对应的 .gitignore，而且每一行都告诉你为什么忽略。

比如说你选了 Python + FastAPI + Docker，它生成的 .gitignore 里每一行都有解释：
- `__pycache__/` -> Python 字节码缓存目录
- `*.pyc` -> Python 编译后的字节码文件
- `.env` -> 环境变量配置文件，可能包含密钥

在线直接用：https://foweh.github.io/gitignore-wizard/
项目地址：https://github.com/foweh/gitignore-wizard

两个项目都是 MIT 协议，欢迎 Star，欢迎 PR。

补充：完全纯前端，数据存储在浏览器 localStorage，没有任何后端请求，隐私友好。

---

## 掘金版

标题：做了两个 GitHub 小工具，解决日常开发中的实际痛点

正文：

作为一名开发者，平时在 GitHub 上提 PR 和写 .gitignore 是再日常不过的事了。但这两个小事其实有很多可以优化的地方，于是花了几周时间做了两个小工具。

一、PR 自动审查助手

每次提 PR，维护者都要手动检查很多琐碎的东西：标题格式对不对、有没有遗留的调试代码、文档有没有同步更新。这些工作完全可以自动化。

我写了一个 GitHub App，叫 pr-reviewer，安装到仓库后自动完成这些检查，并给出友好的中文评论。

它内置了三个检查规则：
1. 标题规范检查：是否符合 Conventional Commits 格式
2. 调试代码检测：console.log / debugger / print() 等
3. 文档和测试检查：大变更是否漏了测试，接口变更是否漏了文档

项目地址：https://github.com/foweh/pr-reviewer
支持通过 Fly.io 一键部署，Docker 镜像也已就绪。README 详细写了从零创建 GitHub App 的每一步。

二、.gitignore 智能向导

.gitignore 是每个项目都要用的，但新手经常不知道该忽略哪些文件，老手也偶尔会忘记特定的规则。github/gitignore 仓库有几百个模板，但找一个合适的模板并不直观。

我做了 gitignore-wizard，一个纯前端的交互式网页：
- 30 多种内置模板，覆盖主流语言和框架
- 按分类浏览或直接搜索
- 点选后实时生成 .gitignore
- 每一行都有解释，告诉你为什么忽略这个文件
- 支持一键复制和下载

在线使用：https://foweh.github.io/gitignore-wizard/
项目地址：https://github.com/foweh/gitignore-wizard

技术栈方面，就是纯 HTML + CSS + JS，没有框架、没有构建工具、没有后端，打开即用。所有数据打包在 JS 中，离线也能用。

两个项目都是 MIT 协议，欢迎 Star 和 PR。

---

## Reddit 版

Title: I built two open-source GitHub tools that make my daily dev life easier

Body:

Hey everyone,

Over the past few weeks I built two small tools that solve daily annoyances I had while working with GitHub. Thought I'd share them here.

**1. PR Reviewer** (https://github.com/foweh/pr-reviewer)

A GitHub App that automatically reviews pull requests:
- Checks if the PR title follows Conventional Commits format
- Scans diff for leftover console.log / debugger / print() statements
- Reminds you to update CHANGELOG if needed
- Warns about missing tests for large changes
- Detects TODO/FIXME/HACK markers

Unlike strict CI linters, the comments are friendly and helpful -- like a colleague doing code review with you. All messages are in Chinese by default, but the rules are easy to customize via a `.pr-reviewer.yml` config file.

Deploy with Docker, Fly.io, or Railway. The README includes a step-by-step guide on creating a GitHub App from scratch.

**2. .gitignore Wizard** (https://github.com/foweh/gitignore-wizard)

A zero-dependency, client-side web app that generates .gitignore files interactively:
- 30+ built-in templates (Python, Node, Go, Rust, React, Vue, Docker, Android, iOS, etc.)
- Real-time preview as you select
- Every single line is explained -- so you know why `__pycache__/` or `.env` is ignored
- Copy to clipboard or download as `.gitignore`
- All data is local, no backend requests, privacy-friendly

Try it live: https://foweh.github.io/gitignore-wizard/

It's pure HTML/CSS/JS -- no frameworks, no build step, no backend. Just open and use.

Both are MIT licensed. Stars and PRs are welcome!
