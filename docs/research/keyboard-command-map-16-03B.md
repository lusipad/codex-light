# 16.03B 官方命令与本地消费者映射

来源：Store 26.1021.3705 的 `src-Dl21kCYQ.js` 静态 AST catalog 与原始 zh-CN 消息；参考合同 `docs/antigravity/specs/16-03-next-closure.md`。本表覆盖 184 个定义，注册不等于执行或验收通过。

本阶段保留旧 local dispatch IDs，以官方 command ID 写 keybindings.json；读时用 migrateKeyBindings 解析固定 Windows 旧别名/版本，不修改原始存储数组。未对应官方命令的 escape、zoom-*、open-review 是既有本地动作，保持不可配置；不会作为官方目录完成项。

默认编号目标 tabs：sidebar 1–9 为 Alt+数字；切 sidebar 后为 CmdOrCtrl+数字。recentThread1–6 仍为 Ctrl+Alt 槽位，不能混同。工作台已有真实文件/审查标签，Ctrl+数字仅由该工作台消费者处理，不转换为侧栏聊天。

| 官方 ID | 官方中文 | 本地 ID / 消费者或未支持边界 |
| --- | --- | --- |
| `spotlightSearch` | Spotlight 搜索 | 系统全局注册、平台或语音服务能力未闭环 |
| `toggleNotch` | 展开/收起刘海面板 | 系统全局注册、平台或语音服务能力未闭环 |
| `notchVoice` | 在 Mini 中使用语音 | 系统全局注册、平台或语音服务能力未闭环 |
| `screenshotToCurrentChat` | 截取所选区域并添加到当前聊天 | 系统全局注册、平台或语音服务能力未闭环 |
| `screenshotToNewChat` | 截取所选区域并添加到新聊天 | 系统全局注册、平台或语音服务能力未闭环 |
| `hotkeyWindow` | 弹出窗口快捷键 | 系统全局注册、平台或语音服务能力未闭环 |
| `globalDictationHold` | 听写快捷键 | 系统全局注册、平台或语音服务能力未闭环 |
| `globalDictationSingleTap` | 点按一次听写 | 系统全局注册、平台或语音服务能力未闭环 |
| `realtimeVoice` | 语音聊天快捷键 | 系统全局注册、平台或语音服务能力未闭环 |
| `copyConversationPath` | 复制对话路径 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `copyDeeplink` | 复制深层链接 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `copyWorkingDirectory` | 复制工作目录 | `copy-working-dir` → App 同动作处理器（具体接线与测试见阶段验收） |
| `closeTab` | 关闭标签页 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `closeWindow` | 关闭 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `reloadBrowserPage` | 重新加载浏览器页面 | 浏览器宿主/标注消费者未接入 |
| `hardReloadBrowserPage` | 强制重新加载浏览器页面 | 浏览器宿主/标注消费者未接入 |
| `newWindow` | 新窗口 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `openCommandMenu` | 打开命令菜单 | `command-palette` → App 同动作处理器（具体接线与测试见阶段验收） |
| `searchFiles` | 搜索文件… | `file-search` → App 同动作处理器（具体接线与测试见阶段验收） |
| `renameThread` | 重命名聊天 | `rename-thread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `toggleTraceRecording` | 开始跟踪记录 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `implementTodo` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `openSidebar` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `newCodexPanel` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `addToThread` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `addFileToThread` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `showLspMcpCliArgs` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `dumpNuxState` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `resetNuxState` | 语言包无标题/由工具上下文提供 | VS Code 扩展专用，不适用桌面 |
| `newTask` | 新聊天 | `new-chat` → App 同动作处理器（具体接线与测试见阶段验收） |
| `newProjectlessTask` | 新建独立聊天 | `new-standalone-chat` → App 同动作处理器（具体接线与测试见阶段验收） |
| `temporaryChat` | 新建临时聊天 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `openThreadInNewWindow` | 在新窗口中打开 | `open-thread-new-window` → App 同动作处理器（具体接线与测试见阶段验收） |
| `archiveThread` | 归档聊天 | `archive-thread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `deleteOrbit` | 删除 {dot} | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `deleteChat` | 删除聊天 | `delete-chat` → App 同动作处理器（具体接线与测试见阶段验收） |
| `markThreadUnread` | 标记为未读 | `mark-thread-unread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `toggleThreadPin` | 切换置顶状态 | `pin-thread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `copyConversationMarkdown` | 复制为 Markdown | `copy-conversation-markdown` → App 同动作处理器（具体接线与测试见阶段验收） |
| `copyLastCodeBlock` | 复制最后一个代码块 | `copy-last-code-block` → App 同动作处理器（具体接线与测试见阶段验收） |
| `openSideChat` | 打开侧边聊天 | `open-side-chat` → App 同动作处理器（具体接线与测试见阶段验收） |
| `openControlWindow` | 打开控制窗口 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `toggleDebugModal` | 切换调试面板 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `undoAppAction` | 撤销上一步操作 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `redoAppAction` | 重做上一步操作 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `reopenClosedTab` | 重新打开已关闭的标签页 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `composer.openModelPicker` | 选择推理强度 | `open-model-picker` → Composer（启用/焦点由组件判断） |
| `composer.openRecentModels` | 打开最近使用的模型 | 本阶段未接对应Composer能力/启用条件 |
| `composer.openProjectPicker` | 打开项目选择器 | 本阶段未接对应Composer能力/启用条件 |
| `composer.startVoiceMode` | 切换语音聊天 | 系统全局注册、平台或语音服务能力未闭环 |
| `realtimeVoice.toggleMicrophoneMute` | 切换语音聊天麦克风 | 系统全局注册、平台或语音服务能力未闭环 |
| `realtimeVoice.toggleOutputMute` | 切换语音聊天音频 | 系统全局注册、平台或语音服务能力未闭环 |
| `realtimeVoice.endCall` | 结束语音聊天 | 系统全局注册、平台或语音服务能力未闭环 |
| `meetings.takeNotes` | 会议：记笔记 | 系统全局注册、平台或语音服务能力未闭环 |
| `browser.toggleAnnotationMode` | 切换标注模式 | 浏览器宿主/标注消费者未接入 |
| `presentation.duplicateSelection` | 语言包无标题/由工具上下文提供 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifact.sendAnnotations` | 发送批注 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `composer.submitInBackground` | 在后台发送消息 | 本阶段未接对应Composer能力/启用条件 |
| `composer.submit` | 发送消息 | `composer-submit` → Composer（启用/焦点由组件判断） |
| `composer.steer` | 引导提示 | `composer-steer` → Composer（启用/焦点由组件判断） |
| `composer.queue` | 将提示加入队列 | `composer-queue` → Composer（启用/焦点由组件判断） |
| `composer.clear` | 清除提示 | `composer-clear` → Composer（启用/焦点由组件判断） |
| `composer.addPhotos` | 添加照片 | 本阶段未接对应Composer能力/启用条件 |
| `composer.captureAppshot` | 捕获应用快照 | 本阶段未接对应Composer能力/启用条件 |
| `composer.addFiles` | 附加文件和文件夹 | `composer-add-files` → Composer（启用/焦点由组件判断） |
| `composer.toggleFastMode` | 循环切换速度 | `composer-toggle-fast-mode` → Composer（启用/焦点由组件判断） |
| `composer.increaseReasoningEffort` | 提高推理强度 | `composer-increase-reasoning-effort` → Composer（启用/焦点由组件判断） |
| `composer.decreaseReasoningEffort` | 降低推理强度 | `composer-decrease-reasoning-effort` → Composer（启用/焦点由组件判断） |
| `composer.cycleReasoningEffort` | 循环切换推理强度 | `composer-cycle-reasoning-effort` → Composer（启用/焦点由组件判断） |
| `composer.togglePlanMode` | 切换规划模式 | `composer-toggle-plan-mode` → Composer（启用/焦点由组件判断） |
| `composer.toggleWorktreeMode` | 切换本地/工作树 | 本阶段未接对应Composer能力/启用条件 |
| `composer.cycleHost` | 在主机间循环切换 | 本阶段未接对应Composer能力/启用条件 |
| `composer.toggleWorkRunLocation` | 切换云端/本地 | 本阶段未接对应Composer能力/启用条件 |
| `approval.approve` | 批准请求 | `approval-approve` → 审批弹层（仅当前活动请求） |
| `approval.decline` | 拒绝请求 | `approval-decline` → 审批弹层（仅当前活动请求） |
| `git.commit` | 提交或推送 | `git-commit` → App 同动作处理器（具体接线与测试见阶段验收） |
| `git.createPullRequest` | 创建 PR | `git-create-pull-request` → App 同动作处理器（具体接线与测试见阶段验收） |
| `git.createDraftPullRequest` | 创建草稿 PR | `git-create-draft-pull-request` → App 同动作处理器（具体接线与测试见阶段验收） |
| `git.createBranch` | 创建分支 | `git-create-branch` → App 同动作处理器（具体接线与测试见阶段验收） |
| `git.mergePullRequest` | 合并 PR | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `git.openPullRequest` | 在 GitHub 上打开 PR | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `git.toggleBlame` | 切换 Git 追溯信息 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `forkThread` | 分叉聊天 | `fork-thread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `openAvatarOverlay` | 显示 Mini | 系统全局注册、平台或语音服务能力未闭环 |
| `searchChats` | 切换聊天… | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `togglePriorityFilter` | 切换活动视图 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `focusMainChat` | 聚焦主聊天输入框 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `focusSideChat` | 聚焦侧边聊天 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `artifacts.selectTool` | 工件：选择 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.handTool` | 工件：平移 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `canvas.prompt` | 画布：询问 ChatGPT | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.rectangleTool` | 工件：矩形 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.circleTool` | 工件：圆形 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.arrowTool` | 工件：箭头 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.lineTool` | 工件：直线 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.textTool` | 工件：文本 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `artifacts.noteTool` | 工件：便签 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `copyPageLink` | 复制文档链接 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `focusPageBlockControls` | 将焦点移至内容控件 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `page.formatNumberedList` | 编号列表 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `page.formatBulletedList` | 项目符号列表 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `page.formatChecklist` | 核对清单 | Pages/Canvas/Artifact服务与编辑消费者未接入 |
| `openOrbit` | 打开您的 Dot | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `nextThreadNeedingAttention` | 下一个需关注的聊天 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `previousTab` | 上一个标签页 | `previous-tab` → App 同动作处理器（具体接线与测试见阶段验收） |
| `previousThread` | 上一个侧边栏项目 | `previous-thread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `previousRecentThread` | 上一个最近查看的聊天 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `nextTab` | 下一个标签页 | `next-tab` → App 同动作处理器（具体接线与测试见阶段验收） |
| `nextThread` | 下一个侧边栏项目 | `next-thread` → App 同动作处理器（具体接线与测试见阶段验收） |
| `nextRecentThread` | 下一个最近查看的聊天 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `recentThread1` | 转到最近聊天 1 | `recent-thread-1` → App 同动作处理器（具体接线与测试见阶段验收） |
| `recentThread2` | 转到最近聊天 2 | `recent-thread-2` → App 同动作处理器（具体接线与测试见阶段验收） |
| `recentThread3` | 转到最近聊天 3 | `recent-thread-3` → App 同动作处理器（具体接线与测试见阶段验收） |
| `recentThread4` | 转到最近聊天 4 | `recent-thread-4` → App 同动作处理器（具体接线与测试见阶段验收） |
| `recentThread5` | 转到最近聊天 5 | `recent-thread-5` → App 同动作处理器（具体接线与测试见阶段验收） |
| `recentThread6` | 转到最近聊天 6 | `recent-thread-6` → App 同动作处理器（具体接线与测试见阶段验收） |
| `switchToMode1` | 切换到聊天 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `switchToMode2` | 切换到工作 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `switchToMode3` | 切换到 Codex | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `settings` | 设置 | `open-settings` → App 同动作处理器（具体接线与测试见阶段验收） |
| `codexMicroSettings` | Codex Micro 设置 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `mcpSettings` | MCP | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `personalitySettings` | 个性 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `importExternalAgent` | 从其他 AI 应用导入 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `keyboardShortcuts` | 键盘快捷方式 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `showKeyboardShortcuts` | 显示键盘快捷键 | `show-keyboard-shortcuts` → App 同动作处理器（具体接线与测试见阶段验收） |
| `clearAllUnreads` | 全部标为已读 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `manageTasks` | 管理已安排任务 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `forceReloadSkills` | 强制重新加载技能 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `openSkills` | 前往技能 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `newProject` | 新建项目 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `openFolder` | 打开文件夹 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `toggleSidebar` | 显示/隐藏侧边栏 | `toggle-sidebar` → App 同动作处理器（具体接线与测试见阶段验收） |
| `toggleFileTreePanel` | 显示/隐藏导航面板 | `toggle-file-tree` → App 同动作处理器（具体接线与测试见阶段验收） |
| `toggleBottomPanel` | 显示/隐藏底部面板 | `toggle-bottom-panel` → App 同动作处理器（具体接线与测试见阶段验收） |
| `togglePinnedSummary` | 切换摘要面板固定状态 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `toggleTerminal` | 打开终端 | `toggle-terminal` → App 同动作处理器（具体接线与测试见阶段验收） |
| `newTab` | 新建标签页 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `closeOtherTabs` | 关闭其他标签页 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `showWorkspaceTabView` | 完整视图 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `stepWorkspaceLayout` | 循环切换工作空间布局 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `openReviewTab` | 打开“变更”选项卡 | `open-review-tab` → App 同动作处理器（具体接线与测试见阶段验收） |
| `toggleReviewTab` | 显示/隐藏“变更”面板 | 缺完整真实标签页/布局消费者，本阶段不造标签行为 |
| `toggleSidePanel` | 显示/隐藏“变更”面板 | `toggle-changes` → App 同动作处理器（具体接线与测试见阶段验收） |
| `file.goToDefinition` | 转到定义 | 语言导航/文件编辑器作用域尚未接入 |
| `file.findReferences` | 查找引用 | 语言导航/文件编辑器作用域尚未接入 |
| `file.navigateBack` | 在文件导航中后退 | 语言导航/文件编辑器作用域尚未接入 |
| `file.navigateForward` | 在文件导航中前进 | 语言导航/文件编辑器作用域尚未接入 |
| `findInThread` | 查找 | `find-in-chat` → App 同动作处理器（具体接线与测试见阶段验收） |
| `goToLine` | 转到行 | 语言导航/文件编辑器作用域尚未接入 |
| `focusBrowserAddressBar` | 聚焦浏览器地址栏 | 浏览器宿主/标注消费者未接入 |
| `navigateBrowserBack` | 浏览器返回 | 浏览器宿主/标注消费者未接入 |
| `navigateBrowserForward` | 浏览器前进 | 浏览器宿主/标注消费者未接入 |
| `navigateBack` | 返回 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `navigateForward` | 前进 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `logOut` | 退出登录 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `feedback` | 反馈 | 本阶段未核实真实处理器及启用条件；不展示可配置空处理器 |
| `environmentAction1` | 环境操作 1 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction2` | 环境操作 2 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction3` | 环境操作 3 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction4` | 环境操作 4 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction5` | 环境操作 5 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction6` | 环境操作 6 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction7` | 环境操作 7 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction8` | 环境操作 8 | 真实环境动作槽位及执行能力尚未接入 |
| `environmentAction9` | 环境操作 9 | 真实环境动作槽位及执行能力尚未接入 |
| `thread1` | 转到聊天 1 | `sidebar-thread-1` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread2` | 转到聊天 2 | `sidebar-thread-2` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread3` | 转到聊天 3 | `sidebar-thread-3` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread4` | 转到聊天 4 | `sidebar-thread-4` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread5` | 转到聊天 5 | `sidebar-thread-5` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread6` | 转到聊天 6 | `sidebar-thread-6` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread7` | 转到聊天 7 | `sidebar-thread-7` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread8` | 转到聊天 8 | `sidebar-thread-8` → App 同动作处理器（具体接线与测试见阶段验收） |
| `thread9` | 转到聊天 9 | `sidebar-thread-9` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab1` | 聚焦第 1 个标签页 | `focus-tab-1` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab2` | 聚焦第 2 个标签页 | `focus-tab-2` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab3` | 聚焦第 3 个标签页 | `focus-tab-3` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab4` | 聚焦第 4 个标签页 | `focus-tab-4` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab5` | 聚焦第 5 个标签页 | `focus-tab-5` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab6` | 聚焦第 6 个标签页 | `focus-tab-6` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab7` | 聚焦第 7 个标签页 | `focus-tab-7` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab8` | 聚焦第 8 个标签页 | `focus-tab-8` → App 同动作处理器（具体接线与测试见阶段验收） |
| `focusTab9` | 聚焦第 9 个标签页 | `focus-tab-9` → App 同动作处理器（具体接线与测试见阶段验收） |

资格与冲突依据：command-row @10065 仅 webview 非 OS-global/submit/annotation 可录序列；宿主命令仍可追加单键；src-Dl21kCYQ @555470/557354 的三组共享与 Enter submit/approve 例外。默认绑定被显式占用时释放，但不会将未知服务命令或动态 submit 默认假装加入全局监听。

Ctrl+B：command-row @2624 明确默认 sidebar 的第二绑定只在 Composer 未选中光标起点生效；其余位置让给 bold。终端继续只允许终端/底部面板与缩放，单字键输入、IME 与 defaultPrevented 不进入全局动作。受控 DOM/事件验证与真实 Windows 原生焦点、中文 IME 实测分开记录。

## 导航消费者补证（只读 Store 原包）

新增 entry `webview/assets/app-primary-844e405f2b90.js` 原包 entry integrity 匹配，SHA-256 `298f4c7bafe278563aa82ef8d8d4c1afe3f581d54915917849065085f7f621d2`。可复现只读扫描与精确片段见 `.ref/parity/16.03/actual/16-03B-research/navigation-consumer-search.json`、`navigation-consumer-anchors.json`。

- `app-primary` `oVn` @2090698：从 DOM `[data-sidebar-cycle-item]` 取当前合格项目顺序，`s.findLast(sVn)` 找最后 `aria-current=page`；`h=index±1`，无当前时下一项取首、上一项取末，超边界 `if(g==null)return`。**不循环**，目标不仅限聊天行。`xK` 排除隐藏、禁用、弹出菜单触发器，保留符合条件的 collapsed sidebar inert 标记。
- `app-primary` `wn` @3389900：编号目标按当前 section 与真实已呈现列表的顺序合并、去重；`Tn=wn().slice(0,9)`，`qU/exn` 使用 `getTargets()[index]`。底层 `app-initial` `kNi` @5621438 明确 `pinnedCollapsed/projectsCollapsed/chatsCollapsed` 为 true 时对应 section 贡献空数组；不得退回全部 pinned+threads 重新纳入折叠分区。
- 整个侧栏收起不同于 section 折叠：`app-primary` 的 `runWithSidebarContent` 调 `iSr` @3501855，以 `flushSync(set(true))` 临时呈现、执行操作后 `finally flushSync(set(false))`。本项目未实现这条生命周期时应标未对齐，不能将无 DOM 行回退任意数据列表冒充官方行为。

以上是静态消费者证据；没有运行官方 GUI，也没有证明当前账号每类 sidebar item 可见。
