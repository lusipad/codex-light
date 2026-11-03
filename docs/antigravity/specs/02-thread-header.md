# 02A 会话顶栏增量合同

日期：2026-11-01。范围：已有本地会话标题、inline 重命名、未知分支显示。02B 的消息折叠保持原行为；02C 富文本另行推进。

## 官方依据与边界

- 固定官方包 SHA-256 `17E75CE60122666AA46598A9876A0C56D1DA30589824708BDB59C90D8377F5EB`，候选版本 26.928.21956 / build 12404。
- [原始提取清单](../../../.ref/parity/02/runs/20261101-codex-thread-header/reference/manifest.json)与[调研结果](../../../.ref/parity/02/runs/20261101-codex-thread-header/reference/findings.md)：12 项资源校验 archive integrity；所有偏移为 0-based UTF-16。
- 初始包 `Tmo@6930076`：标题为 button，点击转 input；focus 全选；Enter 仅 blur，blur trim 后保存；空值/原值不写；Escape 标记取消，后续 blur 不保存。
- 本地页面 `ic` 的身份显示按 conversationId/pending/隐藏状态决定，没有 turns 数量判据。已有真实会话在历史为空时仍需显示身份。
- 原始 primary 布局 `aDt@2093421` 没有注入未知分支 `main`；只在有真实 branch 数据时显示本项目既有 Git 入口，不据此断言所有官方变体都无分支。
- `.ref/scratch/files/app-primary.js` 为离线修改版，不作为官方原始偏移依据。
- 官方窗口未实测：焦点返回、错误提示、pending 会话、归档与 summary panel 变体、顶栏完整布局/像素仍待验证。本轮不改变这些未知分支，也不宣称整页对齐。

## 修改前验收合同

| ID | 操作 | 预期 |
|---|---|---|
| TH01 | Tab/Enter 激活标题 | button 语义；input 获焦并全选 |
| TH02 | 改名后 Enter | 仅触发 blur，由 blur 单次调用已有真实 thread/name/set |
| TH03 | 改名后 Escape→blur | 取消；无协议写入 |
| TH04 | 空白/原名/原名两侧空白→blur | 无协议写入；退出编辑 |
| TH05 | 改名后点击外部 | trim 后一次保存；协议失败沿用已有错误提示 |
| TH06 | 中文输入法 Enter/Escape | composing 阶段不提交/取消 |
| TH07 | 进入已有会话，turns=[] | 保留标题身份；首页无会话仍不显示 |
| TH08 | branch 未知/空/已知 | 前两者不显示分支入口；已知值原样显示 |

允许文件为 App.tsx 的顶栏、对应标题 CSS、专项脚本及本轮资料。不新增依赖，不改变 rename 协议、不重构其他菜单。文字尺寸/焦点环可按官方静态 class 校准；缺少同条件官方截图时不出相似度结论。
