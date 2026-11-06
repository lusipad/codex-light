# 18E 普通资料库目录导航：阶段记录

日期：2026-11-06。状态：本地功能自验完成，待真实账号/视觉及用户验收。固定官方Store26.1027.3384.0，合同见[18E规格](../specs/18E-library-navigation.md)，直接原包12条目、25函数/中文锚点和补充CSS证据位于`.ref/parity/18/actual/18E-library/reference/`。

## 改动与真实边界

- LibraryView复用真实身份资格、现有nodes分页、原表格及错误呈现，增加普通native目录进入、祖先/root选择、当前目录aria-current、独立path错误/重试及按真实宽度折叠父级。全局标题栏优先目录前后退，根/祖先选择作为普通导航push历史；目录栈不可用时保留原页面history。文件仍为真实元数据，不假造预览/下载/上传。
- 客户端目录只增加parent_directory_id，原cleanup all/images请求不变。path独立解析items/id/name/is_root而非要求kind/cursor。宿主新operation仅固定GET directories/path与directory_id，复用鉴权、网络策略、身份与取消，拒绝未知字段/异常类型与边界。
- 独立审查/自审发现并复现监听交替间隙跨账号旧目录、旧路径重试/分页借新控制器、根目录跨身份前进栈残留，均保留真实红日志并修复。所有旧回调匹配捕获控制器/目录；账号/用户/代次任一变化清双向历史及known祖先，取消旧数据并回根。
- 普通文件预览完整调用链另已只读取证到18F；不以library_image替代通用PDF/text/artifact，未将18F调研冒称开发。

## 当前验证

- 数据/客户端新增先红后绿，宿主14项library测试通过后，全库Rust519项通过、零失败/忽略/过滤；鉴权、HTTP错误、取消/身份与同步transport完成晚回均覆盖。
- 原服务全部断言保留，真实组件hooks回归、App生产回调抽取、独立复核及最终58组前端发布回归退出0。监听失败、空中间页、重复cursor、独立path失败、旧回调、ABA身份与原cleanup功能均有适用检查。
- 最终实际React/LibraryView/ThreadActionsMenu宽1280×800与窄640×800无文档横溢出，父菜单320px在viewport内；键盘Enter目录、分页、祖先/根、back/forward、路径404及单独重试、身份失效归根、Escape回trigger通过。浏览器alias仅替换LibraryClient与bridge为明确内存读边界、CSP禁止外连，不冒称账号HTTP；数据/client/宿主分别有生产函数测试。
- 完整非Fast标准315段/32协议探针与最终Tauri debug构建均退出0；最终627项产品/验证输入在冻结后和构建后逐项哈希稳定，345项产品输入与3产物绑定当前EXE。
- 私有原生CLI0.165.0实例验证探索→资料库、真实未登录错误/重试、标题栏返回主页面/前进重开及正常退出；只读SQLite确认0会话。此路径未验证认证目录或原生目录菜单，浏览器的内存reader不能替代此缺口。
- 可运行构建：`dist-artifacts/library-18E-20261106/CodexNative.exe`，SHA-256 `08ddcb65f38531affbf4c135f64975d4e847828112c158628ae9591081b9a95a`；附5项许可文件与build-inputs.json。基线ea66107加本阶段源码，完整结果verification/final-result.json，未生成新安装包或发布。

证据根`.ref/parity/18/actual/18E-library/verification/`：data/client红绿、navigation三项红灯及最终绿、host红绿、backend-library、frontend-final、browser-result及两张final JPEG。截图为原始JPEG，不是官方无损像素差分。

## 尚未完成

真实账号目录/path响应与权限未访问；官方配对像素、物理IME、原生认证目录/菜单、多窗及用户验收未完成，score=null。极长当前目录在窄窗按官方Yi可能只剩当前截断项，标题栏仍可返回；root null按原函数仍是按钮。

完整browse/GridList工作面、tab/来源/搜索、外部provider/shared/Space/Pages、通用文件预览和写操作仍有缺口。URL编码/深链接和跨页面重返目录状态尚未接入，目录返回滚动/缓存仍待对照；本次没有将组件内历史冒称完整NMs路由。阶段提交不代表整页1:1。
