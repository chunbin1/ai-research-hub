// 管理员手填的机构：CIK 补齐到 SEC 的 10 位，短名做成 URL 片段。

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 1–10 位数字补零。含字母、空串或超过 10 位则拒绝。 */
export function normalizeCik(raw: string): string | null {
  const text = raw.trim()
  if (!/^\d{1,10}$/.test(text)) return null
  return text.padStart(10, '0')
}

/** 手填短名：大小写和空格收成小写连字符。收不干净就拒绝，不偷偷删字。 */
export function normalizeSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug || slug.length > 64 || !SLUG_RE.test(slug)) return null
  return slug
}

/** 没填短名时，优先用英文名里的字母。纯中文生成不了链接。 */
export function slugFromNames(nameEn: string, nameZh: string): string | null {
  const source = nameEn.trim() || nameZh.trim()
  const slug = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (!slug || !SLUG_RE.test(slug)) return null
  return slug
}
