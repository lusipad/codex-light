# 16.01B 默认文件打开位置与 Windows 新终端 Shell

日期：2026-11-01。功能增量自动自验通过，整个通用设置分区未验收。

## 官方合同与实现

先完成[修改前合同](../specs/16-01-open-target-shell.md)，核固定原包[三项资源、中文和后端消费链](../../../.ref/parity/16.01/runs/20261101-codex-general-settings/reference/open-target-shell-trace.json)。引用为原始 UTF-16 偏移，未以 scratch 行号替代，不强开 gate。

- 新增 `src-tauri/src/desktop_open.rs`，探测 PATH 和 LOCALAPPDATA/Programs、ProgramFiles 两根的现有编辑器。Code/Cursor 等 CLI 通过相邻安装目录定位实际 EXE，避免拼接 cmd 命令；当前覆盖 VS Code/Insiders、Cursor、Sublime、Zed、Antigravity、文件资源管理器、系统默认应用。系统默认应用为原生API目标，不依赖PATH；资源管理器优先SystemRoot/windir探测。无静态假编辑器选项，不继承官方此版本未声明的 Windows Windsurf。
- 默认打开偏好持久化 `openInTargetPreferences.global`，保留已有 perPath；General 读取 global，无有效选择时按已实现可用列表第一项回退。不再固定记事本打开，也不把旧 desktopPreferences.defaultEditor 当实际执行设置。
- `open_path_external` 读取实际偏好，编辑器进程单独 executable/path 参数派发，派发失败返回；fileManager 对目录打开、对文件 `/select,` 定位。系统默认使用 Windows ShellExecuteW、检查错误返回值，没有引入依赖。派发成功不等于编辑器已确认加载内容，不能据此声称目标应用验收。
- Windows Shell 使用独立 integratedTerminalShell：PowerShell 优先 pwsh 再 powershell，CMD 使用 COMSPEC 或 cmd；Git Bash 从 git-bash/git相邻安装路径检测，启动参数 --login -i；WSL 只按可执行程序存在检测，不把 distro 缺失改称 Shell 未安装。
- 默认 Shell 在真正创建新 PTY 时读取。TerminalDock 默认新标签传空值，后端应用偏好；本地明确选择仍作为新标签 override。`TerminalManager`在重新附着既有 session 之前不会解析/更换 Shell，已有会话和输出保留。非Windows保留既有默认 Shell 路径，未作跨平台声明。
- `GeneralOpenPreferences.tsx`替换 SettingsView 固定编辑器列表，官方中文行名/说明即时保存、真实读回；写锁防重复、卸载响应失效。读取失败提供重新读取，写成功但读回失败明确提示确认失败，不谎称回滚。

复用现有 desktop_state 持久化、PTY、设置表单及配置文件打开菜单。没有新增依赖、没有写官方配置或真实用户偏好。

## 已执行专项

`verify-general-open.mjs`执行生产 load/save 与 addNewTerminal，检查读取/卸载、单飞、写失败、读回不一致、默认新终端和显式覆盖、旧标签不变。现有 terminal-command/lifecycle 与 general-enter 专项仍通过。

Rust desktop_open 五项：单独路径参数、有效 global 与 available 回退、文件/目录定位参数、未知 Shell 拒绝、真实隔离 CMD PTY 输出。PTY 第一次测试用 read_to_string 等 EOF 导致等待（进程已退出但 ConPTY reader 不关）；现改为读到标记并给10秒超时，最终五项通过。期间并发重编遇测试 EXE 锁，停止该测试进程后顺序重跑成功；未把中途失败算通过。

只读审查发现并修复 fileManager 文件误打开关联应用、systemDefault 仅检查 rundll 进程、非Windows默认Shell回归及中文/候选顺序问题。最终又按原包修正systemDefault先于fileManager且不依赖PATH。首轮完整检查/原生构建成功，但这两处源码调整导致绑定输入指纹变化，未放行归档；固定源码后重跑完整检查及构建。

## 剩余缺口

1. 完整官方目标还包括 Visual Studio、GitHub Desktop、JetBrains、terminal/gitBash/cmder/wsl 等，当前未全部加入默认打开集合。自定义 handler、远程、位置 line/column 与路径级优先级/编辑 UI 未完整消费；不能称完整目录 1:1。
2. 官方 host/global terminal_command override precedence 尚未接入；旧 tab 明确保存的 Shell 被卸载后会真实报错，未模拟成功或重启已有session。
3. 默认打开偏好的真实重启落盘、编辑器实际窗口/路径确认、Shell 四项原生终端与失败对照尚待实测。现有标准持久化测试和本批UI callback回放不能替代这些。
4. 当前表单/下拉与终端工具栏仍非官方像素布局。无同环境成对截图，visual-verdict未执行，无视觉分数；原生焦点/Escape/IME未验。
5. 旧恢复出厂按钮未覆盖独立新偏好，该项仍需单独修复。用户未验收，未提交推送。

## 最终构建与证据

最终完整 `verify-all.ps1` 退出0，全量Rust **100项通过、0失败**，Release/MSI/NSIS退出0；九项绑定输入前后指纹一致。`git diff --check`退出0。无独立lint配置，既有Vite大chunk和Node DEP0190警告保留。首轮检查/构建成功但指纹变化的记录保存在actual/pre-final-*，未作为最终归档依据。

[本批EXE](../../../dist-artifacts/16-01-general-open-20261101/CodexNative.exe)：14,082,560 bytes，SHA-256 `A3861FBD05FAD91F4B0E6A3EFAEAE5CC684531BDFDF0EBF9F9AB3B9FDE053C8A`。HEAD `97a4eca9f0a3bb529620c610f273b14057a4470c`，包含未提交改动；[build-manifest](../../../.ref/parity/16.01/runs/20261101-codex-general-open/actual/build-manifest.json)绑定输入及dirty摘要。构建不是原生UI或像素验收，整分区仍未验收。

下一分区已完成[16.02外观修改前合同](../specs/16-02-appearance.md)及固定原包五资源核验，接续模式/系统跟随、独立界面和代码字号的实际消费者开发。
