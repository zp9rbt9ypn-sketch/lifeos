/* LIFE OS - IndexedDB の薄いラッパー。
 * 予定・記録・ToDo・状態記録はそれぞれ別のストアに分けて保存する。
 * 将来ストアを増やすときは VER を上げ、onupgradeneeded で追加する(既存データは残る)。 */
(function (root) {
  'use strict';
  const NAME = 'lifeos';
  const VER = 1;
  const STORES = { schedules: 'id', logs: 'key', dayEdits: 'key', todos: 'id', moods: 'date', meta: 'k' };
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB が使えません'));
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  function run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
  const put = (store, obj) => run(store, 'readwrite', (s) => s.put(obj));
  const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

  async function loadAll() {
    const out = {};
    for (const name of Object.keys(STORES)) if (name !== 'meta') out[name] = await getAll(name);
    return out;
  }

  root.LifeDB = { open, getAll, put, del, loadAll, STORES };
})(typeof self !== 'undefined' ? self : this);
