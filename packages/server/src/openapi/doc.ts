/** 只给 OpenAPI 用的说明，不带 body / response schema，因此不会改变原有校验和序列化。 */
export function describeRoute(tags: string[], summary: string, description: string) {
  return { schema: { tags, summary, description } }
}
