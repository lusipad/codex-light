# 00 基准与证据建立

状态：调研与基准固定完成。日期：2026-10-27。

## 1. 官方应用基准 (Official Baseline)

- **安装包物理路径**：`C:/Users/lus/Codex/_internal/app/resources/app.asar`
- **可执行文件路径**：`C:/Users/lus/Codex/_internal/app/ChatGPT.exe`
- **版本号 (Version)**：`26.928.21956`
- **构建号 (Build)**：`12404`
- **app.asar SHA-256**：`17E75CE60122666AA46598A9876A0C56D1DA30589824708BDB59C90D8377F5EB`
- **提取验证清单**：详见 `.ref/parity/00/manifest.json`，已确认 package.json 及核心 CSS 指纹一致。

## 2. 运行与验证环境基准

- **操作系统**：Microsoft Windows 11 (64-bit)
- **显示与缩放**：主显示器 100% 缩放，标准基准宽窗客户区 `1568 × 934`（对齐官方基准截图尺寸），窄窗客户区 `960 × 640`。
- **色彩模式**：深色模式 (Dark Mode)，主表面色 `#181818` (`--gray-fixed-900`)。
- **语言**：简体中文 (`zh-CN`)。
- **真实后端服务**：基于本地 `codex app-server` (Codex CLI `0.159.2`)，使用隔离 `CODEX_HOME` 运行协议探针，绝对禁止以 mock 假数据伪造执行结果。
- **安全与合规边界**：Computer Use 指引禁止对官方 ChatGPT.exe 进行模拟点击自动化，官方行为严格以 asar 静态源码、官方 CSS、协议样本及已固定的参考截图为依据；本项目 Native 应用执行完整的类型检查、协议探针与原生交互回归。

## 3. 官方静态资源提取映射 (.ref/parity/00/reference)

| 文件类别 | 官方 asar 相对路径 | 本地引用路径 | SHA-256 (前12位) |
|---|---|---|---|
| 元数据 | `\package.json` | `.ref/parity/00/reference/package.json` | `2769a5fbf050` |
| 主样式表 | `\webview\assets\app-shared-342447930c78.css` | `.ref/parity/00/reference/app-shared-342447930c78.css` | `916d8fa55c82` |
| 初始样式 | `\webview\assets\app-initial-e55cd978d577.css` | `.ref/parity/00/reference/app-initial-e55cd978d577.css` | `4467a7668c34` |
| 首页样式 | `\webview\assets\home-49f9c30a8c63.css` | `.ref/parity/00/reference/home-49f9c30a8c63.css` | `7f0df1302623` |
| 输入框控件 | `\webview\assets\composer-controls-146a0c4fef05.css` | `.ref/parity/00/reference/composer-controls-146a0c4fef05.css` | `839dd9b1b70a` |
| 行内输入框 | `\webview\assets\inline-composer-3f819053103b.css` | `.ref/parity/00/reference/inline-composer-3f819053103b.css` | `e65fce8b5198` |
| 核心主逻辑 | `webview\assets\app-primary-84ad97f06929.js` | `.ref/scratch/files/app-primary-84ad97f06929.js` | `bff0e66840e6` |
| 共享模块 | `webview\assets\app-shared-a906948d8868.js` | `.ref/scratch/app-shared-a906948d8868.js` | `a906948d8868` |

## 4. 参考截图基准清单 (.ref/reference/round11)

| 截图文件名 | 场景 | 分辨率 | 状态 |
|---|---|---|---|
| `official-home-before.png` | 官方首页冷启动状态 | 1568 × 934 | 基准锁定 |
| `official-model-compact.png` | 官方模型下拉展开紧凑态 | 1568 × 934 | 基准锁定 |
| `official-permissions.png` | 官方权限模式下拉展开态 | 1568 × 934 | 基准锁定 |

## 5. 准则与红线确认

1. **绝对禁止伪造**：不以静态数组、随机延时、SVG 占位或自写脚本冒充真实服务对接；
2. **严格单单元流转**：从 00 单元确认基准后进入 01 单元，经由自验 ➔ 原生复测 ➔ 交付待用户验收；
3. **保持状态客观真实**：未获用户明确验收前，不得自行将状态改为“已验收”。
