# Task Packet: 跟踪 DeepSeek Harness 0.2.1-rc.5 插件引导诊断机制并对齐 dsh-remedy/dsh-triage 故障隔离逻辑

> **来源**: 个人知识库 Personal Hub (自动派发)
> **工单ID**: TSK-20261112-009
> **优先级**: HIGH
> **派发时间**: 2026-11-12

---

## 任务
跟踪 DeepSeek Harness 0.2.1-rc.5 插件引导诊断机制并对齐 dsh-remedy/dsh-triage 故障隔离逻辑

## 上下文（只给必需，勿倒整仓）
- 关联工单: `TSK-20261112-009`
- 交付标准: 复核 packages/boot/app-boot 诊断顺序，在 dsh-triage 与 dsh-remedy 的沙盒日志分析中引入启动失败二分排查逻辑及告警过滤。
- 关联信息来源: <home>\Desktop\本地知识库\知识库内容\Personal\inbox\inbox-20261112-Re_-[deepseek-ai_deepseek-harness]-[Bug]-升级至-0.2.1.yaml

## 边界
- 遵循本仓库 `.agents/` 规约与门禁要求。

## 验收命令
```powershell
pnpm run verify
node scripts/gate.mjs --mutate
```
