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
      showServe: true,
      showSetCount: false,
      padding: 5
    },
    pauseOnScore: false,
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

// 指定セットの time 時点のスコア（time以下の最後のイベント、無ければ 0-0）
export function scoreOfSetAtTime(p, set, time) {
  let home = 0, away = 0, server = null, found = false;
  for (const e of p.events) {
    if (e.set === set && e.time <= time + 1e-6) {
      home = e.homeScore; away = e.awayScore; server = e.server; found = true;
    }
  }
  return { home, away, server, found };
}

// プレビュー用のスコアボード全体を算出する。全セットを「列」として残す。
// 表示セット数 = その時刻までに始まったセット。ただし編集の最前線（最後の
// イベント以降の時刻）にいる場合は、進行中の currentSet（まだ得点が無くても）まで表示する。
export function computeBoardAtTime(p, time) {
  const eps = 1e-6;
  let started = 1;
  for (const e of p.events) if (e.time <= time + eps) started = Math.max(started, e.set);
  const lastEventTime = p.events.reduce((m, e) => Math.max(m, e.time), 0);
  const atLive = p.events.length === 0 || time + eps >= lastEventTime;
  const top = atLive ? Math.max(started, p.currentSet) : started;
  const sets = [];
  for (let s = 1; s <= top; s++) {
    const sc = scoreOfSetAtTime(p, s, time);
    sets.push({ set: s, home: sc.home, away: sc.away });
  }
  const cur = scoreOfSetAtTime(p, top, time);
  return { displaySet: top, sets, server: cur.found ? cur.server : null };
}

// 現在時刻 t より前/後の得点イベントの時刻を返す（無ければ null）。
export function prevEventTime(p, t) {
  let best = null;
  for (const e of p.events) {
    if (e.time < t - 1e-3 && (best === null || e.time > best)) best = e.time;
  }
  return best;
}
export function nextEventTime(p, t) {
  let best = null;
  for (const e of p.events) {
    if (e.time > t + 1e-3 && (best === null || e.time < best)) best = e.time;
  }
  return best;
}

// 進行中セットの手前（1..uptoSet-1）までの獲得セット数を集計する。
export function computeSetsWon(p, uptoSet) {
  let home = 0, away = 0;
  for (let s = 1; s < uptoSet; s++) {
    const sc = scoreOfSetAtTime(p, s, Infinity);
    if (sc.home > sc.away) home++;
    else if (sc.away > sc.home) away++;
  }
  return { home, away };
}

// 編集中の現在スコア（currentSet の最終スコア）
export function currentScore(p) {
  const s = lastScoreOfSet(p, p.currentSet);
  return { set: p.currentSet, home: s.homeScore, away: s.awayScore, server: s.server };
}

export function touch(p) {
  p.updatedAt = new Date().toISOString();
}
