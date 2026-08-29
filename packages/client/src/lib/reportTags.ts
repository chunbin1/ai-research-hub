// packages/client/src/lib/reportTags.ts
//
// 首页研报行上的「市场 / 行业」标签,以及右栏「按板块浏览」的计数。
//
// 设计稿(design_handoff_homepage)假定每篇研报自带市场与行业标签,
// 但库里的 documents 表只有 filename / size_bytes / chunk_count / created_at ——
// 没有这两个字段,也没有打标的入口。与其为此加一张表和一条接口(设计稿明确写了
// 「板块计数由列表聚合,不要新增接口」),这里从标题上按关键词推断:
//
//   · 推断不出来就**不显示**该标签,而不是猜一个 —— 标错行业比没有标签更糟;
//   · 规则是有序的,先匹配到的赢,所以「石油 / 新能源」必须排在更宽的「能源」前面;
//   · 每条规则除了行业词,还收了标题里最常出现的几个龙头公司名 —— 研报标题写
//     「腾讯生态产业链」而不写「互联网」是常态,只认行业词会大面积漏标。
//
// 等后端真的有了行业字段,把 deriveReportTags 换成读字段即可,调用方不用动。
//
// ⚠️ 目前**没有任何地方调用这个模块** —— 首页已经把行标签、「按板块浏览」、移动端
// 筛选胶囊一起下掉了,因为「猜错不会报错、只会安静地标错」这个代价在真实数据上
// 不划算。刻意保留而不是删掉:等行业字段落到 documents 表上时,存量研报的回填
// 正需要这套关键词规则当种子(新上传的走抽取,老的几十篇总得有个起点)。
// 在那之前它是有意的未接线代码,不是漏删。

/** 设计稿里出现过的三个市场。其余市场(韩股 / ASX 等)一律不标。 */
export type Market = '美股' | '港股' | 'A股'

export interface ReportTags {
  market: Market | null
  sector: string | null
}

/** 市场:优先认标题里的显式字样,其次认代码后缀 / 交易所前缀。 */
const MARKET_RULES: ReadonlyArray<readonly [Market, RegExp]> = [
  ['港股', /港股|\.HK\b|HKEX|HKG\s*[:：]/i],
  ['A股', /A\s*股|\.(SH|SZ)\b|SSE\s*[:：]|SZSE\s*[:：]/i],
  ['美股', /美股|NASDAQ|NYSE|NasdaqGS/i],
]

/**
 * 行业。顺序即优先级:窄的在前、宽的在后。
 * 「石油」「新能源」都会被更宽的「能源」吃掉,所以必须排在它前面。
 */
const SECTOR_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['商业航天', /商业航天|航天|火箭|卫星|SpaceX|Rocket\s*Lab/i],
  ['石油', /石油|原油|油气|炼化|CNOOC|中石油|中石化|埃克森/i],
  ['新能源', /新能源|锂|光伏|储能|电池|风电|氢能|宁德时代|比亚迪|天齐|赣锋/i],
  ['半导体', /半导体|芯片|晶圆|存储|算力|HBM|GPU|先进封装|英伟达|台积电|海力士|中芯|美光/i],
  ['能源', /能源|煤炭|电力|电网|天然气|核电|缺电/i],
  ['互联网', /互联网|电商|平台经济|社交|游戏|云计算|腾讯|阿里巴巴|美团|拼多多|京东/i],
  ['消费', /消费|白酒|食品|饮料|零售|家电|茅台|五粮液/i],
]

function firstMatch<T>(rules: ReadonlyArray<readonly [T, RegExp]>, text: string): T | null {
  for (const [value, re] of rules) if (re.test(text)) return value
  return null
}

export function deriveReportTags(filename: string): ReportTags {
  return {
    market: firstMatch(MARKET_RULES, filename),
    sector: firstMatch(SECTOR_RULES, filename),
  }
}

export interface SectorCount {
  sector: string
  count: number
}

/**
 * 右栏「按板块浏览」的数据:行业标签聚合计数,多到少排序。
 * 推断不出行业的研报不进任何一档 —— 不设「其他」桶,它对浏览没有帮助。
 * 同数量时按 SECTOR_RULES 的顺序稳定排列,避免每次渲染顺序跳动。
 */
export function countSectors(filenames: readonly string[]): SectorCount[] {
  const counts = new Map<string, number>()
  for (const name of filenames) {
    const { sector } = deriveReportTags(name)
    if (sector) counts.set(sector, (counts.get(sector) ?? 0) + 1)
  }
  const order = SECTOR_RULES.map(([sector]) => sector)
  return [...counts.entries()]
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.sector) - order.indexOf(b.sector))
}
