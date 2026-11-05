# 同定位仓库研究（R81）

> **一句话**：把「急救箱」这个定位拆成可比较的能力面——救援 / 诊断 / 回滚 / 升级闸门 / 备份——
> 看清别人已经做了什么，再决定我们补哪一块，以及**哪些只能学机制、不能抄代码**。
> **证据**：`data/results/adjacent-tools-2026-11-05T09-03-11.609Z.json`（140 个 DSH 相关仓库，7 条固定查询）。

---

## 1. 方法与边界

- 查询固定为 7 条（`rescue` / `doctor` / `compatibility` / `diagnose` / `backup rollback` / `topic:dsh-plugin`），每条最多 50 条；
- 只保留名称或描述里提到 `dsh` / `deepseek harness` 的仓库，去重后 **140** 个；
- 分类是**词面分类**（rescue / doctor / compatibility / backup / ops / catalog / context / other），**不是质量判断**；
- 只读元数据（stars / license / pushed_at / 描述），**没有读源码**，也没有验证任何工具能跑；
- `license: null` 表示 GitHub 没检测到许可证 → 按「保留所有权利」处理，**不引用其代码**；
- stars 与 `pushed_at` 是读取时刻的事实，不是采用率或维护承诺。

## 2. 同定位的 12 个（rescue / doctor 词面命中）

| 仓库 | 星 | 许可 | 最近推送 | 它做什么（按 README / 描述） | 可学什么 |
|---|---|---|---|---|---|
| `lire1131/dsh-undo-savepoint` | 200 | MIT | 2026-10-31 | 崩溃救援：撤销配置与插件代码改动、凭据安全快照、一键 SAFE MODE、离线 CLI | **SAFE MODE 的产品形态**：先停第三方，再让用户决定 |
| `sjh9714/dsh-win32` | 158 | MIT | 2026-11-02 | 在原生 Windows 上「修复 + 诊断」：PowerShell、Workspace Write、快捷方式、旧 preset | Windows 失败面的清单（`0xC0000142` / ACL / preset） |
| `PerryLink/dsh-mcp-panel` | 91 | Apache-2.0 | 2026-11-05 | MCP 管理台：健康诊断与 pipeline 追踪 | 诊断结果的产品化（不是只打印日志） |
| `xiaoyuyu6420/dsh-backup` | 39 | MIT | 2026-10-30 | 一条命令备份/恢复/迁移 `~/.dsh`：升级前快照、会话日志修复、进程外救援、凭据脱敏 | **整份 home 的快照 + 脱敏** |
| `mishibeikejie/zat-dsh-launcher` | 24 | MIT | 2026-10-17 | 多实例 Windows 启动器：安装、运行、监控、救援 | 「GUI 起不来时」的入口放在启动器层 |
| `fakechris/dsh-harness-ops` | 16 | MIT | 2026-10-30 | 运维箱：每日快照 A/B 双槽、旧插件迁移+构建+验收后原子切换、一键回滚、10s 守护 | **验收后原子切换**，不是「切了再说」 |
| `Doking233/dsh-lazarus` | 12 | MIT | 2026-11-04 | 描述为空（需读仓库） | 待读 |
| `ningmengxr/dsh-rescue-toolbox` | 6 | MIT | 2026-08-24 | 独立急救箱：诊断问题插件 / 禁用 / 备份恢复，零依赖 Node，双击即用 | 零依赖 + 双击入口 |
| `astra3294/dsh-doctor` | 5 | MIT | 2026-11-05 | 确定性诊断与恢复 | 「确定性」这个词与我们的 Result/证据口径一致 |
| `Iliyasfiel/dsh-rescue` | 0 | MIT | 2026-09-07 | `enter` / `exit` / `status`：只裁剪 `dsh.profile.bundles`，不动 `dependencies`；事务性、可复原、GUI 死了也能用 | **只改 bundles 的最小救援面** 与 exit 的协调恢复 |
| `kingcharleslzy-ai/dsh-purge` | 4533 | MIT | 2026-11-05 | 破甲 + 状态诊断 + 提示词管理 + 更新与本机备份回滚 | 与本项目定位不同；只参考「备份回滚」的产品语言 |
| `realMisakaMikoto/dsh-purge` | 82 | MIT | 2026-11-03 | 同上，适配 0.2.x | 同上 |

> 词面分类会把「提到诊断/回滚」的破甲/运维项目也算进来；**上表已人工去掉与急救定位无关的项**，但保留两行 purge 是为了说明「同一批词会被不同产品共用」。

## 3. 邻接生态（不直接同定位，但决定我们的入口在哪）

- **catalog / market（30 个）**：`awesome-dsh-plugin`（22k）、`dsh-market`（10.8k）、`dsh-plugin-radar`（1.5k）等。它们解决「发现」，不解决「坏了怎么办」。
- **context doctor（10 个）**：`dsh-context`、`dsh-context-doctor`、`dsh-mnemon`。它们诊断上下文/注入，不诊断准入与组合。
- **backup / undo（10 个）**：`dsh-backup`、`dsh-undo-savepoint`、`dsh-config-manager`。它们做快照/恢复，不做「为什么会坏」。
- **compatibility / gating（6 个）**：`dsh-plugin-gating-hub`、`dsh-win32` 等。与我们的四桶/准入最接近，但多数是「升级前闸门 + 回滚点」，没有逐行归因。
- **ops（4 个）**：`dsh-harness-ops`、`dsh-launcher`。它们把「重启/守护」做成常驻能力。

## 4. 我们已经有的 vs 缺的

| 能力面 | 我们已有 | 缺口（别人已经做了） |
|---|---|---|
| 归因 | `why` 逐行准入、`audit` 台账、`compat_verdict` | — |
| 升级预检 | `upgrade --to` 四桶、卡片、面板页签 | 升级后**自动回滚点**（gating-hub / harness-ops） |
| 修复 | `fix`：计划 / `--apply` / `--undo`（只改 `compatibility.json`） | **profile 层**的救援（bundles 裁剪）、SAFE MODE |
| 快照 | 仓库快照 `snapshot_state`（R78） | **用户 `~/.dsh`** 的快照/恢复/脱敏（dsh-backup） |
| 运行期 | `probe` 隔离实测、render 白屏 | Windows ACL / `0xC0000142` 的**诊断脚本**（dsh-win32） |
| 启动失败 | 面板/CLI 都需要宿主能起 | **GUI 死了也能用**的离线入口（dsh-rescue 的 `enter/exit`） |

**结论**：我们不缺「再一个检查器」，缺的是**坏了之后的最小可逆动作**。这与 R47 的「升级日」正门一致：先说会坏什么，再给一条能撤回的修复路径。

## 5. 集成策略（分支优先，不直接改主线）

1. **`rescue` 只读计划**（新分支 `feat/rescue-plan`）：
   - 输入：profile 目录；输出：哪些 bundle 是第三方、裁剪后预计能起、备份路径、`--undo` 命令；
   - 默认 dry-run；`--apply` 才写，写前备份 + journal + 原子替换；
   - **只改 `dsh.profile.bundles`，不动 `dependencies`**（学 dsh-rescue 的最小面，但代码自己写）；
   - 负对照：只读不得写盘；`--apply` 失败必须回滚；`--undo` 逐字节还原。
2. **SAFE MODE 入口**（面板 + CLI）：当 `audit` 判定「有第三方 bundle 且启动失败风险高」时，给一个「先禁用第三方并重启」的按钮/命令；复用 `fix` 的 backup/journal。
3. **`profile snapshot`**：对 `~/.dsh` 做 sha256 快照（排除凭据/会话正文），与仓库快照分开；不复制 dsh-backup 的代码。
4. **互操作而不是替代**：检测到 `dsh-rescue` / `dsh-undo-savepoint` 已安装时，在输出里点名它们并给命令，不重复实现同一动作。
5. **Windows 诊断清单**：把 `0xC0000142` / ACL / `pwsh` 的已知形状做成只读检查（不修系统）。

## 6. 版权与借用规则

- **只学机制，不抄代码**；需要引用代码时，只进 `quarantine/` 并登记 `quarantine/vendor-manifest.json`；
- MIT / Apache-2.0 / BSD-3：可以读、可以独立实现；若复制片段必须保留版权与许可声明（本项目默认**不复制**）；
- **AGPL-3.0 / 无许可证 / `license: other`：不复制任何代码**，只读 README 与行为；
- 本文件的表格是元数据与描述，不是对实现的复制；任何数字以 `data/results/adjacent-tools-*.json` 为准。

## 7. 下一步（BACKLOG）

- `T-853` 同定位仓库采证（本轮完成）；
- `T-854` `rescue` 只读计划 + `--apply` / `--undo`（分支，先负对照）；
- `T-855` SAFE MODE（面板 + CLI）；
- `T-856` `profile snapshot`（`~/.dsh`，脱敏）；
- `T-857` Windows 失败面只读诊断；
- `T-858` 互操作探测（dsh-rescue / undo-savepoint 已安装时点名）；
- `T-859` 借用台账：把本文件的「可学/不可抄」写进 `docs/09-open-source-borrowing.md`。
