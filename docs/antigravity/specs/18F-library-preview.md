# 18F 资料库文件预览：后续完整链合同

日期：2026-11-06。状态：静态调研完成，未开发、未验收。承接[18E目录](18E-library-navigation.md)；本合同覆盖普通文件预览目标，不把图片或文本子范围当成整个预览完成。

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
