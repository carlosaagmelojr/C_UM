// ============================================================
// db.js — Camada de dados: IndexedDB (offline) + Supabase (online)
// ============================================================

// ---- CONFIGURAÇÃO SUPABASE ----
// Substitua pelos seus valores do projeto Supabase
const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_AQUI';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- INDEXEDDB (armazenamento offline) ----
const DB_NAME = 'censo_telecom';
const DB_VERSION = 1;
let db = null;

async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      // Postes
      if (!d.objectStoreNames.contains('postes')) {
        const store = d.createObjectStore('postes', { keyPath: 'id' });
        store.createIndex('synced', 'synced');
        store.createIndex('municipio', 'municipio');
        store.createIndex('created_at', 'created_at');
      }
      // Provedores
      if (!d.objectStoreNames.contains('provedores')) {
        const store = d.createObjectStore('provedores', { keyPath: 'id' });
        store.createIndex('poste_id', 'poste_id');
        store.createIndex('synced', 'synced');
      }
      // Fila de sync
      if (!d.objectStoreNames.contains('sync_queue')) {
        const store = d.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        store.createIndex('tipo', 'tipo');
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ---- HELPERS GENÉRICOS ----
function dbTx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const req = dbTx(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(store, index, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const req = index ? s.index(index).getAll(value) : s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(store, data) {
  return new Promise((resolve, reject) => {
    const req = dbTx(store, 'readwrite').put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const req = dbTx(store, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---- POSTES ----
const PosteDB = {
  async save(poste) {
    if (!poste.id) poste.id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    poste.synced = false;
    poste.created_at = poste.created_at || new Date().toISOString();
    await dbPut('postes', poste);
    await SyncQueue.add('poste', poste.id, poste);
    return poste;
  },

  async getAll() {
    return dbGetAll('postes');
  },

  async getById(id) {
    return dbGet('postes', id);
  },

  async getPendentes() {
    return dbGetAll('postes', 'synced', false);
  },

  async markSynced(localId, remoteId) {
    const poste = await dbGet('postes', localId);
    if (poste) {
      poste.synced = true;
      poste.remote_id = remoteId;
      await dbPut('postes', poste);
    }
  },

  // Verifica duplicatas por proximidade GPS (raio em metros)
  async checkDuplicate(lat, lng, raioMetros = 5) {
    const todos = await this.getAll();
    for (const p of todos) {
      if (!p.latitude || !p.longitude) continue;
      const dist = calcDistance(lat, lng, p.latitude, p.longitude);
      if (dist <= raioMetros) return { poste: p, distancia: dist.toFixed(1) };
    }
    return null;
  }
};

// ---- PROVEDORES ----
const ProvDB = {
  async save(prov) {
    if (!prov.id) prov.id = 'prov_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    prov.synced = false;
    prov.created_at = new Date().toISOString();
    await dbPut('provedores', prov);
    await SyncQueue.add('provedor', prov.id, prov);
    return prov;
  },

  async getByPoste(posteId) {
    return dbGetAll('provedores', 'poste_id', posteId);
  },

  async getPendentes() {
    return dbGetAll('provedores', 'synced', false);
  },

  async markSynced(id) {
    const p = await dbGet('provedores', id);
    if (p) { p.synced = true; await dbPut('provedores', p); }
  }
};

// ---- FILA DE SINCRONIZAÇÃO ----
const SyncQueue = {
  async add(tipo, refId, dados) {
    await dbPut('sync_queue', {
      tipo,
      ref_id: refId,
      dados,
      tentativas: 0,
      created_at: new Date().toISOString()
    });
  },

  async getAll() {
    return dbGetAll('sync_queue');
  },

  async remove(id) {
    return dbDelete('sync_queue', id);
  },

  async count() {
    const items = await this.getAll();
    return items.length;
  }
};

// ---- UTILIDADES GPS ----
function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS não disponível'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`);
    const d = await r.json();
    return {
      logradouro: (d.address.road || d.address.street || '') + (d.address.house_number ? ', ' + d.address.house_number : ''),
      bairro: d.address.suburb || d.address.neighbourhood || d.address.quarter || '',
      municipio: d.address.city || d.address.town || d.address.village || '',
      estado: d.address.state || '',
      cep: d.address.postcode || ''
    };
  } catch {
    return { logradouro: '', bairro: '', municipio: '', estado: '', cep: '' };
  }
}

// ---- AUTH ----
const Auth = {
  user: null,

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    return data.user;
  },

  async logout() {
    await supabase.auth.signOut();
    this.user = null;
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    this.user = data.session?.user || null;
    return this.user;
  },

  getName() {
    if (!this.user) return 'Técnico';
    return this.user.user_metadata?.nome || this.user.email?.split('@')[0] || 'Técnico';
  }
};
