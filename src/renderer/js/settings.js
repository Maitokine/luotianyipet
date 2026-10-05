// 设置窗口逻辑（M5 / T5.4，PRD §3.3）：四页签 + 与主窗实时同步
// 写入一律走 api.setState（主进程落档 + 广播 state:changed → 各窗刷新）或 sendAction（主进程/桌宠窗执行）
import { OUTFIT_ITEMS } from '../../shared/menumodel.js';
import { RIG_PALETTES } from './palettes.js';
import { UNLOCKS } from './growth.js';
import { affectionTier, expThreshold } from '../../shared/profile.js';
import { createNote } from './reminders.js';

const api = window.petApi;
const $ = (id) => document.getElementById(id);

const SITTING_OPTIONS = [30, 45, 60, 90];
const WATER_OPTIONS = [60, 90, 120];
const FOCUS_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60];
const REST_OPTIONS = [1, 3, 5, 10, 15, 20, 30];

let state = null;
let info = null;
let uiState = { mood: '', sessionSecs: 0, pomoPhase: 'idle' };
let danceAvailable = true;
let editingNoteId = null;

const setSetting = (patch) => api.setState({ settings: patch });
const sendAction = (action, payload) => api.sendAction(action, payload);

function fillSelect(sel, options, current) {
  const opts = [...options];
  if (!opts.includes(current)) { opts.push(current); opts.sort((a, b) => a - b); }
  sel.innerHTML = '';
  for (const v of opts) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = String(v);
    if (v === current) o.selected = true;
    sel.appendChild(o);
  }
}

function fmtDur(sec) {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
}

// ---------- 成长页 ----------
function renderGrowth() {
  $('g-level').textContent = `Lv.${state.level}`;
  const outfit = OUTFIT_ITEMS.find((o) => o.id === state.outfit);
  $('g-outfit').textContent = outfit ? outfit.label : (state.outfit || '—');
  $('g-today').textContent = `${(state.todayMinutes && state.todayMinutes.count) || 0} 分钟`;

  const cur = expThreshold(state.level);
  const next = expThreshold(state.level + 1);
  const pct = next > cur ? Math.min(100, Math.max(0, ((state.exp - cur) / (next - cur)) * 100)) : 100;
  $('g-exp-bar').style.width = `${pct.toFixed(1)}%`;
  $('g-exp-text').textContent = `${state.exp} / ${next}`;

  const tier = affectionTier(state.affection);
  const filled = Math.min(5, Math.ceil(state.affection / 20));
  $('g-hearts').textContent = '♥'.repeat(filled) + '♡'.repeat(5 - filled);
  $('g-aff-text').textContent = `${state.affection} · ${tier.label}`;

  $('g-days').textContent = String(Math.floor((Date.now() - (state.createdAt || Date.now())) / 86400000) + 1);
  $('g-clicks').textContent = String(state.totalClicks);
  $('g-songs').textContent = String(state.songsCompleted);

  const ul = $('g-unlocks');
  ul.innerHTML = '';
  for (const u of UNLOCKS) {
    const li = document.createElement('li');
    const got = state.unlocked.includes(u.id);
    if (!got) li.classList.add('locked');
    const lv = document.createElement('span');
    lv.className = 'lv-tag';
    lv.textContent = `Lv.${u.level}`;
    const name = document.createElement('span');
    name.textContent = u.label;
    const mark = document.createElement('span');
    mark.className = 'u-mark';
    mark.textContent = got ? '✓ 已解锁' : `Lv.${u.level} 解锁`;
    li.appendChild(lv);
    li.appendChild(name);
    li.appendChild(mark);
    ul.appendChild(li);
  }
}

function renderUiState() {
  if (uiState.mood) $('g-mood').textContent = uiState.mood;
  $('g-session').textContent = fmtDur(uiState.sessionSecs || 0);
  const phase = uiState.pomoPhase || 'idle';
  $('r-pomo-status').textContent = phase === 'focus' ? '· 专注中…' : (phase === 'rest' ? '· 休息中…' : '');
  $('r-pomo-toggle').textContent = phase === 'idle' ? '开始番茄钟' : '停止番茄钟';
}

// ---------- 换装页 ----------
function renderOutfit() {
  const grid = $('outfit-grid');
  grid.innerHTML = '';
  for (const o of OUTFIT_ITEMS) {
    const unlocked = state.unlocked.includes(o.unlockId);
    const current = state.outfit === o.id;
    const card = document.createElement('div');
    card.className = 'outfit-card'
      + (current ? ' current' : '')
      + (unlocked ? '' : ' locked');
    card.dataset.id = o.id;

    const sw = document.createElement('div');
    sw.className = 'outfit-swatch';
    const pal = RIG_PALETTES[o.id] || RIG_PALETTES.default;
    sw.style.setProperty('--sw-dress', pal.vars['--dress']);
    sw.style.setProperty('--sw-hair', pal.vars['--hair']);

    const name = document.createElement('div');
    name.className = 'outfit-name';
    name.textContent = o.label;

    const st = document.createElement('div');
    st.className = 'outfit-state';
    st.textContent = current ? '穿着中' : (unlocked ? '点击换上' : `Lv.${o.level} 解锁`);

    card.appendChild(sw);
    card.appendChild(name);
    card.appendChild(st);
    if (unlocked && !current) {
      card.addEventListener('click', () => sendAction('pet.outfit', { id: o.id }));
    }
    grid.appendChild(card);
  }
}

// ---------- 提醒页 ----------
function renderReminders() {
  const s = state.settings;
  $('r-sitting-enabled').checked = Boolean(s.sitting.enabled);
  $('r-water-enabled').checked = Boolean(s.water.enabled);
  fillSelect($('r-sitting-min'), SITTING_OPTIONS, s.sitting.minutes);
  fillSelect($('r-water-min'), WATER_OPTIONS, s.water.minutes);
  fillSelect($('r-pomo-focus'), FOCUS_OPTIONS, s.pomodoro.focus);
  fillSelect($('r-pomo-rest'), REST_OPTIONS, s.pomodoro.rest);
  renderNotes();
}

function renderNotes() {
  const ul = $('r-note-list');
  ul.innerHTML = '';
  for (const n of state.notes || []) {
    const li = document.createElement('li');
    li.dataset.id = n.id;

    const time = document.createElement('span');
    time.className = 'note-time-tag';
    time.textContent = n.time || '--:--';

    const text = document.createElement('span');
    text.className = 'note-text';
    text.textContent = n.text;

    li.appendChild(time);
    if (n.repeatDaily) {
      const rep = document.createElement('span');
      rep.className = 'note-repeat-tag';
      rep.textContent = '每天';
      li.appendChild(rep);
    }
    li.appendChild(text);

    const btns = document.createElement('span');
    btns.className = 'note-btns';
    const editBtn = document.createElement('button');
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => startEditNote(n.id));
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => deleteNote(n.id));
    btns.appendChild(editBtn);
    btns.appendChild(delBtn);
    li.appendChild(btns);

    ul.appendChild(li);
  }
}

function showNoteError(msg) {
  const el = $('r-note-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearNoteError() {
  $('r-note-error').classList.add('hidden');
}

function resetNoteForm() {
  editingNoteId = null;
  $('r-note-text').value = '';
  $('r-note-time').value = '09:00';
  $('r-note-repeat').checked = false;
  $('r-note-add').textContent = '添加';
  clearNoteError();
}

function startEditNote(id) {
  const n = (state.notes || []).find((x) => x.id === id);
  if (!n) return;
  editingNoteId = id;
  $('r-note-text').value = n.text;
  $('r-note-time').value = n.time;
  $('r-note-repeat').checked = Boolean(n.repeatDaily);
  $('r-note-add').textContent = '保存修改';
  clearNoteError();
  $('r-note-text').focus();
}

function submitNote() {
  const text = $('r-note-text').value;
  const time = $('r-note-time').value;
  const repeatDaily = $('r-note-repeat').checked;
  const r = createNote({ text, time, repeatDaily, nowMs: Date.now() });
  if (!r.ok) {
    showNoteError(r.error);
    return;
  }
  if (editingNoteId) {
    // 编辑：保留原 id；时间没变则保留原触发记录，时间变了按新时间重新戳记
    const orig = (state.notes || []).find((x) => x.id === editingNoteId);
    let note = r.note;
    if (orig) {
      note.id = orig.id;
      if (time === orig.time) note.lastFire = orig.lastFire;
    }
    api.setState({ notes: (state.notes || []).map((x) => (x.id === editingNoteId ? note : x)) });
  } else {
    api.setState({ notes: [...(state.notes || []), r.note] });
  }
  resetNoteForm();
}

function deleteNote(id) {
  api.setState({ notes: (state.notes || []).filter((x) => x.id !== id) });
  if (editingNoteId === id) resetNoteForm();
}

// ---------- 通用页 ----------
function renderGeneral() {
  const s = state.settings;
  $('s-autostart').checked = Boolean(s.autoStart);
  $('s-ontop').checked = Boolean(s.alwaysOnTop);
  $('s-clickthrough').checked = Boolean(s.clickThrough);
  $('s-idlesing').checked = Boolean(s.idleRealSing);
  $('s-dance').checked = Boolean(s.danceWithMusic);
  $('s-dance').disabled = !danceAvailable;
  $('s-dance-badge').classList.toggle('hidden', danceAvailable);

  const opacity = Math.round(s.opacity * 100);
  $('s-opacity').value = String(opacity);
  $('s-opacity-val').textContent = `${opacity}%`;

  for (const btn of document.querySelectorAll('#s-size-row .size-btn')) {
    btn.classList.toggle('active', Math.abs(Number(btn.dataset.scale) - s.scale) < 0.001);
  }
  $('s-scale-val').textContent = `${Math.round(s.scale * 100)}%`;

  $('s-datadir').textContent = (info && info.dataDir) || '—';
  $('s-version').textContent = (info && info.version) || '';
}

function renderAll() {
  renderGrowth();
  renderOutfit();
  renderReminders();
  renderGeneral();
  renderUiState();
}

// ---------- 事件绑定 ----------
function bindTabs() {
  for (const btn of document.querySelectorAll('#tabs .tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
}

function switchTab(tab) {
  const valid = ['growth', 'outfit', 'reminders', 'general'];
  const target = valid.includes(tab) ? tab : 'general';
  for (const btn of document.querySelectorAll('#tabs .tab')) {
    btn.classList.toggle('active', btn.dataset.tab === target);
  }
  for (const page of document.querySelectorAll('.page')) {
    page.classList.toggle('active', page.id === `page-${target}`);
  }
}

function bindControls() {
  // 通用
  $('s-autostart').addEventListener('change', (e) => sendAction('app.autostart', { enabled: e.target.checked }));
  $('s-ontop').addEventListener('change', (e) => setSetting({ alwaysOnTop: e.target.checked }));
  $('s-clickthrough').addEventListener('change', (e) => setSetting({ clickThrough: e.target.checked }));
  $('s-idlesing').addEventListener('change', (e) => setSetting({ idleRealSing: e.target.checked }));
  $('s-dance').addEventListener('change', (e) => setSetting({ danceWithMusic: e.target.checked }));
  for (const btn of document.querySelectorAll('#s-size-row .size-btn')) {
    btn.addEventListener('click', () => setSetting({ scale: Number(btn.dataset.scale) }));
  }
  $('s-opacity').addEventListener('input', (e) => { $('s-opacity-val').textContent = `${e.target.value}%`; });
  $('s-opacity').addEventListener('change', (e) => setSetting({ opacity: Number(e.target.value) / 100 }));

  // 提醒
  $('r-sitting-enabled').addEventListener('change', (e) => setSetting({ sitting: { enabled: e.target.checked } }));
  $('r-sitting-min').addEventListener('change', (e) => setSetting({ sitting: { minutes: Number(e.target.value) } }));
  $('r-water-enabled').addEventListener('change', (e) => setSetting({ water: { enabled: e.target.checked } }));
  $('r-water-min').addEventListener('change', (e) => setSetting({ water: { minutes: Number(e.target.value) } }));
  $('r-pomo-focus').addEventListener('change', (e) => setSetting({ pomodoro: { focus: Number(e.target.value) } }));
  $('r-pomo-rest').addEventListener('change', (e) => setSetting({ pomodoro: { rest: Number(e.target.value) } }));
  $('r-pomo-toggle').addEventListener('click', () => sendAction('tools.pomodoro'));
  $('r-note-add').addEventListener('click', submitNote);
  $('r-note-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNote(); });
}

// ---------- 入口 ----------
async function main() {
  state = await api.getState();
  info = await api.getAppInfo();
  danceAvailable = !info || info.danceAvailable !== false;

  bindTabs();
  bindControls();
  renderAll();

  // 实时同步：主窗/托盘改动 → 本窗刷新；本窗写入 → 广播回来刷新
  api.onStateChanged((s) => {
    state = s;
    renderAll();
  });
  api.onUiState((u) => {
    if (u && typeof u === 'object') {
      uiState = {
        mood: u.mood || uiState.mood,
        sessionSecs: Number(u.sessionSecs) || 0,
        pomoPhase: u.pomoPhase || 'idle',
      };
      renderUiState();
    }
  });
  api.onMediaStatus((s) => {
    const avail = !!(s && s.available !== false);
    if (avail !== danceAvailable) {
      danceAvailable = avail;
      renderGeneral();
    }
  });
  api.onSettingsTab((tab) => switchTab(tab));

  api.smokeReady('settings');
}

main().catch((e) => {
  console.error('[settings] fatal:', e);
});
