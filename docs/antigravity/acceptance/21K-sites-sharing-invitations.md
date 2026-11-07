# 21K Sites 共享邀请阶段

2026-11-07，限定本地自验完成，整页仍开发中，未用户验收。先完成[目录合同](../specs/21K-sites-sharing-invitations.md)和[邮箱/输入补证](../specs/21K-sites-sharing-invitation-ui.md)，再接入真实请求路径；不把离线样本称为真实服务执行。

## 实现范围

- 成员搜索、群组搜索、完整团队分页，以及个人/工作区允许时的外部邮箱邀请。团队不是 groups 的别名，来源、资格和错误分别处理；选择候选清输入后即时提交 viewer，不创建本地成功 chips。
- 团队完整资格保留853110088、Adt28、已加载账号、当前/认证账号相同、workspace、未停用/session未拒绝。官方宿主 `zy` 的 supportedSurface:true 已恢复，Windows Tauri作明确等价适配；不拿 Sites 入口资格或 Og19 替代。
- 用户/群组150ms debounce、独立15秒取消与一分钟查询缓存；团队固定100条、offset每页+100，has_more结束，按来源独立重试。页面卸载、切号、改查询与权限撤销后不应用旧结果。
- 邮箱采用真实默认 schema 的 string/pattern 判定，前置 Y 的 trim/lower；55个官方实际解析/归一化向量随测试提交，不依赖ignored原包，不新增依赖、不改成通用RFC正则。
- 专用 Sites users/groups/teams 由宿主绑定账号，保留Sites读前后网络/身份防线；通用ShareUsers/Groups行为不变。Sites群组计数true，团队安全整数offset和固定limit100；邮箱邀请专用typed操作固定viewer，与既有共享操作同锁，不能由调用方选择URL/角色。
- 复用21J状态、取消、共享锁、ACK检查与父metadata/截图更新；额外GET确认是本项目适配。pending/未知/未收敛不显示成功，显式恢复只读不重发；目标重复、过期权限和admins_only写前拒绝。
- combobox/listbox候选依次团队→群组→用户/外部邮箱，真实中文、独立加载/错误与群组内联Retry。Tab不邀请、IME Enter不选择、Escape只关闭候选；外点保留输入，重新键入恢复候选。
- 修正21J已登记的无动作群组菜单：owner+editable仍可打开仅当前查看者菜单，不能因此获得移除权限。

## 实际证据

证据根 `.ref/parity/21/actual/21K-sites-sharing-invitations/`。

- 目录：8资源、48完整锚点及host provider链，hash/UTF-16往返0错误；邮箱/UI：原始文件、runtime entry与66函数/赋值/CSS锚点、50真实safeParse和5归一化向量。复用固定26.1027.3384.0，不重新整包hash或操作官方GUI。
- 新typed宿主先红（unknown share_email_invite）后绿；Sites聚焦57通过，**全库620 Rust通过、0失败/忽略/过滤、退出0**；Rust输入冻结前后匹配。
- 5数据/55源向量、12客户端、8搜索生命周期、37状态/共享UI、12输入JSX分组通过，原2048权限向量补菜单可见分支。缺失功能红与真正既有缺陷红分开记录。
- 独立复核三项实际P2均先红后绿：关闭重开丢未知邀请锁会重发；目录撤权残留无效Retry；Retry按钮焦点时Escape关闭整个共享框。后者另在真实浏览器复现父dialog从1变0，修后保持1、候选0、焦点返回输入且query清空。
- 真实组件仅替换bridge的明确隔离浏览器样本（CSP禁服务网络）：完整teams offsets0/100，跨账号团队和已共享/重复项排除；成员邀请一次viewer并实际读回；个人邮箱规范化且不读工作区目录；团队pending显式恢复仍一次写；群组错误与其他候选并存；普通权限和admins_only不得写。
- 1280×800和440×800最终候选层沿输入宽度定位、最大高256 CSS px，窄窗无横向溢出。修复设置页通用input覆盖导致内框/增高；Retry按已证sm/1.625rem在参考16px根下映射26px，使field维持36px。候选上限同样按源16rem映射256px，不能直接继承本项目13px根而变208px。
- 截图为原始JPEG：`browser/invite-wide.jpg`、`invite-narrow.jpg`，最终测量 `final-geometry.json`；错误态36px/Retry26px另有browser/result.json，开发构建控制台无warn/error。无官方同环境配对，**score=null**。

## 最终检查与交付

- 最终93前端入口、完整非Fast **347段/32协议探针** 和对应原生debug/no-bundle构建均退出0，710个产品输入冻结前后匹配。标准的过滤Rust分组不能替代上述全库620。
- EXE：`dist-artifacts/sites-21K-20261107/CodexNative.exe`，SHA256 `c89e00202eb91c89c08ad91e8f57d7389b3ed4e6fcbb77a98f050dd395244258`。3个dist产物、5个许可文件及完整输入清单绑定在 `build-inputs.json`，未以旧EXE代验。
- 对应EXE在私有CODEX_HOME/WebView和实际CLI0.165.0下，完成探索→Sites未登录→重试→错误恢复→正常退出；进程终止与SQLite0线程均核验。它不证明正常共享弹层原生交互。
- 本地结果 `verification/final-result.json`、`native-result.json`，原生可访问性树和独立红绿均保留。预览候选说明为 `docs/releases/v0.2.0-preview.10.md`；远端CI/发布及实际下载校验另行核对，不提前宣称通过。用户明确要求CI成功，推送后须跟到终态，失败先修复，不在失败CI上发布。

## 剩余范围与限制

- 未发送真实邀请或登录HTTP，未验证服务完整schema、实际邮件/限流、全部角色/计划组合和官方运行时query defaults。团队1/2/4秒是包内默认退避映射，未排除官方远端/上层覆盖。
- 授权头像桥、profile showcase、首次发布/转让、Work创建编辑发布、整站删除/数据库等仍在完整Sites队列；Add/DNS解析依赖未获明确答复，未安装。
- 新输入的额外用户/团队只读Retry、本地dialog/碰撞引擎、静态px映射与写后GET属于明确适配。不能据此宣布完整官方交互、像素或新共享弹层原生通过。
- ACK缓存合并、pending行及GET确认时序与官方仍需按真实轨迹继续校准，不将本阶段适配固化为最终1:1标准。字体、头像、图标、spinner动画等尚无官方配对像素结论。
- 官方配对像素、正常共享Tauri弹层、物理中文IME、多窗口与用户验收仍待验证。生产EXE未登录冒烟即使通过，也只证明其明确范围。
