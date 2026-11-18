# Codex Light

Codex Light 是一个 Windows 桌面客户端，把 Codex 会话、文件编辑器、Git 差异和终端放在同一个项目窗口里。你可以为一个改动创建独立工作树，在那里编辑文件、检查差异、运行命令，重开应用后再回到同一个会话。

## 开始使用

1. 在 Windows x64 上准备好 Git 和 Codex CLI。如果已经安装 npm，可用 `npm install -g @openai/codex` 安装 CLI。在 PowerShell 中运行 `codex app-server --help` 确认服务可用。
2. 从 GitHub Releases 下载 Windows x64 版本：运行 `-setup.exe` 或 MSI 安装，也可直接运行 `-portable.exe`。便携 ZIP 需先解压，再运行其中的 `Codex-Light.exe`；Source code ZIP 是源码包。[下载安装包](https://github.com/lusipad/codex-light/releases)
3. 启动应用，选择一个本地 Git 仓库并创建会话。文件面板用于浏览和编辑，变更面板显示 Git 差异，底部终端可在同一工作目录运行命令。

如果应用未找到 CLI，可以将环境变量 `CODEX_CLI_PATH` 设为本机 `codex.exe` 的完整路径，然后重新启动应用。模型请求需要可用的账号配置。本地文件、Git 和终端操作可以独立使用。

## 工作台

| 你想做什么 | 在应用里可以怎样做 |
| --- | --- |
| 继续一项任务 | 从项目打开已有会话，查看消息和执行输出，在会话中处理审批请求或中断当前轮次。 |
| 隔离一组改动 | 从仓库创建 Git 工作树，在独立目录中开始会话，再从工作树列表重开。 |
| 检查文件改动 | 在编辑器保存文件，在变更面板查看差异、暂存或取消暂存。文件在磁盘上被其他程序修改时，保存会提示冲突并保留草稿。 |
| 验证代码 | 打开项目终端，在实际工作目录中运行构建、测试或 Git 命令，并查看命令输出。 |
| 配置本机环境 | 在设置里选择 Shell、切换浅色或深色主题、恢复归档会话、管理钩子和本地 MCP 连接。 |

本地工作流优先开发，界面和交互以官方 Codex App 为参照。电脑操控和浏览器的执行能力、Sites 的站点创建与发布仍在开发中。已在 Windows 原生应用中验证的操作见[本地工作台实测](docs/antigravity/acceptance/11-local-workbench-native.md)和[设置分区实测](docs/antigravity/acceptance/16-settings-native-coverage.md)。

## 从源码运行

在 Windows 上准备 Git、Node.js 和 npm、Rust 的 MSVC 工具链、Visual Studio C++ x64 Build Tools、Windows SDK，以及 Microsoft Edge WebView2 Runtime。桌面外壳使用 Tauri v2，界面使用 React 和 TypeScript，Rust 后端负责连接本机 `codex app-server`、Git 和 PTY。

```powershell
git clone https://github.com/lusipad/codex-light.git
cd codex-light
npm ci
npm run tauri dev
```

要生成 Windows 安装包，在仓库根目录运行 `npm run tauri build`。构建结束时，Tauri 会打印 MSI 和 NSIS 安装包的实际路径。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 运行 TypeScript 检查并构建前端。 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试。 |
| `pwsh -NoProfile -File ./scripts/verify-all.ps1` | 运行项目标准检查，包含前端回归、选定的 Rust 测试和隔离的真实协议探针。加 `-Fast` 可跳过协议探针。 |

开发顺序和验收条件见[完整复刻计划](docs/FULL-REPLICA-PLAN.md)。接手开发可从[交接文档](handoff.md)开始，各版本的发布信息见[更新日志](CHANGELOG.md)。
