# Wage returns — employer wage entry + ECR generator

Employers sign in, pick a month on the timeline and enter wages one employee
at a time: the month lists every employee, the selected one opens in an entry
panel (actual basic, total days, LOP days, house rent, laundry) and paid days,
basic, conveyance, gross, EPF, ESIC, net pay, EPS/EDLI wages and NCP days are
calculated as they type. Save and next jumps to the next employee not yet
entered; new joiners can be added from the same screen. A month can only be
sent to the EPF office once every employee in it is entered. The EPF office
(admin) opens any month and clicks **Generate ECR** to download the ECR 2.0 text
file, plus an ESIC monthly-contribution upload file (.xls) and a wage register.

## ESIC monthly contribution file
**ESIC MC file (.xls)** on the month page (employer and admin) fills ESIC's own
template `esic_template/MC_Template11.xls`: IP number, IP name (letters and
spaces only), paid days, ESIC wages (gross − laundry), reason code and last
working day, all written as Text and saved as Excel 97-2003 as ESIC requires.
When an insured person has 0 paid days the entry panel asks for the ESIC reason
code; codes 2, 3, 4, 5, 6 and 10 also need the last working day.

## Run locally
    pip install -r requirements.txt
    python app.py                 # http://127.0.0.1:5000  (admin / admin123)

## Deploy (Coolify / any Docker host)
Build from the Dockerfile, port 8000. Environment variables:
- `SECRET_KEY`      long random string (required in production)
- `ADMIN_USER`, `ADMIN_PASSWORD`  first admin login, created on first start
- `DATABASE_URL`    optional Postgres URL; default is SQLite at `data/wages.db`
  (mount `/app/data` as a persistent volume if you stay on SQLite)

## Load an existing month from the client's Excel
    python seed.py "Client name" client_login client_pass salary.xlsx ORBBS0012345000
or use **Import salary Excel** on the months page. Columns are found by heading,
so a `DATE OF BIRTH` column anywhere in Sheet1 is picked up; UAN (Sheet2) and
IP numbers (Sheet3) are matched to Sheet1 names, tolerating small spelling
differences.

## Calculation (same as the client's sheet)
| Item | Formula |
|---|---|
| Paid days | total days − LOP days |
| Basic | ROUND(actual basic ÷ total days × paid days) |
| Gross | basic × 2; conveyance = gross − basic − house rent − laundry |
| EPF wages | basic (full) |
| EPS / EDLI wages | MIN(basic, ceiling); EPS = 0 once the member has completed 58 before the wage month starts |
| EE share | ROUND(EPF wages × 12%) |
| EPS | ROUND(EPS wages × 8.33%); ER diff = EE share − EPS |
| NCP days | LOP days |
| ESIC wages | gross − laundry (only for employees with an IP number) |
| ESIC | EE ROUNDUP 0.75%, ER ROUNDUP 3.25% |

Ceilings are editable under **Wage ceiling** (seeded: ₹15,000 from Sep-2014,
₹25,000 from Oct-2026 wage month). The 58-year rule lives in `calc.eps_status`
and is mirrored in `static/grid.js` for the live preview.

ECR line: `UAN#~#NAME#~#GROSS#~#EPF#~#EPS#~#EDLI#~#EE#~#EPS#~#ER#~#NCP#~#0`
Employees without a UAN are left out of the ECR and flagged on screen.
