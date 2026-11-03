# 安全策略与威胁模型 / Security Policy & Threat Model

**dsh-triage 安全规范、受保护资产与边界防御定义**  
*Security specifications, threat modeling, protected assets, and boundary definitions.*

> **适用范围**：`dsh-triage serve` 本地可视化面板、CLI 磁盘交互与静态文件读取、`data/results/` 证据产物解析。  
> **重要声明**：本文档并非泛化的“无漏洞”背书，而是客观阐明**安全威胁模型、已实施的安全控制措施、明确的非防御边界与负责任的漏洞报告途径**。

---

## 1. 漏洞报告与披露机制 / Reporting a Vulnerability

本项目遵循负责任的漏洞披露流程。若你在本工具中发现了安全漏洞或潜在安全绕过途径（例如针对路径穿越校验、CSP 策略、同源白名单等机制的对抗性绕过）：

1. **报告渠道**：请通过 GitHub Security Advisory 或向维护者提交私密 Issue；
2. **报告内容**：请在报告中提供受影响的版本、复现命令、最小复现用例、HTTP 响应状态码及相关测试输出；
3. **隐私防护**：**严禁**在公开 Issue 中包含真实的访问令牌（Token）、`~/.dsh` 实际敏感目录绝对路径或私有凭据；
4. **响应承诺**：维护团队将在收到有效报告后 48 小时内确认并评估影响范围，并在发布修复版本后予以安全致谢。

### 支持的版本 / Supported Versions
| 版本系列 | 状态 | 安全更新支持 |
|---|---|---|
| `0.3.x` | 现行稳定版 (Current) | 支持 (Supported) |
| `< 0.3.0` | 历史版本 (Legacy) | 不支持 (End of Support) |

---

## 2. 受保护资产清单 / Protected Assets

| 资产类型 | 存放位置 / 载体 | 泄露或被篡改的影响 |
|---|---|---|
| **本地 DSH Profile 配置**（插件条目、模块名、版本号） | `~/.dsh/profiles/<name>` | 泄露用户已安装的插件组合清单；不包含用户密码或私有密钥 |
| **评测与审计产物**（`data/results/*.json`） | 仓库产物目录（可配置） | 产物包含脱敏指纹，若被篡改可能产生误导性的推演报告 |
| **诊断判定结果数据** | 本地内存与 HTTP 响应通道 | 若在传输中被伪造，可能导致用户误判环境兼容性 |
| **修复指令投递**（一键复制修复命令） | 本地可视化面板前端按钮 | 若被注入恶意脚本或篡改，可能诱导用户在终端中执行恶意代码 |

**明确非受管资产**：`~/.dsh/credentials`、npm 授权凭据、操作系统的环境变量值。`dsh-triage` 绝不读取或收集上述凭据；环境指纹提取仅限 `dsh/node/platform/arch/profile/bundles/installed` 等公开工程基础信息。

---

## 3. 威胁模型与信任边界 / Threat Model

| 潜在攻击者 | 攻击能力特征 | 本项目的防御立场与策略 |
|---|---|---|
| **同机其他未授权用户** | 能发起指向 `127.0.0.1` 的网络请求，但无权读取本进程内存与启动命令行 | **强制防御**：基于随机高位端口 + 一次性鉴权 Token |
| **同机同权限的其他运行进程** | 能读取操作系统的进程列表与命令行，能直接访问 `~/.dsh` | **不作防御**（系统底层权限边界，见第 5 节说明） |
| **浏览器内第三方恶意页面** | 能够发起跨源请求（CSRF）或尝试在 iframe 中嵌入面板 | **强制防御**：严格 Origin 校验 + `SameSite=Strict` + 禁用 CORS |
| **DNS 重新绑定攻击 (DNS Rebinding)** | 将恶意域名动态解析至 `127.0.0.1` 尝试窃取会话 | **强制防御**：Token + Origin 校验 + **Host 准入**（R75 起）：`Host` 必须匹配绑定地址，否则 **421**；默认只认 `127.0.0.1` / `localhost` / `[::1]`，绑 `0.0.0.0` 必须显式给 `--allow-host`。决策与代价见 `docs/adr/0014-host-header-allowlist.md`（**accepted**） |
| **恶意构造的评测产物** | 在结果目录中伪造超大畸形 JSON、注入路径符号链接逃逸 | **强制防御**：文件名白名单 + realpath 边界包含性 + 2MB 强制截断 |
| **上游依赖供应链风险** | 在安装构建阶段执行恶意脚本 | **强制防御**：门禁与面板核心模块**零运行时依赖**；CLI 固定锁文件 |

---

## 4. 已实施的安全控制措施 / Implemented Controls

本项目已实施以下防御机制，且每项控制均配有自动化对抗性单测（`tests/unit/serve-adversarial.test.ts`）：

### 4.1 路径穿越与符号链接逃逸防护
- **文件名白名单校验**：输入文件名必须严格匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*\.json$` 且绝不包含 `..`，在接触底层文件系统前直接完成断言；
- **NTFS Junction 与符号链接防御**：通过 `resolveArtifact()` 执行 `realpathSync`，校验实际物理路径必须位于预设的 `resultsDir` 目录之内，杜绝通过软链接逃逸至本地系统其他目录。

### 4.2 资源消耗与防内存拒绝服务 (DoS)
- **2MB 单文件解析上限**：所有读取流程均执行 `MAX_ARTIFACT_BYTES = 2MB` 限制，超限文件直接拒绝解析，列表视图降级呈现；
- **畸形数据降级**：非预期 JSON 统一返回 `422 Unprocessable Entity`，防止异常导致主进程崩溃退出；
- **并发请求合并 (Single-Flight)**：对本地文件扫描请求实施单飞合并机制，防止并发重复读取导致事件循环拥塞；
- **1 秒复用窗口（R75 起）**：两个扫描路由（`/api/summary` 与 `/api/audit`）共享同一个扫描与同一个 1 秒窗口（`AUDIT_REUSE_MS = 1000`，常量不可配置）；窗口内复用上一次结果（`/api/summary` 在 body 里给 `reused` / `age_ms`；`/api/audit` 走响应头 `x-triage-audit-reused` / `-age-ms`，因为它的 body 必须与 `audit --json` 逐字节相同），**失败的扫描不进窗口**（读不到要能重试）。决策见 `docs/adr/0015-local-panel-rate-limit.md`（**accepted**）。

### 4.3 浏览器端安全与防跨站脚本 (XSS / CSRF)
- **严格内容安全策略 (CSP)**：
  - `default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; img-src data:;`
  - 严禁引入任何未经审查的第三方 CDN、外部图片或脚本资源；
- **请求源 Origin 校验（两个半边不一样，别混读）**：
  - `dsh-triage serve` 面板：**只拒绝「有且非空且不匹配」的 Origin**（`serve.ts:277-281`），空 / 无 Origin 的请求**放行**（token 仍然必需）——浏览器直接导航打开面板就是这种情况，挡掉它会把正常用法判成攻击；
  - Host 侧只读路由（`host-audit-route.ts:45-56`）：有 Origin 就必须同源；**没有 Origin 时必须带 `sec-fetch-site: same-origin`**，否则 `403 request carries no same-origin evidence`。
  - 因此「空 Origin 一律拒绝」只对 Host 侧成立，对 `serve` 不成立。DNS rebinding 借的正是 `serve` 这一侧的空 Origin，补法见 `docs/adr/0014-host-header-allowlist.md`（**accepted**，R75 已实施：Host 不匹配 → 421）；
- **输出转义**：所有进入 DOM 的动态数据统一通过 `esc()` 针对 `& < > " '` 进行编码转义，脚本内联 JSON 对 `<` 进行统一替换（`\u003c`）。

---

## 5. 明确的安全非保证声明 / Explicit Non-Guarantees

为保证技术陈述的严谨与诚实，以下场景不在本项目的防御承诺范围之内：

1. **同操作系统同一用户的恶意进程**：攻击者若在本地拥有与运行用户相同的系统权限，可通过系统调用直接窥探终端或文件系统，任何用户态应用层逻辑均无法阻止此类本地攻破；
2. **不提供恶意代码安全审计**：**本工具不提供安全背书（We do not provide security assurances）**。`dsh-triage` 专注于兼容性评估与准入推演，任何“通过（`go`）”的判定均指版本依赖和环境匹配正常，绝不代表该插件已经过恶意代码、木马或后门审计；
3. **数据产物的业务语义真伪**：面板依据磁盘上的 JSON 数据如实展示推演结论与哈希值。若用户手动向本地数据目录中放置虚假的产物文件，面板将忠实呈现该数据。产物真实性应依靠自动化流水线的 `gate_ssot` 与 `.sha256` 进行校验。

---

## 6. 安全机制本地自测与验证 / Verification & Self-Audit

开发者或安全审核人员可在本地一键执行针对上述安全控制机制的回归验证：

```powershell
# 1. 执行 11 项对抗性输入防御测试（路径穿越、符号链接、超限拒绝等）
node --test tests/unit/serve-adversarial.test.ts

# 2. 验证面板接口契约与 CSP 响应头策略
node --test tests/unit/serve.test.ts

# 3. 运行本地自动化冒烟测试集（包含状态码与界面控制断言）
node scripts/record_serve_smoke.mjs --stamp 2026-11-02T06:00:00.000Z
```

---

## 开源协议 / License

本项目安全策略文件随项目采用 [MIT License](../LICENSE) 开源发布。
