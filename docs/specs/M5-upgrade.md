# spec · M5-b 升级影响清单：`dsh-triage upgrade --to <version>`

> **Stand**: R41 之后（2026-10-29）｜状态：**本轮实现（`T-502`）**，本文件先定判据与负对照
> **前置**：`docs/05-verdict-contract.md`（四态 / tier / 置信度）、`docs/specs/M2-capabilities.md`（「只交付事实与边界」的写法）、`BS-38`（同一 `包@版本` 在 0.2.1-rc.4 与 0.1.0-rc.6 上两张结论都成立）
> **依赖**：`packages/core/src/admission.ts`（规则序冻结）、`packages/core/src/verdict.ts`（`verdictFromAdmission` / `verdictsFromRowAdmission`）
> **一句话**：这一层只回答「**我的这套组合里，哪些 loader row / bundle 会在目标运行时上被 admission 拒掉，现在该怎么改**」。它**不**回答「升级之后还能不能用」。

## 1. 这一层回答什么、不回答什么

| 回答 | 不回答 |
|---|---|
| 目标运行时 `<to>` 上，**哪一个** loader row / bundle 会被拒（点名 row id、模块、声明区间） | 这些插件在 `<to>` 上**能不能跑**（没有 boot 实测，`probe` 才有，且默认不跑） |
| 现在拒、`<to>` 上会放行的那几个（`improved`） | 功能行为、API 兼容、配置项是否改名、数据是否迁移 |
| 没有声明 / 包没装 / 声明不可用时，**缺哪条证据**才能判 | 未安装的插件会不会受影响（`BS-38`：没装就没有行可以判） |
| 每一条拒掉的**同一个**修复命令（与 `why` 逐字同一份 `remediation[]`） | 别的 profile 会不会受影响（答案永远只关于**这次读到的那个 profile**，名字写在输出里） |
| registry 上有没有**别的版本**声明了 `<to>`（次要证据，仅供去找版本） | 「装 0.2.3 就能用」——那是声明层的一句话，不是测量 |

**范围纪律**：本层的每个桶都必须是**声明层的一次求值结果**。凡是要知道「跑起来会怎样」的判断，一律留空并写 `missing.*`。

## 2. 输入

| 输入 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `--to <version>` | **是** | 精确 semver（`0.3.0`、`0.3.0-rc.1`），**禁区间**（`^0.3.0` / `>=0.3` / `latest`） | 目标运行时。不是版本 → 退出码 `2`（§8），**不读 profile、不产出清单** |
| profile | 三者取一 | ① 本机 profile（`--profile` + `--dsh-home`，默认 `web` + `$DSH_HOME`）；② `--snapshot <file>`（§2.1）；③ 快照里的**显式 bundle 列表**（`rows: []`，即「只问我这几层」） | 「读到的那个 profile」决定结论适用面 |
| 当前运行时 | 随 ①/② 来 | `env.dsh`（精确版本或 `null`） | **没有单独参数**：判据只能有一个"当前"，多一个参数就多一次"声称 A 判 B"的机会 |
| registry | 否，**默认关** | `--registry` | 只为 `would-be-denied` / `cannot-tell` 的包查「有没有别的版本声明了 `<to>`」；纯注解（§6） |

- **默认离线**：不传 `--registry` 时这一层**零网络**。`packages/core/src/upgrade.ts` 里不出现 `fetch` / `node:http` / `node:net` / `node:tls`（与 `outcome.ts` 同一条纪律，由单测的源码扫描钉住）。
- **本机只读**：只读 profile 的 `package.json` / `cordis.patch.yml` / 已装包的 `package.json`（沿用 `loadComposition` / `resolveRows`）；不写 `~/.dsh`。

### 2.1 `--snapshot` 的形状（新格式，本 spec 定义）

```jsonc
{
  "schema_version": 1,
  "profile": "web",                 // 必填：答案属于谁
  "dsh": "0.2.1-rc.4",              // 可选：捕获时的运行时；null/缺失 = 当前未知
  "bundles": [                      // 必填（可为 []）
    { "name": "@deepseek-ai/dsh-base", "version": "0.2.1-rc.4", "manifest": { /* 原样 package.json */ } }
  ],
  "rows": [                         // 必填（可为 []，"显式 bundle 列表"就是这一项为空）
    { "rowId": "compat-status", "module": "@deepseek-ai/dsh-status",
      "source": "bundle:@deepseek-ai/dsh-base", "version": "0.2.1-rc.4", "manifest": { /* 或 null = 未安装 */ } }
  ]
}
```

校验（任一不满足 → 退出码 `2`，**不回退去读本机 profile**）：`schema_version === 1`；`profile` 非空字符串；`bundles` / `rows` 是数组；每个 bundle 有 `name` + `manifest`；每个 row 有 `rowId` / `module` / `source` 且 `manifest` 是对象或 `null`。`dsh` 存在时必须是合法版本或 `null`。

> 为什么不复用 `--snapshot` 现有的含义：`audit --snapshot` 读的是**运行时 inventory 采样**（回答"相位"），本命令读的是**声明层组合快照**（回答"声明"）。两者都叫「一次采样的冻结」，但内容不同；本 spec 要求 CLI 文档把两个用法分开写（`--snapshot` 对 `audit` = inventory，对 `upgrade` = composition）。写快照不是本任务范围（§11）。

## 3. 判定单元与判定函数（不许有第二套规则）

**单元**：每个 loader row 一条、每个 bundle 一条 —— 与 `why` 判的单位相同（`rowTargets` → `resolveRows` 的 `RowDeclaration`，`loadComposition` 的 `BundleLayer`）。

**与 `why` 的一处刻意差异**：`why` 的终端输出把 row **按模块分组**（20 行同一个包只打印一张卡）。本层**不分组**：一个 row = 一个单元。理由是可执行性 —— 修复动作是 `disable-entry` 并点名**某一条** row，分组会把「哪几行」藏回文案里。代价是 row 数即行数（`counts.rows` 是行计数，不是模块计数），这一点必须写进产物。

**求值**（`packages/core/src/upgrade.ts#judgeUpgradeImpact`，纯函数：无 fs、无网络、无时钟）：

| 步 | 做什么 | 为什么不能自己写 |
|---|---|---|
| 1 | `evaluateAdmission(manifest, target)` | admission 语义（`engines.dsh` 优先 → 否则 `@deepseek-ai/dsh*` peer 全 AND → prerelease 参与 → 空/非法区间不可兼容）由金标 `data/gold/admission-cases.json` 锁死；重写一份就等于把第二套规则带进产品 |
| 2 | denied 的 row 用 `verdictsFromRowAdmission({ env: {...env, dsh: target}, rows: [row], generatedAt })` 拿 verdict | 这就是 `why` 在 target 上会打印的那张卡：row-scope 原因 + `admission.unmet.*` + `pin-version`/`downgrade-dsh`/`allow-version`/`probe`/`disable-entry` |
| 3 | 其余（admitted / unconstrained / bundle）用 `verdictFromAdmission({ env: {...env, dsh: target}, subject, admission, manifest, generatedAt })` | 与 `check` 同一条链；bundle 没有 row，用不到 row 化的 `disable-entry` |
| 4 | `current` 侧同样只调 `evaluateAdmission(manifest, env.dsh)` | `improved` 需要「现在拒」，而"拒"必须与 `why` 的"拒"是同一个判断 |

**硬约束**：`env.dsh` 在 target 侧的 verdict 里**必须是 `<to>`**（不是当前运行时）。任何"用当前运行时算一遍再口头推断 target"的实现都违规 —— 那会把 `>=0.2.0 <0.3.0` 这种区间判成"什么都没变"。

**不允许目标非法时"落到 satisfies 的 false"**：`semver.satisfies('0.3', range)` 不抛错，它静默返回 `false`。所以 `judgeUpgradeImpact` 先 `valid(target)`，非法 → 返回 `{ ok: false, code: 'invalid-target' }`，**不产出任何单元**。`current` 非法/缺失不报错（profile 是读到了的），只会让 `improved` 结构性不可达（§9 N14）。

## 4. 四个桶是一个**分区**，不是一个评分

每个单元**恰好**落一个桶。判定顺序固定（先判 target 状态，再判 current 状态）：

| 桶 | 定义（机器可判） | `cause` | 桶内 `missingEvidence` | 备注 |
|---|---|---|---|---|
| `would-be-denied` | target 求值 = `denied` | `target-denied`（至少一条 unmet 的 `failure === null`，即真的区间不含 `<to>`）；`unusable-declaration`（unmet **全部**是 `empty-range` / `invalid-range` / `workspace-protocol` / `malformed-manifest`） | `[]` | 带 `already_denied_at_current`：`true` = 今天就已经被拒（不是这次升级造成的） |
| `cannot-tell` | target 的 admission **没有建立**：`unconstrained`（没有任何 DSH 声明）或包**未安装**（`manifest === null`） | `no-declaration` / `not-installed` | **原样取引擎的 verdict**：bundle 无声明 = `['missing.admission','missing.probe']`，row 无声明 = `['missing.peer-declaration']`，row 未装 = `['missing.row-module']`，bundle 未装（只在快照里）= `['missing.admission']` 且 `verdict: null` | 「沉默不等于通过」：无声明永远不进 `likely-fine`。**不自造 missing 列表**：与 verdict 不一致的两份"缺什么"就是两个真相 |
| `improved` | target = `admitted` **且** current = `denied` | `denied-now-admitted-then` | `[]` | 证据门槛见 §4.1 |
| `likely-fine` | target = `admitted`，且 current 不是 `denied`（含 current 未知/非法） | `admitted-at-target` | `[]` | 名字就说"像没事"，不说"没事" |

`indeterminate`（运行时未知）在 target 侧不可能出现（target 已校验）；**若出现，按 `cannot-tell` 处理并写 `missing.runtime`**，绝不降级成 `likely-fine`。

### 4.1 `improved` 凭什么成立（最容易伪造的桶）

五个条件同时成立才允许写 `improved`，缺一不可：

1. `current` 是**合法精确版本**（`valid(env.dsh) !== null`）；
2. `evaluateAdmission(manifest, current).status === 'denied'`；
3. 该拒里**至少一条** unmet 的 `failure === null` —— 只有「区间真的不含当前运行时」才算"升级会修好它"；`invalid-range` 之类的缺陷与运行时无关，今天拒、明天也拒；
4. `evaluateAdmission(manifest, target).status === 'admitted'`；
5. 两次求值用的是**同一个 manifest 对象**（同一个包版本），`unit.version` 只有一个值。

任何一条不成立 → `likely-fine`（并保留 `current.status`，让读者自己看）。**禁止**用「registry 上有更宽松的版本」推出 `improved`（§6）。

## 5. 输出：确定性、有序、可复算

`UpgradeImpact`（`--json` 与产物同形，产物另加 §12 的 SSOT 字段）：

```jsonc
{
  "schema_version": 1,
  "command": "upgrade",
  "profile": "upstream",              // 答案只对这个 profile 成立（BS-38）
  "profile_source": "live",           // live | snapshot
  "current": "0.2.1-rc.4",            // env.dsh，可为 null
  "current_valid": true,
  "target": "0.3.0",
  "target_valid": true,
  "target_relation": "newer",         // same | newer | older | unknown（current 未知时）
  "buckets": ["would-be-denied", "cannot-tell", "improved", "likely-fine"],
  "counts": { "bundles": 2, "rows": 95, "would_be_denied": 81, "cannot_tell": 14, "improved": 0, "likely_fine": 2, "total": 97 },
  "units": [ /* 见下，已排序 */ ],
  "registry": {
    "consulted": false,               // 没传 --registry 就是 false（默认离线）
    "facts": 0,
    "failures": []                    // [{ package, code, detail }]：查不到只是注解
  },
  "generated_at": "2026-10-30T00:00:00.000Z"
}
```

单元：

```jsonc
{
  "id": "row:compat-status",          // bundle:<name> | row:<rowId>
  "kind": "row",                      // bundle | row
  "name": "@deepseek-ai/dsh-status",  // bundle 名 / row 的模块名
  "version": "0.2.1-rc.4",
  "row_ids": ["compat-status"],
  "source": "bundle:@deepseek-ai/dsh-base",   // row 所属 patch 层；bundle 为 null
  "bucket": "would-be-denied",
  "cause": "target-denied",
  "already_denied_at_current": false,
  "current": { "runtime": "0.2.1-rc.4", "status": "admitted", "mode": "peers", "unmet": [] },
  "target":  { "runtime": "0.3.0", "status": "denied", "mode": "peers",
               "unmet": [{ "key": "@deepseek-ai/dsh-session", "range": "0.2.1-rc.4", "satisfied": false, "failure": null }] },
  "remediation": [ /* 与 why 同一份 Remediation[] */ ],
  "reasons": [ /* 与 why 同一份 Reason[]（含 row-scope 与 unmet） */ ],
  "missing_evidence": [],
  "verdict": { /* Verdict | null，env.dsh === target（纯函数返回；`--json` 见下） */ },
  "suggestions": []                   // 或 §6 的 UpgradeRegistryNote[]（按版本降序）
}
```

**`--json` 与核心返回的区别（仅为体积，不是第二次判断）**：核心的 `UpgradeUnit` 带完整 `verdict`；`dsh-triage upgrade --json` 把它**拍平**成 `conclusion` + `evidence_tiers`，并**去掉**内嵌 `verdict`。理由：190 行组合的完整 `Verdict` 数组是 1.8 MB，而 `reasons` / `remediation` / `missing_evidence` 已经逐字在单元上（多一份就是同一段文字的第二份拷贝）。拍平后的字段全部是从 `verdict` **复制**的，不是重算的（单测「同引擎断言」比对的就是核心的 `verdict`）。副作用是 `--json` 里不再有 `env.profileDir` —— 这份输出本来就该能贴进 issue。

**排序键（全序，逐字节可复算）**：

1. `bucket` —— 按 `buckets` 数组顺序（先看坏事）；
2. `kind` —— `bundle` 在 `row` 前；
3. `name` —— **UTF-16 码位比较**（`a < b ? -1 : a > b ? 1 : 0`），不用 `localeCompare`（ICU 版本/区域设置会让同一输入在不同机器上排出不同顺序）；
4. `version`（`null` 排前）；
5. `id`（`row:` 前缀 + rowId）—— 兜底，保证唯一。

输入数组的顺序**不得**影响输出（§9 N13）。

## 6. 修复建议：复用既有文案 + registry 只是次要证据

| 位置 | 用什么 | 纪律 |
|---|---|---|
| 每条拒掉的 `remediation[]` / `reasons[]` | **直接取 §3 第 2/3 步的 verdict** | 不新写一句修复话术，不新加规则。`pin-version` / `pin-version-unusable` / `upgrade-dsh` / `downgrade-dsh` / `allow-version` / `probe` / `disable-entry` 全部来自 `messages.ts` 既有条目 |
| 单元级文案（文本输出） | 新 `upgrade.*` 命名空间（§13 三处同改） | 只做**标签**（桶名、目标/当前关系、profile 范围声明、"admitted ≠ works"）。**不得**出现在任何 `reasons[]` 里 |
| `suggestions[]` | `UpgradeRegistryNote`，`tier: "measured-registry"`，`annotation_only: true` | 见下 |

`suggestions[]` 的规则（逐条可测）：

1. **只能由调用方**（CLI `--registry`）查出来并传入；纯函数只做**格式化与挂载**，不判断"哪个版本更好"。
2. 只挂在 `would-be-denied` / `cannot-tell` 的单元上；`likely-fine` / `improved` 不挂（那里没有要找的版本）。
3. `admitsTarget` 是调用方用**同一个** `evaluateAdmission` 算出来的布尔值；纯函数**不重算**。
4. **在任何情况下都不参与分桶**：把 `suggestions` 加进来、删掉、把 `admitsTarget` 从 true 改成 false，`units[].bucket` 与 `counts` 必须**逐字节相同**（§9 N9）。
5. 查询失败（`not-found` / 网络错误）时，命令仍 **exit 0**，错误只进 `registry.failures[]` 与一行 stderr；**不得**变成 `cannot-tell`、`unknown` 或非零退出码。
6. 上限：只查 `would-be-denied` / `cannot-tell` 里出现过的包名，去重、**按包名排序取前 12**，避免一次升级检查打 90 次 registry。选了 12 而非"全部"：没有上限时这一层就从"读本机声明"退化成"批量抓 registry"。

## 7. 明确拒绝声称的东西

| 拒绝 | 理由 |
|---|---|
| 「这一行会**工作**」 | 只说了 admission 放行。声明层通过 ≠ 跑得起来（`admission.declared-only` 已经写着这句） |
| 任何功能行为（工具还在不在、配置项改没改名、会话数据能不能读） | 没有实测证据；`probe` 也只回答"装得上 + 起得来"，且默认不跑 |
| 任何**没装**的插件 | 没有 row 就没有声明可判（`BS-38`：结论只对本机本键成立） |
| 跨 profile 的比较 | 答案只关于**这次读到的那个 profile**；`profile` 字段 + 一行文本把名字写在输出里。`--snapshot` 时是快照里记的那个名字 |
| 「升级整体安全 / 可以升」 | 这是把逐条声明结论拼成一个总判断，属于严禁行为 2 的邻域 |
| 「registry 上的 0.2.3 支持 0.3.0，装它就好」 | registry 的 `engines`/`peerDependencies` 是**作者声明**，不是测量；它只能作为"去看哪个版本"的线索，必须带 `measured-registry` 与 `annotation_only` |
| 「这就是全部影响」 | 只说"读到的这套组合里，声明层会拒这些"。运行时会话里动态加载、patch 层条件开关（`runtime.preset-conditional`）都不在本层 |

## 8. 退出码与 `--strict`

| 码 | 含义 | 精确条件 |
|---|---|---|
| `0` | 产出了报告 | 已读完 profile / 快照并算出 `counts.total ≥ 1`（不论有没有 `would-be-denied`） |
| `1` | 一次检查失败 | **仅** `--strict` 且 `counts.would_be_denied > 0`。`cannot-tell` **不**算失败（未知不是坏消息），`improved` 更不算 |
| `2` | 用法错误 | 缺 `--to`；`--to` 不是精确 semver；`--snapshot` 校验失败；未知旗标 |
| `3` | 什么都没采到 | `counts.total === 0`（profile 存在但 0 bundle / 0 row）；profile 不存在（`profile-not-found`）。**坏快照不在此列**：那是 `2`（用户指的文件不能用，不是"什么都没采到"） |

- **`profile-not-found` 必须是"诚实的失败"**：stderr 点名 `profile`，**不产出空清单**。空清单会被读成"全都好"，那是最坏的一种假绿。
- **不改变任何既有命令的输出与退出码**：`why` / `check` / `audit` / `probe` / `badge` / `index` / `serve` / `outcomes` 一字不动（`upgrade` 只是新增分支）。

## 9. 负对照（14 条，每条都是可执行断言。**R44 追加 N20–N23**，见下表末四行）

| # | 场景 | 期望 | 钉住的不变量 |
|---|---|---|---|
| N1 | 空 profile（0 bundle / 0 row） | exit `3`；stdout 不出现任何桶标题；`--json` 不产出清单（不是"0 条影响"的绿报告） | 空集不能被当成"全都好" |
| N2 | 全部 admitted（`engines.dsh: "*"`） | 每个单元 `likely-fine`；`would_be_denied = 0`；`--strict` exit `0` | 全绿路径 |
| N3 | `target === current` | `improved = 0`；每个单元的"target 拒/放行"与 `why` 在同 profile、同运行时上的"拒/放行"**逐条一致** | 升级清单与 `why` 同源 |
| N4 | `--to` 缺失 / `--to 0.3` / `--to ^0.3.0` / `--to latest` | exit `2`；stderr 说"要精确版本"；**不读 profile**（用一个不存在的 profile 也报同一个 `2`） | 非法版本不许被 `satisfies()` 静默判成 false |
| N5 | `--to ""`（显式空串） | exit `2`，同上 | 空串不是"未指定" |
| N6 | row 的模块未安装（`manifest: null`） | `cannot-tell` / `cause: "not-installed"` / `missing_evidence: ["missing.row-module"]`（快照里未装的 bundle → `["missing.admission"]` 且 `verdict: null`）；**不在** `would-be-denied` | 没装就不能说它会挂 |
| N7 | 模块无任何 DSH 声明 | `cannot-tell` / `cause: "no-declaration"` / `missing_evidence: ["missing.admission","missing.probe"]`；**不在** `likely-fine` | 沉默不等于通过 |
| N8 | 声明不可用（`engines.dsh: "not a range"` / `""` / `"workspace:*"`） | `would-be-denied` / `cause: "unusable-declaration"` / `already_denied_at_current: true`（current 也是 denied）；**不在** `likely-fine`，**不在** `cannot-tell` | 「今天也拒」不许被写成"这次升级弄挂了"或"看不出" |
| N9 | registry 事实（`admitsTarget: true/false`）与失败（`not-found`） | 加/删 registry 输入后，`units[].bucket` 与 `counts` **逐字节相同**；失败只出现在 `registry.failures[]`；exit 仍 `0`。**真机**：`--registry` 指向不可达代理时 12 次查询全失败而 192 个单元逐条不变（§12 的 `self_check.registry`） | 次要证据永不搬桶 |
| N10 | profile 不存在（`--profile nope`） | exit `3`；stderr 含 profile 名；stdout 无清单；不写 SSOT | 诚实失败，不造空绿 |
| N11 | `--snapshot` 坏输入（非 JSON / `schema_version: 2` / 缺 `profile` / row 缺 `module`） | exit `2` + 精确原因；**不**回退去读本机 profile | 快照坏了不等于"读本机吧" |
| N12 | 快照只给 bundle 列表（`rows: []`） | `counts.rows = 0`；仍能给出 bundle 的 `would-be-denied`；文本里出现 `rows 0` | 显式 bundle 模式可用 |
| N13 | 同一批单元，把 `rows` / `bundles` 打乱顺序跑两次 | 两次 `units` 序列化结果**逐字节相同** | 排序键是全序，且与输入顺序无关 |
| N14 | `env.dsh = null`（当前运行时读不到）但 target 合法 | `improved` 恒为 `0`；admitted 的单元落 `likely-fine` 且 `current.status === null`；`target_relation === "unknown"` | 不知道现在，就不许说"变好了" |
| **N20** | `--expect-improved` 且 profile 里**没有**改善单元（模板 profile） | 记录器判红（`improved-non-empty`）；**不许**因为"其余都绿"就当作通过 | 「四桶里三桶」不能冒充四桶 |
| **N21** | 改善单元的 `current.unmet` 里**全部**是 `failure !== null`（声明缺陷，不是区间不合） | 该单元不得落 `improved`（落 `would-be-denied` / `unusable-declaration`）；记录器 `improved-names-both-sides` 抓不到它也会被 N8 抓住 | 「今天拒」必须是**区间**拒，不是"声明写坏了" |
| **N22** | 给改善单元挂一个 `admitsTarget: true` 的 registry 注解 | `improved` 单元的 `suggestions` **必须为空**（注解只挂 `would-be-denied` / `cannot-tell`）；`improved-carries-no-registry-annotation` 判红 | 改善不许由"registry 上有个更宽松的版本"推出 |
| **N23** | 策展组合（`scripts/prepare_upgrade_mixed_profile.mjs`）跑出的产物 | `source.composition` 必须写"curated"、`source.declared_dependencies` 必须是 `name@version` 列表、`limits[]` 必须写"选哪些包是我们的选择"且"目标方向"；缺一即视为把抽样说成普查 | 样本的来源必须自报 |

另加两条**形状**断言（不是负对照）：

- **同引擎断言**：每个 row 单元的 `verdict` 与 `verdictsFromRowAdmission({env: {...env, dsh: target}, rows: [row]})[0]` **深度相等**（admitted 的 row 除外，那里对比 `verdictFromAdmission`）；每个 bundle 单元的 `verdict` 与 `verdictFromAdmission(...)` 深度相等。这是"没有第二套规则"的唯一硬证据。
- **离线断言**：`packages/core/src/upgrade.ts` 的源码里不出现 `fetch(` / `node:http` / `node:net` / `node:tls` / `process.env` / `Date.now` / `Math.random`。

## 10. 本 spec 里明确写 `unmeasured` 的东西

| 项 | 为什么是 `unmeasured` |
|---|---|
| 「升到 `<to>` 之后这一行能跑」 | 本层只做声明求值；boot 实测属于 `probe`（M3），本命令默认不跑、也不产出 probe 证据 |
| `<to>` 这个版本**是否存在** | 不查 registry 时完全不知道；查了也只写 `measured-registry` 注解，不改桶 |
| 运行期才会出现的问题（相位、条件开关、动态加载、会话内挂载） | 没有 inventory 采样就没有相位；`--snapshot` 是**声明**快照，不是 inventory |
| 别的 profile / 别的机器 / 别的 os/arch | 答案只对本机这个 profile 成立（`BS-38`） |
| 「哪些会**新**装得上」 | 只判已装集合；候选插件属于 `check` / `probe` |
| 声明的语义是否如实（作者写 `>=0.2 <0.4` 但实际只测过 0.2.1） | 声明就是声明；本层判"作者声明了什么"，不判"作者诚不诚实" |

## 11. 明确不在范围里

| 不做 | 归属 |
|---|---|
| 自动改 profile / 自动 pin 版本 / 自动降级 | 上游 `plugin_manager` 与本项目一贯的"只读"边界 |
| 写组合快照（`--snapshot` 的生成器） | 本任务只做**读**；写是 `BACKLOG` 的候选（需要先定"哪些字段能进快照"） |
| 真 boot 一次 `<to>` | `probe`（M3），且需要沙盒与 `--execute` |
| 把 `upgrade` 的结论并进 `why` / `check` / 面板 / `compat_verdict` | 本任务只加一个命令；面板与 Agent 工具要另立任务（它们各有自己的"问句"） |
| 跨 profile 汇总 / 回流 | `M5-a` 的本地半边只记 outcome；跨用户聚合是另一个里程碑 |
| 新的 gate | 现有 `verdict-contract` / `governance` / `step-review` 覆盖；新门要动冻结台账（§`M5-reflow` §6 同一条理由） |

## 12. 真跑产物（SSOT）

`scripts/record_upgrade_impact.mjs --stamp <ISO> [--to <version>] [--dsh-home <path>] [--profile <name>] [--out <dir>]`

| 项 | 要求 |
|---|---|
| 输入 | 仓内沙盒运行时 `sandbox/upstream/<ver>/home/profiles/<profile>`（真实组合，非夹具）；**不用 `--registry`**（离线） |
| 产物 | `data/results/upgrade-<stamp>.json` + `.sha256`，含 `schema_version` / `produced_by` / `generated_at` |
| 必含字段 | `source`（runtime 版本 + profile 名 + 是否 live）、`impact`（§5 的 `profile/current/target/relation/buckets/counts/registry`）、`units[]`（**投影**，见下）、`self_check`、`runs[]`、`checks[]`、`passed`、`limits[]` |
| `units[]` 是**投影**，不是 payload 副本 | 每个单元保留：身份（`id/kind/name/version/row_ids/source`）、判定（`bucket/cause/conclusion/current.status/target.status/unmet[{key,range}]`）、归因（`reason_ids[]` = messageId 去重升序、`fix_kinds[]` = RemediationKind 去重升序）、`missing_evidence`、`suggestion_versions[]`。**不含**修复散文与 evidence 数组：那两样在 `upgrade --json` 里，写两份就等于让两个真相源漂移 |
| `self_check` | 同一 profile 再跑一次 `--to <current>`（对照组）+ 一次 `why --json --all`：对照组必须 `would_be_denied = 0`（目标没变就不该多出拒绝），且**模块集合**与 `why` 的 `blocked` / `unknown` 行 verdict 逐名一致；对照组与 `why` 都为空时必须写 `denied_comparison_vacuous: true`（空对空不算证明）。另记 `target_change_moves_the_list`：同一批行在 `<current>` 上 0 拒、在 `<to>` 上 N 拒 |
| 隐私（两道） | ① 探针在写盘前扫自己生成的字节，命中 home 形态（`gate_governance#results-privacy` 的同一组正则）就 **refuse to write（exit 2）**；② `runs[].command` 里的 `--dsh-home` 一律写成 `<dsh-home>`（**本轮真实踩过**：第一次运行把绝对路径写进了 `command`，门当场打红，产物已移出仓库并重跑） |
| registry 那一次跑也要留证据 | 再跑一次 `upgrade --to <to> --registry`，把 HTTP(S)_PROXY 指到 `127.0.0.1:9`（拒绝连接）：必须 **exit 0**、`units[].bucket/cause` 与计数**与离线那次逐条相同**、12 条查询失败只出现在 `registry.failures[]` + 一行 stderr。`self_check.registry` 记 `network_blocked_on_purpose` / `buckets_identical_to_offline_run` / `counts_identical_to_offline_run`。**若代理指针被忽略**（旧 Node 无 `NODE_USE_ENV_PROXY`），这次会真的读到 npm —— 不变量不变，只是注记变成事实而不是失败，`limits[]` 会据实改写 |
| 隐私 | 不出现任何 home 形态路径（`gate_governance#results-privacy`）；`profile_dir` 写成 `<dsh-home>/profiles/<name>` |
| 覆盖 | **拒绝覆盖**已存在的同名产物（`gate --record` 的同一决定，R40） |
| 空集 | 若 `counts.total === 0`，**照实写** `units: []` + `limits[]` 一行「本次组合 0 单元，本产物不构成任何影响结论」，并 exit `1`；**禁止**补造单元。命令本身在 `counts.total === 0` 时已经 exit `3`（§8），所以探针在这一步之前就会停：**不产出产物**，只把 stderr 原文写进交接包 |
| `limits[]` | 至少覆盖 §10 的每一项（跑在哪个运行时、只看声明、没跑 probe、没查 registry、单 profile） |

## 13. 实现清单（先测试、后实现；顺序不可换）

1. `packages/core/src/upgrade.ts`：`judgeUpgradeImpact` / `renderUpgradeImpact` / `UpgradeImpact` 类型（纯函数；无 fs / 网络 / 时钟）。
2. `packages/core/src/index.ts`：只加导出。
3. `packages/core/src/messages.ts`：`upgrade.*`（en + zh，§6）。
4. `scripts/gate_verdict_contract.mjs` 的 `MESSAGE_ID` 加 `upgrade`；`docs/05-verdict-contract.md` §3 加一行 —— 与 3 同时改（三处同改）。
5. `tests/unit/upgrade.test.ts`：§9 的 N2–N9 / N13 / N14 + 同引擎断言 + 离线断言。
6. `packages/plugin/src/cli.ts`：`upgrade` 分支 + `--to` / `--registry` 旗标 + `--snapshot` 的组合快照语义（只影响 `upgrade`）。
7. `tests/e2e/upgrade-cli.test.ts`：N1 / N4 / N5 / N10 / N11 / N12（真 CLI，合成 `DSH_HOME`，离线）。
8. `scripts/record_upgrade_impact.mjs`：真跑沙盒组合 → §12 产物。
9. 真跑并把计数写进交接包（不改 `HANDOFF.md` / `INDEX.md`，由主会话同步）。

## 14. 实现偏差记录（`T-502`，agent 代记；**有歧义只取更严的一读**）

> 判据没有放宽，只有收紧或细化；每条都能在代码或测试里指到位置。

| # | spec / 任务书位置 | 歧义 | 取的一读 | 位置 |
|---|---|---|---|---|
| 1 | 任务书 §3「`cannot-tell` 含 unparseable」 | 不可用区间是"没有信息"还是"已确定被拒" | 取**已确定被拒**：`engines.dsh: ""` / `workspace:*` / 非法区间在上游语义里「一律不兼容」，与本层要比较的两个运行时无关。记成 `cannot-tell` 会让用户以为"也许还能用"。落到 `would-be-denied` + `cause: "unusable-declaration"` + `already_denied_at_current: true`，修复文案走既有的 `remediation.pin-version-unusable` | `core/upgrade.ts#classify`；`tests/unit/upgrade.test.ts` N8 |
| 2 | §3「单元 = loader row / bundle」 | row 是否按模块分组（`why` 的终端做法） | **不分组**：一个 row 一个单元，因为修复动作是 `disable-entry` 并点名某一条 row；`counts.rows` 因此是行计数 | `core/upgrade.ts#unitsOf` |
| 3 | §2「当前运行时」 | 是否给一个 `--from` 参数 | **不给**：当前运行时只能来自 `env.dsh`，避免"声称 A 判 B" | `cli.ts#commandUpgrade` |
| 4 | §6 第 6 条 | registry 查询上限取多少 | 取 **12**（实测组合里需要查的包远多于 12，无上限会变成一次 90 请求的批量抓取） | `cli.ts#registrySuggestions` |
| 5 | §5 排序键 3 | `localeCompare` 是否够确定 | **不够**：ICU 版本/区域会让同一输入顺序不同。改用 UTF-16 码位比较 | `core/upgrade.ts#compareStrings` |
| 6 | §2.1 `--snapshot` | 与 `audit --snapshot`（inventory）同名是否冲突 | 保留同名、语义按命令区分，**并在 `--help` 里写清**；`upgrade` 只接受组合快照，`audit` 只接受 inventory 采样 | `cli.ts#readCompositionSnapshot` / `HELP` |
| 7 | §5 `counts` | `total` 是否重复计数 | `total = bundles + rows`，三个数一起写进产物，读的人不用自己加 | `core/upgrade.ts#judgeUpgradeImpact` |
| 8 | §12「空集 → exit 1」 | 空集是"失败"还是"没有影响" | 取**失败**（`1`）而不是 `0`：一个 0 单元的产物不能被任何自动化读成"检查通过" | `scripts/record_upgrade_impact.mjs` |
| 9 | §4 `likely-fine` 当 current 非法时 | 是否单独给一个 `cause` | 仍用 `admitted-at-target`，但 `current.status` 写 `"invalid-runtime"` 并用 `already_denied_at_current: false`；不新增桶（桶是分区，加桶就要改判据） | `core/upgrade.ts#standingOf` |
| 10 | §5 单元形状（带 `verdict`） | `--json` 是否原样输出内嵌 verdict | **拍平**成 `conclusion` + `evidence_tiers` 并去掉内嵌对象：190 行时原始 payload 1.8 MB、拍平后 0.53 MB，且单元上已经有逐字的 `reasons`/`remediation`/`missing_evidence`。核心仍返回完整 `verdict`，所以"同引擎"断言比对的是它，**不是**拍平后的字段 | `cli.ts#upgradeJsonPayload` |
| 11 | §12 产物形状 | 是否把 `verdicts[]` 原样搬进 SSOT | **不搬**：产物是**这次的报告**（计数 + 单元投影 + 归因 id），不是 payload 副本。代价是 `verdict-contract` 门不再校验这些 verdict；补偿是单测的同引擎断言与 §9 的 14 条负对照。选择理由：一份 1.8 MB 的 SSOT 主要体积是同一段文字的重复 | `scripts/record_upgrade_impact.mjs` |
