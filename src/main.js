const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = require('./store');
const notion = require('./notion');

let panel;      // floating tracker
let dashboard;  // analytics window

function createPanel() {
  panel = new BrowserWindow({
    width: 320,
    height: 620,
    minWidth: 260,
    minHeight: 120,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  panel.setAlwaysOnTop(true, 'floating');
  panel.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  panel.on('closed', () => { panel = null; });
}

// Reopen the tracker if it was closed, otherwise just focus it.
function showPanel() {
  if (panel && !panel.isDestroyed()) { panel.show(); panel.focus(); }
  else createPanel();
}

function openDashboard() {
  if (dashboard) { dashboard.focus(); return; }
  dashboard = new BrowserWindow({
    width: 860,
    height: 640,
    title: 'TimeGrid — Analytics',
    backgroundColor: '#14151a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  dashboard.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  dashboard.on('closed', () => { dashboard = null; });
}

app.whenReady().then(() => {
  // Auto-start at login (only meaningful for the packaged app).
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  store.init(app.getPath('userData'));
  createPanel();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPanel();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: data ----
ipcMain.handle('day:get', (_e, dateKey) => store.getDay(dateKey));
ipcMain.handle('day:set', (_e, dateKey, slots) => { store.setDay(dateKey, slots); return true; });
ipcMain.handle('data:all', () => store.getAll());
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, key, value) => { store.setSetting(key, value); return true; });
ipcMain.handle('tasks:get', () => store.getTasks());
ipcMain.handle('tasks:set', (_e, tasks) => { store.setTasks(tasks); return true; });
ipcMain.handle('plan:get', (_e, dateKey) => store.getPlan(dateKey));
ipcMain.handle('plan:set', (_e, dateKey, slots) => { store.setPlan(dateKey, slots); return true; });
ipcMain.handle('catmap:get', () => store.getCatMap());
ipcMain.handle('catmap:set', (_e, map) => { store.setCatMap(map); return true; });
ipcMain.handle('motivation:get', () => store.getMotivation());
ipcMain.handle('reels:set', (_e, reels) => { store.setReels(reels); return true; });
ipcMain.handle('notes:set', (_e, notes) => { store.setNotes(notes); return true; });
ipcMain.handle('habits:get', (_e, dateKey) => store.getHabits(dateKey));
ipcMain.handle('habits:set', (_e, dateKey, data) => { store.setHabits(dateKey, data); writeHabitsFile(dateKey, data); return true; });
ipcMain.handle('weekly:get', (_e, weekKey) => store.getWeekly(weekKey));
ipcMain.handle('weekly:set', (_e, weekKey, data) => { store.setWeekly(weekKey, data); return true; });

// ---- Date-based daily tasks (local store + best-effort one-way push to Notion) ----
const uid = () => Date.now() + '' + Math.random().toString(36).slice(2, 5);
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

ipcMain.handle('daily:get', (_e, date) => store.getDailyDay(date));

ipcMain.handle('daily:add', async (_e, date, name) => {
  const item = { id: uid(), name, done: false, doneAt: null, notionBlockId: null };
  store.addDailyItem(date, item);
  if (notion.enabled()) {
    // Look up (or create) the one heading for this date — avoids duplicate date blocks.
    const headingId = await notion.ensureDateHeading(date);
    if (headingId) {
      store.setDailyHeading(date, headingId);
      const blockId = await notion.addTodo(headingId, name);
      if (blockId) store.setDailyItem(date, item.id, { notionBlockId: blockId });
    }
  }
  return store.getDailyDay(date);
});

ipcMain.handle('daily:toggle', async (_e, date, id) => {
  const cur = store.getDailyDay(date).items.find(x => x.id === id);
  if (!cur) return store.getDailyDay(date);
  const done = !cur.done;
  const doneAt = done ? Date.now() : null;
  store.setDailyItem(date, id, { done, doneAt });
  if (notion.enabled() && cur.notionBlockId) {
    await notion.setTodo(cur.notionBlockId, { checked: done, text: done ? `${cur.name} — done ${hhmm(doneAt)}` : cur.name });
  }
  return store.getDailyDay(date);
});

ipcMain.handle('daily:remove', async (_e, date, id) => {
  const cur = store.getDailyDay(date).items.find(x => x.id === id);
  if (notion.enabled() && cur && cur.notionBlockId) await notion.deleteBlock(cur.notionBlockId);
  store.removeDailyItem(date, id);
  return store.getDailyDay(date);
});

// ---- Daily habits: also write a human-readable text file per day (for use outside the app) ----
const HABIT_ITEMS = [
  { id: 'chatgpt', label: 'ChatGPT — Discussion on certain topic' },
  { id: 'sysdesign', label: 'System Design' },
  { id: 'deconstruct', label: 'Deconstruct a company' },
  { id: 'gym', label: 'Gym' },
];
function buildHabitsText(dateKey, data) {
  const checks = (data && data.checks) || {};
  const notes = (data && data.notes) || {};
  let out = `TimeGrid — Daily — ${dateKey}\n\n`;
  HABIT_ITEMS.forEach(it => {
    out += `[${checks[it.id] ? 'x' : ' '}] ${it.label}\n`;
    const note = (notes[it.id] || '').trim();
    if (note) out += note.split('\n').map(l => '    ' + l).join('\n') + '\n';
    out += '\n';
  });
  return out.trimEnd() + '\n';
}
function writeHabitsFile(dateKey, data) {
  const fs = require('fs');
  const dir = path.join(app.getPath('userData'), 'notes');
  const file = path.join(dir, `${dateKey}.txt`);
  const checks = (data && data.checks) || {};
  const notes = (data && data.notes) || {};
  const empty = !Object.values(checks).some(Boolean) && !Object.values(notes).some(t => (t || '').trim());
  try {
    if (empty) { fs.rmSync(file, { force: true }); return; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buildHabitsText(dateKey, data), 'utf8');
  } catch { /* non-fatal: JSON store is the source of truth */ }
}

// ---- IPC: window controls ----
ipcMain.on('win:minimize', () => panel && panel.minimize());
ipcMain.on('win:close', () => panel && panel.close());
ipcMain.on('win:toggleTop', (_e, on) => panel && panel.setAlwaysOnTop(on, 'floating'));
ipcMain.on('win:dashboard', () => openDashboard());
ipcMain.on('win:tracker', () => showPanel());
ipcMain.on('win:resize', (_e, w, h) => {
  if (!panel) return;
  const [x, y] = panel.getPosition();
  panel.setBounds({ x, y, width: Math.round(w), height: Math.round(h) }, false);
});
