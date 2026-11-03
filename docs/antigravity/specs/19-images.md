# 19 Images：官方合同与开发边界

日期：2026-11-03。状态：调研完成，修改前合同；整页未开发完成、未通过官方运行时或像素验收。

## 基准与来源

固定官方包 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。该包带已知 offline 补丁，不能称未修改发行基准。所有提取按 header.integrity SHA256核对，来源大小与hash见 `../../../.ref/parity/19/reference/manifest.json`。共享大chunk仅保存有界片段，所有偏移为 **0-based UTF-16字符偏移**。

运行环境DPI/App缩放、账号能力、同条件截图仍未知；本轮只读包与协议schema，不读真实令牌、不请求云端、不触发付费生成。visual为not_executed/score:null。

本机 `codex --version` 为 `codex-cli 0.165.0`。使用已创建的隔离CODEX_HOME、空API key运行 `codex app-server generate-json-schema --experimental`，退出0；产物与hash见 `protocol-manifest.json`。这是协议形状证据，不是图像服务实测。

## 先区分三个不同工作面

1. **Images首页**：发现/模板、输入、上传参考图、My images。官方路由 `/images` → `Cms` → `$ms=hR(sEa)` → `page-9e69fcc0ace1.js::ImagesPage`；模板页 `prompt-page-route-e0369b12ad74.js`。同名 `images-5872911763fb.js` 实际是LaTeX图像资源，`images-86736df66026.js`是文档图片node view，不能据文件名误认首页。
2. **ChatGPT云端图库/历史**：官方 `My images` 调 `/my/recent/image_gen`，不是枚举当前app-server线程中的imageGeneration，也不是本地Library数组。
3. **app-server会话图像工具输出**：thread/turn中的 `imageGeneration` item，真实生成由后端工具和模型能力决定。可以正确消费和展示结果，不能用普通文本发送成功替代图像生成成功。

路由、真实lazy chunk、sidebar和schema渲染片段见 `entry-renderer.json`、`route-components.json`、`routing-protocol-anchors.json`。

## 首页与图库数据合同

| 对象/动作 | 官方静态合同 | 预期状态与验证 |
|---|---|---|
| 首页发现目录 | `GET /images/init`，ChatGPT-Account-ID，accountId/userId均非空才enabled | 返回groups；pending、error、成功空目录必须分开 |
| 样式/图片灵感 | `GET /images/styles`，query include_image_suggestions:true | 返回styles/image_suggestions；与init groups按ID合并，不能写死“热门模板” |
| 模板详情 | `GET /images/prompt-items/{item_id}`，lookup_mode:display，账号和语言头 | 404→不存在；其他错误可重试，不能静默当成功 |
| My images | `GET /my/recent/image_gen`，query limit首批25/后续20、after:cursor | 响应items/cursor；过滤is_archived，按id去重；query key含accountId/userId |
| 缩略图 | output_blocked时不加载；否则encodings.thumbnail.path优先，回退url，经受控asset resolver | 真实加载/解码错误，不能拿SVG占位冒充原图 |
| 选择图片 | 真实item.id进入ImagesHistoryScope，懒加载`preview-f6d3d996bf47.js::ImagesHistoryPreview` | 右侧预览、相邻图切换、失败/blocked状态 |
| 模板提交 | 真实group/item/action/input_requirements/strategy，记录image_prompt_id/group/presentation/image_send_uuid | 可能要求camera_or_gallery/styles/sketch/prompt_only，不是所有卡片都填文本 |
| 首页提交 | `page-9e69fcc0ace1.js::Xe`创建kind:chatgpt composer，hiddenSystemHint:picture_v2 | 复用ChatGPT composer/upload/限额路径；onSubmitAccepted后才清除选择、生成新首页草稿并导航会话 |

原始文件：`prompts-a5fbcec34b67.js`、`state-d342fd694aaa.js`、`page-9e69fcc0ace1.js`、`prompt-page-route-e0369b12ad74.js`。精确源码/偏移在 `history-suggestions-anchors.json`、`images-composer-contract.json`、`page-action-anchors.json`。

**身份依赖**：上述均是ChatGPT HTTP服务，accountId/userId分区。沿用18 Library已证实的官方共享请求客户端/宿主附加鉴权与完整性路径，当前仓库无可直接复用的完整桥；app-server的account/read不能替代该桥。

## 生成、编辑、取消和下载

### 官方云端创建

首页强制 `hiddenSystemHint:"picture_v2"`，kind为chatgpt。官方不是将自由文本直接送一个本地“生成”计时器，也没有从已追踪代码中证实固定1:1/16:9/9:16三按钮表单。旧 `ImagesView.tsx` 的比例state没有传给生成服务，属于无真实作用控件。

sidebar Images入口受 `b&&f.isCapable&&!r` 条件限定；其中共享ChatGPT能力、账户状态和gate必须实际满足，不强开。具体sidebar变量完整来源尚未追完，不能把这条布尔表达式解释成已确认的某个单一gate。

templates section_order还有dynamic config `3939855767`；image_gen限额来自blocked_features/limits_progress/重置时间。包中具备能力不证明当前账号可用。

### 云端编辑

`preview-f6d3d996bf47.js::it`：

- 要求当前图片有conversation_id和可解析asset_pointer。
- `GET /conversation/{conversation_id}`读取原始消息mapping；按message_id/asset来源找到completed生成图。
- 进入真实ChatGPT edit提交，带sourceConversationId与归因 `{imageSource:"generated",editEntryPoint:"images"}`；失败返回null，不制造成功。
- `app-initial::U6c`（`prepareChatGptImageEditOperation`）：有maskSrc先真实上传mask，operation为inpainting，含original_file_id/mask_file_id/original_gen_id；否则generation ID存在时构建transformation。普通“请修改这张图片”文本不等价于此合同。
- 身份变化/离页/卸载使AbortController失效，isSubmissionCurrent核对账号。预览的编辑提交中不能再按取消；不能宣称一键取消已开始的云端生成已经实现。

相关片段：`home-data-anchors.json`（U6c）、`history-edit-preview.json`；完整原始preview已提取。返回true/会话导航仅证明提交接受，最终图像仍以真实后端结果为准。

### 下载、复制、添加到聊天

- `generated-image-source-125d521edbfa.js`区分ChatGPT file-service/sediment、当前host本地文件、远程environment以及data:image源；预览src、下载src、dataUrl分别解析。
- `generated-image-context-menu-dfd8c6be92fd.js`从真实图像字节或受控资源下载，等待保存结果，失败显示downloadFailure；有路径时可打开文件位置。
- `copy-generated-image-to-clipboard-d543fe0cb03d.js`真实读取资源，必要时解码/转PNG，再ClipboardItem写入；不能用“已复制”toast代替结果。
- 添加到聊天前核模型image输入能力；引用真实图片/上传结果。生成图和当前图片不能跨会话/host错误引用。

## 当前app-server可真实实现的能力

现场schema的 `protocol-image-contract.json`：

```text
ThreadItem imageGeneration
required: id, status:string, type
anyOf: fileId:string 或 result:string（File在前，兼容同时带空result的rollout）
optional: savedPath, inputImages, revisedPrompt, transparentBackground, failure
failure当前可枚举: usageLimitExceeded {limitId, resetsAt?}
```

官方共享 `app-shared::Rz`优先savedPath，回退result；`q0t`支持本地绝对路径、data:image/https/file/app/@fs，其他非空result视为PNG base64。`generated-image-output-visibility`区分已有src与仍in_progress占位；中断不会凭空变成完成图像。

本机新生成的ClientRequest中**没有独立image生成/编辑请求方法**，TurnStartParams也没有可直接强制`image_generation`/aspect_ratio/mask的专门字段。ThreadStartParams.config的存在不证明可以随意创造图像控制参数。协议支持image/localImage输入，这只是图像输入能力。

可立即真正开发：

1. 撤销1200ms后插入SVG、默认示例、“生成完成”假成功与无效比例选择。
2. 真实 `item/started` / `item/completed` /线程恢复的imageGeneration消费者：保存同一个item.id，处理pending→真实结果、失败/限额、中断和晚到事件，正确渲染savedPath或result。
3. 对已获得的真实本地/inline生成结果实现预览、复制/保存和添加输入。只在保存/复制确实完成后提示。
4. 主会话已有turn/start、turn/interrupt和模型读取，可以复用真实会话请求与停止；但没有能力选择合同和真实item结果前，这个入口只能称“发送图像请求到会话”，不得称“官方Images生成已实现”。

不能现阶段声称已实现：

- ChatGPT账号云端My images/init/styles目录与官方模板。
- picture_v2/云端ChatGPT编辑与inpainting、挂载云端生成图库/分享/收藏。
- 任意账号/模型都能生成、固定比例/格式/数量可控。
- 仅文本响应、turn/completed、线程创建成功等于图像生成完成。

如果继续做app-server结果消费者，它属于真实可复用基础能力，应单独标范围，不能用它代替Images首页服务闭环。

## 修改前验收用例

| ID | 场景与操作 | 必须结果 |
|---|---|---|
| IM01 | 未接服务打开Images | 不显示默认SVG示例，不宣称空云图库已读取，不出现假生成成功 |
| IM02 | 服务可用加载init/styles/history及切账号 | 正确HTTP参数、取消与账号隔离；loading/error/empty区别；不混入旧账号图像 |
| IM03 | 首页/模板提交 | picture_v2、模板真实动作与上传依赖准确；接受后导航；失败保稿 |
| IM04 | 回放真实imageGeneration样本 | savedPath/result来源规范；同id更新；pending/failure/完成与空结果分明 |
| IM05 | 回放中断/usageLimitExceeded/晚到 | 不出现无结果的成功图；限额与重置提示正确；不跨线程污染 |
| IM06 | 对真实结果执行预览/复制/下载 | 字节、MIME/扩展名和保存结果正确；资源丢失/解码错误可见 |
| IM07 | 云端编辑含mask/身份变化 | 原始来源定位、mask上传与operation准确；中断/失败不伪成功 |
| IM08 | 官方与当前同条件截图/原生操作 | 首页、My images、preview、progress/error/menu测量；本轮未执行 |

IM01、IM04–IM06可推进产品工作；IM02/IM03/IM07需认证服务/真实账号能力，IM08需官方运行时同条件证据。所有mock/replay通过只证明消费已知样本，不能冒充真实图像模型集成通过。

## 修改前实现差距（2026-11-03取证时）

`src/components/ImagesView.tsx`当前默认两个SVG示例，handleGenerate用1200ms setTimeout生成文本SVG，所有比例共用固定400×400，无实际云端请求；storage_stats_get与官方图库无关。`src/App.tsx::renderImage`当前只展示path/savedPath文件名，忽略base64 result和真实预览，失败只看message而漏usageLimitExceeded字段。不能以页面存在、能点生成或构建通过验收。

上述为修改前取证记录；后续限定实现与验证见19A验收记录，未将整页标为已验收。

## 2026-11-03 本轮修改前范围

IM01撤下假首页数据/定时生成及丢弃图像的“带图聊天”回调；显示服务未连接。IM04/IM05补真实会话图像结果消费：savedPath优先，兼容result数据URI/URL/绝对路径/PNG base64；pending、failed、interrupted、限额、空结果分离，原生本地路径复用既有文件预览。新CLI允许仅fileId的变体，该变体缺少附件读取桥时显式提示不可读取，不伪造图像。仅提供真实inline结果预览，不把普通turn/start冒充Images首页生成。IM06下载/复制/原生保存与云端My images不在本轮通过范围。

## 19B 图片保存：修改前合同（2026-11-03）

依据已核原包generated-image-context-menu-dfd8c6be92fd.js的SAVE_FILE分支：先解析真实downloadSrc/本地资源，再await下载结果，失败显示imageSidePanel.downloadFailure。此处实现真实会话图像的本地保存，不是云端Images编辑器。

- IS01：仅实际completed且具有可解析src/path的结果提供保存。获取真实字节后交给原生保存对话框，不将路径/URL文字当图片文件内容。
- IS02：原生对话框取消返回null，不写文件，不显示保存成功；重复点击单飞。
- IS03：PNG/JPEG/GIF/WebP按真实字节签名选择扩展名；不伪造SVG或将服务错误HTML保存为图片。保存失败可见；成功前写入并读回字节核对。
- IS04：本地路径复用fs/readFile，inline/HTTP(S)复用浏览器fetch；HTTP/CORS/资源失效均保留真实错误，不伪代理成功。fileId/官方host scheme不在本增量支持范围。
- IS05：回归涵盖生产保存动作、真实字节、取消、失败、重复点击、旧source结果不覆盖新source；Rust隔离目录验证读回/签名/取消。原生对话框与同条件像素仍需另验，不由adapter回归代替。

不新增依赖，复用现有base64/rfd/fs协议；不实现未获依据的云端保存/迁移。命名、原生对话框外观和官方完整来源适配仍登记差异。
