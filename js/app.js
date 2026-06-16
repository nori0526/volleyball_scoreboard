// app.js — エントリ：画面ルーティング、結線、自動保存
import {
  createProject, normalizeProject, computeScoreAtTime, currentScore,
  maxSet, touch
} from './state.js';
import { addPoint, undoLast, nextSet, toggleServe, deleteEvent } from './events.js';
import {
  saveProject, getAllProjects, getProject, deleteProject,
  downloadJson, readJsonFile, getLastProjectId
} from './storage.js';
import { createVideoController, formatTime } from './video.js';
import { renderScoreboard, applyStyle, applyPosition, enableDrag } from './scoreboard.js';
import { buildExportData, buildFfmpegHintLines, cleanProject, baseName } from './export.js';

const $ = (id) => document.getElementById(id);

// ===== アプリ状態 =====
let project = null;
let video = null;          // video controller
let saveTimer = null;
let currentScreen = 'projects';

const els = {};
function cacheEls() {
  [
    'btn-back', 'header-title', 'save-indicator',
    'btn-new-project', 'btn-import-json', 'file-import', 'project-list',
    'set-project-name', 'set-home-name', 'set-home-color', 'set-away-name', 'set-away-color',
    'set-text-color', 'set-bg-color', 'set-show-bg', 'set-bg-opacity', 'out-bg-opacity',
    'set-position', 'set-font-size', 'out-font-size', 'set-scale', 'out-scale', 'set-show-serve',
    'btn-settings-to-edit',
    'video', 'video-wrap', 'scoreboard', 'video-placeholder', 'btn-pick-video', 'file-video',
    'btn-play', 'seek', 'cur-time', 'cur-set', 'cur-score', 'btn-change-video',
    'btn-home-plus', 'btn-away-plus', 'lbl-home', 'lbl-away',
    'btn-undo', 'btn-toggle-serve', 'btn-next-set',
    'btn-export-json', 'btn-export-ffmpeg', 'events-body', 'events-empty',
    'bottom-nav', 'toast'
  ].forEach((id) => { els[id] = $(id); });
}

// ===== ユーティリティ =====
let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
}

function persist(immediate = false) {
  if (!project) return;
  touch(project);
  showSaving();
  clearTimeout(saveTimer);
  const doSave = () =>
    saveProject(project).then(showSaved).catch(() => toast('保存に失敗しました'));
  if (immediate) doSave();
  else saveTimer = setTimeout(doSave, 400);
}
function showSaving() { els['save-indicator'].textContent = '保存中…'; }
function showSaved() { els['save-indicator'].textContent = '保存済み'; }

function currentTimeOrZero() {
  return video && video.hasVideo() ? video.currentTime() : 0;
}

// ===== 画面ルーティング =====
const TITLES = {
  projects: 'プロジェクト', settings: '設定', edit: '編集', events: 'イベント一覧'
};
function showScreen(name) {
  currentScreen = name;
  ['projects', 'settings', 'edit', 'events'].forEach((s) => {
    $('screen-' + s).hidden = (s !== name);
  });
  els['header-title'].textContent = project ? project.projectName : TITLES[name];
  els['btn-back'].hidden = (name === 'projects');
  els['bottom-nav'].hidden = !project;
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.screen === name));

  if (name === 'projects') renderProjectList();
  if (name === 'settings') fillSettingsForm();
  if (name === 'edit') refreshEdit();
  if (name === 'events') renderEventsList();
}

// ===== プロジェクト一覧 =====
async function renderProjectList() {
  const list = await getAllProjects();
  const wrap = els['project-list'];
  if (!list.length) {
    wrap.innerHTML = '<p class="empty-hint">まだプロジェクトがありません。</p>';
    return;
  }
  wrap.innerHTML = '';
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleString('ja-JP') : '';
    const evCount = (p.events || []).length;
    card.innerHTML = `
      <div class="pc-main">
        <div class="pc-name"></div>
        <div class="pc-meta">${escapeHtml(p.videoFileName || '動画未選択')} ・ ${evCount}得点 ・ ${updated}</div>
      </div>
      <button class="pc-del" aria-label="削除">🗑</button>`;
    card.querySelector('.pc-name').textContent = p.projectName;
    card.querySelector('.pc-main').addEventListener('click', () => openProject(p.id));
    card.querySelector('.pc-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`「${p.projectName}」を削除しますか？`)) {
        await deleteProject(p.id);
        renderProjectList();
      }
    });
    wrap.appendChild(card);
  }
}

async function newProject() {
  project = createProject();
  await saveProject(project);
  showSaved();
  if (video) video.destroy();
  attachVideo();
  showScreen('settings');
}

async function openProject(id) {
  const raw = await getProject(id);
  if (!raw) { toast('プロジェクトが見つかりません'); return; }
  project = normalizeProject(raw);
  if (video) video.destroy();
  attachVideo();
  showScreen('edit');
  if (project.videoFileName) {
    toast(`「${project.videoFileName}」を選び直してください`);
  }
}

// ===== 設定画面 =====
function fillSettingsForm() {
  if (!project) return;
  const d = project.display;
  els['set-project-name'].value = project.projectName;
  els['set-home-name'].value = project.teams.home.name;
  els['set-home-color'].value = project.teams.home.color;
  els['set-away-name'].value = project.teams.away.name;
  els['set-away-color'].value = project.teams.away.color;
  els['set-text-color'].value = d.textColor;
  els['set-bg-color'].value = d.backgroundColor;
  els['set-show-bg'].checked = d.showBackground;
  els['set-bg-opacity'].value = d.backgroundOpacity;
  els['out-bg-opacity'].textContent = d.backgroundOpacity;
  els['set-position'].value = d.position;
  els['set-font-size'].value = d.fontSize;
  els['out-font-size'].textContent = d.fontSize + 'px';
  els['set-scale'].value = d.scale;
  els['out-scale'].textContent = '×' + d.scale;
  els['set-show-serve'].checked = d.showServe;
}

function wireSettings() {
  const onText = (key, sub) => (e) => {
    if (sub) project.teams[sub][key] = e.target.value;
    else project[key] = e.target.value;
    if (key === 'projectName') els['header-title'].textContent = e.target.value;
    persist();
  };
  els['set-project-name'].addEventListener('input', onText('projectName'));
  els['set-home-name'].addEventListener('input', onText('name', 'home'));
  els['set-away-name'].addEventListener('input', onText('name', 'away'));

  const onDisplay = (key, transform) => (e) => {
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (transform) v = transform(v);
    project.display[key] = v;
    syncOutputs();
    applyStyle(els.scoreboard, project);
    persist();
  };
  els['set-home-color'].addEventListener('input', (e) => { project.teams.home.color = e.target.value; refreshPreviewOnly(); persist(); });
  els['set-away-color'].addEventListener('input', (e) => { project.teams.away.color = e.target.value; refreshPreviewOnly(); persist(); });
  els['set-text-color'].addEventListener('input', onDisplay('textColor'));
  els['set-bg-color'].addEventListener('input', onDisplay('backgroundColor'));
  els['set-show-bg'].addEventListener('change', onDisplay('showBackground'));
  els['set-bg-opacity'].addEventListener('input', onDisplay('backgroundOpacity', Number));
  els['set-font-size'].addEventListener('input', onDisplay('fontSize', Number));
  els['set-scale'].addEventListener('input', onDisplay('scale', Number));
  els['set-show-serve'].addEventListener('change', () => { project.display.showServe = els['set-show-serve'].checked; refreshPreviewOnly(); persist(); });
  els['set-position'].addEventListener('change', (e) => {
    project.display.position = e.target.value;
    applyPosition(els.scoreboard, project);
    persist();
  });
  els['btn-settings-to-edit'].addEventListener('click', () => showScreen('edit'));
}

function syncOutputs() {
  els['out-bg-opacity'].textContent = project.display.backgroundOpacity;
  els['out-font-size'].textContent = project.display.fontSize + 'px';
  els['out-scale'].textContent = '×' + project.display.scale;
}

// 設定変更時、編集画面のスコアボード見た目だけ即時反映
function refreshPreviewOnly() {
  if (currentScreen === 'edit' || !els.scoreboard.hidden) {
    renderAtTime(currentTimeOrZero());
  }
}

// ===== 動画・編集画面 =====
function attachVideo() {
  video = createVideoController(els.video, {
    onLoaded: ({ duration }) => {
      project.videoDuration = Math.round(duration * 100) / 100;
      els.seek.max = duration || 0;
      els.seek.value = 0;
      persist();
      updateTimeLabel(0);
    },
    onTime: (t) => {
      if (!els.seek.matches(':active')) els.seek.value = t;
      updateTimeLabel(t);
      renderAtTime(t);
    }
  });
}

function refreshEdit() {
  els['lbl-home'].textContent = project.teams.home.name;
  els['lbl-away'].textContent = project.teams.away.name;
  const hasV = video && video.hasVideo();
  els['video-placeholder'].hidden = hasV;
  els.scoreboard.hidden = false;
  renderAtTime(currentTimeOrZero());
  updateTimeLabel(currentTimeOrZero());
  els.seek.max = hasV ? video.duration() : (project.videoDuration || 0);
}

function renderAtTime(t) {
  if (!project) return;
  const sc = computeScoreAtTime(project, t);
  renderScoreboard(els.scoreboard, project, sc);
  updateStatusChips();
}

function updateStatusChips() {
  const cur = currentScore(project);
  els['cur-set'].textContent = `${cur.set}セット目`;
  els['cur-score'].textContent = `${cur.home} - ${cur.away}`;
}

function updateTimeLabel(t) {
  const dur = (video && video.hasVideo()) ? video.duration() : (project ? project.videoDuration : 0);
  els['cur-time'].textContent = `${formatTime(t)} / ${formatTime(dur)}`;
}

function pickVideo(file) {
  const { name } = video.loadFile(file);
  project.videoFileName = name;
  els['video-placeholder'].hidden = true;
  els.scoreboard.hidden = false;
  persist();
}

function wireEdit() {
  els['btn-pick-video'].addEventListener('click', () => els['file-video'].click());
  els['btn-change-video'].addEventListener('click', () => els['file-video'].click());
  els['file-video'].addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) pickVideo(f);
    e.target.value = '';
  });

  els['btn-play'].addEventListener('click', () => {
    if (!video.hasVideo()) { toast('先に動画を選択してください'); return; }
    video.toggle();
  });
  els.video.addEventListener('play', () => { els['btn-play'].textContent = '⏸'; });
  els.video.addEventListener('pause', () => { els['btn-play'].textContent = '▶︎'; });

  els.seek.addEventListener('input', (e) => {
    const t = Number(e.target.value);
    updateTimeLabel(t);
    renderAtTime(t);
  });
  els.seek.addEventListener('change', (e) => {
    if (video.hasVideo()) video.seek(Number(e.target.value));
  });

  els['btn-home-plus'].addEventListener('click', () => doAddPoint('home'));
  els['btn-away-plus'].addEventListener('click', () => doAddPoint('away'));
  els['btn-undo'].addEventListener('click', () => {
    const removed = undoLast(project);
    if (!removed) { toast('取り消す得点がありません'); return; }
    renderAtTime(currentTimeOrZero());
    persist(true);
    toast('取り消しました');
  });
  els['btn-next-set'].addEventListener('click', () => {
    const s = nextSet(project);
    renderAtTime(currentTimeOrZero());
    persist(true);
    toast(`${s}セット目を開始`);
  });
  els['btn-toggle-serve'].addEventListener('click', () => {
    toggleServe(project);
    renderAtTime(currentTimeOrZero());
    persist(true);
  });

  // 任意位置ドラッグ（プロジェクトは getter で常に最新を参照）
  enableDrag(els.scoreboard, els['video-wrap'], () => project, () => persist());
}

function doAddPoint(team) {
  const t = currentTimeOrZero();
  const ev = addPoint(project, team, t);
  renderAtTime(t);
  persist(true);
  const teamName = team === 'home' ? project.teams.home.name : project.teams.away.name;
  toast(`${teamName} +1（${formatTime(t)}）`);
}

// ===== イベント一覧 =====
function renderEventsList() {
  const body = els['events-body'];
  body.innerHTML = '';
  const evs = project.events;
  els['events-empty'].hidden = evs.length > 0;
  evs.forEach((e, i) => {
    const tr = document.createElement('tr');
    const teamCls = e.team === 'home' ? 'ev-team-home' : 'ev-team-away';
    const teamName = e.team === 'home' ? project.teams.home.name : project.teams.away.name;
    tr.innerHTML = `
      <td class="col-time">${formatTime(e.time)}</td>
      <td>${e.set}</td>
      <td class="col-score">${e.homeScore} - ${e.awayScore}</td>
      <td class="${teamCls}"></td>
      <td><button class="ev-del" aria-label="削除">✕</button></td>`;
    tr.querySelector('.col-time').addEventListener('click', () => {
      showScreen('edit');
      if (video.hasVideo()) video.seek(e.time);
      renderAtTime(e.time);
    });
    tr.querySelector('td.' + teamCls).textContent = teamName;
    tr.querySelector('.ev-del').addEventListener('click', () => {
      deleteEvent(project, i);
      renderEventsList();
      persist(true);
    });
    body.appendChild(tr);
  });
}

// ===== 書き出し =====
function wireExport() {
  els['btn-export-json'].addEventListener('click', () => {
    downloadJson(`${baseName(project)}.json`, cleanProject(project));
    toast('JSON を書き出しました');
  });
  els['btn-export-ffmpeg'].addEventListener('click', () => {
    const data = buildExportData(project);
    downloadJson(`${baseName(project)}.export.json`, data);
    toast('書き出し情報を出力しました');
  });
}

// ===== トップレベル結線 =====
function wireGlobal() {
  els['btn-new-project'].addEventListener('click', newProject);
  els['btn-import-json'].addEventListener('click', () => els['file-import'].click());
  els['file-import'].addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const raw = await readJsonFile(f);
      const data = raw && raw.project ? raw.project : raw; // export形式 or 素のプロジェクト
      project = normalizeProject(data);
      await saveProject(project);
      if (video) video.destroy();
      attachVideo();
      showScreen('edit');
      toast(project.videoFileName ? `「${project.videoFileName}」を選び直してください` : '読み込みました');
    } catch (err) {
      toast(err.message || '読み込みに失敗しました');
    }
  });

  els['btn-back'].addEventListener('click', () => showScreen('projects'));
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (!project) return;
      showScreen(b.dataset.screen);
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 起動 =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

function init() {
  cacheEls();
  wireGlobal();
  wireSettings();
  wireEdit();
  wireExport();
  registerSW();
  showScreen('projects');
}

document.addEventListener('DOMContentLoaded', init);
