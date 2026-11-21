# Hosted deployment

Vercel project: hrgleuhr, team rahul-43f8.
Production URL: https://hrgleuhr.vercel.app

Local use stays unchanged (`npm run dev`); local and cloud data are separate after the initial migration. The first migration preserves your existing admin account/password. Never upload data/, backups/, or .env files.

Hosted requests use Neon Postgres via DATABASE_URL_UNPOOLED. A direct connection holds a session advisory lock across each request to serialize updates and prevent lost writes. The small-team application stores its existing model in one private JSONB row. Login sessions, rate limits and quiz attempts persist between function instances. Responses are released only after saving. Sending email is saved before contacting SMTP; interruption becomes Delivery uncertain and requires review before retrying. Large/high-concurrency deployments should migrate to per-entity tables and an independent mail queue.

Production environment variables:
- DATABASE_URL_UNPOOLED: supplied by the connected Neon integration. Do not substitute the pooled URL; session locks require a direct connection.
- APP_URL=https://hrgleuhr.vercel.app
- TRAINING_TIMEZONE=Asia/Kolkata
- CRON_SECRET: private, generated during setup
- SMTP_HOST=smtp.gmail.com; SMTP_PORT=587
- SMTP_FROM and SMTP_USER=mizraem@gleuhr.com
- SMTP_PASS: required Google Workspace app password. Set in Vercel Settings > Environment Variables as a production Secret, then redeploy. Never paste it in chat.
- GEMINI_API_KEY: optional AI roleplay key, production Secret. Guided exercises work without it.

Daily reminders use Vercel Cron at 03:30 UTC (09:00 India). Hobby hosting may run within the following hour. SMTP must be configured; a missing configuration produces a clear failure instead of claiming delivery. A stopped local computer does not affect cloud jobs. Cron requests require CRON_SECRET.

Deploy:
```
vercel deploy --prod --scope rahul-43f8
```

To migrate a fresh project once (never overwrites an existing production row):
```
node --env-file=.env.production.local scripts/migrate-cloud.js data/database.json
```

Verification: `npm test` runs local workflow tests. `node --env-file=.env.production.local --test tests/cloud.test.js` verifies the real database in an isolated temporary row, then deletes that row.
