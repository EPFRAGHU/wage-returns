"""Create an employer login and import one month from the client's salary Excel.

Usage:  python seed.py "Client name" client_username client_password path/to/salary.xlsx [EST_CODE]
"""
import sys
from werkzeug.security import generate_password_hash
from app import app, db, Employer, User, import_salary_workbook

name, uname, pw, path = sys.argv[1:5]
est = sys.argv[5] if len(sys.argv) > 5 else ""
with app.app_context():
    er = Employer.query.filter_by(name=name).first()
    if not er:
        er = Employer(name=name, est_code=est)
        db.session.add(er); db.session.flush()
        db.session.add(User(username=uname.lower(), pw=generate_password_hash(pw), role="employer", employer_id=er.id))
        db.session.commit()
    with open(path, "rb") as f:
        wm, n = import_salary_workbook(er.id, f)
    print(f"{er.name}: {wm.label} imported with {n} employees")
