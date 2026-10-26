# 00 · 愿景与定位

> **Stand**: v0.1.0-skeleton (2026-10-26)

## 1. 一句话

**在「装得上」和「跑得对」之间做判断层。**

## 2. 为什么这个位置存在

DeepSeek Harness 0.2.x 已经把「装不装得上」做完了：

| 能力 | 归属 | 状态 |
|---|---|---|
| install 前声明检查（`engines.dsh` / dsh peer） | 上游 `app-boot` + `plugin-manager` | ✅ 内置 |
| 版本豁免（`allow-version` + `compatibility.json`） | 上游 `plugin-manager` | ✅ 内置 |
| 装/卸/启停 + 失败回滚 | 上游 `plugin-manager` | ✅ 内置 |
| 插件清单相位（`active/failed/…`） | 上游 `plugin-inventory` | ✅ 只读 |
| 插件市场（Discover + 自定义索引源） | 上游 experimental market bundle | ✅ 内置 |
| 干净沙盒的安装/运行验证（L1–L5） | `dsh.so` 注册表（22,180 条） | ✅ 每日刷新 |

上游文档把剩下的事写成了 **deferred work**：没有持久失败史、没有 provenance、没有订阅、不检测运行期冲突。

所以本项目的价值只在四件事上，多一件都不做：

1. **归因**：把「工具消失 / 白屏 / 起不来」定位到具体行，并给出修复命令；
2. **组合判断**：候选插件 × 本机已装集合（entry id / service / tool / command / settings / slot）；
3. **隔离实测**：独立 `DSH_HOME` 真装真启动，产出 `boot / http / render / inventory / namespace-diff`；
4. **回流**：opt-in 匿名结果 → 群体先验（上游结构上拿不到的组合数据）。

## 3. 明确不做

| 不做 | 原因 |
|---|---|
| 插件市场 / 目录 | 上游内置 Discover + 多家索引源（dsh-market、dsh.so）已占位 |
| 启动器 / 桌面壳 | `dshmarket`、melody launcher、多个桌面壳已占位 |
| 通用安全扫描 | `dsh-vet`、`dsh-plugin-security-review`、dsh.so 安全档在做；我们不提供安全背书 |
| 装/卸/回滚、快照 | 上游 `plugin_manager` 已接管；`dsh-plugin-guard` 在做 boot 级回滚 |
| 静态声明检查当卖点 | `nzl153/dsh-preflight` 因此归档（0.1.7 起上游自带检查） |

## 4. 成功判据（对外可验证）

| 层级 | 判据 |
|---|---|
| 产品 | 在真实故障案例上，`why` 一次命中根因（含修复命令），无需用户读日志 |
| 数据 | 有 ≥1 个真实的「组合 → 结果」数据集，别人无法用一次 CI 复现 |
| 分发 | 进入 ≥2 个主流渠道（dsh-plugin-catalog / hub / dsh.so / launcher） |
| 规模 | 周下载量进入安全与兼容类目第一；总榜第一需要关键路径集成（见 `docs/06-roadmap.md`） |

## 5. 风险的态度

上游随时可能把「诊断」也做进去（他们已列为 deferred work）。应对不是拦着，而是：

- **只赚数据与归因的钱**，不赚规则的钱；
- **先公开 verdict / evidence 契约**，让生态围着我们的结构长；
- **把自己做成别人的信号源**（索引源 / 徽章 / Agent 工具），即使功能被吸收，数据层仍被引用。
