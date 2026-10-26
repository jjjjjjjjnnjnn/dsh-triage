# 05 · Verdict 契约

> **Stand**: v0.1.0-skeleton (2026-10-26) | 实现：`packages/core/src/verdict.ts` + `types.ts` | 门禁：`scripts/gate_verdict_contract.mjs`

## 1. 为什么要有契约

判断层的产品价值 = 结论的可信度。为了让它无法悄悄退化成「一个看起来很专业的分数」，结论结构被门禁锁死：

- 只有四态结论；
- 每条结论必须带证据与置信度；
- `blocked` / `risky` 必须给替代方案；
- `unknown` 必须写清缺什么证据；
- 用户可见文案只能来自 messageId 目录，不得内联写死。

## 2. Verdict JSON

```jsonc
{
  "schemaVersion": 1,
  "subject": { "name": "dsh-web-search-pro", "version": "1.4.2", "kind": "plugin" },
  "env": {
    "dsh": "0.2.1-rc.2",
    "node": "24.15.0",
    "platform": "win32",
    "arch": "x64",
    "profile": "web",
    "profileDir": "C:/Users/me/.dsh/profiles/web",
    "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    "installed": [{ "name": "@deepseek-ai/dsh", "version": "0.2.1-rc.2" }]
  },
  "conclusion": "blocked",
  "confidence": { "level": "high", "basis": "declared" },
  "reasons": [
    {
      "code": "admission-denied-peer",
      "severity": "block",
      "messageId": "admission.unmet.peer",
      "params": { "key": "@deepseek-ai/dsh-tools", "range": ">=0.2.0-rc.2 <0.2.1-0", "runtime": "0.2.1-rc.2" }
    }
  ],
  "evidence": [
    { "id": "admission", "tier": "declared", "source": "dsh-web-search-pro@1.4.2", "method": "declared-range", "at": "2026-10-26T00:00:00.000Z" },
    { "id": "runtime", "tier": "measured-local", "source": "C:/Users/me/.dsh/profiles/web", "method": "profile-scan", "at": "2026-10-26T00:00:00.000Z" }
  ],
  "remediation": [
    {
      "kind": "allow-version",
      "command": "dsh plugin --profile web allow-version dsh-web-search-pro@1.4.2 --dsh-version 0.2.1-rc.2 --accept-risk",
      "note": "explicit exemption for this exact plugin version and runtime version"
    }
  ],
  "missingEvidence": [],
  "generatedAt": "2026-10-26T00:00:00.000Z"
}
```

## 3. 强制不变量

| 不变量 | 门禁检查 |
|---|---|
| `conclusion ∈ {go, risky, blocked, unknown}` | 枚举 |
| `evidence` 非空，每项含 `tier/source/method/at` | 字段完整性 |
| `tier ∈ {inferred, declared, scanned, measured-registry, measured-local}` | 枚举 |
| `confidence.level ∈ {low, medium, high}` 且 `basis` 是 tier | 枚举 |
| `reasons[].messageId` 形如 `admission.* / collision.* / remediation.* / missing.*` | 正则（禁内联散文） |
| `blocked` / `risky` ⇒ `remediation.length ≥ 1` 且每项有 `note` | 条件断言 |
| `unknown` ⇒ `missingEvidence.length ≥ 1` | 条件断言 |
| 输出确定性：同输入同输出（时间戳由调用方注入 `generatedAt`） | 单测重复渲染比对 |

## 4. 置信度口径（禁止黑箱分数）

| level | 何时使用 | basis |
|---|---|---|
| `high` | 声明明确判定为 `denied`（可由宿主复现）；或本机实测失败 | `declared` / `measured-local` |
| `medium` | 仅声明层通过（**运行期行为未实测**） | `declared` |
| `low` | 需要推断，或依赖第三方 registry 结论 | `inferred` / `measured-registry` |

> `go` 的含义是「按声明可以装」，不是「已验证能跑」。运行期结论只有 probe 能给（M3）。

## 5. 渲染

- CLI 文本由 `renderVerdict(verdict, locale)` 生成，locale ∈ `en | zh`。
- 文案集中在 `packages/core/src/messages.ts`；新增原因码 = 新增 messageId + 两个语言条目（`gate` 不检查条目缺失，但单测/审阅会检查 `?messageId` 输出）。
- Web 面板（M4）必须复用同一 `messageId`，不得自己编文案。
