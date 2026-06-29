# Security

Report vulnerabilities privately to the repository owner.

- Treat the Supabase service-role key, key pepper, preview secret and webhook
  secret as independent production secrets.
- Keep the service bound to localhost behind Caddy.
- Do not enable Raw HTML in the Markdown pipeline.
- Configure Turnstile in production; without it public writes intentionally fail
  open only when `NODE_ENV` is not `production`.
- Rotate scoped API keys rather than sharing the bootstrap key.
- Use a Subkit `standard` inbound binding. `verify: none` is not acceptable for
  the public engine endpoint.
- Back up Postgres and Storage together: database metadata without release
  objects is not a complete backup.
