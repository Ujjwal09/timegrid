// Browser-preview only: a fake `window.tg` so the real dashboard.js renders the
// whole application in a plain browser (no Electron). Tracked data is demo/random;
// tasks, habits, weekly & settings persist in localStorage. No Notion here.
(function () {
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const LS = (k, d) => { try { return JSON.parse(localStorage.getItem('tg:prev:' + k)) ?? d; } catch { return d; } };
  const SS = (k, v) => localStorage.setItem('tg:prev:' + k, JSON.stringify(v));

  // ---- demo tracked history: ~45 days of slots tagged with topics ----
  const TOPICS = ['DSA', 'System Design', 'ML', 'Reading', 'Gym', 'Deep Work'];
  const CATMAP = { 'DSA': 'Coding', 'System Design': 'Coding', 'ML': 'Learning', 'Reading': 'Learning', 'Deep Work': 'Focus', 'Gym': 'Health' };
  const days = {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 44; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if (rnd() < 0.12) continue; // some off days
    const slotCount = 6 + Math.floor(rnd() * 12); // 3–9 hours
    const day = {};
    let s = 14 + Math.floor(rnd() * 6);
    for (let k = 0; k < slotCount && s < 46; k++) { day[s] = TOPICS[Math.floor(rnd() * TOPICS.length)]; s += 1 + Math.floor(rnd() * 2); }
    days[keyOf(d)] = day;
  }

  const noop = () => Promise.resolve(true);
  const uid = () => Date.now() + '' + Math.random().toString(36).slice(2, 5);

  window.tg = {
    openTracker: noop, openDashboard: noop,
    getAll: () => Promise.resolve(days),
    getSettings: () => Promise.resolve({ target: LS('target', 8) }),
    setSetting: (k, v) => { if (k === 'target') SS('target', v); return noop(); },
    getCatMap: () => Promise.resolve(CATMAP),
    getMotivation: () => Promise.resolve({ reels: LS('reels', []), notes: [] }),
    setReels: r => { SS('reels', r); return noop(); },
    setNotes: noop,
    getHabits: k => Promise.resolve(LS('habits:' + k, { checks: {}, notes: {} })),
    setHabits: (k, d) => { SS('habits:' + k, d); return noop(); },
    getWeekly: k => Promise.resolve(LS('weekly:' + k, { top: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }], adhoc: [] })),
    setWeekly: (k, d) => { SS('weekly:' + k, d); return noop(); },

    // date-based daily tasks (localStorage; no Notion in the browser preview)
    getDaily: k => Promise.resolve(LS('daily:' + k, { headingId: null, items: [] })),
    addDaily: (k, name) => { const d = LS('daily:' + k, { headingId: null, items: [] }); d.items.push({ id: uid(), name, done: false, doneAt: null, notionBlockId: null }); SS('daily:' + k, d); return Promise.resolve(d); },
    toggleDaily: (k, id) => { const d = LS('daily:' + k, { headingId: null, items: [] }); const t = d.items.find(x => x.id === id); if (t) { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; } SS('daily:' + k, d); return Promise.resolve(d); },
    removeDaily: (k, id) => { const d = LS('daily:' + k, { headingId: null, items: [] }); d.items = d.items.filter(x => x.id !== id); SS('daily:' + k, d); return Promise.resolve(d); },
  };
})();
