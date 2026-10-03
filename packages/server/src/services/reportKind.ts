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
 * 标题里的股票代码:A 股 6 位(可带 .SH/.SZ/.BJ)、港股 4~5 位带 .HK、
 * 交易所前缀形式(NYSE: ALB / KRX: 000660)。
 * 4 位纯数字不认 —— 「（2026Q3 更新）」之类的年份会撞上。
 */
const CODE_RE = /\b\d{6}\b|\b\d{4,5}\s*\.\s*hk\b|\b(?:nyse|nasdaq|amex|hkex|krx|tse|lse|tsx|asx|otc)\s*[:：]\s*[a-z0-9.]+/i

/** 产业链报告的标题里也可能带代码(「…产业链(以 SpaceX 为轴)」),所以这条要先判 */
const INDUSTRY_RE = /产业链|行业/

/** 建议类型;看不出来返回 null(调用方自己决定兜底,通常是 industry) */
export function inferKind(title: string): ReportKind | null {
  if (INDUSTRY_RE.test(title)) return 'industry'
  if (CODE_RE.test(title)) return 'company'
  return null
}
