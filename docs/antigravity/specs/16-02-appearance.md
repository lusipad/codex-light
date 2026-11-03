# 16.02 外观：修改前合同

日期：2026-11-01。仅调研，不表示已开发或验收。

固定原包 [trace.json](../../../.ref/parity/16.02/runs/20261101-codex-appearance-research/reference/trace.json) 五项资源核integrity；以下偏移为原始 UTF-16。

| 用例 | 官方预期与消费者 |
|---|---|
| AP01 | appearanceTheme 默认 system；三态 system/light/dark，中文“模式/系统/浅色/深色”。general-settings 129381提交，initial 2933277/2933557读取系统variant并订阅；显式light/dark覆盖系统 |
| AP02 | 模式即时影响实际背景、文字/控件，退出重开保留；保存失败可见，不提示成功；系统订阅在销毁后清理 |
| AP03 | sansFontSize默认14，11–16；codeFontSize默认12，8–24，可小数；blur或Enter parseFloat且schema验证，非法恢复已存值。general-settings143847/145556 |
| AP04 | initial8825963消费独立--font-ui-size和--font-code-size，并按sans/14缩放文字token；不能只改根字号而固定px不动；界面字号与聊天/diff代码字号分离 |
| AP05 | reduced-motion-preference默认system，system/on/off；与系统prefers-reduced-motion合并，动画实际消费，重开保留。开启/关闭覆盖系统 |

先实现AP01/AP02及双字号消费者，减少动态效果接续。修改前对已有colorTheme、固定px和代码渲染定位，先做行为回归再修改；不凭旧25色板字符串检查宣称官方外观已对齐。原生主题变化、computedStyle/像素与焦点另验。

当前缺陷：App只读colorTheme，Settings只改四个变量；未设置已有data-theme=light；统一12–18滑块混合界面与代码且固定px不跟随。完整颜色/代码主题、高级选项与原生未覆盖，后续单列。
