# 16H 常规本地通知分组阶段记录

合同：[16H](../specs/16H-general-notifications.md)。状态：阶段自验完成、待用户验收；用户未验收，独立账户通知页未实现，不表示通知整页1:1。

## 决定与变更

- 先重新计算Store26.1027.3384.0 asar SHA，12个entry integrity核验；31个代码锚点和44个中文值见 `.ref/parity/16/actual/16H-notifications/reference/`。发现原独立通知页放错本地五项：当前ct只承载账户ChatGPT组，本地lt经va挂在常规Dc末尾；Dc/Oc及账户资格另受不同gate控制。
- `SettingsView.tsx` 将真实本地组移到常规末尾，提示音搜索也指向常规；独立页明确账户设置尚不可用，不拿本地偏好冒充远端设置。
- `NotificationSettings.tsx/.css` 还原组标题/主题边框卡、左右setting row、inset分隔、32×20 switch及16px thumb、两个局部240px菜单。初次permission loading与disabled/not-determined禁控；unknown不伪装disabled，也不加未经证实的权限警报卡。权限恢复后从消失的系统按钮归焦轮次触发器。
- 复用GeneralPreferenceSelect，仅补可选triggerRef保证原生picker后的焦点恢复；其他消费者默认行为不变。继续真实单字段保存/读回、导入取消/错误和离页停止。
- 声音非导入选择直接并发启动真实播放和保存，预览错误独立，保存失败停止播放；同值及当前custom均可重选，当前custom不重新开文件选择器。同步排他锁覆盖预览/保存/导入整个操作。

## 偏差与待审边界

- 官方账户gate没有运行时映射，本客户端本地组依据实际已有本地服务可用性呈现；不声称复现所有账户的Dc/Oc资格。独立账户通知服务仍未接入，说明文字为真实缺口提示，非官方空态截图证明。
- 现有ExperimentalFeatures真实消费者保留；官方固定版没有同名组，这个额外分组及常规其他缺口未在本轮自动验收。
- 官方导入decode回调可立即播放bytes；本项目仍在现有真实持久副本导入完成后播放一次，再保存偏好。没有把这一适配描述为完全同序；30秒/10MiB/48kHz、原生picker和许可依赖按16.04B原限制保留。
- 原官方danger toast由现有inline alert呈现；具体150ms banner动画、原生实际音色与扬声器、物理IME、多窗口、官方配对像素尚未证明。score=null。

## 失败与回归

- routing-red.log/UI-red.log先暴露原挂载位置与初次permission loading缺口。
- 独立只读复核再复现两处P2：await stop失败阻止保存；旧finally提前解除新导入锁。去除普通播放前不必要stop等待，操作入口同步锁定；补stop故障、deferred保存、重复导入与取消释放回归。
- 初次故障回归的额外Promise包装增加了微任务层，旧harness仅12次flush未等到原保存失败结果；原日志stop-red.log保留，改32次微任务flush后stop-red-settled.log才确实在default/classic断言失败。不将harness时序问题当产品红测。
- 通知组件回放覆盖预览失败仍保存、同值/custom重选、权限乱序/初读/未知/not-determined、permission banner消失归焦、取消/离页晚到及锁释放。独立复核补测外部声音变化使等待导入失效且下一操作可恢复。
- 共享菜单外部ref/Escape回归、设置挂载/搜索/导航及TypeScript已通过；不代表全原生或像素通过。

## 浏览器

使用真实SettingsView、通知组件及偏好hook；内存桥/权限样本且CSP禁外网，未发系统通知、未播放实际声音。证据 `.ref/parity/settings-16H-20261105/browser-settings/`。

- 1280×800、640×800；240 CSS px菜单测量有亚像素浮点误差，窄窗right≈588.57，document.scrollWidth=640，无横向溢出。
- 选择turn=off、关闭question，确认switch状态独立；Escape返回轮次trigger。not-determined样本banner与5控件禁用，独立通知页无本地五项。console error为空。
- 原始JPEG分别保存调整前、宽窄正常组、窄窗菜单、权限禁用。不是无损官方差异图；参考与当前没有同条件配对，因此未评分。

## 构建与原生

完整非Fast标准脚本退出0（verify-all.log/.exit），包含Windows SDK适配器、受影响Rust过滤回归、生产前端及隔离协议探针；不是全量cargo test的465项声明。575项输入冻结；最终EXE/MSI/NSIS构建退出0，8项产物归档，输入前后无漂移。使用本轮最终包完成下列原生检查。

下一独立账户通知页已完成[16I只读计划](../specs/16I-account-notifications.md)：资格、动态字段和多选/并发/读回合同已记录；最终宿主resolver前缀仍待补证，未扩大本轮远端写链。



### 最终原生闭环

- 产物：`dist-artifacts/settings-16H-20261105/CodexNative.exe`，SHA256 `97377df2fd37ec377c6e88a78ae1784a86e01f63db1d49aeae978f2162a23654`。构建基于9dfbf42加本阶段改动，详见build-manifest/inputs-frozen；没有独立lint配置，不虚构lint通过。
- 独立CODEX_HOME、WebView2 profile及workspace，移除子进程API凭据，不登录/不发模型turn。不改Windows权限，不发测试toast，只读实际Setting；沙箱notConfigured提示来自独立环境，未安装沙箱/更改安全设置。
- Ctrl+,打开常规，滚动定位本地通知分组；轮次菜单3项、Windows声音菜单3个内置选择加导入入口正确。逐项选择always、permissions=false、questions=false、dot=false、sound=none。真实app-server配置逐字段保存并读回，私有config.toml五项完全匹配，其他三个开关不影响turn值。
- none走真实无声播放/停止路径，无实际音色/扬声器成功声明。声音菜单Escape关闭，trigger有可见焦点环；空格重开同一菜单，none勾选，验证实际键盘焦点返回。未操作原生导入picker或系统设置按钮；取消/导入仍仅既有回放覆盖。
- 退出后确认原PID消失，以同一私有profile重新启动、新PID；常规页五项恢复，config.toml SHA256前后逐字节相同。最终原生JPEG1442×914及AX、native-verification.json、重启前TOML留在阶段证据根。DPI/官方缩放未知，不能与官方直接像素相减。
- 测试应用已关闭。当前交付是本地通知组的功能/结构增量与上述原生用例自验；账户通知页仍未实现，官方gate/配对像素、实际音色、物理IME、完整Tab/多窗仍待验证，用户未验收。
