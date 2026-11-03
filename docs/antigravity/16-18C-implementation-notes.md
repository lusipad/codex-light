# 16.18C 存储资料库根列表与图像读取

状态：定向自验通过，完整非Fast标准检查中；原生构建排在标准成功之后。全App目标继续active，本阶段不是整个Library完成。

## 修改前依据与纠偏

[开发合同](specs/16-18C-library-cleanup-read.md)及 `.ref/parity/16.18/actual/16-18C-research/` 保存固定26.1027.3384.0 asar的原始资源/hash与UTF-16锚点。补齐了shared chunks、wrapper、CSS和中文后才实现，不沿旧卡片CSS猜界面。主要纠偏：

- all根读取GET nodes；images根读取POST list。size desc是已加载页合并后本地排序，不是服务端全库排序；第三次排序切换为取消。
- country设置是GET `/backend-api/settings/user`，不是收藏接口，也不是Wham custom instructions。
- root all仅需真实OneDrive gate收敛include_onedrive，不强开全部外部provider。共享Statsig bootstrap需完整V1/V2、user/account匹配、拒绝delta/live overlay；许可来自真实gate/layer、country及完整官方Odt套餐集合。
- Wham accounts/check明确返回归一accounts数组；套餐读取匹配当前token账号的唯一项，不能把RPC较窄planType=unknown当官方不支持，也不凭手写全套餐样本冒充实际inventory。缺失/重复/拒绝/ordering不含当前账号均不开放。

## 实现与复用

- `libraryClient.ts`复用既有认证/账号/Bootstrap/固定服务；权限前后复核身份。`libraryData.ts`保留真实node元数据，正确映射images、Map去重、cursor止环、导航根/目录优先、size/name比较器。
- `LibraryCleanupView.tsx/CSS`真实all/images、三态排序、临时list/grid、images强制瀑布流并隐藏切换、空/错误/重试、分页失败保留前页。监听成功后才创建读取，认证失效立即撤旧并停读，等待身份刷新或显式重试；scope/tab切换、卸载取消，旧图像晚到不回填。
- 资源不直接信thumbnail_url：固定content_url或file download定位→真实字节→renderer data URL。每跳网络/身份/取消复核，第三方不携带认证头；格式签名拒绝HTML/SVG。只接定位参数，不开放renderer任意URL。8MiB既有上限保留；无新依赖。
- 图片可见后才启动原生下载；宽高比clamp0.5、自然尺寸更新、横图contain，失败回退图标。瀑布流实测最短列并保留追加列分配。
- `App.tsx`、`SettingsView.tsx`、`StorageSettings.tsx`接设置→存储→文件/图像，主导航普通Library仍独立未接通；不以本分支顶替整个Library。

## 先失败后修复

1. sort-cycle-before退出1；qjs三态修复后sort-cycle-fixed退出0，取消排序恢复已加载原顺序。
2. image-lazy-before退出1；可见后才下载修复后image-lazy-fixed退出0，避免仅对已下载data URL设置lazy。
3. 独立复核P2：CDN下载占全局认证锁会卡住nodes/配额。library-image-lock-baseline退出101；取私有认证快照并释放锁后，挂起CDN时nodes/配额可并行完成，library-image-lock-final及主根integration Rust服务层113项通过。没有Debug/Serialize凭证。
4. 本项目html根字号13px，直接使用rem会缩小spacing布局；仅本组件改用既有--spacing、已证实container断点及真实内外row模型。48px gutter/50px行是隔离运行时观察，不是官方1px验收。

## 验证与缺口

生产parser 120页、真实client/身份/权限及TSX生命周期/排序/分页/图像/Masonry专项和本地TypeScript退出0。真实Rust images/settings/image bytes ServiceResponse经生产TS客户端贯通退出0，证据library-read-native.log/.exit；主根library-integration-rust.log/.exit为113通过。

浏览器生产组件＋真实客户端＋隔离IPC：存储入口、分页失败保留与重试、all排序、1280×900及640×900、图像实际PNG加载和认证失效清旧。640宽documentWidth=640、两列瀑布流、无横向溢出；图像夹具为真实Rust服务测试输出1×1 PNG，不是线上用户图片。`browser/verification.json`及截图留证，无官方配对图，visual-verdict不评分。

普通Library/推荐/收藏/目录与文件打开、URL/deep link、外部root/账号filters、上传/删除/回收站、完整资源provider映射及处理中15秒/10次退避尚未接通。真实账号HTTP、原生GUI/IME、同环境官方像素、用户验收均未完成。格式签名不等于完整图片解码；native URL保护是本地边界，不声称恢复官方全部URL策略。
