import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toUsd, valueUnitForFilingDate } from './valueUnit.ts'
import {
  aggregatePositions, filingsFromSubmissions, groupReportPeriods, informationTableXmlPath, mergeAggregated,
  parseAmendmentType, parseInformationTable, primaryDocXmlPath, selectReportPeriods,
} from './parser.ts'

test('2023-01-03 起 value 已是美元，更早的按千美元换算', () => {
  assert.equal(valueUnitForFilingDate('2023-01-03'), 'dollars')
  assert.equal(valueUnitForFilingDate('2026-08-14'), 'dollars')
  assert.equal(valueUnitForFilingDate('2023-01-02'), 'thousands')
  assert.equal(toUsd(577211815, 'dollars'), 577211815)
  assert.equal(toUsd(1500, 'thousands'), 1_500_000)
})

test('同一报告期用修正案盖过原报，并只留最近 N 期', () => {
  const picked = selectReportPeriods([
    { form: '10-K', accessionNumber: '0000000000-26-000000', filingDate: '2026-02-01', reportDate: '2025-12-31' },
    { form: '13F-HR', accessionNumber: '0001193125-26-000001', filingDate: '2026-02-17', reportDate: '2025-12-31' },
    { form: '13F-HR/A', accessionNumber: '0001193125-26-000009', filingDate: '2026-02-19', reportDate: '2025-12-31' },
    { form: '13F-HR', accessionNumber: '0001193125-26-000003', filingDate: '2026-05-15', reportDate: '2026-03-31' },
    { form: '13F-HR', accessionNumber: '0001193125-26-000004', filingDate: '2026-08-14', reportDate: '2026-06-30' },
  ], 2)
  assert.deepEqual(picked.map(row => row.reportDate), ['2026-06-30', '2026-03-31'])
  const amended = selectReportPeriods(filingsFromSubmissions({
    filings: {
      recent: {
        form: ['13F-HR', '13F-HR/A'],
        accessionNumber: ['0001193125-26-000001', '0001193125-26-000009'],
        filingDate: ['2026-02-17', '2026-02-19'],
        reportDate: ['2025-12-31', '2025-12-31'],
      },
    },
  }), 8)
  assert.equal(amended.length, 1)
  assert.equal(amended[0]?.form, '13F-HR/A')
  assert.equal(amended[0]?.accessionNumber, '0001193125-26-000009')
})

test('索引页取 INFORMATION TABLE 的原始 XML，不取 xsl 渲染页', () => {
  const html = `
    <tr><td>INFORMATION TABLE</td>
      <a href="/Archives/edgar/data/1067983/000119312526352200/xslForm13F_X02/56757.xml">html</a>
    </tr>
    <tr class="evenRow"><td>INFORMATION TABLE</td>
      <a href="/Archives/edgar/data/1067983/000119312526352200/56757.xml">56757.xml</a>
    </tr>`
  assert.equal(
    informationTableXmlPath(html),
    '/Archives/edgar/data/1067983/000119312526352200/56757.xml',
  )
  assert.equal(informationTableXmlPath('<tr><td>13F-HR</td><a href="/primary_doc.xml">x</a></tr>'), null)
})

test('信息表合并同一 CUSIP，Put 与正股分开，坏行丢掉', () => {
  const xml = `
    <informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
      <infoTable>
        <nameOfIssuer>ALLY FINL INC</nameOfIssuer>
        <titleOfClass>COM</titleOfClass>
        <cusip>02005n100</cusip>
        <value>10</value>
        <shrsOrPrnAmt><sshPrnamt>2</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
      <n1:infoTable>
        <n1:nameOfIssuer>ALLY FINL INC</n1:nameOfIssuer>
        <n1:titleOfClass>COM</n1:titleOfClass>
        <n1:cusip>02005N100</n1:cusip>
        <n1:value>5</n1:value>
        <n1:shrsOrPrnAmt><n1:sshPrnamt>1</n1:sshPrnamt><n1:sshPrnamtType>SH</n1:sshPrnamtType></n1:shrsOrPrnAmt>
      </n1:infoTable>
      <infoTable>
        <nameOfIssuer>ALLY FINL INC</nameOfIssuer>
        <titleOfClass>PUT</titleOfClass>
        <cusip>02005N100</cusip>
        <value>3</value>
        <shrsOrPrnAmt><sshPrnamt>4</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
        <putCall>Put</putCall>
      </infoTable>
      <infoTable>
        <nameOfIssuer>BROKEN</nameOfIssuer>
        <cusip></cusip>
        <value>1</value>
        <shrsOrPrnAmt><sshPrnamt>1</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
    </informationTable>`
  const rows = aggregatePositions(parseInformationTable(xml), 'dollars')
  assert.equal(rows.length, 2)
  const stock = rows.find(row => row.putCall === '')
  const put = rows.find(row => row.putCall === 'Put')
  assert.equal(stock?.cusip, '02005N100')
  assert.equal(stock?.shares, 3)
  assert.equal(stock?.valueUsd, 15)
  assert.equal(put?.shares, 4)
  assert.equal(put?.valueUsd, 3)
  assert.equal(aggregatePositions(parseInformationTable(xml), 'thousands').find(row => row.putCall === '')?.valueUsd, 15_000)
})

test('同一报告期的全部 13F 按优先顺序排好，供 NEW HOLDINGS 修正案往下找原报', () => {
  const groups = groupReportPeriods([
    { form: '13F-HR', accessionNumber: 'a1', filingDate: '2026-08-14', reportDate: '2026-06-30' },
    { form: '13F-HR/A', accessionNumber: 'a2', filingDate: '2026-09-01', reportDate: '2026-06-30' },
    { form: '13F-HR', accessionNumber: 'b1', filingDate: '2026-05-15', reportDate: '2026-03-31' },
    { form: '10-K', accessionNumber: 'x', filingDate: '2026-02-01', reportDate: '2025-12-31' },
  ], 8)
  assert.deepEqual(groups.map(group => group.reportDate), ['2026-06-30', '2026-03-31'])
  assert.deepEqual(groups[0]?.candidates.map(row => row.accessionNumber), ['a2', 'a1'])
})

test('修正案类型读封面的 amendmentType，读不出来当整份重报', () => {
  const index = `<tr><a href="/Archives/x/xslForm13F_X02/primary_doc.xml">h</a>`
    + `<a href="/Archives/x/primary_doc.xml">x</a></tr>`
  assert.equal(primaryDocXmlPath(index), '/Archives/x/primary_doc.xml')
  assert.equal(primaryDocXmlPath('<tr><a href="/Archives/x/info.xml">x</a></tr>'), null)
  assert.equal(parseAmendmentType('<ns1:amendmentInfo><ns1:amendmentType>NEW HOLDINGS</ns1:amendmentType></ns1:amendmentInfo>'), 'NEW HOLDINGS')
  assert.equal(parseAmendmentType('<amendmentType>RESTATEMENT</amendmentType>'), 'RESTATEMENT')
  assert.equal(parseAmendmentType('<coverPage></coverPage>'), 'RESTATEMENT')
})

test('原报和补报按同一键相加', () => {
  const row = (cusip: string, shares: number) => ({
    cusip, putCall: '' as const, shareType: 'SH', issuerName: cusip, titleOfClass: 'COM',
    shares, valueReported: shares, valueUsd: shares * 10,
  })
  const merged = mergeAggregated([[row('A', 1), row('B', 2)], [row('B', 3), row('C', 4)]])
  assert.deepEqual(merged.map(r => [r.cusip, r.shares, r.valueUsd]), [['A', 1, 10], ['B', 5, 50], ['C', 4, 40]])
})
