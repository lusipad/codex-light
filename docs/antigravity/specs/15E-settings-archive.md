# 15E 设置归档：入口归属与开发前待证合同

2026-11-06，仅只读取证，未实现。固定Store26.1027.3384.0；整包基准沿当前阶段清单。下列entry已只读提取到内存并校验SHA-256与asar integrity一致，没有修改安装包。byte位置指整包绝对字节位置；代码锚点另用0-based UTF-16字符偏移。

| asar entry（webview/assets/下） | 绝对byte位置 / 长度 | SHA-256 |
|---|---|---|
| settings-lazy-routes-1c307af3cdd3.js | 562270812 / 12617 | 6369ce4128f0760a17e8bf3dd1ea7afae24781176d1cc6802085aa95734b6834 |
| data-controls-805edc0381e3.js | 272559084 / 41258 | 6cc411eaa6d6612dc14970a3623e34fb04f107feda0b0ce88583c2d483cc0db0 |
| data-controls-settings-3b25a6ba2b0d.js | 272600342 / 47592 | 97bb0fb25a0ec01a79ce589b1b5bb215ebcb169d58b0055dee6a2e36997a757c |

## 先确认工作面，禁止直接套用

settings-lazy-routes:6909将archived-chats导向DataControlsSettings；data-controls-settings:39215的管理入口导航到/settings/archived-chats。对应本项目SettingsView的archived-chats分区。

当前App全局archive路由也共用ArchiveView；官方app-primary-998934e837fc.js:1720292却是专用归档侧栏，尚未证明与当前全页等价。因此下列设置合同不能无条件应用到两处共用组件。需要先明确设置/全局工作面的边界，再实现有完整来源的增量；本文件不要求现在增加闲置surface抽象或改变全局归档。

## 设置工作面已证静态事实

- data-controls:13798默认updated；23846的Fn组合搜索、类型/排序菜单和项目筛选。
- 25084的In在同一筛选菜单中提供类型与排序，updated / created / alphabetical，当前项有勾选；27989为bottom/end/menuNarrow。不是一个独立的官方排序按钮。
- app-primary:1718294按时间降序并以标题打破平局；按字母顺序时标题升序、同标题更新时间降序。
- app-primary:1716663默认按项目分组；项目筛选生效后为单组。平铺列表即使排序正确也不等于整页一致。
- 同版zh-CN:1843932“筛选已归档聊天”、1844109“排序方式”、1845155/1845219/1845277“按字母顺序/创建时间/更新时间”。

## 下一步与验收边界

当前ArchiveView有搜索、服务端更新时间排序和平铺列表；没有上述设置内菜单、排序状态和分组。先补完整菜单条目、类型资格、项目筛选与数据来源合同，不能只截取排序三项后声称菜单一致。云端资格/服务链未知，不能强开gate、填模拟云端结果或静默隐藏官方项来凑页面。

来源充分后才开发：设置挂载默认更新时间；本地生产投影覆盖三种排序和平局；搜索/刷新保持选择；纯排序不增删数据、不发写请求；恢复/删除及进行中保护不回退，全部删除仍指全部本地归档。菜单需验证键盘、Escape、焦点、勾选、边界定位；全局挂载不应被此次设置改动污染。

账号、云端数据与官方同环境像素尚未取证；当前score=null、未开发、未验收。此调研不属于v0.2.0-preview.1功能。
