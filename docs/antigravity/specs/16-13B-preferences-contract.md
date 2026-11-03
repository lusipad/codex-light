# 16.13B Git 指令偏好与自动保存合同

2026-11-03，修改前合同。基准与取证沿 `16-13-next-closure.md` 和 `.ref/parity/16.13/actual/16-13B-research/`，固定 Store 26.1027.3384.0、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。此文件不是实施或验收通过结论。

## 真实存储和最小接口

- 保留现有三个偏好键及消费者；新增 `git-commit-instructions`、`git-pr-instructions`，默认空串，原文保存，包括换行、首尾空格和清空。仅使用既有 `desktop_state_set/get` 宿主 global-state，不写 config.toml。
- `state.preferences` 含两个 string，`state.save(key,value): Promise<boolean>` 只有 set 后真实 get 严格等于原值才返回 true；不把 IPC 成功等同读回成功。
- 保存按 key 独立单飞；相同在途值复用 Promise，同 key 新值顺序排队，不同 key 互不吞掉。全局 busy 聚合所有请求，文本域不因另一字段保存被禁用。读取时不覆盖正在排队的写入。
- 保留原三个开关的未就绪保护。string 保存失败保留草稿、允许显式重试；旧响应不覆盖新稿，保存成功才更新已保存偏好。卸载后的宿主 flush 可完成，禁止更新卸载组件。
- `instructionsReady` 单独反映两 string 曾成功读取且当前不在重读，避免无关开关失败使指令卸载 flush 被全局 `ready=false` 吞掉。原 `ready` 继续保护 Git 操作消费者，不因 string 保存成功解除未知开关状态。显式重新读取先 flush 两稿，任一失败不继续读。

## 两组界面

6 行 textarea，中文逐 key 对应固定包：

| 标题 | 副标题 | 占位 |
| --- | --- | --- |
| 提交指令 | 将添加到提交信息生成提示中 | 添加提交信息指引… |
| Pull Request 指令 | 将添加到 PR 标题/描述生成提示中 | 添加 Pull Request 指引… |

修改后 3000ms 去抖，显式保存和当前文本域 Ctrl/Cmd+S 立即 flush；输入法合成不触发快捷保存。保存中仍可继续输入；旧稿保存完成只更新对应 saved value，不删除新稿。“已保存”仅在当前稿已读回后显示 3000ms。失败不无限自动重试，保留显式重试。离开页面时清计时器并 flush 最新已准备好的草稿，不能因另一字段 busy 跳过。

现有 CodeReviewSettings 只有专用实现，没有可直接复用的通用 autosave 模块；本单元复用其 ref/effect 模式及公共按钮/文本域风格，不修改公共文件或增加依赖。

## 修改前回归目标

| ID | 操作与期望 |
| --- | --- |
| GIB01 | string 默认/原文/空串 set→get→重新挂载一致；坏类型不写，读回失败不返回成功。 |
| GIB02 | 两 key 同时保存均真实执行；同 key 同值复用，后续新值排队；旧写不吞另一稿。 |
| GIB03 | 2999ms 无写、3000ms 一次；显式/Ctrl+S 取消待触发重复保存，输入法合成不保存。 |
| GIB04 | 保存中继续编辑，新稿保留并在下一次去抖/flush 保存；另一文本域始终可输入。 |
| GIB05 | 失败保稿可重试；未读回不显示已保存，读回成功提示 3000ms；卸载 flush 两稿且无卸载后状态更新。 |
| GIB06 | 初始读取晚到不覆盖用户稿；未 ready 不写；保留三个既有开关和 DiffDrawer 消费回归。 |

自动测试使用隔离内存宿主 transport，不写真实配置，不调用模型、不进行 Git 写入。真实生成指令消费者由父流程完成。官方配对像素、原生 IME/快捷键及真实模型生成仍需单独验收。
