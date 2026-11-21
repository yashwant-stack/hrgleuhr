# Hosted deployment

Vercel project: hrgleuhr, team gleuhr (moved from Rahul's team rahul-43f8).
Production URL: set by `APP_URL` (the final domain). Legacy URL: https://hrgleuhr.vercel.app

Local use stays unchanged (`npm run dev`); local and cloud data are separate after the initial migration. The first migration preserves your existing admin account/password. Never upload data/, backups/, .vercel/ or .env files. Do not reuse an old `.vercel/` folder — run `vercel link` against the gleuhr team instead.

Hosted requests use Neon Postgres via DATABASE_URL_UNPOOLED. A direct connection holds a session advisory lock across each request to serialize updates and prevent lost writes. The small-team application stores its existing model in one private JSONB row. Login sessions, rate limits and quiz attempts persist between function instances. Responses are released only after saving. Sending email is saved before contacting SMTP; interruption becomes Delivery uncertain and requires review before retrying. Large/high-concurrency deployments should migrate to per-entity tables and an independent mail queue.

## Vercel project settings

- Framework preset: Other. Build command: empty. Output directory: `public`. Node.js: 24.x.
- Keep `vercel.json` (API rewrite to `api/index`, bundled seed/public/materials, `sin1` region, 300 s function duration).

## Production environment variables

- DATABASE_URL_UNPOOLED: direct (non-pooled) Postgres URL, e.g. from the Neon integration. Do not substitute the pooled URL; session locks require a direct connection.
- APP_URL: the final portal domain, e.g. https://hr.gleuhr.com (no trailing slash). All email and portal links are built from it (`app-url.js`). If unset on Vercel, the project's production domain is used.
- TRAINING_TIMEZONE=Asia/Kolkata
- CRON_SECRET: long random secret, generated during setup
- SMTP_HOST=smtp.gmail.com; SMTP_PORT=587
- SMTP_FROM and SMTP_USER=mizraem@gleuhr.com
- SMTP_PASS: required Google Workspace app password. Set in Vercel Settings > Environment Variables as a sensitive Production variable, then redeploy. Never paste it in chat.
- GEMINI_API_KEY / GEMINI_MODEL: optional AI roleplay. Guided exercises work without it.

`scripts/configure-vercel.mjs` adds the non-secret values (and a new CRON_SECRET) with the Vercel CLI.

## Database setup

Run `migrations/001-state.sql` on the new database (creates `gleuhr_state`; `gleuhr_material_files` is created on first upload). Then restore the `production` row of `gleuhr_state` and the `gleuhr_material_files` table from the old database, or migrate a fresh project once from local JSON (never overwrites an existing production row; does not copy uploaded files):
```
node --env-file=.env.production.local scripts/migrate-cloud.js data/database.json
```

## Mail scheduler

`/api/cron/mail` drains the email queue and escalates tickets open for two hours; it requires `Authorization: Bearer <CRON_SECRET>`. Emails are also sent right after each request, but ticket escalation and recovery of stuck emails only happen when this endpoint is called.
- Vercel Pro/Enterprise: add `{ "path": "/api/cron/mail", "schedule": "* * * * *" }` to `crons` in `vercel.json`.
- Vercel Hobby (daily cron only): call the endpoint every minute from an external scheduler with the Bearer header.

## Deploy

Git: pushes to `main` deploy to Production once the repository is imported in Vercel. CLI:
```
vercel deploy --prod --scope gleuhr
```

Verification: `npm test` runs local workflow tests. `node --env-file=.env.production.local --test tests/cloud.test.js` verifies the real database in an isolated temporary row, then deletes that row. `node --env-file=.env.production.local scripts/verify-production-smtp.mjs` checks SMTP on the deployed portal at APP_URL.
