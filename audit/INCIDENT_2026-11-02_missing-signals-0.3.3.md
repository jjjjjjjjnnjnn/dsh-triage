# INCIDENT 2026-11-02 · 0.3.3 部分发布：`@dsh-triage/signals@0.3.3` 没到 registry

> **状态**：**未修复**（等 HUMAN 补发一个包）。**影响**：`npm install dsh-triage@0.3.3` 对**所有用户**失败。
> **判据来源**：两条独立读路径 + tarball HEAD，见 §2。**结论不来自发布输出**（它说四个都 ✅）。

## 1. 发生了什么

`pnpm run release:publish` 的输出：四个包都打印 `✅ Published package …@0.3.3`，其中包括
`@dsh-triage/signals@0.3.3`。但 registry 上**只有三个**：

| 包 | version 文档 | tarball HEAD | `dist-tags.latest` |
|---|---|---|---|
| `@dsh-triage/core@0.3.3` | 200 | 200 | 0.3.3 |
| `@dsh-triage/probe@0.3.3` | 200 | 200 | 0.3.3 |
| `dsh-triage@0.3.3` | 200 | 200 | 0.3.3 |
| **`@dsh-triage/signals@0.3.3`** | **404** | **404** | **0.3.2** |

`@dsh-triage/signals` 的 packument `time.modified` 还停在 `2026-11-02T14:12:18Z`（0.3.2 那次），
说明 0.3.3 的写入**从未落地**，不是「还没传播」。

**为什么这会让用户装不上**：`dsh-triage@0.3.3` 的 manifest 钉的是精确版本

```
"@dsh-triage/core":   "0.3.3"
"@dsh-triage/probe":  "0.3.3"
"@dsh-triage/signals":"0.3.3"   ← 这个版本不存在
```

所以 `npm install dsh-triage@0.3.3` 的报错是 `notarget No matching version found for
@dsh-triage/signals@0.3.3`，而 `dsh-triage` 的 `dist-tags.latest` **已经指向 0.3.3** ——
「装最新版」的每一条路径现在都是失败。

## 2. 怎么发现的（不靠发布输出）

`release:publish` 链内的 `record_publish` 报了 12 项红，并且重试 20 次 / **301 秒**都没等到
（`data/results/publish-2026-11-02T15-29-45.020Z.json`）。随后手工做了三个探针：

1. **两个 packument 视图**：`application/json` 与 `application/vnd.npm.install-v1+json`
   对 signals 都缺 0.3.3（另一条读路径也缺 → 不是缓存分层）；
2. **版本文档**：`GET /@dsh-triage%2fsignals/0.3.3` → **404**；
3. **tarball HEAD**：`https://registry.npmjs.org/@dsh-triage/signals/-/signals-0.3.3.tgz` → **404**
   —— 连字节都不在，排除了「元数据慢、文件已上传」。

另外三个包的 tarball HEAD 都是 200，说明这次不是全线故障，而是**单包写入丢失**。

## 3. 修复（一个包，HUMAN 动作，需要 OTP）

版本号 0.3.3 在 registry 上**不存在**，所以补发不会 409：

```powershell
pnpm --filter @dsh-triage/signals publish --access public --no-git-checks
```

本地 tarball 已验证可发（`pnpm --filter @dsh-triage/signals pack`）：

```
entries: 19 · package/package.json: {"name":"@dsh-triage/signals","version":"0.3.3",
"dependencies":{"@dsh-triage/core":"0.3.3"}} · main: ./dist/index.js · exports: yes
```

补发后必须**再验一次**，而不是看发布输出：

```powershell
npm view @dsh-triage/signals@0.3.3 version      # 期望 0.3.3
node scripts/record_publish.mjs                 # 期望 21/21（含 client-bundle）
```

## 4. 兜底（如果补发也失败）

把这四个包的 `latest` 回滚到 `0.3.2`，让「装最新版」重新可用，再另开一轮处理 0.3.3：

```powershell
npm dist-tag add dsh-triage@0.3.2 latest
npm dist-tag add @dsh-triage/core@0.3.2 latest
npm dist-tag add @dsh-triage/probe@0.3.2 latest
# signals 的 latest 本来就是 0.3.2
```

回滚不会删掉已发布的 0.3.3 文件（`dsh-triage@0.3.3` 仍会在 registry 上，钉死它的用户仍会失败），
所以它只是**止血**，不是修复。

## 5. 与上一次事故的关系（R53）

`audit/INCIDENT_2026-11-01_partial-publish.md` 是同一类：**发布输出说成功，registry 上没有**。
差别：那次 pnpm 报了错（`core` 卡在暂存），这次 pnpm **报的是成功**。

`record_publish` 在这一轮已经会等副本（`scripts/lib/registry-wait.mjs`），但它**分不清**
「这个包还没传播」和「这个包根本没写进去」——两者在 npm 眼里都是 `notarget`。预算把它限制在
5 分钟内，然后如实判红（红是对的）。**这次的红是真的。**

## 6. 待办

- [x] ~~HUMAN 补发 `@dsh-triage/signals@0.3.3`~~ → 不需要补发：staged 的发布自己落地了（§7）
- [ ] `latest` 对齐到 0.3.3（三包；signals 已是）+ `record_publish` 21/21
- [ ] 把 `docs/HANDOFF.md` / `AGENTS.md` / `docs/BACKLOG.md` 的 0.3.3 状态改成「已可安装 / latest 待对齐」
- [x] 新盲区 **`BS-55`：发布输出不是证据**（与 `BS-49` 的「registry 是时点读数」相邻但不是同一条）

## 7. 结局：那个 409 不是死路，staged 的发布自己转正了

补发命令返回的是

```
ERR_PNPM_FAILED_TO_PUBLISH
  × Failed to publish package @dsh-triage/signals@0.3.3 (status 409 Conflict):
    {"success":false,"error":"Cannot publish over previously staged version \"0.3.3\"."}
```

我当时的判断是「版本号被永久占用，只能换 0.3.4」——**这个判断是错的**。几分钟后再读 registry：

| 时间 | `@dsh-triage/signals` 的 0.3.3 | `latest` | `time.modified` |
|---|---|---|---|
| 15:34（事故发现时） | version 404 / tarball 404 | 0.3.2 | 14:12（0.3.2 那次） |
| 15:48 | **存在** | **0.3.3** | **15:48:59** |

也就是说 npm 的发布有两段：**先 staged，再提升为可发布**。第一次 `pnpm -r publish` 的写入进了暂存区，
提升是**异步**完成的；我们在这个窗口里既读不到（404）、又发不进去（409），而它自己在大约 **14 分钟后**落地。

**决定性验证**（空 userconfig、干净目录、显式 registry）：

```
dsh-triage@0.3.3: exit 0
  installed: {"dsh-triage":"0.3.3","@dsh-triage/core":"0.3.3","@dsh-triage/signals":"0.3.3","@dsh-triage/probe":"0.3.3"}
dsh-triage@0.3.2: exit 0
  installed: {…全部 0.3.2}
```

### 因此修正了三条判断

1. **「409 Cannot publish over previously staged version」不等于「版本号废了」** —— 它常常意味着
   *第一次发布还在暂存区里*。正确动作是**等并重读 registry**，不是换版本号。换 0.3.4 会让四个包里
   多出一组没人用的版本，而且把「暂存会自己完成」这个事实藏起来。
2. **`record_publish` 的 5 分钟预算不够覆盖这条路径**（这次约 14 分钟）。预算是为了不让发布链挂死，
   所以**不提高默认值**；但红的时候要读产物里的 `install.attempts` / `waited_ms`，并**手工重读 registry**
   再决定是「等」还是「真坏了」。
3. **发布输出既不能说成功，也别说失败** —— 它说的是「请求被接受」。三个独立读数（两个 packument 视图、
   版本 404、tarball HEAD）才是状态。

### 剩余动作（HUMAN）

三个包的 `latest` 在一次回滚里回到了 0.3.2（`@dsh-triage/signals` 已经是 0.3.3）。0.3.3 已验证可安装，
所以对齐即可：

```powershell
npm dist-tag add dsh-triage@0.3.3 latest
npm dist-tag add @dsh-triage/core@0.3.3 latest
npm dist-tag add @dsh-triage/probe@0.3.3 latest
```

然后 `node scripts/record_publish.mjs`（期望 21/21）。如果更愿意停在 0.3.2 这个已知可用的版本，
就**不做这一步**，并把 `docs/HANDOFF.md` 里的 0.3.3 状态写成「已发布但 latest 停在 0.3.2（有意）」。
