// World saves in IndexedDB. Only edits are stored (generation is deterministic from the seed),
// so saves stay tiny. Falls back to in-memory storage if IndexedDB is unavailable.

const DB_NAME = "hollowstone", VERSION = 1;
let dbPromise = null;
const memory = { worlds: new Map(), chunks: new Map() };

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("worlds")) db.createObjectStore("worlds", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function listWorlds() {
  const db = await open();
  if (!db) return [...memory.worlds.values()];
  const all = await tx(db, "worlds", "readonly", (s) => s.getAll());
  return (all || []).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

export async function saveWorldMeta(meta) {
  const db = await open();
  if (!db) { memory.worlds.set(meta.id, meta); return; }
  await tx(db, "worlds", "readwrite", (s) => s.put(meta));
}

export async function deleteWorld(id) {
  const db = await open();
  if (!db) {
    memory.worlds.delete(id);
    for (const k of [...memory.chunks.keys()]) if (k.startsWith(id + "|")) memory.chunks.delete(k);
    return;
  }
  await tx(db, "worlds", "readwrite", (s) => s.delete(id));
  await tx(db, "chunks", "readwrite", (s) => s.delete(IDBKeyRange.bound(id + "|", id + "|￿")));
}

export async function loadEdits(id) {
  const edits = new Map();
  const db = await open();
  if (!db) {
    for (const [k, v] of memory.chunks) if (k.startsWith(id + "|")) edits.set(k.split("|")[1], new Map(v));
    return edits;
  }
  await new Promise((resolve, reject) => {
    const t = db.transaction("chunks", "readonly");
    const req = t.objectStore("chunks").openCursor(IDBKeyRange.bound(id + "|", id + "|￿"));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      edits.set(String(cur.key).split("|")[1], new Map(cur.value));
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return edits;
}

export async function saveEdits(id, world) {
  if (!world.dirtyEdits.size) return 0;
  const keys = [...world.dirtyEdits];
  world.dirtyEdits.clear();
  const db = await open();
  if (!db) {
    for (const k of keys) memory.chunks.set(id + "|" + k, [...world.edits.get(k)]);
    return keys.length;
  }
  await tx(db, "chunks", "readwrite", (s) => {
    for (const k of keys) s.put([...world.edits.get(k)], id + "|" + k);
  });
  return keys.length;
}

export function newWorldId() {
  return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
