<!-- channel: X (English, 4 posts) -->

# 草稿 03 · X 线程（英文，4 条）

> 每条 ≤280 字符；第 1 条必须自己站得住（转发时只看得到它）。数字全部来自
> `data/results/upgrade-card-2026-10-31T09-00-00.000Z.json`。

---

**1/4**

`dsh` 0.2.1-rc.5 shipped. I asked the boring question: if your installed set is pinned to rc.4, what does the new
build *deny*?

192 units judged → **119 would be denied**, 73 cannot tell. Same reason every time: rows pin an exact peer on the
rc they shipped with.

**2/4**

This is a declaration-layer judgement, not a runtime test, and it is not "the upgrade is broken" — it is what
admission prints and then drops from your composition. That distinction is the whole thing.

**3/4**

It also refuses to flatter itself: `improved` = 0. A declaration being admitted is not a measurement, so the card
never says "upgrading fixes it".

Reproduce offline, no network:

`dsh-triage upgrade --to 0.2.1-rc.5 --card`

**4/4**

Your set is the input, mine is only the shape: the numbers above come from a sandbox profile, not your machine.

MIT, read-only, no account, no telemetry. `dsh-triage` on npm · repo in the reply.

---

## 发送前检查

- 第 3 条里的命令要能被复制：不要在代码里加全角标点；
- 不要在帖子里 @ 上游账号求转发（那是最快被当广告的写法）；
- 发完 24 小时内不要连发第二条技术帖——D5 看的是「一次真实接触」，不是频次。
