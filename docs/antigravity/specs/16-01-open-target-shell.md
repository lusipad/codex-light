# 16.01B 默认打开目标与 Windows 新终端 Shell

日期：2026-11-01。修改前合同；不表示已验收。

原包 general-settings-cbce7da152c5.js 的 Rs 调用 openIn.getTargets({cwd:null})，仅展示 available 文件/目录目标，变更即时 setGlobalPreferredTarget；Vs 仅 Windows 显示，powershell/commandPrompt 总在列表，gitBash/wsl 按检测；默认 powershell。main-DkWgQSQe.js 的 n1 保存 openInTargetPreferences.global，terminalManager 获取 integratedTerminalShell。进一步检测与命令细节由[原包证据](../../../.ref/parity/16.01/runs/20261101-codex-general-settings/reference/open-target-shell-trace.json)补证，不复用离线 patch 强制 gate。

| 用例 | 预期 |
|---|---|
| GT01 | 真实检测目标，不能把不存在的编辑器显示为可用；无目标禁用，不假成功 |
| GT02 | 全局偏好即时持久化，成功重新读取确认；保存失败可见；不写 config.toml |
| GT03 | 打开文件/目录使用实际所选目标，路径作为独立参数；目标丢失应报错，不悄悄记事本 |
| GT04 | Windows Shell 列表和检测一致；无效/不可用值不保存；powershell 默认 |
| GT05 | 更改默认 Shell 后新标签使用新值；已有 session 重附着保持既有 shell 和输出，不重启 |
| GT06 | 异步加载卸载/写锁/失败处理有执行回归；终端既有生命周期和待执行命令回归保持 |

自验范围与原生/官方运行时、像素需分开记录。默认编辑器完整目录、注册表/远程与路径偏好分支未证明时明确列缺口。

已确认：当前已实现子集相对顺序 vscode/insiders/cursor/sublime/zed/antigravity/systemDefault/fileManager；systemDefault Windows无条件可用，fileManager检查SystemRoot/windir后回退explorer.exe。文件为定位而非打开关联程序。
