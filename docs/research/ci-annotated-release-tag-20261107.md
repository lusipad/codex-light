# 2026-11-07：附注发布标签复核失败

精确源码2aef033fceeb1246a408c680d4265551d115a76b的分支run42273942594/job128085308784完整success：81前端、580全库Rust零失败/忽略/过滤、通知适配器、程序与MSI/NSIS通过。标签run42273942595/job128085309998同样通过测试、构建与artifact上传，最后Revalidate Release Tag失败，Publish未执行；不能把该标签作业标成功。

日志直接记录Actions checkout按 `+2aef033...:refs/tags/v0.2.0-preview.8` 抓取提交，生成本地轻量标签；远端同名是附注标签，解引用到同一提交。随后 `git fetch origin --tags` 报 `would clobber existing tag`。两者的提交一致而Git对象表示不同，本轮使用附注标签触发了原工作流缺陷。

修复只抓取指定远端标签至独立 `refs/codex-release-tags/<tag>`，解引用commit后与精确GITHUB_SHA比较，不替换checkout标签，不force移动远端标签。新增真实私有Git仓库回归复现bulk fetch冲突、轻量/附注兼容、远端指向不同提交或标签缺失时拒绝；修改前remote mismatch断言实际失败，修改后退出0。版本、checkout、已有标签及notes等原验证保留。

本次preview.8补发载荷取自完整success分支run42273942594的artifact13533870644（source=2aef033），不是失败标签作业的产物，也没有混入21G工作树。artifact ZIP实际下载大小20,899,386及API digest核对；三个载荷SHA256SUMS、便携ZIP六文件及五许可对精确Git blob核对后，重新验证原远端附注标签，再发布。发布后四个真实release资源另行下载复核，见 `.ref/releases/v0.2.0-preview.8/verification.json`。

原自动标签发布仍保留failure记录；该次补发不证明修后完整tag工作流已经实跑成功。后续标签发布需再观察实际自动发布路径；不能靠移动旧标签或跳过校验消除失败。源与日志摘录、实际红绿、下载校验均在 `.ref/releases/v0.2.0-preview.8/`。

最终补发核验通过：[preview.8](https://github.com/lusipad/codex-light/releases/tag/v0.2.0-preview.8)四资源逐一对API digest/size与SHA256SUMS复核，且逐字节哈希等于成功CI artifact载荷；便携EXE SHA256 `632b155e5393b5d9a11e87fa13d36fe9eb26f721807defc3ce85121b5cbe038f`。未运行下载的二进制；真实账号/像素/物理IME和用户验收缺口不变。
