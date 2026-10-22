# BUILD-BASELINE — 构建 / 运行基线

> 环境：Windows（`D:\Repos\codex-desktop-native`），PowerShell。审计期间**未修改任何源码/配置**。
> 本文件记录 2026-10-23 实际执行的构建检查结果与 dev 运行所需环境。

---

## 1. 结论速览

| 检查 | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 前端类型检查 + 生产构建 | `npm run build`（`tsc && vite build`） | ✅ **通过**（0 error，1 个 chunk 体积 warning） | ~2.8s（vite 2.76s） |
| Rust 类型检查 | `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ **通过**（0 error，0 warning，无 warning 输出） | 2.56s（增量，target 已缓存） |
| 前端产物 | `dist/` | ✅ 生成 `index.html` + `index-K90iAqjr.css` + `index-mVCb3fsX.js` | — |

> 说明：本次只要求 `cargo check`，未运行 `cargo test`（源码中已有 4 个单元测试：`app_server.rs` 2 个、`config_skills.rs` 2 个，可后续补跑）。

---

## 2. `npm run build` 原始输出

```
> codex-tauri@0.1.0 build
> tsc && vite build

vite v6.4.4 building for production...
transforming...
✓ 1610 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.41 kB │ gzip:   0.28 kB
dist/assets/index-K90iAqjr.css   72.59 kB │ gzip:  12.87 kB
dist/assets/index-mVCb3fsX.js   795.45 kB │ gzip: 219.06 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: ...
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 2.76s
```

- **类型检查**：`tsc` 通过（`strict: true`，`noUnusedLocals/Parameters: false`，见 tsconfig.json）。
- **唯一 warning**：主 bundle 795.45 kB > 500 kB（xterm/react/lucide 全量打包，未做 code-split）。不影响运行。
- 产物已写入 `dist/`（`vite.config.ts` 无自定义 outDir）。

## 3. `cargo check` 原始输出

```
    Checking codex-tauri v0.1.0 (D:\Repos\codex-desktop-native\src-tauri)
    Finished `dev` profile [unoptimized] target(s) in 2.56s
```

- **0 error / 0 warning**。
- 该结果是**增量检查**（`src-tauri/target` 已有缓存）；首次/清理后全量构建预计需数分钟（依赖 tauri/portable-pty/rfd 等，`Cargo.toml` 见下）。
- 关键依赖：`tauri 2`、`serde/serde_json`、`tokio`（process/io/sync/time/rt-multi-thread/macros/fs）、`portable-pty 0.8`、`toml 0.8`、`toml_edit 0.22`、`base64 0.22`、`dirs 5`、`uuid v4`、`rfd 0.15`；`[profile.dev] debug = 0`。

## 4. 工具链版本（实测）

| 工具 | 版本 |
|---|---|
| rustc | 1.95.0 (2026-04-14) |
| cargo | 1.95.0 (2026-03-21) |
| node | v25.8.1 |
| npm | 11.11.0 |
| vite（实际运行） | 6.4.4 |
| TypeScript（package.json） | ^5.7.2 |
| @tauri-apps/cli（package.json） | ^2.2.0 |
| codex CLI（全局，实际被 app 默认使用） | codex-cli **0.159.0**（`%APPDATA%\npm\codex.cmd`） |
| codex CLI（官方离线包内置，可作参照） | `...\OpenAI\Codex\bin\896a0166b774037a\codex.exe` → app-server 0.163.0-alpha.10.2 |

## 5. dev 运行所需环境

### 5.1 最小可行（完整桌面应用）

```powershell
cd D:\Repos\codex-desktop-native
npm install                 # 首次
npm run tauri dev           # 等价：tauri dev（beforeDevCommand = npm run dev）
```

- 需要：Node.js + npm、Rust toolchain（MSVC）、Windows WebView2 Runtime（Win10/11 通常自带）、`codex` CLI 可在 PATH 找到（或稍后在 Settings → 常规设置里填写自定义 CLI 路径 / 设 `CODEX_CLI_PATH`）。
- Tauri dev URL：`http://localhost:1420`（`vite.config.ts` `strictPort: true`，端口被占会直接失败；`TAURI_DEV_HOST` 可改 host）。
- 窗口：1440×920（最小 960×640），`tauri.conf.json`。

### 5.2 仅前端（浏览器）

```powershell
npm run dev                 # http://localhost:1420
```

⚠️ 仅前端模式**没有 Tauri IPC**：`bridge.ts` 的 `tauriInvoke` 会抛 `Tauri runtime required for command: xxx`，几乎所有数据面板为空、按钮无响应（错误多被 catch 静默）。适合调样式，不适合验收功能。

### 5.3 生产构建

```powershell
npm run build               # tsc + vite build → dist/
npm run tauri build         # 打安装包（bundle.targets = "all"）
```

### 5.4 关键环境变量

| 变量 | 作用 | 读取位置 |
|---|---|---|
| `CODEX_HOME` | Codex 配置/状态根目录（默认 `~/.codex`） | Rust `state.rs:59-68` + codex CLI 自身 |
| `CODEX_CLI_PATH` | 指定 codex 可执行文件 | `app_server.rs:95-99` |
| `CODEX_SKILL_SOURCE_DIR` | 额外技能种子目录 | `config_skills.rs:513-518` |
| `TAURI_DEV_HOST` | Vite/Tauri 远程 dev host | `vite.config.ts:4-18` |
| `SHELL` | 终端默认 shell（Windows 不读，固定 powershell） | `terminal.rs:42-56` |

### 5.5 Tauri 权限 / 能力现状（影响新增功能）

`src-tauri/capabilities/default.json` 仅授权：

```json
["core:default", "core:event:default", "core:window:default"]
```

- **没有** `notification`、`dialog`、`updater`、`autostart`、`shell` 等官方插件 → 系统通知/自动更新/开机自启/受控 shell 都需要先加插件 + 权限。
- `tauri.conf.json` `csp: null`（无 CSP 限制，所以 DiffDrawer 的 `<iframe>` 可以加载任意 URL）。
- 当前 `rfd` 文件夹/文件选择是 Rust 端直接调用（不依赖 dialog 插件），可用。

## 6. 复现本审计证据的命令

```powershell
# 1) 生成 app-server 协议 schema（0.159.0，含 experimental；本次产物在 .ref/audit/schema/）
codex app-server generate-json-schema --experimental --out .ref\audit\schema

# 2) 协议实测（stdio JSON-RPC 探针，详见 backend-surface.md §9）
#    初始化 → 发 turn/interrupt / turn/steer / thread/start / model/list 等并读回包

# 3) 校验 config.toml 键是否被 codex 识别
#    临时 CODEX_HOME 写 config.toml，再跑：
codex app-server --strict-config --listen stdio://
#    出现 Error: unknown configuration field `temperature` 等 → 该键无效

# 4) 官方离线包参照（注意：解包需要先 cd .ref\scratch，绝不能写到仓库根目录）
#    C:\Users\lus\Codex\_internal\app\resources\app.asar
#    本次主要使用 .ref/asar-files/、.ref/renderer-asset-filenames.txt 与协议 schema 对照
```

## 7. 构建/运行基线中已知限制与风险

1. **bundle 未拆分**：795 kB 单 chunk（xterm + lucide 全图标 + react），首屏/冷启动有优化空间（warning 已提示）。
2. **无前端测试框架**：package.json 无 test script；Node 侧只有 Rust 的 4 个单元测试。
3. **`cargo check` 为增量结果**：CI/新机器需要更长首次构建时间；仓库内 `.github` 有 workflow（可查验）。
4. **app-server 版本双源**：默认 npm `codex.cmd`（0.159.0）vs 官方离线包（0.163.0-alpha）。协议 schema 以 0.159 为基准；若用户把自定义路径指向 0.163，部分 experimental 方法/字段可能不同（本次实测两版核心行为一致）。
5. **Rust 端无源文件后处理保护**：`fs_write_file`/`config_save_raw`/`save_automation` 直接写盘，无 dry-run；后续加功能需注意备份。
6. **工作区 git 状态**：本次审计前已有未提交改动 `.gitignore`（追加 `.ref/`，时间早于本任务）；审计开始时其余源码干净，审计只新增/修改 `.ref/audit/**`。**06:53 后另一并行任务开始修改 `src/App.tsx`、`src/styles.css` 并新增 `src/protocol.ts`、`src/components/ApprovalCenter.tsx`（未提交）** —— 本文件 §1-§3 的构建结果是针对 06:45 快照执行的，提交前必须在合并后的工作树重跑 `npm run build` / `cargo check`。

