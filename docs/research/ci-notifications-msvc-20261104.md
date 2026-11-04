# CI 连续失败：通知适配器与 MSVC 14.51

2026-11-04，修改前诊断及验证计划。范围仅Windows通知适配器的构建标准与其CI编译检查，不改通知行为或降低测试门槛。

## 已观察到

最近8次CI均失败在Windows x64 Build & Test的Run Backend Unit Tests步骤；前端类型/构建成功，Tauri安装包步骤均未执行。逐份读取作业日志后，8次都出现同一个C2338/STL1011，随后build.rs:9报告Windows notification adapter compilation failed。Rust测试尚未运行，不能把这个现象归为随机单测失败。

| 提交 | Run | Job |
|---|---|---|
| c18f609 | [41742172490](https://github.com/lusipad/codex-desktop-native/actions/runs/41742172490) | 126286125170 |
| f60de30 | [41738206495](https://github.com/lusipad/codex-desktop-native/actions/runs/41738206495) | 126272772120 |
| 4a3047f | [41725147365](https://github.com/lusipad/codex-desktop-native/actions/runs/41725147365) | 126227862454 |
| bc1a1f3 | [41700100762](https://github.com/lusipad/codex-desktop-native/actions/runs/41700100762) | 126140808829 |
| 025db72 | [41695671775](https://github.com/lusipad/codex-desktop-native/actions/runs/41695671775) | 126125411203 |
| 74bdae7 | [41688907150](https://github.com/lusipad/codex-desktop-native/actions/runs/41688907150) | 126101941323 |
| 121b957 | [41683388974](https://github.com/lusipad/codex-desktop-native/actions/runs/41683388974) | 126082629672 |
| 07d98eb | [41673247624](https://github.com/lusipad/codex-desktop-native/actions/runs/41673247624) | 126046896670 |

CI镜像windows-2025-vs2026，MSVC路径14.51.36231；最新日志2026-11-03T23:56:44Z（北京时间11-04 07:56:44）报错来自include/experimental/coroutine(37)，提示实验协程头已弃用，应改标准C++20 coroutine。Node20弃用与Vite大chunk是警告，不是这8次的退出原因。

这8次event均为push，run_attempt均为1；没有同一提交重试后转绿的记录，不能归类flaky。原文失败摘要留在.ref/ci/20261104-notifications/failed-run-summary.json。

本地vswhere显示VS2026，但实际MSVC为14.50.35717。原脚本C++17在本机重新独立编译和SDK测试退出0，见.ref/ci/20261104-notifications/before.log/exit。不能说本机复现了CI错误，也不能用本地成功证明14.51兼容。

## 来源与根因

- scripts/build-desktop-notifications.ps1的生产编译和Test编译都指定/std:c++17。
- src-tauri/build.rs在cargo test开始编译时调用该脚本，C++失败使整个Rust构建退出，后续测试/安装包被阻断。
- 已安装SDK 10.0.26100.0的cppwinrt/winrt/base.h先检查__cpp_lib_coroutine，存在则用标准coroutine，否则回退experimental/coroutine；C++17路径因此触发MSVC 14.51新增的诊断。
- [Microsoft C++/WinRT问题1520](https://github.com/microsoft/cppwinrt/issues/1520)和[MSVC C++20说明](https://devblogs.microsoft.com/cppblog/msvc-cpp20-and-the-std-cpp20-switch/)说明实验头弃用与标准C++20协程路径。当前源码未使用自定义旧协程ABI，适配器作为单独C ABI静态库供Rust使用。

## 优先修复与成功标准

1. 生产及SDK测试均改/std:c++20，使用SDK标准协程分支；保留错误即失败。不加弃用静音宏，不绕过通知编译，不降级runner。
2. CI显式先编译/运行既有只读通知SDK测试，再执行完整cargo test，使这类错误尽早定位到通知步骤。沿用现有脚本和测试，不引入依赖或空测试。
3. 本地运行新目录的通知SDK测试、完整cargo test；检查diff。推送后检查真实GitHub runner，只有云端通过才能确认14.51问题解除，后续若出现独立单测问题分别登记修复。

验证过程中不调用Toast.Show，不注册Start Menu，不变更用户通知权限；结果与未验项在下方续记。

## 本地修复结果

- 生产库与测试编译均改为C++20；CI新增Verify Native Notification Adapter，执行已有-Test只读SDK用例，保留完整cargo test与安装包步骤。
- C++20独立库/SDK测试退出0（after.log/exit），涵盖XML转义、稳定SHA256标签、ID区分、坏JSON/未初始化投递拒绝、实际只读系统权限结果。
- `cargo test --manifest-path src-tauri/Cargo.toml --verbose`退出0；463单测通过，0失败/忽略/过滤，二进制及doc-tests均0用例通过。使用既有隔离target与RUST_TEST_THREADS=4；并未将局部分组测试当作此次全量测试。
- git diff --check通过。无新增依赖，无通知功能或协议改动；没有以弃用静音宏隐藏错误。
- 提交时GitHub MSVC14.51与云端安装包尚待新run验证；本地14.50通过不表示CI已绿，最终远端状态应以对应提交的Actions页面为准。未重复未改动的前端专项和原生GUI验收。

后续实际追踪run41747410523：新通知SDK编译/执行成功，解除原编译阻断；完整Rust测试暴露了11项路径/编码失败，说明整轮尚未通过，详见[第二层诊断与修复](ci-runner-paths-20261104.md)。
