# 16.25A 宠物偏好、真实本地资源与消费者

2026-11-03，修改前合同。原包pets-settings-route已提取核integrity，见.ref/parity/16.25/reference。共享原包app-shared定位：selectedAvatarId键selected-avatar-id，默认null；petSize键avatar-overlay-mascot-width-px，默认112、整数80..224；petVisibility键pet-visibility，always-visible/on-demand。设置即时写入，无整页保存；原包选宠物使用真实avatar资源集合，show/hide发送avatar-overlay-open，不等于隐藏pet图像atom。

本轮限定本机已具备能力：真实本地pets/pet.json与avatars/avatar.json/精灵图列表、选择/大小/可见模式持久化与读回，当前应用内Mini消费者；不冒充原生桌面独立overlay或完整云端宠物创建。现有两项emoji仅作为明确命名的本地回退，不能称官方内置资源。

| ID | 修改前预期 |
|---|---|
| PT01 | 偏好使用正确atom键，80..224默认112，最小patch合并，写后真实读回；失败可见、不成功、不污染其他偏好，读取失败不开放写 |
| PT02 | 本地列表遵循CODEX_HOME/pets及avatars，使用custom:目录名ID、pets覆盖legacy同目录项、mtime最大值降序和原包清单默认值；严格v1 1536×1872/v2 1536×2288；无效manifest/越界路径/无图或无效图/version可见报错（原包静默跳过为已知差异）；刷新空集合清旧项，不自动选第一宠物 |
| PT03 | 设置即时写、整组单飞、失败保当前已核值；滑块键盘与reset均持久化；离页/晚到不回填；目录打开失败可见，有真实刷新 |
| PT04 | Mini消费真实像素大小、精灵version和on-demand点外关闭；失效已选资源显示不可用，不能悄悄fallback另一宠物；中文输入法Enter不发送，发送失败保稿/防重复 |

后端隔离真实文件/原子写回归，前端生产函数/JSX/事件生命周期回归，标准检查/原生构建。官方原生overlay/许可确认的内置图像/云端create/upgrade与多窗口原生交互、同条件像素仍未验，保持缺口。不得使用外部宠物App工具修改用户库。


## 16.25A 后端合同补正（2026-11-03，修改前）

追加核对原包bootstrap-DvSEn4qy.js的aB/oB/dB/cB/fB：清单id/displayName可缺省，提供时trim后非空；description trim后空值归null；版本默认1；图像路径默认spritesheet.webp。ID为custom:目录名，名称displayName→id→目录名。资源同时读取CODEX_HOME/avatars/avatar.json及pets/pet.json，同目录ID以pets为准；按清单/图像mtime最大值降序。v1严格1536×1872，v2严格1536×2288。原包坏项静默跳过，本轮明确保留错误可见/all-or-error差异，不伪称完全一致。native校验PNG解码及WebP容器/帧头尺寸，WebP完整像素解码由前端Image.onload gate验证。原PT02“重复manifest ID拒绝”被custom:目录ID规则替代：不同目录允许相同清单id，跨来源同目录名按pets覆盖。
