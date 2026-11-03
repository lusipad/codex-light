# 23：会话静态快照分享实施前置

日期：2026-11-03。范围：官方分享快照的数据转换、脱敏、资产上传、发布、取消与身份边界，以及现有 HTTP 桥可复用范围。

状态：**只读调研；未开发；未进行原生验收；未进行真实 HTTP 验收；未获用户验收。** 本文不代表 23 单元完成，不以复制深链、只读请求或模拟上传代替完整分享。

后续状态（2026-11-03）：23E 已按本文实施内部准备/宿主事务，见[23E验收记录](../acceptance/23E.md)。本文以上状态保留原调研时点；不表示当前仍无任何代码，也不表示分享入口已完成。

23F 后续接线：真实权限读取、受约束资产 reader、分享 IPC 和弹窗已实现，记录见[23F](../acceptance/23F.md)、[访问和界面合同](23-share-access-ui.md)、[本地资产合同](23-share-local-assets.md)。下文“未接 UI/reader”等为 23E 时点限制，已接线部分由 23F 替代；完整 Markdown/图片预览、真实服务、原生和像素仍未验收。

## 1. 基准与证据口径

- 官方候选版本：26.928.21956 / build 12404；版本信息沿用仓库锁定候选，本轮没有运行官方 UI 核实。
- 本轮重新核验的安装包：`C:/Users/lus/Codex/_internal/app/resources/app.asar`。
- SHA-256：`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
- 包内存在 `codex-offline` 补丁，静态存在不能证明真实账号 feature gate、服务权限或运行可用性。
- 本轮未改产品代码、未发网络请求、未读取凭据、未运行官方 UI。
- 下列偏移均为 **0-based UTF-16**：UTF-8 文件读为 JavaScript 字符串后用 `indexOf` / `slice` 定位，不是字节偏移或行号。
- `share-thread-d5a88d0b0559.js`、`app-primary-84ad97f06929.js` 来自 `.ref/scratch/files/`。缺失的 snapshot、asset-reference、app-shared chunk 从 asar 直接读入内存，没有新增提取文件。
- 此包内容区起点为 `8 + header.readUInt32LE(4)`，不能使用旧提取脚本的 `16 + jsonSize`；两者在此包差 1 字节。

| 原始 chunk | SHA-256 |
|---|---|
| `share-thread-d5a88d0b0559.js` | `d98b18d0838f26a2dd8b7fc4e64a9e0ee4cc60cb38b97990291efed318aa34b7` |
| `shared-codex-snapshot-ee951c3aa36d.js` | `f66337dd2fb0a045d8e02e5e6c3092593052b5c80be98b3f09b74c61b8beff5c` |
| `shared-snapshot-asset-reference-33214426cc96.js` | `e4a0622a343646d7b3dec5593bd3fafe6683d873d3186aca90cc4638ee82addf` |

## 2. Snapshot 白名单结构

官方路径：`webview/assets/shared-codex-snapshot-ee951c3aa36d.js`。

| UTF-16 偏移 | 检索锚点 | 含义 |
|---:|---|---|
| 587 | `function he(e)` | 按原 turn/item 顺序采资产候选 |
| 1586 | `function k(e,t,n)` | 构建 snapshot |
| 2155 | `function A(e,t,n)` | 按 item 类型转换 |
| 3229 | `function j(e)` | 用户消息与特定 functionCallOutput 输入转换 |
| 3393 | `function M(e,t,n)` | 用户输入清洗及 handoff 信息处理 |
| 3796 | `function F(e,t)` | 指令过滤及 inline visualization 重写 |
| 5578 | `function _e(e,t)` | 文件路径转换 |
| 5821 | `function ve(e)` | diff 头过滤 |
| 6148 | `H=` | 不可用资产 sentinel 与 URL schema |
| 6881 | `Q=a(` | strict snapshot schema |

静态 schema 可表达为：

```ts
type AssetRef = `codex:shared-asset/${string}`;
type Unavailable = "codex:shared-image-unavailable";

type Snapshot = {
  version: 1;
  title?: string;
  assets?: Record<string, { height: number; width: number }>;
  turns: Array<{
    items: Array<
      | {
          type: "userMessage";
          content: (
            | { type: "text"; text: string }
            | { type: "image"; url: AssetRef | Unavailable }
          )[];
        }
      | {
          type: "agentMessage";
          text: string;
          phase?: "commentary" | "final_answer";
        }
      | { type: "reasoning"; summary: string }
      | {
          type: "fileChange";
          status: "completed";
          changes: { path?: string; diff: string }[];
        }
      | { type: "imageView"; url: AssetRef | Unavailable }
      | {
          type: "imageGeneration";
          status: "completed";
          result: AssetRef | Unavailable;
        }
    >;
    durationMs?: number;
  }>;
};
```

所有 object schema 均 strict；dimension 为正整数，duration 非负，version 必须为 1。实际构建不携带 threadId、turnId、cwd、完整协议 item、工具结果和时间戳。空转换 turn 被排除。

`function k` 的有界片段：

```js
return{title:e.name??void 0,version:1,...Object.keys(r).length===0?{}:{assets:r},turns:e.turns.flatMap(n=>{let r=n.items.flatMap(n=>A(n,e.cwd,t));if(r.length===0)return[];let i=r.some(e=>e.type===`reasoning`||e.type===`agentMessage`&&e.phase===`commentary`),a=n.durationMs??(n.startedAt!=null&&n.completedAt!=null?(n.completedAt-n.startedAt)*1e3:null);return[{items:r,...i&&a!=null&&Number.isFinite(a)&&a>=0?{durationMs:a}:{}}]})}
```

转换合同：

- agentMessage 只保留 commentary/final_answer；reasoning 使用 summary。
- fileChange failed/declined 排除，其余支持的变化转换为 completed；只保留 path/diff。特定不支持变化还会被导入的判定函数排除，其完整规则待补。
- 工作区内绝对路径变相对路径；外部绝对路径退化为 basename。不能直接把原协议完整路径上传。
- diff 去掉 `diff --git`、`index`、`---`、`+++`、mode/rename 等头；add/delete 分别给内容行补 `+`/`-`。
- 普通 codexDirective 删除。`codex-inline-vis` 仅在资产成功映射时改写为 `file="<assetId>.html" asset="codex:shared-asset/<id>"`，只保留 title/mode/expandable 字符串属性。
- 用户输入经过官方清洗/unwrap，handoff sourceThreadId 置空。导入的清洗函数尚未逐个还原，不能以简单 trim 声称完全等价。
- Markdown 图片及 reference 图片改为资产引用；缺失资产使用 sentinel，不继续发布原本的本地/远程图片 URL。
- 含 reasoning 或 commentary 的 turn 才可能附带 durationMs；优先原 durationMs，否则使用 startedAt/completedAt 秒差乘 1000，且要求有限、非负。

资产引用文件 `webview/assets/shared-snapshot-asset-reference-33214426cc96.js`：

```js
// UTF-16 @423
function i(e){return`${s}${e}`}
// UTF-16 @454
function a(e){if(!e.startsWith(s))return null;let t=e.slice(19);return c.test(t)?t:null}
// 常量
s=`codex:shared-asset/`
c=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
```

snapshot URL schema 将 data URL 转为 `codex:shared-image-unavailable`；有效 URL 只能为该 sentinel 或合法资产引用。

## 3. 脱敏合同及限制

文件 `.ref/scratch/files/app-primary-84ad97f06929.js`：

- UTF-16 @316238：`redactedSnapshot` 结果字段；向前定位 `function XHe(e)`。
- @316000–319000：递归、匹配区间合并和替换算法。
- @319000–324100：规则集。
- @2297037：`XHe as kh` 导出，证明分享文件导入的 `Ae` 对应此函数。

```js
function XHe(e){let t=0,n=ZI(e,e=>{let n=QHe(e);return t+=n.findingCount,n.redactedText});return{findingCount:t,redactedSnapshot:n}}
function ZI(e,t){return typeof e==`string`?t(e):Array.isArray(e)?e.map(e=>ZI(e,t)):ZHe(e)?Object.fromEntries(Object.entries(e).map(([e,n])=>[e,ZI(n,t)])):e}
```

递归所有字符串值，不改 object key。匹配区间合并后替换为 `<SECRET>`。规则含私钥、常见服务 token、环境变量式 secret 赋值、Authorization Bearer/Basic、带密码连接串、带 token/sig/Amz 签名 URL，并有长度、占位符和字符复杂度过滤。data image base64 字符串特意跳过。

分享文件 UTF-16 @5439 `function gt`：

1. 原 snapshot JSON UTF-8 字节数超过 10MiB 则拒绝。
2. 对 snapshot 执行 `Ae(o)`，得到 redactedSnapshot。
3. 再次 JSON 序列化并检查脱敏后 10MiB 限额。
4. 真正 PUT 的是脱敏 JSON。

限制必须公开记录：

- assets 参数独立上传，未经过 `Ae`；图片字节和 visualization HTML 未经过此递归字符串脱敏器。
- 不能宣称“所有共享内容均已自动清除机密”。静态证据只支持 snapshot 字符串有启发式脱敏。
- 分享文件 @22700 的预览由未脱敏 snapshot 截前 4 个非空 turn，且仅留用户、非 commentary assistant 和图片项；不是上传全文的保证性审核视图。

## 4. 资产来源与限额

snapshot chunk @587 `he`：按原 turn/item 顺序采候选，以 `kind + "\0" + source` 去重：

- 用户文本 Markdown 图片、localImage.path、image.url。
- commentary/final_answer Markdown 图片及 inline visualization path/file。
- reasoning summary Markdown 图片。
- imageView.path。
- completed imageGeneration 的真实 src。

分享 chunk 锚点：

| UTF-16 偏移 | 锚点 | 合同 |
|---:|---|---|
| 1634 | `function at(` | 只取候选最后 64 项；采集并发 4 |
| 3173 | `function ot(` | 数量、类型、引用与大小校验 |
| 3647 | `function st(` | 读取 visualization |
| 4053 | `function ct(` | 图片来源与读取 |
| 4978 附近 | `function ht()` | 64 项、单项 25MiB、总计 100MiB、并发 4 |

visualization 经宿主 `S.visualizations.read({hostId,path,threadId})` 读取 contents，UTF-8 编码后按 application/octet-stream 上传。

图片读取顺序：

1. data image 解 base64。
2. HTTP(S) 先经导入的 `xe(url)` 安全校验，再 fetch；`credentials:"omit"`、`redirect:"error"`，Content-Length 与逐块读取均检查 25MiB。
3. 本地/相对路径转换后使用带 hostId/threadId 的读取器；未知 scheme 不当本地路径。
4. MIME 仅支持 png/jpeg/jpg/webp/gif/avif。
5. 按逆序遍历保留资产以约束总体 100MiB，超限项排除；最终分配 asset-1、asset-2 等 ID。
6. 图片可解码时补 width/height，只有维度元数据进入 snapshot.assets。

未知：`xe` 的完整远程 URL 安全策略及图片读取器的 host/path 许可细节。实施前需补，不得用允许任意 URL 的替代实现。

## 5. HTTP 请求、响应与上传 manifest

以下是代码消费形状，不是已真实验证的服务 response schema。服务 routing/base URL 的最终组合仍需对照 HTTP 底层；不得仅凭 `/wham` 字符串任意拼生产域名。

### 5.1 申请目标与 snapshot 上传

分享 chunk @5439 `gt`：

```http
POST /wham/shared_threads/upload_urls
```

```json
{
  "snapshot": { "size": 123, "version": 1 },
  "assets": [
    { "asset_id": "asset-1", "mime_type": "image/png", "size": 123 }
  ]
}
```

snapshot.size 是脱敏 JSON 的 UTF-8 字节数；无资产则省略 assets。

消费的最小 response：

```ts
type UploadTarget = {
  upload_url: string;
  headers: Record<string, string>;
  etag: string;
  file_id: string;
};
type UploadTargets = {
  snapshot: UploadTarget;
  assets?: (UploadTarget & { asset_id: string })[];
};
```

必填/可选性和额外字段尚未从服务 strict schema 或真实响应确认。

snapshot PUT：

- URL 来自 upload_url。
- 使用目标返回 headers；缺 Content-Type 时补 application/json。
- body 为脱敏 JSON 字符串。
- 成功后 cancel response body。

assets PUT（@6987 `vt`）：

- body 为 base64 解码的原始字节。
- 使用目标 headers，覆盖 Content-Type 为资产 mime_type。
- 发布用 etag/file_id 来自 upload_urls 返回值，不是从 PUT body 解析。
- 返回 targets 必须与输入 asset_id 一一对应；缺失、重复或额外目标拒绝。

@8500 附近返回：

```ts
type UploadedSnapshot = {
  snapshot: { etag: string; file_id: string };
  assets?: { asset_id: string; etag: string; file_id: string }[];
};
```

### 5.2 资产重试

@6987 `vt`：

- 并发 4，最多 3 轮。
- 只重试失败资产，已成功项不重传。
- 每轮重新 POST upload_urls，body 只有失败资产的 asset_id/mime_type/size。
- 4xx 除 403/408/410/429 外立即失败；其他符合条件的错误进入重试。
- 替换失败资产的 target，最终保留各资产实际成功目标的 manifest。
- snapshot PUT 没有这一层资产重试循环。

### 5.3 发布

@6776 `_t`：

```http
POST /wham/shared_threads
```

```json
{
  "snapshot": { "etag": "...", "file_id": "..." },
  "assets": [{ "asset_id": "asset-1", "etag": "...", "file_id": "..." }],
  "access": "invited",
  "principals": [{ "principal_id": "...", "principal_type": "user" }]
}
```

- assets/access/principals 根据调用是否提供省略。
- dialog 支持 public/workspace/invited；用户 principal_id 来自 account_user_id，组来自 group.id，不能用邮箱或本项目 ID 顶替。
- @20800 消费 `{share_id,share_url}`，设置 ready，再复制 share_url。
- 工具入口 @19000 只取 share_url，未显式提供 access/principals；服务默认值未知，不能用它推断 UI audience 默认。
- share_url 必须来自服务响应，不能本地猜地址。
- 通用 POST 重试、idempotency 和结果未知时的恢复合同尚未确认；不能直接套 GET 自动重放。

## 6. 完整读取、Abort 与身份隔离

分享 chunk @24800 `It`：

- 绑定 hostId/conversationId，读取完整真实历史。
- ephemeral side conversation 有独立内存转换路径，仅 accepted steeringUserMessage 转用户消息。
- 先 thread/read(includeTurns:false)；本地非 paginated 可再 includeTurns:true。
- 分页 thread/turns/list 使用 limit 5、asc、itemsView full，直到 nextCursor 为空。
- 本地超大解码失败存在 fallback；不能用 renderer 当前已加载的部分 turns 代替完整历史。

@19900、20800、21600：

- 每 session 一个 AbortController，各读取、采集、上传及发布阶段检查 signal。
- 关闭 revoke 所有预览 object URL；未 ready 则 abort；ready 已发布不因关闭撤销。
- prepared 关闭无删除已上传 blob 的静态证据。
- 读取/上传失败置 error；发布失败从 creating 回 prepared，保留 manifest。
- 已发布但复制失败保留 ready/shareUrl，重试仅复制，不再次发布。
- 取消不能证明服务端已执行的写入被撤销，尤其发布响应晚到/丢失场景。

`app-shared-a906948d8868.js` @3293310 `makeRequest` 支持并透传 expectedIdentity/assertRequestCurrent；@3296882 safePost 转 post。但分享 session 调用未显式传这两项，仅传 signal；底层默认身份快照行为未完整确认，不能声称官方所有账号切换竞态已由这些字段覆盖。

本项目实施应将 expected identity（accountId/userId/generation）与 hostId/threadId 绑定分享事务，每个上传/发布前后核对；身份变化取消并拒绝晚到结果。发布结果未知单列状态，不盲重试或假成功。

## 7. 当前 HTTP 桥能力与缺口

源码：`src-tauri/src/chatgpt_service.rs`。这是本轮读取时的行号，后续以符号锚点为准。

| 位置/符号 | 已有能力 | 分享适配边界 |
|---|---|---|
| :19 ServiceIdentity | account_id/user_id/generation | 可复用事务身份 |
| :27 ServiceOperation | 固定只读路由白名单 | 无分享路由，需明确新增写 operation |
| :193 invalidate | generation 增量、取消 active、清 credentials | 可复用账号失效 |
| :211 cancel / :233 register | cancel-before-start、重复 ID 拒绝 | 可复用取消注册 |
| :477 read_with | 身份检查、串行 session、401 refresh | 不应直接把写入放入 GET 重放循环 |
| :810 resolve_route | 参数先验证再取认证 | 分享固定 endpoint 保持同样边界 |
| :1055 build_http_request | 宿主添加认证、account、routing、integrity | 可复用服务 POST 认证，不向 renderer 返回 token |
| :1045 HttpRequest | 仅 url/headers | 缺 method/body |
| :1210 Transport / :1221 send_bounded | transport、超时、取消 | 可扩有界请求体 |
| :1262 curl_request | curl 写死 GET，stdin 承载 config | 不支持 POST/二进制；不能不加设计混用 config 和 body |
| decode_response | 2xx 后必须解析 JSON | PUT 空 body 需独立成功处理 |
| :13 MAX_RESPONSE | 8MiB 响应限制 | 不能充当上传限额 |
| `src-tauri/src/lib.rs:230` | chatgpt_service_cancel command | 可复用取消入口 |

预签名 PUT 应单独构造：仅接受宿主由 upload_urls 得到、绑定当前 session 的 target；只转允许的目标 headers 与 Content-Type，不附 ChatGPT Authorization/account/integrity。不得开放 renderer 任意 URL/headers/bytes 的通用上传代理。具体目标域名或底层校验规则尚待证据，不能猜域名白名单。

## 8. 实施及验收顺序

1. **纯转换合同**：strict Snapshot 与 manifest；fixture 覆盖六类 item、排除项、路径/diff、Markdown/reference 图片、inline visualization、unavailable、duration。成功条件：从完整 thread 得到确定输出，无完整协议对象或绝对路径泄漏。
2. **脱敏与大小**：合成假密钥测试 nested 值、重叠规则、placeholder、title/path/diff、UTF-8 10MiB 前后限制；明确不处理资产字节。少量正则通过不能代表完整官方等价。
3. **宿主 transport**：固定 JSON POST、session-owned 二进制 PUT；验证身份、取消、空响应、重定向拒绝、PUT 无凭据、目标对应校验，保留既有 GET 回归。
4. **准备事务**：真实完整读取、采集、限额、脱敏、upload_urls、PUT、prepared。mock transport 检查真实生产函数请求字节/顺序；模拟取消、账号变化、部分资产失败和仅失败项重试。
5. **发布与复制**：按真实账号能力选择 audience 和 principals，发布后验证 share_id/share_url；复制失败只重试复制。发布失败或未知结果不进入成功。
6. **UI 状态及原生验证**：预览、loading/error/prepared/creating/ready、受众选择、取消/重试、关闭释放；使用当前源码原生构建验证焦点、键盘与中文输入。
7. **真实 HTTP 闭环**：有授权的隔离测试账号/会话执行完整上传、发布、共享链接读回，核对访问权限与快照内容。未进行此步骤不得报告完整分享完成。

## 9. 缺证项与交付门槛

- 远程图片 URL 安全函数、图片 host/path 读取许可。
- 预签名 PUT 目标安全策略与真实服务域。
- upload_urls、发布 strict response schema 与真实响应样本。
- 通用 POST 重试/idempotency，发布结果未知后的恢复。
- feature gate、账号分享权限、audience capability 与用户/组查询完整合同。
- 上传后未发布资源清理、已发布撤销 API（若存在）。
- 用户输入清洗和特定 fileChange 排除判定的导入函数细则。
- 官方实际中文文案、布局、窗口尺寸与逐像素证据。

上述未知不阻止先实现纯转换及 mock transport，但阻止宣称完整真实分享、原生行为或严格 1:1 通过。本单元状态保留待调研/未开发，后续开发、自验与用户验收均需独立证据。

下一轮安全策略检索入口（仅定位方向，尚未证明规则）：

- 远程图片：分享 chunk 顶部导入 `TC as xe`，来源 `app-initial-fd3c4b862660.js`；从其 export 表 `as TC` 反查本地符号定义，再跟踪 `ct` @4053 中 `await xe(o)`。不能仅由函数调用存在推断 URL allowlist、DNS/IP 或重定向完整策略。
- 预签名 PUT：分享 chunk 顶部导入 `XAt as T`，来源 `app-shared-a906948d8868.js`；从 export 表 `as XAt` 反查类，再追 `getInstance().fetch`、请求目标分类、认证注入、允许 URL/headers、redirect 与 response 状态检查。分享调用位于 `gt` @5439 与 `vt` @6987，均直接使用返回的 upload_url；调用点本身没有证明目标校验。
- `app-shared` 已知 `makeRequest` @3293310、`safePost` @3296882 可作为 JSON API 链入口；不要把该 API 包装层的身份参数支持推成二进制 PUT 的默认安全策略。

## 10. 23E实施补证

上传、组织策略、gate及受众详见[上传边界补证](23-share-upload-boundaries.md)。以下是同一原包 `app-shared-a906948d8868.js` 的UTF-16锚点，SHA-256为 `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`：

| 锚点 | 语义及本项目对应 |
|---|---|
| `gp @309026` | 按最后一个 `## My request:` / `## My request for Codex:` 截取；`shareSnapshot.cleanUserText`。 |
| `Kgt @1832714`、`Zj @1832959` | 特定工具输出的delegation包装、XML解码；`userInput/delegation`；source ID清空重建。 |
| `vHn @3716957` | 行首指令清除、连续换行收敛；`stripDirectiveLines`。 |
| `Zhr @4811109`、`tgr @4811564` | reasoning摘要首段强调及delegation编码；`reasoningText/buildShareSnapshot`。 |
| `DP @2011015`、`EP @2010935` | visualization HTML变更排除，update判定move_path优先；`buildShareSnapshot`文件变化分支。 |
| `Rz @2544393` | 生成图savedPath优先、base64 fallback；`generatedSource`。 |
| `lhr @4799845` | 旧visualize marker；当前明确拒绝，未冒充支持。 |

本轮独立实现没有复制官方打包源码；Markdown只实现已测试语法，并拒绝复杂输入，与官方完整AST/serializer仍有差异。资产读取器及UI未接，不能从纯转换通过推论完整分享可用。

`share-thread.It @24800附近`完整本地条件确认：`!remote && historyMode !== "paginated"` 时直接第二次 `thread/read(includeTurns:true)`，包括缺失historyMode；不是只支持一个固定legacy值。仅本地消息解码过大时调用分段fallback，当前分段fallback尚未实现。默认分页参数包含 `limit:5 / asc / full`，直到cursor为null。

脱敏器对照使用原包 app-primary SHA-256 `bff0e66840e6f3538efe435aceddbf9f6ce8b252e713669ff51019ee2dd5fe8f`，准确锚点 `XI@316012`、`XHe@316126`、`QHe@316461`、`rL@318722`，纯函数段结束于 `pUe@323765`。100个合成基础样本及变体在 `verify-share-redaction.mjs --reference` 对照结果相同，仅为固定启发式规则的样本证据。
