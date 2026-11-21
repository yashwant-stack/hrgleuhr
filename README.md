# Gleuhr People & Academy — local website

The training workflow from your Sheet and `Code_v8_5.gs`, combined with the supplied Sales Academy. Data stays in this folder on your computer. No Firebase, Google Sheet connection or Vercel deployment is required.

## Start in VS Code

Requires Node.js **22.13 or newer**.

```sh
cd ~/Desktop/hrgleuhr
npm install
npm run dev
```

Open **http://localhost:3000**. On first run, create your HR/admin login. Existing users and data remain when upgrading or restarting. `Ctrl+C` stops the server; `npm start` runs without source-file watching. `START.command` (Mac) and `start.bat` (Windows) also launch the app.

If port 3000 is busy, edit `PORT` and `APP_URL` in `.env`, then restart and use the new port.

## Enable actual emails from mizraem@gleuhr.com

1. If `.env` is missing, copy `.env.example` to `.env`.
2. Enter the account's SMTP app password in `SMTP_PASS` **locally in VS Code**. Do not paste it into chat, commit it to Git or put it in `public/`.
3. The supplied defaults are:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=mizraem@gleuhr.com
SMTP_USER=mizraem@gleuhr.com
SMTP_PASS=your_app_password_here
TRAINING_TIMEZONE=Asia/Kolkata
APP_URL=http://localhost:3000
```

Your Google Workspace account must permit SMTP/app passwords. If your administrator uses a different SMTP relay, use that relay's settings instead. The normal Google login password is not a substitute for an app password. Google's account-security setup is outside the local app.

4. Restart the server, then use **Setup & repair → Verify SMTP**. This checks the connection without sending email.
5. In a trainee's **Handover**, choose **Draft** to save or **Send** to send the actual message. A successful send becomes **Pending**. A failure stays **Draft** and displays the error in **Email delivery**.

Daily reminders run automatically after **09:00 Asia/Kolkata**, once per pending handover per day. Keep the server running and computer awake. Starting after 09:00 runs today's reminders. **Run reminders now** is also available. No reminders can run while the computer/app is stopped.

A new owner needs a website account with the same email. HR/admin creates that under **Users & trainers**. A local `localhost` link is reachable only on the computer running the server; email delivery itself works over the internet. This version is not a multi-device hosted site.

## Training workflow

- **Add trainee:** designation-based Induction and Onboarding rows. Same-name duplicates are rejected. Trainer profile name and current owner are separate fields.
- **Summary:** original dashboard's completion, behavioural/cultural/overall scores, phase day ranges, Q&A ratings, Theory/Practical totals, latest filled feedback and score-based verdict. Final decisions remain with the reviewer.
- **Checklist:** mark covered, save remarks/asset details, record the date and assessor. N/A items appear under **Removed items**. Restore creates a fresh unchecked row, matching the source script.
- **Scores / Assessment:** scores 1–10, answers, and rating points from Lists. Blank ratings clear assessor/date. Blank scores are excluded from averages.
- **Handover:** Draft / Send / Pending / Completed. Sending changes the next phase and owner; missing phase rows are generated. Successful handover completes earlier Pending handovers.
- **Feedback:** multiple rows supported. The latest filled row is used; blank rows are ignored. Drafting Final Feedback or Final Review creates the feedback row immediately.
- **Final Review & Confirmation:** marking the handover Completed closes training and stamps Closed On.
- **Onboard Final Email:** sends to the selected email, CCs the trainee, and closes training only after successful send.
- **Edit details:** name, email, clinic, designation, joining date, trainer, stage, owner, status and Closed On. Name changes keep all linked data. Any changed non-Completed status clears Closed On; On Hold/Dropped has no running day count.
- **Delete trainee:** typed-name confirmation removes the trainee's related training and Academy data. Backups and audit history remain.
- **Templates & lists:** edit checklist, scoring, assessment questions, rating points, designations and other source lists. **Sync trainee rows** adds missing applicable rows without losing completed work or restoring removed topics.
- **Reports:** training-time and departmental insights, Academy progress, CSV export and printing.

## Sales Academy

The same trainee record contains 13 source modules, interactive exercises, a 76-question source bank plus custom questions, six patient role-play scenarios, test history, resources, EOD reports, coaching, evaluations, operations notes, outcomes and printable certificates. Source resource previews are displayed as text; actual PDFs not supplied are not invented.

Guided role-play needs no key. Optional live AI patient conversations use `GEMINI_API_KEY` and `GEMINI_MODEL` from `.env`. They send the practice conversation to Google Gemini; use fictional cases. AI credentials/live responses are not verified in this delivery. Trainer scores are entered explicitly; no fake AI passing scores are generated.

## Data and backups

`data/database.json` contains all local users (password hashes), templates, trainees, records, email delivery history and audit events. Existing data is upgraded in place. Do not delete this file to update the code. Use only one running app instance per data folder.

```sh
npm run backup
```

Backups are timestamped in `backups/`. To restore, stop the server, keep a copy of the current database, replace `data/database.json` with your chosen database backup, and restart. Backups contain private training data; keep them private.

An upgrade backup of the prior version is also placed in `backups/before-parity-*.tar.gz` by this delivery. It contains the previous code and data, excluding dependencies and previous backups.

## Verification and original-workflow mapping

```sh
npm run check
npm test
```

See **PARITY.md** for the behaviour-by-behaviour mapping and verification limits. Tests compare generated rows directly with the original Apps Script for 11 designation cases × all 10 stages, plus workflow, mail-failure, scheduler, closure, permissions and persistence tests. Tests use isolated temporary databases and simulated email delivery; they never send real email or edit your data.

## Main source files

```text
server.js                 HTTP API, authentication, Academy endpoints
training-workflow.js      Source rules, generation, ordering and calculations
workflow-service.js       Training mutations, handovers, scheduler, templates
mailer.js                 SMTP configuration and full handover email content
store.js                  Atomic JSON writes and password hashing
public/app.js             Website screens and Academy interactions
public/workflow-ui.js     Summary, handovers, feedback, templates, setup
public/style.css          Responsive layout and print styles
seed/training.json        Supplied sheet templates, without old trainee data
seed/workflow.json        Constants extracted from the original Apps Script
seed/academy.json         Supplied Academy curriculum and practice material
reference/Code_v8_5.gs     Original script used by the direct parity tests
```

The original Google Sheet is not modified and there is no automatic sheet sync. This edition is local; later Vercel deployment needs persistent hosted storage and production authentication/session configuration.

SMTP transport reference: https://nodemailer.com/smtp
Gemini API reference: https://ai.google.dev/api/generate-content
