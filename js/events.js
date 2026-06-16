// events.js — 得点イベントの加算/取消/セット切替/サーブ権ロジック
import { lastScoreOfSet, sortEvents, touch } from './state.js';

// 得点加算：currentSet・指定動画時刻で +1。加点チームへサーブ権を移動。
// スナップショット付きイベントを push する（仕様6.2）。
export function addPoint(p, team, time) {
  const t = Math.max(0, Number(time) || 0);
  const set = p.currentSet;
  const last = lastScoreOfSet(p, set);
  const ev = {
    time: t,
    set,
    team,
    homeScore: last.homeScore + (team === 'home' ? 1 : 0),
    awayScore: last.awayScore + (team === 'away' ? 1 : 0),
    server: team // 加点したチームへサーブ権が移る
  };
  p.events.push(ev);
  sortEvents(p);
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
  touch(p);
  return removed;
}

// 次のセットへ。新セットは 0-0 から（イベント未記録なら算出上0-0）。
export function nextSet(p) {
  p.currentSet += 1;
  touch(p);
  return p.currentSet;
}

// 前のセットへ戻る（誤操作の救済。1未満にはしない）
export function prevSet(p) {
  if (p.currentSet > 1) { p.currentSet -= 1; touch(p); }
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
  touch(p);
  return removed;
}
