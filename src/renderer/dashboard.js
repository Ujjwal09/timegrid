const TOTAL = 48;
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const el = id => document.getElementById(id);

function dayAgo(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
const fmtDate = t => { const d = new Date(t); return `${pad(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })}`; };
const daysBetween = (a, b) => Math.max(0, Math.floor((b - a) / DAY));

const GOAL_TIERS = [10, 24, 50, 100];

function topicColor(topic) {
  if (!topic) return null;
  let h = 0;
  for (let i = 0; i < topic.length; i++) h = (h * 31 + topic.charCodeAt(i)) % 360;
  return `hsl(${h} 62% 58%)`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let target = 8;
let catMap = {};                        // topic -> category (remembered mapping)
const catOf = t => (t ? (catMap[t] || t) : '');   // category of a specific topic
let goalsView = 'D';
let goalDates = [];          // Date (midnight) per column, earliest..today
let goalSeries = [];         // [{ name, color, cum: [] }]
let goalDayHours = [];       // total hours actually logged each day (all categories), aligned to goalDates

el('backBtn').onclick = () => window.tg.openTracker();

(async () => {
  const all = await window.tg.getAll();
  const settings = await window.tg.getSettings();
  target = settings && settings.target ? settings.target : 8;
  catMap = (await window.tg.getCatMap()) || {};

  const slotsOf = k => Object.keys(all[k] || {});
  const countOf = k => slotsOf(k).length;

  // ---- series: last 30 days (index 0 = today) ----
  const days30 = [];
  for (let i = 29; i >= 0; i--) { const d = dayAgo(i); days30.push({ d, key: keyOf(d), n: countOf(keyOf(d)) }); }

  const active = Object.keys(all).filter(k => countOf(k));
  el('sub').textContent = active.length
    ? `${active.length} day${active.length > 1 ? 's' : ''} tracked · earliest ${active.sort()[0]}`
    : 'No data yet — start ticking slots in the tracker.';

  // ---- target box ----
  const targetEl = el('target');
  targetEl.value = target;
  targetEl.addEventListener('input', () => {
    target = Math.max(0.5, parseFloat(targetEl.value) || 8);
    window.tg.setSetting('target', target);
    renderKpis();
  });

  // ---- KPIs (percentages vs daily target) ----
  const hrs = n => n / 2;                          // slots -> hours
  const todaySlots = countOf(keyOf(dayAgo(0)));
  const last7 = [...Array(7)].map((_, i) => countOf(keyOf(dayAgo(i))));
  const avg7 = last7.reduce((a, b) => a + b, 0) / 7;
  let streak = 0;
  for (let i = 0; i < 365; i++) { if (countOf(keyOf(dayAgo(i))) > 0) streak++; else break; }
  const hitDays = active.filter(k => hrs(countOf(k)) >= target).length;

  window.renderKpis = function renderKpis() {
    const pct = h => Math.round(h / target * 100);
    el('kpis').innerHTML = [
      ['Today', `${hrs(todaySlots)}<small> / ${target}h · ${pct(hrs(todaySlots))}%</small>`, true],
      ['7-day avg', `${(+hrs(avg7).toFixed(1))}<small> / ${target}h · ${pct(hrs(avg7))}%</small>`, false],
      ['Target hit', `${hitDays}<small> / ${active.length || 0} days</small>`, true],
      ['Current streak', `${streak}<small> day${streak === 1 ? '' : 's'}</small>`, false],
    ].map(([l, v, a]) => `<div class="kpi"><div class="v ${a ? 'accent' : ''}">${v}</div><div class="l">${l}</div></div>`).join('');
  };
  renderKpis();

  // ---- 30-day trend ----
  el('trend').innerHTML = svgBars(days30.map(x => x.n), days30.map(x => x.d),
    (d, i) => (i % 5 === 0 || i === 29) ? `${d.getDate()}/${d.getMonth() + 1}` : '', TOTAL, true,
    v => v ? v / 2 : '');

  // ---- category goals: completion bars (aggregate) ----
  renderGoalsBars(all);

  // ---- build cumulative topic series over full history + trend chart ----
  buildGoalSeries(all, active);
  renderGoals();

  // ---- consistency heatmap ----
  renderHeat(all);

  // ---- daily habits ----
  await initHabits();

  // ---- weekly priorities ----
  await initWeekly();

  // ---- tasks ----
  const tasks = await window.tg.getTasks();
  initTasks(tasks);

  // ---- motivation (reels + notes) ----
  await initMotivation();
})();

// ---- weekly priorities ----
const WP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function mondayOf(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return d; }
function weekRangeLabel(mon) {
  const sun = new Date(mon.getTime() + 6 * DAY);
  if (mon.getMonth() === sun.getMonth()) return `${mon.getDate()}–${sun.getDate()} ${WP_MON[sun.getMonth()]}`;
  return `${mon.getDate()} ${WP_MON[mon.getMonth()]}–${sun.getDate()} ${WP_MON[sun.getMonth()]}`;
}

async function initWeekly() {
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const curMonday = mondayOf(todayMid);
  let viewMonday = new Date(curMonday);
  const isThisWeek = () => viewMonday.getTime() === curMonday.getTime();
  let data = { top: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }], adhoc: [] };

  const topHost = el('wpTop'), ahHost = el('wpAdhoc');
  async function loadWeek() { data = await window.tg.getWeekly(keyOf(viewMonday)); }
  function persist() { window.tg.setWeekly(keyOf(viewMonday), data); }

  function render() {
    el('wpRangeLbl').textContent = weekRangeLabel(viewMonday);
    el('wpThisTag').style.display = isThisWeek() ? '' : 'none';
    el('wpNext').disabled = isThisWeek();

    topHost.innerHTML = data.top.map((it, i) => `<div class="wprow ${it.done ? 'done' : ''}">
      <span class="chk ${it.done ? 'on' : ''}" data-top="${i}"></span>
      <span class="wpnum">${i + 1}</span>
      <input data-toptext="${i}" placeholder="Priority ${i + 1}…" value="${escapeHtml(it.text || '')}">
    </div>`).join('');
    topHost.querySelectorAll('[data-top]').forEach(c => c.onclick = () => { data.top[c.dataset.top].done = !data.top[c.dataset.top].done; persist(); render(); });
    topHost.querySelectorAll('[data-toptext]').forEach(inp => inp.oninput = () => { data.top[inp.dataset.toptext].text = inp.value; persist(); });

    ahHost.innerHTML = data.adhoc.map(it => `<div class="wprow ${it.done ? 'done' : ''}">
      <span class="chk ${it.done ? 'on' : ''}" data-ah="${it.id}"></span>
      <input data-ahtext="${it.id}" placeholder="Something to do…" value="${escapeHtml(it.text || '')}">
      <button class="del" data-del="${it.id}" title="Remove">✕</button>
    </div>`).join('');
    el('wpAdhocEmpty').style.display = data.adhoc.length ? 'none' : '';
    ahHost.querySelectorAll('[data-ah]').forEach(c => c.onclick = () => { const it = data.adhoc.find(x => x.id === c.dataset.ah); it.done = !it.done; persist(); render(); });
    ahHost.querySelectorAll('[data-ahtext]').forEach(inp => inp.oninput = () => { const it = data.adhoc.find(x => x.id === inp.dataset.ahtext); it.text = inp.value; persist(); });
    ahHost.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { data.adhoc = data.adhoc.filter(x => x.id !== b.dataset.del); persist(); render(); });
  }

  el('wpAddAdhoc').onclick = () => {
    data.adhoc.push({ id: Date.now() + '' + Math.random().toString(36).slice(2, 5), text: '', done: false });
    persist(); render();
    const inputs = ahHost.querySelectorAll('[data-ahtext]'); if (inputs.length) inputs[inputs.length - 1].focus();
  };
  el('wpPrev').onclick = async () => { viewMonday = new Date(viewMonday.getTime() - 7 * DAY); await loadWeek(); render(); };
  el('wpNext').onclick = async () => { if (isThisWeek()) return; viewMonday = new Date(viewMonday.getTime() + 7 * DAY); await loadWeek(); render(); };

  await loadWeek(); render();
}

const HABIT_ITEMS = [
  { id: 'chatgpt', label: 'ChatGPT — Discussion on certain topic' },
  { id: 'sysdesign', label: 'System Design' },
  { id: 'deconstruct', label: 'Deconstruct a company' },
  { id: 'gym', label: 'Gym' },
];

async function initHabits() {
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  let viewDate = new Date(todayMid);
  const isToday = () => viewDate.getTime() === todayMid.getTime();
  let data = { checks: {}, notes: {} };
  let editing = null;

  const rows = el('habitRows');
  const ovl = el('hOvl');

  async function loadDay() { data = await window.tg.getHabits(keyOf(viewDate)); }
  function persist() { window.tg.setHabits(keyOf(viewDate), data); }

  function render() {
    el('hDateLbl').textContent = viewDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    el('hTodayTag').style.display = isToday() ? '' : 'none';
    el('hNext').disabled = isToday();
    rows.innerHTML = HABIT_ITEMS.map(it => {
      const on = !!data.checks[it.id];
      const note = (data.notes[it.id] || '').trim();
      return `<div class="hrow ${on ? 'done' : ''}">
        <span class="chk ${on ? 'on' : ''}" data-id="${it.id}"></span>
        <span class="hname">${escapeHtml(it.label)}</span>
        <button class="notebtn ${note ? 'has' : ''}" data-note="${it.id}" title="${note ? 'Edit note' : 'Add note'}">📝</button>
      </div>`;
    }).join('');
    rows.querySelectorAll('.chk').forEach(c => c.onclick = () => {
      data.checks[c.dataset.id] = !data.checks[c.dataset.id]; persist(); render();
    });
    rows.querySelectorAll('[data-note]').forEach(b => b.onclick = () => openNote(b.dataset.note));
  }

  function openNote(id) {
    editing = id;
    const it = HABIT_ITEMS.find(x => x.id === id);
    el('hOvlTitle').textContent = it.label;
    el('hOvlDate').textContent = keyOf(viewDate);
    el('hOvlText').value = data.notes[id] || '';
    ovl.classList.add('show');
    setTimeout(() => el('hOvlText').focus(), 0);
  }
  function closeNote() { ovl.classList.remove('show'); editing = null; }
  el('hOvlCancel').onclick = closeNote;
  el('hOvlSave').onclick = () => { if (editing) { data.notes[editing] = el('hOvlText').value; persist(); render(); } closeNote(); };
  ovl.onclick = e => { if (e.target === ovl) closeNote(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && editing) closeNote(); });

  el('hPrev').onclick = async () => { viewDate.setDate(viewDate.getDate() - 1); await loadDay(); render(); };
  el('hNext').onclick = async () => { if (isToday()) return; viewDate.setDate(viewDate.getDate() + 1); await loadDay(); render(); };

  await loadDay(); render();
}

async function initMotivation() {
  const m = await window.tg.getMotivation();
  let reels = Array.isArray(m.reels) ? m.reels : [];
  let notes = Array.isArray(m.notes) ? m.notes : [];
  const fmt = ts => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const shortcode = url => { const x = String(url).match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/); return x ? x[1] : null; };

  // reels
  const reelHost = el('reels');
  function renderReels() {
    reelHost.innerHTML = reels.map(code => `<div class="reel">
      <button class="rm" data-code="${code}" title="Remove">✕</button>
      <iframe src="https://www.instagram.com/reel/${code}/embed/" allowtransparency="true" allowfullscreen scrolling="no"></iframe>
    </div>`).join('');
    el('reelsEmpty').style.display = reels.length ? 'none' : '';
    reelHost.querySelectorAll('.rm').forEach(b => b.onclick = () => {
      reels = reels.filter(c => c !== b.dataset.code); window.tg.setReels(reels); renderReels();
    });
  }
  el('addReel').onclick = () => {
    const inp = el('reelUrl'); const code = shortcode(inp.value.trim());
    if (!code) { inp.style.borderColor = 'var(--no)'; return; }
    inp.style.borderColor = '';
    if (!reels.includes(code)) reels = [code, ...reels];
    inp.value = ''; window.tg.setReels(reels); renderReels();
  };
  el('reelUrl').addEventListener('keydown', e => { if (e.key === 'Enter') el('addReel').click(); });

  // notes
  const noteHost = el('notes');
  function renderNotes() {
    noteHost.innerHTML = notes.map(n => `<div class="note" data-id="${n.id}">
      <textarea placeholder="Write a note…">${escapeHtml(n.text || '')}</textarea>
      <div class="foot"><span class="when">${n.ts ? 'edited ' + fmt(n.ts) : ''}</span><button class="del">Delete</button></div>
    </div>`).join('');
    el('notesEmpty').style.display = notes.length ? 'none' : '';
    noteHost.querySelectorAll('.note').forEach(row => {
      const id = row.dataset.id, ta = row.querySelector('textarea');
      ta.oninput = () => {
        const n = notes.find(x => x.id === id); n.text = ta.value; n.ts = Date.now();
        row.querySelector('.when').textContent = 'edited ' + fmt(n.ts); window.tg.setNotes(notes);
      };
      row.querySelector('.del').onclick = () => { notes = notes.filter(x => x.id !== id); window.tg.setNotes(notes); renderNotes(); };
    });
  }
  el('addNote').onclick = () => {
    notes = [{ id: Date.now() + '' + Math.random().toString(36).slice(2, 5), text: '', ts: Date.now() }, ...notes];
    window.tg.setNotes(notes); renderNotes();
    const first = noteHost.querySelector('.note textarea'); if (first) first.focus();
  };

  renderReels(); renderNotes();
}

// Build goalDates + goalSeries (cumulative hours per category) over earliest..today.
function buildGoalSeries(all, active) {
  const names = new Set();
  Object.values(all).forEach(day => Object.values(day).forEach(t => { if (t) names.add(catOf(t)); }));
  if (!active.length || !names.size) { goalDates = []; goalSeries = []; return; }

  const earliest = new Date(active.slice().sort()[0] + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  goalDates = [];
  for (let t = earliest.getTime(); t <= today.getTime(); t += DAY) goalDates.push(new Date(t));
  goalDayHours = goalDates.map(d => Object.keys(all[keyOf(d)] || {}).length * 0.5);

  goalSeries = [...names].map(name => {
    let acc = 0;
    const cum = goalDates.map(d => {
      const day = all[keyOf(d)] || {};
      const hrs = Object.values(day).filter(tp => catOf(tp) === name).length * 0.5;
      acc += hrs;
      return acc;
    });
    return { name, color: topicColor(name), cum };
  }).sort((a, b) => b.cum[b.cum.length - 1] - a.cum[a.cum.length - 1]);
}

// Aggregate hours per category (0.5h per slot) + progress bars toward goal tiers.
function renderGoalsBars(all) {
  const hours = {};
  Object.values(all).forEach(day => Object.values(day).forEach(t => {
    const name = catOf(t) || '(untagged)';
    hours[name] = (hours[name] || 0) + 0.5;
  }));
  const topics = Object.entries(hours).sort((a, b) => b[1] - a[1]);
  const host = el('goals');
  if (!topics.length) { host.innerHTML = '<div class="empty">No topics yet — set a topic in the tracker, then tick slots.</div>'; return; }

  const maxTier = GOAL_TIERS[GOAL_TIERS.length - 1];
  host.innerHTML = topics.map(([name, h]) => {
    const col = topicColor(name === '(untagged)' ? '' : name) || 'var(--accent)';
    const next = GOAL_TIERS.find(t => h < t);
    const tierLabel = next ? `${h} / ${next} h` : `${h} h — 100h reached 🎉`;
    const width = Math.min(100, h / maxTier * 100);
    const ticks = GOAL_TIERS.map(t =>
      `<span class="${h >= t ? 'hit' : ''}" style="left:${t / maxTier * 100}%">${t}h</span>`).join('');
    return `<div class="goal">
      <div class="top">
        <span class="swatch" style="background:${col}"></span>
        <span class="name">${escapeHtml(name)}</span>
        <span class="hrs"><b>${h}</b> h</span>
        <span class="tier">${tierLabel}</span>
      </div>
      <div class="track"><i style="width:${width}%;background:${col}"></i></div>
      <div class="ticks">${ticks}</div>
    </div>`;
  }).join('');
}

// Group days into buckets for the current view. Each bucket carries the day index used
// for its cumulative value (idx), the day range for its total (from..to), an x-axis label,
// and whether it gets a marker/label. Buckets are spaced evenly on the x-axis.
function goalBuckets() {
  const N = goalDates.length, b = [];
  if (goalsView === 'D') {
    for (let i = 0; i < N; i++) b.push({ idx: i, from: i, to: i, label: fmtDate(goalDates[i]), marker: goalDates[i].getDay() === 0 || i === N - 1 });
    return b;
  }
  if (goalsView === 'W') {
    // Calendar weeks (Mon–Sun): a bucket ends on each Sunday; the final partial week is
    // labelled by its upcoming Sunday (its calendar week-end), even though it's in the future.
    let start = 0;
    for (let i = 0; i < N; i++) {
      const sun = goalDates[i].getDay() === 0;
      if (sun || i === N - 1) {
        let label;
        if (sun) label = fmtDate(goalDates[i]);
        else { const d = new Date(goalDates[i]); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); label = fmtDate(d); }
        b.push({ idx: i, from: start, to: i, label, marker: true });
        start = i + 1;
      }
    }
    return b;
  }
  // Calendar months
  let start = 0;
  for (let i = 0; i < N; i++) {
    if (i === N - 1 || goalDates[i].getMonth() !== goalDates[i + 1].getMonth()) {
      b.push({ idx: i, from: start, to: i, label: goalDates[i].toLocaleString('en-GB', { month: 'short' }), marker: true });
      start = i + 1;
    }
  }
  return b;
}

function renderGoals() {
  const host = el('goalsChart'), legend = el('goalsLegend');
  const N = goalDates.length;
  if (!N) { host.innerHTML = '<div class="empty">No topics yet — set a topic in the tracker, then tick slots.</div>'; legend.innerHTML = ''; return; }

  const W = 880, H = 280, pl = 40, pr = 44, pt = 18, pb = 24;
  const plotW = W - pl - pr, plotH = H - pt - pb;
  // Adaptive ceiling for the cumulative lines (left axis): 10 -> 24 -> 50 -> 100.
  const maxCum = Math.max(...goalSeries.map(s => s.cum[N - 1]));
  const maxY = GOAL_TIERS.find(t => t >= maxCum) || Math.max(100, Math.ceil(maxCum / 25) * 25);
  const y = v => pt + plotH - (v / maxY) * plotH;

  const buckets = goalBuckets();
  const nB = buckets.length;
  const xk = k => pl + (nB === 1 ? plotW / 2 : (k / (nB - 1)) * plotW);   // even spacing per bucket
  const cumAt = (s, k) => s.cum[buckets[k].idx];

  // ---- bars: total hours per bucket (across all categories), right axis ----
  const totals = buckets.map(bk => {
    let s = 0; for (let d = bk.from; d <= bk.to; d++) s += goalDayHours[d] || 0; return +s.toFixed(1);
  });
  const maxBar = Math.max(Math.ceil(Math.max(...totals, 1) / 5) * 5, 5);
  const yR = v => pt + plotH - (v / maxBar) * plotH;
  const bw = Math.max(3, (plotW / nB) * 0.6);
  let bars = '';
  buckets.forEach((bk, k) => {
    const v = totals[k]; const h = (v / maxBar) * plotH; const bx = xk(k) - bw / 2; const by = pt + plotH - h;
    bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="rgba(255,255,255,0.14)"></rect>`;
    if (goalsView !== 'D' && v > 0) bars += `<text x="${xk(k).toFixed(1)}" y="${(by - 4).toFixed(1)}" fill="var(--muted)" font-size="9" text-anchor="middle">${v}</text>`;
  });
  let raxis = '';
  [0, 0.5, 1].forEach(f => { const val = Math.round(maxBar * f); raxis += `<text x="${pl + plotW + 6}" y="${(yR(val) + 3).toFixed(1)}" fill="var(--faint)" font-size="10">${val}h</text>`; });

  let grid = '';
  GOAL_TIERS.forEach(t => {
    if (t > maxY) return;
    const yy = y(t);
    grid += `<line x1="${pl}" y1="${yy}" x2="${pl + plotW}" y2="${yy}" stroke="rgba(255,255,255,0.09)" stroke-dasharray="3 4"/>`;
    grid += `<text x="${pl - 6}" y="${yy + 3}" fill="var(--faint)" font-size="10" text-anchor="end">${t}h</text>`;
  });
  let xlab = '';
  buckets.forEach((bk, k) => { if (bk.marker) xlab += `<text x="${xk(k)}" y="${H - 6}" fill="var(--faint)" font-size="9" text-anchor="middle">${bk.label}</text>`; });

  let lines = '', dots = '', vlabels = '';
  goalSeries.forEach(s => {
    const pts = buckets.map((bk, k) => `${xk(k).toFixed(1)},${y(cumAt(s, k)).toFixed(1)}`).join(' ');
    lines += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    buckets.forEach((bk, k) => {
      if (!bk.marker) return;
      const px = xk(k), py = y(cumAt(s, k));
      dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${s.color}"/>`;
      vlabels += `<text x="${px.toFixed(1)}" y="${(py - 7).toFixed(1)}" fill="${s.color}" font-size="9" font-weight="600" text-anchor="middle">${(+cumAt(s, k).toFixed(1))}</text>`;
    });
  });

  const guide = `<line id="hoverGuide" x1="0" x2="0" y1="${pt}" y2="${pt + plotH}" stroke="rgba(255,255,255,0.28)" stroke-width="1" style="display:none"/>`;
  const hoverDots = goalSeries.map((s, si) => `<circle id="hd${si}" r="4.5" fill="${s.color}" stroke="#14151a" stroke-width="1.5" style="display:none"/>`).join('');
  const hit = `<rect id="hoverHit" x="${pl}" y="${pt}" width="${plotW}" height="${plotH}" fill="transparent"/>`;

  host.style.position = 'relative';
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}${bars}${lines}${dots}${vlabels}${raxis}${xlab}${guide}${hoverDots}${hit}</svg><div class="charttip" id="charttip" style="display:none"></div>`;

  const bucketWord = goalsView === 'D' ? 'day' : goalsView === 'W' ? 'week' : 'month';
  legend.innerHTML = goalSeries.map(s => {
    const cur = s.cum[N - 1], next = GOAL_TIERS.find(t => cur < t);
    return `<span class="it"><span class="sw" style="background:${s.color}"></span>${escapeHtml(s.name)} · <b>${+cur.toFixed(1)}h</b>${next ? ` → ${next}h` : ' · 100h ✓'}</span>`;
  }).join('') + `<span class="it"><span class="sw" style="background:rgba(255,255,255,0.14)"></span>Total hours / ${bucketWord}</span>`;

  // ---- interactivity: hover guide + tooltip ----
  const svg = host.querySelector('svg');
  const tip = el('charttip');
  const guideEl = svg.querySelector('#hoverGuide');
  const move = e => {
    const rect = svg.getBoundingClientRect();
    const vbX = (e.clientX - rect.left) / rect.width * W;
    let k = nB === 1 ? 0 : Math.round((vbX - pl) / plotW * (nB - 1));
    k = Math.max(0, Math.min(nB - 1, k));
    const gx = xk(k);
    const vbY = (e.clientY - rect.top) / rect.height * H;

    // pick the single nearest topic line at this bucket
    let near = 0, best = Infinity;
    goalSeries.forEach((s, si) => {
      const dd = Math.abs(y(cumAt(s, k)) - vbY);
      if (dd < best) { best = dd; near = si; }
    });
    const s = goalSeries[near];
    const py = y(cumAt(s, k));

    guideEl.setAttribute('x1', gx); guideEl.setAttribute('x2', gx); guideEl.style.display = '';
    goalSeries.forEach((_, si) => {
      const dot = svg.querySelector('#hd' + si);
      if (si === near) { dot.setAttribute('cx', gx); dot.setAttribute('cy', py); dot.style.display = ''; }
      else dot.style.display = 'none';
    });

    tip.innerHTML = `<div class="tdate">${buckets[k].label}</div>` +
      `<div class="trow"><span class="sw" style="background:${s.color}"></span>${escapeHtml(s.name)}<b>${+cumAt(s, k).toFixed(1)}h</b></div>` +
      `<div class="trow ttot">Total this ${bucketWord}<b>${totals[k]}h</b></div>`;
    tip.style.display = '';
    tip.style.left = (gx / W * rect.width) + 'px';
    tip.style.top = (py / H * rect.height) + 'px';
  };
  const leave = () => {
    guideEl.style.display = 'none';
    tip.style.display = 'none';
    goalSeries.forEach((_, si) => { svg.querySelector('#hd' + si).style.display = 'none'; });
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', leave);
}
document.querySelectorAll('#viewSeg button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('#viewSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); goalsView = b.dataset.v; renderGoals();
  };
});

// ---- tasks ----
function initTasks(loaded) {
  let tasks = Array.isArray(loaded) ? loaded : [];
  let showCompleted = false;
  const saveTasks = () => window.tg.setTasks(tasks);

  function render() {
    const now = Date.now();
    const activeT = tasks.filter(t => !t.done);
    const doneT = tasks.filter(t => t.done);

    el('activeRows').innerHTML = activeT.map(t => {
      const age = daysBetween(t.start, now);
      return `<tr data-id="${t.id}">
        <td class="c"><span class="chk" data-id="${t.id}"></span></td>
        <td class="tname">${escapeHtml(t.name)}</td>
        <td class="d">${fmtDate(t.start)}</td>
        <td class="o"><span class="agebadge ${age >= 7 ? 'warn' : ''}">${age}d</span></td>
      </tr>`;
    }).join('');
    el('activeEmpty').style.display = activeT.length ? 'none' : '';

    el('doneCount').textContent = doneT.length;
    el('completedHdr').firstChild.textContent = (showCompleted ? '▾ ' : '▸ ') + 'Completed (';
    el('completedTable').style.display = (showCompleted && doneT.length) ? '' : 'none';
    el('completedRows').innerHTML = doneT.map(t => `<tr class="done" data-id="${t.id}">
        <td class="c"><span class="chk on" data-id="${t.id}"></span></td>
        <td class="tname">${escapeHtml(t.name)}</td>
        <td class="d">${fmtDate(t.doneAt)}</td>
        <td class="o">${daysBetween(t.start, t.doneAt)}d</td>
      </tr>`).join('');

    document.querySelectorAll('#activeRows .chk, #completedRows .chk').forEach(c => {
      c.onclick = () => {
        const t = tasks.find(x => x.id === c.dataset.id); if (!t) return;
        t.done = !t.done; t.doneAt = t.done ? Date.now() : null; saveTasks(); render();
      };
    });
  }
  function addTask() {
    const inp = el('taskInput'); const name = inp.value.trim(); if (!name) return;
    tasks.push({ id: Date.now() + '' + Math.random().toString(36).slice(2, 5), name, start: Date.now(), done: false, doneAt: null });
    inp.value = ''; saveTasks(); render();
  }
  el('addTask').onclick = addTask;
  el('taskInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  el('completedHdr').onclick = () => { showCompleted = !showCompleted; render(); };
  render();
}

// Generic SVG bar chart. vals scaled to `max`. labelFn(item,i)->string for x-axis.
// valFmt(v,i)->string (optional) prints an absolute value above each bar.
function svgBars(vals, items, labelFn, max, dimPast, valFmt) {
  if (!vals.length) return '<div class="empty">No data</div>';
  const W = 560, H = 150, pb = 18, pt = 10, pl = 4;
  const n = vals.length, gap = 2;
  const bw = (W - pl) / n - gap;
  const chartH = H - pb;
  let bars = '', labels = '', vlabels = '';
  vals.forEach((v, i) => {
    const h = max > 0 ? (v / max) * (chartH - pt) : 0;
    const x = pl + i * (bw + gap);
    const y = chartH - h;
    const dim = dimPast && i === n - 1 && v === 0;
    bars += `<rect class="bar ${dim ? 'dim' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2"></rect>`;
    const lab = labelFn(items[i], i);
    if (lab) labels += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${lab}</text>`;
    if (valFmt) {
      const vl = valFmt(v, i);
      if (vl !== '') vlabels += `<text class="vlabel" x="${(x + bw / 2).toFixed(1)}" y="${(y - 2.5).toFixed(1)}" text-anchor="middle">${vl}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}">${bars}${labels}${vlabels}</svg>`;
}

function renderHeat(all) {
  const weeks = 5;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monOffset = (today.getDay() + 6) % 7;
  const start = new Date(today); start.setDate(today.getDate() - monOffset - (weeks - 1) * 7);
  const shade = p => p === 0 ? 'rgba(255,255,255,0.05)' : `rgba(94,234,212,${(0.12 + p * 0.88).toFixed(2)})`;
  let cols = '';
  for (let w = 0; w < weeks; w++) {
    let cells = '';
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + dow);
      const future = d > today;
      const n = Object.keys(all[keyOf(d)] || {}).length;
      const p = future ? -1 : n / 48;
      const bg = future ? 'transparent' : shade(p);
      const title = future ? '' : `${keyOf(d)} — ${n / 2} h`;
      cells += `<div class="cell" style="background:${bg}" title="${title}"></div>`;
    }
    cols += `<div class="col">${cells}</div>`;
  }
  el('heat').innerHTML = `<div class="hm">${cols}</div>`;
}
