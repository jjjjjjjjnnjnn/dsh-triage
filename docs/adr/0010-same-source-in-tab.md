# ADR-0010 · 设置面板的「同源结论」走哪条通道

> **状态**：accepted（R33，2026-10-29）｜**决定者**：implementer（R33 计划经 HUMAN「同意，继续，处理所有问题」授权）｜**可撤销**
> **相关**：`docs/specs/M4-surface.md` §3.2 / §3.3 · `packages/plugin/src/host-audit-route.ts` · `packages/plugin/client.js`
> **证据**：`data/results/spike-typert-2026-10-28T23-30-00.000Z.json`（通道一）· `data/results/spike-route-2026-10-29T01-40-00.000Z.json`（通道二）· `data/results/client-serve-2026-10-29T01-20-00.000Z.json`（实现后真机）

---

## 1. 问题

M4-a 的出口是「面板能看到与 CLI **同源**的结论」。R30/R31 已经把 tab 挂进 `设置 → 插件`（真机 `registered:true`、`visible:passed`），但 tab 里**不能有结论**：浏览器读不到 `data/results`，而按铁律 1 在浏览器里自算结论是把「没有证据」写成「有结论」。

所以问题只剩一个：**Host 侧用哪条通道把 CLI 自己的 payload 递给浏览器。**

## 2. 两条候选通道（都真机测过）

| | 通道一：Typert Remote | 通道二：同源只读 HTTP 路由 |
|---|---|---|
| 上游做法 | `@deepseek-ai/dsh-host-plugin-inventory` 由 **typert-generator 生成** host face + remote-client face | `ctx.webServer.register({ kind:'exact', path, handler })`，上游的 `/api` 桥、插件资产都走这条 |
| 第三方手写可行性 | **host 侧可以**：手写 `exports["./typert"]` + `createTypertRemoteInfo` + 手写 remote-methods 描述符（`.js` 无装饰器语法），`ctx.typert.local.list()` 里真的出现了 `compatSpike/ping` | **端到端可以**：真实页面里我方 classic-script 客户端 `fetch('/compat-spike/ping')` 拿到 `{ok:true,from:'host-route'}` |
| 浏览器侧 | **拿不到**：`ctx.remote` 没有第三方命名空间；在 factory `inject` 里声明 `remote.compatSpike` 后**整个客户端模块不执行**（页面从未发布标记）。上游那条路依赖 `*.remote-client.js` 生成物（带 `zod`），我们要么引打包器 + `zod`，要么放弃「手写无依赖 client.js」的既有决定 | 无需打包器、无需 `zod`、无需客户端 face |
| 成本 | 新运行时依赖 + 生成物 + 客户端构建链 | 一个 handler + 一组拒绝规则 + 单测 |
| 证据 | `spike-typert`：`registry:passed`（端点已注册）/ `call:unmeasured`（客户端未执行） | `spike-route`：六步全绿 |

## 3. 决定

**走通道二：Host 侧一条只读路由 `GET /compat-triage/audit`。**

- 数据由 `loadAuditData()` + `auditJsonPayload()` 生成 —— 与 `dsh-triage audit --json`、`serve --audit` **同一个函数**，所以不是「两套实现」；
- 路由**只读**：只允许 `GET`/`HEAD`，要求同源证据（`Origin` 与 `Host` 相符，或 `Sec-Fetch-Site: same-origin`），无同源证据一律 403；读不到 profile → **409 + CLI 同一句**（绝不回 `200 []`）；`cache-control: no-store`；
- tab 只对 payload 的 `rows` / `row_verdicts` **计数**，不自造结论、不在缺失时猜；
- 通道一**不实现**，但结论留在 ADR 与产物里：**注册是可行的，浏览器侧不可行（除非接受一条带 `zod` 的客户端生成链）**。

## 4. 后果

- **R33 真机通过**：`same-source` 步把 tab 与 CLI 在同一 profile 上比对，两侧都是 **192 行 / 0 go / 0 blocked / 184 unknown**；负对照（把 CLI 指到另一个 home）判 `failed`（192 vs 190），证明比较不是恒真。
- **新面**：产品多了一个只读 HTTP 端点。它的边界写进 `host-audit-route.ts` 头注释与 7 条单测；不读凭据、不写 `~/.dsh`、不接受参数。**撤销方式**：`cordis.patch.yml` 里给该行加 `config.auditRoute: false`，或回退 `host.ts` 的注册块。
- **依赖**：`packages/plugin` 的运行时依赖没有变化（没有新增 `@deepseek-ai/dsh-typert-protocol`、没有 `zod`）。
- **仍需注意**：`ctx.baseUrl` 在这版 Cordis 里是 **profile 目录**（不是 `cordis.yml` 的 URL），且 `ctx.webServer` 只有在 `inject` 声明（且默认导出也带 `inject`）时才在 apply 时可用 —— 这两条各让 R33 白跑了一轮，已写进 `docs/HANDOFF.md` §4 的坑表。

## 5. 未选方案与其代价（不撤销的事实）

1. **Typert Remote（通道一）**：host 侧可行、浏览器侧需要 `remote-client` 生成物 + `zod`；与我们「client.js 手写、无打包器」的决定冲突，代价大于收益。
2. **面板自算结论**：违反铁律 1，直接排除。
3. **只给入口不给结论**（R31 的做法）：诚实但没达成 M4-a 出口 —— 本轮把它替换掉了。

## 6. 复核方式

```powershell
node scripts/record_client_serve.mjs --dsh-main sandbox/upstream/0.2.1-rc.4/install/node_modules/@deepseek-ai/dsh/lib/bin.js --stamp <iso>
node scripts/record_remote_spike.mjs --channel typert --label spike-typert --dsh-main <同上> --stamp <iso>
node scripts/record_remote_spike.mjs --channel route  --label spike-route  --dsh-main <同上> --stamp <iso>
```

读法：`client-serve` 的 `same-source` 步必须是 `passed` 且 `tab_data == cli_data`；`spike-typert` 的 `call` 步是 `unmeasured`（不是 `passed`）；`spike-route` 的 `call` 步是 `passed`。
