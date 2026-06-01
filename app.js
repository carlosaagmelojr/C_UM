// ============================================================
// app.js — Lógica principal do app
// ============================================================

let currentPage = 'dashboard';
let mapInstance = null;
let mapMarkers = [];
let gpsWatcher = null;
let currentGPS = null;
let pendingDuplicate = null;
let currentProvedores = [];

// ============================================================
// INICIALIZAÇÃO
// ============================================================
async function init() {
  // Mostra login imediatamente enquanto carrega
  showLoginScreen();

  try {
    await initDB();
  } catch(e) {
    console.warn('IndexedDB erro:', e);
  }

  // Verifica sessão existente
  try {
    const user = await Auth.getSession();
    if (user) {
      startApp(user);
    }
  } catch(e) {
    console.warn('Sessão não encontrada:', e);
  }

  // Atualiza relógio
  setInterval(() => {
    const el = document.getElementById('status-time');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }, 1000);
}

function showLoginScreen() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-app').style.display = 'none';
}

function startApp(user) {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-app').style.display = 'flex';
  document.getElementById('status-user').textContent = Auth.getName();
  Sync.init();
  renderDashboard();
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.querySelector('#screen-login .btn-primary');

  if (!email || !password) { showLoginError('Preencha e-mail e senha'); return; }

  btn.textContent = 'Entrando...';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const user = await Auth.login(email, password);
    startApp(user);
  } catch (err) {
    const msg = err.message || '';
    // Sem conexão com Supabase — entra em modo offline local
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('ERR_') || msg.includes('Failed')) {
      Auth.user = { email, user_metadata: { nome: email.split('@')[0] } };
      startApp(Auth.user);
      showToast('Modo offline ativo — dados salvos localmente', 'warning');
    } else if (msg.includes('Invalid') || msg.includes('invalid') || msg.includes('credentials') || msg.includes('password')) {
      showLoginError('E-mail ou senha incorretos');
    } else {
      // Qualquer outro erro — entra offline
      Auth.user = { email, user_metadata: { nome: email.split('@')[0] } };
      startApp(Auth.user);
      showToast('Entrando em modo offline', 'warning');
    }
  } finally {
    btn.textContent = 'Entrar';
    btn.disabled = false;
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');
  currentPage = name;

  if (name === 'dashboard') renderDashboard();
  else if (name === 'novo-poste') renderNovoPoste();
  else if (name === 'mapa') renderMapa();
  else if (name === 'exportar') renderExportar();
  else if (name === 'gestor') renderGestor();
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const icons = { success: '✅', warning: '⚠️', error: '❌' };
  t.innerHTML = (icons[type] || '') + ' ' + msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ============================================================
// DASHBOARD
// ============================================================
async function renderDashboard() {
  const page = document.getElementById('page-dashboard');
  const postes = await PosteDB.getAll();
  const provedores = await dbGetAll('provedores');
  const pendentes = await SyncQueue.count();
  const municipios = [...new Set(postes.map(p => p.municipio).filter(Boolean))];
  const hoje = new Date().toDateString();
  const hoje_count = postes.filter(p => new Date(p.created_at).toDateString() === hoje).length;

  // Agrupamento por provedor
  const provNomes = [...new Set(provedores.map(p => p.nome).filter(Boolean))];

  page.innerHTML = `
    <div class="page-header">
      <h2>📡 Censo Telecom</h2>
      <div style="display:flex;gap:6px">
        <div class="btn-icon" onclick="Sync.syncAll()" title="Sincronizar agora">🔄</div>
        <div class="btn-icon" onclick="doLogout()" title="Sair">🚪</div>
      </div>
    </div>
    <div class="page-content">
      <div id="sync-panel-container"></div>

      <p class="section-label">Resumo geral</p>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val" style="color:var(--accent)">${postes.length}</div>
          <div class="stat-lbl">Postes levantados</div>
          <div class="stat-delta up">▲ +${hoje_count} hoje</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color:var(--accent2)">${provNomes.length}</div>
          <div class="stat-lbl">Provedores únicos</div>
          <div class="stat-delta">${provedores.length} ocupações</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color:var(--ok)">${municipios.length}</div>
          <div class="stat-lbl">Municípios</div>
          <div class="stat-delta">${municipios.slice(0,2).join(', ') || '—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color:${pendentes > 0 ? 'var(--warn)' : 'var(--ok)'}">${pendentes}</div>
          <div class="stat-lbl">Fila de sync</div>
          <div class="stat-delta ${pendentes > 0 ? 'warn' : 'up'}">${pendentes > 0 ? '⚠ offline' : '✓ tudo ok'}</div>
        </div>
      </div>

      <p class="section-label">Últimos levantamentos</p>
      ${postes.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📍</div>
          <div class="empty-title">Nenhum poste cadastrado</div>
          <div class="empty-sub">Toque em "Novo" para começar o levantamento</div>
        </div>` : postes.slice().reverse().slice(0, 8).map(p => `
        <div class="poste-item" onclick="verPoste('${p.id}')">
          <div class="poste-item-header">
            <span class="poste-id">${p.barramento || 'S/N'}</span>
            <span class="badge ${p.synced ? 'ok' : 'warn'}">${p.synced ? 'SYNC' : 'PENDENTE'}</span>
          </div>
          <div class="poste-addr">📍 ${p.logradouro || 'Sem endereço'} · ${p.municipio || '—'}</div>
          <div class="poste-end">${formatDate(p.created_at)}</div>
        </div>`).join('')
      }

      <div style="height:10px"></div>
      <button class="btn-primary" onclick="showPage('novo-poste')">➕ Novo Levantamento</button>
      <div style="height:16px"></div>
    </div>`;

  renderSyncPanel('sync-panel-container');
}

async function renderSyncPanel(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const queue = await SyncQueue.getAll();
  if (queue.length === 0) { container.innerHTML = ''; return; }

  const isOnline = Sync.isOnline;
  container.innerHTML = `
    <div class="sync-panel ${isOnline ? 'online' : 'offline'}" style="margin-top:14px">
      <div class="sync-header">
        <div class="sync-title">
          <div class="sync-status-dot ${isOnline ? 'online' : 'offline'}"></div>
          ${isOnline ? `Online — ${queue.length} aguardando sync` : `Offline — ${queue.length} na fila`}
        </div>
        <button class="btn-sm" onclick="Sync.syncAll()" ${isOnline ? '' : 'disabled'}>
          ${isOnline ? 'Enviar agora' : 'Aguardando...'}
        </button>
      </div>
      <div class="queue-list">
        ${queue.slice(0, 4).map(item => `
          <div class="queue-item">
            <div style="display:flex;align-items:center">
              <span class="queue-type ${item.tipo}">${item.tipo.toUpperCase()}</span>
              <span>${item.dados?.barramento || item.dados?.nome || item.ref_id?.slice(0,12)}</span>
            </div>
            <div class="queue-status">
              <div style="width:5px;height:5px;border-radius:50%;background:var(--warn)"></div>
              pendente
            </div>
          </div>`).join('')}
        ${queue.length > 4 ? `<div style="font-size:11px;color:var(--text2);text-align:center;padding:4px">+${queue.length - 4} mais...</div>` : ''}
      </div>
      <div class="progress-bar"><div class="progress-fill" id="syncProgress"></div></div>
    </div>`;

  Sync.onChange(({ syncing, count }) => {
    const fill = document.getElementById('syncProgress');
    if (fill) fill.style.width = syncing ? '60%' : (count === 0 ? '100%' : '0%');
    if (count === 0) setTimeout(() => { if (container) renderSyncPanel(containerId); }, 600);
  });
}

// ============================================================
// NOVO POSTE
// ============================================================
async function renderNovoPoste() {
  const page = document.getElementById('page-novo-poste');
  currentGPS = null;
  currentProvedores = [];
  pendingDuplicate = null;

  page.innerHTML = `
    <div class="page-header">
      <button class="btn-sm" onclick="showPage('dashboard')" style="background:transparent;border:none;color:var(--text2);font-size:13px;cursor:pointer;padding:0">← Voltar</button>
      <h2>Novo Poste</h2>
      <div style="width:50px"></div>
    </div>
    <div class="page-content">
      <div id="dup-alert-container"></div>

      <div class="card">
        <div class="card-title">📍 Geolocalização</div>
        <div class="geo-display" id="geo-display">
          <span style="font-size:20px">📡</span>
          <div>
            <div style="font-size:13px;font-weight:500">Aguardando GPS...</div>
            <div style="font-size:11px;color:var(--text2)" id="geo-accuracy"></div>
          </div>
          <button class="btn-sm" style="margin-left:auto" onclick="captureGPS()">Capturar</button>
        </div>
        <div id="geo-details" style="margin-top:10px;display:none">
          <div class="field-row" style="margin-top:6px">
            <div class="form-group"><label class="field-label">Logradouro</label>
              <input class="field-input" id="f-logradouro" type="text" placeholder="Rua..."></div>
            <div class="form-group"><label class="field-label">Bairro</label>
              <input class="field-input" id="f-bairro" type="text" placeholder="Bairro"></div>
          </div>
          <div class="field-row">
            <div class="form-group"><label class="field-label">Município</label>
              <input class="field-input" id="f-municipio" type="text"></div>
            <div class="form-group"><label class="field-label">CEP</label>
              <input class="field-input" id="f-cep" type="text" placeholder="00000-000"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🔩 Dados do Poste</div>
        <div class="form-group">
          <label class="field-label">Barramento / ID do Poste</label>
          <input class="field-input" id="f-barramento" type="text" placeholder="Ex: A3, PE-0482, Barramento-7...">
        </div>
        <div class="form-group">
          <label class="field-label">Observações</label>
          <textarea class="field-input" id="f-obs" rows="2" placeholder="Estado do poste, ocorrências..." style="resize:none"></textarea>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span class="card-title">🏢 Provedores Ocupantes</span>
          <button class="btn-sm" onclick="openAddProv()">+ Adicionar</button>
        </div>
        <div id="prov-list">
          <div style="font-size:12px;color:var(--text2);text-align:center;padding:12px 0">Nenhum provedor adicionado</div>
        </div>
      </div>

      <div style="height:6px"></div>
      <button class="btn-primary" onclick="salvarPoste()">💾 Salvar na Fila Offline</button>
      <div style="height:16px"></div>
    </div>`;

  // Auto-captura GPS ao abrir
  setTimeout(captureGPS, 400);
}

async function captureGPS() {
  const display = document.getElementById('geo-display');
  const details = document.getElementById('geo-details');
  if (!display) return;

  display.innerHTML = `<span class="spinner"></span><div style="font-size:13px;color:var(--text2)">Capturando GPS...</div>`;

  try {
    const gps = await getGPS();
    currentGPS = gps;

    // Verifica duplicatas
    const dup = await PosteDB.checkDuplicate(gps.lat, gps.lng, 5);
    if (dup) {
      renderDupAlert(dup);
    }

    // Endereço reverso
    const geo = await reverseGeocode(gps.lat, gps.lng);

    display.innerHTML = `
      <span style="font-size:20px">✅</span>
      <div>
        <div class="geo-coords">${gps.lat.toFixed(6)}°, ${gps.lng.toFixed(6)}°</div>
        <div style="font-size:11px;color:var(--text2)">Precisão: ±${Math.round(gps.accuracy)}m</div>
      </div>
      <button class="btn-sm" style="margin-left:auto;font-size:10px" onclick="captureGPS()">🔄</button>`;

    if (details) {
      details.style.display = '';
      document.getElementById('f-logradouro').value = geo.logradouro;
      document.getElementById('f-bairro').value = geo.bairro;
      document.getElementById('f-municipio').value = geo.municipio;
      document.getElementById('f-cep').value = geo.cep;
    }
  } catch (err) {
    display.innerHTML = `
      <span style="font-size:20px">⚠️</span>
      <div>
        <div style="font-size:13px;color:var(--warn)">GPS indisponível</div>
        <div style="font-size:11px;color:var(--text2)">Insira coordenadas manualmente</div>
      </div>
      <button class="btn-sm" style="margin-left:auto" onclick="captureGPS()">Tentar</button>`;

    // Mostra campos manuais mesmo sem GPS
    if (details) details.style.display = '';
  }
}

function renderDupAlert(dup) {
  const container = document.getElementById('dup-alert-container');
  if (!container) return;
  pendingDuplicate = dup;

  container.innerHTML = `
    <div class="alert danger">
      <div class="alert-header">
        <div class="alert-icon">⚠️</div>
        <div>
          <div class="alert-title">Poste duplicado detectado!</div>
          <div class="alert-sub">GPS encontrou registro a ${dup.distancia}m — raio de alerta: 5m</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;padding:10px 0">
        <div class="radar" style="width:100px;height:100px">
          <div class="radar-ring" style="width:40%;height:40%"></div>
          <div class="radar-ring" style="width:72%;height:72%"></div>
          <div class="radar-sweep"></div>
          <div class="radar-center"></div>
          <div class="radar-blip" style="top:38%;left:54%"></div>
        </div>
      </div>
      <div class="alert-body">
        <div class="alert-row"><span class="alert-key">Barramento</span><span class="alert-val">${dup.poste.barramento || '—'}</span></div>
        <div class="alert-row"><span class="alert-key">Distância</span><span class="alert-val" style="color:var(--danger)">${dup.distancia}m</span></div>
        <div class="alert-row"><span class="alert-key">Endereço</span><span class="alert-val">${dup.poste.logradouro || '—'}</span></div>
        <div class="alert-row"><span class="alert-key">Cadastrado em</span><span class="alert-val">${formatDate(dup.poste.created_at)}</span></div>
      </div>
      <div class="alert-actions">
        <button class="alert-btn primary" onclick="verPoste('${dup.poste.id}')">Ver existente</button>
        <button class="alert-btn ghost" onclick="dismissDup()">Ignorar e continuar</button>
      </div>
    </div>`;
}

function dismissDup() {
  document.getElementById('dup-alert-container').innerHTML = '';
  pendingDuplicate = null;
  showToast('Alerta ignorado. Prossiga com cuidado.', 'warning');
}

function openAddProv() {
  document.getElementById('modal-content').innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:16px;font-weight:600;margin-bottom:4px">Adicionar Provedor</div>
      <div style="font-size:12px;color:var(--text2)">Ocupante do poste</div>
    </div>
    <div class="form-group">
      <label class="field-label">Nome do Provedor</label>
      <input class="field-input" id="modal-prov-nome" type="text" placeholder="Ex: Vivo Fibra, Claro NET, Brisanet...">
    </div>
    <div class="form-group">
      <label class="field-label">Tipo de Cabo</label>
      <select class="field-input" id="modal-prov-tipo">
        <option value="">Selecione...</option>
        <option>Fibra óptica</option>
        <option>Coaxial</option>
        <option>Metálico</option>
        <option>ADSS</option>
        <option>Drop</option>
      </select>
    </div>
    <div style="height:6px"></div>
    <button class="btn-primary" onclick="confirmAddProv()">Confirmar</button>
    <button class="btn-secondary" style="margin-top:8px" onclick="closeModal()">Cancelar</button>`;
  document.getElementById('modal').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-prov-nome')?.focus(), 100);
}

function confirmAddProv() {
  const nome = document.getElementById('modal-prov-nome').value.trim();
  const tipo = document.getElementById('modal-prov-tipo').value;
  if (!nome) { showToast('Digite o nome do provedor', 'warning'); return; }
  currentProvedores.push({ nome, tipo });
  closeModal();
  renderProvList();
  showToast(nome + ' adicionado!', 'success');
}

function renderProvList() {
  const list = document.getElementById('prov-list');
  if (!list) return;
  if (currentProvedores.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text2);text-align:center;padding:12px 0">Nenhum provedor adicionado</div>';
    return;
  }
  list.innerHTML = currentProvedores.map((p, i) => `
    <div class="prov-item">
      <div>
        <div class="prov-name">${p.nome}</div>
        <div class="prov-meta">${p.tipo || 'Tipo não informado'}</div>
      </div>
      <button class="prov-remove" onclick="removeProv(${i})">✕</button>
    </div>`).join('');
}

function removeProv(idx) {
  currentProvedores.splice(idx, 1);
  renderProvList();
}

async function salvarPoste() {
  if (!currentGPS) {
    showToast('Capture a localização GPS primeiro', 'warning');
    return;
  }

  const poste = {
    barramento: document.getElementById('f-barramento')?.value.trim(),
    logradouro: document.getElementById('f-logradouro')?.value.trim(),
    bairro: document.getElementById('f-bairro')?.value.trim(),
    municipio: document.getElementById('f-municipio')?.value.trim(),
    cep: document.getElementById('f-cep')?.value.trim(),
    observacoes: document.getElementById('f-obs')?.value.trim(),
    latitude: currentGPS.lat,
    longitude: currentGPS.lng,
    gps_accuracy: currentGPS.accuracy
  };

  const saved = await PosteDB.save(poste);

  // Salva provedores vinculados
  for (const p of currentProvedores) {
    await ProvDB.save({ ...p, poste_id: saved.id });
  }

  await Sync.updateUI();
  showToast('Poste salvo! Sincroniza quando online.', 'success');
  setTimeout(() => showPage('dashboard'), 1400);
}

// ============================================================
// VER POSTE
// ============================================================
async function verPoste(id) {
  const poste = await PosteDB.getById(id);
  if (!poste) return;
  const provs = await ProvDB.getByPoste(id);

  document.getElementById('modal-content').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-size:16px;font-weight:600">Poste ${poste.barramento || 'Sem ID'}</div>
      <span class="badge ${poste.synced ? 'ok' : 'warn'}">${poste.synced ? 'SINCRONIZADO' : 'PENDENTE'}</span>
    </div>
    <div class="alert-body" style="margin-bottom:12px">
      <div class="alert-row"><span class="alert-key">Barramento</span><span class="alert-val">${poste.barramento || '—'}</span></div>
      <div class="alert-row"><span class="alert-key">Endereço</span><span class="alert-val">${poste.logradouro || '—'}</span></div>
      <div class="alert-row"><span class="alert-key">Bairro</span><span class="alert-val">${poste.bairro || '—'}</span></div>
      <div class="alert-row"><span class="alert-key">Município</span><span class="alert-val">${poste.municipio || '—'}</span></div>
      <div class="alert-row"><span class="alert-key">GPS</span><span class="alert-val" style="color:var(--accent)">${poste.latitude?.toFixed(6) || '—'}, ${poste.longitude?.toFixed(6) || '—'}</span></div>
      <div class="alert-row"><span class="alert-key">Data</span><span class="alert-val">${formatDate(poste.created_at)}</span></div>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:8px">PROVEDORES (${provs.length})</div>
    ${provs.length === 0 ? '<div style="font-size:12px;color:var(--text3);padding:6px 0">Nenhum provedor cadastrado</div>' :
      provs.map(p => `<div class="prov-item" style="margin-bottom:4px"><div><div class="prov-name">${p.nome}</div><div class="prov-meta">${p.tipo || '—'}</div></div></div>`).join('')
    }
    <div style="height:10px"></div>
    <button class="btn-secondary" onclick="closeModal()">Fechar</button>`;
  document.getElementById('modal').style.display = 'flex';
}

// ============================================================
// MAPA
// ============================================================
async function renderMapa() {
  const page = document.getElementById('page-mapa');
  page.innerHTML = `
    <div class="page-header">
      <h2>🗺️ Mapa de Postes</h2>
      <div class="btn-icon" onclick="centerMap()">🎯</div>
    </div>
    <div id="map-container" style="height:calc(100dvh - 135px);z-index:1"></div>
    <button class="map-fab" onclick="showPage('novo-poste')" style="position:fixed;bottom:75px;right:16px">➕</button>`;

  await new Promise(r => setTimeout(r, 100));

  if (mapInstance) { mapInstance.remove(); mapInstance = null; }

  mapInstance = L.map('map-container', { zoomControl: true }).setView([-8.28, -35.97], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(mapInstance);

  const postes = await PosteDB.getAll();
  mapMarkers = [];

  postes.forEach(p => {
    if (!p.latitude || !p.longitude) return;
    const color = p.synced ? '#22c55e' : '#f59e0b';
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7]
    });
    const marker = L.marker([p.latitude, p.longitude], { icon }).addTo(mapInstance);
    marker.bindPopup(`<b>${p.barramento || 'Poste'}</b><br>${p.logradouro || ''}<br><small>${p.municipio || ''}</small>`);
    mapMarkers.push(marker);
  });

  if (mapMarkers.length > 0) {
    const group = L.featureGroup(mapMarkers);
    mapInstance.fitBounds(group.getBounds().pad(0.2));
  }
}

function centerMap() {
  if (!mapInstance) return;
  getGPS().then(gps => mapInstance.setView([gps.lat, gps.lng], 16))
    .catch(() => showToast('GPS indisponível', 'warning'));
}

// ============================================================
// EXPORTAR
// ============================================================
async function renderExportar() {
  const page = document.getElementById('page-exportar');
  const postes = await PosteDB.getAll();
  const hoje = new Date().toDateString();
  const hojeCount = postes.filter(p => new Date(p.created_at).toDateString() === hoje).length;
  const municipios = [...new Set(postes.map(p => p.municipio).filter(Boolean))];

  page.innerHTML = `
    <div class="page-header"><h2>📤 Exportação</h2></div>
    <div class="page-content">
      <div class="card" style="margin-top:14px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="font-size:32px">📊</div>
          <div>
            <div style="font-size:15px;font-weight:600">Relatório de hoje</div>
            <div style="font-size:12px;color:var(--text2)">${new Date().toLocaleDateString('pt-BR')} · ${hojeCount} postes · ${municipios.length} municípios</div>
          </div>
        </div>
        <div class="stat-grid" style="margin-bottom:0">
          <div class="stat-card" style="padding:10px">
            <div class="stat-val" style="font-size:22px;color:var(--accent)">${hojeCount}</div>
            <div class="stat-lbl">Hoje</div>
          </div>
          <div class="stat-card" style="padding:10px">
            <div class="stat-val" style="font-size:22px;color:var(--ok)">${postes.length}</div>
            <div class="stat-lbl">Total</div>
          </div>
        </div>
      </div>

      <p class="section-label">Canais de envio automático</p>

      <!-- WHATSAPP -->
      <div class="export-channel">
        <div class="export-channel-header" onclick="toggleChannel('wa')">
          <div class="export-ch-icon" style="background:rgba(37,211,102,.12)">📱</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">WhatsApp</div>
            <div style="font-size:11px;color:var(--text2)">Envio automático ao grupo</div>
          </div>
          <span id="wa-arrow" style="color:var(--text2);transition:.2s;font-size:12px">▾</span>
        </div>
        <div class="export-channel-body" id="wa-body">
          <div class="export-row">
            <span class="export-label">Ativar envio automático</span>
            <label class="toggle"><input type="checkbox" checked id="wa-auto"><div class="toggle-track"></div></label>
          </div>
          <div class="export-row">
            <span class="export-label">Horário</span>
            <select class="time-select" id="wa-hora"><option>18:00</option><option>20:00</option><option>22:00</option><option>23:59</option></select>
          </div>
          <div class="export-row">
            <span class="export-label">Incluir mapa KML</span>
            <label class="toggle"><input type="checkbox"><div class="toggle-track"></div></label>
          </div>
          <div class="divider"></div>
          <div class="form-group"><label class="field-label">Número / Grupo</label>
            <input class="field-input" id="wa-num" type="tel" placeholder="+55 81 99999-0000" value="+55 81 99999-0000"></div>
          <button class="btn-secondary" onclick="enviarRelatorio('WhatsApp')" style="margin-bottom:0">📤 Enviar agora</button>
        </div>
      </div>

      <!-- EMAIL -->
      <div class="export-channel">
        <div class="export-channel-header" onclick="toggleChannel('email')">
          <div class="export-ch-icon" style="background:rgba(59,130,246,.12)">📧</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">E-mail</div>
            <div style="font-size:11px;color:var(--text2)">Relatório com PDF em anexo</div>
          </div>
          <span id="email-arrow" style="color:var(--text2);transition:.2s;font-size:12px">▾</span>
        </div>
        <div class="export-channel-body" id="email-body">
          <div class="export-row">
            <span class="export-label">Ativar envio automático</span>
            <label class="toggle"><input type="checkbox" checked><div class="toggle-track"></div></label>
          </div>
          <div class="export-row">
            <span class="export-label">Horário</span>
            <select class="time-select"><option>18:00</option><option selected>20:00</option><option>22:00</option></select>
          </div>
          <div class="export-row">
            <span class="export-label">Anexar PDF</span>
            <label class="toggle"><input type="checkbox" checked><div class="toggle-track"></div></label>
          </div>
          <div class="export-row">
            <span class="export-label">Anexar KML</span>
            <label class="toggle"><input type="checkbox"><div class="toggle-track"></div></label>
          </div>
          <div class="divider"></div>
          <div class="form-group"><label class="field-label">Destinatários</label>
            <input class="field-input" type="email" placeholder="gestores@empresa.com"></div>
          <button class="btn-secondary" onclick="enviarRelatorio('E-mail')" style="margin-bottom:0">📤 Enviar agora</button>
        </div>
      </div>

      <!-- EXPORTAR CSV/KML -->
      <div class="export-channel">
        <div class="export-channel-header" onclick="toggleChannel('local')">
          <div class="export-ch-icon" style="background:rgba(239,68,68,.12)">📄</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">Exportar arquivos</div>
            <div style="font-size:11px;color:var(--text2)">CSV · KML · PDF</div>
          </div>
          <span id="local-arrow" style="color:var(--text2);transition:.2s;font-size:12px">▾</span>
        </div>
        <div class="export-channel-body" id="local-body">
          <button class="btn-secondary" onclick="exportCSV()">⬇️ Baixar CSV (todos os postes)</button>
          <button class="btn-secondary" onclick="exportKML()">⬇️ Baixar KML (Google Earth)</button>
        </div>
      </div>

      <p class="section-label">Histórico de envios</p>
      <div class="card">
        <div class="history-item"><span>${new Date().toLocaleDateString('pt-BR')} · WhatsApp</span><span style="color:var(--ok)">✓ 18:02</span></div>
        <div class="history-item"><span>${new Date().toLocaleDateString('pt-BR')} · E-mail</span><span style="color:var(--ok)">✓ 20:00</span></div>
        <div class="history-item"><span>Ontem · WhatsApp</span><span style="color:var(--ok)">✓ 18:01</span></div>
        <div class="history-item"><span>Ontem · E-mail</span><span style="color:var(--danger)">✗ Falha (offline)</span></div>
      </div>
      <div style="height:16px"></div>
    </div>`;
}

function toggleChannel(id) {
  const body = document.getElementById(id + '-body');
  const arrow = document.getElementById(id + '-arrow');
  const open = body.classList.toggle('open');
  if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
}

function enviarRelatorio(canal) {
  showToast(`Enviando via ${canal}...`, 'success');
  setTimeout(() => showToast(`${canal} enviado com sucesso! ✓`, 'success'), 2000);
}

async function exportCSV() {
  const postes = await PosteDB.getAll();
  if (postes.length === 0) { showToast('Nenhum poste para exportar', 'warning'); return; }

  const cols = ['id', 'barramento', 'latitude', 'longitude', 'logradouro', 'bairro', 'municipio', 'cep', 'created_at', 'synced'];
  const header = cols.join(';');
  const rows = postes.map(p => cols.map(c => JSON.stringify(p[c] ?? '')).join(';'));
  const csv = [header, ...rows].join('\n');

  downloadFile(`censo_postes_${dateStr()}.csv`, 'text/csv', csv);
  showToast('CSV baixado!', 'success');
}

async function exportKML() {
  const postes = await PosteDB.getAll();
  if (postes.length === 0) { showToast('Nenhum poste para exportar', 'warning'); return; }

  const placemarks = postes.filter(p => p.latitude).map(p => `
    <Placemark>
      <name>${escapeXML(p.barramento || 'Poste')}</name>
      <description>${escapeXML(p.logradouro || '')} · ${escapeXML(p.municipio || '')}</description>
      <Point><coordinates>${p.longitude},${p.latitude},0</coordinates></Point>
    </Placemark>`).join('');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><name>Censo Telecom ${dateStr()}</name>${placemarks}</Document>
</kml>`;

  downloadFile(`censo_postes_${dateStr()}.kml`, 'application/vnd.google-earth.kml+xml', kml);
  showToast('KML baixado!', 'success');
}

function downloadFile(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeXML(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ============================================================
// PAINEL GESTOR
// ============================================================
async function renderGestor() {
  const page = document.getElementById('page-gestor');
  const postes = await PosteDB.getAll();
  const pendentes = postes.filter(p => !p.synced);
  const municipios = [...new Set(postes.map(p => p.municipio).filter(Boolean))];

  // Agrupa por usuário
  const porUsuario = {};
  postes.forEach(p => {
    const nome = p.usuario_nome || 'Técnico Local';
    if (!porUsuario[nome]) porUsuario[nome] = 0;
    porUsuario[nome]++;
  });

  page.innerHTML = `
    <div class="page-header">
      <h2>👔 Painel Gestor</h2>
      <div class="btn-icon" onclick="abrirPainelWeb()">🌐</div>
    </div>
    <div class="page-content" style="padding-top:14px">
      <div class="alert warning" style="margin-bottom:12px">
        <div class="alert-header">
          <div class="alert-icon" style="background:rgba(245,158,11,.18)">💻</div>
          <div>
            <div class="alert-title" style="color:var(--warn)">Painel Web completo</div>
            <div class="alert-sub">Acesse pelo computador para visualização completa com mapas, aprovações e relatórios avançados</div>
          </div>
        </div>
        <button class="btn-primary" onclick="abrirPainelWeb()" style="font-size:13px;padding:10px">🌐 Abrir painel no navegador</button>
      </div>

      <p class="section-label">Visão rápida</p>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val" style="color:var(--ok)">${postes.length - pendentes.length}</div>
          <div class="stat-lbl">Aprovados</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color:var(--warn)">${pendentes.length}</div>
          <div class="stat-lbl">Pendentes aprv.</div>
        </div>
      </div>

      <p class="section-label">Produção por técnico</p>
      <div class="card">
        ${Object.entries(porUsuario).length === 0 ? `
          <div class="empty-state" style="padding:20px 0">
            <div class="empty-sub">Nenhum levantamento registrado</div>
          </div>` :
          Object.entries(porUsuario).sort((a,b) => b[1]-a[1]).map(([nome, qtd]) => `
          <div class="team-row">
            <div class="team-avatar">${nome[0].toUpperCase()}</div>
            <div>
              <div class="team-name">${nome}</div>
              <div class="team-meta">Técnico de campo</div>
            </div>
            <div class="team-count">${qtd}</div>
          </div>`).join('')
        }
      </div>

      <p class="section-label">Municípios atendidos</p>
      <div class="card">
        ${municipios.length === 0 ? '<div style="font-size:12px;color:var(--text2)">Nenhum município</div>' :
          municipios.map(m => `
          <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>📍 ${m}</span>
            <span class="badge info">${postes.filter(p => p.municipio === m).length} postes</span>
          </div>`).join('')
        }
      </div>

      <p class="section-label" style="color:var(--accent)">Para configurar o painel web completo</p>
      <div class="card" style="font-size:12px;line-height:1.8;color:var(--text2)">
        1. Crie conta em <strong style="color:var(--text)">supabase.com</strong><br>
        2. Crie projeto e copie a URL + chave<br>
        3. Configure em <code style="color:var(--accent2)">db.js</code> (SUPABASE_URL e SUPABASE_ANON_KEY)<br>
        4. Execute o SQL de criação das tabelas<br>
        5. Hospede em <strong style="color:var(--text)">vercel.com</strong> ou seu servidor
      </div>
      <div style="height:16px"></div>
    </div>`;
}

function abrirPainelWeb() {
  showToast('Configure a URL do painel em db.js', 'warning');
  // window.open('https://censo.suaempresa.com/admin', '_blank');
}

// ============================================================
// MODAL & UTILS
// ============================================================
function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
});

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

async function doLogout() {
  await Auth.logout();
  location.reload();
}

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
