# Compliance（本仓隐私与许可）

> **Stand**: R15 (2026-10-27)

1. **100% 本地优先**：判断全链（admission / env / ledger / verdict）在本机完成，默认零网络。任何远程信号（npm registry、dsh.so、hub catalog）必须显式开启或缓存命中，且结果里标注 `source`。
2. **不读凭据**：不读取 `~/.dsh/credentials*`、`~/.dsh/profiles/*/credentials*`、环境变量中的 API Key；probe 隔离目录内也不注入真实凭据。
3. **披露**：凡 AI 生成模块记入 `audit/AI_DISCLOSURE_LOG.md`（含模块路径、生成轮次、审核结论）。
4. **数据许可**：
   - npm registry 元数据：按 registry 服务条款使用，仅取 `name/version/engines/peerDependencies/deprecated/time`；R15 起 probe 另记 `license/dist.integrity/unpackedSize`（仍不含源码）；
   - dsh.so 数据接口：**CC BY 4.0**，必须在 UI/文档署名 `dsh.so`，且不得改变其结论含义（见 `docs/02-signal-sources.md`）；
   - 本仓自有聚合数据：MIT（与代码同许可），回流数据默认匿名、可删除、可关闭。
5. **不提供安全背书**：probe 只回答「装得上 / 起得来 / 页面挂没挂载出内容」，不判定「无恶意」。安全结论请用 `dsh-vet` / dsh.so 安全档。
6. **第三方代码不入仓**：参考实现只读，复制代码进 `packages/` 一律禁止；`quarantine/vendor-manifest.json` 记录取用范围与许可。
7. **测试不碰真仓**：测试必须注入临时 `DSH_HOME`，禁读写真实 `~/.dsh`。
8. **候选只在临时沙盒执行**（R15 / `docs/adr/0004`）：外部候选必须 pin 精确版本，装进系统临时目录下的独立 `DSH_HOME`，跑完即删；候选源码不落仓、不进 `quarantine/`，`vendor-manifest` 只登记元数据（`kind: probe-candidate`）。这既是许可边界，也是「我们不是分发者」的边界。
