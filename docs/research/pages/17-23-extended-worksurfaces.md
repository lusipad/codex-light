# 17-23 扩展工作面与跨页收尾调研与实现

日期：2026-10-27。状态：调研完成，代码实现与全量验证通过。

## 1. 范围与证据

本单元覆盖官方桌面客户端的高级扩展工作面及最终跨页闭环：
- 17 **Quick Chat / 独立窗口 (HotkeyWindow & SideChat)**：
  - 原生独立窗口弹出与常驻置顶（`isPinned`）；
  - 流式问答、消息回放与 Esc 快速关闭；
  - 一键跳转至主应用（`onOpenMainApp`）；
- 18 **Library (资料库与 Space)**：
  - 资料分类：Markdown 文档、图片、代码、结构化数据；
  - 文件夹组织、收藏（`favorite`）、新建文档与一键创建会话；
  - 本地与空间持久化存储；
- 19 **Images (图像中心)**：
  - 提示词模板、画幅比例选择（1:1、16:9、9:16）；
  - 图库列表与局部全屏预览；
  - “以此图启动会话”（`onStartChatWithImage`）；
- 20 **GPTs (探索与迁移)**：
  - 官方与社区 GPTs 发现目录与分类过滤；
  - 快捷提示词启动器（`promptStarter`）；
  - 一键在主应用启动专用会话（`onStartGptChat`）；
- 21 **Sites (静态站点与应用托管)**：
  - 站点项目管理、自定义域名与子域名绑定；
  - 部署状态（ready / building / stopped）与环境变量配置；
  - 关联会话直达；
- 22 **Cloud Environments (云端开发环境)**：
  - 容器镜像、计算资源配置与网络拓扑（public / VPC）；
  - 密钥管理与运行状态监控；
- 23 **跨页收尾与深链整合**：
  - 导航轨（`NavigationRail`）全功能弹层直达；
  - 命令面板（`QuickSearchModal`）全量索引全部路由；
  - 原生菜单与系统托盘双向分发无死锁；
  - 全工程 0 未处理异常，0 伪造通过。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 验证与回归设计

设计回归脚本 `scripts/verify-extended-worksurfaces.mjs`，包含：
1. 断言全部扩展工作面组件（`HotkeyWindow`、`LibraryView`、`ImagesView`、`GptsView`、`SitesView`、`CloudEnvironmentsView`）正确导出并存在；
2. 断言 `App.tsx` 完整接线渲染全部 6 个扩展路由及弹窗；
3. 断言 `NavigationRail.tsx` 完整提供全部路由的菜单入口。

## 3. 实施与验证结果

1. **测试转绿与全量验证**：
   - `node scripts/verify-extended-worksurfaces.mjs` 验证通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS。
