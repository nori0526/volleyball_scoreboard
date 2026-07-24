// events.js — 得点イベントの加算/取消/セット切替/サーブ権ロジック
import { sortEvents, touch, startedSetAt } from './state.js';

// 得点加算：指定動画時刻で +1。加点チームへサーブ権を移動。
// スナップショットは時刻順の再集計で振り直す（仕様6.2）。これにより、
// 記録し忘れた得点を「過去の時点に戻って」挿入しても、挿入点以降の
// スコアが正しく +1 ずつ繰り上がる。
// セットは通常 currentSet。ただし現在セットの開始時刻より前へ戻って
// 押した場合は、その時刻に進行していたセットへ挿入する（セットまたぎ対応）。
export function addPoint(p, team, time) {
  const t = Math.max(0, Number(time) || 0);
  let set = p.currentSet;
  const curStart = p.setStarts ? Number(p.setStarts[set]) : NaN;
  if (isFinite(curStart) && t < curStart - 1e-6) set = startedSetAt(p, t);
  const ev = {
    time: t,
    set,
    team,
    homeScore: 0, // recomputeSnapshots で確定
    awayScore: 0,
    server: team // 加点したチームへサーブ権が移る
  };
  p.events.push(ev);
  recomputeSnapshots(p); // ソート＋セット内を時刻順に積算し直す
  touch(p);
  return ev;
}

// 指定イベント（参照）を取り消す。途中挿入した得点の Undo 用。
export function undoEvent(p, ev) {
  const i = p.events.indexOf(ev);
  if (i < 0) return null;
  p.events.splice(i, 1);
  recomputeSnapshots(p);
  touch(p);
  return ev;
}

// 直前の得点を取り消し：currentSet 内で最も遅い時刻のイベントを削除。
// currentSet に得点が無い場合は全体の最後を削除（直前操作の取消）。
export function undoLast(p) {
  let idx = -1;
  let bestTime = -Infinity;
  for (let i = 0; i < p.events.length; i++) {
    const e = p.events[i];
    if (e.set === p.currentSet && e.time >= bestTime) { bestTime = e.time; idx = i; }
  }
  if (idx === -1 && p.events.length) idx = p.events.length - 1; // フォールバック
  if (idx === -1) return null;
  const [removed] = p.events.splice(idx, 1);
  recomputeSnapshots(p);
  touch(p);
  return removed;
}

// 次のセットへ。新セットは 0-0 から。切替時の動画時刻を setStarts に記録し、
// シーク/書き出しでも「0-0 の新セット列」が切替時刻から表示されるようにする。
export function nextSet(p, time) {
  p.currentSet += 1;
  if (!p.setStarts) p.setStarts = {};
  p.setStarts[p.currentSet] = Math.round(Math.max(0, Number(time) || 0) * 100) / 100;
  touch(p);
  return p.currentSet;
}

// 前のセットへ戻る（誤操作の救済。1未満にはしない）。戻したセットの開始記録は破棄。
export function prevSet(p) {
  if (p.currentSet > 1) {
    if (p.setStarts) delete p.setStarts[p.currentSet];
    p.currentSet -= 1;
    touch(p);
  }
  return p.currentSet;
}

// サーブ権を手動切替。currentSet の最終イベントの server を反転。
// イベントが無い場合は home から開始トグル。
export function toggleServe(p) {
  const inSet = p.events.filter((e) => e.set === p.currentSet);
  if (inSet.length) {
    const last = inSet[inSet.length - 1];
    last.server = last.server === 'home' ? 'away' : 'home';
  } else {
    p._serveSeed = p._serveSeed === 'home' ? 'away' : 'home';
  }
  touch(p);
}

// イベント一覧からの個別削除
export function deleteEvent(p, index) {
  if (index < 0 || index >= p.events.length) return null;
  const [removed] = p.events.splice(index, 1);
  recomputeSnapshots(p);
  touch(p);
  return removed;
}

// セットごとに時刻順で得点の積算（homeScore/awayScore）を振り直す。
// 編集（時刻変更・チーム変更・削除）後に呼んで整合を保つ。server は変更しない。
export function recomputeSnapshots(p) {
  sortEvents(p);
  const tally = {};
  for (const e of p.events) {
    if (!tally[e.set]) tally[e.set] = { home: 0, away: 0 };
    if (e.team === 'home') tally[e.set].home++; else tally[e.set].away++;
    e.homeScore = tally[e.set].home;
    e.awayScore = tally[e.set].away;
  }
}

// イベントの時刻を delta 秒ずらす（0〜maxTime でクランプ）。再計算込み。
export function nudgeEventTime(p, index, delta, maxTime) {
  const e = p.events[index];
  if (!e) return null;
  let t = (Number(e.time) || 0) + delta;
  t = Math.max(0, maxTime ? Math.min(t, maxTime) : t);
  e.time = Math.round(t * 100) / 100;
  recomputeSnapshots(p);
  touch(p);
  return e;
}

// 加点チームを反転する。サーブ権も得点者へ移し、積算を振り直す。
export function flipEventTeam(p, index) {
  const e = p.events[index];
  if (!e) return null;
  e.team = e.team === 'home' ? 'away' : 'home';
  e.server = e.team;
  recomputeSnapshots(p);
  touch(p);
  return e;
}
