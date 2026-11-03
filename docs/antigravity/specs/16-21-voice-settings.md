# 16.21A 语音设置与现有浏览器听写纠偏

2026-11-03，修改前合同。依据 `.ref/parity/16.21/reference/manifest.json`：固定asar含offline补丁，三文件提取核integrity；未证明原始发行/实时账号gate。

voice-settings 的 bn/xn：真实麦克风 enumerateDevices，过滤audioinput/非default，打开菜单申请权限，临时stream在finally停止。un/pn：语音语言来自账号voiceMainLanguage，通过认证云客户端safePatch /settings/account_user_setting，feature=voice_main_language写回。tn/nn按账号/工作区实时语音权限显示加载/错误/不可用，支持时选声音及realtimeVoice快捷键。En按dictation.composer/global能力门槛显示听写声音/快捷键/词典。没有Whisper/FastWhisper引擎选择或静音自动发送延迟控件。

当前无对应认证云桥/录音转写/实时语音能力；现有Composer仅为浏览器Web Speech回退，不能当作官方听写。保留并明确标注该回退，但不暴露不会被其消费的麦克风设备偏好。不得读取真实token绕过认证。

| ID | 修改前验收合同 |
|---|---|
| VS01 | 删除无执行器的engine/enable/延迟/快捷键/语言表单、状态、读写；语音页清楚说明官方云配置未连接，不伪造无账号权限/空列表，不显示通用保存成功 |
| VS02 | 浏览器听写累计所有results，interim被最终结果替代，多段不丢字不重复；只写草稿不自动发送 |
| VS03 | stop/错误/结束/切会话/卸载释放识别器；停止后旧事件零回填，新会话隔离；手动修改草稿后停止旧听写避免覆盖 |
| VS04 | 同步识别器锁避免双启动；缺API、权限拒绝、start失败显示错误，不假运行；原生WebView真实服务及官方像素未验 |

仅纠偏和现有回退可靠性。官方设备选择、云端语言/声音/权限、实时语音与词典、全局快捷键、录制转写需后续真实能力接入，不以本轮通过替代。
