# ADR 0005 · 渲染判定的后端选择（谁能证明「画面出来了」）

> **状态**：已采纳（2026-10-27） | 影响面：`packages/probe/src/render.ts`、CI、`docs/specs/M3-probe.md` §5/§9
> **触发**：R15 复核后的口径问题是「渲染只在 Windows 上测过，CI 里永远是 `unmeasured`」。调查后发现**这个前提本身是错的**，于是先纠正事实，再定后端。

## 背景

T-302 的判据要回答的是「HTTP 有应答之后，页面到底有没有挂载出可见内容」。这需要**执行页面里的 JavaScript**，而可选手段只有四类：

| 后端 | 能证明什么 | 需要什么 | 平台/CI | 代价 |
|---|---|---|---|---|
| **A. 系统浏览器 + CDP**（现行） | 真渲染：JS 执行、挂载、可见文本 | 本机有 Chromium 系浏览器 | 本机已验证；**GitHub ubuntu/windows runner 自带** | 1–4s，零依赖 |
| B. DOM 模拟（happy-dom / jsdom） | 「JS 有没有创建出节点」 | 可选依赖（happy-dom 9.2MB / jsdom 5.5MB unpacked） | 到处都能跑 | 新依赖；无布局/CSS，Web Components 与部分 API 会静默缺失 |
| C. 应用内上报（guard 式） | 用户**真实**应用里的渲染崩溃 | 需要在被观测的客户端里挂一段 reporter | 产品内可用 | 需要 client bundle 契约（见 `M4-surface.md`） |
| D. 服务端静态检查（HTML + chunk 可达） | 资源发得出去 | 无 | 到处都能跑 | **对 BS-03 基本无效**：白屏时 HTML 与 chunk 全是 200 |

**R15 的错误前提**：交接文档写过「Linux CI 无浏览器，渲染断言在 CI 只能是 `unmeasured`」。查 GitHub Actions 的 runner 镜像清单（Ubuntu 24.04 / image `20261023.334.3`）：**Google Chrome 155.0.8059.39、Chromium 155、Edge 155.0.4283.45、xvfb 全部预装**。所以 CI 从来不是障碍，我们的测试分层才是（单测故意不 spawn 浏览器）。

## 决定

1. **A（系统浏览器 + CDP）是唯一能给出 `passed` 的后端**；不引入 playwright/puppeteer（体积与「用户安装件」不相称），也不打包 Chromium。
2. **CI 增加一条真实浏览器作业**（`render-control`，ubuntu）：跑 `blank` / `rendered` / `error` 三个对照，产物写 `$RUNNER_TEMP`（CI 不许写 `data/results`）。runner 若没有浏览器，作业**明确失败**而不是静默降级。
3. **B 不采纳为主后端**：DOM 模拟只能证明「JS 创建了节点」，不能证明「屏幕上有东西」，而后者才是 BS-03。将来若某台用户机器确实没有浏览器，可以增加 `backend: "dom-emulation"` 并把结论**降级**（不能与 A 同级），这需要先修订本 ADR 与证据 tier。
4. **C 只用于产品内面板**（M4）：它能观测用户真实组合里的渲染崩溃，但需要往被观测客户端注入代码，且用户装的是我们自己——不用于评估第三方候选。
5. **D 明确不做**：留作「资源可达性」检查可以，但**不得**用于 `client-rendered`。
6. 产物必须记 `render.backend`，`client-rendered: passed` 只在 A 下成立。

## 后果

- 「渲染只在 Windows 测过」的口径作废：Linux CI 每轮都跑同一套对照，跨平台证据变成**持续**而非一次性；
- 代价：CI 多一个 job（约 1–2 分钟），且依赖 runner 镜像自带 Chrome——镜像变了作业会红，这正是我们要的失败方向；
- `happy-dom`/`jsdom` 不进依赖树，`package.json` 体积不变。

## 替代方案（未采纳）

| 方案 | 为什么不 |
|---|---|
| 打包 chromium-headless-shell 进 npm 包 | 120MB+，为了一个可选断言把安装件变重；上游插件生态普遍用「系统浏览器 / Electron」 |
| 用 `dsh-builtin-browser`（Electron，MIT）当渲染后端 | Electron 依赖 100MB+，且它是给 Agent 用的可见浏览器，不是探针的从属组件 |
| 在 CI 里 `apt-get install chromium` | runner 已自带；自己装只会把「镜像事实」变成我们的维护负担 |
| 只看 HTML + chunk 200 | 白屏时它们全是 200（`BS-03` 的原话），这正是要避免的假绿 |
