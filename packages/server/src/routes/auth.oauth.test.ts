// AUTH_DISABLED 在 auth.ts 顶层只读一次。这个文件不设它,走真实登录分支。
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'
import cookie from '@fastify/cookie'

delete process.env.AUTH_DISABLED

const { initUserTables } = await import('../services/userStore.ts')
const { clearOAuthCache } = await import('../services/oauthFlow.ts')
const { authRoutes } = await import('./auth.ts')

async function freshApp() {
  initUserTables(new Database(':memory:'))
  const app = fastify()
  await app.register(cookie, { secret: 'test-cookie-secret' })
  await app.register(authRoutes, { prefix: '/api' })
  await app.ready()
  return app
}

describe('oauth routes', { concurrency: false }, () => {
test('没配 Google 凭证时 /auth/google 返回 503', async () => {
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  const app = await freshApp()
  const res = await app.inject({ method: 'GET', url: '/api/auth/google' })
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().error, 'Google OAuth not configured on the server')
})

test('没配 GitHub 凭证时 /auth/github 返回 503', async () => {
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
  const app = await freshApp()
  const res = await app.inject({ method: 'GET', url: '/api/auth/github' })
  assert.equal(res.statusCode, 503)
})

test('Google 回调的 state 对不上时 400,且不建用户', async () => {
  const app = await freshApp()
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/google/callback?code=abc&state=nope',
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'invalid_oauth_state')
})

test('GitHub 回调的 state 对不上时 400', async () => {
  const app = await freshApp()
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/github/callback?code=abc&state=nope',
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'invalid_oauth_state')
})

test('GitHub 登录跳转到授权地址,并带上 PKCE', async () => {
  process.env.GITHUB_CLIENT_ID = 'gh-id'
  process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
  process.env.APP_URL = 'http://localhost:5173'
  const app = await freshApp()
  const res = await app.inject({ method: 'GET', url: '/api/auth/github' })
  assert.equal(res.statusCode, 302)
  const loc = new URL(res.headers.location as string)
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(loc.searchParams.get('client_id'), 'gh-id')
  assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost:5173/api/auth/github/callback')
  assert.equal(loc.searchParams.get('scope'), 'read:user')
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(loc.searchParams.get('state'))
  assert.ok(loc.searchParams.get('code_challenge'))
  const setCookie = res.headers['set-cookie']
  const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie)
  assert.match(joined, /oauth_state_github=/)
  assert.match(joined, /oauth_verifier_github=/)
})

test('Google 登录跳转到发现文档里的授权地址', async () => {
  process.env.GOOGLE_CLIENT_ID = 'g-id'
  process.env.GOOGLE_CLIENT_SECRET = 'g-secret'
  process.env.APP_URL = 'http://localhost:5173'
  clearOAuthCache()
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.includes('.well-known/openid-configuration')) {
      throw new Error(`unexpected fetch ${url}`)
    }
    return new Response(JSON.stringify({
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  try {
    const app = await freshApp()
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' })
    assert.equal(res.statusCode, 302)
    const loc = new URL(res.headers.location as string)
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(loc.searchParams.get('client_id'), 'g-id')
    assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost:5173/api/auth/google/callback')
    assert.equal(loc.searchParams.get('scope'), 'openid email profile')
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(loc.searchParams.get('nonce'))
    const setCookie = res.headers['set-cookie']
    const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie)
    assert.match(joined, /oauth_state_google=/)
    assert.match(joined, /oauth_verifier_google=/)
    assert.match(joined, /oauth_nonce_google=/)
  } finally {
    globalThis.fetch = original
    clearOAuthCache()
  }
})
})
