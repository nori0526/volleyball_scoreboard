// board-render.js — スコアボードを Canvas に描画する共通レンダラ。
// アプリ内プレビューと書き出しPNGが「同一の描画コード」を通ることで、
// ffmpeg で焼き込んだ結果とプレビューの見た目を一致させる。
// K: 総合スケール（プレビュー時 = display.scale、書き出し時 = display.scale × 動画解像度/プレビュー幅）

function fontStack() {
  return "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', sans-serif";
}

function hexToRgba(hex, alpha) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// レイアウト計算（ctx は measureText 用）。すべて K でスケール済みの px を返す。
export function layoutBoard(ctx, p, board, K) {
  const d = p.display;
  const F = fontStack();
  const fs = (d.fontSize || 28) * K;
  const small = fs * 0.5;
  const lineH = fs * 1.2;
  const markSz = fs * 0.7;
  const markGap = fs * 0.35;
  const colGap = fs * 0.45;
  const rowGap = 1 * K;
  const padV = (d.padding != null ? d.padding : 5) * K;
  const padH = padV + 3 * K;
  const radius = 8 * K;
  const sets = (board.sets && board.sets.length) ? board.sets : [{ set: 1, home: 0, away: 0 }];

  ctx.font = `${fs}px ${F}`;
  const nameW = Math.max(
    ctx.measureText(p.teams.home.name).width,
    ctx.measureText(p.teams.away.name).width
  );
  const teamW = markSz + markGap + nameW + fs * 0.3;

  const colW = sets.map((s) => {
    ctx.font = `bold ${fs}px ${F}`;
    let w = Math.max(
      ctx.measureText(String(s.home)).width,
      ctx.measureText(String(s.away)).width
    );
    ctx.font = `${small}px ${F}`;
    w = Math.max(w, ctx.measureText(String(s.set)).width);
    return Math.max(w, fs * 1.3);
  });
  const serveW = d.showServe ? fs * 0.55 : 0;
  const gridW = teamW + colW.reduce((a, w) => a + colGap + w, 0) +
    (d.showServe ? colGap + serveW : 0);
  const setCountH = d.showSetCount ? small * 1.2 + 2 * K : 0;
  const headerH = small * 1.2 + 1 * K;
  const gridH = headerH + rowGap + lineH + rowGap + lineH;
  const w = Math.ceil(gridW + 2 * padH);
  const h = Math.ceil(setCountH + gridH + 2 * padV);
  return {
    fs, small, lineH, markSz, markGap, colGap, rowGap,
    padV, padH, radius, sets, nameW, teamW, colW, serveW,
    setCountH, headerH, w, h
  };
}

// canvas に board を描画し、レイアウト（CSS px サイズ含む）を返す。
// board: { sets:[{set,home,away}], server:'home'|'away'|null, won?:{home,away} }
export function drawBoard(canvas, p, board, K, dpr = 1) {
  const ctx = canvas.getContext('2d');
  const m = layoutBoard(ctx, p, board, K);
  canvas.width = Math.max(1, Math.round(m.w * dpr));
  canvas.height = Math.max(1, Math.round(m.h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, m.w, m.h);

  const d = p.display;
  const F = fontStack();

  if (d.showBackground) {
    ctx.fillStyle = hexToRgba(d.backgroundColor, d.backgroundOpacity);
    roundRectPath(ctx, 0, 0, m.w, m.h, m.radius);
    ctx.fill();
  }

  ctx.textBaseline = 'middle';
  let y = m.padV;

  // セットカウント（獲得セット数）
  if (d.showSetCount) {
    const won = board.won || { home: 0, away: 0 };
    ctx.font = `bold ${m.small}px ${F}`;
    ctx.fillStyle = d.textColor;
    ctx.globalAlpha = 0.85;
    ctx.textAlign = 'left';
    ctx.fillText(`セット ${won.home} - ${won.away}`, m.padH, y + m.small * 0.6);
    ctx.globalAlpha = 1;
    y += m.setCountH;
  }

  // 列の右端X（スコア・セット番号は右揃え）
  const colRight = [];
  let x = m.padH + m.teamW;
  for (const w of m.colW) { x += m.colGap + w; colRight.push(x); }
  const serveCX = x + m.colGap + m.serveW / 2;

  // セット番号ヘッダ
  const headerCY = y + m.headerH / 2;
  ctx.font = `${m.small}px ${F}`;
  ctx.fillStyle = d.textColor;
  ctx.globalAlpha = 0.8;
  ctx.textAlign = 'right';
  m.sets.forEach((s, i) => ctx.fillText(String(s.set), colRight[i], headerCY));
  ctx.globalAlpha = 1;
  y += m.headerH + m.rowGap;

  const row = (side, rowTop) => {
    const cy = rowTop + m.lineH / 2;
    // チームカラーの角丸マーク
    ctx.fillStyle = p.teams[side].color;
    roundRectPath(ctx, m.padH, cy - m.markSz / 2, m.markSz, m.markSz, 3 * K);
    ctx.fill();
    // チーム名
    ctx.font = `${m.fs}px ${F}`;
    ctx.fillStyle = d.textColor;
    ctx.textAlign = 'left';
    ctx.fillText(p.teams[side].name, m.padH + m.markSz + m.markGap, cy);
    // 各セットのスコア（右揃え・太字）
    ctx.font = `bold ${m.fs}px ${F}`;
    ctx.textAlign = 'right';
    m.sets.forEach((s, i) =>
      ctx.fillText(String(side === 'home' ? s.home : s.away), colRight[i], cy));
    // サーブ権の赤丸
    if (d.showServe && board.server === side) {
      ctx.fillStyle = '#ff2d2d';
      ctx.beginPath();
      ctx.arc(serveCX, cy, m.fs * 0.275, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  row('home', y);
  row('away', y + m.lineH + m.rowGap);

  return m;
}
