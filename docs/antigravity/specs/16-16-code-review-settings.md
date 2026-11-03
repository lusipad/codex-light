# 16.16 代码审查设置

2026-11-02。先调研再开发。

## 路由纠偏与基准

初查code-review-settings-8c883960b081.js实际对应usage-code-review统计入口，不能作为code-review设置renderer。真实app-initial lazy注册code-review → settings-11a7451917e6.js → CodeReviewPluginSettings。该页按app/cloud access gate展示Preferences和Review agent；本地嵌入MCP pull_requests.settings。统计入口另立，不替换当前设置页为统计。

固定asar仍为既知codex-offline补丁基准，hash沿用16.15并重新核对提取chunk。官方运行时gate/原生/像素未证。定位/hash另存reference/route-contract.json。

## 本地偏好合同（修改前）

官方插件server.mjs的settings/definitions/code-review-settings.ts定义persisted atom：code-review-github-link-target默认code-review-tab，code-review-local-instructions默认空字符串。插件assets/pull-requests.js hAl读取这两项，sAl指令3000ms自动保存、保存按钮/Ctrl+S立即保存、卸载flush；in-app-browser选项依browser.in-app能力，本机尚无该能力闭环不开放。旧github/in-app-browser值保留，要求用户显式选择当前支持目的地。

本轮采用Rust锁内合并electron-persisted-atom-state并持久化，返回读回快照。不得覆盖其他atom或旧desktopPreferences。链接目的地接CodeReviewView已有PR详情/系统浏览器入口；个人指令仅用于从PR入口发起的审查，不污染普通本地quick review。沿用现有PR分支审查路径并不等于已实现官方private review snapshot/结果schema。

用例：CRS01真实临时状态文件写读回、空值清除、未知字段/错误类型拒绝且文件不变；CRS02并发不同偏好合并保留其他atom、磁盘失败内存不变；CRS03真实前端读取/失败保稿/单飞/离页隔离与3000ms/快捷键/flush；CRS04链接目的地消费、个人指令仅进入PR请求且设置未读取不执行。共享CodeReviewView回归现有review动作。

## 未完成范围

云端个人和仓库策略由cloud-preferences与/wham/settings/code_review真实服务消费。当前未有该服务的认证桥，不能沿用本地触发/严重级别/glob表单冒充远端策略；撤下其控件，历史字段保留。MCP app ephemeral线程/资源/工具读链已有隔离探针，尚非完整插件UI宿主。不复制插件HTML/JS到产品。

官方GitLab/provider gate、仓库列表/权限/409、云端额度/自动与安全审查、完整PR审查快照及UI、官方自动保存时序/焦点/原生像素仍需对照验收。
