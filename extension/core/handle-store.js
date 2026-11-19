// Keeps the chosen folder handle in IndexedDB so it survives restarts.
// After a restart the browser may ask for permission again (see panel.js).
const DB_NAME = "snapgent-web";
const STORE = "kv";
const KEY = "root";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const saveHandle = (handle) => run("readwrite", (store) => store.put(handle, KEY));
export const loadHandle = () => run("readonly", (store) => store.get(KEY));
