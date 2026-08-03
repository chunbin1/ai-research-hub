# antd 迁移设计文档

> 日期:2026-08-03
> 状态:设计已确认,待写实现计划

## 0. 概述

把前端手写的图标(18 处 emoji)和基础组件(15 个 `<button>`、6 个 `<input>`、2 个 `<select>`、2 个 `<table>`、2 处 `window.confirm`)迁移到 antd。

**四个动机**(用户确认,全部成立):

1. emoji 图标在不同系统/浏览器下渲染差异大,尺寸与基线对不齐
2. 想要更强的组件能力(表单校验、Modal、message、表格排序分页)
3. 技术栈与其他项目统一
4. 手写基础组件的维护成本高,容易不一致

## 1. 关键前置事实(已核实,非凭记忆)

| 事实 | 值 | 影响 |
|---|---|---|
| antd 当前版本 | **6.5.3** | 是 v6 不是 v5,不能套用 v5 经验 |
| antd peerDependencies | `react: >=18.0.0` | **React 19 原生支持,无需 compat 补丁** |
| `@ant-design/icons` | 6.3.2 | peer `react: >=16` |
| antd 6 样式机制 | `@ant-design/cssinjs` v2 | 仍是 CSS-in-JS |
| antd 6 是否自带 reset | 是,`dist/reset.css` | 与 Tailwind preflight 存在叠加问题 |
| 本项目 React | `^19.0.0` | 与 antd 6 兼容 |

图标名已逐个核实存在于 `@ant-design/icons@6.3.2`:`ArrowLeftOutlined`、`NodeIndexOutlined`、`BarChartOutlined`、`SettingOutlined`、`MenuOutlined`、`CheckCircleOutlined`。

## 2. 范围与主题

- **范围**:全站。后台四页全面 antd;首页与阅读页用 antd 的图标与交互控件,但**排版与配色仍由 Tailwind 控**。
- **主题**:用 antd 默认蓝,不改 token。
  - **已知代价**:后台页是蓝色系,首页/阅读页仍是金色点缀(`--color-gold` 等),切页时能看出观感断裂。用户在知情下选择此项,理由是 antd 升级时零维护成本。
- **封装**:默认直接 `import { X } from 'antd'`。仅在满足 §6 判定条件时才封装。

## 3. 共存基座(前置任务,不改任何页面)

### 3.1 依赖

```
antd@^6.5.3
@ant-design/icons@^6.3.2
```

### 3.2 `main.tsx` 加 `ConfigProvider`

- `locale={zhCN}`(`antd/locale/zh_CN`)—— 让 Table 的「暂无数据」、Modal 的确认/取消按钮都是中文
- 主题用 antd 默认,不传 `theme.token`

### 3.3 两个必须解决的冲突

**冲突 A:两份 CSS reset 叠加。** 本项目已启用 Tailwind preflight,antd 6 自带 `dist/reset.css`。

- **倾向:不引入 antd 的 reset.css**,由 preflight 兜底。
- **但这必须对着 antd 6 官方文档核实后再定,不得凭 v5 经验拍板。** 实现计划里这是一个独立步骤。
- 验收:antd 的 Button / Input / Table / Modal / Drawer 在页面上渲染正常(无塌陷、无缺边框、无错位)。

**冲突 B:preflight 的 `button { background-color: transparent; background-image: none; }` 会洗掉 antd 主按钮底色。** 这是 antd 文档专门有一节说明的经典冲突。

- 解法方向:把 antd 的样式注入到受控的 CSS layer,使 Tailwind utility 能覆盖 antd 而 preflight 不覆盖 antd。Tailwind v4 构建在原生 `@layer` 上,antd 6 通过 `@ant-design/cssinjs` 提供注入控制。
- **具体 API 与配置在实现时查准 antd 6 文档,本设计不写死。**
- 验收:antd 主按钮有正确底色;`<Button className="text-[14px]">` 这类 Tailwind 微调生效。

### 3.4 验收标准:现有页面视觉零变化

这一步的价值在于把「引入新样式来源」的风险单独隔离。验收必须用**具体数值**,不接受「看起来差不多」。下列数值取自上一轮 Tailwind 迁移的实测记录:

- 首页站名 `h1` 与报告卡片标题 `font-weight: 700`
- `.report-body` 的 `h2` = 24px / 700 + 1px 下划线;`h3` = 18.72px;`ul` = `list-style: disc` + `padding-left: 22px`
- 行内 `<code>` = 13.33px,且 `pre code` 保持 13px
- 全局 `line-height: normal`(不是 preflight 的 1.5)
- 现有 32 个前端测试全绿

**若这一步就发现共存代价过高,在此止损**,不必回滚任何已改页面。

## 4. 图标替换(18 处,横切)

| 用处 | 现在 | 换成 | 处数 |
|---|---|---|---|
| 返回链接 | `←` | `ArrowLeftOutlined` | 8 |
| trace 入口 | `🔍` | `NodeIndexOutlined` | 2 |
| 评估入口 | `📊` | `BarChartOutlined` | 2 |
| 模型设置 | `⚙️` / `⚙` | `SettingOutlined` | 2 |
| 移动端目录开关 | `☰` | `MenuOutlined` | 1 |
| 连接正常 | `✓` | `CheckCircleOutlined` | 1 |

`🔍` 选 `NodeIndexOutlined` 而非 `SearchOutlined`:此处语义是「看调用链」不是「搜索」,放大镜只是形似。

### 4.1 两处真实的视觉变化,不是纯替换

1. **尺寸。** emoji 在同 `font-size` 下通常比图标字形视觉更大。现有 emoji 大小由父元素 `text-[14px]` / `text-lg` 决定,替换后需**逐处目测微调**间距与字号。移动端 `☰` 按钮现为 `text-lg`(18px),最需注意。
2. **无障碍。** emoji 现在会被读屏念作「放大镜」「齿轮」,而旁边本就有「trace」「评估」等文字,构成重复播报。替换后:
   - **图标 + 文字**的组合 → 图标 `aria-hidden`
   - 纯装饰图标(ChatPanel 状态行末尾的 `⚙`)→ `aria-hidden`
   - 独立图标按钮(`☰`)→ 保留 `aria-label="打开目录"`(现有测试依赖此文案)

本步骤**不碰任何逻辑,不引入任何 antd 组件**,仅图标。

## 5. 分页面改造

### 5.1 后台四页

**`/eval` — `EvalDashboard`**(84 行,收益最大)
- 手写 8 列 `<table>` → antd `Table`,`columns` 配置化
- `render` 负责:百分比格式化、状态 `Tag`、行内「跑评估」`Button`(含 `disabled` 态)
- 空态、排序、加载态由 Table 提供,删掉手写的 `colSpan={8}` 空行

**`/traces` — `TraceList`**(56 行)
- 6 列表格 → `Table` + `onRow` 行点击 + `Tag` 状态徽章
- 横向滚动改用 `scroll={{ x }}`,删掉手写的 `overflow-x-auto` 包裹

**`/traces/:id`、`/eval/:docId`** — 键值对区域改用 `Descriptions`

**不改:`SpanWaterfall`(82 行)、`TraceStats`(41 行)**
自定义可视化(按 `leftPct`/`widthPct` 定位的瀑布图、归一化条形图),antd 无对应组件。硬套只会更糟。

**`/settings` — `SettingsPage`**(191 行,单文件最大)
- `Form` + `Select` + `Input.Password` + `Button` + `Alert` / `message`

⚠️ **特殊风险:此页含 2026-08-03 刚落地的安全逻辑。** `canSubmit` 与 `requiresKeyForChange` 是修补 key 外泄漏洞时加的前端守卫(「更换服务商或端点必须重填 API key」)。antd `Form` 有自己的校验机制,重写时极易弄丢或弄松该守卫。

- **额外验收标准**:换 provider 而不填 key 时,保存必须仍被拦住。
- **必须补测试**:该逻辑当前**零覆盖**(`useLLMConfig.test.ts` 测的是 hook,不是页面)。

### 5.2 首页 `HomePage`(125 行)

antd 接管交互控件,Tailwind 继续管排版与配色:

- 登录 / 登出 / 上传按钮 → `Button`
- `<label>` + 隐藏 `<input type="file">` → `Upload`
- 用户头像 `<img>` → `Avatar`
- 删报告的 `window.confirm()` → `Modal.confirm`
- 空态 → `Empty`

**不换的:**
- **报告卡片不用 `Card`** —— 门面视觉,金色系与 hover 效果均为定制
- **骨架屏保留自定义动画(已决定,不换 antd `Skeleton`)** —— 现有 `--animate-skeleton: skeleton 1.4s ease-in-out infinite` 是上一轮**精确复刻迁移前效果**的产物(Tailwind 内置 `animate-pulse` 是 2s / cubic-bezier / 1→.5,三个参数全不同)。换 antd `Skeleton` 等于主动放弃那次复刻。

### 5.3 阅读页 `ReaderPage` + `ChatPanel`(风险最高)

**移动端目录抽屉与问答面板改用 antd `Drawer`**(用户在知情代价后选择)。

**结构约束:桌面端 TOC 与问答面板都是 grid 的一列,不是抽屉。** `Drawer` **仅在移动端渲染**,`useIsMobile` 保留用于条件渲染。不是把整块换成 Drawer,而是「移动端走 Drawer,桌面端走原 grid 列」。

**Drawer 包裹层的位置(必须明确,否则会返工):** 两个 `Drawer` 都写在 **`ReaderPage`** 里 —— 它已经持有 `useIsMobile`、`tocOpen` / `chatOpen` 状态与 localStorage 逻辑。

- `ChatPanel` **保持为纯面板组件**,不感知自己是在 Drawer 里还是在 grid 列里,内部不引入 `Drawer`、不调用 `useIsMobile`。
- 这样 `ChatPanel.test.tsx` 的 2 个用例结构上不受影响(见 §7),`ChatPanel` 也仍可被单独渲染测试。
- TOC 侧栏同理:移动端由 `ReaderPage` 用 `Drawer` 包住,桌面端仍是 grid 列。

**antd Drawer 提供:** 遮罩、焦点陷阱、ESC 关闭、body 滚动锁。
**antd Drawer 不提供(仍需自写):** `dvh` 高度、安全区 `calc`、localStorage 记忆、冷启动策略、「点来源 → 收面板 → 跳转 → 高亮」业务联动。

**必须处理的冲突:** 现有代码手动设 `document.body.style.overflow = 'hidden'`,antd `Drawer` 也会锁。两套叠加的典型症状是**关闭后滚动锁未解除、页面卡死**。改造时必须删除整段手动锁,交由 Drawer 管理。

**必须逐条保住的行为**(全部为上一轮 H5 迁移的踩坑产物,直接作为验收清单):

1. 移动端**冷启动忽略 localStorage**(即使存 `'1'` 也默认收起)
2. 面板高度 `70dvh`,且**底部与底部条严丝合缝**(现为 `h-[calc(2.75rem+env(safe-area-inset-bottom))]`;用 `min-h` 会留约 23px 缝)
3. 收起时 `inert`,不在 tab 序与无障碍树中
4. 遮罩 / 抽屉 / 底部条的层级顺序:遮罩在抽屉之下,底部条在最上
5. **目录抽屉与问答面板不能同时打开**(上一轮修过的真实 bug:两者同为 z-30、遮罩在其下,导致点不掉、卡死)
6. 点「来源 §章节」→ 收面板 → 跳转 → flash 高亮
7. `localStorage` 记忆键 `reader.chatOpen`

## 6. 封装边界

默认**直接使用 antd**。仅当满足以下任一条件才封装:

1. 同一组 props 组合在 **≥3 处**重复出现
2. antd 默认行为与项目要求冲突,且**每个调用点都要改**(能用 `ConfigProvider` 全局配置解决的不算)

**按此判定,当前只有一处够格:** 8 个返回链接。封装对象是**整个「返回链接」**而非图标 —— `<BackLink to="/">全部报告</BackLink>` —— 因为这 8 处的图标、文案位置、hover 样式完全一致。

其余图标各用 1–2 次,直接写 `<SettingOutlined />`。

## 7. 测试策略

| 现有测试 | 数量 | 处理 |
|---|---|---|
| `lib/waterfall`、`statBars`、`toc` | 8 | 不动(纯函数) |
| `hooks/useIsMobile`、`useLLMConfig`、`useDocChat` | 13 | 不动(纯逻辑 + fetch mock) |
| `ReportMarkdown` | 1 | 不动(只断言标签存在性,且渲染 react-markdown 输出) |
| `ChatPanel` | 2 | **验证仍通过**(antd `Input` 内部渲染真实 `<input>`,placeholder 与 disabled 落在原生元素上)。这是推断,实现时须真跑确认 |
| `ReaderPage` | 8 | **重写,数量不减** |

**`ReaderPage.test.tsx` 有两条断言改造后不可再用:**
- `expect(document.body.style.overflow).toBe('hidden')` —— 锁改由 Drawer 管理,机制不同
- `expect(sheet?.className).toContain('translate-y-full')` —— Drawer 自管开合动画

重写方向是**改断言语义而非删除测试**:改用 Drawer 可见性、`aria` 状态,以及 §5.3 的 7 条业务行为作为断言对象。

**新增测试:** SettingsPage 的「换 provider 不填 key 必须被拦」守卫(见 §5.1)。

## 8. 任务顺序(风险从低到高)

1. 共存基座 —— 不改页面,验收 = 现有视觉零变化(§3.4)
2. 图标替换 + `BackLink` —— 18 处,不碰逻辑
3. `EvalDashboard` → `Table`
4. `TraceList` / `TracesPage` → `Table`
5. `TraceDetailPage` / `EvalDetailPage` → `Descriptions`
6. `SettingsPage` → `Form` ＋ 补安全守卫测试
7. `HomePage` → `Button` / `Upload` / `Modal.confirm` / `Empty` / `Avatar`
8. `ReaderPage` + `ChatPanel` → `Drawer` ＋ 重写 8 个测试

**为什么按页面纵切而不是一次性改完:** 上一轮 Tailwind 迁移的教训是,巨大的 diff 会让 review 只能看结构、看不了细节 —— 那正是像素漂移逃过每一轮单任务 review 的原因。按页面切,每步改完即可在浏览器验证,坏了也只坏一页。

## 9. 明确不做(YAGNI)

- `SpanWaterfall`、`TraceStats` 保持手写 —— antd 无对应组件
- 报告卡片不换 `Card` —— 门面视觉
- 骨架屏保留自定义动画 —— 见 §5.2
- 不引入 antd `Layout` / `Menu` —— 仅 4 个路由,用不上
- 不做暗色模式 —— 现为 `color-scheme: light`,antd 暗色是独立议题
- 不改主题 token —— 见 §2
- 不移除 Tailwind —— 排版层(`.report-body` / `.chat-md`)与布局继续由 Tailwind 负责

## 10. 前置依赖

**本设计假定 `feat/byok` 分支已合并或已明确处置。** 该分支有 17 个提交、改动 29 个文件,其中 `SettingsPage.tsx`、`ChatPanel.tsx`、`HomePage.tsx`、`useDocChat.ts` 均在本次 antd 改造范围内。两者并行会产生难以 review 的冲突。
