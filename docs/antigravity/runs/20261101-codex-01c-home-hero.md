# 01C 首页欢迎区：状态与项目入口

## 范围与推进方式

用户本轮要求持续推进所有页面，避免被单一功能细节长期阻塞。因此进入 01C 开发，01B 的原生焦点、官方对照和像素欠项保留；进入下一开发单元不表示前序已验收。本轮仅处理首页标题与其项目选择入口，不改 Composer、权限、模型、项目后端或其他页面。

## 修改前调研

固定候选仍为 Windows 26.928.21956 / build 12404。复核现有只读提取：

| 来源 | SHA-256 | 定位（0-based UTF-16） | 证明范围 |
|---|---|---|---|
| `.ref/scratch/files/app-primary.js` | `B678C26A3CE9D0B4B30C96BD181CAA862F46CA26E0889AFB2CE618E1CF8300EB` | `PAt` @2229752、`G7(` @2175928、`mAt` @2206852 | 根据项目存在与 Git 上下文切换标题；项目名是交互按钮，可在自身宽度内换行；Logo 为 56px / opacity .3，动画另有实现 |
| `.ref/parity/01/runs/20261031-codex-01b-hovercard/reference/zh-CN-3ed9eb1db28a.js` | `C6AC10A9FB407A393EA002D9AA818A4C7ED0E215E9C8BF0CFE2B798A98E3756F` | 以下三个完整 message ID | 固定中文文案与空格，不能从英文重新翻译 |

- `home.hero.noProjectWhatShouldWeBuild`：我们要构建什么？
- `home.hero.whatShouldWeBuildInSelectedProject`：你想让我们在 `<projectSelect>{projectName}</projectSelect>` 中构建什么？
- `home.hero.whatShouldWeWorkOnInProject`：我们应该在`<projectSelect>{projectName}</projectSelect>`中做些什么？

当前缺陷：无工作区仍展示虚构 `codex-app-offline`；普通目录也始终显示 Git 的“构建”标题；项目按钮未声明展开状态，弹层无 Escape 返回入口。继续复用工作区状态与已有选择回调，使标题入口与 Composer 选择相同上下文，不引入第二份选中状态。

## 开发合同与验证

| ID | 操作/场景 | 预期 |
|---|---|---|
| HC01 | 无工作区 | 显示无项目标题，没有虚构项目名或项目按钮 |
| HC02 | 当前工作区是 Git | 按固定中文资源显示“构建”标题，按钮为工作区名称 |
| HC03 | 当前工作区为普通目录 | 按固定中文资源显示“做些什么”标题 |
| HC04 | label 为空、路径有末尾分隔符/根目录 | 使用真实目录名；根目录保留实际路径，不回退到产品占位 |
| HC05 | 点击项目按钮、选择工作区 | 展开状态可读，复用当前工作区列表及同一个选择回调，不创建会话 |
| HC06 | 弹层 Escape / IME Escape | 普通 Escape 关闭并返回项目按钮；组合输入 Escape 不抢占 |
| HC07 | 超长项目名称 | 保留完整文字，按钮在主区范围内换行；不撑宽主区 |

先运行生产标题 JSX 回归复现内容差异，再实施。测试不复制标题实现。官方菜单内容、Logo hover/click 动画、精确主区位置与宽窄截图需另有证据；本轮不以静态 CSS 或 JSX 回调冒充像素或原生通过。

## 实施结果与边界

- 修改前 HC01 失败：实际为“你想让我们在 codex-app-offline 中构建什么？”。修复后 HC01–HC07 内容与回调回归通过，类型检查通过；HC07 只证明完整源文字保留，实际换行几何另验。
- 复用 `baseNameFsPath` 与已有工作区选择回调，没有引入状态/组件/依赖；标题不再创建假项目，普通目录使用固定中文资源。项目入口补充展开状态、弹层身份及 IME 安全的 Escape 焦点返回；长名称约束来自 `PAt` 的实际按钮 class。
- 浏览器预览实际显示无项目标题“我们要构建什么？”，读取计算样式为白色、容器 opacity 1，viewport 767×719。浏览器无 Tauri 桥，其工作区/服务读取警告不代表真实原生协议失败；既有 `popovertarget` React 属性警告未在本单元顺手修改。
- 已执行 visual-verdict：参考图 1568×934、Git 项目与展开侧栏，当前预览无项目且尺寸不同，不可作像素比较。`.omx/state/parity-01c/ralph-progress.json` 记录未验证，score 0 为未具备评分条件，不是测得的相似度。保留原生/等价数据宽窄图、Logo 动画和精确定位待验。
- 按用户最新推进授权进入 01D 的主要功能调查；01C 未用户验收，不写成严格 1:1 完成。
- 合并 01D 后完整标准检查及独立 Tauri Release/MSI/NSIS 构建退出 0；[本轮 EXE](../../../dist-artifacts/01CD-home-composer-20261101/CodexNative.exe) 为 14,032,896 bytes，SHA-256 `E918DDE6EFF30AD54730F14B8E03E5C679DD53BAC7C34EED35A6D7213C741BD2`。检查/构建输入哈希一致，[构建清单](../../../.ref/parity/01/runs/20261101-codex-01cd-main-flow/actual/build-manifest.json)保留源码边界；该 EXE 尚未原生操作。
