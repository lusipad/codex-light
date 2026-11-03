# 16E：设置外壳与常规/外观第二轮纠偏

2026-11-04，修改前合同。范围仅公共设置外壳、常规和外观；专用服务、账号 gate 和其余分区不在本轮完成口径内。

## 基准与已证事实

沿用16D已核Store 26.1027.3384.0及其reference/manifest.json，asar SHA-256为6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074。以下数字为0-based UTF-16字符偏移。DPI、App缩放、同环境官方截图仍未知。

- settings-page-19ad78df2b6f.js @36310 `hi`：搜索placeholder来自settings.search.placeholder，role searchbox、autoFocus、清除按钮、CmdOrCtrl+F聚焦并全选。中文包对应“搜索”“清除设置搜索”“未找到结果”。本项目搜索仍仅覆盖当前25个分区及关键字，不冒充官方插件/团队跨目标搜索。
- settings-page @29631/@30800：sidebar-navigation，分组间gap-4，组内项含icon，font-normal；搜索头与overflow-y-auto列表分离。ArrowUp/Down不循环且点击激活。保留现有草稿guard。
- use-visible-settings-sections-7c15410789f4.js `za/Ba`（16-14C同版本已提取）：官方每项有专用图形资产。当前用现有lucide 16px图标补结构，不复制未核许可资产，轮廓仍为已知差异。
- settings-content-layout-268f5398cbba.js @6045/@6300/@8963：非embedded且非fullWidth的max-w-3xl，同宽标题/内容，默认section gap40；slate/window分支padding token，非所有嵌入布局通用。
- 5257da4ba4ae.css：container-3xl=48rem，html reset未设根字号；electron body panel-base=spacing*5=20px；sidebar-navigation row30px、radius10px、padding8px。
- 本项目styles.css将html根字号设为13px，直接写48rem会缩为624px。此次限定设置内容上限768 CSS px，恢复官方默认16px根下的48rem设计尺寸，不改变全局root字号，也不声称这是实测物理像素。侧栏250px保留，官方可拖动宽度/持久化仍待证。

## 修改前验收合同

1. 保留25项、三组及所有专用状态/服务/导航保护；只补导航图标结构、搜索语义与生命周期。
2. 搜索自动聚焦，Ctrl/Cmd+F仅设置内接管，聚焦并全选；清除回到搜索，空结果显示“未找到结果”；IME阶段不拦截。
3. 发送快捷键接GeneralPreferenceSelect三值，保存中禁用，错误继续呈现；不变更App写入/读回合同。
4. 内容上限768 CSS px，标题与内容共用边界；左搜索固定、导航列表独立滚动；640宽无横向溢出。仅由浏览器夹具验证结构，不代表原生UI或官方像素通过。
5. 常规/外观详见16E-general.md、16E-appearance.md。旧16D把al误认为Enter的注释需修正，实际Enter为fl，al为跟进排队/引导。

## 未验边界

官方配对像素、真实Tauri GUI、IME操作、多窗口/持久化布局均待验证。其他设置分区仍有已登记差异，不因公共外壳变化而升级验收状态。
