# reproducibility（本地可复现）

- **Node ≥22.19**（本机 v24.15.0）、**pnpm 12.15.0**；命令统一在仓根执行。
- TS 源码可直接被 `node --test` 执行（`erasableSyntaxOnly` 保证无 enum / 参数属性等不可擦除语法）。
- 输出确定性：所有数组输出按固定键排序（entry id / 包名 / code），时间戳只来自顶层 `generated_at`，禁止 `Math.random()` 与 `Date.now()` 参与结论。
- SSOT：`data/results/<name>-<ts>.json` + 同名 `.sha256`（对 JSON 字节做 sha256，LF 换行）。
- 测试必须注入临时 `DSH_HOME`（`fs.mkdtemp`），禁读写真实 `~/.dsh`；测试结束不残留（t.after 清理）。
- 路径：仓内一律相对 POSIX 路径；机器相关绝对路径只写在 `docs/07-environment.md`。
- 网络：引擎与门禁默认零网络。需要网络的脚本（`scripts/fetch_registry_snapshot.mjs`，M1 后引入）必须显式 `--allow-network` 并把响应缓存进 `data/raw/`（git 忽略）。
