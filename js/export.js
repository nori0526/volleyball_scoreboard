// export.js — 書き出し用データ（プロジェクトJSON ＋ FFmpeg向けヒント）の生成

// 内部用フィールド(_serveSeed等)を除いたクリーンなプロジェクトを返す
export function cleanProject(p) {
  const out = JSON.parse(JSON.stringify(p));
  delete out._serveSeed;
  return out;
}

// 安全なファイル名（拡張子前のベース名）
export function baseName(p) {
  const n = (p.projectName || 'project').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return n || 'project';
}

// 各得点の「表示が有効な時間区間」を組み立てる。
// あるイベントの表示は、そのイベント時刻から次の表示変化（同セットの次得点 or 次セット開始）まで。
function buildSegments(p) {
  const events = [...p.events].sort((a, b) => a.time - b.time);
  const dur = p.videoDuration || (events.length ? events[events.length - 1].time + 5 : 0);
  const segments = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1];
    const end = next ? next.time : dur;
    segments.push({
      start: round(e.time),
      end: round(end),
      set: e.set,
      home: e.homeScore,
      away: e.awayScore,
      server: e.server,
      homeText: `${p.teams.home.name} ${e.homeScore}`,
      awayText: `${p.teams.away.name} ${e.awayScore}`,
      setText: `${e.set}セット目`
    });
  }
  return segments;
}

function round(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// PC側ツールが消費する中間表現。完全なコマンド生成は将来拡張。
export function buildExportData(p) {
  const display = p.display;
  return {
    format: 'score-caption-export',
    version: 1,
    project: cleanProject(p),
    render: {
      videoFileName: p.videoFileName,
      videoDuration: p.videoDuration,
      display: {
        position: display.position,
        x: display.x,
        y: display.y,
        fontSize: display.fontSize,
        scale: display.scale,
        textColor: display.textColor,
        backgroundColor: display.backgroundColor,
        backgroundOpacity: display.backgroundOpacity,
        showBackground: display.showBackground,
        showServe: display.showServe
      },
      // FFmpeg drawtext 等で利用できる時間区間付きセグメント
      segments: buildSegments(p)
    },
    // 参考：drawtext の enable 例（PC側でフォント/座標を補完して使用）
    ffmpegHint: buildFfmpegHintLines(p)
  };
}

// 参考用の drawtext 断片（コメント付き擬似コマンド）
export function buildFfmpegHintLines(p) {
  const segs = buildSegments(p);
  const lines = [
    '# FFmpeg 参考ヒント（座標・フォントはPC側で調整してください）',
    `# 入力: ${p.videoFileName || 'INPUT.mp4'}`,
    '# 各セグメントを drawtext の enable=between(t,start,end) で重ねます'
  ];
  for (const s of segs) {
    lines.push(
      `drawtext=text='${s.setText}  ${escapeFf(p.teams.home.name)} ${s.home} - ${s.away} ${escapeFf(p.teams.away.name)}'` +
      `:enable='between(t\\,${s.start}\\,${s.end})':x=${p.display.x}:y=${p.display.y}:fontsize=${p.display.fontSize}`
    );
  }
  return lines;
}

function escapeFf(s) {
  return String(s).replace(/[':\\]/g, (c) => '\\' + c);
}
