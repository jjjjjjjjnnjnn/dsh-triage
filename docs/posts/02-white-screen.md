# `curl` 是 200，页面是白的：白屏要按 DOM 判，不能按 HTTP 判

> 状态：**未发布**（草稿，R45）。证据全部来自本仓 `data/results/render-fixture-*.json` 与 `probe-*`，文末给复算命令。

## 现象

插件装完，Host 起来了，`curl -I http://127.0.0.1:3080` 回 200，浏览器打开却是一片白。

这是最容易被误判的一类失败：**HTTP 健康检查看的是"服务在不在"，不是"界面有没有挂上"**。前端挂载失败时，入口 HTML 照样 200——它只是没有内容。

## 为什么健康检查抓不到

DSH 的 Web 面是「Host 组进图 + client bundle 由 runner 执行 + 插槽接收注册」三段。任何一段断了，`/` 都还能回 200：

| 断在哪 | HTTP | 页面 |
|---|---|---|
| Host 没起来 | 连不上 | — |
| Host 起来、路由 404 | 404 | 白 |
| Host 起来、bundle 装上了但 `apply` 没执行 | **200** | **白** |
| bundle 执行了、slot 不接受注册 | **200** | 白（少一块） |
| 全通 | 200 | 有内容 |

第 3、4 行就是 `curl` 抓不到的那两格。

## 判据：挂载点有没有子节点、有没有可见文本

本仓的做法是**用真浏览器读 DOM**，判三件事（`packages/probe/src/render.ts` 的 `judgeRender`）：

1. 挂载点（`#root`）**有子节点**；
2. 可见文本 ≥ **20 字符**；
3. 不是 loading 占位。

三条都满足才是 `rendered`；有 200 但挂载点空 → `blank`；拿不到浏览器 → `unmeasured`（**不判通过**）。

红/绿对照是同一台机器、同一分钟跑出来的两份产物：

- 红：`data/results/render-fixture-blank-2026-10-27T12-58-42.000Z.json` —— 200，但挂载点空，判 `blank`；
- 绿：`data/results/render-fixture-rendered-2026-10-27T12-58-49.000Z.json` —— 有文本，判 `rendered`。

这条对照存在的意义：**证明判定不是恒绿**。一个永远回 `rendered` 的探针，比没有探针更糟。

## 一个真踩过的坑：`--dump-dom` 在这台机器上不可用

本机 Chrome 154 / Edge 146：`chrome --headless --dump-dom <url>` 和 `--screenshot` 都**返回 0 字节并挂满 60 秒**（不是参数写错）。所以渲染判定走 CDP：`--remote-debugging-port=0` + `<profile>/DevToolsActivePort` + `Runtime.evaluate`。Node 22 自带 `WebSocket`，不需要 puppeteer。

如果你的环境里 `--dump-dom` 正常，用它也没问题；关键是**判定逻辑不看输入来源**，只看 DOM 形状。

## 怎么自己复核

```sh
# 红样本（200 + 空挂载点）
node scripts/record_render_fixture.mjs --mode blank --expect blank --stamp <ISO>
# 绿样本（有内容）
node scripts/record_render_fixture.mjs --mode rendered --expect rendered --stamp <ISO>
```

`probe` 把这一步接在 boot 之后、杀树之前——顺序反了会打在死端口上（本仓 R14 踩过一次）：

```sh
dsh-triage probe <包> --execute --dsh-main <沙盒里的 dsh 入口> --browser <chrome>
```

产物里看 `steps[].id=render` 与 `verdict`，`readiness.source` 应该是 `host-url`（URL 由 Host 自己打印，不靠猜端口）。

## 诚实边界

- 这是**结构判定**，不是视觉回归：canvas 画的东西、纯图标按钮、字体没加载，它都看不见（只能 `inconclusive`）。
- 没有浏览器 = `unmeasured`。**不许**在没有真浏览器时把它算成通过——CI 里那台 runner 是预装 Chrome 的（`ADR-0005`），缺了就让作业失败，不降级。
- 20 字符阈值是**经验值**：它挡住的是「空壳 + loading」，挡不住「挂上了但画错」。

## 给写 issue 的人

「白屏」这个描述本身不够。附三样东西，维护者能在 5 分钟内定性：

1. 那份 `probe` 产物的 `steps[]`；
2. `boot` 段里的 `url_printed` / `startup_failed` / `error_tail`；
3. `render` 段的判定与浏览器版本。

没有这三样，白屏就只能是「看起来不工作」——而那不是证据。
