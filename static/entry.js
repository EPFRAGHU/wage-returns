// One-employee-at-a-time wage entry with live calculation.
// The formulas mirror calc.py; the server recomputes everything for the ECR.
(() => {
  const root = document.getElementById('entry');
  if (!root) return;
  const Y = +root.dataset.year, M = +root.dataset.month, CEIL = +root.dataset.ceiling;
  const editable = root.dataset.editable === '1';
  const csrf = document.querySelector('meta[name=csrf]').content;
  const entries = JSON.parse(document.getElementById('entries-data').textContent);
  const $ = id => document.getElementById(id);
  const wform = $('wform'), nform = $('nform'), plist = $('plist');
  const WAGE = ['actual_basic', 'total_days', 'lop_days', 'hra', 'laundry'];
  const WHO = ['name', 'uan', 'ip_no', 'dob', 'esic_reason', 'esic_lwd'];
  const LWD = (root.dataset.lwdCodes || '').split(',').map(Number);
  let cur = -1, dirty = false;

  // ───── calculation (same as calc.py) ─────
  const fix = x => Number(x.toFixed(6));
  const rHalfUp = x => Math.sign(x) * Math.round(Math.abs(fix(x)));
  const rUp = x => Math.ceil(fix(x));
  const int = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  const inr = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-IN');

  function ageFlag(dob) {
    if (!dob) return 'nodob';
    const d = new Date(dob + 'T00:00:00');
    let b58 = new Date(d.getFullYear() + 58, d.getMonth(), d.getDate());
    if (b58.getMonth() !== d.getMonth()) b58 = new Date(d.getFullYear() + 58, 2, 1);
    if (b58 <= new Date(Y, M - 1, 1)) return 'over58';
    if (b58 <= new Date(Y, M, 0)) return 'turns58';
    return 'ok';
  }

  function calc(e) {
    const td = Math.max(int(e.total_days), 0), lop = Math.min(Math.max(int(e.lop_days), 0), td);
    const hra = int(e.hra), laundry = int(e.laundry), actual = int(e.actual_basic);
    const r = { actual_basic: actual, total_days: td, lop, ncp: lop, paid_days: td - lop, hra, laundry };
    r.basic = td ? rHalfUp(actual / td * r.paid_days) : 0;
    r.gross = r.basic * 2;
    r.conveyance = r.gross - (r.basic + hra + laundry);
    r.age = ageFlag(e.dob);
    r.epf_wages = r.eps_wages = r.edli_wages = r.epf_ee = r.eps_er = r.epf_er_diff = 0;
    if (e.uan) {
      r.epf_wages = r.basic;
      r.edli_wages = Math.min(r.basic, CEIL);
      r.eps_wages = r.age === 'over58' ? 0 : Math.min(r.basic, CEIL);
      r.epf_ee = rHalfUp(r.epf_wages * 0.12);
      r.eps_er = rHalfUp(r.eps_wages * 0.0833);
      r.epf_er_diff = r.epf_ee - r.eps_er;
    }
    r.esic_wages = e.ip_no ? Math.max(r.gross - laundry, 0) : 0;
    r.esic_ee = e.ip_no ? rUp(r.esic_wages * 0.0075) : 0;
    r.esic_er = e.ip_no ? rUp(r.esic_wages * 0.0325) : 0;
    r.ded = r.epf_ee + r.esic_ee;
    r.net = r.gross - r.ded;
    return r;
  }

  function flagsHTML(e, r) {
    const f = [];
    if (r.age === 'over58') f.push('<span class="flag over58">58+ · no EPS</span>');
    if (r.age === 'turns58') f.push('<span class="flag turns58">Turns 58 this month</span>');
    if (r.age === 'nodob') f.push('<span class="flag nodob">Date of birth missing</span>');
    if (!e.uan) f.push('<span class="flag nouan">No UAN · not in ECR</span>');
    if (r.conveyance < 0) f.push('<span class="flag nouan">Conveyance negative</span>');
    if (r.esic_wages > 21000) f.push('<span class="flag nodob">ESIC wages over 21,000</span>');
    return f.join('');
  }

  // ───── the working copy of the selected employee ─────
  function formData() {
    const o = { ...entries[cur] };
    [...WAGE, ...WHO].forEach(k => { o[k] = wform.elements[k].value.trim(); });
    o.uan = o.uan.replace(/\D/g, ''); o.ip_no = o.ip_no.replace(/\D/g, '');
    return o;
  }
  const working = i => (i === cur && !wform.hidden ? formData() : entries[i]);

  function paintPanel() {
    const e = formData(), r = calc(e);
    wform.querySelectorAll('[data-k]').forEach(el => {
      const v = r[el.dataset.k];
      el.textContent = (el.dataset.k.startsWith('esic') && !e.ip_no) || (['epf_wages', 'eps_wages', 'edli_wages', 'eps_er', 'epf_er_diff'].includes(el.dataset.k) && !e.uan) ? '—' : inr(v);
      el.classList.toggle('neg', v < 0);
    });
    $('pflags').innerHTML = flagsHTML(e, r);
    $('pids').textContent = [e.uan ? 'UAN ' + e.uan : 'No UAN', e.ip_no ? 'ESIC IP ' + e.ip_no : 'Not under ESIC'].join(' · ');
    $('pname').textContent = e.name || 'Unnamed';
    const zeroEsic = !!e.ip_no && r.paid_days === 0;
    $('esicbox').hidden = !zeroEsic;
    const needLwd = zeroEsic && LWD.includes(int(e.esic_reason));
    $('lwdlabel').hidden = !needLwd;
    wform.elements.lop_days.max = Math.max(int(e.total_days), 0);
    wform.elements.lop_days.classList.toggle('bad', int(e.lop_days) > int(e.total_days));
    $('pstate').textContent = dirty ? 'Not saved' : (entries[cur].entered ? 'Saved' : 'Not entered yet');
    $('pstate').className = 'state ' + (dirty ? 'dirty' : entries[cur].entered ? 'ok' : 'todo');
  }

  // ───── left list ─────
  function renderList() {
    const q = $('find').value.trim().toUpperCase();
    plist.innerHTML = entries.map((e, i) => {
      const w = working(i), r = calc(w);
      const hide = q && !(w.name.toUpperCase().includes(q) || (w.uan || '').includes(q));
      return `<li${hide ? ' hidden' : ''}><button type="button" data-i="${i}" class="${i === cur ? 'cur ' : ''}${e.entered ? 'done' : 'todo'}" ${i === cur ? 'aria-current="true"' : ''}>
        <span class="n">${i + 1}</span><span class="nm">${esc(w.name)}</span>
        <span class="g">${e.entered || i === cur ? '₹' + inr(r.gross) : 'To enter'}</span></button></li>`;
    }).join('');
    const done = entries.filter(e => e.entered).length;
    $('progtxt').textContent = `${done} of ${entries.length} employees entered`;
    $('progbar').style.width = (entries.length ? done / entries.length * 100 : 0) + '%';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ───── summary table ─────
  const COLS = ['actual_basic', 'total_days', 'lop', 'paid_days', 'basic', 'conveyance', 'hra', 'laundry', 'gross', 'epf_ee', 'esic_ee', 'net', 'eps_wages', 'eps_er', 'epf_er_diff'];
  const SUMCOLS = new Set(['actual_basic', 'basic', 'conveyance', 'hra', 'laundry', 'gross', 'epf_ee', 'esic_ee', 'net', 'eps_wages', 'eps_er', 'epf_er_diff']);
  function renderSummary() {
    const tb = document.querySelector('#summary tbody'), tot = Object.fromEntries(COLS.map(c => [c, 0]));
    tb.innerHTML = entries.map((e, i) => {
      const w = working(i), r = calc(w);
      COLS.forEach(c => tot[c] += r[c]);
      return `<tr data-i="${i}" class="${i === cur ? 'cur' : ''}${e.entered ? '' : ' pend'}"><td class="sl">${i + 1}</td>
        <td class="name"><strong>${esc(w.name)}</strong>${e.entered ? '' : '<span class="sub">Not entered yet</span>'}</td>
        ${COLS.map(c => `<td class="${c.startsWith('ep') && c !== 'epf_ee' ? 'epf' : ''}${r[c] < 0 ? ' neg' : ''}">${c === 'gross' || c === 'net' ? '<strong>' + inr(r[c]) + '</strong>' : inr(r[c])}</td>`).join('')}</tr>`;
    }).join('');
    document.querySelector('#summary tfoot tr').innerHTML = '<td></td><td class="name">Total</td>' +
      COLS.map(c => `<td class="${c.startsWith('ep') && c !== 'epf_ee' ? 'epf' : ''}">${SUMCOLS.has(c) ? inr(tot[c]) : ''}</td>`).join('');
  }

  // ───── selection ─────
  function select(i, focus = true) {
    if (i < 0 || i >= entries.length) return;
    cur = i; dirty = false;
    nform.hidden = true; wform.hidden = false;
    const e = entries[i];
    [...WAGE, ...WHO].forEach(k => { wform.elements[k].value = e[k] ?? ''; });
    $('pos').textContent = `Employee ${i + 1} of ${entries.length}`;
    $('who').open = !e.uan || !e.dob;
    $('perr').textContent = '';
    paintPanel(); renderList(); renderSummary();
    const u = new URL(location); u.searchParams.set('e', e.id); history.replaceState(null, '', u);
    if (focus && editable) { const f = wform.elements[e.entered ? 'lop_days' : 'actual_basic']; f.focus(); f.select(); }
    plist.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  }

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(body) });
    let j = {}; try { j = await res.json(); } catch (_) { j = { ok: false, error: 'Server error (' + res.status + ')' }; }
    if (!j.ok) throw new Error(j.error || 'Could not save');
    return j;
  }

  async function save() {
    if (!editable || cur < 0) return true;
    const d = formData();
    if (int(d.lop_days) > int(d.total_days)) { $('perr').textContent = 'LOP days cannot be more than total days.'; wform.elements.lop_days.focus(); return false; }
    if (d.uan && d.uan.length !== 12) { $('perr').textContent = 'UAN must be 12 digits.'; $('who').open = true; wform.elements.uan.focus(); return false; }
    if (d.ip_no && d.ip_no.length !== 10) { $('perr').textContent = 'ESIC IP number must be 10 digits.'; $('who').open = true; wform.elements.ip_no.focus(); return false; }
    if (d.ip_no && int(d.total_days) - int(d.lop_days) === 0 && LWD.includes(int(d.esic_reason)) && !d.esic_lwd) {
      $('perr').textContent = 'ESIC needs the last working day for this reason.'; wform.elements.esic_lwd.focus(); return false;
    }
    $('pstate').textContent = 'Saving…';
    try {
      const j = await post(root.dataset.save.replace(/\/0$/, '/' + d.id), d);
      entries[cur] = j.entry; dirty = false; $('perr').textContent = '';
      paintPanel(); renderList(); renderSummary();
      return true;
    } catch (err) { $('perr').textContent = err.message; paintPanel(); return false; }
  }

  async function goTo(i) { if (dirty && !(await save())) return; select(i); }

  function nextIndex() {
    for (let k = 1; k <= entries.length; k++) { const j = (cur + k) % entries.length; if (!entries[j].entered) return j; }
    return -1;
  }

  // ───── events ─────
  wform.addEventListener('input', () => { dirty = true; $('perr').textContent = ''; paintPanel(); renderList(); renderSummary(); });
  wform.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!(await save())) return;
    const n = nextIndex();
    if (n === -1) {
      $('perr').textContent = '';
      $('pstate').textContent = 'All employees entered';
      $('pstate').className = 'state ok';
      const send = document.querySelector('button[value=submit]');
      if (send) { send.focus(); send.classList.add('pulse'); }
    } else select(n);
  });
  wform.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) { wform.requestSubmit(); return; }
    const ins = [...wform.querySelectorAll('fieldset.inputs input')].filter(x => x.offsetParent);
    const k = ins.indexOf(ev.target);
    if (ev.target.name === 'laundry' || k === ins.length - 1) wform.requestSubmit();
    else { ins[k + 1].focus(); ins[k + 1].select?.(); }
  });
  $('saveonly')?.addEventListener('click', save);
  $('prev')?.addEventListener('click', () => goTo((cur - 1 + entries.length) % entries.length));
  plist.addEventListener('click', ev => { const b = ev.target.closest('[data-i]'); if (b) goTo(+b.dataset.i); });
  document.querySelector('#summary tbody').addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-i]'); if (!tr) return;
    goTo(+tr.dataset.i); root.scrollIntoView({ behavior: 'smooth' });
  });
  $('find').addEventListener('input', renderList);
  $('find').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { const b = plist.querySelector('li:not([hidden]) button'); if (b) goTo(+b.dataset.i); }
  });

  // remove from month
  if (editable) {
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'link danger'; rm.textContent = 'Remove from this month';
    rm.onclick = () => {
      const e = entries[cur];
      if (confirm(`Remove ${e.name} from ${root.dataset.label}? They stay on the employee list.` + (e.ip_no ? `\n\nESIC expects every insured person in the monthly file. If they left, it is better to keep them with LOP = total days and choose reason "2 – Left service".` : ''))) { $('rmid').value = e.id; $('rmform').submit(); }
    };
    wform.querySelector('.pbtns').appendChild(rm);
  }

  // new employee
  $('addnew')?.addEventListener('click', async () => {
    if (dirty && !(await save())) return;
    wform.hidden = true; nform.hidden = false; nform.reset(); $('nerr').textContent = '';
    plist.querySelector('.cur')?.classList.remove('cur');
    nform.elements.name.focus();
  });
  $('ncancel')?.addEventListener('click', () => select(Math.max(cur, 0)));
  nform.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(nform));
    try {
      const j = await post(root.dataset.new, d);
      entries.push(j.entry);
      select(entries.length - 1);
      wform.elements.actual_basic.focus();
    } catch (err) { $('nerr').textContent = err.message; }
  });

  // total days for everyone
  $('daysbtn')?.addEventListener('click', async () => {
    const days = int($('daysall').value);
    if (!confirm(`Set total days to ${days} for all ${entries.length} employees?`)) return;
    if (dirty && !(await save())) return;
    try {
      await post(root.dataset.days, { days });
      entries.forEach(e => { e.total_days = days; e.lop_days = Math.min(int(e.lop_days), days); });
      select(cur, false);
    } catch (err) { alert(err.message); }
  });

  window.addEventListener('beforeunload', ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  document.querySelectorAll('#genbtn, #esicbtn, button[value=submit]').forEach(b => b.addEventListener('click', ev => {
    if (dirty) { ev.preventDefault(); ev.stopImmediatePropagation(); $('perr').textContent = 'Save this employee first.'; }
  }, true));

  // ───── start ─────
  if (!entries.length) {
    if (editable) { wform.hidden = true; nform.hidden = false; nform.elements.name.focus(); }
    else wform.hidden = true;
    renderList(); renderSummary();
    return;
  }
  const want = +new URL(location).searchParams.get('e');
  const wi = entries.findIndex(e => e.id === want);
  const first = entries.findIndex(e => !e.entered);
  select(wi >= 0 ? wi : first >= 0 ? first : 0, wi >= 0 || first >= 0);
})();
