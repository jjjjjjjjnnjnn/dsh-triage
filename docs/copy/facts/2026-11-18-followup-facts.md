# followup-facts · 两条回复的事实包（13581 更正 / 13683 声明层读数）

> **用途**：R120。`#13581` 的作者回了我们，并给出一个**反例**；`#13683` 是一份自报的插件兼容报告。
> 两条都只补事实与判据，不推销；**链接额度已用完（2/2），这两条都不带链接**。

- **渠道 / 语言 / 受众**：上游 Discussions 回复，英文

## 产物

| 产物 | sha256 | 它提供什么 |
|---|---|---|
| `data/results/audit-2026-11-13T18-25-00.000Z.json` | `9b4ee49403fcaa90362dbf73b71ba32e0134c57f5f5dfeabb4bed1d52a8bfe94` | 真机 profile 的读数形状（246 行 / 93 条判定 / 0 错误） |
| `data/results/rescue-2026-11-05T09-32-00-752Z.json` | `690f43f2d5422e2180015af4aacbcb9ae34026c41372c1fb496e87dc3aa95393` | `dsh.profile.bundles` 的三态分类 |
| `data/results/remedy-probe-2026-11-05T08-01-23-093Z.json` | `132cec21ca9a89c230616a760065486e6fdda72ced7b89f28857a769278c4f54` | 同一个包不同 pin 的准入差异（8 条 peer 精确钉定） |

## 代码层事实（逐条核过，来源是仓内上游沙盒）

1. **组合是三段叠加**，写在 `@deepseek-ai/dsh/lib/profile-boot-*.js` 的模块注释里：
   「stack its patch layers (**bundle layers in `dsh.profile.bundles` order**, the profile's **own `cordis.patch.yml`**, `--patch` overlays)」。
   即：**bundle 列表之外，profile 自己的 patch 文件也能点名一个包**。
2. `PROFILE_PATCH_FILENAME = "cordis.patch.yml"`（`@deepseek-ai/dsh-app-boot/lib/index.js`），注释写明它是「the user patch layer inside a profile directory (hot-reloaded)」。
3. **拦截发生在行级别**：声明不满足时上游打印
   `Plugin <name>@<ver> is incompatible with dsh <runtime>: requirements {...}` 并禁用该行；
   除非用 `dsh plugin allow-version` 给**精确版本**豁免。
4. 所以「一个插件会不会被组合」需要四个事实：**行在 patch 层 / bundle 被选中 / 包能解析 / 拦截判据通过**。
   少了任何一条都不能下结论。

## 13683 的实测（声明层）

`dsh-move-up@0.4.5` 的公开元数据：

- `engines.dsh = ">=0.2.1-rc.5"`（**只有下界**）
- `peerDependencies`：`@deepseek-ai/cordis >=4.0.5`、`@deepseek-ai/dsh-workspace >=0.2.1-rc.5`、`@deepseek-ai/dsh-client-connection >=0.2.1-rc.5`，**三条全部 `optional: true`**
- `dsh.bundle.patch = ./cordis.patch.yml`，`dsh.client.platform = web`

用本仓 `evaluateRange` 实算 `engines.dsh`：

| 目标 | 结果 |
|---|---|
| `0.2.1-rc.5` | satisfied |
| `0.2.2-rc.1` | satisfied |
| `0.2.2-rc.3` | satisfied |
| `0.3.0-rc.1` | **satisfied** |
| `1.0.0` | **satisfied** |

**读法**：报告覆盖的三个构建都被承认（与作者结论一致）；但这条声明**也承认 0.3.x 与 1.0.0**——
下界无上界，未来的大版本不会被 gate 挡住。**optional peers** 让沙盒安装可行（不需要 host 包），
代价是「缺 host 包」不会在准入层报错，只会在调用时由插件自己报。

## 可以说什么

- `#13581`：承认我们此前的模型少了一个输入，给出四输入版本，并说明「不在 `bundles` 里」本身不是错误状态。
- `#13683`：三个目标都 admitted（复算一致）；`>=` 只有下界，未来大版本也会被承认；optional peers 的代价是准入层看不见缺 host。
- 两条都建议读者用 `npm view` 自证。

## 不可以说

- 不说 `#13581` 的作者「错了」——反例是对的，我们的说法要收窄。
- 不说「dsh-move-up 不安全 / 会坏」：我们只判声明层，运行期是他们的 8/8 与手工行为观察。
- 不建议把 peers 改成必装（那会破坏他们特意修的沙盒安装路径）；只陈述 tradeoff。

## 边界句

> Boundary: this reads published manifests and the upstream source, not your machine; declaration-layer admission does not prove runtime health.
