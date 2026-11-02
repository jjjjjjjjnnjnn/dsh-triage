<!-- channel: reply in upstream discussion #10849 (Chinese) · draft -->
<!-- 状态: draft（未发布）。回复场景：针对 #10849 裸名安装 @deepseek-ai/dsh-mcp-client 因 latest 标签失步导致被拦截的问题进行技术归因与解决建议。 -->

# 草稿 07 · 回复 #10849（`latest` 标签指向 0.0.1-rc.1 导致裸名安装被拦截）

> **归因分析**：故障根因不在使用者本机的 Profile 约束区间，而在于 npm 仓库上的 dist-tag 标签指向。

---

你好，关于裸名安装被提示不兼容的问题，这里的准入拦截根因**不在于你本地写的配置区间，而在于 npm 的 `latest` 标签指向**。

经核实，npm 上的 `@deepseek-ai/dsh-mcp-client` 当前 `latest` 标签指向了早期发布的 `0.0.1-rc.1`。该构建版本的 peerDependencies 声明完全锁定在 0.0.1 阶段：

```text
@deepseek-ai/dsh-llm@^0.0.1-rc.1        @deepseek-ai/dsh-tools@^0.0.1-rc.1
@deepseek-ai/dsh-invariants@^0.0.1-rc.1 @deepseek-ai/dsh-subprocess@^0.0.1-rc.1
```

在语义化版本中，`0.2.x` 运行时无法满足 `^0.0.1-rc.1`。因此在执行不带版本号的 `dsh plugin add @deepseek-ai/dsh-mcp-client` 时，包管理器拉取了 `latest` 标签对应的 `0.0.1-rc.1`，Loader 准入规则判定不满足约束并予以拦截。

区分这一根因对于定位由谁解决非常关键：
1. **用户本地的临时应对方案**：停止使用裸名安装，改为显式指定依赖声明匹配当前 DSH 版本的具体构建号（如明确指定兼容 0.2.x 的版本）；
2. **根因的修复主体**：**retag 是上游的发版动作，用户本地做不了**。需要等待包维护者在上游发布新版本或通过 `npm dist-tag add` 将 `latest` 修正至新构建。

在安装新包前，可提前预检裸名安装具体会解析到哪一个版本及其准入情况：

```console
$ dsh-triage check @deepseek-ai/dsh-mcp-client          # 探测裸名标签当前解析的目标构建及准入判断
$ dsh-triage audit                                      # 查看当前环境已安装插件的整体兼容台账
```

**边界说明**：以上分析**判的是 npm 上已发布的版本，不是你那台机器**；如果上游维护团队在后续重新调整了 dist-tag 指向，应以最新执行 `check` 读到的 registry 数据为准。

完整评测证据产物（包含 SHA-256 签名）：`data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`
