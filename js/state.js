// state.js — プロジェクト状態モデルとスコア算出ロジック

const SCHEMA_VERSION = 1;

// 簡易ID（crypto.randomUUID が無い環境にもフォールバック）
export function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function todayLabel(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 新規プロジェクトの初期値
export function createProject() {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: genId(),
    projectName: `${todayLabel()} 試合動画`,
    videoFileName: '',
    videoDuration: 0,
    updatedAt: new Date().toISOString(),
    currentSet: 1,
    teams: {
      home: { name: '自チーム', color: '#1f6feb' },
      away: { name: '相手チーム', color: '#f85149' }
    },
    display: {
      position: 'top-left',
      x: 16,
      y: 16,
      fontSize: 28,
      scale: 1,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.55,
      showBackground: true,
      showServe: true
    },
    events: []
  };
}

// 読み込んだ任意オブジェクトを安全に正規化（欠損キーを補完）
export function normalizeProject(raw) {
  const base = createProject();
  if (!raw || typeof raw !== 'object') return base;
  const p = { ...base, ...raw };
  p.schemaVersion = SCHEMA_VERSION;
  p.id = raw.id || base.id;
  p.teams = {
    home: { ...base.teams.home, ...(raw.teams?.home || {}) },
    away: { ...base.teams.away, ...(raw.teams?.away || {}) }
  };
  p.display = { ...base.display, ...(raw.display || {}) };
  p.events = Array.isArray(raw.events) ? raw.events.map(normalizeEvent).filter(Boolean) : [];
  sortEvents(p);
  p.currentSet = Number(raw.currentSet) || maxSet(p);
  p.videoDuration = Number(raw.videoDuration) || 0;
  p.videoFileName = raw.videoFileName || '';
  p.projectName = raw.projectName || base.projectName;
  return p;
}

function normalizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  return {
    time: Number(e.time) || 0,
    set: Number(e.set) || 1,
    team: e.team === 'away' ? 'away' : 'home',
    homeScore: Number(e.homeScore) || 0,
    awayScore: Number(e.awayScore) || 0,
    server: e.server === 'away' ? 'away' : (e.server === 'home' ? 'home' : null)
  };
}

export function sortEvents(p) {
  p.events.sort((a, b) => a.time - b.time || a.set - b.set);
}

export function maxSet(p) {
  return p.events.reduce((m, e) => Math.max(m, e.set), 1);
}

// 指定セットの「最後に記録された」スコアスナップショット（イベント追加用）
export function lastScoreOfSet(p, set) {
  let last = { homeScore: 0, awayScore: 0, server: null };
  for (const e of p.events) {
    if (e.set === set) last = e;
  }
  return { homeScore: last.homeScore, awayScore: last.awayScore, server: last.server };
}

// プレビューの要：動画時刻 time に表示すべきスコアを算出する。
// 表示セット = その時刻までに記録されたイベントの最大セット（無ければ 1）。
// 表示スコア = その表示セット内で time 以下の最後のイベント（無ければ 0-0）。
export function computeScoreAtTime(p, time) {
  let displaySet = 1;
  for (const e of p.events) {
    if (e.time <= time + 1e-6) displaySet = Math.max(displaySet, e.set);
  }
  let snap = { homeScore: 0, awayScore: 0, server: null };
  let found = false;
  for (const e of p.events) {
    if (e.set === displaySet && e.time <= time + 1e-6) {
      snap = e;
      found = true;
    }
  }
  // サーブ権の初期表示：そのセットにまだ得点が無い場合は前セット終了時のサーバを引き継がない（null）
  return {
    set: displaySet,
    home: snap.homeScore,
    away: snap.awayScore,
    server: found ? snap.server : null
  };
}

// 編集中の現在スコア（currentSet の最終スコア）
export function currentScore(p) {
  const s = lastScoreOfSet(p, p.currentSet);
  return { set: p.currentSet, home: s.homeScore, away: s.awayScore, server: s.server };
}

export function touch(p) {
  p.updatedAt = new Date().toISOString();
}
