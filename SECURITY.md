# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report vulnerabilities privately via
[GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or by email to <mike@mikebild.com>.

You can expect an acknowledgement within a few days. Please include a
description of the issue, steps to reproduce and the affected version. You
will be credited in the fix release unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Hardening notes for operators

- Treat the storage service credential, key pepper, preview secret, reader
  session secret and webhook secret as independent production secrets.
- Keep the service bound to localhost behind a reverse proxy (Caddy, nginx).
- Do not enable raw HTML in the Markdown pipeline.
- Keep visual authoring on the built-in `layout: composition` semantic
  directives and repository-owned declarative Pattern Packages. Do not accept
  client-supplied geometry, runtime specifications or executable callbacks;
  Contentkit's validation, resource limits and deterministic SVG/PNG boundary
  are part of the security model.
- Treat slide-deck rendering as trusted code execution. Keep planning and
  validation available to normal authors, but grant `deck:render` only to
  trusted automation. The queue, timeout, process-tree kill, secret-free child
  environment and temporary-file cleanup reduce impact; they are not an OS
  sandbox. Use a dedicated unprivileged service account and stronger host-level
  isolation when multiple trust domains share a deployment.
- Configure Turnstile in production; without it public writes fail closed unless
  the explicit development bypass is enabled outside production.
- Rotate scoped API keys rather than sharing the bootstrap key.
- Give every protected-area reader a personal account. Reader passwords are
  salted scrypt hashes, sessions store only a token HMAC, and password changes
  or account disabling revoke active sessions. Never use a shared reader
  credential as an administrative API key.
- Terminate HTTPS at the trusted reverse proxy and forward the original host;
  reader cookies are HttpOnly, SameSite=Lax and Secure for HTTPS sites.
- Treat release access rules as real authorization. `noindex`, an unlinked URL
  or robots.txt is not access control; activate a new release after changing a
  draft path policy.
- Verify the Standard Webhooks signature (timestamp window plus HMAC) at every
  webhook receiver. Accepting unsigned deliveries is not acceptable.
- Back up Postgres and Storage together: database metadata without release
  objects is not a complete backup.
