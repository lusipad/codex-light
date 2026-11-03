# 16.07C 实施注记

[修改前合同](16-07C-next-closure.md)。开发中，未验收。

## 决策

- 本机记忆与账号指令桥独立实现，前者真实catalog/config/status/reset，后者固定鉴权GET/PATCH，绝不把账号指令写到本机AGENTS.md。
- 主机身份来自真实user层目录；写入逐组CAS/原值冲突/读回，关联失败返回实际快照和错误。reset确认后单次；不能从status.ready推断开启或删除完成。

## 纠正与偏离

- 新追源码证实Windows禁用时fallback写features.chronicle=false，reset无native Chronicle清理；补入关联路径，不添加假的原生捕获或多余技术提示。
- 新追源码证实PATCH明确401会刷新重试，纠正原合同绝不重放的过宽断言；保持同身份/同body一次重试、未知网络结果不重放。

## 待复核

- 官方gate运行时/真实账号服务、原生交互/IME/多窗、同条件配对像素与用户验收独立留证。

## 实施结果与首败留证

- Memory runtime目录被配置覆盖的P2先补真实宿主回归复现exit101，随后保留catalog值并核保存后运行时确认；七项专项通过。配置/ready不能当启用的设计口径未降低。
- Account IP策略401例外按新原始transport补齐，四形态×GET/PATCH隔离回归；八项专项通过，没有写真实账号。
- Memory probe首轮fixture把job种为stage1且错误预期删全部job，失败保留；按公开固定源码确证memory_stage1/memory_consolidate_global后种真实两类及非memory sentinel，最终两CLI实际文件/DB删除和非memory保留都通过。
- 浏览器桥注入验证开关、部分成功、reset取消/未知/重读/重新确认和焦点，没调用真实配置/reset。最终产品源码冻结后运行完整标准、全Rust和原生构建；结果以待验表登记为准。
