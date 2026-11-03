# 16.18B 云端存储配额实施草案

状态：已集成主根，定向 Rust /跨层、完整非Fast标准与原生构建通过，限定增量待用户验收；不属于整页或像素验收。

## 范围与依据

修改前合同为 `docs/antigravity/specs/16-18B-cloud-usage.md`，固定 Store 版本 `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。
原始证据：`.ref/parity/16.18/actual/16-18B-research/{manifest.json,anchors.json,contract.md,raw/}`。
`quota-query` 与 `quota-fields-and-threshold` 锚点分别证明固定 GET `/files/library/storage/usage`、身份 query key、禁止自动重试与配额字段/阈值；网络客户端添加已有鉴权与取消上下文。

本阶段只接真实总配额，不实现分类统计、Library cleanup/delete、付款或升级。当前固定包没有旧 storage-settings chunk，因此复用现有 settings/card 样式，不能宣称布局 1:1。

## 实现映射

- `src-tauri/src/chatgpt_service.rs`：增加固定 `StorageUsage` GET `/backend-api/files/library/storage/usage`，参数空白名单；复用原有身份/工作区路由、请求认证、浏览器 profile、网络策略、取消与代次检查，不新增任意 URL 或凭证 IPC。
- `src/chatgptService.ts`：增加 `storage_usage` operation；复用实际请求 ID、账号、用户及 generation 响应边界校验。
- `src/storageUsage.ts`：生产 parser 读取 `used_bytes/allowed_bytes/remaining_bytes/is_over_limit`，套餐字段只验证实际返回类型，不造默认套餐。缺少字段、非数字、非有限数字、负 used/allowed 均报错，不填 0。官方 fullness consumer 接受 `remaining_bytes <= 0`，因此允许负剩余表示超额，不反推 used/allowed 算剩余额。阈值为 full（over-limit 或剩余 <= 0）、almostFull（allowed > 0 且剩余比例 <= 10%）、normal。
- `StorageSettings.tsx` 与 `SettingsView.tsx`：实际登录身份读配额；加载、错误重试、重新读取，scope/账号事件/连接事件清旧数据并取消旧请求；离页取消与注销监听。显示真实已用、总额和剩余；allowed=0 时不构造除零进度，超额进度条视觉截到满额，数字保留实际值。无本地统计替代、假分类或清理/升级成功。
- `scripts/verify-storage-settings.mjs`：保留历史破坏性清理入口和本地统计替代禁令，改为加载生产 TypeScript parser/client/组件，覆盖阈值、schema、请求身份边界、晚到取消、scope/账号代次、重试、监听清理。

## 当前验证

- `node scripts/verify-storage-settings.mjs`：退出 0，生产模块与组件回归通过。
- `npx tsc --noEmit`：退出 0。
- `git diff --check`：退出 0。
- 主根首次 Rust 定向测试 3 通过、1 失败：新操作没有进入应用网络策略检查分支，隔离传输收到不应发送的请求并因无预设响应失败。原失败日志保留为 `rust-quota.log/.exit`；将 StorageUsage 加入既有网络策略检查分支后 4 项通过，见 `rust-quota-fixed.log/.exit`。没有降低测试要求。
- 实际 Rust ServiceResponse -> 生产 TypeScript 请求身份校验 -> 配额 parser 贯通退出0，见 `native-fixture.json`、`cross-layer.log/.exit`。HTTP为隔离传输，不代表真实账号访问成功。
- 浏览器生产组件＋真实客户端＋隔离IPC验证加载结果、失败清旧、重试、超额负剩余与满额进度。640×900下documentWidth=640，无横向溢出；截图与DOM数据见 `browser/`。没有同条件官方参考图，不适用 visual-verdict 比较评分；不造90分或1px通过。
- 复用固定认证服务、现有事件与settings/card样式，无新依赖。完整标准及原生构建结果由阶段验收表登记。

未验证：真实账号 HTTP、当前设置页官方运行时/像素、原生 GUI/IME、多窗口、分类统计/Library 管理/升级。隔离传输 fixture 只证明协议封装与状态边界，不证明线上服务响应完整 schema 或官方账号可用性。

## 独立复核修复

- P2：仅监听账号更新/连接状态会遗漏登录启动或登出前的 `chatgpt-service:invalidated`，其他窗口旧配额可能长期显示。新增该事件监听立即取消、递增epoch、清空快照并提示重读；等待身份更新、连接变化或显式重试，避免认证切换未完成时又读回旧账号。
- `invalidation-before.log/.exit`保留修复前失败；`invalidation-fixed.log/.exit`为修复后生产组件与Rust响应贯通通过，TypeScript再次退出0。独立只读复核确认P2解决，未发现新确凿P1/P2。截图采自这次认证事件修复前的等价可见布局，不作为最终源码的原生/像素证明。

最终完整标准与原生包均退出0，308项输入稳定、8项产物归档，见[阶段验收](acceptance/16-18B.md)。下一[16.18C只读合同](specs/16-18C-library-cleanup-read.md)已补接口分支、已加载页排序、真实分页sentinel和gate/语言证据，尚未开发。
