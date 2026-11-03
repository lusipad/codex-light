# 16.02B 主题模型实现依据

修改前记录，2026-11-03。来源固定为 `16-02B-research/manifest.json` 中独立核验的 Store 26.1021.3705。对应原始字节保存在 `.ref/parity/16.02/actual/16-02B-research/raw/`，不引用旧候选偏移。

- `defaults-930c9f21f410.js`：`t={dark:` 定义默认 seed。
- `app-theme-c4609c25be6b.js`：`function a(` 规范化、`function s(` 字体空串和 face 约束。
- `app-shared-955d52676f9c.js` UTF-16 @1748455 `dst=q({accent:`：严格导入 schema。
- `app-theme-c850e3c1c24c.js`：`function y(` 对比度映射；`function b(` 下层背景；`function g(`/`function v(` 浅深语义计算；`function D(` 强调色前景的蓝色例外与亮度阈值；`function W(` 内容 OKLab 调整。产品独立表达数学与颜色规则，不携带原始混淆模块。
- `app-theme-settings-77e2fe59e621.js`：`function Ee(`/`function R(` 分享前缀与 URI 编码兼容；`contrast:Y.contrast` 附近高级重置保留 UI family、所有颜色与 preset，平台不支持背景时保留 opaqueWindows。

本地 CSS 名称与官方名称不同：`themeVariables` 输出官方语义变量及现有消费者别名。别名映射是本项目适配，不宣称官方每个控件都使用同名 token。账户主题同步、完整代码配色、原生透明背景和像素一致分别验证，不由纯函数测试推断。

## 本轮实现与验证

- 纯模型、严格分享schema、light/dark默认seed、颜色规范化、字体family/face、精确高级重置，均在 `src/appearanceTheme.ts`。输入错误不伪造有效导入；preset必须属于对应variant。
- 16个preset ID，含CODEX与15个公开配色组，公开资源共23个variant。取自公开Shiki JSON或锁定npm 3.13.0/3.20.0中纯JSON内容，不执行下载的代码。全部对象（逐键、保持数组顺序）与Store原始chunk数据完全匹配。来源/哈希见 `src/themes/SOURCES.md`；本地核验清单 `.ref/parity/16.02/actual/16-02B-research/theme-engine/public-preset-manifest.json`。
- 初次按主分支取数时，8份资源发生版本漂移；已定位公开历史版本并重验。没有使用“同名字最新版”冒充固定官方数据。
- 原始Shiki `NOTICE`明确主题作者各自许可：Material为Apache-2.0，其余当前资源为MIT。`src/themes/THIRD-PARTY-NOTICES`保留相关完整许可段。Shiki项目MIT不能替代上游作者许可，这两类声明分别保留。
- CODEX私有完整模块未复制，仅记录基本seed与11类基本语法色的标量事实。其他私有品牌preset没有列入可用目录；不能称完整官方catalog已完成。
- `codeThemeVariables`将真实资源scope/semanticTokenColors映射至现有词法器的comment/string/number/boolean/keyword/function/type/variable/regexp类别；这是现有词法器适配，不能证明具备官方完整TextMate/semantic token解析器。
- 标准可重复用例：`node scripts/verify-appearance-theme.mjs`通过；提交23个官方seed黄金样本；有本地固定官方文件时额外比较48组输入的2688个语义输出值，均一致。此比较覆盖已输出且相交的语义变量，不覆盖账户颜色同步、图表调色和OKLab内容调整，也不是完整页面像素证明。
- `npx tsc --noEmit`与`git diff --check`均退出0。主线程负责后续集成、完整检查与原生构建。

已定位的默认深色正文例外：Store `app-theme-c850e3c1c24c.js`默认主题返回 `var(--gray-fixed-150)`；Store `app-shared-bd3e4e649b69.css`声明其为 `#dfdfdf`。不能从默认ink `#ffffff`推断所有正文实际纯白。
