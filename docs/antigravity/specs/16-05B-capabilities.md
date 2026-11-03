# 16.05B 共享能力与速度层合同补充

2026-11-03。来源为 [16.05B 修改前调研](16-05-next-closure.md) 固定的 Store 26.1027.3384.0 静态提取；不宣称官方 GUI、账户 gate 或像素已验。

## 对外 API

`src/modelCapabilities.ts` 的 `ModelEligibilityContext` 由调用方传真实 host/auth/config 和已核实允许集合。没有 gate 证据时，不自动开放 ultra 或 nonstandard cyber 模型。显式配置的隐藏模型可以保留当前请求资格，但不会因此进入普通 picker。`codex-auto-review` 不用于普通聊天。失效目录中的模型只可显示不可用状态，`modelRequestName` 不再将任意未知名称原样当可执行模型。

`getSupportedEfforts` 只返回实际声明、非空、去重、满足传入启用集合/ultra/Copilot条件的档位。当前协议 `ReasoningEffort` 是非空字符串，不是固定 enum，因此不凭本地翻译表拦截目录已声明的新档位；ultra 独立门控。`resolveReasoningEffort` 保留仍支持的选择，否则选实际默认，再否则首项；没有合法项返回 null。

`ModelConfiguration` 在 `src/types.ts` 定义，并从能力模块重导出。`resolveModelSelection` 为 picker、发送和最近项消费者提供同一可执行结果；它会对不再支持的 effort 回退。最近项若要求丢弃失效原三元组，必须先检查原 effort 在支持集合内，不能把回退当原记录仍有效。

## 真实 service tier

协议 schema 的 `Model.serviceTiers` 指向 `{id,name,description}`；`defaultServiceTier` 明确是目录默认 id。`additionalSpeedTiers` 为 deprecated string[]，不能仅凭 `fast` 字符串推导 `priority` 请求。

新 Store `app-shared-b9a49a97ca55.js` @1851136 (`nht`)、@1851391 (`iht`)、@1851488 (`aht`) 定义：fast 可以按真实 tier id/name 识别，提交仍取对应 id；`flex` 不需 fast 资格，`ultrafast` id 使用 ultrafast 资格，其他非标准 id 走 fast 资格。注意显示名识别与请求 id 资格检查分开，不能把任意自定义名当标准速度。

`getModelServiceTiers` 只接受真实 `serviceTiers`，`getFastServiceTier` 返回真实对象。`resolveServiceTier(model, requested, access)`：

- `undefined` 选择该模型真实 defaultServiceTier；`null` 或 `default` 显式标准，结果 null。
- `fast` 是选择别名，仅映射到该模型宣告的真实 fast tier id；其他字符串必须是该模型真实 id。
- 未宣告、资格缺失或拒绝返回 `available:false`，不在发送边界静默降级为另一速度层。
- `ServiceTierAccess` 必须由已核实的账户/requirements消费者传入；缺少时不会强开非标准速度。模型宣告可用不等于账户获准。

## 验证与边界

`node scripts/verify-model-capabilities-b.mjs` 覆盖身份与未知模型、隐藏配置/普通picker区别、review排除、撤销允许集合、effort保留/回退与门控、真实自定义/fast/priority id、默认与标准区别、未知/拒绝速度层和组合选择结果。`npx tsc --noEmit` 已通过（本子任务执行时的共享工作区）。目录 loader 新增条目 identity 与 opaque cursor 类型检查，保留既有分页和重复 cursor 防护。

以上是纯生产策略回归，不证明当前真实账号的权限、完整 Work 模型链、未恢复的官方 gate、真实模型 turn 或原生/像素一致；这些仍由阶段集成与验收逐项记录。
