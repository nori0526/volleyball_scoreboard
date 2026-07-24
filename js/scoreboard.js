// scoreboard.js — スコアボードの重ね表示（Canvas描画）・位置適用・ドラッグ
// 描画本体は board-render.js に一本化（プレビュー＝書き出しPNG の見た目一致のため）。
import { computeSetsWon } from './state.js';
import { drawBoard } from './board-render.js';

// el: #scoreboard（canvas要素）, p: project,
// board: {displaySet, sets:[{set,home,away}], server}
export function renderScoreboard(el, p, board) {
  el.hidden = false;
  if (p.display.showSetCount) {
    const top = board.displaySet ||
      (board.sets && board.sets.length ? board.sets[board.sets.length - 1].set : 1);
    board.won = computeSetsWon(p, top);
  }
  const dpr = window.devicePixelRatio || 1;
  const m = drawBoard(el, p, board, p.display.scale || 1, dpr);
  el.style.width = m.w + 'px';
  el.style.height = m.h + 'px';
  applyPosition(el, p);
}

// 後方互換：見た目はCanvas描画時に反映されるため、位置適用のみ行う。
export function applyStyle(el, p) {
  applyPosition(el, p);
}

export function applyPosition(el, p) {
  const d = p.display;
  el.style.top = el.style.bottom = el.style.left = el.style.right = 'auto';
  el.classList.toggle('draggable', d.position === 'custom');
  const M = 12; // プリセット時の基本マージン（プレビューpx）
  const ox = d.offsetX || 0, oy = d.offsetY || 0; // +で右/下へ微調整
  const c = (v) => Math.max(0, v) + 'px'; // 端まで（0）でクランプ
  switch (d.position) {
    case 'top-left': el.style.top = c(M + oy); el.style.left = c(M + ox); break;
    case 'top-right': el.style.top = c(M + oy); el.style.right = c(M - ox); break;
    case 'bottom-left': el.style.bottom = c(M - oy); el.style.left = c(M + ox); break;
    case 'bottom-right': el.style.bottom = c(M - oy); el.style.right = c(M - ox); break;
    case 'custom':
    default:
      el.style.left = (d.x || 0) + 'px';
      el.style.top = (d.y || 0) + 'px';
      break;
  }
}

// 任意位置ドラッグ。custom 時のみ有効。位置確定で onChange(x,y) を呼ぶ。
// getProject: 現在のプロジェクトを返す関数（初期化後にプロジェクトが差し替わるため）。
export function enableDrag(el, wrap, getProject, onChange) {
  let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;

  function point(e) {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }
  function down(e) {
    const p = getProject();
    if (!p || p.display.position !== 'custom') return;
    dragging = true;
    const pt = point(e);
    startX = pt.x; startY = pt.y;
    baseX = p.display.x || 0; baseY = p.display.y || 0;
    e.preventDefault();
  }
  function move(e) {
    if (!dragging) return;
    const p = getProject();
    if (!p) return;
    const pt = point(e);
    const wr = wrap.getBoundingClientRect();
    let nx = baseX + (pt.x - startX);
    let ny = baseY + (pt.y - startY);
    nx = Math.max(0, Math.min(nx, wr.width - el.offsetWidth));
    ny = Math.max(0, Math.min(ny, wr.height - el.offsetHeight));
    p.display.x = Math.round(nx);
    p.display.y = Math.round(ny);
    el.style.left = p.display.x + 'px';
    el.style.top = p.display.y + 'px';
    e.preventDefault();
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    const p = getProject();
    if (onChange && p) onChange(p.display.x, p.display.y);
  }

  el.addEventListener('mousedown', down);
  el.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}
