// 首批固定六家。CIK 于 2026-10-27 对照 data.sec.gov/submissions 核对。
// 高瓴美股 13F 的申报主体是 HHLR Advisors, Ltd.（0001762304），不是相邻的 0001762303。

export interface WhaleSeed {
  slug: string
  nameZh: string
  nameEn: string
  manager: string
  cik: string
  sortOrder: number
}

export const WHALE_SEEDS: readonly WhaleSeed[] = [
  {
    slug: 'berkshire',
    nameZh: '伯克希尔·哈撒韦',
    nameEn: 'Berkshire Hathaway Inc',
    manager: '巴菲特',
    cik: '0001067983',
    sortOrder: 1,
  },
  {
    slug: 'himalaya',
    nameZh: '喜马拉雅资本',
    nameEn: 'Himalaya Capital Management LLC',
    manager: '李录',
    cik: '0001709323',
    sortOrder: 2,
  },
  {
    slug: 'hhlr',
    nameZh: '高瓴 HHLR',
    nameEn: 'HHLR Advisors, Ltd.',
    manager: '张磊',
    cik: '0001762304',
    sortOrder: 3,
  },
  {
    slug: 'pershing',
    nameZh: '潘兴广场',
    nameEn: 'Pershing Square Capital Management, L.P.',
    manager: '比尔·阿克曼',
    cik: '0001336528',
    sortOrder: 4,
  },
  {
    slug: 'scion',
    nameZh: 'Scion',
    nameEn: 'Scion Asset Management, LLC',
    manager: '迈克尔·伯里',
    cik: '0001649339',
    sortOrder: 5,
  },
  {
    slug: 'ark',
    nameZh: 'ARK Invest',
    nameEn: 'ARK Investment Management LLC',
    manager: '凯西·伍德',
    cik: '0001697748',
    sortOrder: 6,
  },
]
