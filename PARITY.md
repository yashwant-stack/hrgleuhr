# Training Sheet / Apps Script behaviour mapping

Reference: supplied `Code_v8_5.gs` plus the supplied Training workbook templates. The existing Sales Academy remains in the same trainee record. Local data is not synced to Google Sheets.

| Original behaviour                                                                        | Website equivalent                                                 | Verification                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Add trainee; initial Induction + Onboarding                                               | Add trainee; source designation filtering                          | Direct comparison with original `addMissing` / `addMissingAssessment` |
| Custom designation, inherited checklist; unknown/Other gets all matching phase items      | Lists + custom designation mapping                                 | 11 designation cases × 10 stages                                      |
| Phase from current stage and handover history                                             | Source `phasesFor` semantics in Sync                               | Direct comparison with source                                         |
| Checklist templates; blank/legacy phases, type inference                                  | Editable templates; same phase resolution / type rule              | Direct comparison plus blank custom-module case                       |
| No duplicate checklist / score / assessment rows                                          | Source composite-key behaviour                                     | Repeated phase and Sync tests                                         |
| N/A logs who/when; Restore creates a fresh unchecked row                                  | Removed items + Restore                                            | Integration test                                                      |
| Theory before Practical, phase/module/template order                                      | Source-derived ordering, without rewriting IDs                     | Implemented in `syncTrainee`                                          |
| Checkbox stamps/clears coverage date and assessor; joining date changes training day      | Date/assessor updated on checkbox transition; Day 1 = joining date | Integration + India midnight boundary                                 |
| Scores 1–10; blank scores excluded from averages                                          | Same validation, blank semantics                                   | Integration                                                           |
| Assessment rating points from Lists; clearing rating clears assessor/date                 | Editable rating map and metadata                                   | Integration                                                           |
| Feedback row immediately on selecting Final Feedback / Final Review                       | Draft handover creates blank row immediately                       | UI + integration                                                      |
| Latest filled feedback, ignoring trailing blanks                                          | Multiple editable feedback rows; latest filled summary             | Integration                                                           |
| Handover Draft / Send / Pending / Completed                                               | Draft/save, Send email, status controls                            | UI + integration                                                      |
| Normal send updates stage/items before email; failure stays Draft                         | Same order; failure displayed in Email delivery                    | Simulated SMTP success/failure                                        |
| Successful new handover completes earlier Pending handovers                               | Same transition                                                    | Integration                                                           |
| Daily reminders at 09:00; only Pending; once per day on success                           | Automatic local scheduler, Asia/Kolkata                            | Time-boundary and deduplication tests                                 |
| Completing Final Review closes training                                                   | Update handover status → Completed                                 | Integration                                                           |
| Onboard Final Email to owner, CC trainee; closes only on successful send                  | SMTP final email and closure                                       | Simulated SMTP failure/success + CC check                             |
| Handover email contains scores, modules, Q&A, feedback, note and next-step guide          | Full email body generated from current record                      | Payload checks                                                        |
| Completed stamps Closed On; other changed statuses clear it                               | Same status behaviour; manual closure-date override                | Integration                                                           |
| Training Days = Closed On − Joining, else today − Joining only for Active                 | Same formula, no extra day; blank when not running                 | Integration                                                           |
| Per-topic Training Day = covered date − joining date + 1                                  | Same convention in configured local timezone                       | Date-boundary test                                                    |
| Dashboard phases, scores, Q&A ratings, Theory/Practical, day ranges and verdict           | Summary tab                                                        | Source formula translation + UI inspection                            |
| Insights totals, completed/active averages, fastest/slowest, HR/Sales/Ops completion, Q&A | Reports                                                            | Calculated from saved records, no sample results                      |
| Rename preserves linked data                                                              | Stable trainee ID links; name editable                             | Integration                                                           |
| Delete trainee and dependent data                                                         | Typed-name confirmation; cascading removal                         | Integration                                                           |
| Edit template rows / lists / question bank                                                | Templates & lists                                                  | CRUD implementation and Sync test                                     |
| Sync / setup check / rebuild dashboards                                                   | Sync trainee rows / Setup & repair / live summaries                | UI + tests                                                            |

## Local-runtime requirements

- SMTP credentials must be configured to send real email. Sender is configured as `rahul.verma@gleuhr.com`. No real mailbox message has been sent or delivery-verified during implementation.
- The app process and computer must remain running/awake for automatic reminders. If started after 09:00, it processes that day's pending reminders once. A stopped computer cannot execute the original cloud trigger.
- Google Sheet editor-sharing is replaced by website accounts and assignment permissions, preserving the requested HR/admin versus assigned-trainer access. An emailed recipient needs a local website account with the same email to sign in. `localhost` links work only on the computer running this app; multi-device access requires separately configuring a reachable server address and secure network hosting.
- Sheet-specific mechanics (cell selection, formatting, formulas, tab creation and row-change triggers) are represented by website forms, calculations and buttons. They do not require a Google Sheet to exist.
- Stored trainee IDs are intentionally stable, preventing name changes or sorting from breaking relationships. Deleting a trainee removes their current local data. Audit history and your separate backups remain.

## Evidence and limits

Run `npm test`. Direct parity tests execute the original supplied Apps Script generation functions in an isolated adapter, then compare every generated checklist, scoring and assessment key for 11 designations across all 10 stages. Other tests exercise workflow, permission, persistence, date, closure and failure behaviour. Email transport is injected in these tests; external SMTP acceptance/delivery still needs to be checked with the configured account.

Passing these tests is evidence for the behaviours listed above, not a claim that every possible spreadsheet edit or live external-service outcome has been exhaustively tested.

## Direct phase handover (30 October 2026)

The website now defaults to an explicit "Hand over without email" action, as requested for skipping directly to a selected phase. This updates the current stage and owner, generates that phase's items, and completes earlier pending handovers without requiring SMTP. The new handover is Pending and visibly states that its handover email was not sent. Save draft still leaves the current stage unchanged; Hand over and send email retains the original Apps Script send behavior. Onboard Final Email still requires successful email delivery before closing training. Regression coverage includes Induction → Operations → CRM, owner access transfer, preserved coverage, and persistence after restart.
