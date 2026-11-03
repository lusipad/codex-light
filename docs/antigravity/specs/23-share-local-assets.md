# 23F：分享本地图像与 HTML 资产读取合同

日期：2026-11-03。状态：只读静态调研完成；本文未修改产品代码，未读取用户图片或 HTML 内容，未发真实网络请求，未运行官方 UI。本文不代表完整分享或原生验收通过。

## 基准、来源与记法

依据 [分享总合同](23-share-thread.md)。候选包 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，带 offline 补丁，不能当作干净发行包或运行时权限证据。

本轮从 asar 内存只读提取，内容区起点为 `8 + readUInt32LE(4)`。以下定位均是将文件解码成 UTF-8 字符串后的 0-based UTF-16 偏移。主进程现有 `.ref/scratch/main-DkWgQSQe.js` 已与包内文件逐字节相等核验。

| 包内路径 | SHA-256 |
|---|---|
| `webview/assets/share-thread-d5a88d0b0559.js` | `d98b18d0838f26a2dd8b7fc4e64a9e0ee4cc60cb38b97990291efed318aa34b7` |
| `webview/assets/app-shared-a906948d8868.js` | `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b` |
| `.vite/build/main-DkWgQSQe.js` | `d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b` |
| `.vite/build/src-ghAWefM3.js` | `8cf86523941dd8b31900c57935decb45f5bba8dba08fa8a2de574b1d2df3ff22` |

核心结论：**图片与 visualization HTML 使用不同读取器、不同权限约束。不能将二者统一描述为“只能读 cwd”或“传了 threadId 就验证了会话所有权”。**

## 图片解析与读取链

`share-thread`：

- `ct @4053`：data image → 远程 HTTP(S) → 本地解析，三条路径。
- 本地路径先调用 `Tmt as x`；得到 null 时，仅在 source 没有 URI scheme 且存在 cwd 时调用 `Xqt as E(cwd,source)`。
- 最终调用 `GU as s(path,hostId,queryClient,signal,conversationId)`。

`app-shared`：

| 锚点 | 偏移 | 实际含义 |
|---|---:|---|
| `bVn`，导出 `Tmt` | 3708729 | 解析引用路径；支持 `sandbox:` 前缀、绝对路径、file URL |
| `aI`，导出 `Xqt` | 2138784 | 归一化 cwd/source 后拼接相对路径；本函数不作 cwd 内包含校验 |
| `Gzr`，导出 `GU` | 5171126 | queryFn 发 `read-file-binary` |
| `qzr` | 紧随 `Gzr` | 拒绝 data/http/https/file/vscode scheme，只接受已归一化绝对路径 |
| `Jzr` | 紧随 `qzr` | 根据文件扩展名推断 MIME |

`bVn` 的静态路径语义：

1. 先经引用解析 `SZ(source)` 得到 path；本轮未完整还原引用附带行号等全部语法。
2. `sandbox:` 前缀去掉。
3. 绝对路径先 `decodeURI`，去 `/C:/` 的首斜线，再解 `%23`、`%3F`；解码失败保留原路径。
4. 其他尝试 `new URL`，只允许 `file:`；pathname 用 decodeURIComponent。
5. file URL 空 host/localhost 返回本地路径；其他 host 返回 `//host/path`，所以 UNC 不是天然被禁止。
6. 相对路径 fallback 拼 cwd；此层没有阻止 `..` 离开 cwd 的包含检查。

`Gzr` 请求参数：

```text
read-file-binary {
  path: normalizedAbsolutePath,
  hostId,
  conversationId,
  environmentId: undefined
}
```

分享调用**没有传 maxBytes**。query retry 为 false；取消 signal 与 query signal 合并。结果 `contentsBase64` 为空则 null。此函数使用扩展名推断 MIME，未消费宿主返回的 sniffed `mimeType`。

扩展名表包含 svg/png/jpg/jpeg/webp/gif/avif，但分享 `ut` 再筛 MIME：

```text
image/(png|jpeg|jpg|webp|gif|avif)，忽略大小写
```

因此 svg 经此分享链被排除。无扩展名或不支持扩展名推为 application/octet-stream 后排除，不能仅凭图片 magic bytes 自动增加官方未见格式。

### 宿主 read-file-binary

`main @1435566 async readFileBinary`：

- 获取 host 对应 appServer client。
- 先尝试导入 `m.Zt({appServerClient,url:path})`；本轮未追完此特殊 URL 分支。
- 以 `https://` 开头且特殊分支未命中则返回 null。
- durable host：conversationId 用于 `thread/read(includeTurns:false)` 查 environments；无 environments 且有 parentThreadId 时递归父会话；由 extension 读指定环境文件。
- **非 durable（包括本地）**：`getFileRequestPath(path,client)` 后交 `m.Oa.readFileBase64`；conversationId 没有参与路径授权。
- 提供 maxBytes 才使用 sample bytes `maxBytes + 1`；超限返回 null。分享前端调用未提供，因此不能声称官方本地分享读入前受 25MiB 限制。
- 宿主读取后会 sniff MIME，但前端 `Gzr` 使用扩展名，以上两事实不能混淆。

`main @1430120 getFileRequestPath`：

- remote host 使用其 platformPath；
- local 经 host/path 映射后调用 `wR(path,selectedProjectRoot)`。

`main @1336632 wR`：

- 去 diff 风格 `a/` 或 `b/` 前缀、normalize；
- 已为绝对路径或没有项目根时直接返回；
- 相对路径才根据项目根拼接和存在性进行候选修正。

**已证实边界**：此次可见本地通用 binary 处理器没有 cwd 包含、会话归属、父级无符号链接检查；绝对路径并非仅允许 cwd 内。底层 `m.Oa` 的完整 OS/远端约束未在本轮追完，因此不推断“能读任意文件”作为最终运行时结论。不能仿照一个通用读取器就开放 renderer 任意路径导出能力。

## HTML visualization 读取链

`share-thread @3647 st` 调：

```text
visualizations.read {hostId, path: source, threadId}
```

**没有传 sandboxPolicy**。收到 contents 后 UTF-8 编码，超过 25MiB 则排除；按 application/octet-stream 上传。宿主本身有更小的 5,000,000 字节限制。

`main`：

| 锚点 | 偏移 | 含义 |
|---|---:|---|
| `RKe=5e6` / `VKe` | 3153196 起 | 读返回上限及请求 schema |
| `HKe` | 3153788 起 | visualization service |
| `UKe` | 紧随 `HKe` | 允许根目录匹配和 canonical boundary 映射 |
| `O5` | 紧随 `UKe` | relative 不得为 `..`、`../…` 或 absolute |
| service 构造 | 3228689 附近 | 按 host/thread 获取真实 workspace roots |

### 会话 ID 与默认目录

请求 schema：hostId 若提供则 trim 后非空；path 非空；threadId `/^[a-zA-Z0-9_-]+$/`。随后用 `r.r(threadId)` 解日期，失败则拒绝，故不能只验证宽松字符正则。

`src-ghAWefM3 @162892 mm` 导出 `r`：

- 支持 UUID v7：前八 hex + 后四 hex 组成毫秒时间戳；
- 支持特定 UUID v8 格式：前八 hex 作为秒时间戳；
- 日期用 UTC 年/月/日。

默认候选目录：

```text
<codexHome>/visualizations/YYYY/MM/DD/<threadId>/<basename>
<workspacesRoot>/visualizations/YYYY/MM/DD/<threadId>/<basename>
```

workspacesRoot 失败可缺失；feature `workspaceDir` 决定二者优先顺序。不要把用户目录拼成固定 `~/.codex`，宿主 codexHome 与 workspacesRoot 是真实来源。POSIX 本地 codexHome 有额外平台转换，本轮未完整还原。

basename 必须 `/^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/`。

- 相对 path **必须恰好等于 basename**；`subdir/chart.html`、`../chart.html` 均拒绝。
- 绝对 path 必须已规范化：platformPath.normalize(path) 必须等于只替换 `/` 为平台分隔符后的原 path，点段/重复分隔符等会失败。

### 绝对 HTML 路径允许根

允许目录不是只有默认会话目录，还包含真实 thread workspace roots。

service constructor 的 roots provider：

- cloud executor 从真实 thread environments 找匹配 environmentId，使用 runtimeWorkspaceRoots；
- 特定 host 类型返回空；
- 普通本地/已存 host 从 threadCatalogSyncManager 对 `(hostId,threadId)` 查条目，sourceKind 非 chatgpt 且有 cwd 时返回 `[cwd]`。

service 通用 API 可额外传 sandboxPolicy writableRoots/tmp 选项，但**分享 st 没传这些字段**；不可据此默认允许所有 `/tmp` 或系统 TEMP。分享路径只有默认会话目录 + 实际 thread roots。

`UKe`：

1. 根目录去重，只保留绝对 directory。
2. 优先匹配包含 path 的最长 directory。
3. 将 boundary 通过真实宿主 realpath 映射为 canonical boundary，按 boundary 相对路径重建目标。
4. 若 lexical path 未命中，最多 4 并发解析候选 boundary，允许其 canonical directory 下的输入；不是放开任意 realpath。
5. 匹配失败拒绝。

### 符号链接、父级与读取大小

目标读前：

- `r.n(dirname(target),boundary)` 获取从父目录到 boundary 的祖先列表；
- `src-ghAWefM3 @163563 ym`：先检查包含关系，最多 64 层，必须实际到达 boundary；
- 目标和每层祖先均 stat `{bypassCache:true,followSymlinks:false}`；
- 目标必须 file 且非 symbolic link；祖先必须 directory 且非 symbolic link；
- 随后读取 bytes；最多 5,000,000 字节，超出返回 null；成功按 UTF-8 解码。

canonical boundary 自身可能来自已解析根，不能把所有原始根中存在 symlink 一概拒绝当作官方同语义；其允许 canonical 根但拒绝解析后链上的 symlink。检查与 read 分离，静态实现不能证明消除了所有 TOCTOU 竞态。

默认候选缺文件时可尝试下个候选；非 ENOENT 或最后候选失败抛出。st 捕获错误，取消优先抛，否则资产为 null。

## 本项目可实施范围与偏离

这是开发建议，**不是官方已实测行为**：

1. 当前仅本地 host：宿主从真实 thread metadata/cwd 解析资产，不接受 renderer 声称的任意 cwd/roots；远端和 durable 未支持时明确 unavailable。
2. 图片 source 必须来自这次完整 thread 的资产候选；read request 绑定 host/thread/session。本地图片若只允许 cwd + 明确关联生成目录，并拒绝 symlink，是比已观察的官方通用图片读处理器更严格的本项目策略，须记录可能排除合法外部图片，不能称 1:1。
3. HTML 按上面的真实默认会话目录或真实 thread cwd 处理；相对只 basename；校验 UUID 日期；使用 host 实际 codexHome/workspacesRoot；不要开放任意 html。
4. HTML 读前限制 5,000,000 字节；图片读前限制 25MiB，并逐块限制。图片提前有界读取是本项目改进，不宣称官方分享通用读取器已这样实现。
5. 25MiB 每资产、100MiB 合计、最后 64 候选、逆序保留的总额策略仍由 collection 层执行；宿主单文件拒绝不能代替这些规则。
6. 图像 MIME 使用官方扩展名集合，同时可以检查格式不符拒绝；若新增 sniff 校验，属于更严格策略。缺失、不支持、越界和读取失败应映射 unavailable，不得凭空生成成功资产。
7. binary/image 和 HTML 不同授权路径；不要因为前端都给了 threadId 就共用一个 unrestricted read。

实施至少覆盖：cwd内/外、相对 traversal、Windows大小写/UNC、encoded file URL、生成目录、UUID日期、跨 thread HTML、basename非法、根canonical映射、父级/目标symlink、超过64祖先、5,000,000与25MiB边界、文件增长、关闭取消、host切换，以及缺资产后snapshot不可泄露原图片URL。

## 未证明项

- 通用 binary 底层 `m.Oa`、特殊 `m.Zt` URL 分支的全部权限与协议。
- `SZ` 文件引用解析全部语法与平台路径映射细节。
- 官方账号/远端/durable 运行时以及实际读取失败呈现。
- 稳定无竞态的 filesystem 句柄级授权。
- 原生 UI、像素、中文文案与真实上传闭环。

文档检查：本轮只有此新文档变更，执行 diff whitespace 检查；无产品构建/测试通过声明。
