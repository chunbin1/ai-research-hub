# 研报站 H5 移动端支持 + Tailwind 迁移 设计文档

> 日期:2026-08-01
> 状态:设计已确认,待写实现计划
> 范围:仅 `packages/client`,后端零改动
> 基线:master `ad8267a`。工作区尚有未提交的 HomePage 骨架屏改动 —— **保留该功能**,先单独提交,再在其之上开始迁移(见 6 节)

## 1. 目标

让研报站在手机浏览器上真正可用,同时把前端样式方案从 CSS Modules 全量切到 Tailwind CSS v4。

两件事一起做,是因为阅读页的桌面三栏(`240px / 1fr / 360px`)在手机上必须整体重构,而重构时逐个 `.module.css` 改 media query 的成本已经接近直接改写成 utility class —— 分两步做等于把同一批文件改两遍。

**桌面端视觉像素级保持不变**,这是本次迁移的硬约束:迁移只换写法,不改长相。

## 2. 现状

`packages/client`:React 19 + Vite 6 + react-router 7,8 个 `.module.css`,**零 Tailwind、零响应式断点**。

| 路由 | 当前布局 | 移动端现状 |
|---|---|---|
| `/` 首页 | `auto-fill minmax(280px,1fr)` 卡片流 | 基本可用,header 会挤;删除按钮够不着 |
| `/reports/:id` 阅读页 | 固定三栏 grid,`height:100vh` | **完全不可用** |
| `/traces`、`/traces/:id` | waterfall 瀑布图 | 横向撑破 body |
| `/eval`、`/eval/:docId` | 统计宽表格 | 横向撑破 body |

## 3. 关键决策

| 点 | 决定 |
|----|------|
| Tailwind 范围 | **全量迁移**,8 个 `.module.css` 全删(报告正文排版除外,见 4.3) |
| Tailwind 版本 | **v4.3.3** + `@tailwindcss/vite` 插件,无 `tailwind.config.js`、无 PostCSS 链路 |
| 阅读页移动布局 | **正文常驻 + 目录左抽屉 + 底部问答面板** |
| 后台页(traces/eval) | **只保不碎**:宽内容包 `overflow-x-auto`,不重排成卡片流 |
| 桌面视觉 | **像素级保持原样**,色值/间距/栏宽照抄 |
| 响应式实现 | **单组件树 + Tailwind 断点**;仅 3 处行为差异走 `useIsMobile()` |
| 断点 | **只有一个分界:`md` = 768px**,mobile-first 写法 |
| 视觉回归保障 | **人工 checklist**,不引入截图测试基建 |

### 3.1 备选方案与否决理由

**响应式实现**曾考虑另两种:

- *纯 CSS 断点,零 JS 判断* —— 做不出"点来源 chip 后手机自动收面板"。不收面板,答案会盖着正文,溯源回链(本站核心功能)在手机上就废了。否决。
- *拆 `ReaderPageDesktop` / `ReaderPageMobile` 两棵树* —— TOC 跳转、chat 状态、`inert` 逻辑重复两份,改一处要记得改两处。桌面与移动的信息结构本就是同一套,不值得付这个维护成本。否决。

## 4. 基础设施

### 4.1 接入

- `packages/client` 新增依赖:`tailwindcss@^4.3.3`、`@tailwindcss/vite@^4.3.3`(均为 devDependency)。
- `vite.config.ts` 的 `plugins` 加 `tailwindcss()`。
- `src/index.css` 顶部 `@import "tailwindcss"`。

### 4.2 主题变量

现有色值散落在 8 个 module.css 中,迁移时统一收进 `@theme`,作为后续主题化的唯一入口。**值全部照抄现有 CSS,不做任何调整。**

```css
@theme {
  --color-paper: #fafaf8;      /* body 底 */
  --color-surface: #fbfbf9;    /* 侧栏 / 问答栏 */
  --color-gold: #c9a227;       /* 引用条、来源 chip 描边 */
  --color-gold-ink: #8a6d1b;   /* chip / 额度文字 */
  --color-gold-wash: #faf8f0;  /* chip / 额度底 */
  --color-danger: #b00020;
  --spacing-toc: 240px;        /* 桌面目录栏宽 */
  --spacing-chat: 360px;       /* 桌面问答栏宽 */
}
```

其余灰阶(`#1a1a1a` / `#444` / `#555` / `#888` / `#999` / `#eee` / `#ececec` / `#ddd` / `#e0e0e0`)在迁移各页时逐个映射到最接近的 Tailwind 默认色阶;**若某处默认色阶与原值肉眼可辨有差**,则用任意值语法 `bg-[#ececec]` 保持原值,不为了"用上 Tailwind 色板"而改变观感。

字体栈保留:`-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`。

### 4.3 例外:报告正文排版不迁 utility class

`ReaderPage.module.css` 里的 `.content :global(h1/h2/h3/table/th/td/blockquote/pre/ul/ol/li/p/hr/:target/.flash)` 是给 react-markdown 生成的原生标签上样式的 —— HTML 不由我们写,挂不上 class。

因此这部分**保留后代选择器 CSS**,但从 `.module.css` 挪到 `index.css` 的 `@layer components` 中,色值改为引用 4.2 的 `--color-*` 变量。`flash` 关键帧动画一并挪过去。

**不安装 `@tailwindcss/typography`**:`prose` 会带一整套自己的默认排版,与"像素级保持原样"直接冲突,对齐成本高于保留这段约 25 行的 CSS。

迁移完成后:`.module.css` 从 8 个减到 0,`index.css` 新增一段约 25 行的报告排版 layer。

### 4.4 断点

**全站只用一个分界**:Tailwind 默认的 `md` = 768px。

- 无前缀 = 手机(mobile-first)
- `md:` = 桌面

手机竖屏/横屏、小平板走移动布局;iPad 竖屏(768)及以上走桌面三栏。**不引入第二个断点**,避免出现"只在某个中间宽度下才对"的状态。

### 4.5 viewport

`index.html` 的 meta 加 `viewport-fit=cover`,配合底部问答面板的 `pb-[env(safe-area-inset-bottom)]` —— 否则 iPhone 底部 home indicator 会压住发送按钮。

## 5. 阅读页(核心)

`ReaderPage` 仍是单份 JSX,四个部分:移动顶栏、目录 `<aside>`、正文 `<main>`、问答 `<aside>` + 一个 toggle `<button>`。

```
移动 (<768px)                       桌面 (≥768px)
flex flex-col h-dvh                 grid [240px minmax(0,1fr) 360px] h-screen
├ 顶栏 ☰ + 报告标题 (md:hidden)     ├ (顶栏不渲染)
├ aside 目录 = 抽屉 + 遮罩          ├ aside 目录 = 常驻左栏
├ main 正文 flex-1 overflow-auto    ├ main 正文
├ button = 底部「问这篇报告」条      ├ button = 右侧 18×60 竖条
└ aside 问答 = fixed 底部面板        └ aside 问答 = 右栏,收起时列宽压到 0
```

### 5.1 移动顶栏

移动端新增,`md:hidden`。左侧 ☰ 开目录抽屉,中间显示报告标题(即当前 `document.title` 的来源 `doc.filename`,需在 state 中保留)。桌面端不渲染 —— 桌面的「← 全部报告」仍在目录栏顶部。

移动端的「← 全部报告」放进抽屉顶部,与桌面同一个 DOM 节点。

### 5.2 目录抽屉

- 移动:`fixed inset-y-0 left-0 w-70 z-30 -translate-x-full`,打开时 `translate-x-0`;外加一层 `fixed inset-0 bg-black/40 z-20` 遮罩,点遮罩关闭。
- 桌面:`md:static md:translate-x-0 md:w-toc md:z-auto`,遮罩 `md:hidden`。
- 点击目录项:移动端跳转后自动关抽屉;桌面端不变。
- **触控目标**:目录项现为 `padding: 5px 8px` 的 13px 小字,手指点不准 → 移动端 `min-h-11`(44px),`md:min-h-0` 桌面保持原样。

新增 state `tocOpen`(仅移动端有意义,桌面下该 state 不影响渲染)。

### 5.3 问答面板

- 移动:`fixed inset-x-0 bottom-0 z-30 h-[70dvh]`,收起时 `translate-y-full` 滑出屏外。
- 桌面:`md:static md:h-auto`,沿用现有"grid 列宽压到 0、面板被 `overflow:hidden` 裁掉"的滑出效果。
- **高度用 `dvh` 不用 `vh`**:iOS 键盘弹起时 `vh` 不变,发送按钮会被键盘遮住。
- `.chat > * { width: 360px }` 这个防压缩 hack → `w-full md:w-chat`。
- `ChatPanel` 的 `height: 100vh` → `h-full`,高度由父级决定。
- 面板高度固定 70dvh,**不做拖拽调节**。

### 5.4 Toggle 按钮

**只有一个 `<button>`**,两套 class:移动端是底部整条(`h-11 w-full`),桌面是右侧竖条(`md:absolute md:right-chat md:w-[18px] md:h-15`,收起时 `md:right-0`)。

它始终位于 `<aside>` 之外 —— 现有结构已经如此,不需调整。这样面板 `inert={!chatOpen}` 时按钮仍可点击。

### 5.5 三处行为差异 → `useIsMobile()`

新增 `src/hooks/useIsMobile.ts`,约 15 行:基于 `window.matchMedia('(min-width: 768px)')`,监听 `change` 事件,卸载时解绑。

1. **`chatOpen` 初值** —— 桌面读 `localStorage['reader.chatOpen']`(现有行为,默认展开);手机恒为 `false`,且**不写 localStorage**。否则手机一进阅读页就被 70dvh 面板盖掉大半正文。
   *跨断点切换的行为*(桌面浏览器缩放窗口越过 768px):`chatOpen` 保持当前值不重置 —— 值本身在两侧语义一致(问答是否可见),重置反而会让用户拖动窗口时面板莫名开合。localStorage 的写入仍只在桌面侧发生。
2. **点「来源 §xxx」chip 时,手机先收面板再滚动**,桌面不收。这是"底部面板"方案的核心收益,也是它必须付的代价。
3. **抽屉打开时给 `<body>` 加 `overflow-hidden`**,防止背景正文跟着滑动;关闭时移除。

### 5.6 `jump()` 一行不用改

移动端正文 `<main>` 仍是 `id="report-content"` 的 `overflow-y-auto` 滚动容器,现有那套"显式滚动容器 + `behavior:'auto'` + 强制回流 + flash 高亮"的逻辑原样成立,**代码中记录踩坑原因的两条注释必须保留**。

问答面板是 `fixed` 定位,不占布局流,收起/展开都不影响 `#report-content` 的 `scrollTop` 几何,因此 5.5 第 2 条中"先收面板再滚动"无需等待动画帧。

### 5.7 明确不做

面板拖拽调高、目录手势侧滑唤出、阅读进度条、下拉刷新。

## 6. 首页

现有 `repeat(auto-fill, minmax(280px, 1fr))` 在 375px 屏上会自然退化成单列,**卡片网格本身不用改**。三处调整:

- 容器 `padding: 32px 24px` → `px-4 py-5 md:px-6 md:py-8`。
- header 的 `justify-between` 在窄屏会把「研报站 / 🔍 trace / 头像+剩余N / 退出 / 上传」挤成一坨 → 加 `flex-wrap gap-3`,窄屏自然折成两行。
- **删除按钮修 bug**:`.del { opacity: 0 }` 仅靠 `.card:hover` 显形,触摸屏没有 hover,**管理员在手机上永远删不掉报告**。改为移动端常显:`opacity-100 md:opacity-0 md:group-hover:opacity-100`(卡片加 `group`)。这是本次顺带修掉的既有缺陷,不是新功能。

骨架屏(当前未提交的改动)一并迁到 Tailwind:`animate-pulse` 替代自定义 `@keyframes pulse`,`motion-reduce:animate-none` 替代 `prefers-reduced-motion` media query。

## 7. 后台页保底(`/traces`、`/traces/:id`、`/eval`、`/eval/:docId`)

只做两件事:

1. 页面容器 padding 收窄(同首页策略)。
2. 每个宽表格,以及 `SpanWaterfall` 的 bar 区,外面包一层 `overflow-x-auto` —— 让横向滚动发生在**组件内部**,而不是整个 body。

**不做**:重排成卡片流、waterfall 改竖向时间轴、隐藏列。

验收标准只有一条机械判据:这四个页在 375px 宽下 `document.documentElement.scrollWidth === document.documentElement.clientWidth`。

## 8. 测试

现有前端测试仅 `lib/` 下三个纯函数单测(`toc` / `statBars` / `waterfall`),无组件测试。本次新增两层:

- **`useIsMobile` 单测**:stub `window.matchMedia`,验证初值正确、`change` 事件触发后状态翻转、组件卸载时解绑监听。
- **`ReaderPage` 组件测试**(happy-dom):覆盖 5.5 中最关键的第 2 条 —— mock 为移动端时,点「来源」chip 后 `chatOpen` 变为 false 且滚动被触发;mock 为桌面端时面板保持展开。**这条测试是"底部面板"方案能否成立的守门人。**

`pnpm test`(含后端)与 `pnpm typecheck` 必须全绿。

## 9. 验收

### 9.1 自动化

- `pnpm test` 全绿
- `pnpm typecheck` 全绿
- `pnpm build:client` 成功

### 9.2 移动端(人工,宽度 375 / 390 / 768)

375 = iPhone SE/13 mini,390 = iPhone 14/15,768 = 断点临界值(边界最易出问题)。

- [ ] 6 个路由均无横向溢出(`scrollWidth === clientWidth`)
- [ ] 阅读页:☰ 打开抽屉、点遮罩关闭、点目录项跳转并关抽屉
- [ ] 阅读页:底部条展开问答面板,输入框聚焦、键盘弹起时发送按钮不被遮挡
- [ ] 阅读页:点「来源 §xxx」→ 面板收起 + 正文跳到对应章节 + flash 高亮可见
- [ ] 阅读页:刷新后面板默认收起(未写 localStorage)
- [ ] 首页:管理员可见并可点中删除按钮
- [ ] 768px 处布局在断点两侧各 1px 均无破损

### 9.3 桌面端(人工,宽度 1280)

**"像素级保持"没有自动化保障** —— 项目无截图回归基建,本次也不引入 Playwright(成本远大于收益)。改为人工 checklist 兜底,逐页对照迁移前的样子:

- [ ] 首页:卡片间距、hover 抬升与阴影、header 各元素间距、额度 pill 样式
- [ ] 阅读页:三栏宽度 240/1fr/360、目录项 hover 底色、竖条 toggle 位置与收起动画
- [ ] 阅读页正文:表格边框与表头底色、金色引用条、代码块底色与圆角、h2 下划线、flash 高亮
- [ ] 问答面板:用户气泡圆角与黑底、来源 chip 金色描边、输入行与禁用态
- [ ] traces / eval:表格、waterfall bar 配色与统计条

## 10. 影响范围

| 文件 | 动作 |
|---|---|
| `package.json`(client) | +2 devDependency |
| `vite.config.ts` | +1 plugin |
| `index.html` | viewport meta 加 `viewport-fit=cover` |
| `src/index.css` | `@import` + `@theme` + 报告排版 `@layer components` |
| `src/hooks/useIsMobile.ts` | 新增 |
| `src/hooks/useIsMobile.test.ts` | 新增 |
| `src/pages/ReaderPage.tsx` | 重构(移动布局 + 抽屉/面板状态) |
| `src/pages/ReaderPage.test.tsx` | 新增 |
| `src/pages/HomePage.tsx` | 迁移 + 删除按钮 bug 修复 |
| `src/components/ChatPanel.tsx` | 迁移 + 高度改 `h-full` |
| `src/components/Traces*.tsx`、`SpanWaterfall.tsx`、`src/pages/Eval*.tsx` | 迁移 + 宽内容包 `overflow-x-auto` |
| 8 个 `*.module.css` | **删除** |

后端 `packages/server` 零改动。
