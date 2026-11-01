# 工作区变动清点与可恢复记录 (Change Inventory) - 原始保全基准 (25/51)

- **快照 Run ID**：`20261027-ag00-01`
- **原始快照生成时间**：2026-10-27T02:14:49.479Z
- **工作目录**：`D:\Repos\codex-desktop-native`
- **Git 分支**：`master`
- **关联远程分支**：`origin/master` (`https://github.com/lusipad/codex-desktop-native.git`)
- **HEAD 提交哈希**：`380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7`
- **HEAD 提交信息**：`Preserve user intent while aligning desktop conversation behavior`
- **远端同步状态**：`HEAD...origin/master` 一致 (ahead 0, behind 0，基于本地远程跟踪分支)

---

## 1. 原始保全物理备份范围与位置 (真实覆盖 25 Tracked / 51 Untracked)

为严格遵循 AGENTS.md 准则，所有接手时的现有代码与未跟踪文件均已在本地物理隔离目录建立完整镜像：

1. **工作树补丁文件**：
   - 路径：`.ref/parity/recovery/20261027-ag00-01/working-tree.patch`
   - 说明：包含接手时 **25 个已跟踪修改文件**（相对 HEAD `380c32c`）的完整 Unified Diff。
   - 补丁文件 SHA-256：`342cc5cfe58e7a1fad7a8be9ed51cdc8194a15bbb464dda45aa682ed1bce7d43`。
2. **完整状态快照清单**：
   - 路径：`.ref/parity/recovery/20261027-ag00-01/file-inventory.json` 与 `git-status.txt`。
3. **未跟踪文件物理备份**：
   - 物理备份目录：`.ref/parity/recovery/20261027-ag00-01/untracked/`
   - 说明：包含接手时 **全部 51 个未跟踪文件** 的物理拷贝（磁盘文件数精确为 51，保留原始目录层级）。
4. **范围澄清 (F2 纠偏说明)**：
   - **本镜像仅且精确覆盖 25 个已跟踪修改文件与 51 个未跟踪文件**。
   - 严禁将后续返工过程中新产生的规约文件、测试脚本或验收报告（如 `AG00-review-*.md`、`verify-unit-01a-shell.mjs` 等）混同称为“已保存在本原始备份中”。后续新产生的文件见本文第 5 节独立记录。

---

## 2. 最近 3 次提交基线记录

```text
380c32c Preserve user intent while aligning desktop conversation behavior
5472178 docs: record round 9 1:1 parity and full surface verification
e88ef22 feat(header): add token usage meter, scheduled search, and full settings palette index
```

---

## 3. 原始快照已跟踪改动清单 (25 Files)

| 文件路径 | 状态 | HEAD SHA-256 (前12位) | 原始工作区 SHA-256 (前12位) | 大小(字节) |
|---|---|---|---|---|
| `AGENTS.md` | M | `d5f7561bc1cb` | `756cfe6cfff8` | 16,178 |
| `docs/IMPLEMENTATION-LOG.md` | M | `012498a34186` | `0aeec96e44b2` | 97,435 |
| `docs/PAGE-PARITY-PLAN.md` | M | `6ef30e2fd55a` | `0b12cfa0c1ae` | 16,717 |
| `docs/research/pages/01-home-shell.md` | M | `8575a7ecb9d0` | `fe0177ad99de` | 5,326 |
| `docs/research/pages/02-thread-basics.md` | M | `887719453eee` | `4e175eec1928` | 7,104 |
| `docs/research/pages/03-thread-execution.md` | M | `930f7c2534a9` | `261c92ff8a03` | 37,513 |
| `scripts/verify-all.ps1` | M | `7c6d6b25abf1` | `e27aa9de3b20` | 5,054 |
| `src/App.tsx` | M | `6fbe23cf2ec3` | `83c0ba60dbde` | 217,426 |
| `src/components/AutomationsView.tsx` | M | `0f5d779544e3` | `095355a97483` | 44,789 |
| `src/components/CodexSidebar.tsx` | M | `60baa5ceb1f5` | `c856863d2992` | 53,297 |
| `src/components/ComposerBox.tsx` | M | `767c6e163646` | `055a2cf07708` | 29,901 |
| `src/components/DiffDrawer.tsx` | M | `1461a0f2d944` | `1771753cb11c` | 83,485 |
| `src/components/FileExplorer.css` | M | `59acdd71a5c3` | `28eb6c8235bc` | 4,594 |
| `src/components/HotkeyWindow.tsx` | M | `868c46ba631b` | `902c35b4093d` | 9,856 |
| `src/components/Icons.tsx` | M | `2d2b3dee6928` | `9b464f57106f` | 28,882 |
| `src/components/PlanPanel.tsx` | M | `79cf674f44ad` | `b4bd2e8609e7` | 5,166 |
| `src/components/QuickSearchModal.tsx` | M | `24b4f3bd9381` | `0ac9e680b97e` | 30,041 |
| `src/components/SideChatPanel.tsx` | M | `4052c3139102` | `c473f7bcc6b3` | 9,091 |
| `src/components/SkillsMcpView.tsx` | M | `3c1822814291` | `5905a70af8bc` | 81,058 |
| `src/components/TerminalDock.tsx` | M | `4fd9155e01d1` | `81a5e4abc86f` | 12,242 |
| `src/components/ToolCallCards.tsx` | M | `d32b000f73a3` | `d6b5d57c7891` | 6,766 |
| `src/components/WorktreesView.tsx` | M | `5bbeb8b1a37b` | `8bcc0d567bcb` | 11,192 |
| `src/protocol.ts` | M | `7062cdf444ad` | `29941d83d779` | 12,711 |
| `src/styles.css` | M | `405c9c2d4a73` | `5df9b2b5c01b` | 141,242 |
| `src/threadTimeline.ts` | M | `d48a01d53093` | `1271b871ecad` | 8,676 |

---

## 4. 原始快照未跟踪文件清单 (51 Files，全部物理备份于 untracked/)

- `.omx/state/parity-01/ralph-progress.json` (SHA-256: `a2a16c9ae873`, 906 字节)
- `.omx/state/parity-02/ralph-progress.json` (SHA-256: `704ca14e325d`, 508 字节)
- `.omx/state/parity-03/ralph-progress.json` (SHA-256: `5a19f1a64f19`, 841 字节)
- `docs/antigravity/ACCEPTANCE-STANDARD.md` (SHA-256: `0566ab297034`, 12,290 字节)
- `docs/antigravity/AUDIT-STARTPOINT.md` (SHA-256: `0e3804cc94f4`, 3,168 字节)
- `docs/antigravity/HOME-SPEC.md` (SHA-256: `963f81dd1521`, 14,655 字节)
- `docs/antigravity/PAGE-BACKLOG.md` (SHA-256: `396bb183ac77`, 22,464 字节)
- `docs/antigravity/README.md` (SHA-256: `7d665d11ef2e`, 14,239 字节)
- `docs/antigravity/START-HERE.md` (SHA-256: `590ce060f253`, 4,013 字节)
- `docs/antigravity/TEMPLATES.md` (SHA-256: `39b34ef3db39`, 7,989 字节)
- `docs/research/pages/00-baseline-and-evidence.md` (SHA-256: `1a8ad226818f`, 3,497 字节)
- `docs/research/pages/04-thread-organization.md` (SHA-256: `7df3fa2736f8`, 6,085 字节)
- `docs/research/pages/05-files-worksurface.md` (SHA-256: `b203439d794b`, 6,243 字节)
- `docs/research/pages/06-git-changes-worksurface.md` (SHA-256: `77726678a261`, 5,828 字节)
- `docs/research/pages/07-terminal-and-layout.md` (SHA-256: `94e8fc4ed896`, 4,717 字节)
- `docs/research/pages/08-search-command-palette.md` (SHA-256: `b47742e076b3`, 4,863 字节)
- `docs/research/pages/09-activity-inbox.md` (SHA-256: `670fdebc312e`, 3,941 字节)
- `docs/research/pages/10-scheduled-automations.md` (SHA-256: `559c914c0e16`, 4,439 字节)
- `docs/research/pages/11-worktrees.md` (SHA-256: `d0d55c0f6438`, 3,932 字节)
- `docs/research/pages/12-plugins.md` (SHA-256: `268f96b925db`, 3,545 字节)
- `docs/research/pages/13-skills.md` (SHA-256: `2f4fdd6aac23`, 2,940 字节)
- `docs/research/pages/14-code-review.md` (SHA-256: `e2dc6e127b08`, 2,607 字节)
- `docs/research/pages/15-archive.md` (SHA-256: `4ad255981b85`, 2,371 字节)
- `docs/research/pages/16-settings-center.md` (SHA-256: `74e9e194c155`, 3,151 字节)
- `docs/research/pages/17-23-extended-worksurfaces.md` (SHA-256: `839aad67c13a`, 2,549 字节)
- `handoff.md` (SHA-256: `b7290a542a95`, 13,980 字节)
- `scripts/extract-asar-file.mjs` (SHA-256: `6edd334b4ae4`, 1,990 字节)
- `scripts/find-reasoning-render.mjs` (SHA-256: `30ff7ff6772c`, 599 字节)
- `scripts/verify-activity-inbox.mjs` (SHA-256: `ca83b2c6ed00`, 2,133 字节)
- `scripts/verify-archive.mjs` (SHA-256: `b675ec272228`, 1,165 字节)
- `scripts/verify-code-review.mjs` (SHA-256: `c8a98deebe21`, 1,710 字节)
- `scripts/verify-composer-keys.mjs` (SHA-256: `87181abb0626`, 3,838 字节)
- `scripts/verify-duplicate-message-fix.mjs` (SHA-256: `ffcf2a1aa51d`, 3,239 字节)
- `scripts/verify-execution-items.mjs` (SHA-256: `edf80b850189`, 7,462 字节)
- `scripts/verify-extended-worksurfaces.mjs` (SHA-256: `38fbf6c1a31c`, 1,927 字节)
- `scripts/verify-files-worksurface.mjs` (SHA-256: `1f7ed1f4c3c9`, 2,818 字节)
- `scripts/verify-git-worksurface.mjs` (SHA-256: `4144bfa59a7a`, 2,889 字节)
- `scripts/verify-misc-tools.mjs` (SHA-256: `ab8417b1cc09`, 3,027 字节)
- `scripts/verify-plan-goal.mjs` (SHA-256: `9899d918b75f`, 6,251 字节)
- `scripts/verify-plugins.mjs` (SHA-256: `574219fbbfec`, 1,577 字节)
- `scripts/verify-projects-sections.mjs` (SHA-256: `e77f13fc4913`, 5,469 字节)
- `scripts/verify-reasoning-rendering.mjs` (SHA-256: `186717f039e7`, 5,906 字节)
- `scripts/verify-scheduled-automations.mjs` (SHA-256: `de8f1cacd3dc`, 1,766 字节)
- `scripts/verify-search-palette.mjs` (SHA-256: `571de3e4cf89`, 1,631 字节)
- `scripts/verify-settings-partitions.mjs` (SHA-256: `a94eacc6739b`, 2,253 字节)
- `scripts/verify-skills.mjs` (SHA-256: `6ce5d58a919d`, 1,560 字节)
- `scripts/verify-terminal-layout.mjs` (SHA-256: `fc0cf51fa0d7`, 2,710 字节)
- `scripts/verify-tool-cards.mjs` (SHA-256: `e487d0b38e83`, 9,296 字节)
- `scripts/verify-unit-01-home-shell.mjs` (SHA-256: `2e8101e530da`, 4,786 字节)
- `scripts/verify-unit-02-thread-basics.mjs` (SHA-256: `0496f4454b90`, 4,184 字节)
- `scripts/verify-worktrees.mjs` (SHA-256: `e400a2d02ec5`, 1,627 字节)

---

## 5. 补充说明：AG-00 执行及返工过程中新产生的文件 (不属于原始镜像)

以下文件为后续执行 AG-00 审计及 01A 方案时新创建的文件，保存在工作区，未进入上述原始 51 文件物理镜像：
- 规约文档：`docs/antigravity/specs/01-home-shell.md`、`docs/antigravity/acceptance/01A.md`、`acceptance/AG00-review-*.md`；
- 审计报告：`docs/antigravity/runs/20261027-ag00-01/claim-audit.md`、`test-capability-audit.md`；
- 新脚本：`scripts/verify-unit-01a-shell.mjs`；
- 产物构建记录：`.ref/parity/01/runs/20261027-ag00-01/build-01a.json`。

如需对后续新增内容建立独立归档，应使用独立 ID 生成补充快照，不得篡改原始 25/51 快照的历史范围。
