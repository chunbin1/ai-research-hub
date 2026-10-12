# Google 登录设计

> 日期: 2026-10-12
> 状态: 已确认,开始实现

在现有 GitHub 登录旁边加 Google 登录。两个提供者各建各的账号,不合并。GitHub 与 Google 的授权码流程都改用 `oauth4webapi`。会话仍是现在的签名 `uid` cookie。

## 用户表

`users.github_id` 改为可空,新增唯一的 `google_sub`。一行用户恰好填其中一个。已有数据库在 `initUserTables` 里重建这张表:SQLite 不能把已有的 `NOT NULL` 列改成可空。原有 GitHub 用户原样拷贝,`google_sub` 为空。

`upsertGoogleUser` 按 `google_sub` 查找。第一次登录插入一行,用户名是已验证邮箱。再次登录只更新邮箱和头像,账号 id、问答次数、管理员标记都留在原行。

## 登录协议

共用模块负责 state、PKCE、授权地址和授权码交换。

- GitHub:固定授权地址与 token 地址。换到 access token 后仍请求 `https://api.github.com/user`,再 `upsertGithubUser`。scope 仍是 `read:user`。
- Google:第一次登录时拉取 OpenID 发现文档,缓存在进程里。回调时由库校验 ID token 的签名、签发方、受众和过期时间。身份用 `sub`,用户名用邮箱,头像用 `picture`。scope 是 `openid email profile`。

state、`code_verifier`,以及 Google 的 nonce,放在各自的 httpOnly cookie 里,十分钟过期。两边的 cookie 名字分开。成功后写现在的 `uid` cookie,跳回首页。`/auth/me`、登出、`AUTH_DISABLED` 不变。

环境变量增加 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。回调地址是 `${APP_URL}/api/auth/google/callback`。

## 失败

- 某家没配 client id 或 secret:该入口 503。
- state 对不上:400 `invalid_oauth_state`,不建用户。
- Google 没有邮箱,或 `email_verified` 不是真:400,不建用户。
- 授权服务器或用户信息接口失败:502。
- 日志不记授权码和 token。

## 界面

未登录时,顶栏和报告问答区各有「GitHub 登录」和「Google 登录」。`useAuth` 的 `login` 接收 `'github' | 'google'`。登录态未知时顶栏留白。已登录仍显示头像和用户名。

## 配置与测试

`.env.example`、`.env.prod.example`、`docs/DEPLOY.md` 写上 Google OAuth 客户端的创建步骤。生产环境检查把 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 算作必填。

测试覆盖:Google 用户插入与再次登录时更新邮箱、两个提供者互不影响、老库迁移后 `github_id` 可空、state 不匹配被拒绝。不请求真实的 GitHub 或 Google。

## 非目标

账号打通、管理员界面、换掉 `uid` cookie。
