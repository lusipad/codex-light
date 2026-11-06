# 18F-B PDF 专用预览：开发前合同

日期：2026-11-06。状态：只读取证完成，未引入依赖、未开发。普通文件阶段见[18F-A](../acceptance/18F-library-preview.md)，完整类型矩阵不变。

## 依据与现有能力

固定Store26.1027.3384.0。原包链为pdf-preview-panel-c6a816e685ff → document-73e8fd7128a0 → pdf-460337b5854b → pdf-77396bb07278及46513d3652c6.mjs worker。新增85资源integrity/SHA和21原函数UTF-16锚点见`.ref/parity/18/actual/18F-library-preview/reference/{pdf-manifest.json,pdf-functions.json,pdf-anchors.json,pdf-next-stage.md}`；未重算整包hash，沿用本轮固定清单。

官方使用PDF.js5.4.296与自定义canvas/text/search/thumbnail工作面，不是浏览器内置iframe。项目现有依赖没有PDF引擎；独立原生sandboxed Blob探针未显示文档，不能靠解除隔离或打开外部viewer代替开发。

## 具体依赖提案与约束

候选为独立上游`pdfjs-dist`固定5.4.296，不直接复制官方混合chunk；API/viewer包含官方shared/runtime依赖，worker的Apache声明不授权这些业务代码。采用前先核实该版本发行包、完整性及完整依赖资源许可；主[Apache-2.0](https://raw.githubusercontent.com/mozilla/pdf.js/v5.4.296/LICENSE)、[CMap许可](https://raw.githubusercontent.com/mozilla/pdf.js/v5.4.296/external/bcmaps/LICENSE)、标准字体Foxit/Liberation等notice分别保留。官方包未发现完整CMap/标准字体资源，不把缺失推断成无需支持中文。

仓库AGENTS明确“未获明确请求不得新增依赖”。当前仅准备提案；安装、vendor或复制引擎到产品均需明确授权，不绕过此约束。实际选版前还须核查上游安全公告与当前发行包，官方App使用5.4.296不等于该版本已通过本项目安全选型；必要时选安全兼容版并重新验证行为。可继续不依赖PDF引擎的其他页面。

## 动作与呈现合同

1. 复用18F真metadata和40MiB字节链，受控本地module worker解析。成功页数必须大于0；错误、加密、损坏、取消、重试可区分，不从metadata估算页数。
2. 多页canvas和文字层、懒缩略图、点击页轨与滚动可见页同步；页号钳制边界，默认page-width。真实PDF内部缩放范围30%–800%，不能把通用菜单的几个百分比当完整范围。
3. 缩放前后保存页内中心/鼠标锚点；Ctrl+wheel按已证规则处理。Ctrl+F在PDF焦点内打开文件搜索，Escape先关搜索且阻止外层预览关闭；匹配高亮来自真实文字层。Enter/F3/IME等额外键位仍须继续取证，不凭印象添加。
4. 切文件、关闭、身份变化和离页取消render/loading task，销毁document/worker，撤销Blob并断开observer/listener。旧搜索、页数和晚到结果不能污染新文档。
5. 不执行PDF脚本，不将文件或账号信息送到外部viewer/CDN；外链及注释资格单独核实。当前Library官方annotations=false，不默认增加编辑/保存。

## 验收

先复现并锁定解析失败、取消、页边界与搜索状态，再实现；真实生产worker测试和组件回放分开。至少两页、中文、嵌入/非嵌入字体、不同页尺寸、扫描图片页、损坏/密码文件、40MiB及快速切换场景。最终同源码原生EXE检验宽窄、缩放锚点、焦点、Escape、IME与资源释放；官方同环境配对图和用户确认前不得标像素或整页通过。Office/Notebook、HTML和特殊artifact仍各自保留未完成状态。
