import * as oauth from 'oauth4webapi'

export class OAuthRejected extends Error {
  constructor(
    readonly status: 400 | 502,
    readonly error: 'invalid_oauth_state' | 'email_unverified' | 'github_oauth_failed' | 'google_oauth_failed',
  ) {
    super(error)
  }
}

export const githubAuthorizationServer: oauth.AuthorizationServer = {
  // 回调里的 iss 是这个值（RFC 9207），不是 https://github.com。对不上会被拒，然后跳回首页。
  issuer: 'https://github.com/login/oauth',
  authorization_endpoint: 'https://github.com/login/oauth/authorize',
  token_endpoint: 'https://github.com/login/oauth/access_token',
}

const GOOGLE_ISSUER = new URL('https://accounts.google.com')
let googleAuthorizationServer: oauth.AuthorizationServer | undefined

export function clearOAuthCache(): void {
  googleAuthorizationServer = undefined
}

export async function getGoogleAuthorizationServer(): Promise<oauth.AuthorizationServer> {
  if (googleAuthorizationServer) return googleAuthorizationServer
  const response = await oauth.discoveryRequest(GOOGLE_ISSUER)
  googleAuthorizationServer = await oauth.processDiscoveryResponse(GOOGLE_ISSUER, response)
  return googleAuthorizationServer
}

export async function authorizationUrl(opts: {
  as: oauth.AuthorizationServer
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeVerifier: string
  nonce?: string
}): Promise<URL> {
  if (!opts.as.authorization_endpoint) throw new Error('missing authorization_endpoint')
  const url = new URL(opts.as.authorization_endpoint)
  const challenge = await oauth.calculatePKCECodeChallenge(opts.codeVerifier)
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', opts.scope)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (opts.nonce) url.searchParams.set('nonce', opts.nonce)
  return url
}

export function googleIdentity(claims: {
  sub?: unknown
  email?: unknown
  email_verified?: unknown
  picture?: unknown
}): { googleSub: string; email: string; avatarUrl: string | null } {
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email.includes('@')) {
    throw new OAuthRejected(400, 'email_unverified')
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new OAuthRejected(502, 'google_oauth_failed')
  }
  return {
    googleSub: claims.sub,
    email: claims.email,
    avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
  }
}

export async function exchangeGithubCode(opts: {
  clientId: string
  clientSecret: string
  redirectUri: string
  callbackUrl: URL
  expectedState: string
  codeVerifier: string
}): Promise<{ githubId: number; username: string; avatarUrl: string | null }> {
  const client: oauth.Client = { client_id: opts.clientId }
  const params = oauth.validateAuthResponse(
    githubAuthorizationServer,
    client,
    opts.callbackUrl,
    opts.expectedState,
  )
  const response = await oauth.authorizationCodeGrantRequest(
    githubAuthorizationServer,
    client,
    oauth.ClientSecretPost(opts.clientSecret),
    params,
    opts.redirectUri,
    opts.codeVerifier,
  )
  const result = await oauth.processAuthorizationCodeResponse(githubAuthorizationServer, client, response)
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${result.access_token}`,
      'User-Agent': 'ai-research-hub',
      Accept: 'application/vnd.github+json',
    },
  })
  if (!userRes.ok) throw new OAuthRejected(502, 'github_oauth_failed')
  const profile = (await userRes.json()) as { id?: unknown; login?: unknown; avatar_url?: unknown }
  if (typeof profile.id !== 'number' || typeof profile.login !== 'string' || !profile.login) {
    throw new OAuthRejected(502, 'github_oauth_failed')
  }
  return {
    githubId: profile.id,
    username: profile.login,
    avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
  }
}

export async function exchangeGoogleCode(opts: {
  clientId: string
  clientSecret: string
  redirectUri: string
  callbackUrl: URL
  expectedState: string
  codeVerifier: string
  nonce: string
}): Promise<{ googleSub: string; email: string; avatarUrl: string | null }> {
  const as = await getGoogleAuthorizationServer()
  const client: oauth.Client = { client_id: opts.clientId }
  const params = oauth.validateAuthResponse(as, client, opts.callbackUrl, opts.expectedState)
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    oauth.ClientSecretPost(opts.clientSecret),
    params,
    opts.redirectUri,
    opts.codeVerifier,
  )
  const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
    expectedNonce: opts.nonce,
    requireIdToken: true,
  })
  const claims = oauth.getValidatedIdTokenClaims(result)
  if (!claims) throw new OAuthRejected(502, 'google_oauth_failed')
  return googleIdentity(claims)
}
