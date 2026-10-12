// packages/server/src/routes/auth.ts
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import * as oauth from 'oauth4webapi'
import {
  upsertGithubUser,
  upsertGoogleUser,
  getUserById,
  remaining,
  MESSAGE_LIMIT,
  type User,
} from '../services/userStore.js'
import {
  OAuthRejected,
  authorizationUrl,
  exchangeGithubCode,
  exchangeGoogleCode,
  getGoogleAuthorizationServer,
  githubAuthorizationServer,
} from '../services/oauthFlow.js'

// Escape hatch for local dev without an OAuth app: every request is an
// unlimited synthetic user, so login is skipped entirely.
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true'

const COOKIE_UID = 'uid'

type Provider = 'github' | 'google'

const DEV_USER: User = {
  id: 'dev',
  github_id: 0,
  google_sub: null,
  username: 'dev',
  avatar_url: null,
  message_count: 0,
  unlimited: 1,
  is_admin: 1,
  created_at: '',
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
}

function cookieBase() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: appUrl().startsWith('https://'),
    path: '/',
  }
}

function creds(provider: Provider): { id: string; secret: string } {
  if (provider === 'github') {
    return {
      id: process.env.GITHUB_CLIENT_ID ?? '',
      secret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }
  }
  return {
    id: process.env.GOOGLE_CLIENT_ID ?? '',
    secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  }
}

function stateCookie(provider: Provider): string {
  return `oauth_state_${provider}`
}

function verifierCookie(provider: Provider): string {
  return `oauth_verifier_${provider}`
}

/** Resolve the logged-in user from the signed `uid` cookie (or dev user). */
export function currentUser(request: FastifyRequest): User | null {
  if (AUTH_DISABLED) return DEV_USER
  const raw = request.cookies?.[COOKIE_UID]
  if (!raw) return null
  const unsigned = request.unsignCookie(raw)
  if (!unsigned.valid || !unsigned.value) return null
  return getUserById(unsigned.value)
}

/** Reply 401 and return null if not logged in; otherwise return the user. */
export function requireUser(request: FastifyRequest, reply: FastifyReply): User | null {
  const user = currentUser(request)
  if (!user) { void reply.code(401).send({ error: 'unauthorized' }); return null }
  return user
}

/** Reply 401/403 and return null unless logged in AND admin. */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): User | null {
  const user = requireUser(request, reply)
  if (!user) return null
  if (user.is_admin !== 1) { void reply.code(403).send({ error: 'forbidden' }); return null }
  return user
}

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatar_url,
    messageCount: user.message_count,
    limit: MESSAGE_LIMIT,
    unlimited: user.unlimited === 1,
    isAdmin: user.is_admin === 1,
    remaining: remaining(user),
  }
}

function clearOAuthCookies(reply: FastifyReply, provider: Provider): void {
  const opts = { path: '/' }
  reply.clearCookie(stateCookie(provider), opts)
  reply.clearCookie(verifierCookie(provider), opts)
  if (provider === 'google') reply.clearCookie('oauth_nonce_google', opts)
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  async function begin(reply: FastifyReply, provider: Provider) {
    if (AUTH_DISABLED) return reply.redirect(`${appUrl()}/`)
    const { id, secret } = creds(provider)
    if (!id || !secret) {
      const name = provider === 'github' ? 'GitHub' : 'Google'
      return reply.status(503).send({ error: `${name} OAuth not configured on the server` })
    }

    const state = oauth.generateRandomState()
    const codeVerifier = oauth.generateRandomCodeVerifier()
    const nonce = provider === 'google' ? oauth.generateRandomNonce() : undefined
    const pending = { ...cookieBase(), maxAge: 600 }
    reply.setCookie(stateCookie(provider), state, pending)
    reply.setCookie(verifierCookie(provider), codeVerifier, pending)
    if (nonce) reply.setCookie('oauth_nonce_google', nonce, pending)

    try {
      const as = provider === 'google'
        ? await getGoogleAuthorizationServer()
        : githubAuthorizationServer
      const url = await authorizationUrl({
        as,
        clientId: id,
        redirectUri: `${appUrl()}/api/auth/${provider}/callback`,
        scope: provider === 'google' ? 'openid email profile' : 'read:user',
        state,
        codeVerifier,
        nonce,
      })
      return reply.redirect(url.toString())
    } catch (err) {
      app.log.error(err instanceof Error ? err.message : 'oauth failed')
      return reply.status(502).send({ error: `${provider}_oauth_failed` })
    }
  }

  async function finish(
    request: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
    reply: FastifyReply,
    provider: Provider,
  ) {
    const expected = request.cookies?.[stateCookie(provider)]
    const codeVerifier = request.cookies?.[verifierCookie(provider)]
    const nonce = request.cookies?.oauth_nonce_google
    const state = request.query.state
    clearOAuthCookies(reply, provider)

    if (!expected || !codeVerifier || !state || state !== expected || (provider === 'google' && !nonce)) {
      return reply.status(400).send({ error: 'invalid_oauth_state' })
    }

    const { id, secret } = creds(provider)
    if (!id || !secret) {
      return reply.status(503).send({ error: `${provider === 'github' ? 'GitHub' : 'Google'} OAuth not configured on the server` })
    }

    try {
      const callbackUrl = new URL(request.url, appUrl())
      const redirectUri = `${appUrl()}/api/auth/${provider}/callback`
      const user = provider === 'github'
        ? upsertGithubUser(await exchangeGithubCode({
          clientId: id,
          clientSecret: secret,
          redirectUri,
          callbackUrl,
          expectedState: expected,
          codeVerifier,
        }))
        : upsertGoogleUser(await exchangeGoogleCode({
          clientId: id,
          clientSecret: secret,
          redirectUri,
          callbackUrl,
          expectedState: expected,
          codeVerifier,
          nonce: nonce as string,
        }))

      reply.setCookie(COOKIE_UID, user.id, {
        ...cookieBase(),
        signed: true,
        maxAge: 60 * 60 * 24 * 30,
      })
      return reply.redirect(`${appUrl()}/`)
    } catch (err) {
      if (err instanceof OAuthRejected) {
        return reply.status(err.status).send({ error: err.error })
      }
      // 只记失败原因,不记授权码和 token。
      app.log.error(err instanceof Error ? err.message : 'oauth failed')
      return reply.status(502).send({ error: `${provider}_oauth_failed` })
    }
  }

  app.get('/auth/github', async (_request, reply) => begin(reply, 'github'))
  app.get('/auth/google', async (_request, reply) => begin(reply, 'google'))
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/github/callback',
    async (request, reply) => finish(request, reply, 'github'),
  )
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/google/callback',
    async (request, reply) => finish(request, reply, 'google'),
  )

  app.get('/auth/me', async (request, reply) => {
    const user = currentUser(request)
    if (!user) return reply.status(401).send({ error: 'unauthorized' })
    return publicUser(user)
  })

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_UID, { path: '/' })
    return { ok: true }
  })
}
