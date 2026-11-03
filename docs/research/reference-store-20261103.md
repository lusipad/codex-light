# 2026-11-03 Store 安装包只读核验

本机Get-AppxPackage返回 `OpenAI.Codex 26.1021.3705.0`，位置 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0`。SignatureKind为Store、Status为Ok；app/Codex.exe Authenticode为Valid，签署者OpenAI OpCo, LLC。

`app/resources/app.asar` 为640129388字节，SHA-256 `04862a659c6a90fc50514d8c0b8016709d97dece58839726c57495ed72f1d9f0`。按AppxBlockMap.xml逐64KiB验证全部9768个块、长度一致、无剩余字节、零不匹配。包内提取还需分别核对entry integrity。

[元数据](../../.ref/reference/store-26.1021.3705-20261103/package-metadata.json)、[可执行文件签名](../../.ref/reference/store-26.1021.3705-20261103/executable-signature.json)、[ASAR完整性](../../.ref/reference/store-26.1021.3705-20261103/asar-integrity.json)均为本轮只读结果。未修改、安装、更新或启动官方包。

此来源与旧C:/Users/lus/Codex下含offline补丁的固定候选不同版本，必须分开登记hash/chunk/UTF-16定位与语义差异。后续调研增加Store来源对照，不将旧候选的通过记录自动迁移到新版，也不因包完整就宣称官方运行时、DPI、账号能力或像素基准已确认。
