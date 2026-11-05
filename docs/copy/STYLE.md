# 文案文风（Copy style）

> 目标：**工程化、可核对、不推销**。读者是正在排障的人，不是投资人。
> 本页只管「怎么写」；「能写什么数字」由 `docs/copy/README.md` 的事实包规则管。

---

## 1. 先结论，后证据

- 第一段回答「是不是我说的这个问题」——不铺垫、不自我介绍；
- 第二段给可执行动作（命令 / 步骤 / 装哪个构建）；
- 最后一段是边界句与证据指针。

## 2. 句式

- 用短句；一句话只放一个判断；
- 主动语态；主语是「这个构建 / 这条规则 / 你可以」，不是「我们认为」；
- 不写「可能大概也许」——读不到就写「读不到」，判不了就写「判不了」；
- 代码、包名、版本用反引号；命令用 `console` 代码块。

## 3. 必须留的边界

- 「以上判的是 npm 上**已发布的版本**，不是你那台机器。」
- 「声明层放行**不等于**运行期一定无故障。」
- 引用测量时带边界：样本 / 时间 / 只对什么成立。

## 4. 禁用话术

以下由 `scripts/check_listing.mjs` 的 `DRAFT_FORBIDDEN` 与人工复核共同拦截：

- 100% 兼容 / 完全兼容 / 保证可用 / 不会出问题
- 升级会修好 / 装了就没事 / 一劳永逸
- 全网最 / 唯一 / 第一（没有定义与测量时）
- 「官方推荐」（本项目不是官方）
- 任何「更快 / 更省 / 更安全」而没有同条件测量的说法

## 5. 两种语言的默认结构

**中文（论坛回复）**
```
提供一个信息供参考：<一句结论>。

<精确数字 / 命令输出>

你可以：1) … 2) …

边界：…
复算证据：<URL 带 sha256 的产物>
```

**English (forum reply)**
```
One data point: <one-sentence conclusion>.

<exact numbers / command output>

What you can do: 1) … 2) …

Boundary: this reads published manifests, not your machine. Declaration-layer admission does not prove runtime health.
Recompute: <artifact URL with sha256>
```

## 6. 标题与截图说明

- 标题不超过 70 字符，先说对象再说结论；
- 截图说明写「这张图证明了什么」，不写「如图所示」；
- 不用感叹号，不用 emoji（除非渠道文化要求，例如 Show Your Plugins 的标题模板）。
