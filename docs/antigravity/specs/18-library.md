# 18 Library 原包合同与服务边界

2026-11-03。先从固定asar直接提取四个library页面/action chunk并核integrity，见.ref/parity/18/reference。静态发现Favorites/Suggested/Folders/All与Images过滤、provider和uploads、pages批量操作及部分删除失败提示。library-page-actions会读取accountId/userId并动态调用downloadPageMarkdown；这些均不支持“本地数组等于官方资料库”的旧假设。

修改前LibraryView默认架构说明/SVG/benchmarks为演示数据，localStorage收藏/创建/删除不能证明官方服务结果。先完成以下provider/服务及动作合同取证，再按LB01撤销演示内容与假写入；LB02–LB06真实认证服务仍未实现。原包import名字不作为云端读写已实现证据。

## 2026-11-03 静态数据合同补证

本节是修改前合同。所有接口来自固定原包，只证明客户端静态实现，不证明当前账号、当前服务或我们的应用可以调用。原包含已知 offline 补丁，不能当作未修改发行包。未读取令牌、未发云端请求、未修改用户资料库。

引用数字统一是 **0-based UTF-16 字符偏移**。新增原始 chunk、来源 hash/size 见 `../../../.ref/parity/18/reference/manifest.json`；共享大文件只保存有界片段，不重复写入整包。

### 身份与服务边界

- `library-provider-832e9d2780a4.js` 的 `zt`：访问状态 loading 时显示加载；状态不是 allowed 或 accountId 为空时显示 `libraryNext.access.denied`，英文默认文案 `Sign in to ChatGPT to open your Library`。本节没有核对中文语言包，不据此自造“官方中文”。
- `app-initial-fd3c4b862660.js` 的 `TJ=pa("LibraryScope",...)`：scope 用 accountId/userId 分区，query key 也包含它们。`Opa` 创建请求客户端，附 `ChatGPT-Account-ID`；`jJ` 按当前账号取实例。账号变化后旧请求不能污染新账号。
- `app-shared-a906948d8868.js:3292609` 的 `$mn=class`：safeGet/Post/Patch/Delete 经共享 `vU` fetch 层，保留 signal、assertRequestCurrent、expectedIdentity。不是 app-server 的 thread RPC。
- 同文件 `3596102` 的 `LFn`：默认头包括 `X-OpenAI-Attach-Auth: 1`、`X-OpenAI-Attach-Integrity-State: 1`，按平台能力补 desktop/device 标记。它们是让官方宿主附加鉴权的标志，不能将标志本身当 Bearer token。
- `vU=class` 的宿主 fetch/取消/响应和通用 fetch 路径有区别；本轮没有完整追完宿主鉴权实现，不能宣称只加请求头即可复用官方认证。
- 当前仓库 `src-tauri/src/app_server.rs::call` 仅转发 app-server RPC；`src/config.ts::account/read` 提供账号元数据。检索当前 `src`/`src-tauri/src` 未找到等价、可用于 Library 的 ChatGPT HTTP 鉴权/完整性桥。登录状态存在不等于 Library 服务已连接。

结论：**当前没有现成可直接复用的完整认证桥**。最小真实云端实现至少需要一个限定 Library 路由、按账号隔离、有取消和错误处理的认证 HTTP 传输，然后才能接列表；不应通过复制用户令牌、虚构 RPC、读取本地演示数组规避这个缺口。当前可立即实施的纠偏是撤下演示内容和假写入口，明确服务未连接；这是增量纠偏，不能算资料库完成。

### 列表、筛选与对象形状

入口 `app-initial:2549004` 的 `yJn` 按 deleted、pageCollection、favorites、搜索、目录、tab 分派，不能所有 tab 都使用同一本地筛选器：

| 场景 | 静态请求合同 | 返回/客户端行为 |
|---|---|---|
| 收藏顶层 | `GET /files/library/favorites`，query `cursor?`, `limit:50` | `items`, `cursor`；只呈现 availability=available 且 item 非空项；保存 favorite 元数据。搜索/类型再按真实 item 过滤 |
| All/Folders/目录 | `GET /files/library/nodes` | query 含 parent_directory_id、cursor、q、categories、source、include_hidden_files、include_files、include_saved_entities、include_provider_roots、include_pages、include_sites:false、include_folder_counts、include_onedrive、hydrate_folder_thumbnails:true；items 是 node，保留 cursor |
| Suggested/Trash/部分Recent | `POST /files/library` | body limit:50、cursor、q/categories/source、trashed_only、providers/external_account_keys、include_*、ranking 分支；不是静态“推荐”标签 |
| 聚合搜索 | `POST /global/search`，可走 streaming 分支 | body query、query_id、cursor、limit:20、entrypoint:library_page、scope、source_requests；处理 partial_results/source_statuses；Library、Pages、provider 结果形状不同 |
| Page集合 | `GET /pages/catalog` | cursor、limit:50、include_shared_with_me、order_by:last_used_at；返回 next_cursor、items，受 access_kind/open.kind 限定 |
| 路径 | `GET /files/library/directories/path` | query directory_id；items 含 is_root，支持面包屑/根目录 |

`DJn` / `jJn` 原始有界片段分别在 `library-data-auth-contract.json` 的 `2555616` / `2557874`；`yJn`、收藏和搜索在 `library-core-contract.json`。相同混淆函数名在另一个文件中可能完全无关，必须同时记录文件和锚点。

node 至少消费 id、kind(file/directory)、name、parent_directory_id、file_id、library_artifact_type、mime_type、file_size_bytes、record_creation_time、updated_at、external_account、cloud_doc_url、page_metadata、saved_entity 等。旧 POST 结果通过 `MJn` 将 file_name→name、directory_id→parent_directory_id；不能假定所有响应字段相同。

provider 包含 native/native_shared/google_drive/box/dropbox/sharepoint/onedrive；可见账号、挂载权限和 gate 决定实际可用。`183402703`、`3001618585`、`3583034603` 等静态分支存在，不能为复刻强开。分页避免重复 cursor；失效游标/搜索中断不应伪装空列表。

### 写动作、上传与下载

| 动作 | 官方静态合同与必须核验的结果 |
|---|---|
| 收藏/取消 | `POST /files/library/favorites` body target_ref:{type:library_file,library_file_id} → favorite_id；`DELETE /files/library/favorites/{favorite_id}`；状态 `POST /files/library/favorites/status` body target_refs，检查 availability/favorite；不是翻转本地 boolean |
| 新目录 | `POST /files/library/directories` body name.trim()/parent_directory_id；409 显示冲突，保留输入 |
| 重命名 | PATCH directories/{directory_id} body name；PATCH files/{library_file_id} body file_name；响应更新实际节点，按旧身份核对后更新缓存 |
| 删除 | DELETE directories/{directory_id} 或 files/{library_file_id}；文件 query file_id/parent_directory_id/file_name/soft_delete；要求 success |
| 批量删除 | POST files/library/files/delete-batch，body files:[{library_file_id,file_id,parent_directory_id,file_name}]，每批25；仅逐项 success 才移除；部分失败需保留并提示 |
| 恢复/移动 | POST files/{library_file_id}/restore；PATCH directories/{directory_id} parent_directory_id 或 files/{library_file_id}/move body directory_id，后者检查 success |
| 上传 | `Ujo`→`Fhn`，限制隐藏文件名、512 MiB、身份变化；最多5并发，queued/uploading/processing/success/failed；原生Library要求 storeInLibrary:true/libraryPersistenceMode:required/uploadPurpose:library。`POST /files` 获取 file_id/upload_url/upload_headers/strategy，再真实传字节、完成/处理；不能只创建本地条目或只拿上传地址就称成功 |
| 外部provider上传 | 需已挂载账号/目录权限，uploadSource分支，必要时 POST `/files/library/files` body parent_directory_id/file_id/file_name/mime_type；存在不能盲目重试的阶段 |
| 文件下载 | library-file-download 经 `$Cn`/`H3t`。Library ID 使用 GET `/files/library/files/{library_file_id}/content_url` 或 `/download_url`；挂载文件先 POST `/files/library/mounted/materialize`；有 requestHeaders 则取字节后下载，不能任意把URL当外链打开 |
| Page下载 | GET `/pages/{page_id}` query include_content:true/include_document_bootstrap:false，检查 page/can_read/content，保存 UTF8 markdown；有15秒超时、身份取消、失败提示 |
| Page批量删除 | 独立 actions chunk，按祖先顺序，排除 request_changes，部分删除提示检查Trash；不能当普通文件DELETE |

上述文件路径省略前缀的条目均位于 `/files/library/`。原始动作见 `library-item-actions-d75eb3ebf7f1.js`；上传有界片段见 `library-auth-upload-anchors.json`、`library-data-auth-contract.json`。

### 开发验收合同

| ID | 等价场景/操作 | 必须观察的结果 |
|---|---|---|
| LB01 | 未建立Library认证桥进入页面 | 明确服务未连接；不展示演示文件、不显示假空库成功、不产生本地“删除/收藏成功” |
| LB02 | 真实服务连接后冷启动/失败/重试 | 加载→真实列表或可见错误；失败不归类空列表；重试发真实请求 |
| LB03 | tab/搜索/目录/Images切换 | 参数匹配上表分派、取消旧请求、分页结果不跨场景污染 |
| LB04 | 收藏/删除/移动/重命名 | 服务确认后回读；拒绝/部分失败保留正确项；账号变化隔离 |
| LB05 | 上传含失败/重试/离页 | 真实字节和服务完成确认；阶段、并发和取消可追踪；不能以定时器生成成功 |
| LB06 | 下载Page/文件/挂载文件 | 实际保存字节/文件名正确，权限拒绝可见，取消不提示成功 |
| LB07 | 同版本、同尺寸官方对照 | loading/denied/error/empty/list/grid/menu/preview 逐状态对比；本轮未执行，visual score:null |

LB01 可以先交付限定增量；LB02–LB06 依赖真实认证桥、服务和账号能力。没有这些证据时整页必须保持未完成。官方运行时、中文原文、原生文件对话框与同条件像素均尚未验证。

18A实施：LB01撤下默认架构说明/SVG/benchmarks、随机假上传、本地创建/收藏/删除成功及伪引用回调；不读取、覆盖或删除旧codex_library_items。页面明确服务未连接，不推断账号权限或空库。LB02–LB07仍未通过；完整页面外部依赖阻塞。
