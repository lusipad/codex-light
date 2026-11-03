# 16E 常规设置定向自验

2026-11-04，对应[开发前合同](../specs/16E-general.md)。本记录只覆盖常规打开偏好与共享选择器，不代表整个设置验收。

## 本轮实现

- `GeneralOpenPreferences.tsx` 两个系统select改为右对齐菜单选择器；保留动态目标/Shell列表、平台过滤、即时写入后真实读回、失败保留确认值、重读、并发及卸载保护。
- 新 `GeneralPreferenceSelect.tsx/.css` 用现有React、lucide和主题token；无新增依赖。文字与箭头分布两端，选中Check、220px菜单、滚动上限。共享给发送快捷键及外观，以免每处重造菜单。
- 点击、Enter/Space原生button激活、方向键打开、菜单Arrow/Home/End、Escape焦点回归与离开控件关闭；同值不重复调用保存。IME键不打开/导航；外部不可focus元素的pointerdown也关闭。
- 主线程复核发现scroll容器裁剪风险后，弹层改为body portal/fixed，使用trigger与菜单真实边界定位、底部翻转、scroll/resize重定位；关闭卸载清理监听。布局effect避免0,0初始定位闪帧，未用固定父容器坐标冒充自适应。

## 定向结果

| 命令 | 结果 |
|---|---|
| `node scripts/verify-general-preference-select.mjs` | 0；新增生产组件先红（新增控件缺失），后绿；菜单状态、单次保存、键盘、焦点、空/禁用、IME、portal边界翻转、scroll/resize、不可focus外点关闭/监听清理，以及生产调用方服务列表与loading锁 |
| `node scripts/verify-general-open.mjs` | 0；原真实读写协议和读回/失败/并发/卸载/新终端消费者回归保留 |
| `node scripts/verify-general-enter.mjs` | 0；三模式Enter、IME、实时持久化、失败回滚与启动竞态保持 |
| `npx tsc --noEmit` | 0（本次定向检查时工作区快照，最终组合检查由主代理汇总） |
| `git diff --check` | 0；包含其他代理同时修改的工作区，不代表全部归属本子任务 |

## 仍未验证

无同环境官方截图，不给像素分。共享选择器几何/弹层边界仍需主代理浏览器及原生实际验证；窗口级焦点、中文输入法与用户验收未完成。官方文件目标图标尚未恢复（当前服务类型只提供id/label），未静态写死应用图标。旧回归只证明已有协议与状态消费者，不证明官方所有常规项完整。官方语言、关闭策略、WSL、启动应用、跟进行为等缺口保留，未造无消费者设置。
