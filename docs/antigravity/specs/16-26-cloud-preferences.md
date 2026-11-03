# 16.26A 云端偏好纠偏

2026-11-03，修改前合同。原包 cloud-preferences/settings 三文件已提取核integrity，见.ref/parity/16.26/reference。GET /wham/settings/user读取用户git_diff_mode和branch_format；GET /wham/settings/configs/user-preferences读取实际占位符/最大长度；PATCH /wham/settings/user写最小字段并使用服务响应更新缓存。分支校验依赖服务器special_values，不能硬编码username/task-slug/date。不是本地desktopPreferences或app-server config；没有预设AI/ML/Alpine默认环境与自动同步表单。

当前无该认证云客户端，不读取真实token来凑测试，不发无认证写请求。CP01：撤旧四字段cloudDiffMode/cloudBranchFormat/cloudAutoSync/cloudDefaultEnv及读写/表单，不删除用户旧数据。CP02：显示服务未连接的能力状态，无伪造已登录/无权限/空列表；撤通用保存/刷新/成功横幅。CP03：生产JSX回归与完整检查/原生构建。云端真实读写与分支metadata校验、原生像素未验，整页仍阻塞，不能把纠偏当作1:1完成。
