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

## 普通原生文件下载

- 列表预览面板和独立文件页共用「下载文件」。文件无法渲染时也可从工具栏下载符合条件的原生文件。宿主选用独立下载端点，沿用原有认证、网络校验、取消和 40 MiB 限制。
- 前端生产组件回归先在缺少下载动作处失败，随后通过。覆盖普通 CSV 不预取、并发点击只读一次、失败可重试、原始二进制及中文文件名、对象 URL 释放、取消后迟到的响应、已知超限和不符合资格的文件。Rust 回归覆盖两类端点、优先读取原文件地址、签名目标无凭据以及拒绝非法参数。
- 隔离浏览器从独立文件地址下载了 `电子表格分类.csv`，磁盘的 23 个字节与夹具源文件逐字节相同。1280×800 和 640×800 均无横向溢出，按钮均为 30×30 CSS px。实测数据和截图位于 `.ref/parity/18/actual/18J-library-download/`。浏览器夹具使用内存服务，Rust 路由使用传输夹具。
- 本地发布元数据校验、106 组前端回归、生产构建、Windows 通知适配器测试和 690 项 Rust 单测通过。Tauri Windows 正式构建生成 EXE、MSI 和 NSIS 安装包。
- 独立 Tauri 夹具以 `http://tauri.localhost/` 加载同一生产预览组件，使用独立 WebView2 数据目录及内存读取。原生窗口点击「下载文件」后只读一次字节，带中文名的 CSV 保存到 Windows 下载目录。保存后读回全部 23 字节，与源夹具逐字节一致。证据见同目录的 `native/download-complete.jpg` 和 `native/saved.csv`。
- 仍待验证真实账号下的生产应用下载链及同环境官方截图。此阶段使用工具栏入口，保留现有预览错误状态。官方在部分不可预览页面内另有下载按钮，尚未对齐。

## 普通不可预览状态

- 对未识别的普通文件和大小未知的图片，按官方结构呈现居中文件状态。主体和工具栏的下载按钮共用进行中状态，失败可重试，关闭时取消。专用渲染器待实现、超限及读取错误沿各自路径呈现。
- 回归先在缺少内容区状态处失败，随后通过。覆盖中心入口、两个入口只启动一次读、同步禁用、卸载取消与下载资格。隔离浏览器 1280×800 和 640×800 均未横向溢出，图标 64×64 CSS px，内容区按钮居中。Enter 触发后两个按钮均禁用，释放夹具字节后实际产生下载。
- 使用现有图标库，文案仅说明已支持的下载。证据在 `.ref/parity/18/actual/18K-library-unavailable/`，官方同环境像素和此界面的原生键盘操作仍待对照。
