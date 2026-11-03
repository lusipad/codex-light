# 16E 常规设置：选择器纠偏

2026-11-04，实施前合同。基准继承16D Store `26.1027.3384.0` 及其SHA清单，读取同目录 raw 原件。

## 已核事实与范围

- `general-settings-5e6e6ad31bf0.js`：`Ec` 依据模式选 `Dc/Oc`；不把Work额外分支全部搬到本地。
- `Dc`本地常规分组中的 `Vc`（@130718）是默认打开目标，`Wc`（@132875）为Windows集成终端Shell（非Windows直接返回null）；`zc`（@127290）实际是Windows启动应用入口，不能作Shell依据。偏移为0-based UTF-16字符。
- `Vc` 用右对齐菜单、RadioGroup/RadioItem、无目标时禁用。`Wc` 用右对齐宽220px菜单和已选标记，shell列表来自可用能力。
- `fl`（@162939）才是发送快捷键 `composerEnterBehavior` 三模式菜单，宽 `w-55 max-w-xs`；`al`（@153746）是后续消息 queue/steer，纠正16D旧定位描述。发送区由主代理集成选择器，不改变保存消费者。
- `settings-shared...` 的 `g/Pi` 是outline toolbar按钮，文字与下箭头分布两端；不使用系统灰色select。

## 验收合同

1. 生产控件点击/Enter打开菜单；ArrowDown/Up打开并聚焦首末项，菜单方向键/Home/End导航；Escape关闭且焦点回trigger。输入法合成键不导航；不可focus的外部元素pointerdown也关闭。弹层portal至body避开scroll祖先裁剪，依据trigger实测rect及菜单宽高定位，接近底部翻转；resize/捕获scroll重定位，关闭清理监听。
2. 单选项展示选中状态；只选择一次触发一次保存；同值不重复写；禁用/无目标不打开，不伪造可用选项。
3. 选择后即时保存且真实读回；保存/读回错误继续展示之前确认值，保留重读入口；并发锁和卸载保护保持原回归。
4. 常规已有两行复用选择器和既有CSS行结构，不增无消费者开关。主代理负责公共row布局及发送区集成。

官方同环境截图、运行时gate与原生焦点/IME尚未实测，不给像素通过。语言/WSL/窗口关闭策略/跟进行为等消费者缺口不在本次虚构补齐。
