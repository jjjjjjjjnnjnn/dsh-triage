# M10 · 桌面桥的同源证据（desktop bridge）判据

> **Stand**: R91 (2026-11-09)｜**状态**: 判据先行，实现随本轮交付
> **这条 spec 回答一件事**：DSH Desktop 把页面跑在 `dsh-app://app`，它转发给 Host 时**删掉了**
> `Origin` 和 `Sec-Fetch-Site`，于是我们三条只读路由的守卫把它们判成「没有同源证据」并回 403。
> 我们要承认哪种调用方，以及**凭什么**承认它。
> **来源**：HUMAN 本人装了 `dsh-triage@0.3.4` 之后设置页显示
> `读取失败 · 403: request carries no same-origin evidence`（2026-11-09 现场截图与实测）。

---

## 1. 现象与证据

现场（`127.0.0.1:57654`，DSH Desktop `0.2.2-rc.1`，`dsh-triage@0.3.4`）：

| 请求 | 结果 |
|---|---|
| `GET /compat-triage/summary`，无任何头 | **403** `{"error":"request carries no same-origin evidence"}` |
| 同上，加 `Origin: http://127.0.0.1:57654` | **200**，3859 字节 |

根因在 `DeepSeek Harness/resources/app.asar` 的 `lib/main.js`：

```js
async function forwardWebRequest(request, host, cookie) {
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== 'dsh-app://app') return new Response(null, { status: 403 })
  const headers = new Headers(request.headers)
  for (const name of ['host', 'origin', 'cookie', 'sec-fetch-site']) headers.delete(name)
  headers.set('cookie', cookie)
  ...
}
```

页面在 `dsh-app://app`，相对 URL 的 fetch 走 `protocol.handle(SCHEME, …)` → `forwardWebRequest`
→ **两个同源证据都被删掉** → 我们的 `auditRequestVerdict()` 落到最后一行 → 403。

**同一个文件里，WebSocket 分支是相反的**（`session.defaultSession.webRequest.onBeforeSendHeaders`，
urls `ws://127.0.0.1/*` / `wss://127.0.0.1/*`）：

```js
if (headers.origin !== 'dsh-app://app') { callback({ cancel: true }); return }
callback({ requestHeaders: {
  ...headers,
  origin: target.origin,          // ← 补上了
  cookie: hostCookie,
  'sec-fetch-site': 'same-origin' // ← 也补上了
} })
```

也就是说桌面壳**已经会**给 Host 造同源证据，只是 HTTP 路径没这么做。这是上游自身的不一致，
见 §6「待报上游」。

## 2. 边界（写进代码里的）

1. **标记头不是认证，是调用方自报。** spec、代码注释、CHANGELOG 三处都不得把它写成「验证了身份」。
   它证明的是「这个请求想用插件的设置页」，不是「这个请求来自那个页面」。
2. **威胁模型不变。** 我们防的始终是**跨站页面读本机诊断**。跨站页面发自定义头会触发 CORS 预检，
   而我们的路由是 `node:http` 手写路由、**不回 `OPTIONS`** → 预检失败 → 请求根本发不出去。
   这一条是新分支之所以安全的全部理由，必须写进负对照。
3. **本机非浏览器进程从来不在威胁模型里。** 它能直接读 `~/.dsh/profiles/*/package.json`，
   标记头对它的「增量暴露」为零。这一点要在 spec 里明说，不能假装我们挡住了它。
4. **有标准证据时不用标记头。** 浏览器直接访问 `http://127.0.0.1:<port>` 的路径逐字节不变。
5. **方法检查排第一。** 新分支不得让 `POST` / `PUT` 通过任何一个路由。
6. **一个守卫，三条路由。** `/compat-triage/audit`、`/compat-triage/summary`、
   `/compat-triage/upgrade` 共用 `auditRequestVerdict()`，新分支自动对三者生效；
   不允许只给其中一条开洞。

## 3. 判据

| 编号 | 判据 | 由什么证明 |
|---|---|---|
| **M10-C1** | 判定顺序固定为：① 方法不是 `GET`/`HEAD` → 405；② `origin` 存在但不是 `http(s)://<host>` → 403 `cross-origin request refused`；③ `origin` 存在且同源 → 通过；④ `origin` 缺失且 `sec-fetch-site === 'same-origin'` → 通过；⑤ `origin` 缺失且 `sec-fetch-site` 存在但**不是** `same-origin` → 403（**不因标记头放行**）：`cross-site` 说 `cross-origin request refused`，其他值（`none` / `same-site`）说 `request carries no same-origin evidence`；⑥ `origin` 与 `sec-fetch-site` **都缺失** → 标记头为 `x-dsh-triage-client: settings-tab` 才通过，否则 403 `request carries no same-origin evidence` | 纯函数 `auditRequestVerdict()` + 单测逐条 |
| **M10-C2** | 第 ⑤ 条与第 ⑥ 条严格分开：只要 `sec-fetch-site` 出现过，标记头**无权**翻案。理由是「浏览器总会带一个」这句话在 ④/⑤ 这一层仍然成立；被删掉的只有 ⑥ 这一种情形 | 单测：`sec-fetch-site: cross-site` + 标记头 → 403 |
| **M10-C3** | 标记头**只在两者都缺失时**参与判定：`Origin: https://evil.example` + 标记头 → 403（`cross-origin request refused`，不是「没有证据」） | 单测两个方向各一条 |
| **M10-C4** | 方法检查优先于一切：`POST` + 标记头 → **405**（不是 403、不是 200） | 单测；三条路由各一条 |
| **M10-C5** | 头名与头值各只有一个来源：导出常量 `CLIENT_MARKER_HEADER = 'x-dsh-triage-client'`、`CLIENT_MARKER_VALUE = 'settings-tab'`，`client.js` 引用的字符串必须与之一致 | 单测读 `client.js` 源码断言两个常量都出现（防止一边改名一边忘） |
| **M10-C6** | 有标准证据的路径逐字节不变：`Origin` 同源、`sec-fetch-site: same-origin` 两种情况的返回体与改动前相同 | 既有 `host-audit-route` / `host-summary-route` / `host-upgrade-route` 三份测试里的正例一条都不许改 |
| **M10-C7** | 三条路由共用同一个守卫：任何一条路由的守卫测试都必须调用 `auditRequestVerdict` 的结果，不允许各自写一套 | `rg` 断言：`auditRequestVerdict(` 只出现在 `host-audit-route.ts` 的定义处与两处 import 调用 |

## 4. 负对照（必须真红）

| 编号 | 构造 | 期望 |
|---|---|---|
| **N1** | `origin: undefined`、`secFetchSite: undefined`、**无标记头** | 403 `request carries no same-origin evidence`（没放松到裸奔） |
| **N2** | `origin: 'https://evil.example'` + 标记头 | 403 `cross-origin request refused`（跨站不能靠标记头洗白） |
| **N3** | `origin: 'http://127.0.0.1:1'`、`secFetchSite: undefined`、无标记头 | 通过（原正例不退化为反例） |
| **N4** | `origin: undefined`、`secFetchSite: 'same-origin'`、无标记头 | 通过（同上） |
| **N5** | `method: 'POST'` + 标记头 + 两者都缺失 | **405**，且 `read()` 调用次数为 0（新分支不得绕过方法检查，也不得提前读盘） |
| **N6** | 标记头名拼错（`x-dsh-triage-clien`） | 403 |
| **N7** | 标记头值不对（`settings-tab-v2` / `curl`） | 403（精确相等，不做前缀匹配） |
| **N8** | `origin: undefined`、`secFetchSite: 'cross-site'` + 标记头 | **403**，且错误串**不是** `no same-origin evidence`（证明 ⑤ 与 ⑥ 确实是两回事） |
| **N9** | 把三条路由的 handler 各跑一遍 N1 | 三条都 403，且 `read()` 都是 0 次 |
| **N10** | 把三条路由的 handler 各跑一遍「两者都缺 + 正确标记头」 | 三条都进入 `read()`（证明一个守卫三条路由都生效，不是只开了一条） |

N1 与 N10 是这一对的眼睛：**只做 N10 会得到一个「谁都能读」的洞，只做 N1 会得到一个「桌面还是打不开」的摆设。**

## 5. 客户端这一侧

`packages/plugin/client.js` 只有两处 `fetch`（`SUMMARY_URL` 与 `UPGRADE_URL`），两处都加：

```js
headers: { accept: 'application/json', 'x-dsh-triage-client': 'settings-tab' }
```

**不新增第三处 fetch**；不改成 POST；不改 `credentials: 'include'`（桌面桥会用 Host 自己的 cookie 覆盖它）。

## 6. 待报上游（不在本轮实现）

`forwardWebRequest` 与 WebSocket 分支的不一致，值得直接报给 `deepseek-ai/deepseek-harness`：

> HTTP 转发路径删掉 `origin` / `sec-fetch-site`，而同一文件的 WebSocket 转发路径会补
> `origin: target.origin` 与 `sec-fetch-site: same-origin`。建议 HTTP 路径对齐，
> 这样任何写同源守卫的插件都不必各自发明一个标记头。

**本轮不做**：我们不依赖上游何时修（修了也不会破坏我们的行为——标记头那一条会自然不再被用到）。

## 7. 诚实边界

- 这个判据**没有变强，是变窄**：它承认的调用方从「会带标准证据的浏览器」扩到「会带标准证据的浏览器
  **或**自称是设置页的调用方」。扩的那一格，靠的是「跨站页面过不了预检」这一条真实机制。
- 我们**没有**验证标记头真的来自我们那份 `client.js`。做不到，也不假装做到了。
- 如果将来上游修了 `forwardWebRequest`，⑧ 之后可以回头把第 ⑥ 条**收回**——但那要有实测证据，
  不能因为「看起来修好了」就删。
