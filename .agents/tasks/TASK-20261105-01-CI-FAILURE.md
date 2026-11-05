# Task Packet: 修复 GitHub Actions verify 工作流中 render controls 失败

> **来源**: 个人知识库 Personal Hub (Outlook 邮件捕获: `Run failed: verify - main (b1c7319)`)  
> **关联工单**: `TSK-20261105-010` (本地知识库 Personal/triage/dispatched/)  
> **分配角色**: `verifier.md` / `implementer.md`  
> **优先级**: 🚨 紧急 (主分支 CI 红灯)

---

## 任务
排查并修复 `.github/workflows/ci.yml` 中 `render controls (ubuntu, real browser)` 失败，恢复 GitHub Actions CI 全绿。

## 上下文（只给必需，勿倒整仓）
- 相关文件:
  1. `.github/workflows/ci.yml` (行 52-92: render-control 步骤)
  2. `scripts/record_render_fixture.mjs` (渲染探测器录制脚本)
  3. `docs/HANDOFF.md` (当前批次状态)
- 必须遵守: `.agents/roles/verifier.md` 与 `.agents/roles/implementer.md` 约束
- 已知事实:
  - 失败 Run: `https://github.com/jjjjjjjjnnjnn/dsh-triage/actions/runs/41999863821`
  - 失败 Job: `render controls (ubuntu, real browser)` (耗时 45s)
  - 伴随验证: `windows, node 24` (成功)、`node 22` (成功)、`node 24` (成功)、`gates can fail` (成功)
  - CI 执行的三条断言为:
    * `node scripts/record_render_fixture.mjs --mode blank --expect blank --out "$RUNNER_TEMP/render"`
    * `node scripts/record_render_fixture.mjs --mode rendered --expect rendered --out "$RUNNER_TEMP/render"`
    * `node scripts/record_render_fixture.mjs --mode error --expect inconclusive --out "$RUNNER_TEMP/render"`
- 明确不知道: Ubuntu 真实运行环境中的 Chromium 是否因新 runner 镜像变更而导致 launch 参数或超时失效。

## 边界
- 允许改动: `scripts/record_render_fixture.mjs`, `.github/workflows/ci.yml`, 相关的渲染判定辅助脚本
- 禁止触碰: `data/gold/**`、`audit/gate_ledger.json` 的 negative_control、`packages/core/src/admission.ts` 规则顺序
- 允许联网: 仅限 CI 依赖与必要测试

## 输出格式（缺一项视为未完成）
1. 结论 <= 3 行
2. 证据 <= 10 条（文件:行 或 命令 + 输出片段）
3. 改动清单（文件 -> 改了什么）
4. 未解决 / 风险 <= 3 条

## 验收命令
```powershell
pnpm run verify
node scripts/gate.mjs --mutate
node scripts/record_render_fixture.mjs --mode blank --expect blank
node scripts/record_render_fixture.mjs --mode rendered --expect rendered
node scripts/record_render_fixture.mjs --mode error --expect inconclusive
```
