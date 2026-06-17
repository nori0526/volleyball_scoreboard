// storage.js — IndexedDB保存/読込 ＋ JSONエクスポート/インポート
// 動画 Blob は保存しない（編集データのみ）。

const DB_NAME = 'score-caption-db';
const DB_VERSION = 1;
const STORE = 'projects';
const LAST_KEY = 'score-caption:lastProjectId';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveProject(project) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').put(project);
    req.onsuccess = () => { setLastProjectId(project.id); resolve(); };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllProjects() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function setLastProjectId(id) {
  try { localStorage.setItem(LAST_KEY, id); } catch (_) {}
}
export function getLastProjectId() {
  try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; }
}

// 永続ストレージを要求（iOSの自動削除を抑止）。失敗は握りつぶす。
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) {}
  return false;
}

// ===== JSON 入出力 =====
export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (e) { reject(new Error('JSON の解析に失敗しました')); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
