# 15A 归档分页、明确恢复与真实删除

日期：2026-11-01。增量自动自验通过，整页未验收。

## 依据和实现

先读固定原包并记录[修改前合同](../specs/15-archive-actions.md)及[原始片段](../../../.ref/parity/15/runs/20261101-codex-archive-actions/reference/trace.json)。本机参考含offline patch，未沿用其中吞读取错误的降级。

- `ArchiveView.tsx`按nextCursor读取全量本地归档，检测重复游标；失败保留先前完整数据，不用部分结果宣称全量成功。搜索用useDeferredValue过滤完整列表，刷新/重试不改搜索词，不再对每次输入请求服务端。
- 恢复/删除共用同步ref锁，开始写使旧读取失效；成功移除对应行并真实重读，失败明确显示原因、保留条目、释放锁；卸载后响应失效。服务端写成功但刷新失败会同时显示读取错误，不能将该情况称数据闭环完成。
- 本地标题改为非交互文本；明确取消归档成功后留在管理页，页面“查看”再用现有selectThread导航。移除App吞unarchive错误后继续打开的旧callback。
- Rust `thread_delete`真实delete错误用`?`透传，成功后才清本地record；删除archive fallback，绝不把归档当彻底删除。旧record清理本身的落盘失败处理未改变。

无新增依赖，复用现有thread/list/unarchive/delete、会话导航和样式。

## 验证

AA01先红捕获首100条截断，AA01–AA06执行生产callback覆盖两页完整读取、重复cursor、乱序/卸载、完整列表本地搜索、取消、同步写锁、恢复失败/成功重读及删除拒绝。Rust清理顺序的源码检查只证明接线，不代替实际服务删除测试。

完整标准检查、协议探针和构建结果以[actual](../../../.ref/parity/15/runs/20261101-codex-archive-actions/actual)为准。

最终完整`verify-all.ps1`退出0（含新增真实归档探针），全量Rust95项通过、0失败，Release/MSI/NSIS退出0；八项绑定输入指纹前后一致。原生EXE为[CodexNative.exe](../../../dist-artifacts/15-archive-actions-20261101/CodexNative.exe)，13,961,216 bytes，SHA-256 `899B9EF75F702F9870189C0AA33D5AA4F9A3585D060A068A66F0089F98F7241F`，详见[build-manifest](../../../.ref/parity/15/runs/20261101-codex-archive-actions/actual/build-manifest.json)。无独立lint配置，Vite大chunk警告保留。

隔离真实探针实际使用CLI **0.159.2**（不是14A字段schema生成的0.165.0）：两个测试聊天归档后按limit1遍历；恢复后真实rollout位于隔离sessions并可读取；再次归档后真实删除，列表不含且read报错，另一个聊天仍可读；全程无模型turn。证据保存在`actual/protocol-final.json`，不证明Tauri本地record持久化或历史内容完整保全。第一次探针将无模型fixture的turns非空作为断言失败，随后按实际path/cwd/文件读取修正；不把该fixture称生成历史。

## 未验和范围

项目/云端筛选、排序、项目与全部批删、官方完整布局、恢复后加载失败特定状态尚未完整实现。本轮沿用window.confirm与页内成功查看按钮，未声称它们对应官方原生dialog/toast的像素表现。

真实官方运行时、当前原生键盘/焦点/IME、同条件截图与像素未验，不打视觉分数。没有向真实用户历史执行恢复或删除。15整页未验收，未提交推送。
