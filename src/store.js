// Simple JSON-file store in Electron's userData dir.
// New shape: { days: { "YYYY-MM-DD": { "<slot>": "topic" } }, settings: {...}, tasks: [...] }
// Old shape (auto-migrated): a flat { "YYYY-MM-DD": {...} } object of days.
const fs = require('fs');
const path = require('path');

let filePath;
let cache = { days: {}, plans: {}, catMap: {}, settings: { target: 8 }, tasks: [], motivation: { reels: [], notes: [] }, habits: {}, weekly: {} };

// Back-compat: older days stored as arrays of slot indexes.
function normalizeDay(v) {
  if (Array.isArray(v)) {
    const o = {};
    v.forEach(i => { o[i] = ''; });
    return o;
  }
  return v || {};
}

function init(userDataDir) {
  filePath = path.join(userDataDir, 'timegrid-data.json');
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw && raw.days) {
      // new format
      for (const k of Object.keys(raw.days)) cache.days[k] = normalizeDay(raw.days[k]);
      cache.plans = (raw.plans && typeof raw.plans === 'object') ? raw.plans : {};
      cache.catMap = (raw.catMap && typeof raw.catMap === 'object') ? raw.catMap : {};
      cache.settings = Object.assign({ target: 8 }, raw.settings || {});
      cache.tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
      cache.motivation = {
        reels: Array.isArray(raw.motivation && raw.motivation.reels) ? raw.motivation.reels : [],
        notes: Array.isArray(raw.motivation && raw.motivation.notes) ? raw.motivation.notes : [],
      };
      cache.habits = (raw.habits && typeof raw.habits === 'object') ? raw.habits : {};
      cache.weekly = (raw.weekly && typeof raw.weekly === 'object') ? raw.weekly : {};
    } else if (raw) {
      // old flat format: every key is a date
      for (const k of Object.keys(raw)) cache.days[k] = normalizeDay(raw[k]);
    }
  } catch {
    // keep defaults
  }
}

function flush() {
  fs.writeFileSync(filePath, JSON.stringify(cache), 'utf8');
}

function getDay(dateKey) {
  return cache.days[dateKey] || {};
}

function setDay(dateKey, slots) {
  if (slots && Object.keys(slots).length) cache.days[dateKey] = slots;
  else delete cache.days[dateKey];
  flush();
}

// All days, for the analytics dashboard.
function getAll() {
  return cache.days;
}

// Planned (intended) slots per day — separate from actual done slots.
function getPlan(dateKey) {
  return cache.plans[dateKey] || {};
}
function setPlan(dateKey, slots) {
  if (slots && Object.keys(slots).length) cache.plans[dateKey] = slots;
  else delete cache.plans[dateKey];
  flush();
}

// Remembered topic -> category mapping (for rolling specific topics up to categories).
function getCatMap() {
  return cache.catMap;
}
function setCatMap(map) {
  cache.catMap = map || {};
  flush();
}

function getSettings() {
  return cache.settings;
}
function setSetting(key, value) {
  cache.settings[key] = value;
  flush();
}

function getTasks() {
  return cache.tasks;
}
function setTasks(tasks) {
  cache.tasks = tasks || [];
  flush();
}

function getMotivation() {
  return cache.motivation;
}
function setReels(reels) {
  cache.motivation.reels = reels || [];
  flush();
}
function setNotes(notes) {
  cache.motivation.notes = notes || [];
  flush();
}

// Daily habits per day: { checks: { id: bool }, notes: { id: text } }
function getHabits(dateKey) {
  return cache.habits[dateKey] || { checks: {}, notes: {} };
}
function setHabits(dateKey, data) {
  const checks = (data && data.checks) || {};
  const notes = (data && data.notes) || {};
  const anyCheck = Object.values(checks).some(Boolean);
  const anyNote = Object.values(notes).some(t => (t || '').trim());
  if (anyCheck || anyNote) cache.habits[dateKey] = { checks, notes };
  else delete cache.habits[dateKey];
  flush();
}

// Weekly priorities per week (keyed by that week's Monday YYYY-MM-DD):
// { top: [{text, done} x3], adhoc: [{id, text, done}] }
function getWeekly(weekKey) {
  return cache.weekly[weekKey] || { top: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }], adhoc: [] };
}
function setWeekly(weekKey, data) {
  const top = (data && Array.isArray(data.top)) ? data.top : [];
  const adhoc = (data && Array.isArray(data.adhoc)) ? data.adhoc : [];
  const anyTop = top.some(t => (t && t.text || '').trim());
  const anyAdhoc = adhoc.some(t => (t && t.text || '').trim());
  if (anyTop || anyAdhoc) cache.weekly[weekKey] = { top, adhoc };
  else delete cache.weekly[weekKey];
  flush();
}

module.exports = { init, getDay, setDay, getAll, getPlan, setPlan, getCatMap, setCatMap, getSettings, setSetting, getTasks, setTasks, getMotivation, setReels, setNotes, getHabits, setHabits, getWeekly, setWeekly };
