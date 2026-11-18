# E 阶段集成与预览发布记录

2026-11-06。状态：限定增量本地检查与预览发布完成，逐页用户验收尚未完成；整个软件未完成 1:1。范围和发布合同见[阶段计划](../ALL-PAGES-E-20261106.md)。

## 实现与审查

- 02/03：复用原命令详情和退出状态，单一 read/search/listFiles 使用紧凑摘要，读取路径有真实文件打开入口。[单元记录](02-03E-conversation-ui.md)。
- 05/06：复用文件协议、编辑保存与 Git cwd，新增惰性递归目录、当前项目多根和嵌套文件监听。App 使用原项目归属模型，避免全局其他项目根混入。[单元记录](05E-files-tree.md)。
- 07：复用现有 PTY/回放控制器与已保存外观，紧凑标签、兼容操作区与键盘导航。[单元记录](07E-terminal-ui.md)。
- 独立复审发现并修复：文件链接不可见/静默失败/同路径不可重试；忽略 input 后 ANSI 回答误写；8/24px 字号反向变化；回放期间异步 IME 文本被过滤。回归使用生产回调及已安装 xterm 真实方法，先红后绿。
- 发布元数据核对五处版本、显式标签、说明文件、HEAD/GITHUB_SHA 和已有标签实际提交；隔离 Git 仓库覆盖轻量及 annotated 标签错配。发布前重新获取标签并核对，不移动旧标签。
- 未新增依赖、未扩大真实账户写入、未触发模型 turn。便携 ZIP 随主题许可目录提供，不单独发布缺少许可目录的裸 EXE。

## 浏览器结构与交互

证据：`.ref/parity/all-pages-E-20261106/browser-workbench/`，由当前生产 DiffDrawer/CommandExecutionCard 构建，所有协议/IPC 为内存边界，CSP 禁止外网。

1280×800 与 640×800：命令文件链接从 Changes 显示 Files；src/nested/demo.ts 的三级目录保持父级；切根保留中文草稿；脏稿拒绝覆盖且提示；保存仅内存读回后同路径请求显示真实 fixture 读取错误。两尺寸 document.scrollWidth 等于视口宽度。原始 JPEG 留存，不能用于无损逐像素验收。

缺少同环境官方图，visual-verdict 的 score=null、verdict=revise。原生 select、多文件标签、官方活动容器及终端可移动工作面等差异继续登记，没有宣称 1px 达标。

## 统一检查与原生

最终非 Fast `verify-all.ps1` 单次退出0：372项检查、32个真实协议探针通过，0失败；CLI为0.165.0。随后独立 `cargo test --locked --manifest-path src-tauri/Cargo.toml` 退出0：474通过、0失败、0忽略、0过滤；二进制及doc-tests为0用例。原始输出在 `.ref/parity/all-pages-E-20261106/{verify-all,cargo-all}.log`，各有实际退出码。

最终 `npm run tauri build -- --ci` 退出0，EXE/MSI/NSIS及5份主题许可共8产物归档在 `dist-artifacts/all-pages-E-20261106/`；336项产品输入构建前后稳定，清单在同证据目录 `build-result.json`。EXE SHA-256：`fd88453b13ac2ab55baee053a0331aeb80d4e161c8673dba0ecf949659cf8f44`。

该EXE使用独立CODEX_HOME、WebView目录和测试工作区启动，CLI确认Not logged in。原生Ctrl+P真实文件搜索→结果打开Files及磁盘内容、三级递归展开、PTY启动与操作区呈现、Escape可见关闭、Alt+F4退出PID380712均留证；未向终端发送命令或发起模型。原生AX在菜单关闭后仍含旧节点且焦点报告RootWebArea，因此不把它记为精确焦点返回通过；生产DOM回归与原生可见关闭分开记录。

首次测试目录在父仓库内，Git向上只读发现父状态；随后为该私有工作区初始化独立Git根并观察仅两份fixture文件，未执行父仓库Git写动作。复现启动脚本已补独立Git边界。没有执行安装程序、改变沙箱或登录权限。

先前为修复异步 IME 中止的检查日志单独保留，不计完整成功。未配置独立lint命令；类型检查及既有静态合同按标准入口实际执行，不虚构额外lint结果。

## 发布

应用版本0.2.0已从提交 `ba6d4c640af0b4c7b14d96b210645960b8eed9c6` 推送并发布为[v0.2.0-preview.1](https://github.com/lusipad/codex-light/releases/tag/v0.2.0-preview.1)，prerelease=true、draft=false，实际标签提交已通过GitHub ref API和ls-remote双重核对。

[run 42142616559](https://github.com/lusipad/codex-light/actions/runs/42142616559)最终completed/success，watch退出0。云端Node20的23项前端回放、类型/构建、原生SDK、474项完整Rust（0失败/忽略/过滤）、EXE/MSI/NSIS、资产上传、标签复核、Release发布和收尾均成功，不沿用旧run代替本次结果。

已实际下载MSI、安装程序、便携ZIP及SHA256SUMS.txt，三个载荷同时匹配清单与GitHub资产digest；清单自身也匹配API digest。ZIP内EXE及5份许可存在。首次按本地原始LF字节比较许可失败，后查明云端checkout为CRLF：分别多567/22/21/21/33字节；仅将CRLF还原LF后，与该提交五份Git blob的SHA-256逐一完全一致，未忽略其他空白或内容变化。原始验证事实与最终结果留在 `.ref/parity/all-pages-E-20261106/{download-verification,portable-license-verification,final-result}.json`。

此预览不包含之后开发的04E项目排序；预览发布成功不关闭剩余页面目标。

## 剩余边界

官方配对像素、物理 IME、无 compositionstart 的 229 键位路径、真实账号 HTTP/持久化、多窗口及逐页用户验收尚未通过。回放与内存 fixture 不是实际服务证明，打包与预览发布也不代表全软件完成。剩余页面继续按总计划推进。
