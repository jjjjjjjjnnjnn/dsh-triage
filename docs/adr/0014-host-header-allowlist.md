# ADR-0014 · 本地面板要求 `Host` 头匹配绑定地址（堵 DNS rebinding）

> **Status**: **proposed**（2026-11-03，R75；**未实施，等 HUMAN 签字**）
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
| 默认（`--host` 未给） | `127.0.0.1:<port>`、`localhost:<port>`、`[::1]:<port>`（大小写不敏感；端口必须与实际端口相同）。**注意**：默认 `listen` 只绑 `127.0.0.1`（`serve.ts:258`），所以 `[::1]` 那条现在**不可达**——它留在白名单里只是为了让「以后真的绑 ::1」时不必再改一次规则 |
| `--host <addr>` 显式给出 | `<addr>:<port>`（IPv6 用方括号），**外加**默认那三条中的等价写法 |
| `--host 0.0.0.0` / `::` | 必须同时给 `--allow-host <name>[:<port>]`（可重复）；否则启动即拒绝并打印期望 |

三条边界写进实现：

1. **默认路径零变化**：不给 `--host` 时，浏览器里 `http://127.0.0.1:<port>/?token=…` 与 `http://localhost:<port>/…` 都照旧可用；
2. **不做「宽松匹配」**：不用 `startsWith` / 不用 `includes`，`127.0.0.1.evil.com` 必须被拒（单测钉死）；
3. **错误不是 401**：Host 不对与 token 不对是两件事，混在一起会让人以为「token 坏了」而反复重开面板（R50 的教训：配置问题被报成产品坏了）。

## 3. 后果

| 方面 | 影响 |
|---|---|
| 安全 | DNS rebinding 从「部分防御」变成「需要 token **且** Host 匹配」；`docs/SECURITY.md` §3 那一行要从「建议配置」改成「已强制」 |
| 兼容 | **用局域网 IP 打开面板会失效**（这正是本 ADR 需要 HUMAN 点头的原因）。想要的人必须显式 `--host 0.0.0.0 --allow-host 192.168.1.7`，把「我允许谁访问」写成参数而不是默认行为 |
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

1. `tests/unit/serve-adversarial.test.ts` 新增 4 条：默认 Host 通过 / `evil.com` 421 / `127.0.0.1.evil.com` 421 / 端口不符 421；
2. `--host 0.0.0.0` 不给 `--allow-host` → 启动即 exit 2 并打印期望；
3. `--host 0.0.0.0 --allow-host <本机 IP>` → 从该 IP 打开 200（本机实测一次，产物进 `data/results/`）；
4. `pnpm run verify` + `gate.mjs --mutate` 全绿；`check_listing` 不因文档改动而红。

## 6. 签字区（HUMAN）

- [ ] **同意**：接受「局域网 IP 默认打不开面板」，需要时用 `--allow-host` 显式开启
- [ ] **不同意**：保持现状（token + Origin），并把 `docs/SECURITY.md` §3 的措辞改成「不做 Host 约束，理由：___」
- 签字日期：____　原话：____　（记账到 `audit/SIGNOFF.md`）

> **未签之前不实施**：本 ADR 落地前，`docs/SECURITY.md` §3 的 DNS rebinding 一行必须保持「部分防御」，**不许**写成已强制。
