# Wage returns app — project context

Flask web app for an EPFO-covered client employer. The employer enters monthly
wages employee by employee; the consultant (admin, the app owner) downloads the
EPFO ECR text file and the ESIC MC upload file from the same data. Replaces the
client's monthly 3-sheet salary Excel (salary statement / UAN list / IP list).

## Stack and files
- `app.py` — Flask + Flask-SQLAlchemy: models, auth (session + CSRF token), all routes, Excel import/export, `init_db()` with in-place column migrations (`ALTER TABLE ... ADD COLUMN`) because there is no Alembic.
- `calc.py` — single source of truth for wage/EPF/ESIC maths and ECR line building. `static/entry.js` mirrors it for live preview; keep both in sync when a formula changes.
- `templates/` — Jinja: `base`, `login`, `password`, `admin` (employers list), `settings` (wage ceilings), `employees` (master + Excel import/template), `months` (timeline + per-employee entry panel + summary table).
- `static/style.css`, `static/entry.js` — no build step. Static URLs are cache-busted with `asset()` (file mtime).
- `esic_template/MC_Template11.xls` — ESIC's official MC template, filled via xlrd + xlutils.copy (keeps the instructions sheet and formatting).
- `seed.py` — creates an employer login and imports one month from the client's salary workbook.
- DB: SQLite `data/wages.db` by default; `DATABASE_URL` for Postgres. Docker/gunicorn on port 8000 for Coolify.

## Run
    pip install -r requirements.txt
    python app.py                      # http://127.0.0.1:5000, admin / admin123
    python seed.py "Client" client client123 salary.xlsx ORBBS0012345000

## Roles and workflow
- admin: creates employers (+ their login), edits ceilings, can always edit any month, Generate ECR, Reopen for employer.
- employer: sees only own data. Month timeline (bar height = headcount; amber draft, blue submitted, green ECR generated, grey hatched = not opened, click to open). Opening a month copies active employees with last month's pay, total days from last month (default 30), LOP 0.
- Per-employee entry panel: actual basic, total days, LOP days, house rent, laundry → everything else computed live. "Save and next" goes to the next not-yet-entered employee. New employee can be created from the month. `WageEntry.entered` tracks progress; "Send to EPF office" is refused while any row is not entered, then the month locks for the employer.
- Editing after ECR generation flips status back to submitted (regenerate needed).

## Calculation rules (match the client's sheet — do not change without asking)
- paid days = total − LOP; basic = ROUND_HALF_UP(actual_basic / total × paid)
- gross = 2 × basic; conveyance = gross − basic − house rent − laundry (balancing figure; can go negative when paid days are very low — flagged, not fixed)
- EPF wages = full basic (no ceiling). EPS and EDLI wages = MIN(basic, ceiling).
- EE = ROUND(EPF wages × 12%); EPS = ROUND(EPS wages × 8.33%); ER diff = EE − EPS; NCP = LOP days; refund 0.
- Age 58: if the 58th birthday is on/before the 1st of the wage month → EPS wages 0 (whole 12% to ER diff). Birthday inside the month → flagged "Turns 58", EPS still paid. Logic in `calc.eps_status`.
- ESIC only for employees with an IP number: ESIC wages = gross − laundry (washing allowance excluded); EE = ROUNDUP 0.75%, ER = ROUNDUP 3.25%; warn above ₹21,000.
- Wage ceiling (table `Ceiling`, effective date YYYY-MM-DD; legacy YYYY-MM rows = 1st of month): ₹15,000 from 01-09-2014, ₹25,000 from 17-09-2026 (S.O. 5109(E)). A month where the ceiling changes is pro-rated by calendar days → Sep-2026 = ₹19,667. Admin can set 01-09-2026 instead to use ₹25,000 for all of September.
- ECR 2.0 line: `UAN#~#NAME#~#GROSS#~#EPF#~#EPS#~#EDLI#~#EE#~#EPS#~#ER#~#NCP#~#0`, UTF-8, `\n`; employees without UAN are skipped and flagged.
- ESIC MC file: IP no, name (A–Z and space only), paid days, ESIC wages, reason code, last working day DD/MM/YYYY; all cells Text, .xls. Reason/LWD only when paid days = 0; codes 2,3,4,5,6,10 require LWD.

## Client workbook import
Sheet1 columns are found by heading (NAME, ACTUAL BASIC, TOTAL DAYS, LOP, HOUSE, LAUNDRY, optional DATE OF BIRTH / UAN / IP NO); month from A1 text like "SEPT-2026". UAN (Sheet2) and IP (Sheet3) matched to names with difflib (cutoff 0.85) after stripping Mr./Mrs. prefixes.

## Open questions / ideas
- Should house rent and laundry become 0 (or pro-rated) when paid days are 0? Currently fixed amounts → negative conveyance.
- Birthday-month EPS proration vs. full EPS (currently full).
- Possibly restrict EPF wages to ceiling per employee (client currently contributes on full basic).
- Admin "challan estimate" is indicative (A/c 2 min ₹500).

## Conventions
- Indian number formatting (en-IN) in UI; amounts are whole rupees (ints).
- Keep employer-facing text plain and short; flags/badges rather than modal errors.
- Test with the client's Sept-2026 workbook: totals EPF wages ₹1,30,917, gross ₹2,61,834; 22 UANs, 5 IP numbers.
