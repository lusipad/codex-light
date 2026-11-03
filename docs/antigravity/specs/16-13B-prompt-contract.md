# 16.13B 提交 / PR 生成：原文、黄金样本和真实 Git 数据接口

2026-11-03，只读取证。本合同供正在实施的前端与宿主使用，不表示已运行真实模型或通过官方运行时验收。固定 Store `26.1027.3384.0`、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。

## 1. 可直接读取的完整原始材料

目录：[prompt-contract](../../../.ref/parity/16.13/actual/16-13B-research/prompt-contract/manifest.json)。manifest 逐文件保存 SHA-256、字节数、原始 chunk 及 0-based UTF-16 精确 start/end（end exclusive）。提取文件不是源码摘要，没有省略号：

| 文件 | 用途 |
|---|---|
| official-Cr-wr.js | 完整官方 `Cr` PR 上下文读取与 `wr` 提交上下文读取函数。 |
| official-commit-context-functions.js | 完整 `Zn` 提交上下文、`Qn` diff/超限选择；不包含外部资源访问。 |
| official-pr-context-functions.js | 完整 `ir/ar/or/sr/cr`：PR上下文、1000行/100文件限制、不成对fence闭合。 |
| official-host-schemas-and-prompts.js | 原始 Zod validators、3个生成配置（promptCharLimit、完整prompt builder、extractParsedResult）。 |
| official-commit-prompt.js | 完整宿主提交 prompt builder，无截断。 |
| official-pullRequest-prompt.js | 完整宿主 PR prompt builder，无截断。 |
| official-commitPullRequest-prompt.js | 完整宿主组合 prompt builder，无截断。 |
| output-schemas.json | 三种输出 schema 的语义转录。不是调用官方Zod JSON-schema序列化器的结果；严格校验逻辑以原始validator为准。 |
| golden-samples.json | 用**提取的官方纯函数**在无外部能力 VM 中计算：4项UI上下文、3项完整宿主prompt。全部输入是合成字符串，无Git/模型/账号执行。 |
| official-model-fallback.js | 完整ls函数，1058925..1059670，提供者一致性及真实模型目录fallback。 |
| official-generation-model-defaults.js | module80096，679723..680795，默认模型与远程配置key的原始定义。 |

原始 chunk 大小及完整哈希沿用 [研究manifest](../../../.ref/parity/16.13/actual/16-13B-research/manifest.json)。固定辅助常量已核对原文：`lu="Make 0 tool calls."`；提交测试提示 `$n`、未跟踪说明 `er`、PR `lr=1000/ur=100`。黄金样本组合上下文精确为 `["Commit message context:",commitContext,"","Pull request context:",prContext].join("\n")`。

换行来源见目录内 `evaluation-provenance.json`：所有提取通过Node fs读写，无PowerShell文本重写、无显式CRLF→LF replace。提交上下文原片段CRLF=0/LF=5，PR片段CRLF=0/LF=6；宿主builder无源码换行。合成fixture使用LF，golden是执行原函数得到的LF输出，不是写文件后替换结果。真实用户指令/diff含CRLF时，函数如何保留字段应按原语义另测，不能把本组LF fixture推断为所有输入都会被统一换行。

宿主这些是普通生成输入提示 builder；本配置没有额外声明 baseInstructions，不将它们误称为已证实的系统消息。ll 先按 20000/30000/40000 字符截取上下文，再交 builder；不能先生成完整prompt后把整条prompt截到同长度。

固定Store模块默认 ephemeralGenerationModel 为 `gpt-6-luna`，但宿主注入 `(await ev(a)).ephemeralGenerationModel`，实际 `codex_ephemeral_generation_model_slug` 可覆盖，不能把默认值当唯一可用模型。ls仅在全局/当前cwd提供者及model_providers一致时做目录fallback：指定模型存在则原样保留，否则从未隐藏、modelSpecialty=null、支持low的真实目录挑默认/首项；读取失败保留传入模型。lf/lg/l_均无baseInstructions属性，因此调用链该值未设；不添加猜测system文案。

只读核对：`.ref/protocol/v2/ThreadStartParams.json` 有sandbox/ephemeral但无permissions，TurnStartParams有sandboxPolicy但无permissions；16.05较新schema目录有permissions，不可误标为旧版本。兼容实现可选择两版均有且实际验证的read-only sandbox/sandboxPolicy，明确记录与固定Store的named permissions适配差异，不同时发送互斥字段。

## 2. 提交真实数据与统计

官方 wr：`commit-message-diff {cwd,hostConfig,includeUnstaged,operationSource}` → `nr(result)` 仅 success 时取 unifiedDiff；error 单独传 `diffError`。`rr(diff)` 逐行统计：遇 `diff --git ` 文件数加一并退出hunk；遇 `@@` 进入hunk；仅hunk内以 `+` / `-` 开头行计增删。因此文件头 `+++` / `---` 不算，二进制无hunk可有文件数但0增删。不是简单统计全字符串的加减号。

当 `linesAdded+linesRemoved >1000` 时提供 `{filesChanged,linesAdded,linesRemoved}` 摘要并不内联diff；恰1000仍内联。diffError.type=diff-too-large 走明确过大文案。输入包含 `draftMessage` 和已保存的 git-commit-instructions。无草稿、无diff时不能根据文件名拼成功结果。

官方说明“Untracked changes are not included.”意味着不能把当前文件预览合成的未跟踪补丁当提交生成上下文；也不应把说明贴上去但实际偷偷包含untracked。

## 3. PR 真实数据与统计

官方 Cr 并行请求：

```text
review-patch   {cwd,hostConfig,operationSource,source:"branch"}
branch-metadata {cwd,hostConfig,operationSource}
review-summary {cwd,hostConfig,operationSource,source:"branch"}
```

之后 `ir` 输入：`pullRequestInstructions`、成功patch的 `diff.unifiedDiff`、成功summary的 `files.map(path)`；baseBranch为 metadata.baseBranch 优先，否则现有真实repo data.defaultBranch；headBranch为显式headBranch参数优先，否则 metadata.branch，再 repo data.branch。没有字段时保null，不能用main/codex/topic等固定值代替真实读取。

PR阈值与提交不同：`diff.split(/\r?\n/).length >1000` 才换文件列表（包含末尾空行的实际分行结果）；无diff也用文件列表。filePaths最多100，剩余真实计数以省略提示呈现。不要用提交的hunk加减行阈值代替PR阈值。metadata默认分支的宿主内部查找算法本次未追完，不能把当前项目默认猜测写成官方已证算法。

## 4. 本仓库当前只读能力与最小接口建议

只读源码核验 `src-tauri/src/git.rs` 与 `lib.rs`：

- `git_diff` 且 filePath=null、staged=true、无base，可返回完整index diff；staged=false使用 `git diff HEAD`，即tracked工作区相对HEAD、包含staged+unstaged。HEAD不存在时回退 `git diff` 会漏已暂存内容，应显式处理unborn，不能把错误后空diff当成功。
- `git_diff` 的filePath分支会对untracked合成补丁，不适合本生成链。baseBranch分支 `base...HEAD` 仅已提交变化；不能用于需要工作区变化的PR上下文并宣称完整。
- 已有 `git_merge_base` 可校验/解析真实base；`git_diff` 的reviewBaseCommit分支再 `git diff <resolved-base> --` 可给从merge-base到当前tracked工作区的完整变化。具体是否采用此PR工作区范围，应与真实branch review-patch语义对照；本次没有运行官方git handler，不将建议当已证明完全等价。
- `git_status.entries` 含untracked；但其 files_changed/additions/deletions 来自 `git diff --numstat HEAD`，**不含untracked**。这些统计仍不对应每种includeUnstaged/PR base，且错误被吞，不应拿当前status/可见列表代替生成专属patch/summary。
- `current_branch` 在detached返回 `HEAD (<sha>)` 展示文字，不是可传的真实head分支名。元数据接口应使用真实symbolic branch/null，不能把展示label作为branch。

建议宿主集中构造最小只读上下文，名称由实现统一，下面不是现有IPC：

```ts
type GitGenerationContextRequest = {
  cwd: string;
  kind: "commit" | "pullRequest";
  includeUnstaged?: boolean; // commit模式，来自真实提交意图
  baseBranch?: string | null; // PR，真实选择/查询，不是任意展示label
};
type GitGenerationContext = {
  unifiedDiff: string | null;
  diffError?: { type: string; message: string };
  filePaths: string[]; // 对同一PR比较范围查询，保持真实路径，支持rename/空格/中文
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  headBranch: string | null;
  baseBranch: string | null;
};
```

这里统计可以由相同patch按rr纯函数算，避免Git numstat与官方prompt统计混淆。filePaths应从同范围 `--name-only -z` 或等价真实结构获取，不从含所有untracked的status中直接抄；路径处理使用NUL分隔，不能按空格切。大补丁被安全上限阻断时返回明确diffError，并尽量提供真实summary，不把截断文本当完整diff。

读取阶段不得stage、checkout、commit、push或创建PR；接口应拒绝非仓库/无效base并保留错误。无HEAD、detached、二进制、rename、staged+unstaged同文件、只有untracked、工作区在读取期间变动均需有实际回归。多次Git读取并非原子快照，必要时前后校验HEAD/index标识并拒绝混合结果，不宣称天然原子。

父和宿主代理已收到接口建议与现有能力边界。前端只将专属真实上下文输入上述黄金builder，不能复用当前任意可见diffContent/displayedEntries作为生成数据。

## 5. 本次验证边界

提取文件哈希和原始切片定位可重新验证；黄金样本来自固定Store纯函数，不证明真实模型质量/服务可用。没有改产品、运行Cargo、执行模型或Git写入。官方 `commit-message-diff/review-patch` 宿主底层Git命令范围仍按未证部分注明；没有以推断填满证据链。
