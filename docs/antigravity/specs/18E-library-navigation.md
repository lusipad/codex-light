# 18E 普通资料库目录浏览合同

日期：2026-11-06。状态：本地功能开发及自验完成，未用户验收。承接18–22D真实鉴权资料库读取；恢复正常目录操作，不以清理页代替浏览工作面。

## 基准与来源

固定官方Store26.1027.3384.0，asar整包SHA256沿同会话15I核验为6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074。本阶段直接核header及12条目integrity、25个原函数/中文UTF16锚点、3项原导航函数序列，见`.ref/parity/18/actual/18E-library/reference/assessment.md`、manifest/anchors/pure-navigation-results。源码锚点不是运行时账号或像素证据。

官方链：dKi读取nodes并以parent_directory_id限定目录；_$s目录分支保存已知祖先并导航；NMs把ID编码为单路径段并保留scope query、清普通目录搜索；jNs读取directories/path；ba过滤root及选择祖先；Yi按实际宽度折叠父级、末项aria-current=page。普通根当前仍是本项目列表工作面，完整统一browse/GridList另有缺口。

## 实施与验证合同

1. 保留LibraryAccess真实账号、地区与来源gate及身份失效监听。监听成功后才读权限；失败可重试，不显示空库。身份失效取消旧list/path/paging并清祖先及目录，重新读取根。
2. readLibraryPage兼容原cleanup调用，目录读取只增真实parent_directory_id，不开启Pages/外部provider。固定只读library_directory_path operation仅GET `/backend-api/files/library/directories/path`，仅directory_id参数，身份/取消沿既有服务边界。
3. path独立解析items的id/name/is_root，不要求kind/cursor；保留原字段。畸形结果可见失败，不伪造完整祖先。已知点击链仅作暂时导航，服务确认path优先。
4. 普通native folder使用真实ID进入，鼠标和Enter/Space可达，重复激活不重复请求。list/path各自loading/error/retry，祖先/根出口保留。目录切换立即失效旧控制器，旧数据/分页/错误不污染新目录。
5. 每目录独立pages/cursor，空中间页仍能继续、重复cursor保留已加载项并报错。根与祖先裁剪导航链，当前末项不可点击且aria-current=page；宽窄父级折叠菜单和焦点需实际组件验证。目录栈接现有标题栏前进/后退；目录栈无可用动作时才回原页面历史。祖先/根点击是新导航，裁剪已知祖先不等于清浏览历史。浏览器地址/深链接与跨页重返目录尚未接入，不冒称NMs完整路由一致。极长当前目录在窄窗可能按原Yi仅显示当前截断项，返回仍可由标题栏执行；根项按原Yi仍为按钮。
6. 原cleanup all/images、图像reader及鉴权合同必须回归。文件仅显示真实元数据；没有来源的通用预览、上传和写操作不增加。

## 用例与验收

18E-A01–A10完整步骤见assessment：根真实结果、目录打开、分页晚回、重复激活、身份切换、空中间页、list/path各类失败、祖先与返回、cleanup回归、宿主白名单/身份/取消。实现后逐项记录实际范围和证据，不从组件当前输出反推官方预期。

交付检查：聚焦数据/客户端/真实组件回归、受影响服务Rust测试、TypeScript/Vite、完整非Fast标准及当前Tauri构建；宽窄浏览器与私有原生只覆盖可用条件。真实账号服务未访问、官方同环境配对图/物理IME/用户验收缺证均保持未验证。外部provider、shared/Space/Pages混合、完整tab/筛选/预览和全工作面布局不能因本目录链完成而标已验收。

阶段结果及剩余差异见[18E记录](../acceptance/18E-library-navigation.md)。

## 普通目录地址与搜索恢复

重新核对 Store `26.1103.4239.0`（asar SHA-256 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`）。`104742.22cdbc06fe.js` 45610–48550 的 `tp/tf` 解析和生成 `/library`、`/library/d/<编码 ID>`，支持 `tab`、`search`、重复 `category` 和 `source`。默认推荐省略 tab；空搜索省略 search。目录 ID 是不透明值，路径中只能占一个编码段。

验收。主窗直接打开普通目录 URL，先确认账号和资料库资格，再读取该目录及真实路径。显式地址优先于已保存的上次标签；从侧栏进入时仍应用当前账号偏好。目录切换、标题栏前后退和搜索编辑更新地址，搜索每次替换地址而不增加历史。账号失效时清除原目录和搜索，设置清理视图继续独立。只接普通原生范围，外部 provider、虚拟集合、收藏、垃圾箱与独立预览路由另验。标题栏沿用应用目录栈，地址同步用 replaceState，浏览器历史栈仍与官方路由器有差异。
