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

- Treat the Supabase service-role key, key pepper, preview secret and webhook
  secret as independent production secrets.
- Keep the service bound to localhost behind a reverse proxy (Caddy, nginx).
- Do not enable raw HTML in the Markdown pipeline.
- Configure Turnstile in production; without it public writes intentionally
  fail open only when `NODE_ENV` is not `production`.
- Rotate scoped API keys rather than sharing the bootstrap key.
- Verify the Standard Webhooks signature (timestamp window plus HMAC) at every
  webhook receiver. Accepting unsigned deliveries is not acceptable.
- Back up Postgres and Storage together: database metadata without release
  objects is not a complete backup.
