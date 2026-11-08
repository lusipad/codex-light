# 15J 设置归档搜索字段

沿用 [设置归档规格](../specs/15E-settings-archive.md) 的工作面。取证固定 Windows Store `26.1103.4239.0`，偏移为从零开始的 UTF-16 字符计数。

| 官方锚点 | 对照行为 |
| --- | --- |
| `499225.6d2e47bea2.js` 896486–897055 | 本地归档条目使用标题、项目、工作目录 basename、记录文件 basename。 |
| 同一 chunk 897489 附近 | 查询与候选字段统一 NFC，先按类型和项目过滤，再搜索和排序。 |
| 同版 `ThreadListResponse` 的 `Thread.path` | 字段可以缺失或为空。检索使用已有归档列表返回的元数据。 |

设置归档复用已有路径 basename 处理和本地筛选。生产组件回放验证分解形式的路径与预组形式的输入相匹配，排除父目录及第四个词，保留项目过滤和排序，搜索过程不另发 RPC。独立归档工作面仍使用原有标题检索。

本轮保留子串匹配，未实现官方 Fuse 评分及标题 Markdown 清理。归档文件不需要为了检索而读取。官方同环境配对像素和用户验收仍待完成。

- 隔离 Windows 程序经协议桥加载两条归档元数据。输入 `CAFÉ archive-marker` 后只显示“归档 Alpha”，清空后恢复两条。整个操作只发出初始一次归档列表请求，无文件读取。测试窗口已关闭。
- TypeScript、发布元数据、113 项前端回放及 EXE、MSI、NSIS 打包通过。未重跑 Rust 全量单测。
- EXE SHA-256 为 `cd71dd7f767de637b287de9edffd981beff982c9d3585dead77c0a97a52a9ff8`，证据位于 `.ref/parity/15/actual/15J-archive-search/`。
- GitHub Actions 最近的主分支作业仍因付款或支出限额未启动。
