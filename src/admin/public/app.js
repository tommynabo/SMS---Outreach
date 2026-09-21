const API = '/admin/api';

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.warning || `HTTP ${res.status}`);
  }
  return res.json();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Tabs & URL routing ----------
// Each tab has a distinct, bookmarkable /admin/<slug> URL. Dashboard is the root (/admin/).
const TAB_SLUGS = {
  dashboard: '',
  leads: 'importar-leads',
  contacts: 'contactos',
  kanban: 'kanban',
  queue: 'queue',
  campaigns: 'campanas',
  templates: 'mensajes',
  settings: 'ajustes',
  notifications: 'notificaciones',
  'execution-log': 'registro',
};
const SLUG_TO_TAB = Object.fromEntries(Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab]));

function activateTab(tab, { pushState = false } = {}) {
  if (!document.getElementById('tab-' + tab)) tab = 'dashboard';
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (pushState) {
    const slug = TAB_SLUGS[tab] ?? '';
    history.pushState({ tab }, '', '/admin/' + slug);
  }
  loadTab(tab);
}

function tabFromLocation() {
  const slug = location.pathname.replace(/^\/admin\/?/, '').replace(/\/$/, '');
  return SLUG_TO_TAB[slug] || 'dashboard';
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab, { pushState: true }));
});

window.addEventListener('popstate', () => activateTab(tabFromLocation()));

function loadTab(tab) {
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'contacts') loadContacts();
  if (tab === 'kanban') loadKanban();
  if (tab === 'queue') loadQueue();
  if (tab === 'campaigns') loadCampaigns();
  if (tab === 'templates') loadTemplates();
  if (tab === 'settings') loadSettings();
  if (tab === 'notifications') loadNotifications();
  if (tab === 'execution-log') loadExecutionLog();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const el = document.getElementById('dashboard-content');
  el.textContent = 'Loading...';
  try {
    const d = await api('/dashboard');
    const todayLabels = {
      attempted: 'Intentos',
      sent: 'Enviados reales',
      simulated: 'Simulados',
      delivered: 'Entregados',
      failed: 'Fallidos',
      stalled: 'Atascados',
      replies: 'Respuestas',
      optOuts: 'Bajas',
    };
    el.innerHTML = `
      <div class="cards">
        <div class="card"><h4>System</h4><div class="value"><span class="badge ${d.systemStatus}">${d.systemStatus}</span></div>${d.pauseReason ? `<div>${escapeHtml(d.pauseReason)}</div>` : ''}</div>
        <div class="card ${d.dryRun ? 'warning' : ''}"><h4>Modo simulación</h4><div class="value">${d.dryRun ? 'ACTIVO' : 'Inactivo'}</div></div>
        <div class="card"><h4>TextBee</h4><div class="value">${d.textbee.configured ? 'configured' : 'NOT configured'}</div></div>
      </div>
      ${d.contacts.pendingActivation > 0 ? `
        <div class="callout">
          <strong>${d.contacts.pendingActivation} contactos sin activar</strong> de un total de ${d.contacts.total}.
          No aparecerán en el Kanban ni recibirán mensajes hasta que se activen.
          <button type="button" id="dashboard-go-activate">Ir a Contacts para activarlos</button>
        </div>
      ` : ''}
      <h3>Resumen de contactos</h3>
      <div class="cards">
        <div class="card highlight"><h4>Total</h4><div class="value">${d.contacts.total}</div></div>
        <div class="card ${d.contacts.pendingActivation > 0 ? 'warning' : ''}"><h4>Pendientes de activar</h4><div class="value">${d.contacts.pendingActivation}</div></div>
        <div class="card"><h4>Ready</h4><div class="value">${d.contacts.ready}</div></div>
        <div class="card"><h4>Active</h4><div class="value">${d.contacts.active}</div></div>
        <div class="card"><h4>Replied</h4><div class="value">${d.contacts.replied}</div></div>
        <div class="card"><h4>Stopped</h4><div class="value">${d.contacts.stopped}</div></div>
        <div class="card"><h4>Completed</h4><div class="value">${d.contacts.completed}</div></div>
        <div class="card"><h4>Failed</h4><div class="value">${d.contacts.failed}</div></div>
      </div>
      <h3>Hoy</h3>
      <div class="cards">
        ${Object.entries(d.today).map(([k, v]) => `<div class="card"><h4>${todayLabels[k] || k}</h4><div class="value">${v}</div></div>`).join('')}
      </div>
      <h3>Cola de envíos</h3>
      <div class="cards">
        ${Object.entries(d.queue).map(([k, v]) => `<div class="card"><h4>${k}</h4><div class="value">${v}</div></div>`).join('')}
      </div>
      <h3>Próximos envíos estimados</h3>
      <table>
        <thead><tr><th>Hora estimada</th><th>Empresa</th><th>Mensaje</th></tr></thead>
        <tbody>
          ${d.upcoming.length ? d.upcoming.map((item) => `<tr><td>${new Date(item.plannedFor).toLocaleString()}</td><td>${escapeHtml(item.companyName || '-')}</td><td>${item.actionType}</td></tr>`).join('') : '<tr><td colspan="3">No hay mensajes pendientes</td></tr>'}
        </tbody>
      </table>
      <h3>Rendimiento por variante</h3>
      <table>
        <thead><tr><th>Variante</th><th>Contactos</th><th>Mensajes enviados</th><th>Respuestas</th><th>Tasa respuesta</th><th>Opt-outs</th></tr></thead>
        <tbody>
          ${Object.entries(d.variantStats).map(([variant, s]) => `
            <tr>
              <td><strong>${variant}</strong></td>
              <td>${s.totalContacts}</td>
              <td>${s.messagesSent}</td>
              <td>${s.replies}</td>
              <td>${s.replyRate !== null ? s.replyRate + '%' : '-'}</td>
              <td>${s.optOuts}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('dashboard-go-activate')?.addEventListener('click', () => activateTab('contacts', { pushState: true }));
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}

// ---------- Contacts ----------
async function populateBulkCampaignSelect() {
  const selectEl = document.getElementById('bulk-campaign-select');
  const campaigns = await getCampaignsCache();
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">Selecciona campaña (Activar/Enroll)</option>' + campaigns.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  selectEl.value = current;
}

function updateContactsSelectedCount() {
  const count = document.querySelectorAll('.contact-checkbox:checked').length;
  document.getElementById('contacts-selected-count').textContent = count > 0 ? `${count} seleccionados` : '';
}

async function loadContacts() {
  const el = document.getElementById('contacts-table');
  const status = document.getElementById('contacts-status-filter').value;
  const search = document.getElementById('contacts-search').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  params.set('pageSize', '1000');
  try {
    const data = await api('/contacts?' + params.toString());
    el.innerHTML = `
      <table>
        <thead><tr><th><input type="checkbox" id="select-all" /></th><th>Company</th><th>Phone</th><th>Variant</th><th>Status</th><th>Tags</th><th>Last outbound</th><th>Last inbound</th></tr></thead>
        <tbody>
          ${data.items.map((c) => `
            <tr class="contact-row" data-id="${c.id}">
              <td><input type="checkbox" class="contact-checkbox" value="${c.id}" /></td>
              <td>${escapeHtml(c.companyName)}</td>
              <td>${escapeHtml(c.phoneE164)}</td>
              <td>${escapeHtml(c.outreachVariant)}</td>
              <td><span class="badge ${c.outreachStatus}">${c.outreachStatus}</span></td>
              <td>${c.tags.map((t) => t.tag).join(', ')}</td>
              <td>${c.lastOutboundAt ? new Date(c.lastOutboundAt).toLocaleString() : ''}</td>
              <td>${c.lastInboundAt ? new Date(c.lastInboundAt).toLocaleString() : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p>${data.total} contactos</p>
    `;
    document.getElementById('select-all').addEventListener('change', (e) => {
      document.querySelectorAll('.contact-checkbox').forEach((cb) => (cb.checked = e.target.checked));
      updateContactsSelectedCount();
    });
    document.querySelectorAll('.contact-checkbox').forEach((cb) => {
      cb.addEventListener('change', updateContactsSelectedCount);
      cb.addEventListener('click', (ev) => ev.stopPropagation());
    });
    document.querySelectorAll('.contact-row').forEach((row) => {
      row.addEventListener('click', () => openContactModal(row.dataset.id));
    });
    updateContactsSelectedCount();
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}

document.getElementById('contacts-refresh').addEventListener('click', loadContacts);

document.getElementById('bulk-apply').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.contact-checkbox:checked')).map((cb) => cb.value);
  if (ids.length === 0) return alert('Selecciona al menos un contacto');
  const action = document.getElementById('bulk-action').value;
  const campaignId = document.getElementById('bulk-campaign-select').value || undefined;
  try {
    const res = await api('/contacts/bulk', { method: 'POST', body: JSON.stringify({ contactIds: ids, action, campaignId }) });
    alert('Aplicado: ' + JSON.stringify(res.results.filter((r) => !r.ok)));
    loadContacts();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

document.getElementById('contacts-delete-selected').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.contact-checkbox:checked')).map((cb) => cb.value);
  if (ids.length === 0) return alert('Selecciona al menos un contacto');
  if (!confirm(`¿Eliminar ${ids.length} contacto(s) de forma permanente? Esta acción no se puede deshacer.`)) return;
  try {
    await api('/contacts/bulk', { method: 'POST', body: JSON.stringify({ contactIds: ids, action: 'DELETE' }) });
    loadContacts();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// ---------- Kanban shared helpers ----------
const STAGE_LABELS = {
  NUEVO_PROSPECTO: 'Nuevo prospecto',
  SMS_ENVIADO: 'Enviado',
  RESPONDIO: 'Respondido',
  REUNION_AGENDADA: 'Llamada agendada',
  NO_INTERESADO: 'Descartado',
};
const STAGE_ORDER = ['NUEVO_PROSPECTO', 'SMS_ENVIADO', 'RESPONDIO', 'REUNION_AGENDADA', 'NO_INTERESADO'];
const STAGE_COLORS = {
  NUEVO_PROSPECTO: '#2545b8',
  SMS_ENVIADO: '#4338ca',
  RESPONDIO: '#1a7a2e',
  REUNION_AGENDADA: '#9a5b00',
  NO_INTERESADO: '#a11414',
};
const AVATAR_PALETTE = ['#4f5bd5', '#e0637e', '#2fa88a', '#d68a2b', '#7a5cd6', '#2f9bd6'];
function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function colorFor(name) {
  const str = String(name || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

let campaignsCache = null;
async function getCampaignsCache() {
  if (!campaignsCache) campaignsCache = (await api('/campaigns')).campaigns;
  return campaignsCache;
}

async function populateCampaignFilter(selectEl) {
  const campaigns = await getCampaignsCache();
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">Todas las campañas</option>' + campaigns.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  selectEl.value = current;
}

// ---------- Contact detail modal (shared by Contacts table & Kanban) ----------
async function openContactModal(contactId) {
  const overlay = document.getElementById('contact-modal');
  const body = document.getElementById('contact-modal-body');
  overlay.classList.remove('hidden');
  body.innerHTML = 'Loading...';
  try {
    const [contact, messages] = await Promise.all([
      api(`/contacts/${contactId}`),
      api(`/contacts/${contactId}/messages`),
    ]);
    const c = contact.contact || contact;
    const customFields = c.customFields && typeof c.customFields === 'object' ? Object.entries(c.customFields) : [];
    body.innerHTML = `
      <h3>${escapeHtml(c.companyName || c.name || 'Sin nombre')}</h3>
      <p><strong>Teléfono:</strong> ${escapeHtml(c.phoneE164)} &nbsp; <strong>Estado:</strong> <span class="badge ${c.outreachStatus}">${c.outreachStatus}</span> &nbsp; <strong>Variante:</strong> ${escapeHtml(c.outreachVariant || '')}</p>
      <p><strong>Ciudad:</strong> ${escapeHtml(c.city || '')} &nbsp; <strong>Categoría:</strong> ${escapeHtml(c.category || '')}</p>
      <p><strong>Tags:</strong> ${(c.tags || []).map((t) => t.tag).join(', ') || '—'}</p>
      ${customFields.length ? `<details><summary>Campos personalizados</summary><pre>${escapeHtml(JSON.stringify(Object.fromEntries(customFields), null, 2))}</pre></details>` : ''}
      ${c.outreachStatus === 'NEW' ? `<button type="button" id="modal-activate-now">Activar ahora</button>` : ''}
      <h4>Historial de acciones</h4>
      <table>
        <thead><tr><th>Tipo</th><th>Estado</th><th>Programado</th></tr></thead>
        <tbody>
          ${(c.outreachActions || []).map((a) => `<tr><td>${a.actionType}</td><td><span class="badge ${a.status}">${a.status}</span></td><td>${new Date(a.scheduledFor).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="3">Sin acciones</td></tr>'}
        </tbody>
      </table>
      <h4>Historial de mensajes</h4>
      <table>
        <thead><tr><th>Dirección</th><th>Estado</th><th>Cuerpo</th><th>Fecha</th></tr></thead>
        <tbody>
          ${(messages.messages || messages.items || []).map((m) => `<tr><td>${m.direction}</td><td><span class="badge">${m.status}</span></td><td>${escapeHtml(m.body)}</td><td>${new Date(m.requestedAt || m.receivedAt).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="4">Sin mensajes</td></tr>'}
        </tbody>
      </table>
    `;
    document.getElementById('modal-activate-now')?.addEventListener('click', async () => {
      const campaigns = await getCampaignsCache();
      const active = campaigns.find((camp) => camp.active);
      if (!active) return alert('No hay ninguna campaña activa.');
      try {
        await api('/contacts/bulk', { method: 'POST', body: JSON.stringify({ contactIds: [contactId], action: 'ACTIVATE', campaignId: active.id }) });
        closeContactModal();
        loadContacts();
        loadKanban();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  } catch (err) {
    body.innerHTML = 'Error: ' + escapeHtml(err.message);
  }
}

function closeContactModal() {
  document.getElementById('contact-modal').classList.add('hidden');
}
document.getElementById('contact-modal-close').addEventListener('click', closeContactModal);
document.getElementById('contact-modal').addEventListener('click', (ev) => {
  if (ev.target.id === 'contact-modal') closeContactModal();
});

// ---------- Kanban ----------
async function loadKanban() {
  const board = document.getElementById('kanban-board');
  await populateCampaignFilter(document.getElementById('kanban-campaign-filter'));
  const campaignId = document.getElementById('kanban-campaign-filter').value;
  const params = new URLSearchParams();
  if (campaignId) params.set('campaignId', campaignId);
  try {
    const data = await api('/pipeline/board?' + params.toString());
    board.innerHTML = STAGE_ORDER.map((stage) => {
      const entries = data.columns[stage] || [];
      return `
        <div class="kanban-column" data-stage="${stage}">
          <h4><span class="dot" style="background:${STAGE_COLORS[stage]}"></span>${STAGE_LABELS[stage]} <span class="count">${entries.length}</span></h4>
          <div class="kanban-cards" data-stage="${stage}">
            ${entries.map((e) => {
              const label = e.contact?.companyName || e.contact?.name || 'Sin nombre';
              return `
              <div class="kanban-card" draggable="true" data-id="${e.id}">
                <div class="card-accent" style="background:${STAGE_COLORS[stage]}"></div>
                <div class="card-body">
                  <strong>${escapeHtml(label)}</strong>
                  <div class="phone">${escapeHtml(e.contact?.phoneE164)}</div>
                  <div class="card-footer">
                    <span class="campaign">${escapeHtml(e.campaign?.name)}</span>
                    <span class="avatar" style="background:${colorFor(label)}" title="${escapeHtml(label)}">${initialsOf(label)}</span>
                  </div>
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    board.querySelectorAll('.kanban-card').forEach((card) => {
      let dragged = false;
      card.addEventListener('dragstart', (ev) => {
        dragged = true;
        ev.dataTransfer.setData('text/plain', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => {
        if (dragged) {
          dragged = false;
          return;
        }
        const entry = (data.columns[card.closest('.kanban-cards').dataset.stage] || []).find((e) => e.id === card.dataset.id);
        if (entry?.contact?.id) openContactModal(entry.contact.id);
      });
    });

    board.querySelectorAll('.kanban-cards').forEach((column) => {
      column.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        column.classList.remove('drag-over');
        const entryId = ev.dataTransfer.getData('text/plain');
        const stage = column.dataset.stage;
        try {
          await api(`/pipeline/${entryId}/stage`, { method: 'POST', body: JSON.stringify({ stage }) });
          loadKanban();
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    });
  } catch (err) {
    board.textContent = 'Error: ' + err.message;
  }
}
document.getElementById('kanban-refresh').addEventListener('click', loadKanban);

// ---------- Execution Log ----------
async function loadExecutionLog() {
  const el = document.getElementById('execution-log-table');
  const event = document.getElementById('log-event-filter').value;
  const params = new URLSearchParams();
  if (event) params.set('event', event);
  try {
    const data = await api('/execution-log?' + params.toString());
    const eventSelect = document.getElementById('log-event-filter');
    if (eventSelect.options.length <= 1) {
      eventSelect.innerHTML = '<option value="">Todos los eventos</option>' + data.events.map((e) => `<option value="${e}">${e}</option>`).join('');
      eventSelect.value = event;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Timestamp</th><th>Event</th><th>Contact</th><th>Campaign</th><th>Actor</th><th>Details</th></tr></thead>
        <tbody>
          ${data.items.map((l) => `
            <tr>
              <td>${new Date(l.timestamp).toLocaleString()}</td>
              <td><span class="badge">${escapeHtml(l.event)}</span></td>
              <td>${l.contact ? `${escapeHtml(l.contact.companyName)} (${escapeHtml(l.contact.phoneE164)})` : ''}</td>
              <td>${l.campaign ? escapeHtml(l.campaign.name) : ''}</td>
              <td>${escapeHtml(l.actor)}</td>
              <td><pre>${escapeHtml(JSON.stringify(l.detailsJson))}</pre></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p>${data.total} eventos</p>
    `;
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}
document.getElementById('log-refresh').addEventListener('click', loadExecutionLog);

// ---------- Queue ----------
async function loadQueue() {
  const el = document.getElementById('queue-table');
  const status = document.getElementById('queue-status-filter').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  try {
    const data = await api('/queue?' + params.toString());
    el.innerHTML = `
      <table>
        <thead><tr><th>Scheduled</th><th>Contact</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${data.items.map((a) => `
            <tr>
              <td>${new Date(a.scheduledFor).toLocaleString()}</td>
              <td>${escapeHtml(a.contact?.companyName)} (${escapeHtml(a.contact?.phoneE164)})</td>
              <td>${a.actionType}</td>
              <td><span class="badge ${a.status}">${a.status}</span></td>
              <td>
                <button class="secondary" onclick="cancelAction('${a.id}')">Cancel</button>
                <button onclick="retryAction('${a.id}')">Retry</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p>${data.total} acciones</p>
    `;
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}
document.getElementById('queue-refresh').addEventListener('click', loadQueue);

window.cancelAction = async (id) => {
  if (!confirm('¿Cancelar esta acción?')) return;
  try {
    await api(`/queue/${id}/cancel`, { method: 'POST' });
    loadQueue();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

window.retryAction = async (id, confirmFlag) => {
  try {
    await api(`/queue/${id}/retry`, { method: 'POST', body: JSON.stringify({ confirm: !!confirmFlag }) });
    loadQueue();
  } catch (err) {
    if (err.message.includes('confirmation required') || err.message.toLowerCase().includes('unknown/stalled')) {
      if (confirm('ADVERTENCIA: esta acción estaba UNKNOWN/STALLED. Reintentar puede duplicar el SMS. ¿Continuar?')) {
        return window.retryAction(id, true);
      }
    } else {
      alert('Error: ' + err.message);
    }
  }
};

// ---------- Campaigns ----------
async function loadCampaigns() {
  const el = document.getElementById('campaigns-table');
  try {
    const data = await api('/campaigns');
    el.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Active</th><th>Window</th><th>Gap (s)</th><th>Max/day</th><th>Actions</th></tr></thead>
        <tbody>
          ${data.campaigns.map((c) => `
            <tr>
              <td>${escapeHtml(c.name)}</td>
              <td><span class="badge ${c.active ? 'RUNNING' : 'PAUSED'}">${c.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
              <td>${c.sendWindowStart}-${c.sendWindowEnd} (${c.timezone})</td>
              <td>${c.minimumSendGapSeconds}</td>
              <td>${c.maxSmsPerDay}</td>
              <td>
                ${c.active
                  ? `<button class="secondary" onclick="deactivateCampaign('${c.id}')">Deactivate</button>`
                  : `<button onclick="activateCampaign('${c.id}')">Activate</button>`}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}
window.activateCampaign = async (id) => { await api(`/campaigns/${id}/activate`, { method: 'POST' }); loadCampaigns(); };
window.deactivateCampaign = async (id) => { await api(`/campaigns/${id}/deactivate`, { method: 'POST' }); loadCampaigns(); };

document.getElementById('new-campaign-create').addEventListener('click', async () => {
  const name = document.getElementById('new-campaign-name').value.trim();
  if (!name) return alert('Nombre requerido');
  try {
    await api('/campaigns', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('new-campaign-name').value = '';
    loadCampaigns();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// ---------- Settings ----------
async function loadSettings() {
  const el = document.getElementById('settings-content');
  try {
    const data = await api('/settings');
    el.innerHTML = `
      <div class="cards">
        <div class="card"><h4>Status</h4><div class="value"><span class="badge ${data.runtime.globalPaused ? 'PAUSED' : 'RUNNING'}">${data.runtime.globalPaused ? 'PAUSED' : 'RUNNING'}</span></div></div>
        <div class="card"><h4>Dry Run</h4><div class="value">${data.env.dryRun ? 'YES' : 'no'}</div></div>
      </div>
      <div class="toolbar">
        <button class="danger" id="pause-btn">PAUSE ALL OUTBOUND</button>
        <button id="resume-btn">RESUME</button>
      </div>
      <h3>Send test SMS</h3>
      <div class="toolbar">
        <input id="test-sms-phone" placeholder="+346XXXXXXXX" />
        <input id="test-sms-message" placeholder="Mensaje de prueba" />
        <button id="test-sms-send">Send test SMS</button>
      </div>
      <p class="hint">Los mensajes de la secuencia (inicial + follow-ups) se editan en la pestaña <strong>Mensajes</strong>.</p>
    `;
    document.getElementById('pause-btn').addEventListener('click', async () => {
      const reason = prompt('Motivo de la pausa:', 'Manual pause from admin panel');
      if (reason === null) return;
      await api('/pause', { method: 'POST', body: JSON.stringify({ reason }) });
      loadSettings();
    });
    document.getElementById('resume-btn').addEventListener('click', async () => {
      await api('/resume', { method: 'POST' });
      loadSettings();
    });
    document.getElementById('test-sms-send').addEventListener('click', async () => {
      const phone = document.getElementById('test-sms-phone').value;
      const message = document.getElementById('test-sms-message').value;
      try {
        const res = await api('/test-sms', { method: 'POST', body: JSON.stringify({ phone, message }) });
        alert('OK: ' + JSON.stringify(res));
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}

// ---------- Notifications ----------
async function loadNotifications() {
  const el = document.getElementById('notifications-table');
  try {
    const data = await api('/notifications');
    el.innerHTML = `
      <table>
        <thead><tr><th>Type</th><th>Title</th><th>Message</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          ${data.notifications.map((n) => `
            <tr>
              <td>${n.type}</td>
              <td>${escapeHtml(n.title)}</td>
              <td>${escapeHtml(n.message)}</td>
              <td><span class="badge ${n.status}">${n.status}</span></td>
              <td>${new Date(n.createdAt).toLocaleString()}</td>
              <td>${n.status === 'UNREAD' ? `<button onclick="markRead('${n.id}')">Mark read</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}
window.markRead = async (id) => { await api(`/notifications/${id}/read`, { method: 'POST' }); loadNotifications(); };

// ---------- CSV Import ----------
document.getElementById('csv-upload').addEventListener('click', async () => {
  const fileInput = document.getElementById('csv-file');
  const button = document.getElementById('csv-upload');
  const progress = document.getElementById('csv-progress');
  const progressText = document.getElementById('csv-progress-text');
  const report = document.getElementById('csv-report');
  if (!fileInput.files[0]) return alert('Selecciona un archivo CSV');

  const text = await fileInput.files[0].text();
  const approxRows = Math.max(text.trim().split('\n').length - 1, 0);

  button.disabled = true;
  fileInput.disabled = true;
  progress.classList.remove('hidden');
  progressText.textContent = `Importando ~${approxRows} contactos… esto puede tardar unos segundos.`;
  report.innerHTML = '';

  try {
    const res = await api('/import-csv', { method: 'POST', body: JSON.stringify({ csv: text }) });
    report.innerHTML = `
      <div class="cards">
        <div class="card"><h4>Filas totales</h4><div class="value">${res.totalRows}</div></div>
        <div class="card"><h4>Creados</h4><div class="value">${res.created}</div></div>
        <div class="card"><h4>Actualizados</h4><div class="value">${res.updated}</div></div>
        <div class="card"><h4>Activados en Kanban</h4><div class="value">${res.enrolled}</div></div>
        <div class="card"><h4>Omitidos</h4><div class="value">${res.skipped.length}</div></div>
      </div>
      ${res.noActiveCampaign ? '<p class="warning">⚠️ No hay ninguna campaña activa: los contactos se importaron pero no se activaron en el Kanban. Activa una campaña en la pestaña Campaigns.</p>' : ''}
      ${res.skipped.length ? `<details><summary>${res.skipped.length} filas omitidas</summary><pre>${escapeHtml(JSON.stringify(res.skipped, null, 2))}</pre></details>` : ''}
    `;
  } catch (err) {
    report.innerHTML = `<p class="error">Error: ${escapeHtml(err.message)}</p>`;
  } finally {
    button.disabled = false;
    fileInput.disabled = false;
    progress.classList.add('hidden');
  }
});

// ---------- Mensajes (drip templates) ----------
let lastFocusedTemplateTextarea = null;
function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const newPos = start + text.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
}

async function loadTemplates() {
  const el = document.getElementById('templates-content');
  el.textContent = 'Loading...';
  try {
    const data = await api('/message-templates');
    const variableChips = [...data.variables.fixed, ...data.variables.custom]
      .map((v) => `<button type="button" class="chip" data-var="${v}">{{${v}}}</button>`)
      .join('');

    el.innerHTML = `
      ${!data.campaign ? '<p class="warning">⚠️ No hay ninguna campaña activa — los pasos de follow-up extra no se pueden activar hasta que exista una.</p>' : ''}
      <h3>Variables disponibles</h3>
      <p class="hint">Haz click en una variable para copiarla, luego pégala en el mensaje donde quieras (ej. {{company_name}}).</p>
      <div class="variable-chips">${variableChips}</div>
      <h3>Secuencia de mensajes</h3>
      <div id="template-steps">${data.steps.map((s) => renderStepCard(s)).join('')}</div>
    `;

    el.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('draggable', 'true');
      chip.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', `{{${chip.dataset.var}}}`);
      });
      chip.addEventListener('click', () => {
        const text = `{{${chip.dataset.var}}}`;
        if (lastFocusedTemplateTextarea && document.body.contains(lastFocusedTemplateTextarea)) {
          insertAtCursor(lastFocusedTemplateTextarea, text);
        } else {
          navigator.clipboard?.writeText(text);
        }
        chip.classList.add('copied');
        setTimeout(() => chip.classList.remove('copied'), 800);
      });
    });

    el.querySelectorAll('.variant-editor textarea, .step-enable-form textarea').forEach((textarea) => {
      textarea.addEventListener('focus', () => { lastFocusedTemplateTextarea = textarea; });
      textarea.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        textarea.classList.add('drag-over');
      });
      textarea.addEventListener('dragleave', () => textarea.classList.remove('drag-over'));
      textarea.addEventListener('drop', (ev) => {
        ev.preventDefault();
        textarea.classList.remove('drag-over');
        const text = ev.dataTransfer.getData('text/plain');
        if (text) insertAtCursor(textarea, text);
      });
    });

    el.querySelectorAll('.step-save').forEach((btn) => {
      btn.addEventListener('click', () => saveStepBody(btn.dataset.actionType, btn.dataset.variant));
    });
    el.querySelectorAll('.step-enable-form').forEach((form) => {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        enableStep(form.dataset.actionType);
      });
    });
    el.querySelectorAll('.step-disable').forEach((btn) => {
      btn.addEventListener('click', () => disableStep(btn.dataset.actionType));
    });
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}

function renderStepCard(step) {
  if (!step.enabled) {
    if (!step.canEnableNext) {
      return `<div class="step-card disabled"><h4>${escapeHtml(step.label)}</h4><p class="hint">Activa antes los pasos anteriores.</p></div>`;
    }
    return `
      <div class="step-card add-step">
        <h4>${escapeHtml(step.label)} <span class="badge">no activo</span></h4>
        <form class="step-enable-form" data-action-type="${step.actionType}">
          <label>Enviar (horas después del paso anterior): <input type="number" min="1" name="delayHours" value="48" required /></label>
          <label>Variante A <textarea name="A" rows="2" required></textarea></label>
          <label>Variante B <textarea name="B" rows="2" required></textarea></label>
          <label>Variante C <textarea name="C" rows="2" required></textarea></label>
          <button type="submit">+ Añadir ${escapeHtml(step.label)}</button>
        </form>
      </div>
    `;
  }

  const isOptional = !['INITIAL', 'FOLLOWUP_1', 'FOLLOWUP_2'].includes(step.actionType);
  return `
    <div class="step-card">
      <h4>${escapeHtml(step.label)} ${step.delayHours != null ? `<span class="badge">+${step.delayHours}h</span>` : ''}
        ${isOptional ? `<button type="button" class="secondary step-disable" data-action-type="${step.actionType}">Desactivar</button>` : ''}
      </h4>
      <div class="variant-grid">
        ${['A', 'B', 'C'].map((variant) => `
          <div class="variant-editor">
            <strong>Variante ${variant}</strong>
            <textarea rows="3" data-action-type="${step.actionType}" data-variant="${variant}" id="tpl-${step.actionType}-${variant}">${escapeHtml(step.templates[variant])}</textarea>
            <button class="step-save" data-action-type="${step.actionType}" data-variant="${variant}">Guardar</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function saveStepBody(actionType, variant) {
  const textarea = document.getElementById(`tpl-${actionType}-${variant}`);
  try {
    await api(`/message-templates/${actionType}`, { method: 'PUT', body: JSON.stringify({ variant, body: textarea.value }) });
    alert('Guardado');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function enableStep(actionType) {
  const form = document.querySelector(`.step-enable-form[data-action-type="${actionType}"]`);
  const delayHours = Number(form.elements.delayHours.value);
  const bodies = { A: form.elements.A.value, B: form.elements.B.value, C: form.elements.C.value };
  try {
    await api(`/message-templates/${actionType}/enable`, { method: 'POST', body: JSON.stringify({ delayHours, bodies }) });
    loadTemplates();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function disableStep(actionType) {
  if (!confirm(`¿Desactivar ${actionType}? Los envíos ya programados con este paso no se cancelan.`)) return;
  try {
    await api(`/message-templates/${actionType}/disable`, { method: 'POST' });
    loadTemplates();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ---------- Init ----------
populateBulkCampaignSelect();
activateTab(tabFromLocation());
