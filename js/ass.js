// ass.js — 装飾付きスコアボードを ASS 字幕として書き出す。
// ffmpeg で `-vf "ass=xxx.ass"` で焼き込み可能（Python等の変換不要）。
// 座標系：PlayResX/Y は編集時のプレビュー枠サイズ。display.x/y/fontSize 等は
// そのプレビュー枠px単位なので、libass が動画解像度へ比例スケールして焼き込む。
import { scoreOfSetAtTime, computeSetsWon } from './state.js';

// ---- 色・時刻ユーティリティ ----
function assColor(hex) { // '#rrggbb' -> 'BBGGRR'
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return (b + g + r).toUpperCase();
}
function assAlpha(opacity) { // 0..1 不透明度 -> 'AA' 透過hex（00=不透明,FF=透明）
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255);
  return a.toString(16).padStart(2, '0').toUpperCase();
}
function assTime(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}
function assText(s) { return String(s).replace(/[{}\\]/g, '').replace(/\r?\n/g, ' '); }

// ---- 書き出し時のスコアボード状態（編集状態に依らず events だけで決定）----
function exportBoardAt(p, t) {
  let started = 1;
  for (const e of p.events) if (e.time <= t + 1e-6) started = Math.max(started, e.set);
  const sets = [];
  for (let s = 1; s <= started; s++) {
    const sc = scoreOfSetAtTime(p, s, t);
    sets.push({ set: s, home: sc.home, away: sc.away });
  }
  const cur = scoreOfSetAtTime(p, started, t);
  const won = computeSetsWon(p, started);
  return { sets, server: cur.found ? cur.server : null, won };
}

function buildSegments(p) {
  const events = [...p.events].sort((a, b) => a.time - b.time);
  if (!events.length) return [];
  const dur = p.videoDuration || (events[events.length - 1].time + 5);
  // 境界＝0 と 各イベント時刻 と 終端
  const bounds = [0];
  for (const e of events) if (e.time > 0 && e.time < dur) bounds.push(e.time);
  bounds.push(dur);
  const uniq = [...new Set(bounds)].sort((a, b) => a - b);

  const segs = [];
  for (let k = 0; k < uniq.length - 1; k++) {
    const start = uniq[k], end = uniq[k + 1];
    if (end <= start) continue;
    const state = exportBoardAt(p, start);
    const sig = JSON.stringify(state);
    const last = segs[segs.length - 1];
    if (last && last.sig === sig) { last.end = end; continue; } // 同一状態は連結
    segs.push({ start, end, state, sig });
  }
  return segs;
}

// ---- メイン：ASS文字列を生成 ----
export function buildAss(p, opts = {}) {
  const d = p.display;
  const playW = Math.round(opts.playResX || 390);
  const playH = Math.round(opts.playResY || 694);
  const S = d.scale || 1;

  // メトリクス（PlayRes px、scale込み）
  const fs = (d.fontSize || 28) * S;
  const lineH = fs * 1.3;
  const markW = fs * 0.7, markGap = fs * 0.35;
  const setNumFs = fs * 0.55, setCountFs = fs * 0.55;
  const padV = (d.padding != null ? d.padding : 5) * S;
  const padH = ((d.padding != null ? d.padding : 5) + 3) * S;
  const gapAfterName = fs * 0.4;
  const scoreColW = fs * 1.7;
  const serveW = d.showServe ? fs * 0.95 : 0;
  const maxNameChars = Math.max(2, p.teams.home.name.length, p.teams.away.name.length);
  const nameColW = fs * Math.min(maxNameChars, 10);
  const M = 12 * S; // プリセット余白

  const textC = '&H' + assAlpha(1) + assColor(d.textColor) + '&';
  const homeC = '&H' + assAlpha(1) + assColor(p.teams.home.color) + '&';
  const awayC = '&H' + assAlpha(1) + assColor(p.teams.away.color) + '&';
  const serveC = '&H002D2DFF&'; // 赤丸 #ff2d2d
  const teamC = (side) => (side === 'home' ? homeC : awayC);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${playW}`,
    `PlayResY: ${playH}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: SB,Meiryo,${Math.round(fs)},${textC},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n');

  const segs = buildSegments(p);
  const lines = [];

  for (const seg of segs) {
    const st = seg.state;
    const numSets = st.sets.length;
    const start = assTime(seg.start), end = assTime(seg.end);

    // 行Y
    const contentW = markW + markGap + nameColW + gapAfterName + numSets * scoreColW + serveW;
    const setCountH = d.showSetCount ? setCountFs * 1.25 : 0;
    const headerH = setNumFs * 1.25;
    const contentH = setCountH + headerH + 2 * lineH;
    const boxW = contentW + 2 * padH;
    const boxH = contentH + 2 * padV;

    // ボックス位置（左上 bx,by）
    let bx, by;
    switch (d.position) {
      case 'top-right': bx = playW - boxW - M; by = M; break;
      case 'bottom-left': bx = M; by = playH - boxH - M; break;
      case 'bottom-right': bx = playW - boxW - M; by = playH - boxH - M; break;
      case 'custom': bx = (d.x || 0); by = (d.y || 0); break;
      case 'top-left':
      default: bx = M; by = M; break;
    }
    const cx = bx + padH, cy = by + padV;

    const dlg = (layer, txt) => lines.push(`Dialogue: ${layer},${start},${end},SB,,0,0,0,,${txt}`);
    const r = (n) => Math.round(n);

    // 背景ボックス（Layer0）
    if (d.showBackground) {
      const ba = '&H' + assAlpha(d.backgroundOpacity) + '&';
      const bc = '&H' + assColor(d.backgroundColor) + '&';
      dlg(0, `{\\an7\\pos(${r(bx)},${r(by)})\\bord0\\shad0\\1c${bc}\\1a${ba}\\p1}m 0 0 l ${r(boxW)} 0 ${r(boxW)} ${r(boxH)} 0 ${r(boxH)}{\\p0}`);
    }

    // 行Y座標
    let y = cy;
    let setCountY = y; if (d.showSetCount) y += setCountH;
    const headerY = y; y += headerH;
    const homeY = y; const awayY = y + lineH;

    // 列の右端X
    const colRight = (i) => cx + markW + markGap + nameColW + gapAfterName + (i + 1) * scoreColW;
    const serveX = cx + markW + markGap + nameColW + gapAfterName + numSets * scoreColW + fs * 0.2;

    // セットカウント
    if (d.showSetCount) {
      dlg(1, `{\\an7\\pos(${r(cx)},${r(setCountY)})\\fs${r(setCountFs)}\\b1\\c${textC}\\bord0\\shad0}${assText('セット ' + st.won.home + ' - ' + st.won.away)}`);
    }
    // セット番号ヘッダ
    for (let i = 0; i < numSets; i++) {
      dlg(1, `{\\an9\\pos(${r(colRight(i))},${r(headerY)})\\fs${r(setNumFs)}\\c${textC}\\alpha&H40&\\bord0\\shad0}${st.sets[i].set}`);
    }
    // 行（home/away）
    const row = (side, rowY, label, getScore) => {
      // チームカラーの四角マーク
      const my = rowY + (lineH - markW) / 2;
      dlg(1, `{\\an7\\pos(${r(cx)},${r(my)})\\bord0\\shad0\\1c${teamC(side)}\\p1}m 0 0 l ${r(markW)} 0 ${r(markW)} ${r(markW)} 0 ${r(markW)}{\\p0}`);
      // チーム名
      dlg(1, `{\\an7\\pos(${r(cx + markW + markGap)},${r(rowY)})\\fs${r(fs)}\\c${textC}\\bord0\\shad0}${assText(label)}`);
      // 各セットのスコア
      for (let i = 0; i < numSets; i++) {
        dlg(1, `{\\an9\\pos(${r(colRight(i))},${r(rowY)})\\fs${r(fs)}\\b1\\c${textC}\\bord0\\shad0}${getScore(st.sets[i])}`);
      }
      // サーブ権の赤丸
      if (d.showServe && st.server === side) {
        dlg(1, `{\\an4\\pos(${r(serveX)},${r(rowY + lineH / 2)})\\fs${r(fs * 0.8)}\\c${serveC}\\bord0\\shad0}●`);
      }
    };
    row('home', homeY, p.teams.home.name, (s) => s.home);
    row('away', awayY, p.teams.away.name, (s) => s.away);
  }

  return header + '\n' + lines.join('\n') + '\n';
}

// 推奨 ffmpeg コマンド（参考表示用）
export function ffmpegCommand(videoName, assName) {
  const vid = videoName || 'input.mov';
  const ass = assName || 'scoreboard.ass';
  return `ffmpeg -i "${vid}" -vf "ass=${ass}" -c:a copy output.mp4`;
}
