# 规格、动作、证据与验收记录模板

复制模板到当前 run/单元文件后填写；尖括号占位符必须替换。未知值填 `null`/“待采证”，状态填未执行或阻塞，不能为了表格完整编造坐标/结果。

## 1. 文件结构

```text
docs/antigravity/
  runs/<run-id>/
    change-inventory.md       # 当前dirty/新文件与恢复位置
    claim-audit.md            # 旧完成声明复核
    test-capability-audit.md  # 测试真正证明的层级
  specs/<unit>.md             # 官方证据形成的实施规格，先于产品修改
  acceptance/<unit>.md        # 动作结果、差异、门槛、用户验收
.ref/parity/<编号>/runs/<run-id>/
  baseline.json
  reference/                 # 官方原图/录屏/静态片段与清单
  actual/                    # 对应构建实际原图/录屏
  diff/                      # 叠加、差图、ROI、测量CSV
  cases/                     # 每项操作与协议/读回/焦点证据
  build-<id>.json
  verification.md
```

现有 `.ref/parity/01/02/03` 记录只读保留，新的 run 使用唯一ID（例如时间＋单元＋序号），baseline.json 等固定文件名仅在该 run 内有效，不覆盖旧原图、失败证据或测试输出。同一 run 已交付的原图也不可替换，重采必须新文件ID/新run。证据目录被 Git 忽略，交接时写清本地可用性和单独交付方式，不向远端打包用户认证。

## 2. 基准清单模板

```json
{
  "baselineId": "<version-mode-language-theme-environment-id>",
  "official": {
    "version": null,
    "build": null,
    "archivePath": null,
    "archiveSha256": null,
    "productMode": null,
    "accountCapabilityEvidence": null,
    "featureGateEvidence": null
  },
  "environment": {
    "os": null,
    "dpi": null,
    "systemScalePercent": null,
    "appZoomPercent": null,
    "language": null,
    "theme": null,
    "fontEvidence": null
  },
  "viewport": {
    "clientPhysicalWidth": null,
    "clientPhysicalHeight": null,
    "windowState": null,
    "borderCropEvidence": null
  },
  "scenario": {"id": null, "datasetId": null, "focus": null, "scroll": null},
  "capture": {"source": null, "capturedAt": null, "sha256": null, "path": null},
  "status": "pending-verification"
}
```

每张图引用 baselineId 和 scenarioId，不能只写文件名。官方无法取得的信息记录取得方式/限制，不从本项目填反推值。

## 3. 单元规格模板

```markdown
# <unit> <页面/子范围>
状态：待调研。基准：<baselineId>。

## 范围
当前包含：<控件/状态/动作ID>
当前不包含：<其他页/设置/真实外部操作>
前置验收：<上一单元证据及用户确认>
允许修改：<具体文件/区域>

## 官方证据
| ID | 类型 | 文件/URL+哈希/锚点 | 环境与状态 | 观察事实 | 仍未知 |
|---|---|---|---|---|---|

## 控件清单与呈现
| ID | 官方节点/文案/role | 布局/字体/图标/token | 交互态 | 宽/窄规则 | 证据ID |
|---|---|---|---|---|---|

## 动作合同
<每个动作按第4节完整展开，不能只写一个动词>

## 状态与转换
<所有适用状态；每条边标触发、请求/事件、即时UI和最终UI>

## 差异与实现顺序
| 差异ID | 官方预期证据 | 当前实测 | 原因是否已证实 | 最小改动 | 回归用例 |
|---|---|---|---|---|---|

## 阻塞与解除条件
<缺什么、影响哪些动作、谁采集/提供、可以继续的独立工作>

## 验收
<用例/视觉锚点/原生动作/用户验收步骤，预期先写>
```

状态转换可使用 Mermaid 或表格，必须列取消、错误、拒绝、未知投递及离开/晚到分支。不能只画正常路径。

## 4. 一项动作的完整记录

```yaml
id: P01-A18
title: 选择模型
spec_status: pending-official-observation
preconditions:
  baseline: null
  scene: 模型菜单已展开
  current_model: null
  supported_efforts: null
  draft_and_attachments: null
  focus: null
official_evidence: []
steps:
  - 点击实际可选模型项目；记录目标role/name
immediate_presentation:
  selected_indicator: null
  trigger_text: null
  menu_close_behavior: null
  focus_target: null
  animation: null
data_effect:
  selected_id: null
  reasoning_normalization: null
  speed_normalization: null
  persistence_scope: null
  next_turn_request_evidence: null
negative_cases:
  - 无可选模型或目录读取失败
  - 模型不支持原推理/速度组合
  - 关闭菜单不选择
  - 选择期间切换会话/工作区
verification:
  structure: not-run
  handler: not-run
  browser_action: not-run
  real_service: not-run
  native: not-run
  visual: not-run
actual_result: null
evidence_paths: []
user_acceptance: null
```

这是待填模板，不是宣称官方一定“点完就关闭”。从官方实际观察填关闭/焦点/数据语义后再开发；样本参数与模型名不得写死到产品。

## 5. 原始用例结果模板

| 用例ID | 前置/数据 | 官方证据和明确预期 | 实际操作 | 实际结果 | 证据文件 | 证据类型 | 结论 |
|---|---|---|---|---|---|---|---|
| <ID> | <状态> | <可判定内容> | <实际执行步骤> | <观察值> | <可打开路径> | <静态/固定回放/真实服务/原生/视觉> | 未执行 |

另附每个用例的实际构建 ID、时间和必要日志。失败后保留失败 run，新 run 引用修复差异 ID；不要把原结果直接覆盖成 PASS。

## 6. 差异与视觉锚点模板

```csv
diff_id,unit,scene,control_or_action,reference_evidence,actual_evidence,observed_difference,severity,fix_files,retest_cases,status
```

```csv
anchor_id,baseline_id,build_id,scene,viewport,ref_x,ref_y,actual_x,actual_y,dx,dy,ref_w,ref_h,actual_w,actual_h,dw,dh,evidence,status
```

数值未知留空，不能写 0。每项残余像素差需附 ROI/原因/是否用户接受；正负偏差均保留。不允许“总体像素90%”一格替代所有锚点。

## 7. 测试能力审计模板

| 测试/用例 | 当前做法 | 已证实层级 | 不支持的旧声明 | 升级动作/断言 | 失败反证 | 状态 |
|---|---|---|---|---|---|---|
| verify-files... | 查文本含ctrlKey/s | 结构 | Ctrl+S实际保存/持久化 | 按键后独立读磁盘，失败保稿 | 空保存handler应失败 | 待升级 |

反证在隔离快照内进行，不改官方包，不破坏用户数据，结束后只恢复自己的临时改动。原始失败退出码和断言有效性要检查；测试语法错误不算产品先红证据。

## 8. 每轮交付包模板

```markdown
单元：<unit>；场景/差异ID：<IDs>
状态：<自验中/反馈修复中/待用户验收/外部依赖阻塞>

本轮改动：<每个文件对应何差异；复用/简化点>
官方依据：<参考图/操作/asar/文档ID；适用条件>

功能：<实际动作/真实数据/固定回放分别结论>
视觉：<官方图、原生图、叠加/差图、锚点表、残余差异>
原生：<EXE路径/哈希/源指纹、实测输入/窗口/状态>
自动检查：<命令、退出码、测试能力、警告与未执行项>

用户验收步骤：
1. 打开<确切EXE/场景>，观察<明确期望>。
2. 执行<动作>，观察<明确变化>。
3. 执行<取消/失败/恢复>，观察<明确不变量>。

未完成/阻塞/风险：<用例ID、影响、解除条件>
当前是否已获用户验收：否
下一步：<只能是当前页反馈修复或下一个已获放行的单元>
```

正式交付不要混入“固定协议样本”控制按钮截图来代表产品原生界面。若测试图必要，单独标“固定通知场景”，同时提供干净产品图。

## 9. 用户验收记录

```text
单元/场景/构建：
用户原文与时间：
接受范围：
未接受/待修复差异：
明确接受的例外（非严格1:1）：
可进入的下一单元：
```

执行器不代写用户确认；“继续”只能结合当时明确上下文解释，不可自动理解为所有历史单元已通过。没有原文就保持未验收。
