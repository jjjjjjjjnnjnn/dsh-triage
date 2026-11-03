# ADR-0014 · 本地面板要求 `Host` 头匹配绑定地址（堵 DNS rebinding）

> **Status**: **accepted**（2026-11-03，R75；HUMAN 原话「**同意，继续**」，记账 `audit/SIGNOFF.md` 2026-11-03 行）
> **票号**: `T-811`（R49 发现；`docs/SECURITY.md` §3 的 DNS rebinding 一行目前写的是「部分防御 … 建议配置特定 Host 约束」）
> **取代**: 无。本 ADR 只加一条**请求准入**规则，不改任何判定（`admission.ts` / 四桶 / D5 阈值一字不动）
> **依据代码**: `packages/plugin/src/serve.ts`（`origin` 校验在 `:276-281`、token 在 `:283-286`、`listen` 在 `:258`）

---

## 1. 背景（现在的防线，以及它漏在哪）

`dsh-triage serve` 今天有四层防线：

| 防线 | 实现 | 挡住什么 |
|---|---|---|
| 只绑回环 | `listen(port, '127.0.0.1')`（`--host` 可改） | 同网段直接访问 |
| 一次性 token | 每次启动 `randomBytes(18)`；首次用 URL 里的 `?token=`，之后走 `HttpOnly; SameSite=Strict` cookie | 不知道 token 的页面 |
| Origin 白名单 | `^http://(127\.0\.0\.1\|localhost)(:\d+)?$`，空 Origin 放行 | 跨源 `fetch`（CSRF） |
| 无 CORS | 不返回 `access-control-allow-*` | 第三方页面读响应 |

**漏的是「浏览器以为自己在跟谁说话」。** DNS rebinding 的过程是：

1. 攻击者页面 `evil.com` 先解析到自己的服务器（页面加载完成，`Origin: http://evil.com` 只在这一步出现）；
2. DNS TTL 到期后 `evil.com` 解析到 `127.0.0.1`；
3. 页面用**同源**请求打 `http://evil.com:<port>/…` —— 浏览器发出的 `Host` 是 `evil.com:<port>`，而 **`Origin` 头在这种同源导航/简单请求里可以缺失**；
4. 我们的 Origin 校验对「没有 Origin」是放行的（浏览器自己发起的导航就是这种情况），于是**只剩 token** 这一层。

token 那一层是真的（没有 token 就 401），但 token 有两个已知的泄露面：URL 会进 shell 历史、截图、录屏；`SameSite=Strict` cookie 在同站子域场景下仍然会带。**结论：把「Host 必须是我绑定的那个地址」补上，DNS rebinding 就不再需要 token 泄露也能被挡住。**

## 2. 决策（提议）

**每一条请求都必须通过 Host 准入，否则 `421 Misdirected Request`（正文一句话说明期望值）。**

| 绑定方式 | 允许的 `Host` |
|---|---|
| 默认（`--host` 未给） | `127.0.0.1:<port>`、`localhost:<port>`、`[::1]:<port>`（大小写不敏感；端口必须与实际端口相同，**唯一例外见下**）。**注意**：默认 `listen` 只绑 `127.0.0.1`（`serve.ts:258`），所以 `[::1]` 那条现在**不可达**——它留在白名单里只是为了「以后真的绑 ::1」时不必再改一次规则 |
| `--host <addr>` 显式给出 | `<addr>:<port>`（IPv6 用方括号），**外加**默认那三条中的等价写法 |
| `--host 0.0.0.0` / `::` | 必须同时给 `--allow-host <name>[:<port>]`（可重复）；否则启动即拒绝并打印期望 |

**端口 80 的例外**：浏览器对默认端口会**省略** `Host` 里的端口（`http://localhost:80/` 发的是 `Host: localhost`）。第一版按「端口必须相同」实现，于是 `--port 80` 会拒绝**每一条**请求、面板直接死掉（独立 reviewer 在 R75 抓到）。现在的规则是：`Host` 不带端口时，只在**实际端口为 80** 的情况下按 `name:80` 再比一次；其它端口一律要求带端口（浏览器本来就会带）。

三条边界写进实现：

1. **默认路径零变化**：不给 `--host` 时，浏览器里 `http://127.0.0.1:<port>/?token=…` 与 `http://localhost:<port>/…` 都照旧可用；
2. **不做「宽松匹配」**：不用 `startsWith` / 不用 `includes`，`127.0.0.1.evil.com` 必须被拒（单测钉死）；
3. **错误不是 401**：Host 不对与 token 不对是两件事，混在一起会让人以为「token 坏了」而反复重开面板（R50 的教训：配置问题被报成产品坏了）。

## 3. 后果

| 方面 | 影响 |
|---|---|
| 安全 | DNS rebinding 从「部分防御」变成「需要 token **且** Host 匹配」；`docs/SECURITY.md` §3 那一行要从「建议配置」改成「已强制」 |
| 兼容 | **用局域网 IP 打开面板会失效**（这正是本 ADR 需要 HUMAN 点头的原因）。想要的人必须显式 `--host 0.0.0.0 --allow-host 192.168.1.7`（或直接 `--host 192.168.1.7`），把「我允许谁访问」写成参数而不是默认行为 |
| 兼容（R75 复审补充） | **端口转发 / 反向代理会失效**：`ssh -L 8080:127.0.0.1:<port>` 之后浏览器发的是 `Host: localhost:8080`，与实际端口不符 → 421。修法是 `--allow-host localhost:8080`（打印的链接也会用这个 `name:port`）。这不是漏洞，而是「Host 必须等于我绑定的那个地址」这条规则的直接后果，**如实记在这里** |
| 测试 | 两种绑定各一组：`Host` 正确 → 200；`Host` 是 `evil.com` / `127.0.0.1.evil.com` / 端口不符 → 421；默认路径不回归（现有 `serve.test.ts` 与 `serve-adversarial.test.ts` 全绿） |
| 文档 | `docs/SECURITY.md` §3 / §4 增补一条；README 的 `serve` 用法补 `--allow-host` |

## 4. 备选与为什么不选

| 案 | 做法 | 为什么不选 |
|---|---|---|
| A（本 ADR） | Host 白名单 + 显式 `--allow-host` | —— |
| B | 只靠 token，把「建议配置 Host」写进文档 | 现状。文档不是防线；R49 的 `BS-46` 已经证明「写了不等于有」 |
| C | 强制 `Origin` 必须存在 | 会挡掉浏览器直接导航打开面板（用户的第一步就是粘贴 URL），把正常用法判成攻击 |
| D | 用 `https` + 自签证书 | 对本地回环收益很小，还要引入证书管理与浏览器警告，成本远高于收益 |

## 5. 验收（实施时）

1. 四条敌意 Host 用例（默认通过 / `evil.com` 421 / `127.0.0.1.evil.com` 421 / 端口不符 421）**落在新文件** `tests/unit/serve-host-and-reuse.test.ts`（不是原文写的 `serve-adversarial.test.ts`，这是实施时的偏离，记在此处）；
2. `--host 0.0.0.0` 不给 `--allow-host` → 启动即 exit 2 并打印期望；
3. `--host 0.0.0.0 --allow-host <本机 IP>` → 从该 IP 打开 200。**未验收（如实记）**：没有做这次真机 LAN 打开，也没有对应产物；规则层由 `judgeHost` 的 LAN 用例覆盖，但「真的从另一台机器/另一个网卡打开」**没有证据**。不做它的理由：会绑定非回环地址并在本机防火墙上留一个监听，属需要 HUMAN 在场的动作 |
4. `pnpm run verify` + `gate.mjs --mutate` 全绿；`check_listing` 不因文档改动而红。

## 6. 签字区（HUMAN）

- [x] **同意**：接受「局域网 IP 默认打不开面板」，需要时用 `--allow-host` 显式开启（2026-11-03，原话「同意，继续」）
- [ ] 不同意：保持现状（token + Origin），并把 `docs/SECURITY.md` §3 的措辞改成「不做 Host 约束，理由：___」
- 签字日期：2026-11-03　原话：「同意，继续」　（已记账到 `audit/SIGNOFF.md`）

## 7. 实施记录（R75，2026-11-03）

| 项 | 落地 |
|---|---|
| 纯函数 | `packages/plugin/src/host-allow.ts`（`judgeHost` / `allowedHosts`），10 条单测覆盖：默认三名字、错端口、`127.0.0.1.evil.com` 一类「包含但不相等」、大小写与尾点、无 `Host`、`--allow-host` 的裸名与带端口两种写法、具体 LAN 绑定、通配绑定本身不是合法 Host |
| 请求准入 | `serve.ts` 的 `handle()` **第一步**就是 Host 判定，失败 → **421** 并给出期望列表（不是 401：Host 错与 token 错是两件事） |
| CLI | 新增 `--host <addr>` 与 `--allow-host <name[:port]>`（可重复）；`--host 0.0.0.0` / `::` 且没给 `--allow-host` → **启动即 exit 2** 并打印示例 |
| 打印的 URL | 绑定具体地址时打印该地址；通配绑定时打印第一个 `--allow-host` 名字（否则打印的链接会被自己的规则拒掉） |
| 默认路径 | 零变化：不给 `--host` 时 `127.0.0.1:<port>` / `localhost:<port>` 照旧 |
| 未做 | 没有做「按 `Origin` 推断 Host」之类的宽容回退；`[::1]` 仍在白名单里但默认不监听（`listen` 绑 `127.0.0.1`），这一点已在 §2 注明 |

证据：`tests/unit/serve-host-and-reuse.test.ts`（集成 5 条：默认通过 / 三种敌意 Host 各 421 / `--allow-host` 只放行它点名的那个 / **端口 80 省略** / **打印的 URL 合法且被规则接受**——后两条是复审 FAIL 后补的），`pnpm run verify` 746 测试 · 9 门 ALL GREEN。
