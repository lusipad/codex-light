# 01B续：置顶与最近排序

日期：2026-10-30。上一目标轮已实现分页/增量并产生可核验证据，属于进展。本轮继续01B，不放行01C，也不缩小“逐页推进开发”目标。

## 修改前合同

官方initial SHA577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1：vpn1972168、ypn1972519使用recencyAt空值回退；smn1985068最近排序降序，同值保持输入顺序。amn1984355的Pinned默认manual，经umn保留storedPinnedOrder，未存新项放末尾，不能按最近更新时间重排。

当前Sidebar错误：pinnedThreads从已按最近时间排序的数组filter，丢掉pinnedThreadIds中已保存的顺序；最近时间用逻辑或回退，把有效0值当作缺失。ThreadSummary没有声明协议提供的recencyAt，迫使调用点使用any。

计划：先用实际Sidebar组件分别复现置顶逆序与0值错误；仅改Sidebar排序和ThreadSummary字段，复用现有pinnedThreadIds与时间数据；补刷新、同值、过滤场景，再跑标准检查及对应源码release验证。

## 明确不做猜测性归属修复

官方Kkn2284700 assignment优先，Okn2278780旧cwd分组为规范化路径精确匹配；G_n2056446的现代catalog又有cwdPrefixes和include/exclude。现有工作区ID实际为路径，不能冒充协议projectId。null也不总是显式projectless，官方有独立标记。因此本轮不把startsWith简单替换成“最长路径优先”，不声称多项目已对齐。

## 其他已发现缺口

官方菜单n4o8060830仅列updated_at/manual；created_at旧偏好会归一为updated_at。当前菜单仍含created_at，手动排序尚未完整实现。完整手工拖动涉及分项目/Recent存序、保留不可见项、历史新发现项与显式新建项不同位置等，不能以“保留当前后端数组顺序”冒充手动排序。本轮只关闭下方有确定回归的两项缺陷，以上继续记录待实现。

## 自验结果

- before.log记录实际Sidebar组件原先将pin-c/pin-a/pin-b按时间重排的失败，退出1；修复后after.log退出0。时间0值的旧逻辑另在隔离临时副本还原，recency-counterexample.json记录当前用例正确拒绝旧行为，未修改真实产品来制作反证。
- 完整verify-all退出0，使用显式独立CODEX_HOME与空API key；包含既有分页、折叠、窗口状态和新增排序回归、TS/构建/cargo check、17项automations（13项过滤）与原协议探针。无独立lint配置，不声称lint或全量Rust通过。
- release退出0。114份编译输入、dist实存归档，构建后与归档哈希一致；build.json记录EXE SHA/大小。
- 原生使用本轮独立native-home，只从前轮明确回放语料复制sessions和session_index，没有复制认证或SQLite。真实CLI重新索引后，用thread/name/set为3条样本命名，并独立核对后端recent顺序与保存的pinned IDs不同。native-fixture.json和cases/native-fixture-setup.json为真实协议记录。
- 同一隔离数据：旧构建显示SECOND→THIRD→FIRST，新构建显示FIRST→SECOND→THIRD，与存序一致。两个完整原生窗口截图及UIA树见actual/，未发送模型任务。0值/同时间/更新与暂缺条目由实际组件L2覆盖，不冒充物理场景全通过。
- 截图为JPEG、数据为明确回放样本；不是官方同环境逐像素通过或真实生成生命周期验证。测试窗口已关闭。

产品仅改CodexSidebar.tsx排序与types.ts的recencyAt字段，复用原pinnedThreadIds存序；没有新增排序服务、依赖或CSS。没有提交/推送。

可运行产物：`dist-artifacts/01B-ordering-20261030/CodexNative.exe`。

## 后续可直接执行的调研结论

以下是下一批合同，不表示已实现：

| 项 | 官方依据 | 实施时必须保留的语义 |
|---|---|---|
| 手动模式入口 | n4o8060830、b_n2050016 | 菜单只updated_at/manual，旧created_at/priority偏好归一到updated_at |
| 项目线程拖动 | J2o8059726→P0n2704863→DIn23760xx | 只manual模式保存；只替换可见子序列，保留不可见存序，不能以可见5条覆盖历史序 |
| Recent拖动 | q2o8059515、$2o8060310、rmn1983343 | 只manual模式保存；未存项放头，保留未加载key |
| 项目中新发现历史项 | TIn2375538、kIn/PIn2376xxx | 未存历史项追加尾；不等于显式新建 |
| 明确新建项目会话 | I0n27052xx→shared Qjt2002141 | 新ID prepend；不能把所有新增读到的历史项一律prepend |
| 切manual | G2o80589xx→K2o/H0n | 捕获当前可见项初始化缺失order；已有order不覆盖；普通拖动不自动切manual |
| 项目归属 | Kkn2284700、Okn2278780、G_n2056446 | assignment和projectless独立语义优先；旧精确路径与现代scope prefix不能混写为最长前缀 |

状态：两个确定排序缺陷自验通过、待用户验收；01B其余合同及全局逐页目标仍进行中，不放行01C。
