// ============================================================
// sync.js — Motor de sincronização offline → Supabase
// ============================================================

const Sync = {
  isOnline: false,
  isSyncing: false,
  listeners: [],

  init() {
    this.isOnline = navigator.onLine;
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateUI();
      this.syncAll();
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateUI();
    });
    // Tenta sync ao iniciar
    if (this.isOnline) setTimeout(() => this.syncAll(), 2000);
    // Sync periódico a cada 3 minutos
    setInterval(() => { if (this.isOnline && !this.isSyncing) this.syncAll(); }, 180000);
    this.updateUI();
  },

  async updateUI() {
    const badge = document.getElementById('syncBadge');
    const dot = document.getElementById('syncDot');
    const text = document.getElementById('syncText');
    if (!badge) return;

    const count = await SyncQueue.count();
    const queueBadge = document.getElementById('queueBadge');

    if (this.isSyncing) {
      badge.className = 'sync-badge syncing';
      dot.className = 'sync-dot pulse';
      text.textContent = 'sincronizando...';
    } else if (!this.isOnline) {
      badge.className = 'sync-badge';
      dot.className = 'sync-dot pulse';
      text.textContent = count > 0 ? `${count} offline` : 'sem conexão';
    } else {
      badge.className = 'sync-badge online';
      dot.className = 'sync-dot';
      text.textContent = count > 0 ? `${count} pendentes` : 'online ✓';
    }

    if (queueBadge) {
      if (count > 0) { queueBadge.style.display = ''; queueBadge.textContent = count; }
      else queueBadge.style.display = 'none';
    }

    this.listeners.forEach(fn => fn({ online: this.isOnline, count, syncing: this.isSyncing }));
  },

  onChange(fn) { this.listeners.push(fn); },

  async syncAll() {
    if (this.isSyncing || !this.isOnline) return;
    const queue = await SyncQueue.getAll();
    if (queue.length === 0) return;

    this.isSyncing = true;
    this.updateUI();

    let ok = 0;
    for (const item of queue) {
      try {
        await this._syncItem(item);
        await SyncQueue.remove(item.id);
        ok++;
        this.updateUI();
      } catch (err) {
        console.warn('Sync falhou para item', item.id, err);
      }
    }

    this.isSyncing = false;
    this.updateUI();
    if (ok > 0) showToast(`${ok} registro${ok > 1 ? 's' : ''} sincronizado${ok > 1 ? 's' : ''}! ✓`, 'success');
  },

  async _syncItem(item) {
    if (item.tipo === 'poste') {
      const d = item.dados;
      const payload = {
        barramento: d.barramento,
        latitude: d.latitude,
        longitude: d.longitude,
        logradouro: d.logradouro,
        bairro: d.bairro,
        municipio: d.municipio,
        estado: d.estado,
        cep: d.cep,
        usuario_email: Auth.user?.email || 'desconhecido',
        usuario_nome: Auth.getName(),
        created_at: d.created_at
      };
      const { data, error } = await supabaseClient.from('postes').insert(payload).select().single();
      if (error) throw error;
      await PosteDB.markSynced(d.id, data.id);
    } else if (item.tipo === 'provedor') {
      const d = item.dados;
      // Resolve remote_id do poste pai se existir
      const poste = await PosteDB.getById(d.poste_id);
      const payload = {
        poste_id: poste?.remote_id || d.poste_id,
        nome: d.nome,
        tipo: d.tipo || '',
        created_at: d.created_at
      };
      const { error } = await supabaseClient.from('provedores').insert(payload);
      if (error) throw error;
      await ProvDB.markSynced(d.id);
    }
  }
};
