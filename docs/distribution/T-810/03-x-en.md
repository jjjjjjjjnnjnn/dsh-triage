<!-- channel: X (English, 4-post thread) -->

# 草稿 03 · X 线程（英文，4 条）

> 规格：每条 ≤280 字符。第 1 条独立成文具备传播性。
> 数据来自：`data/results/upgrade-card-2026-10-31T09-00-00.000Z.json`。

---

**1/4**

Upgraded DSH to 0.2.1-rc.5 and had plugins silently disappear?

Across 192 evaluated plugin units, **119 are rejected at admission** when moving from rc.4 to rc.5.

The common culprit: plugins pinning their `peerDependencies` strictly to the older rc. 🧵

**2/4**

In DSH, admission evaluation happens per loader row during startup.

If a plugin's peer requirement doesn't match the new runtime, DSH quietly drops that entry row without crashing the app. To the user, tools and hooks simply vanish.

**3/4**

You can pre-check what will be admitted before upgrading your runtime:

`dsh-triage upgrade --to 0.2.1-rc.5 --card`

It statically evaluates your local plugin declarations and prints a four-bucket breakdown with actionable recommendations.

**4/4**

Runs 100% locally and offline: no telemetry, no account, no profile changes.

Reproducible test data: `data/results/upgrade-card-2026-10-31T09-00-00.000Z.json`

Open source (MIT) on npm: `dsh-triage` · GitHub repo in reply 👇

---

## 发推自查

- 确认第 3 条命令中的标点符号均为半角字符，便于读者一键复制；
- 链接附于首条回复中，避免推文正文被平台限流；
- 专注技术分享，无需 @ 官方账号。
