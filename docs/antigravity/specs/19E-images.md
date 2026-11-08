# 19E 图像页：开发前功能与界面规格

2026-11-06。状态：**只读工作面及受控资源已开发；限定阶段自验通过，完整检查及最后UI修复后的重验范围见阶段记录**。本文件不表示整页自验完成或用户验收；生成/编辑仍未恢复。目标为固定官方版本的可观察功能、交互与界面一致，先恢复真实只读正常工作面，再独立接真实生成/编辑链。最新子阶段范围见[记录](../acceptance/19E-images.md)，不包含在preview.6。

## 1. 固定基准与证据

- 固定已安装Store版本：**26.1027.3384.0**。
- 原包：`C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。
- 本次流式SHA-256：`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，674296148字节。
- 包内package.json版本：`26.1027.30824`；与Store版本分开记录，不混称。
- header JSON：6132968字节，SHA-256 `58b11f647e1119b429ae364292977cf86fe116de3987265ccd2a265991fb9d85`。
- 18个entries均由本次header定位读取并与entry.integrity匹配；78个0-based UTF-16锚点重新定位，27条中文重新核验，2个中文key缺失。
- 原始证据：[manifest](../../../.ref/parity/19/actual/19E-images/reference/manifest.json)、[锚点](../../../.ref/parity/19/actual/19E-images/reference/anchors.json)、[中文](../../../.ref/parity/19/actual/19E-images/reference/translations.json)、[核验记录](../../../.ref/parity/19/actual/19E-images/reference/verification.json)。未发真实HTTP/模型请求、未改官方包、未运行GUI/Cargo/构建。
- 这证明固定安装包仍可取证，不证明它是所有分发渠道最新版本。账号gate、DPI、App缩放、主题、运行窗口和配对图仍未知，不评分。

| 原始entry | 字节 | SHA-256 |
|---|---:|---|
| `app-primary-998934e837fc.js` | 4623731 | `084d7102a8eca9a49fc37e25d7b95c2c8052d3b5b2709e28867e266748d761a0` |
| `draft-state-2659a92af81a.js` | 2211 | `8a959f9d9f3c4dea8e50ad9d2684ea4c2cacb1c1d0177426e80600348f982b63` |
| `page-941e96e6c8db.js` | 4634 | `3d2f5ae8536adc67f42e1f80834eb42653f200026b0016b383c9efb4d07daecb` |
| `preview-9e26b8c0ab2c.js` | 15117 | `e10177dec16d157b2a670dc7610a74a983507e7047c9802c8ed45d9be664470b` |
| `prompts-e548517910dc.js` | 13579 | `6ed56f07d2ff94decc47a4e4b2fa4d28c8b27b04212808427a80f1b60e749c1b` |
| `suggestions-4a821f4a4c1e.js` | 24349 | `f5028e2d9edf9bfab21e1a2163ece9781f4360b67b7e21db989565c32c0a91af` |
| `app-initial-4267e52fe5b0.js` | 10858430 | `ba06de8c5418586b49ca7d639ea5ad2af531c1037454ec69b10b9ea11e00992e` |
| `app-runtime-e4b4e09bd942.js` | 376823 | `bfe7cc48427c12348fb0ab75806de4861caa898b815e68950e63dcfeb09b8f28` |
| `library-masonry-f1943d842997.js` | 5655 | `4609493aa85ec13932224c750ff3412fe4a8d4c5846d64a1c2a593a5bd287ed3` |
| `prompt-page-route-f881fa690368.js` | 15871 | `b632d10acdf12c59ef446f6ac74231759858e1cfcd82be3c10c0f01e4af6199c` |
| `zh-CN-88ebb426d686.js` | 2961780 | `672ea7570754a484585121ddbbbbbba078e95f51ecf68db6e4f901a011577745` |
| `app-shared-b9a49a97ca55.js` | 6213807 | `f4b8ddb204fe43881fe4a625c09938e96aca597585583af1d86fc611c79d2e47` |
| `early-bootstrap-491-e75c34fa1b2c0832.js` | 5350667 | `db3fd1590ec3d3c621a85c2cf925785ea6d99df8bc4eaec8bc4b1e974758a8ab` |
| `searchable-page-layout-99049fa44c3f.js` | 20630 | `90523db973227bd47d58ae94da153f9ea4b4a8dcfd6c922409b76eab5e9c3270` |
| `library-reference-images-section-a908fbca5704.js` | 2555 | `423a04b5c6e0153fd49af0f38cafa4b71dff061f631ec8270bd15c3ced7d5b16` |
| `5257da4ba4ae.css` | 1369670 | `6c0b62be9ea2b0268a114414a05365744206eab52b3c14b66ec6eceb063d23e0` |
| `b74e19ff7ff4.css` | 191618 | `add22f5a6ff93862827b6bba51ed6e4356708d8f99c2a6bdaca51993bc0df3ed` |
| `59ad52d5aa88.css` | 115218 | `a03f7cb0efbef3fc50b767db245d131c87bbc2a4d226307786473bc08cbf9b0e` |

## 2. 工作面与可用范围

必须分开：`/images`的提示目录/ChatGPT composer/我的图像；`/my/recent/image_gen`的真实生成历史；Library images列表；CLI会话imageGeneration输出。后两者不能冒充前两者。

官方primary将`/images`懒加载到`page-941e96e6c8db.js::ImagesPage`。runtime::yj先检查独立`chatgpt.image-generation`能力：pending显示无延迟loading，不可用replace到`/`；无slug为首页，有slug为模板页；非法语言也replace到`/`。错误boundary重置与空目录不同。

页面draft为`kind:chatgpt`，composer提交hiddenSystemHint=`picture_v2`。本地Codex app-server的普通`turn/start`不是该生成/编辑链。

### 直接路由资格

`chatgpt.image-generation`是capability树顶层独立key，不因点号自动继承`chatgpt`或`chatgpt.seat-access`。

1. auth/account加载 → pending；已知ChatGPT认证但selected账号缺失、与authenticatedAccountId不一致或structure未定 → 不可用。
2. workspace才读取gate **1355972088**；未ready → pending；true → 当前账号settings.permissions必须含`chatgpt.workspace.feature.image-gen.access`；false不加该permission。personal不发此workspace请求。
3. gate **3683713372**真实true才检查default host的failClosed effective config。成功response.config中model_provider缺省openai，非openai不可用；读取失败不得拿fallback空对象假装openai已确认。
4. 使用真实ServiceIdentity、完整Statsig bootstrap、selected ShareAccounts结构与account/read认证/路由交叉核对；收尾复核account/user/generation。未知、格式错、partial/delta或身份不符不放行。
5. workspace settings需新增identity-derived固定`/backend-api/accounts/{selectedId}/settings`宿主白名单，renderer不得传任意账号或URL。

### Sidebar与product mode资格另算

primary::z_n的入口条件为`S && chatgpt.isCapable && imageGeneration.isCapable && !freeHoldout`：

- `S = JD || sidebarMode==='chatgpt'`。
- JD由initial CUn导出：gate **3085093835**不为true时false；开启后需Cv没有denied/unsupported-auth结果。不能据Codex模式断言永远没有图像，也不能把远端gate硬编码true。
- `chatgpt`能力还涉及allowed账号、gate **770071981**、部分企业/教育套餐的`desktop-app-chat.access` permission和default-host `in_app_chat` feature完整列表，不能用token存在代替。
- freeHoldout仅在allowed且free套餐、user flags.image_gen_holdout_active===true而settings.image_gen_enabled!==true时抑制入口；不直接等价于路由禁止。
- 当前本项目Codex-only头部、探索菜单“图像中心”静态入口不是官方资格证据。恢复入口前必须消费真实模式/能力；未确认不强开。

## 3. 三个只读请求与消费合同

| 操作 | 官方固定GET | 当前宿主操作与参数 |
|---|---|---|
| Catalog | `/images/init`，账号头，无query | `images_init`, `{}` → `/backend-api/images/init` |
| Styles | `/images/styles?include_image_suggestions=true`，账号头 | `images_styles`, `{include_image_suggestions:true}`；宿主缺省补true |
| My images | `/my/recent/image_gen` | `images_recent` → `/backend-api/my/recent/image_gen`；首批`{limit:25}`，后续`{limit:20,after:cursor}` |

**首批必须省略after，不能传after:null。** 当前和旧19C宿主通用参数编码仅接受after字符串，null会在取凭证前被拒绝。官方JS初始pageParam=null不等于传给本项目host的合法参数。

目录query key含account/user，staleTime/refetchInterval=300000ms，mount/focus/reconnect always，支持signal取消。历史staleTime=120000ms，mount always。先注册身份失效监听，成功后才准入/读取；监听失败要可见、可重试，不能静默继续。

### Catalog合并

- init/styles任一pending时groups未完成；init成功且groups缺失才按[]处理；未知格式不假装成功空目录。
- styles.image_suggestions非空时，用styles[].id找init.groups中第一个kind缺省或prompt_collection且items含style.id的组；仅替换该组items，不追加自造“热门模板”。
- 类别来自prompt_collection.items.section去重，空section代表trending。配置 **3939855767.section_order**须验证string[]，未列项后排；未知不发明固定顺序。
- 已证消费字段：group id/kind/title/presentation/items/action；item id/title/image_alt/image_url/image_variant_urls/image_variants/section/action/prompt_text。不是完整在线schema。
- partial error保留可读结果；“部分图像提示无法加载／重试”，重试重新读取两端。成功空：“从你的创意开始／描述你想创建的图像”。

### History

过滤is_archived，跨页同id保留首次；空中间页带cursor不得显示整库为空。保留已读项，分页错手动retry；cursor重复可见错误/停止，不无限循环。

output_blocked不请求图。thumbnail严格`encodings.thumbnail.path ?? url`，空path不回退。失败id仅按本次dataUpdatedAt隐藏，新刷新允许重试，不能永久本地删除或改云数据。

中文：“我的图像”“正在加载图像…”“你用 ChatGPT 创建的图像将显示在这里”“无法加载图像”“重试”。

## 4. 结构、配置与视觉合同

- suggestions::rn使用compact header，标题“图像”；JD分支true为extraWide/inline header，false为default/page header。extraWide上限1440px，default使用thread变量；不得统一强设960/1100px。
- **composer是bottom绝对定位浮层**，测量其高度为滚动内容补paddingBottom。不要依据旧错误文案“composer above”把它放顶部；max-w-3xl只用于reference picker，不代表整页宽度。
- picker打开时底层inert、遮罩/z-index变化；Escape关闭picker；底部输入框和最后卡片不能互相遮挡。
- 配置 **4161245824.my_images_tab_enabled**：true才把history加入类别tab；false在目录后独立history section。未知真实配置不能永远固定一条分支，更不能重复渲染两份。
- 类别是browse scrollable tabs，tabpanel与aria关联；“图像提示词类别”“热门”“模板”，其他标题服务返回。
- images目录固定grid5/gap2，home才grid4；pending15个4/5 rounded2xl skeleton，home12个。image_card/portrait为4/5带底部渐变文字；text_pill竖排gap2，icon_pill两列gap4/size12图标。未知presentation不全部猜成图片卡。
- My images实际masonry：容器1–6列，@sm/@xl/@3xl/@5xl/@7xl，测量最短列并保留assignment；gap3/sm gap4。历史卡自身square/rounded-xl，不能照搬Library原图比例布局。
- CSS原文--spacing=.25rem，composer bottom inset=spacing*4；rem公式不等于已测物理像素。颜色/字体/几何/窄窗须另取运行证据。
- zh包缺`imagesApp.myImages.tab`及`imagesApp.promptSections.loading.ariaLabel`。可将已证heading“我的图像”作为当前适配文字，但不能说缺失key已有官方中文。

## 5. 图片资源角色与失效边界

现主根具备三GET操作，但缺Images专属准入decoder、workspace固定路由、受控资源登记/bytes和真正ChatGPT写链。元数据GET成功不等于正常图片已显示。

- 宿主仅从真实init/styles/recent响应登记资源；绑定identity/generation与snapshot/requestId，opaque key/selector不能接受renderer任意URL、headers或method。
- 必须区分响应内role：init group、styles、image_suggestions、recent；不能仅靠id/group/variant查首条。styles与suggestions同id不同URL要能准确选择。
- 目录取首个非空image_url/variant_urls/variants，默认无认证；同域也不能因此擅附token。外域始终零认证，每跳复核网络/来源/代次。
- recent命名estuary/library源按官方JJ归一/auth标记；内部X-OpenAI-Attach-Auth不是给第三方的凭证。JSON thumbnail_url/content_url刷新与HTTP302需分别处理。
- blocked/archived不登记；最新拒绝应撤销旧key并覆盖下载中的资源和已缓存UI，不能被first-id去重吞掉。增加A下载中→B拒绝刷新→A返回的夹具；仅拒绝B之后新发起的旧key请求还不够。
- 限制体积/MIME、重定向次数及registry容量；淘汰时不能假成功。跨账号/取消/失效scope立刻遮蔽旧图。
- full preview优先可解析asset_pointer与原conversation来源；只有缩略图时明确有限预览。未恢复pointer/full、原始会话及来源校验前，不开放假编辑/下载/生成成功。

## 6. 旧19C可复用范围

[只读复用评估](../../../.ref/parity/19/actual/19E-images/reference/reuse-19C.md)。隔离树detached `bc1a1f390de840221ea5eb93d451633e6dcce9bf`，其中index还含16.18C，19C主要为working diff；不是可直接合入的独立提交。

可按函数迁移imagesData的合并/排序/first-id/nullish逻辑，imagesClient的身份与direct资格，旧组件的listener/epoch/取消/部分失败和limited preview；Rust opaque registry、workspace identity-derived路由与认证隔离骨架需适配当前主根。

**禁止整包合并、导出cached全补丁或覆盖旧共享文件。** 那会重复16.18C并覆盖主根后续Library/文件/共享服务成果。旧测试断言after:null是错误合同，不能沿旧通过结论放行。

迁移前须修：首recent参数；sidebar/布局配置分支；资源role碰撞；blocked in-flight与缓存撤销；JJ JSON刷新；原页只有普通grid、永远history tab、无底部composer壳的结构差距。既有测试源码不是本次运行通过证据。

### 开发前动态复现（2026-11-06）

`.ref/parity/19/actual/19E-images/verification/verify-19c-red.mjs`已实际执行未修改的旧19C `readImagesHistory→readImagesService→readChatgptService`链，显式离线bridge捕获首批确为`{limit:25,after:null}`；省略after合同失败，续页20/cursor对照通过。另执行实际`parseImagesHistory→mergeImagesHistory→imageThumbnail`：同ID**追加页**的blocked被first-id去重吞掉，archived先被parser过滤，均保留旧thumbnail；两项失败。

完整刷新以`append=false`替换pages时，这两类状态均通过，不能泛称“完整刷新仍保留旧图”。总计3红/3绿、实际退出1，完整源hash和6个函数定位在`19c-predevelopment-red.json`，执行前后旧源码hash不变。这些只证明数据层和请求构造；宿主下载中的失效、GUI缓存及真实Rust路由拒参仍需独立回归，未以静态猜测伪造通过或失败。

## 7. 开发顺序与验收用例

### 大图资源（当前 Store 补证）

Store `26.1103.4239.0`，asar SHA-256 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。`57123.7f2c0aec10.js` 45255 用 `encodings.thumbnail.path ?? url` 显示缩略图；点击后进入 `96508.6784f2f012.js` 159978 的 `ImagesHistoryPreview`。161725 处优先选择 `file-service://`、`sediment://` 指针，否则用该条历史的 `url`。`189497.6182e00931.js` 551314 的 `iqEK.V2` 解析前缀；`182735.bb2cb0d2af.js` 2979301 的 `taWv.Qt` 和 3535475 的 `hrUs` 把普通指针解析为带可选会话 ID 的文件下载请求。大图从服务原始历史条目发放受控授权，保留取消、账号、网络和撤销约束。

验收。目录仅取缩略图，打开时才取原图。分辨原图与缩略图，原图缺失或失败时显示对应状态。归档或拒绝撤销两个资源授权，包括正在读取的原图。先支持普通指针和受控直链；共享会话指针的特殊路由、准备中自动重试、原图超过既有 8 MiB 上限和编辑另行核对。

补证。`182735.bb2cb0d2af.js` 3535475 起的 `hrUs.fG` 对 inline 指针解析遇到 `status: "retry"` 时，按 500ms 起始、每次乘 1.6 向上取整、单次最多 4s 的节奏重查，等待窗口 15s、最多 9 次重查。仅文件指针的 JSON 解析适用。重查须复核同一授权与网络策略。重查不消耗资源重定向预算，取消或权限撤销后停止，403 等终止错误保持原语义。

预览翻页。`96508.6784f2f012.js` 161393 附近允许列表有后续游标时使用「下一张」，163453 的 `ed` 在已读范围内直接前进，末尾读取一页，只有仍在原预览时才选中新出现的第一项。当前验收同时覆盖重复点击、空页、关闭重开同图、归档或拒绝，以及末页禁用。传输错误沿用现有撤销保护与历史重试。

续页重试。该查看器 166819 附近把续页错误作为对话框内警告，简体中文为「无法加载更多图像。请再次点击“下一张图像”」。只对确定在宿主登记资源前结束的连接错误、超时、429 与服务端 5xx 保留原预览和同一个游标。停止自动尝试，显式点击后才重试。结构错误、账号变化、权限错误或可能已撤销授权的异常仍进入原有安全恢复。

原图保存合同。`96508.6784f2f012.js` 162147 附近根据图像加载、解码和阻断状态计算可用动作，174102 附近向共享查看器传递 `downloadSrc`，优先使用已取得的数据 URL。`930242.10b7b11b9a.js` 的 `KgMI` 与 `730496.79557d9b65.js` 22181 起的 `urzV.er` 将该源转换为 Blob 并交给 `workspaceFiles.saveStream`。建议文件名取标题或本地化时间，扩展名随文件类型，清理 Windows 非法字符与设备名。简体中文包 `1561.0f4c0bdc0f.js` 的 `imagePreview.downloadCurrent` 为「下载图像」。

下一验收单元复用原生图像保存能力，只有当前原图通过解码且仍可用时启用。仅传入该次已读原图字节，取消不写入，保存后读取核对，连续点击只打开一个对话框，旧图完成反馈不得出现在新图。普通原图之外的 GIF 帧导出、分享和编辑分别验证。

| 阶段/用例 | 开发目标与可检验预期 |
|---|---|
| E01 准入 | personal/workspace、gate真假未知、selected/auth账号不符、非openai条件、API-key/unsupported-auth、listener拒绝；未确认不读、不强开sidebar |
| E02 三GET | first recent省略after、next20/cursor；错误字段在auth前拒绝；账号代次变化取消，晚到结果不落新页面 |
| E03 Catalog | 双pending、两端分别失败、成功空、精确首组替换、未知group、配置顺序；错误不当空、无自造模板 |
| E04 History | first-id去重、空中间页、重复cursor、部分加载失败重试、archived/blocked、刷新恢复；已读项保留 |
| E05 资源 | 真实响应登记、role同id解歧、伪造key/URL拒绝、跨身份旧key拒绝、blocked零取图、下载中最新拒绝、缓存撤下、重定向外域零认证/回跳、JSON资源刷新、体积/MIME |
| E06 正常只读页 | compact壳、目录三presentation、15skeleton、真实卡片、history tab/section两分支、实际masonry；生成未接不伪造普通Codex composer或成功 |
| E07 预览 | 真实资源、blocked/加载/失败、上一/下一/重试、焦点/关闭；thumbnail与pointer/full范围明确 |
| E08 后续真实写链 | ChatGPT上传/模板strategy/input_requirements/picture_v2 metadata，只有onSubmitAccepted才换草稿/导航；真实限额和原会话编辑；先离线回放，不为本轮验收发付费模型动作 |
| E09 UI/原生/用户 | 隔离夹具宽窄、底部overlay与滚动不遮卡、真实解码/IME/焦点；同环境官方图/原生构建/用户验收分别完成，未跑不通过 |

每阶段先有意义回归，再改代码；共享host变化须回归当前Library/认证/下载消费者。最终按页面合同交付，不能以只读阶段缩小完整Images目标。

## 8. 未证与交付门槛

未证：当前真实账号的gate/config和可见性、上层shell全部控制、在线schema及URL/header分布、全部JJ与共享pin、真实ChatGPT写adapter、运行DPI/主题/缩放/像素、原生GUI/IME/焦点/图片解码、用户验收。

静态合同、隔离测试、构建和官方运行时证据分别记录。配对图缺失时visual score=null；未知功能不能标为通过。本规格保留开发前合同；当前实施与未验项见19E阶段记录，不宣称完整Images达到1:1。
