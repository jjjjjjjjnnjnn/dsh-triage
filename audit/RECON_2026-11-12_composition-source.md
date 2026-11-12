# RECON · 2026-11-12 · 组合层来源（M16）

> **触发**：用户要求「先做真机设置页验证」。验证的第一件事是**直接读那条路由**，而不是相信报告。
> **结论先行**：① 设置页从 0.3.7 起就是 **0 denied / 0 collisions**；「9 项兼容异常」是 **CLI** 打的。
> ② M14 之后 CLI 仍报 **1 条 collision**，那条是**假的**：组合层（bundle 的 patch 文件）仍从 pnpm
> 共享缓存读，而运行时来自 `app.asar`。③ 修法是把组合层也变成同源的（M16），真机上 CLI 与设置页
> 从此逐项一致（289 行 / 0 denied / 0 collisions）。
> **本报告只取证**；判据见 `docs/specs/M16-composition-source.md`。

---

## 0. 一句话可复现

```powershell
# 设置页的读数（桌面桥会删掉 origin / sec-fetch-site，所以我们带它转发的那颗标记头）
node -e "fetch('http://127.0.0.1:51701/compat-triage/summary',{headers:{'x-dsh-triage-client':'settings-tab',accept:'application/json'}}).then(r=>r.json()).then(j=>console.log(j.env.dsh,j.env.dshSource,j.summary.zh.counts))"
# → 0.2.2-rc.1 kernel { rows: 289, judged: 90, denied: 0, unknown: 90, collisions: 0, ... }

# 装着的 0.3.7 CLI（同一台机器、同一个 profile）
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-triage\dist\cli.js" status --profile desktop
# → 0.1.0-rc.6 (inferred) · 202 项配置 · 20 已分析 · 8 存在异常 · 12 未明确 · 1 冲突 · 「检测到 9 项兼容异常」
```

两个不同的程序、两份不同的组合。**R101 的「设置页报 8 条」把主语写错了**。

---

## 1. 三份读数（同一时刻，只读）

| 读数 | 设置页路由（0.3.7，Host 内） | CLI（0.3.7 装机版） | CLI（HEAD，M14） | CLI（HEAD，M14+M16） |
|---|---|---|---|---|
| 运行时 | `0.2.2-rc.1 (kernel)` | `0.1.0-rc.6 (inferred)` | `0.2.2-rc.1 (kernel-asar)` | `0.2.2-rc.1 (kernel-asar)` |
| claims / rows | 289 / 242 | — / 158 | 289 / 242 | 289 / 242 |
| 已判定 | 90 | 20 | 55 | **93** |
| denied | **0** | **8** | **0** | **0** |
| unknown | 90 | 12 | 55 | **93** |
| collisions | **0** | **1** | **1** | **0** |
| 一屏 | 「未发现阻断项，存在 90 项未明确版本声明」 | 「检测到 **9** 项兼容异常」 | 「检测到 **1** 项兼容异常」 | 「**0 项需要处理** · 93 项无法判定」 |
| exit | — | **1** | **1** | **0** |

`R102` 的产物：`data/results/desktop-panel-2026-11-12T22-20-00.000Z.json`（panel + CLI 两侧读数 +
`judgement.agree_on_*`）· `data/results/audit-2026-11-12T22-00-00.000Z.json`（`env 0.2.2-rc.1 kernel-asar`、
289 claims → 242 rows → 93 verdicts、0 collisions）。

**注意「已判定 55 → 93」这一步**：M16 之前 CLI 只看得见 23 个 bundle 中的一部分 patch（
`dsh-web-app` 的 `presets/*.patch.yml` 四条根本没读），所以少判 38 行；读全之后 55 → 93。
这不是「多判了」，是原来那 38 行**没有被问**。

---

## 2. 那条 phantom collision 的完整证据链

```
CLI（0.3.7 / M14）：
  collision: llm-deepseek  conflicting-definitions
    owners : bundle:@deepseek-ai/dsh-base   patch:profile
    names  : @deepseek-ai/dsh-llm-deepseek  @deepseek-ai/dsh-llm-deepseek-api-key
```

三份 patch 文件里的同一个 row id（逐行读出来的）：

| 文件 | 版本 | `- id: llm-deepseek` 的 `name:` |
|---|---|---|
| `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`（pnpm hoisted 共享缓存） | **0.1.0-rc.6** | `@deepseek-ai/dsh-llm-deepseek` |
| `app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`（Host 真正加载的） | **0.2.2-rc.1** | `@deepseek-ai/dsh-llm-deepseek-api-key` |
| `~/.dsh/profiles/desktop/cordis.patch.yml`（用户的 profile patch） | — | `@deepseek-ai/dsh-llm-deepseek-api-key` |

设置页在 Host 里，看到的是第二、三行 → **同名同模块** → 不冲突。CLI 看到第一、三行 → **同名不同模块**
→ `conflicting-definitions`。**面板是对的，那条 collision 是 CLI 读错组合造出来的。**

同名不同名不止这一处：缓存 `dsh-base` 78 条 claims、内核 97 条，**9 条名字不同**（`hmr` / `settings` /
`llm-deepseek` 等），6 条只在缓存里；`dsh-web-app` 缓存 78 条、内核 119 条，**14 条不同**。

---

## 3. 根因（一句话）

`env.ts:272` 的 `kernelRoots` 只在 `anchor.source === 'kernel'` 时非空；`kernel-asar` 不是 `kernel`，
所以 CLI 的 `moduleRoots()` 里没有任何内核根。M14 把**版本**与 **manifest** 从归档读了，
**patch 文件**没有 → 组合层还是缓存那份。

---

## 4. 半修有数（为什么必须把它补完）

| 形态 | 实测 | 读作 |
|---|---|---|
| 只换版本（manifest 仍缓存） | **125 条**假 blocked | 比不修更坏（RECON-1 §4） |
| 只换 manifest（版本不动） | 8 条假 blocked 原样 | 没修 |
| M14（版本 + manifest） | 0 blocked，**1 条假 collision**，**55 判** | 修了大半，仍有噪音 |
| M14 + M16（版本 + manifest + patch） | **0 collision**，**93 判**，exit 0 | 与设置页逐项一致 |

第三条的残留不是「真事」——R101 把它写成真事（`llm-deepseek` Entry ID 同名），**那是错的**。
它之所以看起来像真事，是因为两份 patch 文件里 row id 确实同名：错的不是 id，是**其中一份文件来自另一个版本**。

---

## 5. 真机验收（M16-C6 / N6）

修后同一台机器、同一个 profile：

```
panel  dsh 0.2.2-rc.1 (kernel)      · 289 rows / 0 denied / 0 collisions
cli    dsh 0.2.2-rc.1 (kernel-asar) · 289 rows / 0 denied / 0 collisions
agree: version=true actionable=true
```

- `rows` 也从「242 vs 158」收敛成 **289 vs 289** —— 因为 CLI 现在读的 bundle 集合与 Host 相同（23 个），
  patch 文件也相同（`dsh-web-app` 的 5 条都读了）。
- 两侧 `dshSource` 标签仍然不同（`kernel` vs `kernel-asar`），这是**同一个运行时的两种描述**
  （Host 从 `process.argv` 走到内核、CLI 从归档文件读；M11-C7 / M14-C2 都写明了），不是不一致。
- 两侧只剩 `judged` 差 3（90 vs 93）：那 3 条是 Host 的**运行期** sample 过滤掉的 preset 行，
  在下一轮 `client-serve` 里会点名（`BS-71`）。

---

## 6. 盲区

| id | 看不见什么 |
|---|---|
| **BS-69** | 组合层同源只在**桌面壳 + 本账户默认 home**上成立；npm 全局安装、Linux 桌面壳、CI 没有归档 → 走 N2，行为与改前相同 |
| **BS-70** | `app.asar` 213 MB，`loadEnv` 与 `loadBundleLayers` 各读一次（本机 99–110ms / 次，RSS ≈ 483MB）；没有做跨调用缓存，同一进程两次判定看到的是两次读盘 |
| **BS-71** | 真机两侧 `judged` 差 3（90 vs 93），原因归到 Host 的运行期 sample，**本轮没有逐条点名**；`client-serve` 的 `same-source` 断言在自建 Host 上仍是全绿，所以它看不见这台机器上的那 3 条 |

---

## 7. 与 D5 的关系

不变：D5 仍 `pending`（0/10 · 0/1 · 675 `steady`/20），关窗 `2026-11-15T20:24:37Z`。
本轮**没有**动一个阈值、`admission.ts`、四桶、`data/gold/`。它修的是「同一台机器上两个界面说两套话」，
这是 `BS-63`（读数是「谁问」的函数）的第三次现场，也是 `ADDITION` 的定位本身：
**判断层要回答的是「你这套集合」，不是「我认为」**。
