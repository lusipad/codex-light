# 12/13D 插件与技能目录纠偏

日期：2026-11-04。范围为独立插件/技能目录及共用管理组件；设置管理路径保留，不修改协议、认证、安装服务或设置消费者。

## 基准与证据

使用Store 26.1027.3384.0，asar SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。显式读取WindowsApps下对应包，未使用硬编码旧包提取器。参考清单/UTF16检索锚点：`.ref/parity/12/actual/12-13D-ui-correction/reference/{manifest,anchors}.json`。当前账号gate、DPI、App缩放、官方配对图未知。

- `plugins-skills-tabs-165c1dc12b7f.js`：目录插件/技能入口，插件标题“插件”、Codex subtitle“连接插件，让 Codex 在你的各类工具中协同工作”。公共/个人/工作区/团队子目录与账号能力相关，不能用当前本地市场伪造这些来源。
- `manage-plugins-page-48df47431a98.js`：管理路由按eligibility跳到`/settings/plugins-settings`，不等于目录五tab管理台。
- `skills-page-ab4375bc771d.js`：独立技能目录标题“技能”、Codex subtitle“通过任务专用技能扩展 Codex”；已安装和推荐分区。兼容旧技能页也明确“已安装”在“推荐”之前。
- `skills-page-grid-cfb4684abd0f.js`：默认grid-cols-1，容器581px起双列，gap4（16px）；来自静态实现，未证明当前官方客户区下实测几何。
- `skill-card-bfd02fd93706.js`：真实`skills/config/write`；卡片预览，更多菜单可“打开”文件侧板；`skill-contents-modal`使用xwideTall弹窗和关闭焦点回返。
- 中文来自当前`zh-CN-88ebb426d686.js`，SHA已列在05D manifest；不以英文defaultMessage代替中文。

## 修改前合同与验收

1. 独立目录只显示插件/技能主tab，管理模式保持运行时动态管理tab；目录不能冒充设置管理页。
2. 页头随当前surface给出标题、搜索和说明；连接自定义MCP只在管理surface提供，原安装/刷新/启禁/卸载/取消/错误仍使用已有真实链。
3. 技能初态不显示空白文本编辑器；先已安装列表，再推荐。技能行支持Enter/Space选择，启禁独立按钮保留真实写锁。卡片在宽容器双列、窄容器单列。
4. 插件详情触发为真正button，支持键盘和aria-expanded；不暴露plugin/read、plugin/install为tooltip。不可移除真实操作结果核验。
5. 定向生产组件回归验证目录/管理边界、初态、详情键盘触发、推荐查询/安装旧用例；回归原启禁、安装、卸载、取消及失败逻辑。

## 本轮边界

当前本地市场目录仍不是官方完整远端公共/个人/团队目录；不伪造gate或发真实HTTP。技能选中后仍沿用本地编辑工作面，完整官方预览modal/更多菜单/文件侧板未恢复。完整插件详情路由、资源图标、卡片几何、原生交互、同环境像素和用户验收未完成。本轮仅可称结构与交互增量。

## 实施结果

实现与定向验证见`docs/antigravity/acceptance/12-13D.md`。没有删除种子安装能力：种子与已安装混合时明确标“技能与本地模版”，避免将未安装内容误报为已安装。编辑面由已选择身份或明确creatingSkill新建状态决定；清空新建ID只禁用保存、不卸载草稿编辑器；本轮未处理选中后完整modal、全局导航草稿保护等历史缺口。

## 目录到管理入口补充

当前Store `plugins-skills-tabs-165c1dc12b7f.js` UTF16 9138附近为目录头部onManage链，直接导航`/settings/plugins-settings`，传initialTab=plugins并保留浏览状态；42499/42691附近管理action取`skills.appsPage.managePlugins`。当前中文资源UTF16 2054949值为“管理”。本轮仅插件目录且存在宿主回调时显示“管理”，点击只调用一次导航回调，不触发安装/授权；管理模式不重复显示，技能目录不借用插件scope。宿主路由由App集成。
