// packages/server/src/services/reportKind.ts
//
// 研报分两类:行业研报(产业链、行业主题)和公司研报(只针对一家公司)。
// 类型以管理员在上传弹窗里选的为准;这里的 inferKind 只给弹窗预填一个建议值,
// 以及兜底直接调接口、不带类型的上传和存量迁移。
//
// 只看标题。按关键词猜「行业」曾经因为「猜错只会安静地标错」被下线
//(client/src/lib/reportTags.ts),所以规则刻意只有两条、拿不准就返回 null。

export const REPORT_KINDS = ['industry', 'company'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export function isReportKind(v: unknown): v is ReportKind {
  return typeof v === 'string' && (REPORT_KINDS as readonly string[]).includes(v)
}

/**
 * 标题里的股票代码:A 股 6 位(可带 .SH/.SZ/.BJ)、港股 4~5 位带 .HK(或 `0700 HK`)、
 * 交易所前缀形式(NYSE: ALB / KRX: 000660)。
 * 4 位纯数字不认 —— 「（2026Q3 更新）」之类的年份会撞上。
 */
const CODE_RE = /\b\d{6}\b|\b\d{4,5}\s*[.\s]\s*hk\b|\b(?:nyse|nasdaq|amex|hkex|krx|tse|lse|tsx|asx|otc)\s*[:：]\s*[a-z0-9.]+/i

/**
 * 路透式美股代码后缀:`NVDA.O` / `BRK.N`。区分大小写 —— 小写的 `ai.o` 之类不是代码。
 * **不认括号里的裸字母**(`苹果（AAPL）`):它和 `（HBM）` `（CNOOC）` `（ETF）` 这类缩写长得一样,
 * 认了会把「存储芯片（HBM）投资研究报告」预填成公司研报,错得比认不出更糟。认不出就是 null,
 * 弹窗默认行业研报、管理员自己改。
 */
const RIC_RE = /\b[A-Z]{1,5}\.(?:O|N|OQ|K)\b/

/** 「产业链」很可靠:公司研报几乎不会这么写。 */
const CHAIN_RE = /产业链/
/**
 * 「行业」不可靠:公司研报的标题常写「白酒行业龙头」,所以它排在代码之后,
 * 只在没有代码的标题上才算数。
 */
const SECTOR_RE = /行业/

/**
 * 建议类型;看不出来返回 null(调用方自己决定兜底,通常是 industry)。
 * 顺序即优先级:产业链 → 代码 → 行业。产业链报告的标题里也可能带代码
 *(「…产业链(以 SpaceX 为轴)」),所以「产业链」先判;「行业」要让给代码。
 *
 * 已知会错的:指数代码(`中证500（000905）`)和 6 位数字长得和股票一样,会被判成公司。
 * 这只是预填,管理员在弹窗里能看到并改。
 */
export function inferKind(title: string): ReportKind | null {
  if (CHAIN_RE.test(title)) return 'industry'
  if (CODE_RE.test(title) || RIC_RE.test(title)) return 'company'
  if (SECTOR_RE.test(title)) return 'industry'
  return null
}
