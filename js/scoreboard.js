// scoreboard.js — スコアボードの重ね表示・位置/サイズ/配色適用・ドラッグ

function hexToRgba(hex, alpha) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function setLabel(set) { return `${set}セット目`; }

// el: #scoreboard, p: project, score: {set, home, away, server}
export function renderScoreboard(el, p, score) {
  const d = p.display;
  el.hidden = false;

  const serveDot = (side) =>
    d.showServe
      ? `<span class="sb-serve${score.server === side ? '' : ' hidden-slot'}"></span>`
      : '';

  el.innerHTML = `
    <div class="sb-set">${setLabel(score.set)}</div>
    <div class="sb-row">
      <span class="sb-mark" style="background:${p.teams.home.color}"></span>
      <span class="sb-name">${escapeHtml(p.teams.home.name)}</span>
      <span class="sb-score">${score.home}</span>
      ${serveDot('home')}
    </div>
    <div class="sb-row">
      <span class="sb-mark" style="background:${p.teams.away.color}"></span>
      <span class="sb-name">${escapeHtml(p.teams.away.name)}</span>
      <span class="sb-score">${score.away}</span>
      ${serveDot('away')}
    </div>`;

  applyStyle(el, p);
}

// 見た目（色・サイズ・背景）と位置の適用
export function applyStyle(el, p) {
  const d = p.display;
  el.style.fontSize = d.fontSize + 'px';
  el.style.color = d.textColor;
  el.style.transform = `scale(${d.scale})`;
  if (d.showBackground) {
    el.style.background = hexToRgba(d.backgroundColor, d.backgroundOpacity);
  } else {
    el.style.background = 'transparent';
  }
  applyPosition(el, p);
}

export function applyPosition(el, p) {
  const d = p.display;
  // 一旦すべてリセット
  el.style.top = el.style.bottom = el.style.left = el.style.right = 'auto';
  el.classList.toggle('draggable', d.position === 'custom');
  const m = 12; // プリセット時のマージン
  switch (d.position) {
    case 'top-left': el.style.top = m + 'px'; el.style.left = m + 'px'; break;
    case 'top-right': el.style.top = m + 'px'; el.style.right = m + 'px'; el.style.transformOrigin = 'top right'; break;
    case 'bottom-left': el.style.bottom = m + 'px'; el.style.left = m + 'px'; el.style.transformOrigin = 'bottom left'; break;
    case 'bottom-right': el.style.bottom = m + 'px'; el.style.right = m + 'px'; el.style.transformOrigin = 'bottom right'; break;
    case 'custom':
    default:
      el.style.left = (d.x || 0) + 'px';
      el.style.top = (d.y || 0) + 'px';
      el.style.transformOrigin = 'top left';
      break;
  }
  if (d.position !== 'custom') {
    // プリセットでは origin を該当角に（top-left は既定）
    if (d.position === 'top-left') el.style.transformOrigin = 'top left';
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
    nx = Math.max(0, Math.min(nx, wr.width - el.offsetWidth * (p.display.scale || 1)));
    ny = Math.max(0, Math.min(ny, wr.height - el.offsetHeight * (p.display.scale || 1)));
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
