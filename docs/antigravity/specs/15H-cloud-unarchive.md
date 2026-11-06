# 15H 云端取消归档：开发前合同

2026-11-06。状态：静态调研完成、未开发。仅聚焦Codex cloud task与ChatGPT conversation取消归档；不扩展永久删除、内部会话工作面或真实账号写入。本文与正在冻结验证的15G产品分开。本次未发HTTP、未操作账号、未运行模型/构建/Cargo/Git。

## 1. 基准和证据

固定Store `26.1027.3384.0`；asar基准SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`沿既有记录，本次没有再次整包hash。从固定安装包只读提取7个资源到 `.ref/parity/15/actual/15H-cloud-unarchive/reference/raw/`，manifest保存entry相对offset、整包byte位置、size和SHA，均匹配entry integrity。anchors.json保存33个片段，定位为0-based UTF-16字符偏移。

主要来源：`data-controls-805edc0381e3.js:hn@2155`、`app-initial-4267e52fe5b0.js:i2i@5920075`、`app-primary-998934e837fc.js:uDn@1711289`与同版中文资源。本合同只证明这些静态链，不能证明当前账号可写、网络重试全过程、官方原生焦点或像素。

## 2. 两种来源必须分开

| 来源 | 官方动作 | 正文 | ID与作用域 |
|---|---|---|---|
| Codex cloud task | POST `/wham/tasks/{task_id}/recover`（实际ChatGPT服务前缀`/backend-api`） | 此调用没有requestBody；getRequestBody@1833253返回undefined，不应自行补`{archived:false}`或`{}`当已证合同 | task真实ID，来源key为cloud:<id>，当前账户/用户/generation；不是ASB云端环境操作 |
| ChatGPT conversation | PATCH `/conversation/{conversation_id}`（实际`/backend-api`） | JSON `{is_archived:false}` | conversation真实ID，来源key为chatgpt:<id>，当前账户/用户/generation；不是Codex threadId |

两者都用同一ChatGPT M_客户端，但使用不同方法、路径、body与缓存；不得传给本地thread/unarchive或thread_delete_archived，也不能通过属性拼接猜来源。页面hn内部用`archived in n`区分旧模型，新增实现应保留明确source discriminator，避免同ID跨来源串写。

hn通过mutationKey区分`recover-cloud-task`与`unarchive-chatgpt-conversation`，并附真实ID。取消归档没有确认弹窗，不读取用户新增参数；不能顺便恢复关联项目/删除其他项。前端不接收任意URL/方法/body；后端仅允许上述固定路由，ID作为单独编码路径参数并校验长度/控制字符，不能字符串拼接造成路径注入。

## 3. 前置资格与点击边界

官方hn来自设置归档列表的真实entry；前置来源是否出现沿15F/15G各自资格和读取链，不能把local/workCloud/Odt或通知personal资格混成统一布尔值。hn点击本身未发现额外付费/rollout gate检查，不能凭此推断任意可取token的账号都有写权限；服务器权限失败仍必须显示。

本项目实施时复用已读取entry的可信source与当前ServiceIdentity；点击时重新确认当前accountId/userId/generation、连接和页面scope有效。失败监听或账号变更期间禁止写，旧行不得借新账号token恢复旧账号聊天。若来源尚未真实读取/资格unknown，就继续不可用，不用本地同名ID替代。

不将“已在列表里”当可永久复用的权限缓存。恢复不能由路由进入、搜索、渲染或固定计时器触发，只由用户明确点击相应真实行发起。新能力先实现隔离transport/RPC回归；真实账号写入不在本研究授权的验证范围内。

## 4. 官方按钮、成功和错误呈现

hn行右侧为“取消归档”按钮，secondary/toolbar样式；pending时loading，disabled条件为该恢复mutation、同行删除mutation或该task状态忙。点击先检查P.isPending。没有确认弹窗；不同条目是否必须全表互斥未发现来源，不应擅自给整页加长时间全局锁冒充官方行为。实现仍应以每source/id的同步锁防同tick重复请求，并区分这是本地幂等保护。

中文键：

- `settings.dataControls.archivedChats.unarchive`@1845335：“取消归档”。
- `unarchiveError`@1845390：“无法取消归档聊天”。hn两种来源失败均展示danger toast，带对应task ID的提示身份；没有把HTTP404改成成功。
- `unarchiveSuccessPlain`@1845454：“聊天已取消归档”；成功toast是info样式、带恢复图标。
- `viewNow`@1845641：“查看”。独立toast action先关闭toast，再导航：task去`/remote/<id>`；conversation去`/c/<encoded-id>`。

点击取消归档不会立即导航；查看是用户另一次动作。task标题本来是span，conversation标题原本Link不是恢复按钮。不要把点击标题实现成恢复。`unarchiving`进度toast与`openError`属于本地恢复链的其他分支；hn未显示该本地进度toast，不能套用为云端已证呈现。

conversation成功后，调用onUnarchiveStart捕获的焦点恢复回调；失败回调传false。task直接P.mutate，没有该同样的焦点回调。列表和菜单原生焦点具体行为仍待同环境实测；不以React静态事件证明中文输入法/Escape已通过。

内部task/conversation查看工作面尚未完整复刻时，不应伪称点击已打开真实聊天。若采用明确“在浏览器打开”的临时适配，单独登记与官方应用内查看不同；也可保持查看动作不可用并解释，不把恢复本身误标失败。

## 5. 成功后的真实数据与缓存链

**task**：hn等待recover POST成功后，从当前账号query `[tasks,archived,accountId]`各页移除该ID，调用`uDn(scope,id,false)`。uDn取消sidebar custom-section task查询，若已有`[task,id]`则把其中task.archived=false，按需要reset detail错误，失效tasks、task detail及sidebar查询。hn的onSettled无论成功失败都失效`[tasks]`，允许重新读取。

**conversation**：i2i在PATCH前xR(id)，请求finally再次xR(id)；仅PATCH成功之后把已有snapshot的is_archived=false、发conversation refresh，取消chatgpt-archived-conversations query，并等待history/project/shared及归档相关queries失效。若PATCH失败，不执行后续成功cache更新。这里没有主动新建不存在的snapshot。

两条源码都没有“再次GET到同一项is_archived=false后才成功”的独立读回合同，mutation响应body在hn/i2i未作业务确认。query invalidation可以触发读取，但静态代码不能保证每个来源已立即完成且验证成功。因此不能把“官方source明确做了独立读回验证”写进报告。

本项目应区分：HTTP已接受恢复、刷新确认恢复、恢复结果未知、恢复已执行但刷新失败。可在成功响应后刷新该真实来源，只有页面实际重读结果才作为读回证据；如果前端只持有部分归档页，某ID未在已读页出现不能单独证明它已恢复，不能伪造archived=false字段。受控新增单项读回endpoint必须另取证，不能为满足验证造API。没有完整读回时保留“请求已接受，结果待刷新确认”，不得报成失败后自动重复写。

筛选/排序不改变恢复目标；成功只移除相应source/id，不删除其他来源同ID。重读失败保留成功写事实与错误，不把已恢复项回滚成服务器仍归档的断言。

## 6. HTTP错误、取消和重试

**不要复用列表读取的空结果策略**：app-primary NDn对task归档GET的401/403/404返回空，是只读列表特殊处理；recover POST与conversation PATCH调用处没有该catch。401/403/404应作为恢复失败/权限或身份问题处理，不能当“已恢复”。取消/超时更不能当空成功。

safePost/safePatch是M_.makeRequest包装；hn本次调用没有显式传AbortSignal、expectedIdentity或retry覆盖。后续补充已追到宿主：**两种mutation默认在符合条件的HTTP401后刷新认证并重放一次**，403/404不走该分支；精确条件与取消链见第8节。不能宣称所有错误都不重放，或关闭设置页保证零写。

本项目网络服务已有generation取消、request registration/cancel、bounded transport、身份检查；新增mutation必须保留这些，但不能把“取消本地等待”当“服务器未执行”。至少区分：

- 发送前取消/非法输入/资格不符：零mutation发送。
- 已发送后断网、超时、取消、账号切换：结果可能已应用。旧结果不能污染新账号UI；原账号需重新读取确认。不增加无来源的网络错误重放，不以重复写作为读回；官方明确的认证401分支另按第8节落实。
- 明确HTTP403/404或终止401：失败，不清成功cache；初次401的官方认证刷新/重放须按第8节，而不是从GET策略类推。
- 2xx成功后读取失败：恢复已接受，刷新失败；独立重试读取，不再次recover/PATCH。

当前用户授权开发与发布不等于本研究可修改真实账号归档。先用隔离transport核对方法、路径、零/JSON正文、身份和结果分类，不发真实HTTP。

## 7. 最小实施与验收单元

只扩展现有ChatGPT service中的专用固定操作/请求类型，复用session、profile、generation、network policy与响应脱敏；不接ASB CloudOperation，不给renderer任意HTTP通道，不把恢复和删除合成“通用云端写”。不新增依赖。

| ID | 可测试合同 |
|---|---|
| UA01 | task POST无body与conversation PATCH精确JSON各自固定路径；未知source/额外URL/body/非法ID在auth/transport前拒绝 |
| UA02 | 同source/id重复点击只一条写；不同source同ID互不串写；pending样式及错误释放锁，无自动恢复/自动导航 |
| UA03 | 成功真实响应后只改相应缓存；读取失败保留写成功事实；部分归档页不能用未出现目标冒充完整读回 |
| UA04 | 两来源401/403/404、429、5xx、transport失败分别可见，task列表HTTP-empty逻辑不可进入mutation；失败不得移除行或报成功 |
| UA05 | 发送前取消零写；发送后取消/超时结果未知，不新增网络错误重放；官方401条件分支最多重放一次，第二次401、IP拒绝、403/404和retry=never不再重放；换账号/generation/断连旧回包不写新页 |
| UA06 | 取消归档后不导航；成功toast中文+独立查看；当前缺内部工作面时明确适配/不可用，不把task/conversation送本地thread API |
| UA07 | 来源重读、缓存失效、搜索/排序/分页与焦点保护回归；按钮不是确认弹窗，标题不是恢复入口 |
| UA08 | fixture回归使用隔离transport与RPC，证明零真实账号/模型HTTP；后续真实写验证须有明确范围与账号授权，原生/像素/用户验收单列 |

未完成事实：真实服务器返回schema、当前账号权限和幂等保证、取消后服务器是否已提交、单项读回endpoint、原生焦点与成对像素尚未验证。不得因本规格完成就将恢复能力标为已开发。

## 8. 已追到底层的认证重放与取消事实

补充来源是同版 `.vite/build/early-bootstrap-491-e75c34fa1b2c0832.js`、`early-bootstrap-339-096ec1020e8592e0.js`和`early-bootstrap.js`；三者已加入本单元manifest与hash核验，没有执行其中官方进程。

### 确定调用链

`M_.safePost/Patch → makeRequest → Zg.sendRequest@1762409 → fetchJson@1761951 → fetch → udt@1752026 → Qi.httpFetch.fetch → An.createHttpFetchService@1459220 → An.fetchHttp@1459358 → performDesktopFetch@1462753`。恢复路径是普通HTTP，不是仅对vscode://等路径使用的旧fetch/cancel-fetch消息分支。

udt把同一请求的method/body/headers/retry/expectedIdentity送到宿主。hn未给retry，因此是undefined；两种请求均带默认attach-auth标记。宿主performDesktopFetch先取得认证token与workspace routing，发出请求，再检查401条件。

### HTTP401确实会重放mutation

`early-bootstrap-491:1468103`的E条件可直接读为：

```text
retry != "never"
&& !(method == POST && pathname endsWith "/flora/browser/form-fill")
&& workspaceIpAuthorizationError == null
&& attachAuth && token != null && response.status == 401
```

例外字符串由`early-bootstrap.js:185630`的nM定义并导出d33。两个取消归档路径都不是该例外，条件**没有GET限定**。E成立时`1468466`：设置retriedAfter401，cancel第一次响应body，以refreshToken=true取得认证，然后再次调用同一I(f)。I闭包复用同一method/body，发送前检查signal及认证principal。代码是一次if而非循环，因此此宿主层最多一次认证重放；第二次401不会再次进入条件。403/404/429/5xx及transport直接抛错没有该if重放。

`early-bootstrap-339:hT@1194180`识别401 JSON中ip_not_authorized/validate_whitelist_failed/workspace_ip_not_authorized；该错误抑制认证重放。认证刷新失败、signal已取消或刷新后principal不同，均不能继续发送重放。不能把“401可重放一次”扩大为任何错误自动重试，也不能因本项目偏好更保守就报告官方零重放。

### 取消能终止等待/网络，不能回滚远端

- renderer `udt@1752026`在开始前throwIfAborted；收到abort调用host service.cancel(requestId)、dispose RPC并拒绝等待。
- host服务由`early-bootstrap-339:689514`为每requestId创建AbortController；cancel@690290只abort匹配controller；service dispose会abort全部活跃controller。`An.createHttpFetchService`把窗口destroyed连到service dispose。
- 宿主网络发送前及返回后throwIfAborted；workspace路由创建的signal与原signal合并。发送I(f)还会检查token principal，防止认证刷新跨principal继续写。以上证明有取消/身份边界，不证明远端收到请求后未执行。
- 默认`jmt@1829880`只在请求头存在locked-chat PIN时提供对应controller.signal；普通hn恢复调用没有页面传入signal。因此**不能声称离开设置页/组件卸载就自动取消普通恢复HTTP**。窗口销毁会处置宿主服务，和页面切换不同。

### 仍然未知及停止边界

已覆盖renderer包装、HTTP service、宿主认证/网络调用与取消controller，足以确定上述401重放及page/window取消边界。本次没有进一步推断操作系统网络栈内部行为、RPC取消与服务器提交的竞态、服务端幂等保证或真实403/404响应body。未运行HTTP，不宣称这些已验证。

本项目选择“页面切换主动取消本地等待/增加同步操作锁/已发送结果未知提示”属于有明确理由的健壮性实现，应作为适配选择单列，不应写成上述官方页面已证行为。最终严格复刻还需原生运行时对照。
