# Reddit & Hacker News 发布物料（针对社区规则优化版）

本文档根据 **`r/DeepSeek` 社区规则（Rule 3 内容质量、Rule 4 自我推广与无煽动标题限制、Rule 5 非商业性要求）** 进行了全面合规重构，确保不被版主删除。

---

# 1. `r/DeepSeek` 专用发帖指南（严格合规版）

> **已发布链接**：
> - `r/DeepSeek`: https://www.reddit.com/r/DeepSeek/comments/1xm84py/understanding_deepseek_harness_plugin_admission/
> - `r/DeepSeekHarness`: https://www.reddit.com/r/DeepSeekHarness/comments/1xm88ex/understanding_deepseek_harness_plugin_admission/

### ⚙️ 发帖前设置（对应你的 Reddit 页面）
1. **标题栏（Title）**：粘贴下方提供的 **【非宣传性技术标题】**（严守 Rule 4：Avoid promotional titles）；
2. **添加标识和标记（Add Flair）**：点击输入框下方的“添加标识和标记”，**必须选择 `Resource` 标签**（规则第 4 条明确规定：Use appropriate flair, e.g., "Resource" not "News"）；
3. **切换编辑器模式（重要技巧！）**：
   - 看到编辑栏里有“加粗、斜体、代码块”等按钮，说明当前是**富文本模式**；
   - **请点击编辑框右上角的 “Markdown Mode”（或 “Switch to Markdown”）**；
   - 切换为 Markdown 模式后，直接把下方的正文全选粘贴进去，所有的标题、代码块、列表就会自动生效，完全不用手动调整！

---

### 📌 帖子标题（Title · 严格遵循无宣传性规则）

```text
[Resource] Understanding DeepSeek Harness plugin admission during upgrades, and an offline verification CLI
```

---

### 📄 帖子正文（Post Text · 点击切换至 Markdown 模式后粘贴）

```markdown
DeepSeek Harness (DSH) has a modular plugin and preset system, but a common friction point during runtime version bumps (such as moving to `0.2.1-rc.5`) is that installed plugins or MCP tools can silently fail to appear on startup without throwing an explicit crash error.

We conducted an architectural analysis of DSH's loader mechanism to understand why this happens, evaluated 192 plugin units against rc.5, and created an open-source, read-only diagnostic CLI (`dsh-triage`) as a community resource.

### How DSH Plugin Admission Works Under the Hood

When DSH starts up, its loader does not simply check bundle manifests; it evaluates **Admission semantics per Loader Row**:

1. **Row-level evaluation**: A bundle package might look valid, but specific capability entries or hooks registered as individual profile rows are judged independently against the current DSH runtime.
2. **Exact peer pinning**: Many community plugins pin their `peerDependencies` strictly to an exact rc release (e.g. `@deepseek-ai/dsh-shell-env: "0.2.1-rc.4"`).
3. **Silent omission**: If a runtime version excludes the declared semver range, DSH does not crash the application. Instead, it quietly drops the incompatible row (`phase=no-fiber`, `disabled=true`). To the user, tools simply vanish from the interface without an obvious error.

### Empirical Evaluation (192 Plugin Units)

Testing a standard profile containing 192 units (2 bundles + 190 loader rows) moving from `0.2.1-rc.4` to `0.2.1-rc.5`:
- **119 units** were rejected at admission (primarily due to strict peer version pinning).
- **73 units** declared no DSH version constraints (`unconstrained`).
- **0 units** were improved by upgrading forward.

### Offline Pre-Check Tool (`dsh-triage`)

To help developers inspect their local plugin compatibility before upgrading, we released `dsh-triage` as a free, MIT-licensed developer utility.

**Pre-check target version compatibility:**
```bash
npx dsh-triage upgrade --to next --card
```
This reads your local profile declarations offline and outputs a 4-bucket breakdown (`would-be-denied`, `cannot-tell`, `improved`, `likely-fine`) with exact remediation options (such as recording a profile exemption via `compatibility.json` without waiting for upstream package re-releases).

**Diagnosing already dropped rows in your current profile:**
```bash
npx dsh-triage status        # One-screen summary of current profile health
npx dsh-triage why <module>  # Pinpoints the exact admission conflict for a specific row
npx dsh-triage audit         # Full capability ledger across all loader rows
```

### Technical & Privacy Transparency (Rule 4 & 5 Compliance)
- **Non-commercial & Open Source**: Licensed under MIT. Zero monetization, zero accounts.
- **100% Local & Read-Only**: Completely offline, no telemetry, never writes to `~/.dsh`.
- **Declaration-focused**: Strictly evaluates semver declarations against runtime contracts (tested against 718 automated test suites).
- **Source Code**: Direct GitHub repository: https://github.com/jjjjjjjjnnjnn/dsh-triage (npm: `dsh-triage`)

We hope this technical breakdown helps clarify DSH loader behavior. Happy to answer questions or help trace tricky admission issues in the comments!
```

---

# 2. Hacker News（Show HN · 备选发帖平台）

> **提交地址**：https://news.ycombinator.com/submit  
> **注册门槛**：任意输入用户名 + 密码即刻注册（无需邮箱，无需手机号）。  
> **填写规范**：`title` 填下方标题，`url` 留空，`text` 填下方正文。

### 📌 标题（Title）
```text
Show HN: Dsh-triage – What breaks when you upgrade DeepSeek Harness plugins
```

### 📄 提交正文（Text）
```text
Hi HN,

If you use DeepSeek Harness (DSH) with plugins or MCP tools, you may have experienced plugins silently vanishing after upgrading to a new rc build without any error popup.

We dug into DSH's loader mechanism and found why: DSH performs admission evaluation per loader row. Many plugins pin their peerDependencies to an exact rc version. When the runtime bumps, the loader quietly drops incompatible rows to prevent a crash. Across a typical profile with 192 plugin units evaluated against 0.2.1-rc.5, 119 were silently blocked at admission.

We built dsh-triage, an open-source, read-only diagnostic layer for DSH plugins:
- `npx dsh-triage upgrade --to next --card` pre-evaluates which of your installed plugins will be blocked before you bump.
- `npx dsh-triage why <module>` attributes silently dropped rows to the exact peer declaration.
- Purely local, offline, zero telemetry, no profile mutation. Tested across 718 tests.

Repo: https://github.com/jjjjjjjjnnjnn/dsh-triage
npm: https://www.npmjs.com/package/dsh-triage

Feedback and bug reports welcome!
```
