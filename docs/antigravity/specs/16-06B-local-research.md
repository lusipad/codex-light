# 16.06B 本地配置页取证（修改前）

状态：新包静态调研完成；不表示官方运行时、原生或像素验收通过。本文不沿用 16.06A 旧包证明。

## 1. 来源与边界

- Store：`OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`。
- 原包：`C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。
- 固定包 SHA-256：`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`；本次只读抽取，额外文件逐个与 archive header integrity.hash 比较。
- 本次额外文件清单：`.ref/parity/16.06/actual/16-06B-research/local-files-manifest.json`。
- 精确定位和原始片段：同目录 `local-anchors.json`；所有偏移均为 **0-based UTF-16 code unit**，不是字节或行号。
- 共用 initial、中文包来源为 `.ref/parity/16.05/actual/16-05B-research/raw/`，该阶段 manifest 保存完整 SHA-256。本次文件位于 16.06B 的 `raw/`。
- 尚未取得官方当前账号页面截图、运行时控件树和点击证据。下面结论是静态实现事实，不把 capability/gate 存在等同账号已启用。

## 2. 路由和分支

`/settings/:section/*` 中的 `agent` 不是 Work 面板别名。`settings-lazy-routes-1c307af3cdd3.js:6092` 导入 `configuration-panel-cb7ffcf1a381.js` 的 `ConfigurationPanel`。

`ConfigurationPanel`（`ur`，偏移 45056）判断 `work.cloud-orchestration.preferences` capability 和 allowed 状态。不具备能力时直接渲染本地 `Ln`；具备能力时才加入 Work scope，其内容来自独立 `panel-e921be19ab4d.js`。另外 `work-settings` 路由加载 `panel-93241afe1ff1.js`，不能替代 agent 本地页。

新中文包 `zh-CN-88ebb426d686.js:1907079` 的 `settings.nav.agent` 是 **配置**。不能凭旧页面名将导航继续写成“智能体”。本地副标题（偏移 1666992）：**配置新聊天的权限、网页访问和智能体回复 <a>了解更多</a>**。

主 chunk：`configuration-panel-cb7ffcf1a381.js`，46414 bytes，SHA-256 `563a9070e939eb77627a2a309e047d4a28852b01acc54bdda7e7deefa9b4809d`。

## 3. 页面结构、控件与存储

本地主体 `Hn` 偏移 26288。顺序是 scope 下拉与“打开 config.toml”、审批、沙盒、条件网络访问、网页搜索、输出详细程度、推理摘要。不是 Provider 表单，也没有模型/推理力度选择器。

| 顺序 | 中文控件 | 真实 key | 菜单值/条件 |
|---|---|---|---|
| 1 | 批准策略 | `approval_policy` | `on-request` 按请求、`never` 从不请求审批。历史 `untrusted` 不可信和 `on-failure` 失败时仅用于显示已有值，不进入新选择菜单 |
| 2 | 沙盒设置 | `sandbox_mode` | `read-only` 只读、`workspace-write` 工作空间写入、`danger-full-access` 完整访问权限 |
| 3 | 允许网络访问 | `sandbox_workspace_write.network_access` | 仅当前 scope 或继承的有效 sandbox 为 workspace-write 时显示；boolean 开关，缺省 false |
| 4 | 网页搜索 | `web_search` | `disabled` 禁用、`cached` 缓存、`indexed` 索引、`live` 实时；依据 requirements 和 app-server 版本过滤 |
| 5 | 输出详细程度 | `model_verbosity` | null 模型默认、`low` 低、`medium` 中、`high` 高 |
| 6 | 推理摘要 | `model_reasoning_summary` | `auto` 自动、`concise` 简洁、`detailed` 详细、`none` 无；缺省 auto |

选项定义偏移 43443；本地允许写入白名单 `Sn` 偏移 5579；中文 key 与完整原句由 `local-anchors.json` 逐项保存。

网页搜索版本过滤位于 `app-initial-4267e52fe5b0.js:3443482`：indexed 仅在版本等于 `0.0.0` 或合法 semver >= `0.142.0-alpha.6` 时允许；disabled 不被 allowedModes 删掉，其它按 allowedModes 过滤。未设置 web_search 时 full-access 默认 live，其它默认 cached（偏移 3443684）。不能用未知版本直接放行 indexed。

## 4. scope、继承和锁定

scope 从 config/read 返回的 layers 构建：项目配置（`project`）、用户配置（`user`）、管理员配置（`managed`）；Work 可用时用户显示 Codex、管理员显示 Admin，并加入独立 Work 项。项目项源自 `dotCodexFolder`，不是任意文件路径输入框。

项目 scopes `Kn` 偏移 40586；取值 `Yn` 偏移 41258；scope 禁用 `Xn` 偏移 42011；单项 managed 锁定 `Zn` 偏移 42490。scope 局部值为空时展示有效 config 继承值，不能只读用户层冒充有效项目设置。

- 本地无 Work 时，有 workspace 上下文优先选择对应 project scope；否则按可用 scope。Work 混合页默认 user/Codex。
- managed scope 或无 filePath 时整个编辑区域不可编辑。
- project layer `disabledReason` 会展示警告并禁用编辑。
- approval/sandbox 选项按 requirements 的 `allowedApprovalPolicies`、`allowedSandboxModes` 过滤。
- origin 属于 mdm/sessionFlags/legacy managed 时，相应控件锁定并显示“此值由管理员策略管理”。不能只过滤菜单却仍允许保存覆盖。
- 页面 config/requirements pending 时禁止编辑；每项写入 pending 分别禁用；失败在该控件描述区域显示错误。

## 5. 写入链与结果确认

`configuration-panel:29748` 传入 `{cwd, expectedVersion, filePath, keyPath, kind, projectWrite, value}`。

`app-initial:3462102` 的 `PNn` 为每个 host 排队写入；user 每次执行写入前通过 `CNn`（3460494）重新读取 user layer 得到最新 path/version。然后：

```text
config/value/write {
  keyPath, value,
  mergeStrategy: value == null ? "replace" : "upsert",
  filePath, expectedVersion
}
```

project 分支不是直接套上面 RPC：`xn`（4886）读取所选项目 config 文本、解析 TOML、保留其它字段/注释修改白名单、重新解析再真实写文件。若 sandbox_workspace_write 是 inline table，拒绝自动改 network 并提示直接编辑 config.toml。不能为实现便利覆盖整个 TOML 或改写其它 scope。

成功写后重新读取有效 config（失败再重试一次），随后 invalidates layered/effective/requirements 等查询；没有官方证据允许只显示 toast 当作保存成功。跨窗口版本冲突也不能静默覆盖。

## 6. 附属区块与不要假造的能力

- `Ln:13378` 可展示 config warnings（来源文件/行列、“打开文件”动作）。
- `Mn:9498` 为 gate `2106641128` 下实验性质功能；从真实 feature 返回表生成。request-user-input 是独立偏好，标明只影响新聊天。不能无依据写死实验性列表。
- Workspace Dependencies 区受 gate `3026692602`、local host、primaryRuntime 适配存在共同限制；含真实 diagnose/reset/install。没有适配不能做假进度或伪安装成功。
- Work 是账号服务配置，不可将本地 TOML 写入冒充 Work 成功。
- 模型推理力度 `model_reasoning_effort` 不在本地配置页上述六项中；此处“推理摘要”不能实现成推理力度。

## 7. 开发前可验证合同

1. 等价 layers/requirements 输入下，顺序和选项与上述静态合同匹配；旧值 on-failure/untrusted 能显示但不可新选。
2. workspace-write 才显示 network；切 sandbox 后重新计算显示和有效继承值。
3. 管理锁定、禁用 project、读取失败/待加载均不能写入；错误保留原值并允许重试。
4. user/project 写入只改变对应 scope 的白名单 key；保存后重读；同时两个窗口修改互不静默覆盖。
5. 项目 TOML 注释、其它字段、多行字符串保留；损坏 TOML 和 inline sandbox network 写入必须失败且文件不变。
6. 设置只承诺新聊天默认值；已有会话发送参数和既有 profile 选择不能被误覆盖。
7. 原生打开指定 config 文件需真实调用宿主；浏览器替身只能证明 UI 路由，不能标为原生通过。
8. 官方同尺寸截图缺失，视觉和官方运行时待采证；不得从夹具分数宣称严格 1:1。

## 8. 默认配置必须进入真实发送

保存 TOML 但发送仍硬编码 on-request/workspaceWrite/network false，不构成功能闭环。新包权限解析的主要帮助函数在 `app-shared-b9a49a97ca55.js`：

- `ytt:1702112`：custom 模式从真实 config 解析审批、reviewer、sandbox，workspace-write 完整消费 writable_roots、network_access、exclude_slash_tmp、exclude_tmpdir_env_var；缺 sandbox 默认 readOnly。
- `JJ:1702435`：custom 调用上项；用户显式 auto/read-only/full-access 等 preset 则生成对应 preset 权限，因此不能强制所有保存配置覆盖用户明确选择的 preset。
- `Stt:1703635`：计算配置等价 preset；含自定义 network 或额外 roots 的 workspace 配置不等价普通 auto，进入 custom。
- `KJ:1701371`：workspaceWrite 转换，保留 network、额外 roots、tmp 排除；不是单一 boolean auto 开关。
- 提交路径 `app-initial:9181059` 在 custom 等适用分支读取 `config/read` 的当前 cwd 有效 config，再调用导入为 Ao 的 JJ；`7862339` 为 Composer 权限选择生成相同 override。

实现应区分新聊天配置默认、已有聊天当前权限、用户显式 preset。新聊天从相应 cwd 的有效配置解析；已有聊天保持真实 thread 权限；显式 preset 才覆盖对应字段。页面副标题承诺新聊天，六项设置没有要求重启的 notice（实验性功能区是另一条重启合同）。
