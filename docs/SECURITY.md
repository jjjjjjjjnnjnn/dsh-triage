# 安全模型（SECURITY）

> **Stand**: R49 (2026-10-30)｜**适用面**: `dsh-triage serve` 本地面板、CLI 对磁盘的读取、`data/results` 的产物读取
> **不是**「已安全」的宣告。这是一份**威胁模型 + 已实施的拒绝清单 + 明确不防什么**。改面板前先读 §5 的三条红线。

---

## 1. 我们保护什么（资产）

| 资产 | 在哪 | 泄露/破坏的后果 |
|---|---|---|
| 本机 DSH profile 的组成（行 id、模块名、版本） | `~/.dsh/profiles/<name>` | 暴露用户装了哪些插件；不含凭据 |
| `data/results/*.json` 证据产物 | 仓库目录（可 `--results` 改） | 产物本身已脱敏（`results-privacy` 门），但仍可能含机器指纹 |
| 面板的**判定结果** | 内存 / HTTP 响应 | 被篡改成「一切正常」= 产品失效 |
| 用户的**修复命令**（复制到剪贴板） | 页面按钮 | 若被替换成恶意命令，用户会照着敲 |

**不在资产里**：`~/.dsh/credentials`、npm token、任何环境变量值。面板从不读它们；`env` 指纹只出 `dsh/node/platform/arch/profile/profileDir(脱敏)/bundles/installed`。

## 2. 信任模型（谁可能攻击）

| 攻击者 | 能力 | 我们的立场 |
|---|---|---|
| **同机其它用户** | 能连 `127.0.0.1`，但读不到本进程的 URL/token | 挡：token + 随机端口 |
| **同机同用户的其它进程** | 能读 `ps`/命令行、能读 `~/.dsh` | **不挡**（见 §4） |
| **浏览器里的恶意页面** | 能发跨源请求、能开 iframe | 挡：Origin 白名单 + `SameSite=Strict` cookie + 无 CORS 头 |
| **DNS rebinding** | 让 `evil.example` 解析到 `127.0.0.1` | 部分挡：token 仍未知；未做 Host 头校验（§4） |
| **`data/results` 里的恶意内容** | 能放任意文件名/内容（例如被投毒的产物） | 挡：名字白名单 + realpath 包含性 + 2MB 上限 + 只当数据不当代码 |
| **供应链**（依赖） | 装包时执行脚本 | 面板/门禁**零运行时依赖**；CLI 依赖 `yaml` 等固定版本，锁文件入库 |

## 3. 已实施的拒绝（每条都有测试）

| 威胁 | 控制 | 位置 | 测试 |
|---|---|---|---|
| 路径穿越（`../`、`..\`、`%2e%2e%2f`、`\\server\share`、ADS `x.json:stream`、NUL、全角斜杠、`‥`） | 名字必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*\.json$` 且不含 `..`；**在碰磁盘之前**判 | `serve.ts` `/api/artifact` | `serve-adversarial` · *every traversal spelling is refused* |
| 符号链接 / NTFS junction 逃出结果目录 | `resolveArtifact()`：`realpathSync` 后 `relative()` 必须仍在 `resultsDir` 内 | `serve.ts#resolveArtifact` | *a link inside the results directory cannot point the panel outside it*（Windows 用 junction 真跑） |
| 超大文件耗尽内存 | 列表与详情都按 `MAX_ARTIFACT_BYTES = 2MB` 拒绝；列表**不解析**超限文件 | `summarizeArtifact` / `resolveArtifact` | *an artifact over 2MB is refused…never parsed by the listing* |
| 畸形 JSON | 详情 422（不是 500），列表降级为「无结论」 | `/api/artifact` | *malformed JSON is a 422* |
| 未声明的方法 | `POST` → 403（`--allow-execute` 也只 501）；其它非 GET → 405 | `handle()` | *only GET is served…* |
| 猜测/近似 token | 长度先比、再 `timingSafeEqual`；空 token 不特殊放行 | `sameToken` | *the token is the only way in* |
| 跨源读取 | `Origin` 必须匹配 `^http://(127\.0\.0\.1|localhost)(:\d+)?$`；`127.0.0.1.evil` / `https://` / `null` 全部 403；不发 CORS 头 | `handle()` | *origins that merely start with 127.0.0.1…* |
| 并发把事件循环压死 | 单飞：并发请求共享一次扫描；**无 TTL**（下一次点击重新读） | `singleFlight()` | *ten concurrent readers share one scan…* |
| 页面被自己的 CSP 打死 | `connect-src 'self'`（`default-src 'none'` 会连带禁止 `fetch`） | `/` 响应头 | *the CSP lets the page call its own API* |
| 深链带入非法名字 | `#artifact=<名>` 只作为 `/api/artifact?name=` 的输入，走的仍是同一套名字校验 + realpath 包含性检查；深链不新增任何读写能力 | `renderPanelHtml` 初始化段 | `serve-adversarial` · *every traversal spelling is refused*（同一个入口） |
| XSS（产物名/结论/错误信息进 DOM） | 所有插值过 `esc()`（`& < > " '`）；注入脚本的文案 `JSON.stringify(...).replace(/</g,'\u003c')`；无 inline 事件属性 | `renderPanelHtml` | 见 §5 红线 |
| 令牌被 Referer 带走 | 页面无任何外部资源（`img-src data:`、无 CDN） | CSP | *the page ships no remote assets* |

**读不到 ≠ 干净**（这一类不是「攻击」，但同样会骗人，所以列在这里）：

| 场景 | 行为 | 测试 |
|---|---|---|
| 面板以 `--no-audit` 启动 | `/api/summary` 与 `/api/audit` 都 **501**，不返回空账 | `serve.test` · *the panel is started without a loader* |
| profile 读不到 | 409 + CLI 同一句；页面横幅变红 | *an unreadable profile is 409…* |
| 扫描抛异常 | 500；面板继续服务；单飞槽位释放 | *a loader that throws is a 500* / *a scan that throws still releases…* |
| profile 有 0 行 | `attention` + 「通常是 --dsh-home/--profile 指错了」 | `summary.test` · *an empty composition is not a clean one* |
| 156 行里只有 2 行有判定 | 计数写成 `156 行（2 行有判定）` + 一句「其余 154 行不声明任何 DSH 区间——沉默不等于通过」 | *rows and judged are different numbers* |

## 4. 明确**不**防（写出来，免得被当成保证）

1. **同机同用户的其它进程**：token 在启动 URL 里，`Get-Process`/`ps` 能看到命令行；能读 `~/.dsh` 的进程也能直接读 profile，不需要面板。面板的威胁模型是「浏览器里的别的页面」，不是「本机恶意软件」。
2. **Host 头**：没做 `Host` 白名单，DNS rebinding 场景下仍靠 token 兜底。要补的话是 `Host` 必须等于 `127.0.0.1:<port>` 或 `localhost:<port>`——但会让「用局域网 IP 打开」直接失效，故留作 ADR 级决定。
3. **产物内容的语义**：`data/results` 里如果有人放一份伪造的 `probe-*.json`，面板会照实展示它（带文件名与 sha256）。面板不判断「这份产物是否可信」，那是 `gate_ssot` 与 `produced_by` 的职责。
4. **`--allow-execute`**：它只是**门**，不是能力。`POST` 仍然 501，因为「从浏览器跑 probe」还没实现（`M4-a`）。
5. **多用户 / 远程访问**：只绑 `127.0.0.1`；`--host` 存在但不建议，绑到 `0.0.0.0` 等于把 token 暴露给网段。
6. **CLI 的写操作**：`outcomes --purge` 删的是自己的存储目录；`probe` 只在独立 `DSH_HOME` 下操作；**任何代码都不写 `~/.dsh`**（铁律 4）。
7. **DoS 的极端形态**：单飞挡的是「同一时刻的重复扫描」，不挡「每秒一次的顺序扫描」；本地面板没有速率限制。

## 5. 三条不许退的红线（改面板时）

1. `resolveArtifact()` 的 **realpath 包含性检查**：名字正则只是第一道锁，链接/junction 是第二道。删掉任何一道，`data/results` 里一个链接就能读全盘。
2. **`connect-src 'self'`**：`default-src 'none'` 会连带禁止 `fetch`，页面会变成「看起来正常、其实永远空」——R49 真踩过，冒烟脚本当时写着「no browser is involved」，所以一直没发现。
3. **关闭 = 501，不是空账**：`--no-audit`、读不到 profile、扫描抛异常，三种「没看见」都必须与「看见了且干净」在状态码/横幅上可区分。

## 6. 怎么自己验一遍

```powershell
pnpm run build
node --test tests/unit/serve-adversarial.test.ts   # 11 条拒绝
node --test tests/unit/serve.test.ts               # 面板契约（含 CSP）
node scripts/record_serve_smoke.mjs --stamp <ISO>  # 18 项真跑（含 501 两态 + page-controls）
```

浏览器侧（R49 起，改面板**必须**至少跑一次）：

```powershell
node packages/plugin/dist/cli.js serve --port 0   # 打印带 token 的 URL
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --window-size=1200,1000 --virtual-time-budget=9000 --screenshot=panel.png "<URL>"
```

验收：截图里能看到**结论横幅 + 计数 + 要看的地方**；如果只有标题和空区块，先查 CSP 与 `/api/summary` 的状态码。

## 7. 报告问题

仓库是 public。发现绕过 §3 任一条，请开 issue 并附：命令、响应状态码、以及 `node --test` 的失败输出；**不要**在 issue 里贴真实 token 或 `~/.dsh` 的绝对路径。
