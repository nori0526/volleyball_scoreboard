// app.js — エントリ：画面ルーティング、結線、自動保存
import {
  createProject, normalizeProject, computeBoardAtTime, currentScore,
  prevEventTime, nextEventTime, genId, maxSet, touch
} from './state.js';
import {
  addPoint, undoLast, nextSet, prevSet, toggleServe, deleteEvent,
  nudgeEventTime, flipEventTeam
} from './events.js';
import {
  saveProject, getAllProjects, getProject, deleteProject,
  downloadJson, readJsonFile, getLastProjectId, requestPersistence
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
    'set-padding', 'out-padding', 'set-show-setcount', 'set-pause-on-score',
    'btn-settings-to-edit',
    'video', 'video-wrap', 'scoreboard', 'video-placeholder', 'btn-pick-video', 'file-video',
    'video-loading', 'video-loading-text',
    'btn-play', 'seek', 'seek-markers', 'cur-time', 'cur-set', 'cur-score', 'btn-change-video',
    'btn-back10', 'btn-back1', 'btn-fwd1', 'btn-fwd10', 'play-rate', 'btn-prev-event', 'btn-next-event',
    'btn-home-plus', 'btn-away-plus', 'lbl-home', 'lbl-away',
    'btn-undo', 'btn-toggle-serve', 'btn-prev-set', 'btn-next-set',
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
      <button class="pc-dup" aria-label="複製">⧉</button>
      <button class="pc-del" aria-label="削除">🗑</button>`;
    card.querySelector('.pc-name').textContent = p.projectName;
    card.querySelector('.pc-main').addEventListener('click', () => openProject(p.id));
    card.querySelector('.pc-dup').addEventListener('click', async (e) => {
      e.stopPropagation();
      await duplicateProject(p);
    });
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

// 既存プロジェクトを複製（別IDで保存）
async function duplicateProject(src) {
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = genId();
  copy.projectName = (src.projectName || 'プロジェクト') + '（コピー）';
  copy.updatedAt = new Date().toISOString();
  await saveProject(copy);
  toast('複製しました');
  renderProjectList();
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
  els['set-padding'].value = d.padding;
  els['out-padding'].textContent = d.padding + 'px';
  els['set-show-serve'].checked = d.showServe;
  els['set-show-setcount'].checked = d.showSetCount;
  els['set-pause-on-score'].checked = project.pauseOnScore;
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
  els['set-home-color'].addEventListener('input', (e) => { project.teams.home.color = e.target.value; applyTeamButtonColors(); refreshPreviewOnly(); persist(); });
  els['set-away-color'].addEventListener('input', (e) => { project.teams.away.color = e.target.value; applyTeamButtonColors(); refreshPreviewOnly(); persist(); });
  els['set-text-color'].addEventListener('input', onDisplay('textColor'));
  els['set-bg-color'].addEventListener('input', onDisplay('backgroundColor'));
  els['set-show-bg'].addEventListener('change', onDisplay('showBackground'));
  els['set-bg-opacity'].addEventListener('input', onDisplay('backgroundOpacity', Number));
  els['set-font-size'].addEventListener('input', onDisplay('fontSize', Number));
  els['set-scale'].addEventListener('input', onDisplay('scale', Number));
  els['set-padding'].addEventListener('input', onDisplay('padding', Number));
  els['set-show-serve'].addEventListener('change', () => { project.display.showServe = els['set-show-serve'].checked; refreshPreviewOnly(); persist(); });
  els['set-show-setcount'].addEventListener('change', () => { project.display.showSetCount = els['set-show-setcount'].checked; refreshPreviewOnly(); persist(); });
  els['set-pause-on-score'].addEventListener('change', () => { project.pauseOnScore = els['set-pause-on-score'].checked; persist(); });
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
  els['out-padding'].textContent = project.display.padding + 'px';
}

// 設定変更時、編集画面のスコアボード見た目だけ即時反映（色/名前はsig外なので強制）
function refreshPreviewOnly() {
  if (currentScreen === 'edit' || !els.scoreboard.hidden) {
    renderAtTime(currentTimeOrZero(), true);
  }
}

// ===== 動画・編集画面 =====
// 読み込み計測：picker（iOSの書き出し）= click→change、metadata = change→loadedmetadata
let pickClickAt = 0;
let loadStartAt = 0;
let loadingTimer = null;

function showVideoLoading(label) {
  els['video-loading'].hidden = false;
  const t0 = performance.now();
  const upd = () => {
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    els['video-loading-text'].textContent = `${label}… ${sec}s`;
  };
  upd();
  clearInterval(loadingTimer);
  loadingTimer = setInterval(upd, 100);
}
function hideVideoLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
  els['video-loading'].hidden = true;
}

function attachVideo() {
  video = createVideoController(els.video, {
    onLoaded: ({ duration }) => {
      const metaMs = loadStartAt ? Math.round(performance.now() - loadStartAt) : 0;
      hideVideoLoading();
      // 長さの照合（保存値があり、0.5秒以上ずれていれば警告）
      if (expectedDuration && Math.abs(duration - expectedDuration) > 0.5) {
        toast(`動画の長さが前回と異なります（保存:${formatTime(expectedDuration)} / 今回:${formatTime(duration)}）`);
      }
      expectedDuration = 0; expectedName = '';
      project.videoDuration = Math.round(duration * 100) / 100;
      els.seek.max = duration || 0;
      els.seek.value = 0;
      persist();
      updateTimeLabel(0);
      renderSeekMarkers();
      console.log(`[video] メタデータ解析: ${metaMs}ms / 長さ ${Math.round(duration)}s`);
    },
    onTime: (t) => {
      if (!els.seek.matches(':active')) els.seek.value = t;
      updateTimeLabel(t);
      renderAtTime(t);
    },
    onError: () => {
      hideVideoLoading();
      toast('動画の読み込みに失敗しました（形式が非対応の可能性）');
    }
  });
}

function refreshEdit() {
  els['lbl-home'].textContent = project.teams.home.name;
  els['lbl-away'].textContent = project.teams.away.name;
  applyTeamButtonColors();
  const hasV = video && video.hasVideo();
  els['video-placeholder'].hidden = hasV;
  els.scoreboard.hidden = false;
  renderAtTime(currentTimeOrZero(), true); // 画面復帰時は名前/色も反映するため強制
  updateTimeLabel(currentTimeOrZero());
  els.seek.max = hasV ? video.duration() : (project.videoDuration || 0);
  renderSeekMarkers();
}

// シークバー上に得点位置のマーカーを描画（タップでその時刻へジャンプ）
function renderSeekMarkers() {
  const layer = els['seek-markers'];
  const dur = (video && video.hasVideo()) ? video.duration() : (project ? project.videoDuration : 0);
  layer.innerHTML = '';
  if (!project || !dur || !isFinite(dur)) return;
  for (const e of project.events) {
    const pct = Math.max(0, Math.min(100, (e.time / dur) * 100));
    const m = document.createElement('button');
    m.className = 'seek-marker ' + (e.team === 'home' ? 'home' : 'away');
    m.style.left = pct + '%';
    m.title = `${e.set}セット ${e.homeScore}-${e.awayScore}`;
    m.addEventListener('click', () => {
      if (video.hasVideo()) video.seek(e.time);
      renderAtTime(e.time, true);
    });
    layer.appendChild(m);
  }
}

// 編集（追加/取消/セット/削除/時刻・チーム変更）後の共通更新
function afterEdit() {
  renderAtTime(currentTimeOrZero(), true);
  renderSeekMarkers();
  persist(true);
}

// 再生中は毎フレーム呼ばれるため、表示が変化したときだけDOMを再構築する。
let lastRenderSig = null;
function renderAtTime(t, force = false) {
  if (!project) return;
  const board = computeBoardAtTime(project, t);
  const sig = board.sets.map((s) => `${s.set}:${s.home}-${s.away}`).join('|') + '|sv:' + board.server;
  if (!force && sig === lastRenderSig) return; // 変化なし → 再描画スキップ
  lastRenderSig = sig;
  renderScoreboard(els.scoreboard, project, board);
  updateStatusChips();
}

// 加点ボタンの色を、設定のチームカラーに合わせる
function applyTeamButtonColors() {
  if (!project) return;
  const h = project.teams.home.color, a = project.teams.away.color;
  els['btn-home-plus'].style.background = h;
  els['btn-home-plus'].style.borderColor = h;
  els['btn-away-plus'].style.background = a;
  els['btn-away-plus'].style.borderColor = a;
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

// 照合用：再選択前に保存されていた動画情報
let expectedName = '';
let expectedDuration = 0;

function pickVideo(file) {
  expectedName = project.videoFileName || '';
  expectedDuration = project.videoDuration || 0;
  loadStartAt = performance.now();
  showVideoLoading('読み込み中');
  const { name } = video.loadFile(file);
  if (expectedName && name !== expectedName) {
    toast(`前回と違うファイル名です（保存:「${expectedName}」）`);
  }
  project.videoFileName = name;
  els['video-placeholder'].hidden = true;
  els.scoreboard.hidden = false;
  persist();
}

function openVideoPicker() {
  pickClickAt = performance.now();
  els['file-video'].click();
}

function wireEdit() {
  els['btn-pick-video'].addEventListener('click', openVideoPicker);
  els['btn-change-video'].addEventListener('click', openVideoPicker);
  els['file-video'].addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) {
      const pickerMs = pickClickAt ? Math.round(performance.now() - pickClickAt) : 0;
      console.log(`[video] 選択→受領: ${pickerMs}ms（iOSの書き出し/iCloudダウンロード時間）`);
      pickVideo(f);
    }
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

  // 精密シーク
  const seekByGuarded = (delta) => {
    if (!video.hasVideo()) { toast('先に動画を選択してください'); return; }
    video.seekBy(delta);
  };
  els['btn-back10'].addEventListener('click', () => seekByGuarded(-10));
  els['btn-back1'].addEventListener('click', () => seekByGuarded(-1));
  els['btn-fwd1'].addEventListener('click', () => seekByGuarded(1));
  els['btn-fwd10'].addEventListener('click', () => seekByGuarded(10));
  els['play-rate'].addEventListener('change', (e) => video.setRate(Number(e.target.value)));

  // 前の得点 / 次の得点へ移動（要件4.8）
  els['btn-prev-event'].addEventListener('click', () => {
    const t = prevEventTime(project, currentTimeOrZero());
    if (t === null) { toast('前の得点はありません'); return; }
    if (video.hasVideo()) video.seek(t);
    renderAtTime(t, true);
  });
  els['btn-next-event'].addEventListener('click', () => {
    const t = nextEventTime(project, currentTimeOrZero());
    if (t === null) { toast('次の得点はありません'); return; }
    if (video.hasVideo()) video.seek(t);
    renderAtTime(t, true);
  });

  els['btn-home-plus'].addEventListener('click', () => doAddPoint('home'));
  els['btn-away-plus'].addEventListener('click', () => doAddPoint('away'));
  els['btn-undo'].addEventListener('click', () => {
    const removed = undoLast(project);
    if (!removed) { toast('取り消す得点がありません'); return; }
    afterEdit();
    toast('取り消しました');
  });
  els['btn-next-set'].addEventListener('click', () => {
    const s = nextSet(project);
    renderAtTime(currentTimeOrZero(), true);
    persist(true);
    toast(`${s}セット目を開始`);
  });
  els['btn-prev-set'].addEventListener('click', () => {
    if (project.currentSet <= 1) { toast('これ以上戻れません'); return; }
    const s = prevSet(project);
    renderAtTime(currentTimeOrZero(), true);
    persist(true);
    toast(`${s}セット目へ戻りました`);
  });
  els['btn-toggle-serve'].addEventListener('click', () => {
    toggleServe(project);
    renderAtTime(currentTimeOrZero(), true);
    persist(true);
  });

  // 任意位置ドラッグ（プロジェクトは getter で常に最新を参照）
  enableDrag(els.scoreboard, els['video-wrap'], () => project, () => persist());
}

function doAddPoint(team) {
  const t = currentTimeOrZero();
  addPoint(project, team, t);
  if (project.pauseOnScore && video && video.hasVideo() && !video.isPaused()) video.pause();
  afterEdit();
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
      <td class="col-time">${formatTime(e.time)}.${Math.floor((e.time % 1) * 10)}</td>
      <td>${e.set}</td>
      <td class="col-score">${e.homeScore} - ${e.awayScore}</td>
      <td class="${teamCls}"></td>
      <td class="col-actions">
        <button class="ev-btn ev-tminus" aria-label="0.5秒前へ">−.5</button>
        <button class="ev-btn ev-tplus" aria-label="0.5秒後へ">+.5</button>
        <button class="ev-btn ev-flip" aria-label="加点チーム入替">⇄</button>
        <button class="ev-btn ev-del" aria-label="削除">✕</button>
      </td>`;
    tr.querySelector('.col-time').addEventListener('click', () => {
      showScreen('edit');
      if (video.hasVideo()) video.seek(e.time);
      renderAtTime(e.time, true);
    });
    tr.querySelector('td.' + teamCls).textContent = teamName;
    const maxT = (video && video.hasVideo()) ? video.duration() : (project.videoDuration || 0);
    const afterListEdit = () => { renderEventsList(); renderSeekMarkers(); renderAtTime(currentTimeOrZero(), true); persist(true); };
    tr.querySelector('.ev-tminus').addEventListener('click', () => { nudgeEventTime(project, i, -0.5, maxT); afterListEdit(); });
    tr.querySelector('.ev-tplus').addEventListener('click', () => { nudgeEventTime(project, i, 0.5, maxT); afterListEdit(); });
    tr.querySelector('.ev-flip').addEventListener('click', () => { flipEventTeam(project, i); afterListEdit(); });
    tr.querySelector('.ev-del').addEventListener('click', () => { deleteEvent(project, i); afterListEdit(); });
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

async function restoreLastOrList() {
  const lastId = getLastProjectId();
  if (lastId) {
    const raw = await getProject(lastId);
    if (raw) { await openProject(lastId); return; }
  }
  showScreen('projects');
}

function init() {
  cacheEls();
  wireGlobal();
  wireSettings();
  wireEdit();
  wireExport();
  registerSW();
  requestPersistence(); // iOSのデータ自動削除を抑止（失敗は無視）
  restoreLastOrList();  // 前回のプロジェクトがあれば自動で開く
}

document.addEventListener('DOMContentLoaded', init);
