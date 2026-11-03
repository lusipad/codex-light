# 05B 文件外部变更、磁盘冲突与脏草稿关闭合同

日期：2026-11-03。状态：静态调研；保存前内容检查/写后回读见[05B](../acceptance/05B.md)，当前预览先保存再条件放弃的关闭流程见[05C](../acceptance/05C.md)。完整外部review、原生实测与用户验收仍未完成。与 [05A 合同](05-file-editor.md)、[05A 待验](../acceptance/05A.md) 合读；本资料不改变 05 整页未验收状态。下文“本项目实际差距”为调研时快照，当前增量以05B/05C记录为准。

## 基准与证据边界

候选原包 `C:/Users/lus/Codex/_internal/app/resources/app.asar` 的 SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。候选包含 offline 补丁，不能当干净官方发行基准。本轮直接内存读取并复算以下 chunk 哈希；前三项与既有 `.ref/parity/05/runs/20261101-codex-file-editor/reference/manifest.json` 一致。后续三项是补充定位，未复制为新的参考文件。

| `webview/assets/` 文件 | SHA-256 |
|---|---|
| `text-file-storage-2b5625d5d463.js` | `c9e67765423274b88ed831543b83a6f4b1d6acbe73fd0bd0c0d056912af12247` |
| `text-file-editor-tab-content.electron-bfdfb0e80411.js` | `7d331e623de54a9ef17e99a7b93e0b5185bfe547e620417ed5f7bb9c3bce3a0c` |
| `text-file-editor-search-panel-63804df3c1c9.js` | `9cbb0c390409b0407e3d9a3c9a27425d14cddf87321dd4860ec9fd0fade9f11a` |
| `pierre-file-editor-4da31b6165d3.js` | `e32860225f2df5593d2018f59873d73aade9ad4dd79a5342a5f82d47bfa3d742` |
| `inline-file-diff-review-a3a8baed2d2a.js` | `e597bb15aa75332ce7befade05c5d1535583edebefdf33fca3c34c5fb27abead` |
| `zh-CN-3ed9eb1db28a.js` | `c6ac10a9fb407a393ea002d9aa818a4c7ed0e215e9c8bf0cfe2b798a98e3756f` |

下文偏移均为从文件头计的 **0-based UTF-16 字符偏移**，不是字节或物理行号。优先按函数名、事件名、消息 ID 定位。未实测的官方行为、截图、焦点、快捷键和动画均保持待证。

## 真实静态行为：关闭不是固定的三选一保存弹窗

`text-file-editor-tab-content` @110350–111360 的 `onBeforeClose`：

1. 检查当前 tab、文件 path/host、保存回调以及关闭回调身份，存在相关移动/关闭阻塞状态时返回 false。
2. 没有 unsaved changes 时允许关闭。
3. 有 unsaved changes 时先调用当前保存回调；其来源在 @92138 的 `()=>n.saveUntilClean()`。成功则直接允许关闭。
4. 保存失败时，重新检查当前 tab 与保存/关闭回调身份，仍有效才调用 `he(..., Xo, ...)` 展示放弃确认。继续查看返回 false；确认放弃时再检查身份，调用 discard 回调，返回 true。

`saveUntilClean` @76570 会在保存成功但仍有后续编辑时再次保存，直到干净或某次保存失败。因此不能在首次写入完成后就关闭并丢掉写入期间的新编辑。

`Xo` @108013–109xxx 是 compact dialog，`showDialogClose:false`，form submit 调用 confirm 后 close。按钮只有“继续查看”“放弃更改”。中文包 @1746429 起明确给出：

| 消息 ID | 官方中文 |
|---|---|
| `textFileEditor.discardConfirmation.title` | 放弃文件更改？ |
| `textFileEditor.discardConfirmation.description` | 您对此文件所做的未保存的更改将丢失 |
| `textFileEditor.discardConfirmation.continueViewing` | 继续查看 |
| `textFileEditor.discardConfirmation.discard` | 放弃更改 |
| `textFileEditor.saveError` | 无法保存文件 |

**不能据此实现每次关脏文件都先弹“保存/不保存/取消”的自定三按钮弹窗。** 保存失败后的确认已获静态证据；Escape、点击遮罩、默认焦点、焦点返回、确认按钮 Tab 顺序及实际尺寸/位置待官方运行时取证。也不能将 tab 关闭合同未经验证扩展为整个应用窗口关闭合同。

## 外部变更与冲突合同

### 读取、保存与版本

`text-file-storage` 的 `v` 返回 `{content,mtimeMs,sizeBytes}`，云文件读取在 metadata/read/decode 等阶段检查 signal；本地走 `read-file-metadata` 和 `read-file`。

同文件 `y` 接受 `expectedMtimeMs`：

- 云分支读取 `fs/getMetadata`，mtime 相等才发 `fs/writeFile`，随后再读 metadata 返回 `{outcome:"saved",mtimeMs}`；不相等返回 `{outcome:"conflict",mtimeMs}`。
- 本地分支调用 `write-file`，参数含 `content,expectedMtimeMs,hostId,path`。本轮未追踪该 host handler 的底层写实现，不能宣称其具备跨进程原子 compare-and-swap；云分支显式先查后写也存在两步间的竞态窗口。

`text-file-editor-tab-content` @77133 提交基准 mtime。返回 conflict 后重新读磁盘，带 `diskReadRevision` 和 abort 检查；不会当作保存成功。若磁盘已等于提交内容，可收敛为已保存；否则按当前编辑内容与磁盘快照进入 review。`save()` @76750 在 conflict 时返回 false，阻止直接覆盖。

### 三方内容状态，不是“检测到变化就覆盖”

`pierre-file-editor` @16466–170xx 的 `Y/Cn/wn/Tn`，在编辑器 import 中分别映射为 `Sn/wn/An/Cn`：

- `Y(content)` 创建 ready，保留 baseContent。
- 磁盘内容等于 base：保持 ready，或将已有 conflict 恢复为 ready。
- 当前本地内容等于磁盘：ready，磁盘成为新 base。
- 其他情况：conflict，保留 baseContent 与 diskContent，不能静默替换本地草稿。
- review 的 old/new 方向依赖当前本地是否等于 base，不能把 Accept 固定解释为“使用磁盘”，也不能把 Reject 固定解释为“保留本地”。

| 当前内容状态 | review old | review new | Accept / Edit 结果内容 | Reject 结果内容 |
|---|---|---|---|---|
| 本地仍等于 base，磁盘改变 | 本地旧内容 | 磁盘新内容 | 磁盘新内容 | 本地旧内容 |
| 本地也已修改且不同于磁盘 | 磁盘内容 | 本地草稿 | 本地草稿 | 磁盘内容 |

决议后的 ready base 都是本轮磁盘内容；保留本地草稿通常仍为 dirty，需要后续保存。编辑器 `resolveExternalChange` @73941 将 baseMtime 更新为 review 的磁盘快照 mtime，清 review，再按结果决定 dirty、只读、焦点及 autosave。

`syncExternalChange` @73188：

- editor 未就绪则记录 pending change；卸载或较旧读取不应用。
- 读取当前磁盘；用 **读取完成时** 的当前编辑内容计算状态。
- `externalSyncRevision` / `diskReadRevision` 防止旧快照晚到覆盖。
- Markdown 且本地未改的冲突有自动 accept 分支。不能将其推广为所有文本类型都直接刷新。

@94056 监听 `open-file-changed`，要求 `event.hostId===hostId && event.path===filePath`。@约96xxx 用 `externalReview` 渲染覆盖编辑区域的 inline diff，非独立的磁盘覆盖确认弹窗。`inline-file-diff-review` 的 `onAction` 明确提供 `edit/reject/accept`；具体中文及像素需补运行时取证，本轮不从英文自行翻译成最终 UI。

`scheduleAutosave` 静态常量为 3000ms（`Eo=3e3`），conflict/不可写/无脏内容时不安排保存；这个常量尚无运行时计时验证，不应误用固定计时器伪装写入完成。

## 本项目实际差距

| 路径及锚点 | 当前实现 | 与合同的差距 |
|---|---|---|
| `DiffDrawer.tsx` `readTextPreviewViaProtocol` | 读取 bytes，返回 `mtimeMs:0` | 没有有效磁盘版本基线。 |
| `DiffDrawer.tsx` `fsWatchPath(currentDir,...)` | 300ms 后刷新目录；仅 !isDirty 时重读预览 | 脏草稿期间忽略目标变化，无冲突状态或 review；不是官方的三方比较。 |
| `DiffDrawer.tsx` `saveEditedFile` | 无条件 `fsWriteFileText`；任何 protocol error 再尝试本地 `fs_write_file` | 没有 expectedMtime、conflict 结果；未来不能把 conflict 当通用失败再走 fallback，否则绕过冲突保护。 |
| `fsClient.ts` `getMetadata` | 有 `modifiedAtMs`；write 仅 `{path,dataBase64}` | 可用于已验证的云式预检，但当前协议形状不支持自行加入 expectedMtimeMs。 |
| `lib.rs` `fs_write_file` | `fs::write(&path,content)` | 无版本检查。仅改前端比较不能宣称消除了外部写竞态。 |
| `DiffDrawer.tsx` 关闭预览按钮 | dirty 时 toast“请先保存…”，返回 | 缺少“先 saveUntilClean；失败再条件放弃确认”的闭环。 |

现有 FE01–FE06 保护异步身份、编辑版本和单次在途保存，应保留并扩展；不能为了新关闭流程降低这些防护。当前单文件预览不等于官方多标签编辑器，本轮不扩展多文件草稿。

## 建议下一轮主交付：关闭脏文件的先保存、失败后确认

这个缺口的静态调用链和中文较完整，能在一次有限开发中形成真实闭环；不依赖恢复完整多标签或 diff 渲染器。建议仅覆盖 **关闭当前文件预览**，不顺带改变应用退出、切文件、自动保存和磁盘冲突 UI。

成功条件：

1. 干净预览直接关闭并失效旧异步请求。
2. 脏预览关闭先等待真实保存；保存成功且仍有新编辑，继续保存当前最新草稿直到干净。重复关闭不并发写、不重复弹窗。
3. 保存失败保持文件和草稿，展示上述官方两按钮确认；继续查看保留状态，放弃才关闭并清草稿。错误不能当成功，确认旧文件后不得关闭后来打开的另一文件。
4. 明确捕获目标 path、preview request、edit revision 和关闭意图；保存/确认晚到、卸载或切换上下文不能操作错误文件。已在途保存与关闭共用同一写入结果，不能把“正在保存”直接视为关闭失败。
5. 复用现有 dialog/保存设施和已有依赖。新增界面必须补官方运行时截图及 visual-verdict；没有条件时交付功能自验，保留视觉待证。

**该主交付不解决当前无条件覆盖磁盘的问题。** expectedMtime/外部变更 review 应为紧接的独立交付；在拿到本地 `write-file` handler 和可落实的写入机制前，不将“保存前 getMetadata 一次”包装成原子保护。若下一轮优先磁盘保护，应先补齐该机制合同，再开发，不能先自定冲突弹窗。

## 下一轮验收用例

| ID | 操作 | 可验证结果 |
|---|---|---|
| FC01 | dirty 关闭，写入成功 | 重读磁盘等于实际提交内容后，预览关闭；没有先弹自定保存弹窗。 |
| FC02 | 关闭写入期间继续编辑 | 后续新内容也保存后才关；首次保存晚到不误清 dirty。 |
| FC03 | 快速连续关闭/保存快捷键 | 单次在途写入；共享同一保存序列，不出现多个确认。 |
| FC04 | 写失败→继续查看 | 草稿、目标与 dirty 保留；可重试；磁盘没有被模拟成功。 |
| FC05 | 写失败→放弃 | 仅原目标关闭，未写草稿不落盘；旧保存/读取不恢复预览。 |
| FC06 | 确认打开后失效上下文/卸载，随后确认或异步返回 | 不关闭/修改另一文件，不弹旧错误，无监听或 Promise 状态泄漏。 |
| FC07 | 保存期间外部改文件 | 记录当前缺口；无 expectedMtime 保护时不可标冲突通过，不能默许为严格 1:1。 |
| FC08 | 与干净官方执行成功关闭/失败关闭/继续/放弃 | 核对状态、中文、按钮、焦点、Escape/遮罩、宽窄布局和原生窗口行为；未测项保留。 |

功能回归应运行生产保存/关闭控制逻辑并注入可控读写延迟；真实写测试用隔离目录，保存后重新读盘。浏览器 mock、协议形状测试、原生文件往返和官方像素比较分别记录，不互相代替。

## 未证实事项

干净官方基准；本地 `write-file` 的最终原子性与异常结果；文件删除/重建/mtime 精度相同等场景；watch 事件在各宿主的生成机制；review 的最终中文、图标和尺寸；失败确认的 Escape/遮罩/焦点合同；整个应用窗口关闭/多标签关闭；原生与像素验收。最初静态调研阶段仅新增此文档；后续05B产品与验证增量另见其验收单。
