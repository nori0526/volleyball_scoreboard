// burn.js — 「PNG焼き込み一式」の書き出し。
// スコアボードの各状態を透過PNGとして描き（board-render.js＝プレビューと同一描画）、
// ffmpeg の filter_complex スクリプトと実行用 burn.bat を同梱した ZIP を生成する。
// movie フィルタ方式のため PNG が数百枚でもコマンドは短いまま。
import { buildStateSegments } from './ass.js';
import { drawBoard } from './board-render.js';
import { makeZip, strToU8 } from './zip.js';

function pad4(n) { return String(n).padStart(4, '0'); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// p: project, previewW/previewH: 編集時のプレビュー枠サイズ(CSS px)。
// 位置・サイズはプレビュー基準を videoWidth/実効プレビュー幅 で動画解像度へ拡大する。
// 枠の縦横比が動画とずれている場合（レターボックス表示）は、実際に動画が
// 表示されている幅（contain の実効幅）を基準にする。
export async function buildBurnZip(p, { previewW, previewH }) {
  const vw = p.videoWidth, vh = p.videoHeight;
  if (!vw || !vh) throw new Error('video dimensions unknown');
  const ar = vw / vh;
  const effW = previewH ? Math.min(previewW, previewH * ar) : previewW;
  const sf = vw / effW;
  const K = (p.display.scale || 1) * sf;
  const segs = buildStateSegments(p);
  if (!segs.length) throw new Error('no events');

  const canvas = document.createElement('canvas');
  const pngBySig = new Map(); // 同一盤面はPNGを共有
  const files = [];
  const overlays = [];

  for (const seg of segs) {
    let entry = pngBySig.get(seg.sig);
    if (!entry) {
      const board = { sets: seg.state.sets, server: seg.state.server, won: seg.state.won };
      const m = drawBoard(canvas, p, board, K, 1);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const buf = new Uint8Array(await blob.arrayBuffer());
      entry = { name: `png/seg${pad4(pngBySig.size + 1)}.png`, w: m.w, h: m.h };
      pngBySig.set(seg.sig, entry);
      files.push({ name: entry.name, data: buf });
    }
    // ボックス位置（動画px）。微調整オフセット（プレビューpx）は sf 倍して適用
    const d = p.display;
    const M = Math.round(12 * sf);
    const OX = Math.round((d.offsetX || 0) * sf);
    const OY = Math.round((d.offsetY || 0) * sf);
    let x, y;
    switch (d.position) {
      case 'top-right': x = vw - entry.w - M + OX; y = M + OY; break;
      case 'bottom-left': x = M + OX; y = vh - entry.h - M + OY; break;
      case 'bottom-right': x = vw - entry.w - M + OX; y = vh - entry.h - M + OY; break;
      case 'custom': x = Math.round((d.x || 0) * sf); y = Math.round((d.y || 0) * sf); break;
      default: x = M + OX; y = M + OY;
    }
    overlays.push({
      png: entry.name,
      x: Math.min(Math.max(0, Math.round(x)), Math.max(0, vw - entry.w)),
      y: Math.min(Math.max(0, Math.round(y)), Math.max(0, vh - entry.h)),
      start: r2(seg.start),
      end: r2(seg.end)
    });
  }

  // filters.txt（-filter_complex_script 用）
  const L = ['[0:v]format=yuv420p[v0];'];
  overlays.forEach((o, i) => {
    L.push(`movie=${o.png}[p${i + 1}];`);
    L.push(`[v${i}][p${i + 1}]overlay=x=${o.x}:y=${o.y}:enable='between(t,${o.start},${o.end})':eof_action=repeat[v${i + 1}];`);
  });
  L.push(`[v${overlays.length}]null[vout]`);
  const filters = L.join('\n') + '\n';

  // 出力名は cmd メタ文字（& ^ % ! ( ) 等）を全て除去。入力名は原本一致が必要なので
  // set "VAR=..." 形式＋% の二重化で安全に埋め込む。
  const safeBase = (p.projectName || 'match')
    .replace(/[\\/:*?"<>|&^%!()\[\]{};=,`'\s]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'match';
  const input = p.videoFileName || 'input.mov';
  const batVal = (s) => s.replace(/%/g, '%%'); // batファイル内の % は %% にエスケープ
  const output = `${safeBase}_scored.mp4`;

  // 音声は先頭トラック（AAC）だけを使う: -map 0:a:0?
  // iPhoneの空間オーディオ(APAC)等、MP4へコピー不可の副音声トラックを除外するため。
  // 終了判定は %ERRORLEVEL% neq 0（ffmpegは負の終了コードを返すことがあり、
  // if errorlevel 1 では負数を検知できない）。
  const ffArgs = (vcodec) =>
    `-y -i "%INPUT%" -filter_complex_script filters.txt -map "[vout]" -map 0:a:0? ${vcodec} -c:a copy -movflags +faststart "%OUTPUT%"`;
  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'pushd "%~dp0"',
    `set "INPUT=${batVal(input)}"`,
    `set "OUTPUT=${output}"`,
    'where ffmpeg >nul 2>nul || (echo ffmpeg が見つかりません。PATH を確認してください。 & popd & pause & exit /b 1)',
    'if not exist "%INPUT%" (echo 動画ファイル "%INPUT%" がこのフォルダにありません。 & popd & pause & exit /b 1)',
    'echo 焼き込みを開始します: "%INPUT%"',
    `ffmpeg ${ffArgs('-c:v h264_qsv -b:v 12M')}`,
    'if %ERRORLEVEL% equ 0 goto done',
    'echo QSV が使えないため libx264 で再試行します...',
    `ffmpeg ${ffArgs('-c:v libx264 -crf 20 -preset medium')}`,
    'if %ERRORLEVEL% equ 0 goto done',
    'echo.',
    'echo 失敗しました。上記の ffmpeg エラーを確認してください。',
    'del "%OUTPUT%" >nul 2>nul',
    'popd',
    'pause',
    'exit /b 1',
    ':done',
    'echo.',
    'echo 完了: "%OUTPUT%"',
    'popd',
    'pause'
  ].join('\r\n') + '\r\n';

  const readme = [
    '# スコアボード焼き込み一式',
    '',
    '## 使い方',
    `1. このフォルダ（ZIPを展開した場所）に元動画「${input}」を置く`,
    '2. burn.bat をダブルクリック',
    `3. 完成: ${output}`,
    '',
    '## 内容',
    '- png/         スコアボードの透過PNG（状態ごと・プレビューと同一描画）',
    '- filters.txt  ffmpeg フィルタスクリプト（movie+overlay、時間区間つき）',
    '- burn.bat     実行バッチ（h264_qsv → 失敗時 libx264 に自動フォールバック）',
    '',
    '## メモ',
    `- 動画解像度 ${vw}x${vh}・プレビュー幅 ${Math.round(previewW)}px 基準で位置とサイズを拡大しています`,
    '- ビットレートを変えたい場合は burn.bat の -b:v 12M を編集（4Kなら 20M〜40M 推奨）',
    '- 「任意位置（ドラッグ）」はドラッグした端末のプレビュー基準です。別端末で書き出す場合はプリセット位置を推奨',
    '- 文字化けする場合は burn.bat をメモ帳で開き直して保存してください'
  ].join('\r\n') + '\r\n';

  files.push({ name: 'filters.txt', data: strToU8(filters) });
  files.push({ name: 'burn.bat', data: strToU8(bat) });
  files.push({ name: 'README.txt', data: strToU8(readme) });

  return { blob: makeZip(files), pngCount: pngBySig.size, segCount: overlays.length, output };
}
