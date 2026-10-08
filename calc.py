"""Wage, EPF, ESIC calculation and ECR/ESIC file generation.

All money rounding mirrors the client's Excel sheet:
  basic   = ROUND(actual_basic / total_days * paid_days, 0)   (half-up)
  gross   = basic * 2         (conveyance is the balancing figure)
  EPF EE  = ROUND(basic * 12%, 0)
  ESIC EE = ROUNDUP((gross - laundry) * 0.75%, 0)   (washing allowance excluded)
The same formulas live in static/grid.js for live preview; the server is the
source of truth for every file it generates.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, ROUND_CEILING

EPF_RATE = Decimal("0.12")
EPS_RATE = Decimal("0.0833")
ESIC_EE_RATE = Decimal("0.0075")
ESIC_ER_RATE = Decimal("0.0325")
ESIC_WAGE_LIMIT = 21000
EPS_AGE_LIMIT = 58


def r_half_up(x) -> int:
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def r_up(x) -> int:
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_CEILING))


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 Feb -> 1 Mar
        return d.replace(year=d.year + years, month=3, day=1)


def eps_status(dob: date | None, year: int, month: int) -> str:
    """'ok', 'over58' (no EPS this month) or 'turns58' (birthday month, EPS still paid).

    Rule used: EPS stops from the first wage month that begins on/after the
    58th birthday. Change here if your office applies proration instead.
    """
    if not dob:
        return "nodob"
    b58 = add_years(dob, EPS_AGE_LIMIT)
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    if b58 <= first:
        return "over58"
    if b58 <= last:
        return "turns58"
    return "ok"


@dataclass
class Row:
    name: str
    uan: str | None
    ip_no: str | None
    dob: date | None
    actual_basic: int
    total_days: int
    lop_days: int
    hra: int
    laundry: int
    # computed
    paid_days: int = 0
    basic: int = 0
    conveyance: int = 0
    gross: int = 0
    epf_wages: int = 0
    eps_wages: int = 0
    edli_wages: int = 0
    epf_ee: int = 0
    eps_er: int = 0
    epf_er_diff: int = 0
    esic_wages: int = 0
    esic_ee: int = 0
    esic_er: int = 0
    net: int = 0
    age_flag: str = "ok"
    warnings: list = field(default_factory=list)


def compute(row: Row, year: int, month: int, ceiling: int) -> Row:
    td = max(int(row.total_days or 0), 0)
    lop = min(max(int(row.lop_days or 0), 0), td)
    row.paid_days = td - lop
    row.basic = r_half_up(Decimal(row.actual_basic or 0) / td * row.paid_days) if td else 0
    row.gross = row.basic * 2
    row.conveyance = row.gross - (row.basic + (row.hra or 0) + (row.laundry or 0))
    if row.conveyance < 0:
        row.warnings.append("House rent + laundry exceed half the gross; conveyance is negative")

    row.age_flag = eps_status(row.dob, year, month)
    if row.uan:
        row.epf_wages = row.basic
        row.edli_wages = min(row.basic, ceiling)
        row.eps_wages = 0 if row.age_flag == "over58" else min(row.basic, ceiling)
        row.epf_ee = r_half_up(row.epf_wages * EPF_RATE)
        row.eps_er = r_half_up(row.eps_wages * EPS_RATE)
        row.epf_er_diff = row.epf_ee - row.eps_er
    else:
        row.warnings.append("No UAN — left out of the ECR")
    if row.age_flag == "nodob":
        row.warnings.append("Date of birth missing — EPS age check not possible")

    if row.ip_no:
        row.esic_wages = max(row.gross - (row.laundry or 0), 0)
        row.esic_ee = r_up(row.esic_wages * ESIC_EE_RATE)
        row.esic_er = r_up(row.esic_wages * ESIC_ER_RATE)
        if row.esic_wages > ESIC_WAGE_LIMIT:
            row.warnings.append(f"ESIC wages above ₹{ESIC_WAGE_LIMIT:,}")
    row.net = row.gross - row.epf_ee - row.esic_ee
    return row


def ecr_line(r: Row) -> str:
    name = " ".join((r.name or "").upper().split())
    ncp = r.total_days - r.paid_days  # LOP days
    # UAN#~#Name#~#Gross#~#EPF wages#~#EPS wages#~#EDLI wages#~#EE share#~#EPS#~#ER diff#~#NCP#~#Refund
    f = [r.uan, name, r.gross, r.epf_wages, r.eps_wages, r.edli_wages,
         r.epf_ee, r.eps_er, r.epf_er_diff, ncp, 0]
    return "#~#".join(str(x) for x in f)


def build_ecr(rows: list[Row]) -> str:
    return "\n".join(ecr_line(r) for r in rows if r.uan)


def challan_estimate(rows: list[Row]) -> dict:
    """Indicative EPF challan split; the portal's own figures prevail."""
    members = [r for r in rows if r.uan]
    epf_w = sum(r.epf_wages for r in members)
    edli_w = sum(r.edli_wages for r in members)
    ac1 = sum(r.epf_ee for r in members) + sum(r.epf_er_diff for r in members)
    ac2 = max(r_half_up(epf_w * Decimal("0.005")), 500 if members else 75)
    ac10 = sum(r.eps_er for r in members)
    ac21 = r_half_up(edli_w * Decimal("0.005"))
    return {"members": len(members), "epf_wages": epf_w, "edli_wages": edli_w,
            "ac1": ac1, "ac2": ac2, "ac10": ac10, "ac21": ac21, "ac22": 0,
            "total": ac1 + ac2 + ac10 + ac21}
