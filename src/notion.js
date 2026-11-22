// One-way sync of daily tasks to a Notion page (app -> Notion only).
// Best-effort: every call is wrapped so a failure never breaks local storage,
// which remains the source of truth. No-ops silently when not configured.
//
// Config lives OUTSIDE the repo at ~/.timegrid/config.json:
//   { "notionToken": "secret_xxx", "notionPageId": "42057bd3886b80209848c010fd675c23" }
// The page must be shared with the integration that owns the token.
// Tasks are written as to-do blocks nested under a per-date toggle heading.
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const DEFAULT_PAGE_ID = '42057bd3886b80209848c010fd675c23'; // from the user's linked page

let cfg;
function config() {
  if (cfg !== undefined) return cfg;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.timegrid', 'config.json'), 'utf8'));
    cfg = { token: raw.notionToken || null, pageId: raw.notionPageId || DEFAULT_PAGE_ID };
  } catch {
    cfg = { token: null, pageId: DEFAULT_PAGE_ID };
  }
  return cfg;
}

function enabled() {
  return !!(config().token && typeof fetch === 'function');
}

async function api(method, pathname, body) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      'Authorization': `Bearer ${config().token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${method} ${pathname} -> ${res.status}`);
  return res.json();
}

const richText = content => [{ type: 'text', text: { content: String(content).slice(0, 2000) } }];

// Create a toggleable date heading directly on the page; return its block id (or null).
async function createDateHeading(date) {
  if (!enabled()) return null;
  try {
    const out = await api('PATCH', `/blocks/${config().pageId}/children`, {
      children: [{ type: 'heading_2', heading_2: { rich_text: richText(date), is_toggleable: true } }],
    });
    return out.results && out.results[0] ? out.results[0].id : null;
  } catch (e) { console.error('[notion] createDateHeading', e.message); return null; }
}

// Append a to-do block under a heading; return its block id (or null).
async function addTodo(headingId, text) {
  if (!enabled() || !headingId) return null;
  try {
    const out = await api('PATCH', `/blocks/${headingId}/children`, {
      children: [{ type: 'to_do', to_do: { rich_text: richText(text), checked: false } }],
    });
    return out.results && out.results[0] ? out.results[0].id : null;
  } catch (e) { console.error('[notion] addTodo', e.message); return null; }
}

// Update a to-do block's checked state and text.
async function setTodo(blockId, { checked, text }) {
  if (!enabled() || !blockId) return false;
  try {
    await api('PATCH', `/blocks/${blockId}`, { to_do: { checked: !!checked, rich_text: richText(text) } });
    return true;
  } catch (e) { console.error('[notion] setTodo', e.message); return false; }
}

// Archive (delete) a block.
async function deleteBlock(blockId) {
  if (!enabled() || !blockId) return false;
  try {
    await api('DELETE', `/blocks/${blockId}`);
    return true;
  } catch (e) { console.error('[notion] deleteBlock', e.message); return false; }
}

module.exports = { enabled, createDateHeading, addTodo, setTodo, deleteBlock };
