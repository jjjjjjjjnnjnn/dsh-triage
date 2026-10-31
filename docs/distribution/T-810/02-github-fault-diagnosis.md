<!-- channel: GitHub — a real "my plugin disappeared" issue/thread, only when it can actually be answered -->

# 草稿 02 · 故障帖诊断（英文，按对方帖子填空）

> **只在对方的问题真的落在这三类里时发**。落不进去就别发——这页存在的意义是「答得上才开口」。
> 三个方括号 `[ ]` 是必须替换的地方；替换不了就说明我们答不上来。

---

Before the restart, three different things can make an installed plugin vanish, and they look identical from the
outside. Running these three questions in order usually points at one of them:

**1. Did it become a profile layer at all?**
A package without `dsh.bundle` in its `package.json` installs as a plain dependency and never becomes a layer, so
"installed, nothing appeared" is expected:

```console
$ node -p "require('./node_modules/[pkg]/package.json').dsh?.bundle ?? 'no dsh.bundle (never a layer)'"
```

**2. Was the loader row refused at admission?**
Admission is judged **per row**, not per bundle: a bundle can pass while the row that imports your module is
refused and dropped. The refusal is printed in the run log; after a restart that line is what you are looking for,
which is why it feels like nothing explains it:

```console
$ dsh-triage why "[module or entry id from the log]"
$ dsh-triage audit            # one-screen summary of the whole profile
$ dsh-triage audit --all      # full ledger, one conclusion per row
```

**3. Did it install but never register?**
A declared-compatible version can still fail to import: a hoisted `dsh-tools`, a stale `latest` dist-tag, or a build
script pnpm skipped all produce "installed but not registered". `dsh-triage audit` shows each row's phase, so this
one shows up as a row that exists but is not `active`.

A worked example with the full machine-readable output is CASE-11080 in the repo
(`data/results/why-case-CASE-11080-2026-10-26T12-00-00.000Z.json`): the case where checking `dsh.bundle` alone
answers the *wrong* question, because the bundle passed and the row was refused.

Honest scope: that all runs locally, read-only, and its verdicts come with an evidence tier — if the declarations
are silent it says `unknown` rather than guessing. It is not a malware scanner and not a compatibility matrix for
the whole ecosystem. MIT, public: `https://github.com/jjjjjjjjnnjnn/dsh-triage`.

If you paste your profile name and the log line that mentions the module, I can tell you which of the three it is —
or that it is none of them, which is also an answer worth having.

---

## 何时**不**发这一篇

- 对方的问题不是「装上了但没出现」（例如纯粹的性能问题、模型连接问题）；
- 对方的日志里已经有明确的 refusal 行并且已经解决；
- 我们无法在**同一天**回复——旧帖里塞广告没有人受益，`T-810` 的价值在「真答一题」而不是「多一条链接」。
