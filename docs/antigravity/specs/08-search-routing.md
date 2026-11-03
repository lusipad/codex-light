# 08A 搜索模式与命令执行合同

日期：2026-11-01，产品修改前建立。

固定官方原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，两项原包资源提取/integrity 见 `.ref/parity/08/runs/20261101-codex-search-contract/reference/manifest.json`。

- `command-menu-dialog-c95da71834af.js` 0-based UTF-16 约 15762–15803：`M===files` 使用 fileSearchPlaceholder，root 使用 unifiedSearchPlaceholder，证明文件搜索与综合模式不同。
- 同文件约 12833：Tab 分组导航检查 defaultPrevented、修饰键、nativeEvent.isComposing；不在组合输入期间改变选择。
- 本项目已有 Composer `handleAutocompleteSelect`：action 交 handleSlashAction，insertText 写入草稿。当前 QuickSearch 全部调用终端入口与这份已有业务合同矛盾，不能把斜杠命令作为 Shell 命令。
- 官方完整分组、排序、服务端错误、焦点/像素及中文资源仍待运行时对照，不用本轮纠错替代这些证据。

| ID | 操作 | 预期 |
|---|---|---|
| SR01 | 选择 action/insert 斜杠命令 | 调用现有 action；有 insertText 时写 Composer；不发 terminal_write |
| SR02 | Ctrl+P / 文件搜索入口 | 只展示文件，不夹带运行命令、聊天、技能或设置 |
| SR03 | 综合搜索入口 | 恢复综合模式，不继承上次 files 模式 |
| SR04 | 中文组合输入 Enter/Escape/方向/Tab | 不触发选择、关闭或导航；普通按键仍正常 |
| SR05 | 相同 query 下切工作区 | 旧工作区结果不能出现在当前 items；effect 取消继续保留 |
| SR06 | 打开后立即关闭 | 清理 focus timer，不在关闭后抢焦点；关闭恢复原入口 |

范围：纠正数据/动作路由及既有键盘生命周期。完整官方命令清单是否应索引 slash、所有账号 gate 和远程失败展示不由本轮判定。

## 2026-11-03：下一轮只读补证

复核上述两份参考文件的SHA-256均与清单匹配。仍是含offline补丁候选的静态证据，未重新证明干净发行来源或运行时表现。

`command-menu-dialog-c95da71834af.js` 的 `Gi` 函数（0-based UTF-16约27472起）区分本地/远端host线程搜索与ChatGPT内容搜索：

- 约28500–29000：`queryKey:[command-menu-thread-search,e,ie,I]`，`Xe(l,e).searchThreads({query:ie,limit:I})` 的失败分支明确 `catch{return[]}`，并使用 `staleTime:Ue.THIRTY_SECONDS`。这里尚未追到 `Xe` 的具体宿主运输协议，不能仅凭方法名映射为本项目 `thread/search` 的完整等价合同。
- 约30000–31800：`L.contentSearchError` 与 `L.retryContentSearch` 生成ChatGPT内容搜索重试项；前面的Pages分支也有独立重试项。它们不能直接当成本地文件/线程搜索必有重试行的证据。
- 当前本项目QuickSearch将失败得到的空数组与成功结果相同地存入组件生命周期内缓存，没有过期时间；“服务失败→重开相同查询”的实际行为应在下一轮重点验证。官方本地线程30秒stale不能擅自推广成文件、Pages、ChatGPT所有源统一的缓存规则。

本次只记录后续调研边界，未改变08产品源码，不放行尚未定义的08B行为。
