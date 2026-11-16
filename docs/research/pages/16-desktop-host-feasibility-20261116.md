# 第04批 Windows 桌面宿主：自有探针结果

2026-11-16。第03批插件整页检查期间独立开展可行性验证，未修改产品宿主、设置或依赖。固定官方参照为26.1111.2228.0；旧26.1103资料和当前增量分别保存在`.ref/parity/16/whole-page/reference/host-r1-20261116/`与`.ref/parity/16/desktop-host-r1-20261116-current/`，不将旧manifest当新来源。

## 结论与范围

自有C++20/Windows SDK能够在本机取得**自己创建窗口**的真实WGC PNG，并从RichEdit的UIA TextPattern读取完整180行和屏外末尾哨兵。经典Edit通过ValuePattern只返回4096字符，不能据此声称任意应用全文读取可用。第二次探针的总体判定仍为false/退出1，分项成功与未达条件分别保留。

这排除了“没有官方helper二进制，所以只能停在说明页”的前提；它没有证明产品Appshots已完成。官方helper未复制、导入或运行；没有操作用户窗口、主屏截图、全局输入/热键、账号/模型请求、提权或用户配置变更。MSVC/Windows SDK均为已有安装，无新依赖。

## API依据与开发前合同

- [CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow)以明确HWND创建窗口捕获目标；本探针仅接受自己子进程注册的HWND/PID/随机nonce，并复核窗口标题与存活状态。
- [CreateFreeThreaded](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframepool.createfreethreaded?view=winrt-26100)允许独立线程帧池；捕获事件、session、frame pool与D3D对象在本次请求范围内释放。
- [UIA ElementFromHandle](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation-elementfromhandle)只定位已登记父窗口下的自有子控件，再复核provider PID。TextPattern与ValuePattern来源分别记录，不用窗口消息读取或OCR冒充UIA。

开发前合同和最多三个探针见`r3-execution-readiness.md/json`：先自有窗口捕获/文本/释放，再同窗口拒绝/一次许可动作，随后私有Tauri浏览器会话。探针不建立通用JSONL服务、不开放任意HWND输入，也不恢复没有执行消费者的设置开关。

## 实际执行与原始证据

目录`.ref/parity/16/desktop-host-probe-r3-20261116/`包含自有源代码、runner、编译日志及每次运行。主线程审读后显式运行；子进程使用独立CODEX_HOME、APPDATA、LOCALAPPDATA、TEMP与TMP，控制台隐藏；仅自有fixture短暂非激活显示并自动关闭。

| 运行 | 真实结果 |
|---|---|
| `runs/20261116-230703-3c7f05ca/` | 退出1。Classic ValuePattern4096字符，缺末尾哨兵；首版在此提前退出，WGC未执行，不能把它说成捕获失败。事后确认父与fixture均已退出 |
| `runs/20261116-231141-4c07bdef/` | 退出1/总体false；将UIA与WGC独立检查，增加系统RichEdit而未移动哨兵或缩短180行，结果见下表 |

第二次分项：

| 项目 | 结果与证据边界 |
|---|---|
| Classic Edit | ValuePattern，4096字符，全文及末尾哨兵不满足；保留失败 |
| RichEdit | TextPattern.DocumentRange，7738字符，180行按序及屏外末尾nonce均匹配；`supportedRichEditPathPassed=true` |
| 窗口图像 | WGC真实PNG；固定色块771847个像素匹配，主线程已查看，仅有自有测试窗口；不使用PrintWindow或屏幕fallback |
| 预取消 | 不创建session，不生成pre-cancel.png |
| 目标关闭后的晚回 | 第二个真实帧取得后关闭fixture，拒绝发布，late.png不存在 |
| 已关闭目标 | session创建前拒绝，closed.png不存在 |
| 释放 | 2帧、2个session创建/关闭，cleanupFailures=0；记录的父PID282500与fixture PID283284事后均不运行。不是长期泄漏或所有异步取消组合的证明 |

第二次源码SHA-256 `1ca02551240ede8ed6baa87b59f8bc3d0b33b96e32f0f1f8fbf37f089b2f0337`；实际运行EXE SHA-256 `bb9fe67c6c8a9bb9a1f22cffb900db981575d314d715c8a85077eab6c930d9f0`；PNG SHA-256 `094f2a0c07470bf51da20d6010f4318ea7b7314dee7a2aaffa1a0dc0e6788697`。源代码与不同编译时刻EXE的hash不能互换。

`result.json`、`run.exit`、`processes.json`、`environment.json`及`post-exit-inspection.json`保留实际结果。最初runner编译manifest没有在运行后更新executed，已按这些原始证据重建当前执行绑定并注明修正原因/各证据hash；原运行与失败日志未改，runner以后在spawn/终态/超时写真实状态。

## 进入产品开发前仍须完成

1. 产品自有宿主的可信目标身份、明确许可/取消、捕获中关闭及晚回边界；不能把probe的fixture专用入口直接开放给任意窗口。
2. 区分可用、部分和不可用的文本结果；Classic的4096不能冒称完整文档。适用真实应用provider、权限拒绝、受保护窗口、多屏/DPI仍需验证。
3. Appshots的双Alt/双Shift、目标锁定、真实设置注册/回滚、60秒路由、Mini/companion优先、草稿图片/文本消费者及资源清理。
4. Computer Use的一次许可/拒绝真实动作读回与停止；浏览器独立profile/导航/下载/清理原型。两者本轮未执行，不能随截图成功升级支持状态。
5. 官方运行时/账号gate、同环境配对图、原生IME及用户验收。当前无1:1或全桌面宿主通过结论。

下一可开发工作为自有Appshots宿主及其真实消费者合同，不再调查是否必须借官方二进制；保留Classic全文限制，后续按provider能力如实呈现。
