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

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    loadTab(btn.dataset.tab);
  });
});

function loadTab(tab) {
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'contacts') loadContacts();
  if (tab === 'opportunities') loadOpportunities();
  if (tab === 'kanban') loadKanban();
  if (tab === 'queue') loadQueue();
  if (tab === 'campaigns') loadCampaigns();
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
    el.innerHTML = `
      <div class="cards">
        <div class="card"><h4>System</h4><div class="value"><span class="badge ${d.systemStatus}">${d.systemStatus}</span></div>${d.pauseReason ? `<div>${escapeHtml(d.pauseReason)}</div>` : ''}</div>
        <div class="card"><h4>Dry Run</h4><div class="value">${d.dryRun ? 'YES' : 'no'}</div></div>
        <div class="card"><h4>TextBee</h4><div class="value">${d.textbee.configured ? 'configured' : 'NOT configured'}</div></div>
      </div>
      <h3>Today</h3>
      <div class="cards">
        ${Object.entries(d.today).map(([k, v]) => `<div class="card"><h4>${k}</h4><div class="value">${v}</div></div>`).join('')}
      </div>
      <h3>Queue</h3>
      <div class="cards">
        ${Object.entries(d.queue).map(([k, v]) => `<div class="card"><h4>${k}</h4><div class="value">${v}</div></div>`).join('')}
      </div>
      <h3>Contacts</h3>
      <div class="cards">
        ${Object.entries(d.contacts).map(([k, v]) => `<div class="card"><h4>${k}</h4><div class="value">${v}</div></div>`).join('')}
      </div>
    `;
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}

// ---------- Contacts ----------
async function loadContacts() {
  const el = document.getElementById('contacts-table');
  const status = document.getElementById('contacts-status-filter').value;
  const search = document.getElementById('contacts-search').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  try {
    const data = await api('/contacts?' + params.toString());
    el.innerHTML = `
      <table>
        <thead><tr><th><input type="checkbox" id="select-all" /></th><th>Company</th><th>Phone</th><th>Variant</th><th>Status</th><th>Tags</th><th>Last outbound</th><th>Last inbound</th></tr></thead>
        <tbody>
          ${data.items.map((c) => `
            <tr>
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
    });
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}

document.getElementById('contacts-refresh').addEventListener('click', loadContacts);

document.getElementById('bulk-apply').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.contact-checkbox:checked')).map((cb) => cb.value);
  if (ids.length === 0) return alert('Selecciona al menos un contacto');
  const action = document.getElementById('bulk-action').value;
  const campaignId = document.getElementById('bulk-campaign-id').value || undefined;
  try {
    const res = await api('/contacts/bulk', { method: 'POST', body: JSON.stringify({ contactIds: ids, action, campaignId }) });
    alert('Aplicado: ' + JSON.stringify(res.results.filter((r) => !r.ok)));
    loadContacts();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// ---------- Opportunities & Kanban shared helpers ----------
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

// ---------- Opportunities ----------
async function loadOpportunities() {
  const el = document.getElementById('opportunities-table');
  await populateCampaignFilter(document.getElementById('opp-campaign-filter'));
  const campaignId = document.getElementById('opp-campaign-filter').value;
  const stage = document.getElementById('opp-stage-filter').value;
  const search = document.getElementById('opp-search').value;
  const params = new URLSearchParams();
  if (campaignId) params.set('campaignId', campaignId);
  if (stage) params.set('stage', stage);
  if (search) params.set('search', search);
  try {
    const data = await api('/pipeline?' + params.toString());
    el.innerHTML = `
      <table>
        <thead><tr><th>Company</th><th>Phone</th><th>Campaign</th><th>Stage</th><th>Last outbound</th><th>Last inbound</th><th>Actions</th></tr></thead>
        <tbody>
          ${data.items.map((e) => `
            <tr>
              <td>${escapeHtml(e.contact?.companyName)}</td>
              <td>${escapeHtml(e.contact?.phoneE164)}</td>
              <td>${escapeHtml(e.campaign?.name)}</td>
              <td><span class="badge STAGE_${e.stage}">${STAGE_LABELS[e.stage] || e.stage}</span></td>
              <td>${e.contact?.lastOutboundAt ? new Date(e.contact.lastOutboundAt).toLocaleString() : ''}</td>
              <td>${e.contact?.lastInboundAt ? new Date(e.contact.lastInboundAt).toLocaleString() : ''}</td>
              <td>
                <select onchange="moveOpportunityStage('${e.id}', this.value)">
                  <option value="">Mover a...</option>
                  ${STAGE_ORDER.filter((s) => s !== e.stage).map((s) => `<option value="${s}">${STAGE_LABELS[s]}</option>`).join('')}
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p>${data.total} oportunidades</p>
    `;
  } catch (err) {
    el.textContent = 'Error: ' + err.message;
  }
}
document.getElementById('opp-refresh').addEventListener('click', loadOpportunities);

window.moveOpportunityStage = async (id, stage) => {
  if (!stage) return;
  try {
    await api(`/pipeline/${id}/stage`, { method: 'POST', body: JSON.stringify({ stage }) });
    loadOpportunities();
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

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
      card.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
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
      <h3>Message templates</h3>
      <table>
        <thead><tr><th>Action</th><th>Variant</th><th>Body</th><th></th></tr></thead>
        <tbody>
          ${data.templates.map((t) => `
            <tr>
              <td>${t.actionType}</td>
              <td>${t.variant}</td>
              <td><textarea data-action="${t.actionType}" data-variant="${t.variant}" rows="2" style="width:100%">${escapeHtml(t.body)}</textarea></td>
              <td><button onclick="saveTemplate('${t.actionType}','${t.variant}', this)">Save</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
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

window.saveTemplate = async (actionType, variant, btn) => {
  const textarea = btn.closest('tr').querySelector('textarea');
  try {
    await api(`/settings/templates/${actionType}/${variant}`, { method: 'PUT', body: JSON.stringify({ body: textarea.value }) });
    alert('Guardado');
  } catch (err) {
    alert('Error: ' + err.message);
  }
};

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
  const report = document.getElementById('csv-report');
  if (!fileInput.files[0]) return alert('Selecciona un archivo CSV');
  const text = await fileInput.files[0].text();
  try {
    const res = await api('/import-csv', { method: 'POST', body: JSON.stringify({ csv: text }) });
    report.textContent = JSON.stringify(res, null, 2);
  } catch (err) {
    report.textContent = 'Error: ' + err.message;
  }
});

// ---------- Init ----------
loadDashboard();
