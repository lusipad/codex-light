# 16.02B 实施说明

计划：[修改前合同](../specs/16-02-next-closure.md)。本轮继续整App目标，不以本增量代表整页验收。

## Decisions

保留独立light/dark主题、preset、真实semantic CSS消费、精确高级恢复和导入导出语义；适配Electron宿主为Tauri/app-server，不复制专有产品代码。现有双字号与motion订阅继续使用。主要状态变化以持久化和实际DOM结果证明，原生与官方像素另验。

## Deviations

无同环境官方截图时不评分、不设虚构像素通过；可用受控生产组件验证交互并登记待验。尚无许可或原始数据的preset不伪造为官方资源。

## Surprises

只读补证定位Store startup-requirements的settings-store：当前读写统一desktop配置，global-state标记涉及旧值迁移，不能由分类推断实际存储位置。本轮据证接真实desktop配置适配，旧本地JSON只作缺值回退；详见宿主调研。

## Questions for review

官方固定环境/DPI/原生窗口、账号accent跨设备同步仍须运行时证据，不能由本地保存代替。

## 后续实施补记

- 已按宿主补证使用真实desktop配置；TOML不接受fonts中的null，后端按官方schema省略/补齐，隔离协议已验证失败与成功两条链。
- 公开23variant数据匹配固定Store，Material为Apache-2.0，其余当前资源MIT；许可与来源随资源提交，不复制专有产品模块。
- 审查P2：preset只合并配色seed，不能用完整默认theme替换用户fonts/face/contrast/opaque；已实际先红后绿。
- 已存但尚无许可资源的官方preset保留其ID，界面明确暂不可用；实际code显示Codex回退，主题-only编辑不悄改preset。代码块未分类文本原固定色已接所选preset前景并加回归。
- 首次标准检查缺少已指定隔离home目录，旧协议子进程已退出而探针等待超时；确认本次进程后停止，保留日志并创建目录重跑，不将中止视为通过。
