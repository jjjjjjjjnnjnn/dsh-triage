# 04 · Admission 语义（对等基准）

> **Stand**: v0.1.0-skeleton (2026-10-26) | 实现：`packages/core/src/admission.ts` | 金标：`data/gold/admission-cases.json` | 门禁：`scripts/gate_admission_parity.mjs`

## 1. 上游原文（唯一真相源）

来自 `@deepseek-ai/dsh-app-boot@0.2.1-rc.2` README（admission 段）：

> Before a profile imports a plugin, DSH checks its declared DSH requirement against the single runtime version returned by `getDshRuntimeVersion()`. When the manifest declares `engines.dsh`, that range alone decides and `peerDependencies` are ignored. Otherwise every `peerDependencies` range on `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` must match, and source-workspace `workspace:^`, `workspace:~`, and `workspace:*` peers refer to that same runtime. Prereleases participate in range matching. A manifest with neither declaration imposes no constraint; empty or invalid ranges, including a `workspace:` value in `engines.dsh`, are incompatible. A non-object `engines` or a non-string `engines.dsh` is a malformed manifest. A refusal names the unmet requirements, keyed `engines.dsh` or by peer package name.

以及后果：

> A denied ordinary row becomes a detached `disabled: true` row … every refusal is reported with the package, versions, and risk.

## 2. 规则化（本仓实现口径）

| # | 规则 | 实现位置 |
|---|---|---|
| R1 | `engines.dsh` 存在（字符串）→ **只有它**决定，peer 全部忽略 | `evaluateAdmission` |
| R2 | 否则 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 peer **全部**满足才放行 | `evaluateAdmission` |
| R3 | prerelease 参与匹配（`semver` + `includePrerelease: true`） | `evaluateRange` |
| R4 | 空串 / 非法区间 / `workspace:` → **不兼容**（注意：`semver` 会把 `''` 当 `*`，必须特判） | `evaluateRange` |
| R5 | 无 `engines.dsh` 且无 dsh peer → **无约束**（`unconstrained`，不是 `admitted`） | `evaluateAdmission` |
| R6 | `engines` 非对象 / `engines.dsh` 非字符串 → 畸形清单 → 拒绝 | `readEnginesDsh` |
| R7 | `@deepseek-ai/cordis` 等非 dsh 作用域 peer **不参与** | `isAdmissionPeer` |
| R8 | 运行时版本未知 → `indeterminate`（绝不默认放行） | `evaluateAdmission` |

**R5 的意义**：`unconstrained` 不是好消息。实测 195 个插件里 29% 属于此类——声明不可判，只能靠 probe。把它写成 `admitted` 就是撒谎。

**R3 的坑**：`^0.2.0` 在 `includePrerelease` 下**会**匹配 `0.2.1-rc.2`。这与很多人的直觉相反，必须由金标锁死。

## 3. 金标夹具的构成

- 13 个 synthetic 用例：逐条钉死 R1–R8 与边界（空串、非法、workspace、畸形类型、OR 列表、精确钉死版本）。
- 8 个 real 用例：从 npm registry 抓的真实 manifest 快照（`recorded_at: 2026-10-26`），覆盖「声明健康」与「声明失配」两类真实写法。
- 每例必须写 `why`（为什么这个期望成立），否则 `tests/contract/admission-golden.test.ts` 红。

## 4. 已知不确定（诚实边界）

1. 上游若改用自研区间实现或更改 prerelease 处理，我们会出现系统性偏差 → 每次基线升级必须重跑 parity 门（`audit/blind_spots.json` BS-02）。
2. `workspace:` peer 在源码工作区内是合法的；对已安装的第三方插件我们判 `denied`，这是一个**保守选择**，已在夹具中显式记录。
3. 本模块只判定「声明层」；运行期行为（是否注册上工具、前端是否渲染）不在它的能力范围（BS-01）。
