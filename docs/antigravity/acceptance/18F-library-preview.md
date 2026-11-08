# 18F-A 资料库普通文件预览阶段

## 2026-11-08 独立文件预览地址

- 按新版原包接入主窗原生文件地址，复用资料库资格与文件预览。打开独立地址不发目录请求，关闭和标题栏返回进入普通资料库，账号失效中止读取。
- 组件回放验证地址编码与排除分享链接、资格失败可重试、无资格不读取文件、身份失效取消。隔离浏览器在 1280×800 和 640×800 验证全宽、无横向溢出；文本只读一次元数据和一次字节，403 不读字节也不提供重试。关闭和换账号均返回 `/library`。证据见 `.ref/parity/18/actual/18I-library-header/browser/file-route-verification.json`。
- Windows 原生地址加载、真实账号、官方配对像素及分享和特殊预览继续验收。

日期：2026-11-06。状态：图片、文本、Markdown本地功能自验完成；完整预览及用户验收未完成。官方固定Store26.1027.3384.0，来源与完整矩阵见[18F规格](../specs/18F-library-preview.md)。

## 实现与简化

- 复用现有Library目录、鉴权宿主、网络策略和Markdown组件，只增加固定metadata/bytes操作与右侧预览面板。App只有普通Library容器放开宽度；cleanup布局保持原样。
- metadata先重读真实身份，支持两类顶层结果及严格canonical alias；内容读取支持content_url/attach与签名跳转、40MiB真实边界、取消和401一次刷新。桥包络是本项目协议，不冒称官方响应。
- 图片真实Blob解码，文本保留空白与Unicode、空文件可显示；Markdown只读且自动远程图片暂隔离。关闭、离页、身份变化、重试释放旧URL和监听，旧close/晚到响应不能影响新请求。面板复用原localStorage键按比例保存宽度。
- 不增加依赖。Office/PDF/HTML/特殊artifact没有用通用文本或图片伪装；对应工作面仍待实现。writing_block官方有受gate控制的只读回退，当前资格限制属于差异，不是已复刻。

## 已取得的证据

证据根：`.ref/parity/18/actual/18F-library-preview/`。

- reference直接原包27条目/68函数、14原分类样本，补充46函数及25实际中文；宿主内容链补证独立登记。
- 客户端真实红绿覆盖缺失reader、9MiB Base64正则堆栈溢出、合法charset MIME误拒。Markdown外链自动图片、旧凭据401与special误入普通读取均保留真实失败及修复结果。
- 61组前端发布回归退出0；全库Rust527项通过，零失败、忽略和过滤。最后取消检查包含在全量测试源码中。完整非Fast标准318段、32个隔离协议探针、类型检查及前端生产构建退出0。原生产品构建单独记录，不把PDF测试构建当产品构建。
- 实际React/LibraryView/Pane/Markdown宽1280×800、窄640×800无横向溢出。文本空白、64×64 PNG真实解码、Markdown无自动img、403无重试、网络重试、坏图片重试、空文件、Escape回trigger、晚到字节关闭隔离、宽度320重开保持、身份失效关闭通过。fixture只将reader/bridge替换为显式内存，CSP禁止外连；不等于真实账号HTTP。
- preview-wide.jpg、preview-narrow.jpg为当前组件原始JPEG，含夹具控制条，不是官方配对像素。visual-verdict.json的score=null，缺少同环境官方参考。
- 独立Tauri/WebView2夹具额外加载真实组件bundle（IIFE转换、file origin、显式内存reader、CSP未放宽），实测文本/Unicode/空白、Escape关闭后Enter重开原按钮、有效PNG显示，截图及native-component-result.json留证。此轮在字号13→14px修正之前，不能当最终原生像素证据；最终浏览器已重测14px/28px。该测试不是生产App路由/鉴权集成，也没有物理IME验证。
- 原生PDF能力探针在独立编译夹具/file origin下未渲染sandboxed Blob PDF，仅显示插件阻止图标；没有绕过DevTools粘贴保护或降低产品隔离。此探针不能代表生产预览或全平台PDF能力。
- 最终生产Tauri debug构建退出0；634项产品/验证/原生输入在构建前后哈希一致，3个前端产物绑定构建。`dist-artifacts/library-18F-20261106/CodexNative.exe`的SHA-256为`98b4d30c7a7ae2503359a4b2ef9367d2941aae7a26017133c388f26bde4c8409`。首次本地打包检查发现遗漏嵌套许可目录，已从当前冻结源码补齐5份许可并逐个核对哈希；不需要重编产品，没有生成新安装包。
- 最终EXE在独立CODEX_HOME/WebView数据目录、CLI0.165.0中启动，探索→资料库→未登录错误→重试→正常退出通过；只读SQLite确认0会话。真实认证文件预览仍未验证。最终证据verification/final-result.json、native-product-result.json及产物build-inputs.json分别记录边界；基线246ab21加本阶段代码，阶段提交后补提交绑定。

## 未验与下一步

真实账号metadata/bytes、原生认证预览、物理IME、多窗、官方同环境像素和用户验收未完成。当前先交付普通文件读取阶段，再补PDF专用viewer可行性与许可、Office/Notebook解析、HTML受控surface、special gates与来源聊天派发。普通Library完整GridList/搜索/provider及写操作仍保留在全页面清单，不据此声明整个18页完成。

下一[PDF合同](../specs/18F-pdf-viewer.md)已明确独立引擎、许可、安全选版及动作验收；当前未获新增依赖授权，未安装或vendor。可以先推进不依赖该引擎的页面，不把此限制冒称PDF已完成。
