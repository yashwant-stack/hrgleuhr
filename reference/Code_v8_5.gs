/**
 * TRAINEE TRAINING MODULE v8  -  Google Sheets + Apps Script
 * ----------------------------------------------------------
 * PHASES (Handover > Next Step dropdown):
 *   Induction > Onboarding > Sales Training > Operations Training > Assessment > Final Feedback
 *   > Final Review & Confirmation
 *
 * HOW IT WORKS
 *  1. Add a trainee. Induction + Onboarding checklist/score rows are created automatically.
 *  2. Handover tab: add a row (Trainee, Next Step = phase, Owner name + email, Status = Send).
 *     The owner gets an email + edit access, and that phase's checklist/score rows are created.
 *  3. The owner trains, ticks the Checklist, enters Scores, then adds a NEW row in the Handover tab
 *     to pass the trainee to the next person. Their own earlier "Pending" row turns "Completed"
 *     automatically, so their reminders stop.
 *  4. Repeat until Final Review & Confirmation.
 *
 * HOW TO UPDATE YOUR EXISTING SHEET
 *  1. Extensions > Apps Script > delete old code > paste this file > Save.
 *  2. Select function  setupTrainingModule  > Run.  (Your trainees, ticks, scores and handovers are kept.)
 *  3. Reload the sheet.
 *
 * v8.5
 *  - CRM & Tech Training now uses the full CRM technical checklist (244 items, 47 modules) by designation:
 *    All roles get "CRM Basics"; Receptionist, Therapist, Doctor, Counsellor, Branch Manager and Accounts
 *    get their own CRM modules (Regional Head gets the Branch Manager CRM items).
 *    The general CRM items from v8.3 are replaced; Lead CRM and the other tools (HRMS, Airtable, Zoho,
 *    G-Money, prescription portal) are kept, each for the designations that use them.
 *  - New designations Therapist, Doctor and Accounts are added to the Lists tab, so they appear in Add Trainee.
 *  - Unticked old general CRM items are removed from trainees' checklists once; ticked ones are kept.
 *
 * v8.4
 *  - Feedback tab: Trainee column is a dropdown of trainees.
 *  - Dashboard Final Feedback now shows the latest FILLED feedback row for the trainee (blank rows are ignored,
 *    extra spaces in the name are ignored), and says "Waiting for feedback" as soon as the trainee is handed
 *    over for Final Feedback.
 *  - Picking "Final Feedback" (or Final Review) as Next Step in Handover creates the trainee's Feedback row
 *    straight away, even before Status = Send.
 *
 * v8.3
 *  - CRM & Tech Training checklist now has separate "Clinic CRM training" and "Lead CRM training" items.
 *    Trainees who already reached that step get the new items on the next Sync.
 *
 * v8.2
 *  - Handover > Next Step: new steps "Asset Allotment", "CRM & Tech Training" and "Onboard Final Email".
 *    Asset Allotment and CRM & Tech Training get their own checklist items (Checklist_Template, editable).
 *    Onboard Final Email sends a "training complete / onboarding confirmed" email to the Next Owner Email
 *    (CC the trainee's email), marks the trainee Completed and needs no reminders or sheet access.
 *
 * v8.1
 *  - Checklist column J now reads "Day 2" (heading "Training Day") instead of a bare number.
 *  - Trainees tab: new column O "Delete Trainee" tick + menu "Delete Trainee" - removes the trainee
 *    and all their Checklist / Scores / Handover / Assessment / Feedback rows (asks first).
 *
 * v8 CHANGES
 *  - Deleting a trainee now cleans their data automatically (Checklist, Scores, Handover, Assessment,
 *    Removed_Items, Feedback) - when the row is deleted or the name cell is cleared.
 *    Renaming a trainee (typing over the name) moves all their data to the new name instead of deleting it.
 *  - Days: Dashboard has a "Training Days" card, the day range per phase, and a "Day No." column.
 *    Checklist tab: new column J "Day No." = training day the item was ticked (Day 1 = joining date).
 *  - Handover > Next Step: new options "Assessment" (owner rates the Q&A answers for every department)
 *    and "Final Feedback" (owner fills the new Feedback tab: rating, recommendation, strengths,
 *    areas to improve, comments). Final feedback shows on the Dashboard and in the final review email.
 *  - Add Trainee: choosing "Other" opens a box to type the designation and pick which checklist it gets.
 *    The new designation is saved in the Lists tab, so it appears in the dropdown next time.
 *  - Theory and Practical are separated: the Checklist tab is sorted per trainee with all Theory items first,
 *    then all Practical items (colour-coded), and the Dashboard detail shows them as two sections.
 *
 * Phase of each topic is set in Checklist_Template / Scoring_Template, column C "Phase".
 * Blank Phase = created for every trainee from day 1.
 */

// ===================== CONFIG =====================
const SHEETS = {
  DASH: 'Dashboard', INS: 'Insights', TR: 'Trainees', CL: 'Checklist', SC: 'Scores',
  ASM: 'Assessment', FB: 'Feedback', QB: 'Question_Bank', REM: 'Removed_Items',
  HO: 'Handover', CT: 'Checklist_Template', ST: 'Scoring_Template', LI: 'Lists'
};

const STAGES = ['Induction', 'Onboarding', 'Asset Allotment', 'CRM & Tech Training', 'Sales Training',
                'Operations Training', 'Assessment', 'Final Feedback', 'Final Review & Confirmation',
                'Onboard Final Email'];
const ALWAYS_PHASES = ['Induction', 'Onboarding'];   // rows created when trainee is added
const RECOMMENDATIONS = ['Confirm', 'Extend Training', 'Not Confirmed'];
const DAY_FMT = '"Day "0';          // Checklist Training Day shows as "Day 2" (Day 1 = joining date)
const DEL_COL = 15;                 // Trainees column O = Delete Trainee tick

const OPS_MODULES = [
  'Ops: Opening & Hygiene',
  'Ops: Stock & Requisition',
  'Ops: Reporting & Issues',
  'Ops: Petty Cash & Cash Recon',
  'Ops: Patient Records & CRM',
  'Ops: Machines, CCTV & Security',
  'Ops: Staff & Roster',
  'Ops: Practical Sign-off'
];
const SALES_MODULES = [
  'Sales: Role, KRA & KPI',
  'Sales: Six-Step Consultation',
  'Sales: Package & Pricing Math',
  'Sales: Treatment Catalogue',
  'Sales: Objection Handling',
  'Sales: Close & Follow-up',
  'Sales: Cross-sell & Upsell',
  'Sales: Hard-Line Rules & Escalation',
  'Sales: Practical Sign-off'
];

// ---- CRM technical checklist (from CRM_Technical_Checklist.xlsx, Gleuhr Guide drafts 27 Oct 2026)
//      [module, designations, [[T/P, topic], ...]]   T = Theory, P = Practical. Phase = CRM & Tech Training.
const CRM_TECH = [
  ["CRM Basics (all roles)", "All", [
    ["P", "Sign in and sign out of the CRM"],
    ["P", "Find your way around the menu and the top bar (search, How to use, Sign out)"],
    ["P", "Use the \"How to use\" guide and its search words (Hindi and English words work)"],
    ["T", "\"Couldn't load...\" means the list failed to load, not that it is empty: press Retry"],
    ["T", "Read the message when the app refuses something: it says what to do next"]
  ]],
  ["CRM Reception: Check-in", "Receptionist", [
    ["P", "Check in a patient booked for today"],
    ["P", "Check in someone with no booking (an existing patient)"],
    ["P", "Add a brand-new patient"],
    ["P", "Check in a patient who missed an earlier visit"],
    ["P", "Check in someone who is booked for a later day but came today"]
  ]],
  ["CRM Reception: The consultation fee and old patients", "Receptionist", [
    ["P", "Take the consultation fee for a new patient"],
    ["P", "Use money she already paid (an advance or token) toward the fee"],
    ["P", "Waive the consultation fee"],
    ["P", "Check in an old patient whose record is not on the CRM"],
    ["P", "Answer \"Sessions from before\" for an imported patient"]
  ]],
  ["CRM Reception: Counsellors, therapists and the floor", "Receptionist", [
    ["P", "Pick or change the counsellor at check-in"],
    ["P", "Send a counsellor-only patient to the doctor too"],
    ["P", "Undo a check-in done by mistake"],
    ["P", "Give a signed-off treatment to a therapist"],
    ["P", "Pick who numbs a patient"],
    ["P", "Plan the therapists' day on the planner"],
    ["P", "See who is waiting and who is late"]
  ]],
  ["CRM Reception: Collecting payments", "Receptionist", [
    ["P", "Collect a payment the counsellor prepared"],
    ["P", "Take a card payment on the machine"],
    ["P", "Record a payment she made another way (manual payment)"],
    ["P", "Split one payment two ways"],
    ["P", "Cancel a payment link so she can pay at the desk"],
    ["P", "Send a payment back when she is paying a different amount"],
    ["P", "Fix a wrong cash or card figure after collecting"],
    ["P", "Resend a receipt"]
  ]],
  ["CRM Reception: Products and online orders", "Receptionist", [
    ["P", "Sell a product at the counter"],
    ["P", "Hand over a product order the counsellor made"],
    ["P", "Exchange or take back a product"],
    ["P", "Hand over an online order a customer collects at the counter"],
    ["P", "Send a Rapido box"]
  ]],
  ["CRM Reception: Bookings, records and help", "Receptionist", [
    ["P", "Change the date of a booking"],
    ["P", "Book a next visit from the record"],
    ["P", "Take a balance payment after the visit closed"],
    ["P", "Look at a past day's check-ins"],
    ["P", "Raise a ticket or leave a note on a patient"],
    ["P", "Report a bug"]
  ]],
  ["CRM Therapist: My list and the sign-off", "Therapist", [
    ["P", "See who I have to treat next"],
    ["P", "Know the doctor has signed off"]
  ]],
  ["CRM Therapist: Numbing", "Therapist", [
    ["P", "Apply numbing to my patient"],
    ["P", "Numb a patient someone picked me for"],
    ["T", "Why can't I start — the line says \"<name> to numb\""],
    ["P", "See how long until the skin is ready"],
    ["P", "Cancel numbing"],
    ["P", "Start early, before the numbing timer ends"]
  ]],
  ["CRM Therapist: Starting a treatment", "Therapist", [
    ["P", "Find a free room"],
    ["P", "Start a treatment"],
    ["P", "Take the machine settings photo"],
    ["P", "Take before photos"]
  ]],
  ["CRM Therapist: Recording and completing", "Therapist", [
    ["P", "Record the units, ml or threads I used"],
    ["P", "Write a note for the doctor"],
    ["P", "Complete a session"],
    ["P", "Complete before the doctor's time is up"],
    ["P", "End a timed treatment when my phone rings \"time up\""],
    ["P", "Apply numbing for her next session from the Complete step"]
  ]],
  ["CRM Therapist: Mistakes and changes", "Therapist", [
    ["P", "Undo a start I pressed by mistake"],
    ["P", "Mark a treatment \"Not done today\""],
    ["P", "Save a session from an earlier day"]
  ]],
  ["CRM Therapist: History and photos", "Therapist", [
    ["P", "Open a patient's history"],
    ["P", "Flag a photo of the wrong patient"]
  ]],
  ["CRM Therapist: Breaks and alarms", "Therapist", [
    ["P", "Ask for a break"],
    ["P", "Come back from a break"],
    ["P", "Stop the alarm"],
    ["P", "Acknowledge a \"patient waiting\" alert"]
  ]],
  ["CRM Therapist: Your day and the plan", "Therapist", [
    ["P", "Check what I have done today"],
    ["P", "Close an older session that shows \"Close\""],
    ["P", "Find a patient on my list quickly"],
    ["P", "See the doctor's plan for a session"],
    ["P", "Check the patient's allergies before I start"]
  ]],
  ["CRM Therapist: Phone, camera and alarms", "Therapist", [
    ["P", "Turn on alarm sound at the start of every shift"],
    ["P", "Install the Gleuhr Clinic phone app so alarms ring even when the phone is locked"],
    ["P", "Allow the camera for the machine settings photo (phone Settings > Apps > Gleuhr Clinic > Permissions > Camera)"]
  ]],
  ["CRM Doctor: Getting around", "Doctor", [
    ["P", "Find a patient quickly"],
    ["P", "Read a patient's record"]
  ]],
  ["CRM Doctor: New patients — the consult", "Doctor", [
    ["P", "See a new patient"],
    ["P", "Write the treatment plan"],
    ["P", "Print a prescription"],
    ["P", "Finish a consult I started earlier"]
  ]],
  ["CRM Doctor: Returning patients — the sign-off", "Doctor", [
    ["P", "Sign off today's session"],
    ["P", "Record the skin result"],
    ["P", "Change a session after I signed it off"],
    ["P", "Undo a sign-off"],
    ["P", "Record that there is no treatment today"],
    ["P", "Book the next appointment"],
    ["P", "Assign or change the therapist"],
    ["P", "Open the session count for a package from the old system"],
    ["P", "Correct a wrong session count"],
    ["P", "Add the real treatment to an old customised plan"],
    ["P", "Record a patient's paper card when she has no package"]
  ]],
  ["CRM Doctor: Your own treatments", "Doctor", [
    ["P", "Perform a treatment myself"],
    ["P", "Tick my own treatment done without the session form"],
    ["P", "Choose who puts on the numbing cream"],
    ["P", "Close a therapist's logged session"]
  ]],
  ["CRM Doctor: After the treatment", "Doctor", [
    ["P", "Do the post-treatment review"],
    ["T", "What if nothing was prescribed for her routine"],
    ["P", "Close the visit from my side"]
  ]],
  ["CRM Doctor: The huddle and calls", "Doctor", [
    ["P", "Work the Morning Huddle"],
    ["P", "Write a recovery plan for an at-risk patient"],
    ["P", "Record whether I pitched in the chair"],
    ["P", "Make a check-in call"],
    ["P", "See the calls I missed"]
  ]],
  ["CRM Doctor: Tickets, team and the end of the day", "Doctor", [
    ["P", "Raise a ticket"],
    ["P", "Work the tickets sent to me"],
    ["P", "Mark a colleague absent today"],
    ["P", "Close my day"],
    ["P", "Read a therapist's deviation"],
    ["P", "Answer a patient-waiting alert"],
    ["P", "Book a next appointment for a patient from the old system"],
    ["P", "Look up who was treated on a past date"],
    ["P", "Report a problem with the app"]
  ]],
  ["CRM Doctor: Stock when you prescribe", "Doctor", [
    ["P", "See if a product is in stock when I prescribe it"]
  ]],
  ["CRM Counsellor: Today and the visit", "Counsellor", [
    ["P", "See who is checked in and waiting for me"],
    ["P", "Open a new patient's visit to build her sale"],
    ["P", "Build a package from the doctor's plan"],
    ["P", "Send the build to reception"],
    ["P", "Restage a build that reception sent back"],
    ["P", "Sell a single session instead of a package"],
    ["P", "Sell products on the visit"]
  ]],
  ["CRM Counsellor: Tokens, money on file and ongoing patients", "Counsellor", [
    ["P", "Take a token"],
    ["P", "Send a token payment link (she is not in the clinic)"],
    ["P", "Use a token she already paid"],
    ["P", "Change what a token is for"],
    ["P", "Apply an advance or store credit to a payment"],
    ["P", "Collect an instalment from an ongoing patient"],
    ["P", "Add a new treatment for an ongoing patient"],
    ["P", "Add a sale after I closed today's visit"]
  ]],
  ["CRM Counsellor: Closing the visit", "Counsellor", [
    ["P", "Close a visit"],
    ["P", "Close a visit when she bought a package and gets treatment today"],
    ["P", "Close a first consult where she bought nothing"],
    ["P", "Close a visit where she only bought products"],
    ["P", "Close a visit when nothing happened (ongoing patient)"],
    ["P", "Close a visit where she paid a token"],
    ["P", "Close an old visit from an earlier day"],
    ["T", "Why can't I close the visit yet"]
  ]],
  ["CRM Counsellor: Calls and follow-ups", "Counsellor", [
    ["P", "Work my follow-up calls"],
    ["T", "What do I do when the patient does not answer"],
    ["P", "Add another follow-up during a call"],
    ["P", "Record a cross-sell I pitched on a call"],
    ["P", "Book her next visit from a call"],
    ["P", "Confirm tomorrow's visits"],
    ["P", "Hard-close a patient"],
    ["P", "Chase a patient's balance"]
  ]],
  ["CRM Counsellor: Payment links and money on the record", "Counsellor", [
    ["P", "Send a payment link for an instalment"],
    ["T", "She wants to pay at the desk, but a link is already out. What do I do"],
    ["P", "Record a payment she sent by bank transfer, UPI to the clinic, or cash outside the desk"],
    ["P", "Check whether accounts verified a payment I recorded"],
    ["P", "Change a package's price"],
    ["P", "Correct a treatment on a package"]
  ]],
  ["CRM Counsellor: Bookings, products, the record", "Counsellor", [
    ["P", "Book an appointment"],
    ["P", "Move or cancel a booking"],
    ["P", "Ring up a counter product sale (no visit)"],
    ["P", "Raise a ticket"],
    ["P", "Close a ticket that someone resolved for me"],
    ["P", "Log a call I made from my own phone"],
    ["P", "Add a note on a patient"]
  ]],
  ["CRM Counsellor: The huddle and the day end", "Counsellor", [
    ["P", "Run my part of the Morning Huddle"],
    ["P", "Close my day"]
  ]],
  ["CRM Counsellor: Stock when you sell", "Counsellor", [
    ["P", "See if a product is in stock before I sell it"]
  ]],
  ["CRM Branch Manager: Approvals", "Branch Manager, Regional Head", [
    ["P", "Approve an item waiting on me"],
    ["P", "Send an item back"],
    ["T", "Which kinds of item come to me, and what does approving each one do"],
    ["T", "Why can't I decide a cash correction or an exchange"],
    ["P", "See what I raised myself, and where it stands"],
    ["P", "See what was decided this week"],
    ["P", "Mark myself away for the day"]
  ]],
  ["CRM Branch Manager: Exit meetings, amount checks and rejected advances", "Branch Manager, Regional Head", [
    ["P", "Run an exit meeting"],
    ["T", "What if I did not meet the patient"],
    ["P", "Confirm an exit meeting the counsellor logged"],
    ["T", "What about my own patient who did not buy"],
    ["P", "Read an amount-check flag"],
    ["T", "What do I do with a rejected advance"]
  ]],
  ["CRM Branch Manager: Cash and the bank slip", "Branch Manager, Regional Head", [
    ["P", "Upload the bank deposit slip"],
    ["P", "Fix a wrong deposit slip"]
  ]],
  ["CRM Branch Manager: Your team today", "Branch Manager, Regional Head", [
    ["P", "Mark a counsellor or receptionist absent today"],
    ["P", "See which counsellor is behind today"],
    ["P", "Check calls saved as done with no phone record"],
    ["P", "See calls that were late or missed"]
  ]],
  ["CRM Branch Manager: Targets and handing over a desk", "Branch Manager, Regional Head", [
    ["P", "Draft and submit my team's targets"],
    ["P", "Change targets after submitting them"],
    ["P", "Hand over a leaving counsellor's desk"]
  ]],
  ["CRM Branch Manager: Sales, stock and the floor", "Branch Manager, Regional Head", [
    ["P", "See today's sales for my clinic"],
    ["P", "See every payment taken at my clinic"],
    ["P", "See discounts given over the offer"],
    ["P", "Check stock and mark a shortage ordered"],
    ["P", "See who is waiting too long on the floor"],
    ["P", "Look up who checked in on a past day"],
    ["P", "See pickups and Rapido orders at my clinic"]
  ]],
  ["CRM Branch Manager: The day lock", "Branch Manager, Regional Head", [
    ["P", "Lock the day"],
    ["T", "What does each End of Day check mean, and who clears it"],
    ["P", "Count the cash drawer"],
    ["P", "Lock a day I missed"],
    ["P", "Reopen a day I locked by mistake"],
    ["T", "What happens to money that comes in after I lock"]
  ]],
  ["CRM Branch Manager: Your own counsellor desk", "Branch Manager, Regional Head", [
    ["P", "See one counsellor's list on my counsellor desk"],
    ["T", "Can I hard-close a patient"],
    ["T", "Where do I do my own patient work (calls, closing a visit, payments)"],
    ["P", "Add an appointment"],
    ["P", "Read my counsellors' audit results"]
  ]],
  ["CRM Accounts: Remote payments", "Accounts", [
    ["P", "Verify a remote UPI instalment"],
    ["P", "Mark a claim Not verified"],
    ["T", "Why can't I verify this claim? It says \"You recorded this\""],
    ["T", "One bank transfer paid for two patients. How do I verify both"],
    ["T", "The server says the reference is \"already verified\". What now"],
    ["P", "Verify a booking deposit"],
    ["P", "Look up a claim that was already decided"]
  ]],
  ["CRM Accounts: Invoicing: sending and failures", "Accounts", [
    ["P", "Send a payment for invoicing"],
    ["P", "Find one payment"],
    ["P", "Invoice consultation fees"],
    ["T", "A request says \"Refused\". What do I do"],
    ["T", "A request says \"No answer\". What do I do"],
    ["P", "Record a Tally invoice number by hand"]
  ]],
  ["CRM Accounts: Invoicing: held, mapped and reversed", "Accounts", [
    ["P", "Bill a payment on Manual invoices"],
    ["P", "Read the payment panel before sending"],
    ["T", "The row says no Tally name is mapped for a treatment. How do I fix it"],
    ["T", "A product line is missing its HSN code or tax rate. What do I do"],
    ["P", "Record a credit note for a payment reversed after invoicing"],
    ["T", "What are \"Clinic pickup\" and \"Rapido\" under Which book"],
    ["P", "Download a list"]
  ]],
  ["CRM Accounts: Receipts", "Accounts", [
    ["P", "Give a payment its clinic receipt number"],
    ["T", "A patient's WhatsApp receipt failed. How do I send it again"],
    ["T", "WhatsApp refused the patient's number. What now"]
  ]],
  ["CRM Accounts: Bank reconciliation: upload and match", "Accounts", [
    ["P", "Upload the day's bank statements and processor files"],
    ["P", "Work a bank credit that says \"Confirm match\""],
    ["T", "A credit says \"No CRM payment\". How do I decide it"],
    ["P", "Send a bulk settlement's group receipt"],
    ["T", "A credit says \"Unknown TID\" or \"Unknown MID\". What do I do"],
    ["T", "A credit says \"Doesn't add up\" or \"Check charges\". What does it mean"]
  ]],
  ["CRM Accounts: Bank reconciliation: unmatched, the lock and Tally", "Accounts", [
    ["P", "Use the Unmatched page"],
    ["P", "Lock a bank reconciliation day"],
    ["T", "Tally refused a receipt, or no success code came back. What do I do"],
    ["T", "A credit was reversed by the bank, or its CRM payment changed. What do I do"],
    ["T", "I later found who paid a Suspense credit. How do I cover it"],
    ["P", "Check payments that have a receipt but no invoice"],
    ["P", "See every Tally receipt made from bank reconciliation"]
  ]],
  ["CRM Accounts: Money on file, closing the books and corrections", "Accounts", [
    ["P", "See what money is held on tokens"],
    ["P", "See where one token was spent"],
    ["P", "Mark an invoice received on Reconciliation"],
    ["T", "A collected amount is wrong. How do I fix it"],
    ["T", "A list says \"Couldn't load…\". What do I do"],
    ["P", "See how many payments a list holds, and what they add up to"]
  ]]
];
const CRM_TECH_MODULES = CRM_TECH.map(b => b[0]).filter((m, i, a) => a.indexOf(m) === i);

// Which modules / score categories belong to which phase (dashboard is built from this)
const PHASES = [
  { stage: 'Induction',           modules: ['Induction', 'Company Policy'] },
  { stage: 'Onboarding',          modules: ['Behavioral Discipline', 'Cultural Fit'] },
  { stage: 'Asset Allotment',     modules: ['Asset Allotment'] },
  { stage: 'CRM & Tech Training', modules: ['CRM & Tech Training'].concat(CRM_TECH_MODULES), dash: ['CRM*'] },
  { stage: 'Sales Training',      modules: SALES_MODULES },
  { stage: 'Operations Training', modules: OPS_MODULES }
];
const SCORE_CATEGORIES = ['Behavioral', 'Cultural Fit', 'Sales Skills', 'Ops Knowledge', 'Ops Execution'];
const CAT_PHASE = { 'Behavioral': 'Onboarding', 'Cultural Fit': 'Onboarding', 'Sales Skills': 'Sales Training',
                    'Ops Knowledge': 'Operations Training', 'Ops Execution': 'Operations Training' };
const MODULES = [].concat.apply([], PHASES.map(p => p.modules));
const MODULE_PHASE = {};
PHASES.forEach(p => p.modules.forEach(m => { MODULE_PHASE[m] = p.stage; }));

const LEGACY_STAGES = { 'Role / Department Training': 'Operations Training',
                        'Behavioral & Cultural Assessment': 'Onboarding',
                        'Company Policy': 'Induction' };

const REMINDER_HOUR = 9;               // daily reminder time (script time zone)
const SHARE_SHEET_WITH_OWNER = true;   // give each next owner EDIT access (needed to tick, score and hand over)
const COMPANY = 'Gleuhr Wellness';

const DEFAULT_CHECKLIST = [
  ['Induction', 'Company introduction & history'],
  ['Induction', 'Vision, mission & core values'],
  ['Induction', 'Clinics network & skincare product line overview'],
  ['Induction', 'Organisation structure & key contacts'],
  ['Induction', 'Clinic / office tour'],
  ['Induction', 'HRMS login & attendance process'],
  ['Induction', 'Meet the team'],
  ['Company Policy', 'Code of conduct'],
  ['Company Policy', 'Attendance & leave policy'],
  ['Company Policy', 'Dress code & grooming'],
  ['Company Policy', 'POSH policy'],
  ['Company Policy', 'Data privacy & confidentiality'],
  ['Company Policy', 'Salary, PF & payroll process'],
  ['Company Policy', 'IT & asset usage policy'],
  ['Behavioral Discipline', 'Client / patient handling etiquette'],
  ['Behavioral Discipline', 'Communication & email etiquette'],
  ['Behavioral Discipline', 'Conflict handling'],
  ['Behavioral Discipline', 'Escalation matrix'],
  ['Behavioral Discipline', 'Workplace discipline & punctuality'],
  ['Cultural Fit', 'Values scenario discussion'],
  ['Cultural Fit', 'Team interaction observation'],
  ['Cultural Fit', 'One-to-one feedback session'],
  ['Cultural Fit', 'Trainer review & observations']
];
const DEFAULT_SCORING = [
  ['Behavioral', 'Punctuality & discipline'],
  ['Behavioral', 'Communication skills'],
  ['Behavioral', 'Professionalism & grooming'],
  ['Behavioral', 'Attitude & initiative'],
  ['Behavioral', 'Accountability'],
  ['Behavioral', 'Adaptability'],
  ['Cultural Fit', 'Alignment with company values'],
  ['Cultural Fit', 'Teamwork & collaboration'],
  ['Cultural Fit', 'Respect for process & hierarchy'],
  ['Cultural Fit', 'Willingness to learn'],
  ['Cultural Fit', 'Empathy & client-first mindset']
];

// ---- Asset Allotment + CRM & Tech Training checklists   [module, topic, type]  (all designations)
const ASSET_CHECKLIST = [
  ['Asset Allotment', 'Employee ID card issued', 'Practical'],
  ['Asset Allotment', 'Uniform / dress kit issued', 'Practical'],
  ['Asset Allotment', 'Laptop / system allotted (write serial no. in Remarks)', 'Practical'],
  ['Asset Allotment', 'Mobile phone / SIM allotted (if applicable)', 'Practical'],
  ['Asset Allotment', 'Official email ID created', 'Practical'],
  ['Asset Allotment', 'Clinic keys / locker allotted', 'Practical'],
  ['Asset Allotment', 'Asset handover form signed by trainee', 'Practical'],
  ['Asset Allotment', 'Asset usage & return policy explained', 'Theory']
];
// Lead CRM + other tools (kept from v8.3)   [module, topic, type, designations]
const CRM_CHECKLIST = [
  ['CRM & Tech Training', 'Data security: passwords, logout, never share logins', 'Theory', 'All'],
  ['CRM & Tech Training', 'Lead CRM training: lead sources, stages & statuses', 'Theory', 'Counsellor, Branch Manager, Regional Head, Receptionist'],
  ['CRM & Tech Training', 'Lead CRM training: login & my-leads view', 'Practical', 'Counsellor, Branch Manager, Regional Head, Receptionist'],
  ['CRM & Tech Training', 'Lead CRM training: call logging, remarks & follow-up dates', 'Practical', 'Counsellor, Branch Manager, Regional Head, Receptionist'],
  ['CRM & Tech Training', 'Lead CRM training: booking an appointment from a lead', 'Practical', 'Counsellor, Branch Manager, Regional Head, Receptionist'],
  ['CRM & Tech Training', 'Lead CRM training: converting a lead to a clinic patient (no duplicates)', 'Practical', 'Counsellor, Branch Manager, Regional Head, Receptionist'],
  ['CRM & Tech Training', 'Lead CRM training: daily lead report & missed follow-ups', 'Practical', 'Counsellor, Branch Manager, Regional Head'],
  ['CRM & Tech Training', 'Airtable entries: patient records & petty cash', 'Practical', 'Branch Manager, Regional Head, Receptionist'],
  ['CRM & Tech Training', 'Zoho inventory basics (view stock; no unauthorised adjustments)', 'Theory', 'Branch Manager, Regional Head, Accounts'],
  ['CRM & Tech Training', 'HRMS: attendance, leave request & payslip', 'Practical', 'All'],
  ['CRM & Tech Training', 'G-Money portal & Easy No-Cost EMI', 'Practical', 'Counsellor, Receptionist, Branch Manager, Regional Head, Accounts'],
  ['CRM & Tech Training', 'Prescription portal & courier details', 'Practical', 'Doctor, Receptionist, Counsellor, Branch Manager, Regional Head']
];
// Older general CRM items, replaced by the CRM technical checklist (removed once from template + unticked trainee rows)
const OLD_CRM_ITEMS = ['CRM overview: modules and who uses what', 'CRM login & patient search',
  'Create patient entry, token payment & custom plan in CRM', 'Package conversion & billing in CRM',
  'CRM overview: Clinic CRM vs Lead CRM and who uses what', 'Clinic CRM training: login & patient search',
  'Clinic CRM training: patient registration & visit history',
  'Clinic CRM training: token payment, custom plan & package conversion',
  'Clinic CRM training: session tracking & next-visit booking', 'Clinic CRM training: billing, payment entry & daily close'];

// Template rows for the CRM & Tech Training phase, in order: CRM technical checklist, then Lead CRM / tools
function crmTemplateRows_() {
  const CRM = 'CRM & Tech Training', out = [];
  CRM_TECH.forEach(b => b[2].forEach(it => out.push([b[0], it[1], CRM, b[1], it[0] === 'P' ? 'Practical' : 'Theory'])));
  CRM_CHECKLIST.forEach(r => out.push([r[0], r[1], CRM, r[3], r[2]]));
  return out;
}

// ---- Sales checklist: built from the Counsellor KRA/KPI SOP, Clinic Counsellor Playbook v2.0
//      and Cross-Sell & Upsell Playbook.   [module, topic, type, designations]
const SALES_DESIG = 'Counsellor, Branch Manager, Regional Head';
const T = 'Theory', P = 'Practical';
const SALES_CHECKLIST = [
  ['Sales: Role, KRA & KPI', 'Role purpose & reporting line (BM, then Manisha for sales)', T],
  ['Sales: Role, KRA & KPI', 'Four KRAs: Convert, Hold, Document, Stand by the brand', T],
  ['Sales: Role, KRA & KPI', 'Five core KPIs & supporting KPIs', T],
  ['Sales: Role, KRA & KPI', 'Consequences framework: KPI miss, written notice, PIP', T],
  ['Sales: Role, KRA & KPI', 'Operating rhythm: daily self-checklist, 6 PM BM debrief, weekly list', T],
  ['Sales: Role, KRA & KPI', 'Audit rubric: 6 sections, score out of 100, Green / Amber / Red', T],

  ['Sales: Six-Step Consultation', 'Six steps in order & how a consultation should feel', T],
  ['Sales: Six-Step Consultation', 'Rapport: open the door, greet by name, seat, tea / coffee / water', P],
  ['Sales: Six-Step Consultation', 'Rapport: six data points & the 5-7 minute rule', T],
  ['Sales: Six-Step Consultation', 'Diagnose: four beats (name, explain why, testimonial, inside-out)', T],
  ['Sales: Six-Step Consultation', 'Diagnose without hedge words and without outcome promises', P],
  ['Sales: Six-Step Consultation', 'Treatment process: internal (diet) + external (serum) tracks', T],
  ['Sales: Six-Step Consultation', 'Framing "14 sessions, 5-7 visits" & visit timing (same day, 1 week, 15-20 days)', T],
  ['Sales: Six-Step Consultation', 'Mock consultation, Steps 1-3, observed by trainer', P],

  ['Sales: Package & Pricing Math', '14-session custom package breakdown & MRP', T],
  ['Sales: Package & Pricing Math', 'Anchor the discount to her booking; use the calculator in front of her', P],
  ['Sales: Package & Pricing Math', 'Products (core trio) calculated in front of the client', P],
  ['Sales: Package & Pricing Math', 'Diet plan tiers & always recommending 6 months', T],
  ['Sales: Package & Pricing Math', 'Build-up to the total, then one-shot offer only after her yes', T],
  ['Sales: Package & Pricing Math', 'Reading face and body language while quoting', P],
  ['Sales: Package & Pricing Math', 'More discount asked: hold the line, BM call only after conditional yes', T],
  ['Sales: Package & Pricing Math', 'Mock package discussion from MRP to final total', P],

  ['Sales: Treatment Catalogue', 'Four service lines & treatment families', T],
  ['Sales: Treatment Catalogue', 'Hair: Immuno Therapy, Meso, PRP + Exo PC (4 sittings, 1-month gap)', T],
  ['Sales: Treatment Catalogue', 'Pigmentation: same-day single session vs 14-session package', T],
  ['Sales: Treatment Catalogue', 'Aesthetic (Botox, fillers, threads): same-day, doctor consult first', T],
  ['Sales: Treatment Catalogue', 'Exosomal therapy & medicated facial tiers', T],
  ['Sales: Treatment Catalogue', 'LHR / Body Polishing: 14 sittings, quoted per body part', T],
  ['Sales: Treatment Catalogue', 'Semi-permanent makeup: BB Glow, lip colour, microblading', T],
  ['Sales: Treatment Catalogue', 'Quote only catalogue prices; escalate anything outside it', T],
  ['Sales: Treatment Catalogue', 'Quote 5 catalogue services from memory (price and sittings)', P],

  ['Sales: Objection Handling', 'Seven approved objection scripts & when to use each', T],
  ['Sales: Objection Handling', 'Acknowledge first, never justify defensively', T],
  ['Sales: Objection Handling', 'Role-play: diet plan not needed / client lives far away', P],
  ['Sales: Objection Handling', 'Role-play: family discussion (offer space in the cabin)', P],
  ['Sales: Objection Handling', 'Role-play: price ("bahut mehnga hai")', P],
  ['Sales: Objection Handling', 'Role-play: comparison with another clinic', P],
  ['Sales: Objection Handling', 'Role-play: trust issue (no extra discount)', P],
  ['Sales: Objection Handling', 'Role-play: guarantee question (never promise 100% results)', P],

  ['Sales: Close & Follow-up', 'Close paths: one-shot, instalment, BM discount call', T],
  ['Sales: Close & Follow-up', 'Payment through CRM only; no off-system payment ever', T],
  ['Sales: Close & Follow-up', 'Deliver the assurance message after conversion', P],
  ['Sales: Close & Follow-up', 'First-day handoff: doctor, products, dietitian, next visit in CRM', P],
  ['Sales: Close & Follow-up', 'Consultation logged in CRM: plan, products, follow-up date, amount', P],
  ['Sales: Close & Follow-up', 'Three follow-up routes: balance pending, balance clear, OC', T],
  ['Sales: Close & Follow-up', 'Follow-up call (real call, 30 seconds or more) logged in CRM', P],
  ['Sales: Close & Follow-up', 'Worried-about-clients list & meeting clients after treatment', P],
  ['Sales: Close & Follow-up', 'Daily close: five lines logged in CRM before leaving', P],
  ['Sales: Close & Follow-up', 'Complaint logged in register within 1 hour; BM informed same day', T],

  ['Sales: Cross-sell & Upsell', 'Philosophy: care, not pressure; the four rules', T],
  ['Sales: Cross-sell & Upsell', 'Understand the need first & time the pitch to her satisfaction', T],
  ['Sales: Cross-sell & Upsell', 'Doctor leads on fillers, Botox and advanced under-eye', T],
  ['Sales: Cross-sell & Upsell', 'The move: praise, name the need, offer the fix, no pressure, lock next step', T],
  ['Sales: Cross-sell & Upsell', 'Scripts: fillers and Botox', P],
  ['Sales: Cross-sell & Upsell', 'Scripts: Body Polishing, LHR and face LHR', P],
  ['Sales: Cross-sell & Upsell', 'Scripts: advanced under-eye and complete aesthetic', P],
  ['Sales: Cross-sell & Upsell', 'Stay in touch beyond balance calls (relationship calls)', P],

  ['Sales: Hard-Line Rules & Escalation', 'Eight hard-line violations & termination-track consequence', T],
  ['Sales: Hard-Line Rules & Escalation', 'Never disclose a discount before her yes; no floor-breach pricing', T],
  ['Sales: Hard-Line Rules & Escalation', 'Escalation chain: BM, Team Leader, Manisha (never skip)', T],
  ['Sales: Hard-Line Rules & Escalation', 'Authority: what you decide alone vs what needs BM sign-off', T],
  ['Sales: Hard-Line Rules & Escalation', 'Client privacy & cabin discipline', T],

  ['Sales: Practical Sign-off', 'Observed three live consultations (shadowing)', P],
  ['Sales: Practical Sign-off', 'Ran a full six-step consultation under observation', P],
  ['Sales: Practical Sign-off', 'Audit score of 85 or more (Green) on an observed consultation', P],
  ['Sales: Practical Sign-off', 'Completed daily close in CRM independently', P],
  ['Sales: Practical Sign-off', 'Sales trainer final sign-off', P]
].map(r => [r[0], r[1], r[2], SALES_DESIG]);

const SALES_SCORING = [
  ['Sales Skills', 'Product knowledge'],
  ['Sales Skills', 'Communication & pitch'],
  ['Sales Skills', 'Objection handling'],
  ['Sales Skills', 'Conversion & target orientation'],
  ['Sales Skills', 'Follow-up discipline']
];

// ---- Operations checklist (from "Branch Manager Responsibilities & Process Guidelines")
const OPS_CHECKLIST = [
  ['Ops: Opening & Hygiene', 'BM shift timeline: 9:30 AM to 7:00 PM, task by task'],
  ['Ops: Opening & Hygiene', 'Clinic opening, room readiness & 9:45 AM photo + confirmation'],
  ['Ops: Opening & Hygiene', 'Morning briefing (reception 5, housekeeping 5, counsellors 10 min)'],
  ['Ops: Opening & Hygiene', 'Photo rounds every 2 hrs (11:30, 1:30, 3:30, 5:30)'],
  ['Ops: Opening & Hygiene', 'Hygiene standards, washroom checklist & weekly deep-clean'],
  ['Ops: Opening & Hygiene', 'BM-Doctor meeting & same-day MoM'],
  ['Ops: Opening & Hygiene', 'FDM handover: closing audit, signed slip & 8 PM debrief'],

  ['Ops: Stock & Requisition', 'Daily stock sheet update & morning physical count'],
  ['Ops: Stock & Requisition', 'Recording in pieces/bottles (not boxes) & expiry tracking'],
  ['Ops: Stock & Requisition', 'Reporting stock mismatch to RH & Operations'],
  ['Ops: Stock & Requisition', 'No unauthorised Zoho adjustments / inter-branch transfers'],
  ['Ops: Stock & Requisition', 'Receiving stock: verification against documents'],
  ['Ops: Stock & Requisition', 'Physical stock audit & audit report to Operations'],
  ['Ops: Stock & Requisition', 'Stock-intent cycle (1st/15th reminder, 3rd-5th, 16th-18th)'],
  ['Ops: Stock & Requisition', 'RH approval flow & fulfilment targets (10th / 22nd)'],

  ['Ops: Reporting & Issues', 'BM Daily Log, BM EOD report & stock report (separate, by 7 PM)'],
  ['Ops: Reporting & Issues', 'WhatsApp summary to RH & handover note for FDM'],
  ['Ops: Reporting & Issues', 'Issue Tracker entry: owner, target date, status'],
  ['Ops: Reporting & Issues', 'Escalating critical issues (machine, security, patient safety)'],
  ['Ops: Reporting & Issues', 'Closure evidence & follow-up until resolved'],
  ['Ops: Reporting & Issues', 'Coordination with RH, audits & corrective actions'],
  ['Ops: Reporting & Issues', 'Non-negotiables: no missed reports, no backdated entries'],

  ['Ops: Petty Cash & Cash Recon', 'Weekly petty cash allocation (Rs 4,000) & limits'],
  ['Ops: Petty Cash & Cash Recon', 'Approval rules: above Rs 500, emergency, replenishment below Rs 1,000'],
  ['Ops: Petty Cash & Cash Recon', 'Airtable entries with bills / vouchers / signatures'],
  ['Ops: Petty Cash & Cash Recon', 'Weekly cycle: Tue submission, Thu reconciliation, Fri payment'],
  ['Ops: Petty Cash & Cash Recon', 'Day-end Cash, Card & UPI reconciliation (6:30 PM cut-off)'],
  ['Ops: Petty Cash & Cash Recon', 'Denomination-wise cash entry & variance explanation'],
  ['Ops: Petty Cash & Cash Recon', 'Sealed cash envelope, card slip & reconciliation photos'],
  ['Ops: Petty Cash & Cash Recon', 'Late billing after cut-off: FDM slip checked at 9:30 AM'],

  ['Ops: Patient Records & CRM', 'Airtable same-day entries & correct patient status'],
  ['Ops: Patient Records & CRM', 'Customer type, clinic name, payment mode & amount'],
  ['Ops: Patient Records & CRM', 'Old-client check using clinic-card photo'],
  ['Ops: Patient Records & CRM', 'CRM process: token payment, custom plan, package conversion'],
  ['Ops: Patient Records & CRM', 'Complimentary products & Rs 1 billing rule'],
  ['Ops: Patient Records & CRM', 'Courier / pickup details & prescription portal'],
  ['Ops: Patient Records & CRM', 'G-Money portal & Easy No-Cost EMI process'],
  ['Ops: Patient Records & CRM', 'Complaints & patient follow-ups tracked to closure'],

  ['Ops: Machines, CCTV & Security', 'Machine tracker: make, serial number, repair status'],
  ['Ops: Machines, CCTV & Security', 'Reporting faults & technician troubleshooting before repair'],
  ['Ops: Machines, CCTV & Security', 'Infrastructure issues: lift, inverter, laptop, electrical'],
  ['Ops: Machines, CCTV & Security', 'CCTV always recording; verify after using the app'],
  ['Ops: Machines, CCTV & Security', 'Security incident documentation & escalation'],

  ['Ops: Staff & Roster', 'Daily attendance, late arrivals & reasons'],
  ['Ops: Staff & Roster', 'Dress code, badges & grooming (no round-neck T-shirts)'],
  ['Ops: Staff & Roster', 'Weekly roster incl. Sunday coverage'],
  ['Ops: Staff & Roster', 'Duty assignment & WhatsApp confirmation'],
  ['Ops: Staff & Roster', 'Coordinating with RH & HR on shortages / replacements'],
  ['Ops: Staff & Roster', 'Confirming team understands a new process before go-live'],

  ['Ops: Practical Sign-off', 'Shadowed one full BM shift (9:30 AM to 7:00 PM)'],
  ['Ops: Practical Sign-off', 'Ran opening & morning briefing independently'],
  ['Ops: Practical Sign-off', 'Completed stock sheet & physical count independently'],
  ['Ops: Practical Sign-off', 'Submitted EOD report & stock report on time'],
  ['Ops: Practical Sign-off', 'Completed day-end reconciliation (trainer checked)'],
  ['Ops: Practical Sign-off', 'Raised an issue in tracker and followed it to closure'],
  ['Ops: Practical Sign-off', 'Ops trainer final sign-off']
];
const OPS_SCORING = [
  ['Ops Knowledge', 'Daily BM timeline & responsibilities'],
  ['Ops Knowledge', 'Stock & requisition process'],
  ['Ops Knowledge', 'Petty cash & reconciliation rules'],
  ['Ops Knowledge', 'Airtable / CRM / reporting tools'],
  ['Ops Knowledge', 'Escalation & issue-tracker process'],
  ['Ops Execution', 'Reporting accuracy & timeliness'],
  ['Ops Execution', 'Hygiene, photo rounds & checks'],
  ['Ops Execution', 'Cash & stock accuracy'],
  ['Ops Execution', 'Team handling & morning briefing'],
  ['Ops Execution', 'Problem solving & ownership'],
  ['Ops Execution', 'Follow-up until closure']
];


// ---- v6 config: designations, ratings, departments, question bank
const DESIGNATIONS = ['Regional Head', 'Branch Manager', 'Counsellor', 'Receptionist', 'Therapist', 'Doctor', 'Accounts', 'Other'];
const RATINGS = [['Excellent', 10], ['Good', 7], ['Average', 4]];       // editable later in Lists tab (E:F)
const DEPARTMENTS = ['HR', 'Sales', 'Operations'];
const DEPT_PHASE = { 'HR': 'Onboarding', 'Sales': 'Sales Training', 'Operations': 'Operations Training' };
const OPS_DESIG_DEFAULT = 'Branch Manager, Regional Head';
const OPS_DESIG = {
  'Ops: Opening & Hygiene': 'Branch Manager, Regional Head, Receptionist',
  'Ops: Patient Records & CRM': 'Branch Manager, Regional Head, Receptionist'
};
const OLD_SALES_MODULES = ['Sales: Product Knowledge', 'Sales: Consultation & Closing'];
const OLD_SALES_STARTER = ['Skincare product line: ranges & key products', 'Clinic treatments & packages overview',
  'Pricing, packages & complimentary product rules', 'Common skin / hair concerns & what the clinic offers',
  'Patient consultation flow: greeting to billing', 'Understanding patient needs & handling objections',
  'Package pitch & conversion', 'Easy No-Cost EMI / G-Money process', 'Token payment & customised plan in CRM',
  'Follow-ups & next-appointment booking', 'Mock pitch / role-play with trainer', 'Sales trainer final sign-off'];

// [department, question, key points for the assessor, designations]
const QUESTION_BANK = [
  ['HR', 'In your own words, explain the vision, mission and core values of Gleuhr and give one example of how you will apply them in your role.',
   'Covers vision, mission and values from the induction; gives a real example from daily work.', 'All'],
  ['HR', 'Describe Gleuhr: its clinics network and its skincare product line.',
   'Knows the clinic network and the skincare line; understands how the business fits together.', 'All'],
  ['HR', 'What does the code of conduct expect from you, and what would you do if you saw a colleague break it?',
   'Knows the code; reports through the escalation matrix instead of ignoring it.', 'All'],
  ['HR', 'Explain the attendance and leave process, including how attendance is marked in HRMS.',
   'HRMS login, daily attendance marking, leave request and approval.', 'All'],
  ['HR', 'What is the POSH policy and how can an employee raise a concern?',
   'Purpose of the policy, complaint route, confidentiality.', 'All'],
  ['HR', 'How do data privacy and confidentiality apply to patient information in your role?',
   'Never shares client details; no photos or data on personal devices; discusses only where needed.', 'All'],
  ['HR', 'A patient is upset and raising her voice. How do you handle it and who do you escalate to?',
   'Stays calm, listens, empathises, follows the escalation matrix, logs the complaint.', 'All'],
  ['HR', 'Describe the dress code and grooming standards and why they matter.',
   'Knows the standard; links it to professionalism and client trust.', 'All'],
  ['HR', 'How are salary, PF and payroll processed, and what do you need to do on your side?',
   'Matches the payroll process taught in induction.', 'All'],
  ['HR', 'How should you communicate with colleagues and clients by email and chat?',
   'Professional tone, clear subject and summary, timely replies, right people copied.', 'All'],

  ['Sales', 'Walk me through the six steps of a consultation in order and what you do in each.',
   'Rapport, Diagnose, Treatment Process, Discuss Package, Handle Objections, Close + Assurance + Follow-up.', SALES_DESIG],
  ['Sales', 'What do you find out in the rapport step, and why do you not jump to her skin concern in the first 5 minutes?',
   'Profession, location, medical history, previous treatment, skincare history, what brought her in; builds trust; 5-7 minutes.', SALES_DESIG],
  ['Sales', 'How do you diagnose a concern? Describe the four beats.',
   'Name it confidently (no hedge words), explain why from her context, testimonial, inside-out solution; no outcome guarantee.', SALES_DESIG],
  ['Sales', 'Explain the treatment process: internal and external tracks and the visit schedule.',
   'Diet with dietitian + customised serum, doctor-led; 14 sessions in 5-7 visits; same day, 1 week, 15-20 days; recommend 6-month diet.', SALES_DESIG],
  ['Sales', 'Explain the order of the package discussion and when the one-shot offer may be revealed.',
   'Breakdown first, MRP, discount anchored to her booking, calculator, products, diet plan, total, one-shot only after her engagement / yes.', SALES_DESIG],
  ['Sales', 'A client says "bahut mehnga hai". What do you say and do?',
   'Acknowledge, per-session value, ask her budget expectation, listen, negotiate gently, one-shot first, BM only after her conditional yes.', SALES_DESIG],
  ['Sales', 'A client says she must discuss with her family. How do you handle it?',
   'Offer space in the cabin with tea and snacks, offer to speak to family, do not push her out, check in, never displace her.', SALES_DESIG],
  ['Sales', 'A client with a trust issue asks for more discount. What is the correct response?',
   'No additional discount; standard offer only; never change a number already quoted; acknowledge her past experience.', SALES_DESIG],
  ['Sales', 'Name five hard-line violations and say what happens if one is committed.',
   'Off-system payment, outcome guarantee, floor-breach pricing, early discount disclosure, fake conversion, lead poaching, privacy breach, walking out; same-day Head of Audit review, termination track.', SALES_DESIG],
  ['Sales', 'After a client converts, what must you do in the next 60 minutes and what must be in CRM?',
   'Payment through CRM, assurance message, walk her to the doctor, products, dietitian connect within 24 hours, next visit and amount locked in CRM.', SALES_DESIG],
  ['Sales', 'What are the three follow-up routes and the purpose of each?',
   'Balance pending (twice a week, reduce drop-out); balance clear (weekly, cross-sell and retention); only consultation (recover the lead, address the reason).', SALES_DESIG],
  ['Sales', 'How and when do you pitch a cross-sell or upsell without pressure? Give an example.',
   'Understand the need, pitch when she is happy with results, doctor leads clinical treatments, praise then need then fix, no pressure, lock the next step.', SALES_DESIG],
  ['Sales', 'Name the four KRAs and five core KPIs of a counsellor.',
   'KRAs: Convert, Hold, Document, Stand by the brand. KPIs: conversion into package, total revenue, overall conversion rate, upsell / cross-sell, follow-up discipline.', SALES_DESIG],
  ['Sales', 'Quote the price and number of sittings of any three treatments from the catalogue.',
   'Uses the catalogue exactly; does not improvise; escalates anything outside it.', SALES_DESIG],

  ['Operations', 'Walk me through a branch manager\'s day from 9:30 AM to 7:00 PM.',
   'Opening, 9:45 AM photo and confirmation, morning briefing, photo rounds every 2 hours, reports by 7 PM, FDM handover.', OPS_DESIG_DEFAULT + ', Receptionist'],
  ['Operations', 'What do you check and report at clinic opening?',
   'Room readiness, 9:45 AM photo and confirmation, morning briefing with reception, housekeeping and counsellors.', OPS_DESIG_DEFAULT + ', Receptionist'],
  ['Operations', 'How is stock recorded, and what do you do when there is a stock mismatch?',
   'Daily stock sheet and morning count, pieces / bottles not boxes, expiry; report to RH and Operations; no unauthorised Zoho adjustments or transfers.', OPS_DESIG_DEFAULT],
  ['Operations', 'Explain the stock-intent and requisition cycle with dates.',
   'Reminder on the 1st and 15th, intent 3rd-5th and 16th-18th, RH approval, fulfilment targets around the 10th and 22nd.', OPS_DESIG_DEFAULT],
  ['Operations', 'Explain the petty cash rules: weekly amount, approvals and the weekly cycle.',
   'Rs 4,000 weekly, approval above Rs 500, replenishment below Rs 1,000, Airtable entries with bills; Tuesday submission, Thursday reconciliation, Friday payment.', OPS_DESIG_DEFAULT],
  ['Operations', 'How do you do the day-end Cash, Card and UPI reconciliation?',
   '6:30 PM cut-off, denomination-wise cash, explain variance, sealed envelope, card slip, photos; late billing through the FDM slip checked at 9:30 AM.', OPS_DESIG_DEFAULT],
  ['Operations', 'Which reports are due at day end, and by when?',
   'BM Daily Log, EOD report and stock report (separate) by 7 PM; WhatsApp summary to RH; handover note for FDM.', OPS_DESIG_DEFAULT],
  ['Operations', 'How do you raise and close an issue in the tracker, and when do you escalate?',
   'Owner, target date, status; escalate machine, security and patient-safety issues; closure evidence and follow-up until resolved.', OPS_DESIG_DEFAULT],
  ['Operations', 'What do you do when a machine fails or CCTV is not recording?',
   'Machine tracker entry, report the fault, technician troubleshooting before repair, CCTV always recording and verified after app use, document security incidents.', OPS_DESIG_DEFAULT],
  ['Operations', 'How do you manage attendance, the roster and dress code for your team?',
   'Daily attendance and late reasons, weekly roster including Sunday, duty confirmation, dress code and badges, coordination with RH and HR.', OPS_DESIG_DEFAULT],
  ['Operations', 'Why must patient records be entered the same day, and what must each entry contain?',
   'Correct patient status, customer type, clinic name, payment mode and amount; old-client check using the clinic-card photo.', OPS_DESIG_DEFAULT + ', Receptionist'],
  ['Operations', 'What are the non-negotiable operating principles?',
   'No missed reports, no backdated entries, issues tracked to closure.', OPS_DESIG_DEFAULT]
];

// ===================== MENU =====================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Training Module')
    .addItem('➕ Add New Trainee', 'showAddTraineeDialog')
    .addItem('🔄 Sync Trainee Rows', 'syncAllTrainees')
    .addItem('🗑️ Delete Trainee', 'showDeleteTraineeDialog')
    .addItem('🧹 Clean Deleted Trainees', 'cleanupDeletedTrainees')
    .addItem('🔀 Sort Checklist (Theory, then Practical)', 'sortChecklistMenu')
    .addItem('📊 Rebuild Dashboard & Insights', 'rebuildDashboards')
    .addItem('♻️ Restore Removed Checklist Items', 'restoreRemovedItems')
    .addSeparator()
    .addItem('📧 Send Selected Handover', 'sendSelectedHandover')
    .addItem('⏰ Send Reminders Now', 'dailyReminders')
    .addSeparator()
    .addItem('🩺 Check Setup', 'checkSetup')
    .addItem('⚙️ Setup / Repair Module', 'setupTrainingModule')
    .addToUi();
}

// ===================== SETUP =====================
function setupTrainingModule() {
  const ss = SS();

  // Lists
  const li = getOrCreate(SHEETS.LI);
  if (li.getRange('A1').getValue() === '') {
    li.getRange('A1:C1').setValues([['Stages', 'Handover Status', 'Trainee Status']]);
    li.getRange(2, 2, 4, 1).setValues([['Draft'], ['Send'], ['Pending'], ['Completed']]);
    li.getRange(2, 3, 4, 1).setValues([['Active'], ['Completed'], ['On Hold'], ['Dropped']]);
    styleHeader(li.getRange('A1:C1'));
    li.setColumnWidths(1, 3, 230);
  }

  // Templates (HR defaults only on first creation; Sales/Ops added by migratePhases)
  const ct = getOrCreate(SHEETS.CT);
  if (ct.getRange('A1').getValue() === '') {
    ct.getRange('A1:C1').setValues([['Module', 'Topic', 'Phase']]);
    ct.getRange(2, 1, DEFAULT_CHECKLIST.length, 2).setValues(DEFAULT_CHECKLIST);
  }
  const st = getOrCreate(SHEETS.ST);
  if (st.getRange('A1').getValue() === '') {
    st.getRange('A1:C1').setValues([['Category', 'Criterion', 'Phase']]);
    st.getRange(2, 1, DEFAULT_SCORING.length, 2).setValues(DEFAULT_SCORING);
  }

  // Trainees
  const tr = getOrCreate(SHEETS.TR);
  if (tr.getRange('A1').getValue() === '') {
    tr.getRange(1, 1, 1, 12).setValues([['ID', 'Trainee Name', 'Email', 'Department / Clinic',
      'Designation', 'Joining Date', 'Trainer', 'Current Stage', 'Current Owner Email',
      'Checklist %', 'Score %', 'Status']]);
    styleHeader(tr.getRange(1, 1, 1, 12));
    tr.setFrozenRows(1);
    tr.setColumnWidths(1, 12, 140);
    tr.setColumnWidth(2, 200); tr.setColumnWidth(3, 220); tr.setColumnWidth(9, 220);
  }
  tr.getRange('F2:F500').setNumberFormat('dd-mmm-yyyy');
  tr.getRange('J2:K500').setNumberFormat('0%');

  // Checklist
  const cl = getOrCreate(SHEETS.CL);
  if (cl.getRange('A1').getValue() === '') {
    cl.getRange('A1:F1').setValues([['Trainee', 'Module', 'Topic', 'Covered', 'Date Covered', 'Remarks']]);
    styleHeader(cl.getRange('A1:F1'));
    cl.setFrozenRows(1);
    cl.setColumnWidths(1, 6, 150);
    cl.setColumnWidth(2, 210); cl.setColumnWidth(3, 380); cl.setColumnWidth(6, 260);
    cl.getRange('E2:E5000').setNumberFormat('dd-mmm-yyyy hh:mm');
    cl.getRange('A1:F5000').createFilter();
  }

  // Scores
  const sc = getOrCreate(SHEETS.SC);
  if (sc.getRange('A1').getValue() === '') {
    sc.getRange('A1:F1').setValues([['Trainee', 'Category', 'Criterion', 'Score (1-10)', 'Assessor', 'Remarks']]);
    styleHeader(sc.getRange('A1:F1'));
    sc.setFrozenRows(1);
    sc.setColumnWidths(1, 6, 150);
    sc.setColumnWidth(3, 300); sc.setColumnWidth(5, 200); sc.setColumnWidth(6, 300);
    sc.getRange('A1:F5000').createFilter();
  }
  sc.getRange('D2:D5000').setDataValidation(scoreRule());
  cl.setColumnWidth(2, 210);

  // Handover
  const ho = getOrCreate(SHEETS.HO);
  if (ho.getRange('A1').getValue() === '') {
    ho.getRange('A1:H1').setValues([['Trainee', 'Next Step', 'Next Owner Name', 'Next Owner Email',
      'Note for Next Owner', 'Status', 'Handed Over On', 'Last Reminder']]);
    styleHeader(ho.getRange('A1:H1'));
    ho.setFrozenRows(1);
    ho.setColumnWidths(1, 8, 170);
    ho.setColumnWidth(4, 240); ho.setColumnWidth(5, 300);
    ho.getRange('G2:H500').setNumberFormat('dd-mmm-yyyy hh:mm');
  }

  // Phases: stage list, templates, legacy names, cleanup of v2 "Role Track"
  migratePhases();
  ensureNewSheetsAndColumns();

  // Dropdowns that read from Lists
  tr.getRange('H2:H500').setDataValidation(listRule(li, 'A'));
  tr.getRange('L2:L500').setDataValidation(listRule(li, 'C'));
  ho.getRange('A2:A500').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(tr.getRange('B2:B500'), true).build());
  ho.getRange('B2:B500').setDataValidation(listRule(li, 'A'));
  ho.getRange('F2:F500').setDataValidation(listRule(li, 'B'));
  ho.getRange('F2:F500').setNote('Set to "Send" to email the next owner. Becomes "Pending" (daily reminders) until you set "Completed" - or until that owner hands the trainee onward.');
  ho.getRange('B1').setNote('Next Step options: training phases, Asset Allotment, CRM & Tech Training, Assessment (rate Q&A answers), Final Feedback (fill the Feedback tab), Final Review & Confirmation, and Onboard Final Email (sends the onboarding-complete email to Next Owner Email, cc the trainee, and closes the training).');

  buildInsights();
  buildDashboard();
  createTriggers();
  syncAllTrainees();

  const junk = ss.getSheetByName('Sheet1');
  if (junk && ss.getSheets().length > 1 && junk.getLastRow() === 0) ss.deleteSheet(junk);

  [SHEETS.DASH, SHEETS.INS, SHEETS.TR, SHEETS.CL, SHEETS.ASM, SHEETS.FB, SHEETS.SC, SHEETS.HO, SHEETS.CT, SHEETS.ST, SHEETS.QB, SHEETS.REM, SHEETS.LI].forEach((n, i) => {
    const sh = ss.getSheetByName(n);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(ss.getSheetByName(SHEETS.DASH));
  ss.toast('Training module v8 is ready.', 'Setup complete', 6);
}

/** Safe to run repeatedly. Never deletes your trainees, ticks, scores or handovers. */
function migratePhases() {
  const ss = SS();

  // 1. Lists: stages, designations, ratings, recommendations, custom designations
  const li = getOrCreate(SHEETS.LI);
  li.getRange('A2:A50').clearContent();
  li.getRange(2, 1, STAGES.length, 1).setValues(STAGES.map(s => [s]));
  if (String(li.getRange('D1').getValue()) === 'Role Track') li.getRange('D1:D50').clear();   // v2 leftover
  if (String(li.getRange('D1').getValue()) !== 'Designation') {
    li.getRange('D1').setValue('Designation');
    li.getRange(2, 4, DESIGNATIONS.length, 1).setValues(DESIGNATIONS.map(d => [d]));
  }
  // Every standard designation is in the list (new ones go just before "Other"); your own ones are kept
  const cur = li.getRange('D2:D50').getValues().map(r => String(r[0]).trim()).filter(String);
  const lc = cur.map(x => x.toLowerCase());
  const mine = cur.filter(x => x.toLowerCase() !== 'other');
  DESIGNATIONS.filter(x => x !== 'Other' && lc.indexOf(x.toLowerCase()) === -1).forEach(x => mine.push(x));
  mine.push('Other');
  if (mine.length !== cur.length || lc.indexOf('other') !== cur.length - 1) {
    li.getRange('D2:D50').clearContent();
    li.getRange(2, 4, mine.length, 1).setValues(mine.map(x => [x]));
  }
  // A designation that is now standard no longer needs a "custom" mapping (it gets its own items)
  const std = DESIGNATIONS.map(x => x.toLowerCase());
  const hm = li.getRange('H2:I50').getValues();
  if (hm.some(r => std.indexOf(String(r[0]).trim().toLowerCase()) > -1)) {
    const keepMap = hm.filter(r => String(r[0]).trim() && std.indexOf(String(r[0]).trim().toLowerCase()) === -1);
    li.getRange('H2:I50').clearContent();
    if (keepMap.length) li.getRange(2, 8, keepMap.length, 2).setValues(keepMap);
  }
  _desigCache = null; _customCache = null;
  if (String(li.getRange('E1').getValue()) !== 'Rating') {
    li.getRange('E1:F1').setValues([['Rating', 'Points (out of 10)']]);
    li.getRange(2, 5, RATINGS.length, 2).setValues(RATINGS);
  }
  if (String(li.getRange('G1').getValue()) !== 'Final Recommendation') {
    li.getRange('G1').setValue('Final Recommendation');
    li.getRange(2, 7, RECOMMENDATIONS.length, 1).setValues(RECOMMENDATIONS.map(x => [x]));
  }
  if (String(li.getRange('H1').getValue()) !== 'Custom Designation') {
    li.getRange('H1:I1').setValues([['Custom Designation', 'Use Checklist Of']]);
    li.getRange('I1').setNote('Filled automatically when you type a new designation under "Other" in Add Trainee. ' +
      '"All" = every checklist item; or a designation name, e.g. Branch Manager = same items as a Branch Manager.');
  }
  styleHeader(li.getRange('D1:I1'));
  li.setColumnWidths(4, 6, 190);

  // 2. Old stage names -> new names (Trainees col H, Handover col B)
  [[ss.getSheetByName(SHEETS.TR), 8], [ss.getSheetByName(SHEETS.HO), 2]].forEach(p => {
    const sh = p[0], col = p[1];
    if (!sh) return;
    const last = lastRowOfCol(sh, col);
    if (last < 2) return;
    const rng = sh.getRange(2, col, last - 1, 1);
    rng.setValues(rng.getValues().map(r => [LEGACY_STAGES[r[0]] || r[0]]));
  });

  // 3. v2 "Role Track" column on Trainees is no longer used
  const tr = ss.getSheetByName(SHEETS.TR);
  if (tr && String(tr.getRange('M1').getValue()) === 'Role Track') tr.getRange('M1:M500').clear();

  // 4. Templates
  migrateTemplate(getOrCreate(SHEETS.CT), true);
  migrateTemplate(getOrCreate(SHEETS.ST), false);
}

// Unticked, remark-free trainee rows of the old general CRM items are removed (ticked ones are kept)
function removeOldCrmTraineeRows_() {
  const cl = SS().getSheetByName(SHEETS.CL);
  if (!cl) return;
  const last = lastRowOfCol(cl, 1);
  if (last < 2) return;
  const old = new Set(OLD_CRM_ITEMS);
  const v = cl.getRange(2, 1, last - 1, 6).getValues();
  for (let i = v.length - 1; i >= 0; i--) {
    if (String(v[i][1]).trim() === 'CRM & Tech Training' && old.has(String(v[i][2]).trim()) &&
        v[i][3] !== true && String(v[i][5]).trim() === '') cl.deleteRow(i + 2);
  }
}

function defaultTemplateRows(isChecklist) {
  const out = [];
  if (isChecklist) {
    ASSET_CHECKLIST.forEach(r => out.push([r[0], r[1], r[0], 'All', r[2]]));
    crmTemplateRows_().forEach(r => out.push(r));
    OPS_CHECKLIST.forEach(r => out.push([r[0], r[1], 'Operations Training', OPS_DESIG[r[0]] || OPS_DESIG_DEFAULT, typeFor(r[1])]));
    SALES_CHECKLIST.forEach(r => out.push([r[0], r[1], 'Sales Training', r[3], r[2]]));
  } else {
    OPS_SCORING.concat(SALES_SCORING).forEach(r => out.push([r[0], r[1], CAT_PHASE[r[0]], 'All']));
  }
  return out;
}

// Template columns: Checklist_Template = Module, Topic, Phase, Designation, Type ; Scoring_Template = Category, Criterion, Phase, Designation
function migrateTemplate(t, isChecklist) {
  const hdr = isChecklist ? ['Module', 'Topic', 'Phase', 'Designation', 'Type']
                          : ['Category', 'Criterion', 'Phase', 'Designation'];
  const map = isChecklist ? MODULE_PHASE : CAT_PHASE;
  const ncol = hdr.length;
  t.getRange(1, 1, 1, ncol).setValues([hdr]);
  styleHeader(t.getRange(1, 1, 1, ncol));
  t.getRange('C1').setNote('Phase when these rows are created for a trainee. Blank = every trainee from day 1.');
  t.getRange('D1').setNote('All = every designation, or a comma list of designations from the Lists tab, column D (e.g. Receptionist, Therapist, Doctor, Counsellor, Branch Manager, Regional Head, Accounts).');

  const last = lastRowOfCol(t, 2);
  let rows = last > 1 ? t.getRange(2, 1, last - 1, ncol).getValues() : [];
  if (isChecklist) {      // drop the old starter Sales rows (replaced by the playbook-based list)
    rows = rows.filter(r => !(OLD_SALES_MODULES.indexOf(String(r[0]).trim()) > -1 &&
                              OLD_SALES_STARTER.indexOf(String(r[1]).trim()) > -1));
  }
  rows = rows.filter(r => String(r[0]).trim() && String(r[1]).trim()).map(r => {
    const a = String(r[0]).trim(), b = String(r[1]).trim();
    const out = [a, b, phaseOf(r[2], a, map), String(r[3] || '').trim() || 'All'];
    if (isChecklist) out.push(String(r[4] || '').trim() || typeFor(b));
    return out;
  });

  const props = PropertiesService.getScriptProperties();
  // One-time: replace the CRM & Tech Training block with the CRM technical checklist (by designation), in order
  if (isChecklist && !props.getProperty('crmV85')) {
    const CRM = 'CRM & Tech Training';
    const fresh = crmTemplateRows_();
    const freshKeys = new Set(fresh.map(r => r[0] + '|' + r[1]));
    const old = new Set(OLD_CRM_ITEMS);
    const isDefault = r => (r[0] === CRM && old.has(r[1])) || freshKeys.has(r[0] + '|' + r[1]);
    const at = rows.findIndex(r => r[2] === CRM || freshKeys.has(r[0] + '|' + r[1]));
    if (at > -1) {
      const pos = rows.slice(0, at).filter(r => !isDefault(r)).length;
      rows = rows.filter(r => !isDefault(r));
      rows.splice.apply(rows, [pos, 0].concat(fresh));
    }
    removeOldCrmTraineeRows_();
    props.setProperty('crmV85', '1');
  }
  const have = new Set(rows.map(r => r[0] + '|' + r[1]));
  const hasPhase = ph => rows.some(r => r[2] === ph);
  const addSales = isChecklist && !props.getProperty('salesV6');
  defaultTemplateRows(isChecklist).forEach(d => {
    if (have.has(d[0] + '|' + d[1])) return;
    const isSales = d[2] === 'Sales Training';
    if ((isSales && addSales) || (!hasPhase(d[2]) && !(isSales && isChecklist))) {
      rows.push(d.slice(0, ncol));
      have.add(d[0] + '|' + d[1]);
    }
  });
  if (isChecklist) props.setProperty('salesV6', '1');

  if (last > 1) t.getRange(2, 1, last - 1, Math.max(ncol, 5)).clearContent();
  if (rows.length) t.getRange(2, 1, rows.length, ncol).setValues(rows);

  t.setColumnWidth(1, 250); t.setColumnWidth(2, 460); t.setColumnWidth(3, 190);
  t.setColumnWidth(4, 260); t.setColumnWidth(5, 100);
  t.getRange('A2:A400').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(isChecklist ? MODULES : SCORE_CATEGORIES, true).build());
  t.getRange('C2:C400').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true).build());
  if (isChecklist) {
    t.getRange('E2:E400').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Theory', 'Practical'], true).build());
  }
}

// ===================== NEW SHEETS / COLUMNS =====================
function ensureNewSheetsAndColumns() {
  ensureTrainingTimeColumns();
  ensureChecklistColumns();
  seedQuestionBank();
  ensureAssessmentSheet();
  ensureFeedbackSheet();
  ensureRemovedSheet();
  const tr = SS().getSheetByName(SHEETS.TR), li = SS().getSheetByName(SHEETS.LI);
  tr.getRange('E2:E500').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(li.getRange('D2:D50'), true).setAllowInvalid(true).build());
}

function templateTypeMap() {
  const t = SS().getSheetByName(SHEETS.CT), map = {};
  const last = lastRowOfCol(t, 2);
  if (last > 1) t.getRange(2, 1, last - 1, 5).getValues().forEach(r => {
    if (String(r[4]).trim()) map[String(r[0]).trim() + '|' + String(r[1]).trim()] = String(r[4]).trim();
  });
  return map;
}

// Checklist: G = Type, H = Assessor, I = Remove (N/A), J = Day No.
function ensureChecklistColumns() {
  const cl = SS().getSheetByName(SHEETS.CL);
  if (!cl) return;
  cl.getRange('G1:J1').setValues([['Type', 'Assessor', 'Remove (N/A)', 'Training Day']]);
  styleHeader(cl.getRange('G1:J1'));
  cl.setColumnWidth(7, 100); cl.setColumnWidth(8, 210); cl.setColumnWidth(9, 120); cl.setColumnWidth(10, 110);
  cl.getRange('I1').setNote('Tick to DELETE this item for this trainee (not relevant to the designation). It is logged in Removed_Items and will not come back. Menu > Restore Removed Checklist Items brings it back.');
  cl.getRange('J1').setNote('Training day on which the item was ticked. Day 1 = joining date. Fills automatically.');
  cl.getRange('G1').setNote('Rows are sorted per trainee: all Theory items first (blue), then all Practical items (purple).');
  cl.getRange('J2:J5000').setNumberFormat(DAY_FMT).setHorizontalAlignment('center');
  const last = lastRowOfCol(cl, 1);
  if (last > 1) {
    const typeMap = templateTypeMap();
    const bc = cl.getRange(2, 2, last - 1, 2).getValues();
    const gRng = cl.getRange(2, 7, last - 1, 1);
    const g = gRng.getValues();
    gRng.setValues(g.map((r, i) => [r[0] || typeMap[String(bc[i][0]).trim() + '|' + String(bc[i][1]).trim()] || typeFor(bc[i][1])]));
    const iRng = cl.getRange(2, 9, last - 1, 1);
    if (iRng.getValues().some(r => r[0] !== true && r[0] !== false)) iRng.insertCheckboxes();
  }
  const f = cl.getFilter();
  if (!f) cl.getRange('A1:J5000').createFilter();
  else if (f.getRange().getLastColumn() < 10) { f.remove(); cl.getRange('A1:J5000').createFilter(); }

  // Colour-code Theory vs Practical rows (keeps any rules you added yourself)
  const keep = cl.getConditionalFormatRules().filter(rule => {
    const bcnd = rule.getBooleanCondition();
    const v = bcnd && bcnd.getCriteriaValues();
    return !(v && v.length && String(v[0]).indexOf('$G2=') > -1);
  });
  const area = cl.getRange('A2:J5000');
  keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2="Theory"')
    .setBackground('#eef4ff').setRanges([area]).build());
  keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2="Practical"')
    .setBackground('#f8eefa').setRanges([area]).build());
  cl.setConditionalFormatRules(keep);
}

function ratingRule() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(SS().getSheetByName(SHEETS.LI).getRange('E2:E20'), true).setAllowInvalid(false).build();
}

// Assessment: A Trainee, B Department, C Question, D Key points, E Answer, F Rating, G Score, H Assessor, I Date
function ensureAssessmentSheet() {
  const asm = getOrCreate(SHEETS.ASM);
  if (asm.getRange('A1').getValue() === '') {
    asm.getRange('A1:I1').setValues([['Trainee', 'Department', 'Question', 'Key Points (for assessor)',
      "Trainee's Answer", 'Rating', 'Score (/10)', 'Assessor', 'Date']]);
    styleHeader(asm.getRange('A1:I1'));
    asm.setFrozenRows(1);
    asm.setColumnWidths(1, 9, 140);
    asm.setColumnWidth(3, 380); asm.setColumnWidth(4, 340); asm.setColumnWidth(5, 380);
    asm.getRange('C2:E5000').setWrap(true).setVerticalAlignment('top');
    asm.getRange('I2:I5000').setNumberFormat('dd-mmm-yyyy hh:mm');
    asm.getRange('A1:I5000').createFilter();
  }
  asm.getRange('F2:F5000').setDataValidation(ratingRule());
  return asm;
}

// Feedback: A Trainee, B Given By, C Date, D Overall Rating, E Final Recommendation, F Strengths, G Areas to Improve, H Comments
function ensureFeedbackSheet() {
  const fb = getOrCreate(SHEETS.FB);
  if (fb.getRange('A1').getValue() === '') {
    fb.getRange('A1:H1').setValues([['Trainee', 'Given By', 'Date', 'Overall Rating', 'Final Recommendation',
      'Strengths', 'Areas to Improve', 'Comments']]);
    styleHeader(fb.getRange('A1:H1'));
    fb.setFrozenRows(1);
    fb.setColumnWidth(1, 170); fb.setColumnWidth(2, 210); fb.setColumnWidth(3, 130);
    fb.setColumnWidth(4, 130); fb.setColumnWidth(5, 170);
    fb.setColumnWidth(6, 320); fb.setColumnWidth(7, 320); fb.setColumnWidth(8, 360);
    fb.getRange('F2:H500').setWrap(true).setVerticalAlignment('top');
    fb.getRange('C2:C500').setNumberFormat('dd-mmm-yyyy hh:mm');
    fb.getRange('A1:H500').createFilter();
    fb.getRange('A1').setNote('A row is created automatically when the trainee is handed over for "Final Feedback" (or Final Review). Given By and Date fill in when you pick a rating or recommendation.');
  }
  fb.getRange('A2:A500').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(SS().getSheetByName(SHEETS.TR).getRange('B2:B500'), true)
    .setAllowInvalid(false).setHelpText('Pick the trainee from the list').build());
  fb.getRange('A1').setNote('Pick the trainee from the dropdown (a row is also created automatically when the trainee is handed over for "Final Feedback"). Given By and Date fill in when you enter the feedback.');
  fb.getRange('D2:D500').setDataValidation(ratingRule());
  fb.getRange('E2:E500').setDataValidation(listRule(SS().getSheetByName(SHEETS.LI), 'G'));
  return fb;
}

function seedQuestionBank() {
  const qb = getOrCreate(SHEETS.QB);
  if (qb.getRange('A1').getValue() === '') {
    qb.getRange('A1:D1').setValues([['Department', 'Question', 'Key Points (for assessor)', 'Designation']]);
    styleHeader(qb.getRange('A1:D1'));
    qb.setFrozenRows(1);
    qb.setColumnWidth(1, 120); qb.setColumnWidth(2, 460); qb.setColumnWidth(3, 460); qb.setColumnWidth(4, 260);
    qb.getRange('A2:D400').setWrap(true).setVerticalAlignment('top');
    qb.getRange(2, 1, QUESTION_BANK.length, 4).setValues(QUESTION_BANK);
    qb.getRange('A2:A400').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(DEPARTMENTS, true).setAllowInvalid(false).build());
    qb.getRange('D1').setNote('All, or a comma list of designations. The question is created for a trainee when they reach that department phase (HR = Onboarding, Sales = Sales Training, Operations = Operations Training), or for every department when handed over for "Assessment".');
  }
}

function ensureRemovedSheet() {
  const rem = getOrCreate(SHEETS.REM);
  if (rem.getRange('A1').getValue() === '') {
    rem.getRange('A1:G1').setValues([['Trainee', 'Module', 'Topic', 'Type', 'Removed By', 'Removed On', 'Restore?']]);
    styleHeader(rem.getRange('A1:G1'));
    rem.setFrozenRows(1);
    rem.setColumnWidths(1, 7, 150);
    rem.setColumnWidth(3, 380);
    rem.getRange('F2:F2000').setNumberFormat('dd-mmm-yyyy hh:mm');
    rem.getRange('G1').setNote('Tick Restore? and run Training Module > Restore Removed Checklist Items to bring the item back.');
  }
  return rem;
}

// ===================== DASHBOARD =====================
function buildDashboard() {
  const ss = SS();
  let d = ss.getSheetByName(SHEETS.DASH);
  if (d) {
    d.getCharts().forEach(c => d.removeChart(c));
    d.getRange(1, 1, d.getMaxRows(), d.getMaxColumns()).breakApart().clearDataValidations();
    d.clear();
    d.clearConditionalFormatRules();
  } else {
    d = ss.insertSheet(SHEETS.DASH, 0);
  }
  d.setHiddenGridlines(true);
  [20, 200, 300, 100, 140, 130, 180, 290, 100, 170].forEach((w, i) => d.setColumnWidth(i + 1, w));

  const NAVY = '#1a237e', LIGHT = '#e8eaf6';

  // rows
  const HDR = 13, FIRST = 14;
  const rALL = FIRST + PHASES.length;                    // overall row, left table
  const sALL = FIRST + SCORE_CATEGORIES.length;          // overall row, right table
  const QA_HDR = Math.max(rALL, sALL) + 2, QA_FIRST = QA_HDR + 1, QA_END = QA_FIRST + DEPARTMENTS.length - 1;
  const FB_T = QA_END + 2;                               // final feedback block (4 rows)
  const T_TITLE = FB_T + 5, T_HEAD = T_TITLE + 1, T_DATA = T_HEAD + 1;

  const cf = (mod, done) => 'COUNTIFS(Checklist!$A:$A,$C$3,Checklist!$B:$B,"' + mod + '"' +
    (done ? ',Checklist!$D:$D,TRUE' : '') + ')';
  const sumMods = (mods, done) => '(' + mods.map(m => cf(m, done)).join('+') + ')';
  const mt = 'MATCH($C$3,Trainees!$B:$B,0)';
  const tIdx = col => 'INDEX(Trainees!$' + col + ':$' + col + ',' + mt + ')';

  // Title
  d.getRange('B1:J1').merge().setValue('TRAINEE TRAINING DASHBOARD  |  ' + COMPANY)
    .setBackground(NAVY).setFontColor('#fff').setFontSize(16).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  d.setRowHeight(1, 44);

  // Selector
  d.getRange('B3').setValue('Select Trainee  ▶').setFontWeight('bold').setFontSize(12);
  d.getRange('C3').setBackground('#fff59d').setFontWeight('bold').setFontSize(12)
    .setBorder(true, true, true, true, false, false, '#f9a825', SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getSheetByName(SHEETS.TR).getRange('B2:B500'), true)
      .setAllowInvalid(false).build());

  // Checklist type filter for the detail table
  d.getRange('D3').setValue('Show ▶').setFontWeight('bold').setHorizontalAlignment('right');
  d.getRange('E3').setValue('All').setBackground('#fff59d').setFontWeight('bold').setHorizontalAlignment('center')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['All', 'Theory', 'Practical'], true)
      .setAllowInvalid(false).build());

  // Profile
  const prof = [['Email', 3], ['Department / Clinic', 4], ['Joining Date', 6],
                ['Trainer', 7], ['Current Stage', 8], ['Current Owner', 9]];
  prof.forEach((p, i) => {
    const r = 5 + i;
    d.getRange(r, 2).setValue(p[0]).setFontWeight('bold').setBackground(LIGHT);
    const col = String.fromCharCode(64 + p[1]);
    d.getRange(r, 3).setFormula('=IFERROR(INDEX(Trainees!$' + col + ':$' + col +
      ',MATCH($C$3,Trainees!$B:$B,0)),"")');
  });
  d.getRange('C7').setNumberFormat('dd-mmm-yyyy').setHorizontalAlignment('left');

  // Training days of the selected trainee (text line)
  d.getRange(11, 2).setValue('Training Days').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(11, 3).setFormula('=IFERROR(IF(' + tIdx('N') + '="","",' + tIdx('N') + '&" days "&' +
    'IF(' + tIdx('M') + '<>"","(closed)","(running)")),"")').setHorizontalAlignment('left');

  // Designation of the selected trainee
  d.getRange(12, 2).setValue('Designation').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(12, 3).setFormula('=IFERROR(' + tIdx('E') + ',"")').setHorizontalAlignment('left');

  // Training Days card (D5:E9)
  d.getRange('D5:E5').merge().setValue('Training Days').setFontColor('#5f6368').setFontSize(9)
    .setHorizontalAlignment('center').setBackground(LIGHT);
  d.getRange('D6:E7').merge().setFormula('=IFERROR(IF(' + tIdx('N') + '="","-",' + tIdx('N') + '),"-")')
    .setNumberFormat('0" days"').setFontSize(22).setFontWeight('bold').setFontColor(NAVY)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setBackground('#fff');
  d.getRange('D8:E8').merge().setFormula('=IF($C$3="","",IFERROR(IF(' + tIdx('M') + '<>"","Closed on "&TEXT(' + tIdx('M') +
    ',"dd-mmm-yyyy"),IF(' + tIdx('N') + '="","Add a joining date","Still running")),""))')
    .setHorizontalAlignment('center').setFontColor('#5f6368');
  d.getRange('D9:E9').merge().setFormula('=IF($C$3="","",IF(MAXIFS(Checklist!$J:$J,Checklist!$A:$A,$C$3)=0,"No item ticked yet",' +
    '"Last item ticked on Day "&MAXIFS(Checklist!$J:$J,Checklist!$A:$A,$C$3)))')
    .setHorizontalAlignment('center').setFontColor('#5f6368').setFontSize(9);
  d.getRange('D5:E9').setBorder(true, true, true, true, false, false, '#c5cae9', SpreadsheetApp.BorderStyle.SOLID);

  // Link to Insights tab
  const insSheet = ss.getSheetByName(SHEETS.INS);
  if (insSheet) {
    d.getRange('G3:J3').merge().setFormula('=HYPERLINK("#gid=' + insSheet.getSheetId() +
      '","📊 Open Insights: days taken, HR / Sales / Ops completion %")')
      .setFontWeight('bold').setFontColor('#1a73e8').setHorizontalAlignment('center');
  }

  // KPI cards
  const rowOf = c => FIRST + SCORE_CATEGORIES.indexOf(c);
  const cards = [['G', 'Checklist Completion', '=D' + rALL], ['H', 'Behavioral Score', '=I' + rowOf('Behavioral')],
                 ['I', 'Cultural Fit Score', '=I' + rowOf('Cultural Fit')], ['J', 'Overall Score', '=I' + sALL]];
  cards.forEach(c => {
    d.getRange(c[0] + '5').setValue(c[1]).setFontColor('#5f6368').setFontSize(9)
      .setHorizontalAlignment('center').setBackground(LIGHT).setWrap(true);
    d.getRange(c[0] + '6:' + c[0] + '7').merge().setFormula(c[2]).setNumberFormat('0%')
      .setFontSize(22).setFontWeight('bold').setFontColor(NAVY)
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setBackground('#fff');
  });
  d.getRange('G9').setValue('Verdict').setFontWeight('bold').setBackground(LIGHT);
  d.getRange('H9:J9').merge().setFormula(
    '=IF($C$3="","Select a trainee",IF(COUNTIFS(Scores!$A:$A,$C$3,Scores!$D:$D,">0")=0,"Not yet assessed",' +
    'IF(J6>=0.8,"Strong fit - recommend",IF(J6>=0.6,"Moderate fit - needs coaching","Needs improvement"))))')
    .setFontWeight('bold').setFontSize(12);
  d.getRange('G10').setValue('Handover Status').setFontWeight('bold').setBackground(LIGHT);
  d.getRange('H10:J10').merge().setFormula(
    '=IFERROR(CHOOSEROWS(FILTER(Handover!$F$2:$F$500,TRIM(Handover!$A$2:$A$500)=$C$3),-1),"Not handed over")');
  d.getRange('G11').setValue('Handed To').setFontWeight('bold').setBackground(LIGHT);
  d.getRange('H11:J11').merge().setFormula(
    '=IFERROR(CHOOSEROWS(FILTER(Handover!$B$2:$B$500,TRIM(Handover!$A$2:$A$500)=$C$3),-1)&"  →  "&' +
    'CHOOSEROWS(FILTER(Handover!$C$2:$C$500,TRIM(Handover!$A$2:$A$500)=$C$3),-1),"-")');

  // Phase progress table (B:F) with day range per phase
  const modArr = mods => '{' + mods.map(m => '"' + m + '"').join(',') + '}';
  const dayRange = cond => '=IFERROR(LET(x,FILTER(Checklist!$J$2:$J$5000,Checklist!$A$2:$A$5000=$C$3,' +
    'Checklist!$J$2:$J$5000<>""' + cond + '),"Day "&MIN(x)&" - "&MAX(x)&"  ("&(MAX(x)-MIN(x)+1)&" d)"),"-")';
  d.getRange(HDR, 2, 1, 5).setValues([['Phase', 'Covered / Total', '% Done', 'Progress', 'Days']]);
  PHASES.forEach((p, i) => {
    const r = FIRST + i;
    d.getRange(r, 2).setValue(p.stage);
    const mods = p.dash || p.modules;
    d.getRange(r, 3).setFormula('=' + sumMods(mods, true) + '&" / "&' + sumMods(mods, false));
    d.getRange(r, 4).setFormula('=IFERROR(' + sumMods(mods, true) + '/' + sumMods(mods, false) + ',0)');
    d.getRange(r, 5).setFormula('=SPARKLINE(D' + r + ',{"charttype","bar";"max",1;"color1","#34a853"})');
    d.getRange(r, 6).setFormula(dayRange(p.dash
      ? ',(' + p.dash.map(x => 'LEFT(Checklist!$B$2:$B$5000,' + (x.length - 1) + ')="' + x.slice(0, -1) + '"').join('+') + ')'
      : ',ISNUMBER(MATCH(Checklist!$B$2:$B$5000,' + modArr(p.modules) + ',0))'));
  });
  d.getRange(rALL, 2).setValue('Overall').setFontWeight('bold');
  d.getRange(rALL, 3).setFormula('=COUNTIFS(Checklist!$A:$A,$C$3,Checklist!$D:$D,TRUE)&" / "&COUNTIFS(Checklist!$A:$A,$C$3)')
    .setFontWeight('bold');
  d.getRange(rALL, 4).setFormula('=IFERROR(COUNTIFS(Checklist!$A:$A,$C$3,Checklist!$D:$D,TRUE)/COUNTIFS(Checklist!$A:$A,$C$3),0)')
    .setFontWeight('bold');
  d.getRange(rALL, 5).setFormula('=SPARKLINE(D' + rALL + ',{"charttype","bar";"max",1;"color1","#1a73e8"})');
  d.getRange(rALL, 6).setFormula(dayRange('')).setFontWeight('bold');
  d.getRange(FIRST, 4, rALL - FIRST + 1, 1).setNumberFormat('0%');
  d.getRange(FIRST, 6, rALL - FIRST + 1, 1).setHorizontalAlignment('center').setFontSize(9);

  // Score table
  d.getRange(HDR, 7, 1, 4).setValues([['Category', 'Avg Score (/10)', '% ', 'Progress']]);
  SCORE_CATEGORIES.forEach((c, i) => {
    const r = FIRST + i;
    d.getRange(r, 7).setValue(c);
    d.getRange(r, 8).setFormula('=IFERROR(AVERAGEIFS(Scores!$D:$D,Scores!$A:$A,$C$3,Scores!$B:$B,G' + r + '),0)');
    d.getRange(r, 9).setFormula('=H' + r + '/10');
    d.getRange(r, 10).setFormula('=SPARKLINE(I' + r + ',{"charttype","bar";"max",1;"color1","#fb8c00"})');
  });
  d.getRange(sALL, 7).setValue('Overall').setFontWeight('bold');
  d.getRange(sALL, 8).setFormula('=IFERROR(AVERAGEIFS(Scores!$D:$D,Scores!$A:$A,$C$3),0)').setFontWeight('bold');
  d.getRange(sALL, 9).setFormula('=H' + sALL + '/10').setFontWeight('bold');
  d.getRange(sALL, 10).setFormula('=SPARKLINE(I' + sALL + ',{"charttype","bar";"max",1;"color1","#e53935"})');
  d.getRange(FIRST, 8, sALL - FIRST + 1, 1).setNumberFormat('0.0').setHorizontalAlignment('center');
  d.getRange(FIRST, 9, sALL - FIRST + 1, 1).setNumberFormat('0%');
  d.getRange('J6').setFormula('=I' + sALL);

  [d.getRange(HDR, 2, 1, 5), d.getRange(HDR, 7, 1, 4)].forEach(r =>
    r.setBackground(NAVY).setFontColor('#fff').setFontWeight('bold'));
  [d.getRange(FIRST, 2, rALL - FIRST + 1, 5), d.getRange(FIRST, 7, sALL - FIRST + 1, 4)].forEach(r =>
    r.setBorder(true, true, true, true, true, true, '#c5cae9', SpreadsheetApp.BorderStyle.SOLID));

  // Q&A evaluation by department (left) and Theory vs Practical (right)
  d.getRange(QA_HDR, 2, 1, 4).setValues([['Q&A Evaluation', 'Answered / Total', 'Avg Score (/10)', 'Rating']]);
  DEPARTMENTS.forEach((dep, i) => {
    const r = QA_FIRST + i;
    d.getRange(r, 2).setValue(dep);
    d.getRange(r, 3).setFormula('=COUNTIFS(Assessment!$A:$A,$C$3,Assessment!$B:$B,$B' + r + ',Assessment!$F:$F,"<>")&" / "&COUNTIFS(Assessment!$A:$A,$C$3,Assessment!$B:$B,$B' + r + ')');
    d.getRange(r, 4).setFormula('=IFERROR(AVERAGEIFS(Assessment!$G:$G,Assessment!$A:$A,$C$3,Assessment!$B:$B,$B' + r + '),0)');
    d.getRange(r, 5).setFormula('=IF(D' + r + '=0,"Not assessed",IF(D' + r + '>=8.5,"Excellent",IF(D' + r + '>=5.5,"Good","Average")))');
  });
  d.getRange(QA_FIRST, 4, DEPARTMENTS.length, 1).setNumberFormat('0.0').setHorizontalAlignment('center');
  d.getRange(QA_HDR, 7, 1, 4).setValues([['Checklist Type', 'Covered / Total', '% Done', 'Progress']]);
  ['Theory', 'Practical'].forEach((ty, i) => {
    const r = QA_FIRST + i;
    const tot = 'COUNTIFS(Checklist!$A:$A,$C$3,Checklist!$G:$G,$G' + r + ')';
    const done = 'COUNTIFS(Checklist!$A:$A,$C$3,Checklist!$G:$G,$G' + r + ',Checklist!$D:$D,TRUE)';
    d.getRange(r, 7).setValue(ty);
    d.getRange(r, 8).setFormula('=' + done + '&" / "&' + tot);
    d.getRange(r, 9).setFormula('=IFERROR(' + done + '/' + tot + ',0)').setNumberFormat('0%');
    d.getRange(r, 10).setFormula('=SPARKLINE(I' + r + ',{"charttype","bar";"max",1;"color1","#8e24aa"})');
  });
  [d.getRange(QA_HDR, 2, 1, 4), d.getRange(QA_HDR, 7, 1, 4)].forEach(r =>
    r.setBackground(NAVY).setFontColor('#fff').setFontWeight('bold'));
  [d.getRange(QA_FIRST, 2, DEPARTMENTS.length, 4), d.getRange(QA_FIRST, 7, 2, 4)].forEach(r =>
    r.setBorder(true, true, true, true, true, true, '#c5cae9', SpreadsheetApp.BorderStyle.SOLID));

  // Final feedback block
  // latest Feedback row for the trainee that actually has something filled in (blank rows ignored)
  const fbHas = 'TRIM(Feedback!$A$2:$A$500)=$C$3,LEN(Feedback!$D$2:$D$500&Feedback!$E$2:$E$500&' +
    'Feedback!$F$2:$F$500&Feedback!$G$2:$G$500&Feedback!$H$2:$H$500)>0';
  const fbVal = col => 'CHOOSEROWS(FILTER(Feedback!$' + col + '$2:$' + col + '$500,' + fbHas + '),-1)';
  const lk = col => 'IFERROR(' + fbVal(col) + '&"","")';
  const fbAsked = '(COUNTIF(Feedback!$A$2:$A$500,$C$3)+COUNTIFS(Handover!$A$2:$A$500,$C$3,Handover!$B$2:$B$500,"Final Feedback")+' +
    'COUNTIFS(Handover!$A$2:$A$500,$C$3,Handover!$B$2:$B$500,"Final Review & Confirmation"))';
  d.getRange(FB_T, 2, 1, 9).merge().setValue('FINAL FEEDBACK  (filled in the "Feedback" tab by the Final Feedback owner)')
    .setBackground(NAVY).setFontColor('#fff').setFontWeight('bold');
  const r1 = FB_T + 1, r2 = FB_T + 2, r3 = FB_T + 3;
  d.getRange(r1, 2).setValue('Recommendation').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(r1, 3).setFormula('=IF($C$3="","",IF(' + lk('E') + '<>"",' + lk('E') + ',IF(IFERROR(ROWS(FILTER(Feedback!$A$2:$A$500,' + fbHas + ')),0)>0,"Recommendation not chosen",IF(' + fbAsked + '>0,"Waiting for feedback","Not requested yet"))))').setFontWeight('bold');
  d.getRange(r1, 4).setValue('Rating').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(r1, 5, 1, 2).merge().setFormula('=' + lk('D'));
  d.getRange(r1, 7).setValue('Given By / On').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(r1, 8, 1, 3).merge().setFormula('=IF(' + lk('B') + '="","",' + lk('B') +
    '&IFERROR("  on  "&TEXT(' + fbVal('C') + ',"dd-mmm-yyyy"),""))');
  d.getRange(r2, 2).setValue('Strengths').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(r2, 3, 1, 4).merge().setFormula('=' + lk('F'));
  d.getRange(r2, 7).setValue('Areas to Improve').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(r2, 8, 1, 3).merge().setFormula('=' + lk('G'));
  d.getRange(r3, 2).setValue('Comments').setFontWeight('bold').setBackground(LIGHT);
  d.getRange(r3, 3, 1, 8).merge().setFormula('=' + lk('H'));
  d.getRange(r2, 2, 2, 9).setWrap(true).setVerticalAlignment('top');
  d.setRowHeight(r2, 48); d.setRowHeight(r3, 48);
  d.getRange(r1, 2, 3, 9).setBorder(true, true, true, true, true, true, '#c5cae9', SpreadsheetApp.BorderStyle.SOLID);

  // Detail tables
  d.getRange('B' + T_TITLE).setValue('CHECKLIST DETAIL  (Theory and Practical shown separately - use "Show" in E3)')
    .setFontWeight('bold').setFontColor(NAVY);
  d.getRange('G' + T_TITLE).setValue('SCORING DETAIL  (enter scores in the "Scores" tab)')
    .setFontWeight('bold').setFontColor(NAVY);
  d.getRange('B' + T_HEAD + ':F' + T_HEAD).setValues([['Module', 'Topic', 'Covered', 'Date Covered', 'Training Day']]);
  d.getRange('G' + T_HEAD + ':J' + T_HEAD).setValues([['Category', 'Criterion', 'Score', 'Assessor']]);
  [d.getRange('B' + T_HEAD + ':F' + T_HEAD), d.getRange('G' + T_HEAD + ':J' + T_HEAD)].forEach(r =>
    r.setBackground(LIGHT).setFontWeight('bold'));

  const src = '{Checklist!$B$2:$E$5000,Checklist!$J$2:$J$5000}';
  const sec = ty => 'IFERROR(FILTER(' + src + ',Checklist!$A$2:$A$5000=$C$3,Checklist!$G$2:$G$5000="' + ty +
    '"),{"   (no ' + ty.toLowerCase() + ' items)","","","",""})';
  const hd = ty => '{"▶ ' + ty.toUpperCase() + '","","","",""}';
  d.getRange('B' + T_DATA).setFormula('=IF($C$3="","Select a trainee above",' +
    'IF($E$3="Theory",VSTACK(' + hd('Theory') + ',' + sec('Theory') + '),' +
    'IF($E$3="Practical",VSTACK(' + hd('Practical') + ',' + sec('Practical') + '),' +
    'VSTACK(' + hd('Theory') + ',' + sec('Theory') + ',' + hd('Practical') + ',' + sec('Practical') + '))))');
  d.getRange('G' + T_DATA).setFormula('=IF($C$3="","",IFERROR(FILTER(Scores!$B$2:$E$5000,Scores!$A$2:$A$5000=$C$3),"No records"))');
  d.getRange('E' + T_DATA + ':E500').setNumberFormat('dd-mmm-yyyy');
  d.getRange('F' + T_DATA + ':F500').setNumberFormat(DAY_FMT).setHorizontalAlignment('center');
  d.getRange('I' + T_DATA + ':I500').setHorizontalAlignment('center');

  const recCell = d.getRange(r1, 3);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($B' + T_DATA + ',1)="▶"')
      .setBackground('#d1c4e9').setBold(true).setFontColor(NAVY).setRanges([d.getRange('B' + T_DATA + ':F500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$D' + T_DATA + '=TRUE')
      .setBackground('#d9f2d9').setRanges([d.getRange('B' + T_DATA + ':F500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$D' + T_DATA + '=FALSE')
      .setBackground('#fdecea').setRanges([d.getRange('B' + T_DATA + ':F500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($I' + T_DATA + '),$I' + T_DATA + '>=8)')
      .setBackground('#d9f2d9').setRanges([d.getRange('I' + T_DATA + ':I500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($I' + T_DATA + '),$I' + T_DATA + '<=4)')
      .setBackground('#f8c9c4').setRanges([d.getRange('I' + T_DATA + ':I500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Confirm')
      .setBackground('#d9f2d9').setRanges([recCell]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Extend Training')
      .setBackground('#fff3cd').setRanges([recCell]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Not Confirmed')
      .setBackground('#f8c9c4').setRanges([recCell]).build()
  ];
  d.setConditionalFormatRules(rules);

  // Charts
  d.insertChart(d.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(d.getRange('B' + HDR + ':B' + (rALL - 1))).addRange(d.getRange('D' + HDR + ':D' + (rALL - 1)))
    .setNumHeaders(1).setPosition(3, 12, 0, 0)
    .setOption('title', 'Training Progress by Phase')
    .setOption('legend', { position: 'none' })
    .setOption('hAxis', { minValue: 0, maxValue: 1, format: '0%' })
    .setOption('colors', ['#34a853']).setOption('width', 460).setOption('height', 280).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(d.getRange('G' + HDR + ':G' + (sALL - 1))).addRange(d.getRange('H' + HDR + ':H' + (sALL - 1)))
    .setNumHeaders(1).setPosition(21, 12, 0, 0)
    .setOption('title', 'Average Score (out of 10)')
    .setOption('legend', { position: 'none' })
    .setOption('vAxis', { minValue: 0, maxValue: 10 })
    .setOption('colors', ['#fb8c00']).setOption('width', 460).setOption('height', 280).build());
}

// ===================== ADD TRAINEE =====================
function showAddTraineeDialog() {
  const list = designationList();
  const opts = list.map(x => '<option value="' + escAttr(x) + '">' + esc(x) + '</option>').join('');
  const baseOpts = list.filter(x => x.toLowerCase() !== 'other')
    .map(x => '<option value="' + escAttr(x) + '">Same items as ' + esc(x) + '</option>').join('');
  const html = HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial;padding:12px}label{display:block;margin-top:10px;font-weight:bold;font-size:13px}' +
    'input,select{width:95%;padding:6px;margin-top:3px}button{margin-top:16px;padding:8px 18px;background:#1a237e;color:#fff;border:0;cursor:pointer}' +
    '#ob{display:none;background:#f3f4fb;border:1px solid #c5cae9;padding:4px 10px 10px;margin-top:8px}</style>' +
    '<label>Trainee Name *</label><input id="name">' +
    '<label>Email</label><input id="email" type="email">' +
    '<label>Department / Clinic</label><input id="dept">' +
    '<label>Designation *</label><select id="desig" onchange="tg()"><option value="">Select designation</option>' + opts + '</select>' +
    '<div id="ob"><label>Type the designation</label><input id="desigNew" placeholder="e.g. Dietitian, Front Desk Executive">' +
    '<label>Checklist items to give</label><select id="desigBase">' +
    '<option value="All">All items (remove what does not apply)</option>' + baseOpts + '</select>' +
    '<div style="font-size:11px;color:#555;margin-top:6px">The new designation is saved to the Lists tab, so next time you can pick it from the dropdown.</div></div>' +
    '<label>Joining Date</label><input id="join" type="date">' +
    '<label>Trainer</label><input id="trainer">' +
    '<button id="btn" onclick="go()">Add Trainee</button> <span id="msg" style="color:#c00"></span>' +
    '<script>function v(i){return document.getElementById(i).value;}' +
    'function tg(){document.getElementById("ob").style.display=(v("desig").toLowerCase()=="other")?"block":"none";}' +
    'function go(){var b=document.getElementById("btn");b.disabled=true;' +
    'var d={name:v("name"),email:v("email"),dept:v("dept"),desig:v("desig"),desigNew:v("desigNew"),desigBase:v("desigBase"),join:v("join"),trainer:v("trainer")};' +
    'google.script.run.withSuccessHandler(function(m){alert(m);google.script.host.close();})' +
    '.withFailureHandler(function(e){b.disabled=false;document.getElementById("msg").innerText=e.message;}).addTraineeFromForm(d);}</script>'
  ).setWidth(400).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add New Trainee');
}

function addTraineeFromForm(d) {
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Trainee name is required.');
  if (!d.desig) throw new Error('Please select a designation.');
  let sh = SS().getSheetByName(SHEETS.TR);
  if (!sh) { setupTrainingModule(); sh = SS().getSheetByName(SHEETS.TR); }
  if (!sh) throw new Error('Trainees tab not found. Open Extensions > Apps Script and run setupTrainingModule first.');
  const last = lastRowOfCol(sh, 2);
  const existing = last > 1 ? sh.getRange(2, 2, last - 1, 1).getValues().flat().map(n => String(n).toLowerCase()) : [];
  if (existing.indexOf(name.toLowerCase()) > -1) throw new Error('A trainee with this name already exists.');

  // "Other" + typed designation -> save it as a new designation
  let desig = String(d.desig).trim();
  if (desig.toLowerCase() === 'other' && String(d.desigNew || '').trim()) {
    desig = addCustomDesignation(String(d.desigNew).trim(), String(d.desigBase || 'All').trim());
  }

  const row = last + 1;
  const join = d.join ? new Date(d.join + 'T00:00:00') : new Date();
  sh.getRange(row, 2, 1, 7).setValues([[name, d.email || '', d.dept || '', desig, join, d.trainer || '', STAGES[0]]]);
  fillTraineeRow(row);
  ensureRows(name);
  return 'Trainee "' + name + '" added as ' + desig + '. Induction and Onboarding rows created. Use the Handover tab for the next phases.';
}

// Saves a typed designation in Lists column D (before "Other") and records which checklist it uses (Lists H:I)
function addCustomDesignation(nd, base) {
  const li = SS().getSheetByName(SHEETS.LI);
  const vals = li.getRange('D2:D50').getValues().map(r => String(r[0]).trim()).filter(String);
  const found = vals.filter(x => x.toLowerCase() === nd.toLowerCase())[0];
  if (found && found.toLowerCase() === 'other') return 'Other';
  const name = found || nd;
  if (!found) {
    const rest = vals.filter(x => x.toLowerCase() !== 'other');
    rest.push(nd); rest.push('Other');
    if (rest.length > 49) throw new Error('The designation list is full (Lists tab, column D). Remove an unused one first.');
    li.getRange('D2:D50').clearContent();
    li.getRange(2, 4, rest.length, 1).setValues(rest.map(x => [x]));
  }
  const isStandard = DESIGNATIONS.map(x => x.toLowerCase()).indexOf(name.toLowerCase()) > -1;
  if (!isStandard) {
    const map = li.getRange('H2:I50').getValues();
    let idx = map.findIndex(r => String(r[0]).trim().toLowerCase() === name.toLowerCase());
    if (idx === -1) idx = map.findIndex(r => !String(r[0]).trim());
    if (idx > -1) li.getRange(2 + idx, 8, 1, 2).setValues([[name, base || 'All']]);
  }
  _desigCache = null; _customCache = null;
  return name;
}

function fillTraineeRow(r) {
  const sh = SS().getSheetByName(SHEETS.TR);
  if (!sh.getRange(r, 1).getValue()) sh.getRange(r, 1).setValue('TR-' + String(r - 1).padStart(3, '0'));
  sh.getRange(r, 10).setFormula('=IFERROR(COUNTIFS(Checklist!$A:$A,B' + r + ',Checklist!$D:$D,TRUE)/COUNTIFS(Checklist!$A:$A,B' + r + '),0)');
  sh.getRange(r, 11).setFormula('=IFERROR(AVERAGEIFS(Scores!$D:$D,Scores!$A:$A,B' + r + ')/10,0)');
  if (!sh.getRange(r, 12).getValue()) sh.getRange(r, 12).setValue('Active');
  if (!sh.getRange(r, 8).getValue()) sh.getRange(r, 8).setValue(STAGES[0]);
  const del = sh.getRange(r, DEL_COL), dv = del.getValue();
  if (dv !== true && dv !== false) del.insertCheckboxes();
  // Training days: closed -> Closed On - Joining; Active -> today - Joining (running)
  sh.getRange(r, 14).setFormula('=IF(OR(B' + r + '="",F' + r + '=""),"",IF(M' + r + '<>"",INT(M' + r + ')-INT(F' + r +
    '),IF(L' + r + '="Active",INT(TODAY())-INT(F' + r + '),"")))');
}

function syncAllTrainees() {
  migratePhases();                                   // repairs templates / stage names first
  ensureNewSheetsAndColumns();
  const cleaned = autoCleanDeleted_();               // remove data of trainees no longer in the Trainees tab
  clearStaleSelection();
  const sh = SS().getSheetByName(SHEETS.TR);
  const last = lastRowOfCol(sh, 2);
  let added = 0, n = 0;
  for (let r = 2; r <= last; r++) {
    const name = String(sh.getRange(r, 2).getValue()).trim();
    if (!name) continue;
    fillTraineeRow(r);
    added += ensureRows(name, true);
    n++;
  }
  sortChecklist();
  refreshChecklistDays();
  SS().toast(n + ' trainee(s) checked, ' + added + ' new row(s) added' +
    (cleaned ? ', ' + cleaned + ' row(s) of deleted trainees removed' : '') + '.', 'Sync done', 6);
}

function traineeNames() {
  const sh = SS().getSheetByName(SHEETS.TR);
  const last = lastRowOfCol(sh, 2);
  const set = new Set();
  if (last > 1) sh.getRange(2, 2, last - 1, 1).getValues().forEach(r => {
    const v = String(r[0]).trim();
    if (v) set.add(v);
  });
  return set;
}

// Phases a trainee has reached: Induction + Onboarding, current stage, and every phase ever handed to them
function phasesFor(name) {
  const ss = SS();
  const set = new Set(ALWAYS_PHASES);
  const tr = ss.getSheetByName(SHEETS.TR);
  const lt = lastRowOfCol(tr, 2);
  for (let r = 2; r <= lt; r++) {
    if (String(tr.getRange(r, 2).getValue()).trim() === name) { set.add(LEGACY_STAGES[tr.getRange(r, 8).getValue()] || tr.getRange(r, 8).getValue()); break; }
  }
  const ho = ss.getSheetByName(SHEETS.HO);
  const lh = lastRowOfCol(ho, 1);
  if (lh > 1) {
    ho.getRange(2, 1, lh - 1, 2).getValues().forEach(v => {
      if (v[0] === name && v[1]) set.add(LEGACY_STAGES[v[1]] || v[1]);
    });
  }
  return set;
}

function ensureRows(name, skipSort) {
  const ss = SS();
  const phases = phasesFor(name);
  const desig = designationOf(name);
  const removed = removedSet(name);
  const addedCl = addMissing(ss.getSheetByName(SHEETS.CL), ss.getSheetByName(SHEETS.CT), name, true, phases, desig, removed);
  const total = addedCl +
         addMissing(ss.getSheetByName(SHEETS.SC), ss.getSheetByName(SHEETS.ST), name, false, phases, desig, removed) +
         addMissingAssessment(name, phases, desig) +
         addMissingFeedback(name, phases);
  if (addedCl && !skipSort) sortChecklist();
  return total;
}

// Phase of a template row. Older values ("All", blank, "Branch Manager") are understood too.
function phaseOf(ph, key, map) {
  ph = String(ph || '').trim();
  if (STAGES.indexOf(ph) > -1) return ph;
  if (ph === 'Branch Manager') return 'Operations Training';
  return map[key] || '';
}

// Practical if the topic is something the trainee does / demonstrates; otherwise Theory (editable in the template)
function typeFor(topic) {
  return /tour|login|meet the team|observation|scenario|one-to-one|photo|independently|shadow|^ran |completed|submitted|raised|sign-off|role-play|mock|briefing|walk /i
    .test(String(topic)) ? 'Practical' : 'Theory';
}

let _desigCache = null;
// Designations come from the Lists tab (column D), so you can add your own there
function designationList() {
  if (_desigCache) return _desigCache;
  const li = SS().getSheetByName(SHEETS.LI);
  let list = li ? li.getRange('D2:D50').getValues().map(r => String(r[0]).trim()).filter(String) : [];
  if (!list.length) list = DESIGNATIONS.slice();
  _desigCache = list;
  return list;
}

let _customCache = null;
// Custom designation -> which checklist it uses (Lists H:I). Lower-case keys.
function customBaseMap_() {
  if (_customCache) return _customCache;
  const li = SS().getSheetByName(SHEETS.LI), map = {};
  if (li) li.getRange('H2:I50').getValues().forEach(r => {
    const k = String(r[0]).trim().toLowerCase();
    if (k) map[k] = String(r[1]).trim().toLowerCase() || 'all';
  });
  _customCache = map;
  return map;
}

// Row applies when Designation is blank / All / lists the trainee's designation.
// Custom designation: uses the checklist chosen for it (Lists H:I).
// "Other", blank or unlisted designation = show everything (items can be removed with the Remove tick).
function matchesDesignation(ds, desig) {
  const list = String(ds || '').split(',').map(x => x.trim().toLowerCase()).filter(String);
  if (!list.length || list.indexOf('all') > -1) return true;
  let d = String(desig || '').trim().toLowerCase();
  const cm = customBaseMap_();
  for (let i = 0; i < 5 && cm[d]; i++) {
    if (cm[d] === 'all') return true;
    d = cm[d];
  }
  if (d === 'other' || designationList().map(x => x.toLowerCase()).indexOf(d) === -1) return true;
  return list.indexOf(d) > -1;
}

function designationOf(name) {
  const sh = SS().getSheetByName(SHEETS.TR);
  const last = lastRowOfCol(sh, 2);
  for (let r = 2; r <= last; r++) {
    if (String(sh.getRange(r, 2).getValue()).trim() === name) return String(sh.getRange(r, 5).getValue()).trim();
  }
  return '';
}

// Checklist items this trainee removed (so they are not created again)
function removedSet(name) {
  const rem = SS().getSheetByName(SHEETS.REM), set = new Set();
  if (!rem) return set;
  const last = lastRowOfCol(rem, 1);
  if (last > 1) rem.getRange(2, 1, last - 1, 3).getValues().forEach(r => {
    if (String(r[0]).trim() === name) set.add(String(r[1]).trim() + '|' + String(r[2]).trim());
  });
  return set;
}

// Template row applies if its phase is blank (everyone) or reached, and the designation matches
function addMissing(target, tpl, name, isChecklist, phases, desig, removed) {
  const map = isChecklist ? MODULE_PHASE : CAT_PHASE;
  const t = tpl.getRange(2, 1, Math.max(tpl.getLastRow() - 1, 1), 5).getValues()
    .map(r => ({ a: String(r[0]).trim(), b: String(r[1]).trim(), ph: phaseOf(r[2], String(r[0]).trim(), map),
                 ds: r[3], ty: String(r[4] || '').trim() }))
    .filter(r => r.a && r.b && (!r.ph || phases.has(r.ph)) && matchesDesignation(r.ds, desig));
  const last = Math.max(target.getLastRow(), 1);
  const have = new Set(last > 1
    ? target.getRange(2, 1, last - 1, 3).getValues().filter(r => String(r[0]).trim() === name).map(r => String(r[1]).trim() + '|' + String(r[2]).trim())
    : []);
  const rows = t.filter(r => !have.has(r.a + '|' + r.b) && !(isChecklist && removed.has(r.a + '|' + r.b)))
    .map(r => isChecklist ? [name, r.a, r.b, false, '', '', r.ty || typeFor(r.b), '', false, ''] : [name, r.a, r.b, '', '', '']);
  if (!rows.length) return 0;
  const start = last + 1;
  target.getRange(start, 1, rows.length, isChecklist ? 10 : 6).setValues(rows);
  if (isChecklist) {
    target.getRange(start, 4, rows.length, 1).insertCheckboxes();
    target.getRange(start, 9, rows.length, 1).insertCheckboxes();
  } else {
    target.getRange(start, 4, rows.length, 1).setDataValidation(scoreRule());
  }
  return rows.length;
}

// Trainee Q&A rows (Assessment tab) for the phases reached and designation.
// Handover "Assessment" = questions of every department (that match the designation).
function addMissingAssessment(name, phases, desig) {
  const ss = SS(), asm = ss.getSheetByName(SHEETS.ASM), qb = ss.getSheetByName(SHEETS.QB);
  if (!asm || !qb) return 0;
  const lq = lastRowOfCol(qb, 2);
  if (lq < 2) return 0;
  const allDepts = phases.has('Assessment');
  const q = qb.getRange(2, 1, lq - 1, 4).getValues()
    .map(r => ({ dep: String(r[0]).trim(), q: String(r[1]).trim(), kp: r[2], ds: r[3] }))
    .filter(r => r.dep && r.q && (allDepts || phases.has(DEPT_PHASE[r.dep] || '')) && matchesDesignation(r.ds, desig));
  const last = Math.max(lastRowOfCol(asm, 1), 1);
  const have = new Set(last > 1
    ? asm.getRange(2, 1, last - 1, 3).getValues().filter(r => String(r[0]).trim() === name).map(r => String(r[1]).trim() + '|' + String(r[2]).trim())
    : []);
  const rows = q.filter(r => !have.has(r.dep + '|' + r.q)).map(r => [name, r.dep, r.q, r.kp, '', '', '', '', '']);
  if (!rows.length) return 0;
  const start = last + 1;
  asm.getRange(start, 1, rows.length, 9).setValues(rows);
  asm.getRange(start, 6, rows.length, 1).setDataValidation(ratingRule());
  asm.getRange(start, 7, rows.length, 1).setFormulas(rows.map((r, i) =>
    ['=IFERROR(VLOOKUP(F' + (start + i) + ',Lists!$E$2:$F$20,2,FALSE),"")']));
  return rows.length;
}

// One Feedback row per trainee once they are handed over for Final Feedback (or Final Review)
function addMissingFeedback(name, phases) {
  if (!phases.has('Final Feedback') && !phases.has('Final Review & Confirmation')) return 0;
  const fb = SS().getSheetByName(SHEETS.FB);
  if (!fb) return 0;
  const last = lastRowOfCol(fb, 1);
  if (last > 1 && fb.getRange(2, 1, last - 1, 1).getValues().some(r => String(r[0]).trim() === name)) return 0;
  fb.getRange(last + 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(SS().getSheetByName(SHEETS.TR).getRange('B2:B500'), true).setAllowInvalid(false).build());
  fb.getRange(last + 1, 1, 1, 8).setValues([[name, '', '', '', '', '', '', '']]);
  return 1;
}

// Tick "Remove" on the Checklist: log it and delete the row for good
function removeChecklistRow(r, by) {
  const cl = SS().getSheetByName(SHEETS.CL);
  const v = cl.getRange(r, 1, 1, 9).getValues()[0];
  const rem = ensureRemovedSheet();
  const row = Math.max(lastRowOfCol(rem, 1), 1) + 1;
  rem.getRange(row, 1, 1, 7).setValues([[v[0], v[1], v[2], v[6], by, new Date(), false]]);
  rem.getRange(row, 7).insertCheckboxes();
  cl.deleteRow(r);
}

// Menu: put back items that were removed (tick "Restore?" in Removed_Items first)
function restoreRemovedItems() {
  const ss = SS(), ui = SpreadsheetApp.getUi();
  const rem = ss.getSheetByName(SHEETS.REM), cl = ss.getSheetByName(SHEETS.CL);
  const last = rem ? lastRowOfCol(rem, 1) : 1;
  if (last < 2) { ss.toast('Nothing has been removed yet.', 'Restore', 5); return; }
  const data = rem.getRange(2, 1, last - 1, 7).getValues();
  const hit = [];
  data.forEach((r, i) => { if (r[6] === true) hit.push(i); });
  if (!hit.length) {
    ui.alert('Tick "Restore?" next to the items you want back in the Removed_Items tab, then run this again.');
    return;
  }
  const names = traineeNames();
  const rows = hit.map(i => data[i]).filter(r => names.has(String(r[0]).trim()))
    .map(r => [r[0], r[1], r[2], false, '', '', r[3], '', false, '']);
  if (rows.length) {
    const start = Math.max(lastRowOfCol(cl, 1), 1) + 1;
    cl.getRange(start, 1, rows.length, 10).setValues(rows);
    cl.getRange(start, 4, rows.length, 1).insertCheckboxes();
    cl.getRange(start, 9, rows.length, 1).insertCheckboxes();
  }
  hit.slice().reverse().forEach(i => rem.deleteRow(i + 2));
  sortChecklist();
  ss.toast(hit.length + ' item(s) restored.', 'Restore done', 6);
}

// ===================== THEORY / PRACTICAL SORT =====================
// Checklist order: trainee (as in Trainees tab) > Theory first, then Practical > phase > module > template order
function sortChecklist() {
  const ss = SS(), cl = ss.getSheetByName(SHEETS.CL);
  if (!cl) return;
  const last = lastRowOfCol(cl, 1);
  if (last < 3) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    const n = last - 1, rng = cl.getRange(2, 1, n, 10), vals = rng.getValues();
    const tOrder = {}; let k = 0;
    traineeNames().forEach(nm => { tOrder[nm] = k++; });
    const tplIdx = {};
    const ct = ss.getSheetByName(SHEETS.CT), lt = lastRowOfCol(ct, 2);
    if (lt > 1) ct.getRange(2, 1, lt - 1, 2).getValues().forEach((r, i) => {
      tplIdx[String(r[0]).trim() + '|' + String(r[1]).trim()] = i;
    });
    const keyOf = (r, i) => {
      const nm = String(r[0]).trim(), mod = String(r[1]).trim();
      const ph = STAGES.indexOf(MODULE_PHASE[mod]);
      const mi = MODULES.indexOf(mod);
      const ti = tplIdx[mod + '|' + String(r[2]).trim()];
      return [nm in tOrder ? tOrder[nm] : 9999, nm,
              String(r[6]).trim() === 'Practical' ? 1 : 0,
              ph < 0 ? 99 : ph, mi < 0 ? 999 : mi, ti === undefined ? 99999 : ti, i];
    };
    const keys = vals.map(keyOf);
    const order = vals.map((r, i) => i).sort((a, b) => {
      const x = keys[a], y = keys[b];
      for (let j = 0; j < x.length; j++) {
        if (x[j] < y[j]) return -1;
        if (x[j] > y[j]) return 1;
      }
      return 0;
    });
    if (order.every((v, i) => v === i)) return;        // already sorted
    rng.setValues(order.map(i => vals[i]));
  } finally {
    lock.releaseLock();
  }
}

function sortChecklistMenu() {
  sortChecklist();
  SS().toast('Checklist sorted: Theory first, then Practical, for each trainee.', 'Sorted', 5);
}

// ===================== TRAINING TIME + INSIGHTS =====================
function todayDate() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// Day number of a date in the training (Day 1 = joining date)
function dayNo_(dt, join) {
  if (!(dt instanceof Date) || !(join instanceof Date) || isNaN(dt.getTime()) || isNaN(join.getTime())) return '';
  const a = new Date(dt.getTime()); a.setHours(0, 0, 0, 0);
  const b = new Date(join.getTime()); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / 86400000) + 1;
}

function joinMap_() {
  const sh = SS().getSheetByName(SHEETS.TR), map = {};
  const last = lastRowOfCol(sh, 2);
  if (last > 1) sh.getRange(2, 2, last - 1, 5).getValues().forEach(r => {
    const nm = String(r[0]).trim();
    if (nm) map[nm] = r[4];
  });
  return map;
}

// Recalculates Checklist column J (Training Day) for every ticked item
function refreshChecklistDays() {
  const cl = SS().getSheetByName(SHEETS.CL);
  if (!cl) return;
  const last = lastRowOfCol(cl, 1);
  if (last < 2) return;
  const jm = joinMap_();
  const v = cl.getRange(2, 1, last - 1, 5).getValues();
  cl.getRange(2, 10, last - 1, 1).setValues(v.map(r =>
    [r[3] === true ? dayNo_(r[4] instanceof Date ? r[4] : null, jm[String(r[0]).trim()]) : '']));
}

// Trainees tab: M = Closed On, N = Training Days
function ensureTrainingTimeColumns() {
  const tr = SS().getSheetByName(SHEETS.TR);
  tr.getRange('M1:N1').setValues([['Closed On', 'Training Days']]);
  styleHeader(tr.getRange('M1:N1'));
  tr.setColumnWidth(13, 130); tr.setColumnWidth(14, 120);
  tr.getRange('M2:M500').setNumberFormat('dd-mmm-yyyy');
  tr.getRange('N2:N500').setNumberFormat('0');
  tr.getRange('M1').setNote('Auto-filled when Status = Completed, or when the Final Review & Confirmation handover is set to Completed. You can also type a date.');
  tr.getRange(1, DEL_COL).setValue('Delete Trainee');
  styleHeader(tr.getRange(1, DEL_COL));
  tr.setColumnWidth(DEL_COL, 120);
  tr.getRange(1, DEL_COL).setNote('Tick to delete this trainee. You will be asked to confirm. Removes the trainee and all their Checklist, Scores, Handover, Assessment and Feedback rows.');
  const last = lastRowOfCol(tr, 2);
  if (last > 1) {
    const o = tr.getRange(2, DEL_COL, last - 1, 1);
    if (o.getValues().some(r => r[0] !== true && r[0] !== false)) o.insertCheckboxes();
  }
}

// Final review finished: mark trainee Completed and stamp Closed On
function closeTraining(name) {
  const sh = SS().getSheetByName(SHEETS.TR);
  const last = lastRowOfCol(sh, 2);
  for (let r = 2; r <= last; r++) {
    if (String(sh.getRange(r, 2).getValue()).trim() === name) {
      sh.getRange(r, 12).setValue('Completed');
      if (sh.getRange(r, 13).getValue() === '') sh.getRange(r, 13).setValue(todayDate());
      return;
    }
  }
}

function rebuildDashboards() {
  syncAllTrainees();
  buildInsights();
  buildDashboard();
  SS().toast('Dashboard and Insights rebuilt.', 'Done', 5);
}

function buildInsights() {
  const ss = SS();
  let d = ss.getSheetByName(SHEETS.INS);
  if (d) {
    d.getRange(1, 1, d.getMaxRows(), d.getMaxColumns()).breakApart();
    d.clear();
    d.clearConditionalFormatRules();
  } else {
    d = ss.insertSheet(SHEETS.INS);
  }
  d.setHiddenGridlines(true);
  [180, 115, 115, 105, 100, 200, 90, 90, 90, 90, 100, 100, 100].forEach((w, i) => d.setColumnWidth(i + 1, w));

  const NAVY = '#1a237e', LIGHT = '#e8eaf6';
  const HDR = 12, FIRST = 13, CAP = 60, LAST = FIRST + CAP - 1;     // room for 60 trainees
  const OFF = FIRST - 2;                                            // table row -> Trainees row
  const rng = col => col + FIRST + ':' + col + LAST;
  const HR_MODS = PHASES[0].modules.concat(PHASES[1].modules);
  const SALES_MODS = SALES_MODULES, OPS_MODS = OPS_MODULES;

  d.getRange('A1:M1').merge().setValue('TRAINING INSIGHTS  |  ' + COMPANY)
    .setBackground(NAVY).setFontColor('#fff').setFontSize(16).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  d.setRowHeight(1, 44);

  // --- Training time block
  d.getRange('A2:B2').setValues([['TRAINING TIME', '']]).setBackground(NAVY).setFontColor('#fff').setFontWeight('bold');
  const kp = [
    ['Total trainees', '=COUNTIF(' + rng('A') + ',"?*")'],
    ['Completed', '=COUNTIF(' + rng('E') + ',"Completed")'],
    ['Still running (Active)', '=COUNTIF(' + rng('E') + ',"Active")'],
    ['Avg days to close', '=IFERROR(AVERAGEIFS(' + rng('D') + ',' + rng('E') + ',"Completed"),"-")'],
    ['Fastest / slowest (days)', '=IF(B4=0,"-",MINIFS(' + rng('D') + ',' + rng('E') + ',"Completed")&" / "&MAXIFS(' + rng('D') + ',' + rng('E') + ',"Completed"))'],
    ['Avg days so far (Active)', '=IFERROR(AVERAGEIFS(' + rng('D') + ',' + rng('E') + ',"Active"),"-")']
  ];
  kp.forEach((k, i) => {
    d.getRange(3 + i, 1).setValue(k[0]).setFontWeight('bold').setBackground(LIGHT);
    d.getRange(3 + i, 2).setFormula(k[1]).setHorizontalAlignment('center').setFontWeight('bold');
  });
  d.getRange('B6').setNumberFormat('0.0'); d.getRange('B8').setNumberFormat('0.0');

  // --- Completion + Q&A block
  d.getRange('F2:H2').setValues([['AVERAGE (all trainees)', 'Value', 'Trainees']])
    .setBackground(NAVY).setFontColor('#fff').setFontWeight('bold');
  [['HR-wise completion (Induction + Onboarding)', 'G', '0%'], ['Sales-wise completion', 'H', '0%'],
   ['Ops-wise completion', 'I', '0%'], ['Overall completion', 'J', '0%'],
   ['HR Q&A score (/10)', 'K', '0.0'], ['Sales Q&A score (/10)', 'L', '0.0'], ['Ops Q&A score (/10)', 'M', '0.0']
  ].forEach((p, i) => {
    d.getRange(3 + i, 6).setValue(p[0]).setFontWeight('bold').setBackground(LIGHT);
    d.getRange(3 + i, 7).setFormula('=IFERROR(AVERAGE(' + rng(p[1]) + '),"n/a")').setNumberFormat(p[2])
      .setHorizontalAlignment('center').setFontWeight('bold');
    d.getRange(3 + i, 8).setFormula('=COUNT(' + rng(p[1]) + ')').setHorizontalAlignment('center');
  });

  // --- Trainee-wise table
  d.getRange('A11').setValue('TRAINEE-WISE  (new trainees appear here automatically; "n/a" = not started / no answers rated yet)')
    .setFontWeight('bold').setFontColor(NAVY);
  d.getRange(HDR, 1, 1, 13).setValues([['Trainee', 'Joining Date', 'Closed On', 'Training Days', 'Status',
    'Current Stage', 'HR %', 'Sales %', 'Ops %', 'Overall %', 'HR Q&A (/10)', 'Sales Q&A (/10)', 'Ops Q&A (/10)']])
    .setBackground(NAVY).setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  d.setFrozenRows(HDR);

  const grp = (mods, done) => '(' + mods.map(m => 'COUNTIFS(Checklist!$A:$A,$A' + FIRST + ',Checklist!$B:$B,"' + m + '"' +
    (done ? ',Checklist!$D:$D,TRUE' : '') + ')').join('+') + ')';
  const pull = col => '=IF($A' + FIRST + '="","",IF(INDEX(Trainees!$' + col + ':$' + col + ',ROW()-' + OFF + ')="","",INDEX(Trainees!$' + col + ':$' + col + ',ROW()-' + OFF + ')))';
  const pct = mods => '=IF($A' + FIRST + '="","",IFERROR(' + grp(mods, true) + '/' + grp(mods, false) + ',"n/a"))';
  const qa = dep => '=IF($A' + FIRST + '="","",IFERROR(AVERAGEIFS(Assessment!$G:$G,Assessment!$A:$A,$A' + FIRST + ',Assessment!$B:$B,"' + dep + '"),"n/a"))';

  d.getRange('A' + FIRST).setFormula('=IF(INDEX(Trainees!$B:$B,ROW()-' + OFF + ')="","",INDEX(Trainees!$B:$B,ROW()-' + OFF + '))');
  d.getRange('B' + FIRST).setFormula(pull('F'));
  d.getRange('C' + FIRST).setFormula(pull('M'));
  d.getRange('D' + FIRST).setFormula(pull('N'));
  d.getRange('E' + FIRST).setFormula(pull('L'));
  d.getRange('F' + FIRST).setFormula(pull('H'));
  d.getRange('G' + FIRST).setFormula(pct(HR_MODS));
  d.getRange('H' + FIRST).setFormula(pct(SALES_MODS));
  d.getRange('I' + FIRST).setFormula(pct(OPS_MODS));
  d.getRange('J' + FIRST).setFormula('=IF($A' + FIRST + '="","",IFERROR(COUNTIFS(Checklist!$A:$A,$A' + FIRST +
    ',Checklist!$D:$D,TRUE)/COUNTIFS(Checklist!$A:$A,$A' + FIRST + '),"n/a"))');
  d.getRange('K' + FIRST).setFormula(qa('HR'));
  d.getRange('L' + FIRST).setFormula(qa('Sales'));
  d.getRange('M' + FIRST).setFormula(qa('Operations'));
  d.getRange('A' + FIRST + ':M' + FIRST).copyTo(d.getRange('A' + (FIRST + 1) + ':M' + LAST));   // fill down

  d.getRange('B' + FIRST + ':C' + LAST).setNumberFormat('dd-mmm-yyyy').setHorizontalAlignment('center');
  d.getRange('D' + FIRST + ':E' + LAST).setHorizontalAlignment('center');
  d.getRange('D' + FIRST + ':D' + LAST).setNumberFormat('0');
  d.getRange('G' + FIRST + ':J' + LAST).setNumberFormat('0%').setHorizontalAlignment('center');
  d.getRange('K' + FIRST + ':M' + LAST).setNumberFormat('0.0').setHorizontalAlignment('center');
  d.getRange('A' + HDR + ':M' + LAST).setBorder(true, true, true, true, true, true, '#c5cae9', SpreadsheetApp.BorderStyle.SOLID);

  d.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0.8)
      .setBackground('#d9f2d9').setRanges([d.getRange('G' + FIRST + ':J' + LAST)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.4)
      .setBackground('#fdecea').setRanges([d.getRange('G' + FIRST + ':J' + LAST)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(8)
      .setBackground('#d9f2d9').setRanges([d.getRange('K' + FIRST + ':M' + LAST)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(5)
      .setBackground('#fdecea').setRanges([d.getRange('K' + FIRST + ':M' + LAST)]).build()
  ]);
}

// Clears the Dashboard trainee selector when that trainee no longer exists in the Trainees tab
function clearStaleSelection() {
  const d = SS().getSheetByName(SHEETS.DASH);
  if (!d) return;
  const v = String(d.getRange('C3').getValue()).trim();
  if (v && !traineeNames().has(v)) d.getRange('C3').clearContent();
}

// Runs when a row is removed anywhere: if a Trainees row was deleted, their data is cleaned everywhere
function onChangeHandler(e) {
  try {
    if (e && e.changeType === 'REMOVE_ROW') {
      autoCleanDeleted_();
      clearStaleSelection();
    }
  }
  catch (err) { PropertiesService.getScriptProperties().setProperty('lastError', new Date().toISOString() + ' ' + err.message); }
}

// ===================== DELETED / RENAMED TRAINEES =====================
function dataSheets_() {
  const ss = SS();
  return [SHEETS.CL, SHEETS.SC, SHEETS.HO, SHEETS.ASM, SHEETS.REM, SHEETS.FB]
    .map(n => ss.getSheetByName(n)).filter(x => x);
}

// Automatic clean-up (no prompt): removes rows of trainees who are no longer in the Trainees tab
function autoCleanDeleted_() {
  const ss = SS(), tr = ss.getSheetByName(SHEETS.TR);
  if (!tr || String(tr.getRange('B1').getValue()).trim() !== 'Trainee Name') return 0;   // safety: Trainees tab must be intact
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return 0;
  try {
    const names = traineeNames();
    let removed = 0;
    dataSheets_().forEach(sh => { removed += deleteRowsWhere(sh, v => v !== '' && !names.has(v)); });
    if (removed) ss.toast(removed + ' row(s) of deleted trainee(s) removed from Checklist, Scores, Handover, Assessment and Feedback.', 'Cleaned', 6);
    return removed;
  } finally {
    lock.releaseLock();
  }
}

// Trainee renamed in the Trainees tab: move all their data to the new name
function renameTrainee(oldN, newN) {
  dataSheets_().forEach(sh => {
    const last = lastRowOfCol(sh, 1);
    if (last < 2) return;
    const rng = sh.getRange(2, 1, last - 1, 1);
    let changed = false;
    const out = rng.getValues().map(r => {
      if (String(r[0]).trim() === oldN) { changed = true; return [newN]; }
      return [r[0]];
    });
    if (changed) rng.setValues(out);
  });
  const d = SS().getSheetByName(SHEETS.DASH);
  if (d && String(d.getRange('C3').getValue()).trim() === oldN) d.getRange('C3').setValue(newN);
}

// Menu version: shows what will be deleted and asks first
function cleanupDeletedTrainees() {
  const ss = SS(), ui = SpreadsheetApp.getUi();
  const names = traineeNames();
  clearStaleSelection();
  const sheets = dataSheets_();
  const orphans = {};
  sheets.forEach(sh => {
    const last = lastRowOfCol(sh, 1);
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(r => {
      const v = String(r[0]).trim();
      if (v && !names.has(v)) orphans[v] = (orphans[v] || 0) + 1;
    });
  });
  const list = Object.keys(orphans);
  if (!list.length) { ss.toast('No leftover data found.', 'Clean up', 5); return; }
  const ans = ui.alert('Delete data of trainees no longer in the Trainees tab?',
    list.map(n => '- ' + n + ' (' + orphans[n] + ' rows)').join('\n') +
    '\n\nThis removes their Checklist, Scores, Handover, Assessment and Feedback rows and cannot be undone.' +
    '\nIf one of these is only a RENAMED trainee, click NO and fix the name in those tabs instead.',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;
  let removed = 0;
  sheets.forEach(sh => { removed += deleteRowsWhere(sh, v => v !== '' && !names.has(v)); });
  clearStaleSelection();
  ss.toast(removed + ' row(s) removed.', 'Clean up done', 6);
}

function deleteRowsWhere(sh, test) {
  const last = lastRowOfCol(sh, 1);
  if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  let removed = 0, end = -1;
  for (let i = vals.length - 1; i >= -1; i--) {
    const hit = i >= 0 && test(String(vals[i][0]).trim());
    if (hit) { if (end === -1) end = i; }
    else if (end !== -1) {
      const start = i + 1;
      sh.deleteRows(start + 2, end - start + 1);
      removed += end - start + 1;
      end = -1;
    }
  }
  return removed;
}

// ===================== DELETE TRAINEE =====================
// Deletes the trainee row(s) and every row of their data in the other tabs
function deleteTrainee(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Pick a trainee.');
  const ss = SS(), tr = ss.getSheetByName(SHEETS.TR);
  const last = lastRowOfCol(tr, 2);
  let found = 0;
  for (let r = last; r >= 2; r--) {
    if (String(tr.getRange(r, 2).getValue()).trim() === name) { tr.deleteRow(r); found++; }
  }
  if (!found) throw new Error('"' + name + '" is not in the Trainees tab.');
  let removed = 0;
  dataSheets_().forEach(sh => { removed += deleteRowsWhere(sh, v => v === name); });
  clearStaleSelection();
  return 'Trainee "' + name + '" deleted, with ' + removed + ' row(s) of their data.';
}

// Tick in Trainees column O: confirm, then delete
function confirmDeleteFromTick_(row) {
  const tr = SS().getSheetByName(SHEETS.TR);
  const name = String(tr.getRange(row, 2).getValue()).trim();
  const box = tr.getRange(row, DEL_COL);
  if (!name) { box.setValue(false); return; }
  let ok = false;
  try {
    const ui = SpreadsheetApp.getUi();
    ok = ui.alert('Delete trainee?', 'Delete "' + name + '" and all their Checklist, Scores, Handover, Assessment and Feedback data?\n\nThis cannot be undone.',
      ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (err) {
    box.setValue(false);
    SS().toast('Use the menu Training Module > Delete Trainee to delete "' + name + '".', 'Confirm from the menu', 8);
    return;
  }
  if (!ok) { box.setValue(false); return; }
  SS().toast(deleteTrainee(name), 'Deleted', 6);
}

// Menu: pick a trainee from a list and delete
function showDeleteTraineeDialog() {
  const names = Array.from(traineeNames());
  if (!names.length) { SpreadsheetApp.getUi().alert('There are no trainees to delete.'); return; }
  const opts = names.map(n => '<option value="' + escAttr(n) + '">' + esc(n) + '</option>').join('');
  const html = HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial;padding:12px}label{display:block;font-weight:bold;font-size:13px}' +
    'select{width:95%;padding:6px;margin-top:4px}p{font-size:12px;color:#555}' +
    'button{margin-top:14px;padding:8px 18px;background:#c62828;color:#fff;border:0;cursor:pointer}</style>' +
    '<label>Trainee to delete</label><select id="n">' + opts + '</select>' +
    '<p>This removes the trainee from the Trainees tab and deletes all their Checklist, Scores, Handover, Assessment and Feedback rows. It cannot be undone.</p>' +
    '<button id="b" onclick="go()">Delete Trainee</button> <span id="m" style="color:#c00"></span>' +
    '<script>function go(){var n=document.getElementById("n").value;' +
    'if(!confirm("Delete "+n+" and all their data? This cannot be undone."))return;' +
    'var b=document.getElementById("b");b.disabled=true;' +
    'google.script.run.withSuccessHandler(function(m){alert(m);google.script.host.close();})' +
    '.withFailureHandler(function(e){b.disabled=false;document.getElementById("m").innerText=e.message;}).deleteTrainee(n);}</script>'
  ).setWidth(380).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, 'Delete Trainee');
}

// ===================== CHECK SETUP =====================
function checkSetup() {
  const ss = SS(), out = [];
  Object.keys(SHEETS).forEach(k => { if (!ss.getSheetByName(SHEETS[k])) out.push('MISSING TAB: ' + SHEETS[k]); });
  const li = ss.getSheetByName(SHEETS.LI);
  if (li) out.push('Stages: ' + li.getRange('A2:A20').getValues().flat().filter(String).join(' | '));
  [[SHEETS.CT, 'Checklist_Template'], [SHEETS.ST, 'Scoring_Template']].forEach(p => {
    const t = ss.getSheetByName(p[0]);
    if (!t) return;
    const last = lastRowOfCol(t, 2), c = {};
    if (last > 1) t.getRange(2, 3, last - 1, 1).getValues().forEach(r => { const k = String(r[0]) || '(blank)'; c[k] = (c[k] || 0) + 1; });
    out.push(p[1] + ' phases: ' + Object.keys(c).map(k => k + '=' + c[k]).join(', '));
  });
  const trig = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction() + '/' + t.getEventType());
  out.push('Triggers: ' + (trig.join(', ') || 'NONE - run Setup / Repair Module'));
  const names = traineeNames();
  out.push('Trainees: ' + names.size);
  const cl = ss.getSheetByName(SHEETS.CL);
  if (cl && lastRowOfCol(cl, 1) > 1) {
    const cnt = {};
    cl.getRange(2, 1, lastRowOfCol(cl, 1) - 1, 1).getValues().forEach(r => { const v = String(r[0]).trim(); cnt[v] = (cnt[v] || 0) + 1; });
    names.forEach(n => { if (!cnt[n]) out.push('NO CHECKLIST ROWS: ' + n + '  -> use menu Sync Trainee Rows'); });
  }
  const err = PropertiesService.getScriptProperties().getProperty('lastError');
  if (err) out.push('Last script error: ' + err);
  SpreadsheetApp.getUi().alert('Setup check', out.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ===================== TRIGGERS =====================
function createTriggers() {
  const keep = ['onEditHandler', 'onChangeHandler', 'dailyReminders'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (keep.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditHandler').forSpreadsheet(SS()).onEdit().create();
  ScriptApp.newTrigger('onChangeHandler').forSpreadsheet(SS()).onChange().create();
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(REMINDER_HOUR).create();
}

function onEditHandler(e) {
  try { handleEdit_(e); }
  catch (err) {
    PropertiesService.getScriptProperties().setProperty('lastError', new Date().toISOString() + ' ' + err.message);
  }
}

function editorEmail(e) {
  return (e && e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || '';
}

function handleEdit_(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), name = sh.getName();
  const r = e.range.getRow(), c = e.range.getColumn();
  const nr = e.range.getNumRows(), nc = e.range.getNumColumns(), cEnd = c + nc - 1;
  const covers = col => c <= col && cEnd >= col;
  if (r < 2) return;

  if (name === SHEETS.TR) {
    // Name typed over (single cell): rename the trainee's data instead of losing it
    if (covers(2) && nr === 1 && nc === 1 && e.oldValue !== undefined && e.value !== undefined) {
      const o = String(e.oldValue).trim(), nw = String(e.value).trim();
      if (o && nw && o !== nw) renameTrainee(o, nw);
    }
    if (covers(2) || covers(5) || covers(8)) {                      // name, designation or stage changed
      let emptied = false;
      for (let i = 0; i < nr; i++) {                                // also works when several rows are pasted
        const v = String(sh.getRange(r + i, 2).getValue() || '').trim();
        if (v) { fillTraineeRow(r + i); ensureRows(v); } else emptied = true;
      }
      if (covers(2)) {
        if (emptied) autoCleanDeleted_();                           // name cleared -> remove that trainee's data
        clearStaleSelection();
      }
    }
    if (covers(6)) refreshChecklistDays();                          // joining date changed -> day numbers
    if (covers(DEL_COL) && nr === 1 && nc === 1 && e.range.getValue() === true) {
      confirmDeleteFromTick_(r);                                    // Delete Trainee tick
      return;
    }
    if (covers(12)) {
      // Status changed: Completed stamps "Closed On"; anything else clears it
      for (let i = 0; i < nr; i++) {
        const m = sh.getRange(r + i, 13);
        if (String(sh.getRange(r + i, 12).getValue()) === 'Completed') { if (m.getValue() === '') m.setValue(todayDate()); }
        else if (m.getValue() !== '') m.clearContent();
      }
    }
  } else if (name === SHEETS.CL && c === 4 && nr === 1) {
    const ticked = e.range.getValue() === true;
    const tn = String(sh.getRange(r, 1).getValue()).trim();
    const now = new Date();
    sh.getRange(r, 5).setValue(ticked ? now : '');
    sh.getRange(r, 8).setValue(ticked ? editorEmail(e) : '');       // Assessor
    if (String(sh.getRange('J1').getValue()) !== 'Training Day') ensureChecklistColumns();   // setup not re-run yet
    sh.getRange(r, 10).setNumberFormat(DAY_FMT).setHorizontalAlignment('center')
      .setValue(ticked ? dayNo_(now, joinMap_()[tn]) : '');      // Training Day (shows as "Day 2")
  } else if (name === SHEETS.CL && c === 9 && nr === 1 && e.range.getValue() === true) {
    removeChecklistRow(r, editorEmail(e));                          // Remove (N/A)
  } else if (name === SHEETS.SC && c === 4 && nr === 1) {
    const em = editorEmail(e);
    if (em && e.range.getValue() !== '') sh.getRange(r, 5).setValue(em);
  } else if (name === SHEETS.ASM && c === 6 && nr === 1) {
    const has = e.range.getValue() !== '';                          // rating picked
    sh.getRange(r, 8).setValue(has ? editorEmail(e) : '');
    sh.getRange(r, 9).setValue(has ? new Date() : '');
  } else if (name === SHEETS.FB && nr === 1 && c >= 4 && c <= 8) {
    // Feedback filled: stamp who gave it and when
    if (sh.getRange(r, 4, 1, 5).getValues()[0].some(x => String(x).trim() !== '')) {
      const em = editorEmail(e);
      if (em) sh.getRange(r, 2).setValue(em);
      sh.getRange(r, 3).setValue(new Date());
    }
  } else if (name === SHEETS.HO && (covers(1) || covers(2))) {
    // Next Step = Final Feedback / Final Review: create the Feedback row straight away
    for (let i = 0; i < nr; i++) {
      const v = sh.getRange(r + i, 1, 1, 2).getValues()[0];
      const tn = String(v[0]).trim(), st = String(v[1]).trim();
      if (tn && (st === 'Final Feedback' || st === 'Final Review & Confirmation')) addMissingFeedback(tn, new Set([st]));
    }
  } else if (name === SHEETS.HO && c === 6 && nr === 1 && e.range.getValue() === 'Send') {
    sendHandover(r);
  } else if (name === SHEETS.HO && c === 6 && nr === 1 && e.range.getValue() === 'Completed' &&
             String(sh.getRange(r, 2).getValue()) === 'Final Review & Confirmation') {
    closeTraining(String(sh.getRange(r, 1).getValue()).trim());     // final review done = training closed
  }
}

// ===================== HANDOVER & EMAIL =====================
function sendSelectedHandover() {
  const sh = SS().getActiveSheet();
  if (sh.getName() !== SHEETS.HO) {
    SpreadsheetApp.getUi().alert('Go to the Handover tab and click on the row you want to send.');
    return;
  }
  const r = sh.getActiveRange().getRow();
  if (r < 2) return;
  sendHandover(r);
}

function sendHandover(row) {
  const ss = SS(), sh = ss.getSheetByName(SHEETS.HO);
  const v = sh.getRange(row, 1, 1, 5).getValues()[0];
  const trainee = v[0], step = v[1], ownerEmail = String(v[3]).trim();
  if (!trainee || !step || !ownerEmail) {
    sh.getRange(row, 6).setValue('Draft');
    ss.toast('Fill Trainee, Next Step and Next Owner Email first.', 'Handover not sent', 8);
    return;
  }
  if (step === 'Onboard Final Email') { sendOnboardFinalEmail(row); return; }
  try {
    if (SHARE_SHEET_WITH_OWNER) { try { ss.addEditor(ownerEmail); } catch (x) {} }
    updateTraineeStage(trainee, step, ownerEmail);
    ensureRows(trainee);                       // create this phase's checklist / score / Q&A / feedback rows
    MailApp.sendEmail({
      to: ownerEmail,
      subject: 'Trainee handover: ' + trainee + ' → ' + step,
      htmlBody: buildEmail(row, false)
    });
    sh.getRange(row, 6).setValue('Pending');
    sh.getRange(row, 7).setValue(new Date());
    closeEarlierHandovers(trainee, row);       // previous owner has handed over: stop their reminders
    ss.toast('Email sent to ' + ownerEmail, 'Handover sent', 6);
  } catch (err) {
    sh.getRange(row, 6).setValue('Draft');
    ss.toast('Email failed: ' + err.message, 'Error', 10);
  }
}

// Last step: "training complete / onboarding confirmed" email. No sheet access, no reminders; closes the training.
function sendOnboardFinalEmail(row) {
  const ss = SS(), sh = ss.getSheetByName(SHEETS.HO);
  const v = sh.getRange(row, 1, 1, 5).getValues()[0];
  const trainee = String(v[0]).trim(), toName = v[2] || 'Team', to = String(v[3]).trim(), note = v[4];
  const tr = ss.getSheetByName(SHEETS.TR), last = lastRowOfCol(tr, 2);
  let info = null;
  for (let r = 2; r <= last; r++) {
    if (String(tr.getRange(r, 2).getValue()).trim() === trainee) { info = tr.getRange(r, 1, 1, 14).getValues()[0]; break; }
  }
  if (!info) { sh.getRange(row, 6).setValue('Draft'); ss.toast('Trainee not found in the Trainees tab.', 'Not sent', 8); return; }
  const tz = Session.getScriptTimeZone();
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, tz, 'dd-MMM-yyyy') : (d || '-');
  const days = info[13] !== '' ? info[13] : (info[5] instanceof Date ? dayNo_(new Date(), info[5]) - 1 : '');
  const traineeEmail = String(info[2] || '').trim();
  const td = 'style="padding:6px 10px;border-bottom:1px solid #ddd"';
  const tdl = 'style="padding:6px 10px;border-bottom:1px solid #ddd;background:#e8eaf6;font-weight:bold;width:40%"';
  const rowH = (k, val) => '<tr><td ' + tdl + '>' + esc(k) + '</td><td ' + td + '>' + esc(val) + '</td></tr>';
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:640px">' +
    '<p>Hi ' + esc(toName) + ',</p>' +
    '<p>We are happy to confirm that <b>' + esc(trainee) + '</b> has completed the training programme and is now onboarded with ' + COMPANY + '.</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    rowH('Name', trainee) + rowH('Designation', info[4] || '-') + rowH('Department / Clinic', info[3] || '-') +
    rowH('Joining Date', fmt(info[5])) + rowH('Training completed on', fmt(new Date())) +
    rowH('Training duration', days === '' ? '-' : days + ' days') + rowH('Trainer', info[6] || '-') + '</table>' +
    (note ? '<p><b>Note:</b> ' + esc(note) + '</p>' : '') +
    '<p>Welcome to the team, and all the best in your role.</p>' +
    '<p>- HR Team, ' + COMPANY + '</p></div>';
  try {
    const mail = { to: to, subject: 'Onboarding complete: ' + trainee + ' - ' + COMPANY, htmlBody: html };
    if (traineeEmail && traineeEmail.toLowerCase() !== to.toLowerCase()) mail.cc = traineeEmail;
    MailApp.sendEmail(mail);
    updateTraineeStage(trainee, 'Onboard Final Email', to);
    sh.getRange(row, 6).setValue('Completed');
    sh.getRange(row, 7).setValue(new Date());
    closeEarlierHandovers(trainee, row);
    closeTraining(trainee);
    ss.toast('Onboarding email sent to ' + to + (mail.cc ? ' (cc ' + mail.cc + ')' : '') + '. Trainee marked Completed.', 'Sent', 8);
  } catch (err) {
    sh.getRange(row, 6).setValue('Draft');
    ss.toast('Email failed: ' + err.message, 'Error', 10);
  }
}

function closeEarlierHandovers(trainee, keepRow) {
  const sh = SS().getSheetByName(SHEETS.HO);
  const last = lastRowOfCol(sh, 1);
  for (let r = 2; r <= last; r++) {
    if (r === keepRow) continue;
    if (sh.getRange(r, 1).getValue() === trainee && sh.getRange(r, 6).getValue() === 'Pending') {
      sh.getRange(r, 6).setValue('Completed');
    }
  }
}

function dailyReminders() {
  const sh = SS().getSheetByName(SHEETS.HO);
  const last = lastRowOfCol(sh, 1);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const names = traineeNames();
  for (let r = 2; r <= last; r++) {
    const v = sh.getRange(r, 1, 1, 8).getValues()[0];
    if (v[5] !== 'Pending' || !v[3]) continue;
    if (names.size && !names.has(String(v[0]).trim())) continue;   // trainee was deleted
    const lastRem = v[7] ? Utilities.formatDate(new Date(v[7]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    if (lastRem === today) continue;
    try {
      MailApp.sendEmail({
        to: String(v[3]).trim(),
        subject: 'Reminder: ' + v[0] + ' is waiting for "' + v[1] + '"',
        htmlBody: buildEmail(r, true)
      });
      sh.getRange(r, 8).setValue(new Date());
    } catch (err) { /* skip and continue */ }
  }
}

function updateTraineeStage(name, step, ownerEmail) {
  const sh = SS().getSheetByName(SHEETS.TR);
  const last = lastRowOfCol(sh, 2);
  for (let r = 2; r <= last; r++) {
    if (sh.getRange(r, 2).getValue() === name) {
      sh.getRange(r, 8).setValue(step);
      sh.getRange(r, 9).setValue(ownerEmail);
      return;
    }
  }
}

function getSummary(name) {
  const ss = SS();
  const cl = ss.getSheetByName(SHEETS.CL).getDataRange().getValues().slice(1).filter(r => r[0] === name);
  const sc = ss.getSheetByName(SHEETS.SC).getDataRange().getValues().slice(1).filter(r => r[0] === name);
  const mods = MODULES.map(m => {
    const rows = cl.filter(r => r[1] === m);
    return { module: m, done: rows.filter(r => r[3] === true).length, total: rows.length };
  }).filter(m => m.total > 0);
  const avgOf = cats => {
    const vals = sc.filter(r => (!cats || cats.indexOf(r[1]) > -1) && r[3] !== '' && !isNaN(r[3])).map(r => Number(r[3]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const cats = SCORE_CATEGORIES.map(c => ({ cat: c, avg: avgOf([c]) })).filter(x => x.avg !== null);
  const asmSh = ss.getSheetByName(SHEETS.ASM);
  const qa = [];
  if (asmSh && lastRowOfCol(asmSh, 1) > 1) {
    const arows = asmSh.getRange(2, 1, lastRowOfCol(asmSh, 1) - 1, 7).getValues().filter(r => r[0] === name);
    DEPARTMENTS.forEach(dep => {
      const v = arows.filter(r => r[1] === dep && r[6] !== '' && !isNaN(r[6])).map(r => Number(r[6]));
      if (v.length) qa.push({ dep: dep, avg: v.reduce((a, b) => a + b, 0) / v.length });
    });
  }
  let fb = null;
  const fbSh = ss.getSheetByName(SHEETS.FB);
  if (fbSh && lastRowOfCol(fbSh, 1) > 1) {
    const rows = fbSh.getRange(2, 1, lastRowOfCol(fbSh, 1) - 1, 8).getValues()
      .filter(r => String(r[0]).trim() === name && [3, 4, 5, 6, 7].some(i => String(r[i]).trim() !== ''));
    if (rows.length) fb = rows[rows.length - 1];
  }
  return { mods: mods, scores: sc, cats: cats, overall: avgOf(), qa: qa, fb: fb };
}

function buildEmail(row, isReminder) {
  const ss = SS();
  const h = ss.getSheetByName(SHEETS.HO).getRange(row, 1, 1, 5).getValues()[0];
  const trainee = h[0], step = h[1], ownerName = h[2] || 'Team', note = h[4];
  const s = getSummary(trainee);
  const f = n => n === null ? 'Not scored' : n.toFixed(1) + ' / 10';
  const th = 'style="background:#1a237e;color:#fff;padding:6px 10px;text-align:left"';
  const td = 'style="border-bottom:1px solid #ddd;padding:6px 10px"';
  const box = 'style="background:#e8eaf6;padding:8px 10px"';

  const modRows = s.mods.map(m => '<tr><td ' + td + '>' + esc(m.module) + '</td><td ' + td + '>' +
    m.done + ' / ' + m.total + '</td></tr>').join('');
  const scoreRows = s.scores.map(r => '<tr><td ' + td + '>' + esc(r[1]) + '</td><td ' + td + '>' + esc(r[2]) +
    '</td><td ' + td + '>' + (r[3] === '' ? '-' : esc(r[3])) + '</td><td ' + td + '>' + esc(r[5]) + '</td></tr>').join('');
  const catLine = s.cats.map(x => esc(x.cat) + ': <b>' + f(x.avg) + '</b>').join(' &nbsp;|&nbsp; ');
  const qaLine = s.qa.map(x => esc(x.dep) + ': <b>' + f(x.avg) + '</b>').join(' &nbsp;|&nbsp; ');

  const phase = PHASES.filter(p => p.stage === step)[0];
  let guide;
  if (phase && step !== 'Asset Allotment') {
    guide = '<p ' + box + '><b>Your phase: ' + esc(step) + '.</b> Tick the topics you cover in the <b>Checklist</b> tab (' +
      (phase.dash ? 'the CRM modules for this trainee\'s designation' : phase.modules.map(esc).join(', ')) + '), enter scores (1-10) in the <b>Scores</b> tab and rate the trainee answers (Excellent / Good / Average) in the <b>Assessment</b> tab. Items that do not apply to this role can be removed with the <b>Remove</b> tick in the Checklist. When you finish, add a new row in the <b>Handover</b> tab to pass the trainee to the next person (Status = Send).</p>';
  } else if (step === 'Asset Allotment') {
    guide = '<p ' + box + '><b>Your step: Asset Allotment.</b> In the <b>Checklist</b> tab, tick each item as you hand it over to the trainee and write serial numbers / details in <b>Remarks</b>. Items the trainee does not need can be removed with the <b>Remove</b> tick. Then hand over to the next person in the <b>Handover</b> tab (Status = Send).</p>';
  } else if (step === 'Assessment') {
    guide = '<p ' + box + '><b>Your step: Assessment.</b> Open the <b>Assessment</b> tab and filter on this trainee. Ask each question (HR, Sales and Operations), type the trainee\'s answer and pick <b>Excellent / Good / Average</b> - the score fills in automatically. When you finish, add a new row in the <b>Handover</b> tab to pass the trainee to the next person (Status = Send).</p>';
  } else if (step === 'Final Feedback') {
    guide = '<p ' + box + '><b>Your step: Final Feedback.</b> Open the <b>Feedback</b> tab, find this trainee\'s row and fill in the Overall Rating, Final Recommendation (Confirm / Extend Training / Not Confirmed), Strengths, Areas to Improve and Comments. Then hand over for <b>Final Review &amp; Confirmation</b> in the <b>Handover</b> tab.</p>';
  } else {
    guide = '<p ' + box + '><b>Final Review &amp; Confirmation:</b> please review the full results below and confirm the trainee. Set this handover row to <b>Completed</b> when done - the training is then closed.</p>';
  }

  let fbHtml = '';
  if (s.fb && (s.fb[3] !== '' || s.fb[4] !== '' || s.fb[5] !== '' || s.fb[7] !== '')) {
    fbHtml = '<h3 style="color:#1a237e">Final Feedback</h3><p>' +
      'Recommendation: <b>' + esc(s.fb[4] || '-') + '</b> &nbsp;|&nbsp; Rating: <b>' + esc(s.fb[3] || '-') + '</b>' +
      (s.fb[1] ? ' &nbsp;|&nbsp; By: ' + esc(s.fb[1]) : '') +
      (s.fb[5] ? '<br><b>Strengths:</b> ' + esc(s.fb[5]) : '') +
      (s.fb[6] ? '<br><b>Areas to improve:</b> ' + esc(s.fb[6]) : '') +
      (s.fb[7] ? '<br><b>Comments:</b> ' + esc(s.fb[7]) : '') + '</p>';
  }

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px">' +
    '<p>Hi ' + esc(ownerName) + ',</p>' +
    '<p>' + (isReminder
      ? '<b>Reminder:</b> the trainee below is still waiting for you to continue with the next step.'
      : 'A trainee has been handed over to you for the next step of training.') + '</p>' +
    '<p><b>Trainee:</b> ' + esc(trainee) + '<br><b>Next step:</b> ' + esc(step) +
    (note ? '<br><b>Note:</b> ' + esc(note) : '') + '</p>' + guide +
    '<h3 style="color:#1a237e">Score Summary</h3>' +
    '<p>' + (catLine ? catLine + '<br>' : '') + (qaLine ? 'Q&amp;A: ' + qaLine + '<br>' : '') + 'Overall: <b>' + f(s.overall) + '</b></p>' +
    fbHtml +
    '<h3 style="color:#1a237e">Training Covered</h3>' +
    '<table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Module</th><th ' + th + '>Covered</th></tr>' + modRows + '</table>' +
    '<h3 style="color:#1a237e">Detailed Scores</h3>' +
    '<table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>Category</th><th ' + th + '>Criterion</th><th ' + th +
    '>Score</th><th ' + th + '>Remarks</th></tr>' + scoreRows + '</table>' +
    '<p><a href="' + ss.getUrl() + '">Open the Training Dashboard</a> and select "' + esc(trainee) + '" in cell C3 to see everything.</p>' +
    '<p>- HR Team, ' + COMPANY + '</p></div>';
}

// ===================== HELPERS =====================
function SS() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getOrCreate(name) {
  return SS().getSheetByName(name) || SS().insertSheet(name);
}

function styleHeader(range) {
  range.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold')
    .setVerticalAlignment('middle').setHorizontalAlignment('center');
}

function listRule(listSheet, colLetter) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(listSheet.getRange(colLetter + '2:' + colLetter + '50'), true)
    .setAllowInvalid(false).build();
}

function scoreRule() {
  return SpreadsheetApp.newDataValidation().requireNumberBetween(1, 10)
    .setAllowInvalid(false).setHelpText('Enter a score from 1 to 10').build();
}

function lastRowOfCol(sh, col) {
  const vals = sh.getRange(1, col, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return i + 1;
  return 1;
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}
