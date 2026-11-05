# Task Packet: 对齐上游 DeepSeek Harness #12209 插件版本降级升级缺陷

> **来源**: 个人知识库 Personal Hub (Outlook 邮件捕获: `Discussion #12209` & `Discussion #10458`)  
> **关联工单**: `TSK-20261105-011` (本地知识库 Personal/triage/dispatched/)  
> **分配角色**: `researcher.md` / `implementer.md`  
> **优先级**: 📌 高

---

## 任务
在 `@dsh-triage/probe` 与相关探测规则中，评估上游官方插件管理器修复方案（master fcc0ad4621），强化对 npm `dist-tags.latest` 的校验，防止版本误判。

## 上下文（只给必需，勿倒整仓）
- 相关文件:
  1. `packages/probe/` (版本与更新判断逻辑)
  2. `packages/signals/` (信号提取)
  3. `scripts/record_update_trap.mjs`
  4. `docs/copy/facts/2026-11-05-upstream-attribution.md`
- 必须遵守: `.agents/roles/researcher.md` 取证原则（>=2 外部角度，不写死假设）
- 已知事实:
  - 上游 Discussion #12209: `packages/boot/plugin-manager` 仅比对 semver，忽略 `dist-tags.latest`
  - Atur Dana 已在 `master fcc0ad4621` 发布针对 registry 字段的比对修复
  - Discussion #10458: 嵌套 `dsh-app-boot` 的运行时 launcher fact 已扩展至全部 3 个兼容曲面
- 明确不知道: 上游该修复在哪个正式版本（0.12.x 或 0.13.0）发版打 tag。

## 边界
- 允许改动: `packages/probe/`, `packages/signals/`, `scripts/record_update_trap.mjs`
- 禁止触碰: `data/gold/**`、`packages/core/src/admission.ts` 规则顺序
- 允许联网: 查阅 GitHub 讨论与 npm registry 元数据

## 输出格式（缺一项视为未完成）
1. 结论 <= 3 行
2. 证据 <= 10 条（文件:行 或 命令 + 输出片段）
3. 改动清单（文件 -> 改了什么）
4. 未解决 / 风险 <= 3 条

## 验收命令
```powershell
pnpm run verify
node scripts/gate.mjs --mutate
node scripts/record_update_trap.mjs
```
