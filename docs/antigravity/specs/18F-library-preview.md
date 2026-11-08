# 18F 资料库文件预览：后续完整链合同

日期：2026-11-06。状态：普通图片/文本/Markdown阶段本地功能自验完成；完整类型矩阵未完成、未用户验收。承接[18E目录](18E-library-navigation.md)；本合同覆盖普通文件预览目标，不把图片或文本子范围当成整个预览完成。

## 固定来源

Store26.1027.3384.0；同会话固定asar整包hash6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074。直接读取27条目integrity，68原函数UTF16/hash锚点与14原分类纯VM样本在`.ref/parity/18/actual/18F-library-preview/reference/`。assessment/manifest/anchors/verification保存可复查依据；静态通过不证明当前账号gates和运行时可用。

## 已证打开合同

- Library页面Ha→marquee Wr先核真实access/account；普通native不走provider原链接。file-actions-menu ft保存accountId/userId/request/returnLocation到libraryPreview路由state，再由Br/Mr/Pr投影到右侧RightPanelOutlet，reserveTitlebarInset。不是通用居中弹窗。旧关闭只能关闭相同当前请求，返回真实先前位置。
- BNs是analytics上下文，g$s是嵌入/全局状态分派，都不是权限通过。chat_message_snapshot有真实来源聊天ID时跳原聊天；writing_block/小文本编辑受专用gates，不能只因文本可读就默认开启保存。
- metadata按真实file身份重读：libfile_fde[123]_直接/node；其他native先/files/{id}，仅403/404允许/node，必要受限分页fallback。取消/身份在await前后校验，其他错误不得伪为空或借已有行绕过权限。
- 字节链e0 inline content_url或主动下载download_url，经JJ/M5i/N5i规范及j5i鉴权，ZJ绑定取消和身份，B5i真字节。mounted materialize为provider分支，不强加native。40MiB上限与现library_image的8MiB图片限制不同。

## 必须分开验收的类型矩阵

| 类型 | 必须实现/核验 | 不可接受替代 |
| --- | --- | --- |
| image | 真metadata和内容URL、身份/版本缓存、onLoad/error/retry及大小边界 | 用图片表示所有文件 |
| text/markdown | 真字节TextDecoder，空白保留/Markdown surface、错误可见、只读边界 | 当前行metadata当正文，默认编辑 |
| PDF | 专用PDF字节/viewer与页内原生行为 | 当文本或静态截图 |
| CSV/TSV/DOCX/XLSX/XLSM/PPTX/notebook | 各专用解析器/渲染，依赖许可及Tauri等价性先核实 | 任意JSON/HTML统一预览 |
| HTML/site | 官方受控surface与完整隔离约束 | 将服务HTML注入应用DOM |
| special artifacts/snapshot | metadata类型/gate分派与真实目标 | 通用文件假支持 |
| 官方unsupported | 真实不能预览状态，符合资格的实际下载动作 | 造视频控件/假成功 |

可以按上述顺序形成可审阅阶段，但PDF/Office/HTML/特殊artifact未完成时必须留在完整页面清单，不能永久降级以获得绿灯。

## 宿主和动作验收

新增reader只能接受已证file身份/固定operation，不能renderer任意URL。针对鉴权、账号/用户/代次、网络策略、redirect来源、signed URL、header泄漏、MIME/流式大小与取消设计回归。预览不自动下载；下载无实际字节不得显示成功。关闭/切文件/换身份/离页释放对象URL、reader和监听，旧请求不覆盖新文件，重复打开不堆叠无限历史。

界面验收须覆盖真实右侧work面、文件名/面包屑/菜单、关闭返回、宽窄内容、键盘焦点及类型特有header/footer。共享/历史/Composer按真实资格提供；没有来源的动作不装饰性造按钮。

## 开发前还需补证

真实账号响应、native谓词与底层OY/file-service全合同、HTML隔离、PDF/Office/notebook现有可用能力和许可、全部特殊artifact gates/写边界、官方同环境宽窄截图与焦点/IME。当前14纯分类样本仅证明分支，不能替代下载、权限、viewer渲染或原生集成。后续先补相应决定性证据，再开发对应分支。

## 18F-A本次阶段实现与剩余矩阵

- 补证见同目录reference/preview-supplement.md、46个完整函数及25条实际中文、native-file-service-supplement.json。原包metadata两类顶层结构不含file包装；本项目宿主桥明确新增requestedFileId/file包络，用于绑定请求与严格canonical alias，不能称其为官方HTTP结构。
- 固定library_file/library_file_content操作复用账号、代次、取消、网络策略。metadata的403/404受限fallback、canonical id、content_url/attach规范化、有限重试、同源401一次刷新及外域无认证头均有生产函数回归。40MiB按真实字节检查，原8MiB通道未整体扩大。provider、mounted、shared conversation专用链仍未完成。
- 普通图片、文本、Markdown按metadata后真字节读取；右侧面板使用测量宽度、比例持久化、取消、URL释放和延迟Escape。窗口小于672 CSS px时全宽是当前实现，仍需官方运行时确认；关闭回原按钮是本项目可访问性选择，尚不能称官方已证。
- 颜色/尺寸以原函数和CSS为锚点，缺少官方同环境截图时score=null，不生成像素通过。Markdown暂禁止自动远程图片，保留文本alt；官方受控媒体链尚未实现，属于明确视觉功能缺口。
- 已知special artifacts暂隔离出普通读取资格。官方writing_block有按gate决定编辑或只读回退，因此当前统一未显示不是官方完整行为；snapshot跳原聊天、automation/flashcards/app/site等专用派发仍须实现，不能把限制状态计入1:1完成。
- PDF探针使用独立编译夹具、生成两页本地PDF，file origin的sandboxed Blob iframe显示插件阻止图标，未显示文档。DevTools脚本粘贴被保护阻止且未执行；没有放行粘贴、取消sandbox或改官方配置。本结果只证明该探针路径不可用，不能推广为WebView2不支持PDF；生产tauri origin和官方专用viewer均未完成。

阶段验证和交付以[18F-A记录](../acceptance/18F-library-preview.md)的实际结果为准。

## 独立文件地址

Store `26.1103.4239.0`（asar SHA-256 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`）中，`366057.8dff3ed0b6.js` 101943 附近注册 `/library/file/:libraryFileId`，`101313.c9b3ce267b.js` 11238 起的 `AoIz` 先确认会话账号、资料库资格及文件身份，再读文件。17972 附近的独立页使用主区标题栏并在关闭时导航至 `/library`。列表行的面板继续走 `678608.f43ff490bd.js` 39776 的独立路由状态与返回位置。带 `file_id` 的分享入口是另一分支。

验收。主窗从原生文件地址直接进入全宽预览，不读取目录。账号校验完成后走既有 metadata 和内容，403/404 沿现有终止规则，资格读取失败可重试。关闭回普通资料库；离开、切换地址或账号失效时取消旧请求，账号切换清除文件地址。仅接受当前固定宿主支持的 native ID；分享、provider、特殊内容及完整官方像素继续独立验收。

## 普通原生文件下载

同一基准的 `922296.f5ddb702a4.js` 75147、77582、84460 处分别给出下载资格、失败提示及工具栏动作。`12803.0142d29d6d.js` 20833 的资格函数排除 flashcards，并为第三方文件单独判断。`788421.8ff9a2f29c.js` 54050 的下载助手先取下载地址，有请求头时读取字节并通过 Blob 保存。`182735.bb2cb0d2af.js` 4999944 的 `vvmK` 区分 native 的 `content_url` 和 `download_url`，3535475 的 `hrUs` 在普通下载时省略 `inline`。中文包 `1561.0f4c0bdc0f.js` 给出「下载文件」及「无法下载文件」。数字为 0-based UTF-16 字符偏移。

| 动作 | 预期 |
|---|---|
| 打开无法渲染的普通原生文件 | 元数据通过后显示下载入口，浏览阶段不自动下载 |
| 点击「下载文件」 | 走显式下载端点和现有身份、取消、网络及字节校验，原样交给 WebView 下载，同一请求进行中禁用重复点击 |
| 下载失败后再点击 | 显示失败，原预览继续可用，可手动重试 |
| 下载期间关闭、切文件、离页或切账号 | 取消旧读；迟到响应不得启动旧下载或污染新文件 |

本项目通过现有宿主下载经验证的字节，沿用 40 MiB 上限。仅开放普通原生文件，已知超限、provider、特殊产物及已删除文件不展示动作。工具栏使用图标和官方中文可访问名称，浏览器下载启动后不提示已保存。官方的大文件直接下载、不可预览状态的下载按钮样式、原生保存交互和同环境像素分别验收。

## 普通不可预览状态

同一 Store 基准中，`922296.f5ddb702a4.js` 126466 附近的 `O2vv` 渲染文件类型图标、状态标题、文件名、说明及描边下载按钮。122919 和 125879 附近分别为尺寸未知的图片与普通未识别类型调用此组件。`189497.6182e00931.js` 712798 的 `FkTw` 将状态组居中，内容最大 384 CSS px、图标容器 64×64 CSS px、组间距 12 CSS px。中文包同版本的 `unsupportedTitle` 为「无法预览」，`downloadUnsupported` 为「下载文件」。

验收。仅对已读到元数据的普通未识别类型及尺寸未知图片应用上述结构。原文件名可换行，两个下载入口复用同一动作和进行中状态。资格不满足时只显示不可下载说明。读取错误、超限及专用渲染器待实现的文件沿用各自分支。官方说明还提到添加到 ChatGPT，这一分支本轮仅呈现已接通的下载能力。官方图标资源和像素对照仍待验证。
