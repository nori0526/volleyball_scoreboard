// video.js — 動画選択・再生・シーク・duration取得

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

// 動画コントローラを生成。File を渡すと object URL で読み込む。
// 動画 Blob は保存しない（再選択方式）。
export function createVideoController(videoEl, { onLoaded, onTime } = {}) {
  let objectUrl = null;
  let rafId = null;

  function revoke() {
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  function tick() {
    if (onTime) onTime(videoEl.currentTime);
    rafId = requestAnimationFrame(tick);
  }
  function startLoop() { if (rafId == null) tick(); }
  function stopLoop() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    if (onTime) onTime(videoEl.currentTime); // 停止位置で最終更新
  }

  videoEl.addEventListener('loadedmetadata', () => {
    if (onLoaded) onLoaded({ duration: videoEl.duration || 0 });
    if (onTime) onTime(videoEl.currentTime);
  });
  videoEl.addEventListener('play', startLoop);
  videoEl.addEventListener('pause', stopLoop);
  videoEl.addEventListener('ended', stopLoop);
  videoEl.addEventListener('seeking', () => { if (onTime) onTime(videoEl.currentTime); });
  videoEl.addEventListener('seeked', () => { if (onTime) onTime(videoEl.currentTime); });

  return {
    loadFile(file) {
      revoke();
      objectUrl = URL.createObjectURL(file);
      videoEl.src = objectUrl;
      videoEl.load();
      return { name: file.name };
    },
    hasVideo() { return !!objectUrl; },
    fileName() { return objectUrl ? videoEl.src : ''; },
    play() { return videoEl.play().catch(() => {}); },
    pause() { videoEl.pause(); },
    toggle() { videoEl.paused ? this.play() : this.pause(); },
    isPaused() { return videoEl.paused; },
    seek(t) {
      const d = videoEl.duration || 0;
      videoEl.currentTime = Math.min(Math.max(0, t), d || t);
    },
    currentTime() { return videoEl.currentTime; },
    duration() { return videoEl.duration || 0; },
    destroy() { stopLoop(); revoke(); videoEl.removeAttribute('src'); videoEl.load(); }
  };
}
