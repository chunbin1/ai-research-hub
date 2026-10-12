import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OAuthRejected, googleIdentity } from './oauthFlow.ts'

test('已验证邮箱成为 Google 身份', () => {
  assert.deepEqual(
    googleIdentity({ sub: 'sub-1', email: 'a@gmail.com', email_verified: true, picture: 'https://img/a' }),
    { googleSub: 'sub-1', email: 'a@gmail.com', avatarUrl: 'https://img/a' },
  )
})

test('没有头像时 avatarUrl 为空', () => {
  const id = googleIdentity({ sub: 'sub-1', email: 'a@gmail.com', email_verified: true })
  assert.equal(id.avatarUrl, null)
})

test('邮箱未验证时拒绝,不把邮箱当用户名', () => {
  assert.throws(
    () => googleIdentity({ sub: 'sub-1', email: 'a@gmail.com', email_verified: false }),
    (err: unknown) => err instanceof OAuthRejected && err.status === 400 && err.error === 'email_unverified',
  )
})

test('没有邮箱时拒绝', () => {
  assert.throws(
    () => googleIdentity({ sub: 'sub-1', email_verified: true }),
    (err: unknown) => err instanceof OAuthRejected && err.error === 'email_unverified',
  )
})
