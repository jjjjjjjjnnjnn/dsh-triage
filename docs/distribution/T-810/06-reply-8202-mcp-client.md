<!-- channel: reply in upstream discussion #8202 (Chinese) · draft -->
<!-- 状态: draft（未发布）。回复场景：针对 #8202 点名 @deepseek-ai/dsh-mcp-client@0.1.0-rc.7 无法在 0.2.x 下加载的问题进行技术归因与解决建议。 -->

# 草稿 06 · 回复 #8202（`@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 与 0.2.x 准入约束分析）

> **归因分析**：帖子明确指定了具体版本号（`0.1.0-rc.7`），因此无需推测。根据该版本已发布的元数据，其声明的 peerDependencies 严格锁定在 0.1 阶段，与 0.2.x 存在确定的版本冲突。

---

你好，针对帖子里提到的加载失败问题，其根本原因出在该构建版本自身声明的 peerDependencies 上，并非你的本地配置有误。

通过分析 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` 发布的 manifest，它声明了 6 项针对 0.1 版本的依赖约束：

```text
@deepseek-ai/dsh-llm@^0.1.0-rc.7          @deepseek-ai/dsh-tools@^0.1.0-rc.7
@deepseek-ai/dsh-timeout@^0.1.0-rc.7      @deepseek-ai/dsh-attachment@^0.1.0-rc.7
@deepseek-ai/dsh-invariants@^0.1.0-rc.7   @deepseek-ai/dsh-subprocess@^0.1.0-rc.7
```

在语义化版本（SemVer）规则中，`^0.1.0-rc.7` 无法匹配任何 `0.2.x` 运行时版本。DSH 的 Loader 在启动准入（admission）阶段匹配失败，因而直接跳过了该行配置。

DSH 当前并没有提供动态放宽版本约束的配置项，目前可行的解决路径主要有两条：

1. **安装适配 0.2.x 的新构建版本**：检查官方或社区是否已发布依赖区间兼容 `0.2.x` 的新版本，指定具体版本号进行安装；
2. **显式配置版本豁免（若接受潜在兼容风险）**：
   在明确了解该版本可能存在 API 变动风险的前提下，可向 Profile 写入针对该版本对的显式放行规则：
   ```console
   $ dsh plugin --profile web allow-version @deepseek-ai/dsh-mcp-client@0.1.0-rc.7 --dsh-version 0.2.1-rc.5 --accept-risk
   ```

若想在本地终端确认当前环境各插件的具体准入判定：

```console
$ dsh-triage check @deepseek-ai/dsh-mcp-client@0.1.0-rc.7   # 预检指定版本在当前环境下的准入状态
$ dsh-triage audit                                          # 全量扫描当前已安装插件的准入结果与拦截原因
```

**边界说明**：以上结论**判的是 npm 上已发布的版本，不是你那台机器**；若本地安装的代码经过修改，建议以本地 `package.json` 中的实际声明为准。此外，显式豁免仅绕过声明层的准入拦截，不代表运行期代码完全无故障。

完整评测证据产物（包含 SHA-256 签名）：`data/results/discussion-triage-2026-11-02T12-10-00-000Z.json`
