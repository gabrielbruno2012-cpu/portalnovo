// Dashboard widgets: filters, KPI interactions, chart builders

function buildMonthYearOptions(selectEl, yearsBack = 2, yearsForward = 1) {
  const now = new Date();
  const startY = now.getFullYear() - yearsBack;
  const endY = now.getFullYear() + yearsForward;
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

  let html = '';
  for (let y = endY; y >= startY; y--) {
    months.forEach(m => {
      html += `<option value="${y}-${m}">${monthLabel(m)}/${y}</option>`;
    });
  }
  selectEl.innerHTML = html;

  const cur = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  selectEl.value = cur;
}

function rowsApplyFilters(rows, filters) {
  const f = filters || {};

  return rows.filter(r => {
    if (f.type && f.type !== 'all') {
      if (f.type === 'recebivel' && String(r.tipo||'').toLowerCase() !== 'recebível' && String(r.tipo||'').toLowerCase() !== 'recebivel') return false;
      if (f.type === 'producao' && String(r.tipo||'').toLowerCase() !== 'produção' && String(r.tipo||'').toLowerCase() !== 'producao') return false;
    }

    if (f.status && f.status !== 'all') {
      const ns = normalizeStatus(r.status);
      if (f.status !== ns.key) return false;
    }

    if (f.period && f.period !== 'all') {
      const d = parseISODateOnly(r.data);
      if (!d) return false;
      const ym = `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}`;
      if (ym !== f.period) return false;
    }

    return true;
  });
}

function computeKpis(rows) {
  let totalOk = 0, totalPend = 0, totalProc = 0;
  rows.forEach(r => {
    const v = Number(r.valor || 0);
    const ns = normalizeStatus(r.status);
    if (ns.key === 'ok') totalOk += v;
    else if (ns.key === 'pendente') totalPend += v;
    else totalProc += v;
  });
  return { totalOk, totalPend, totalProc, totalAll: totalOk + totalPend + totalProc };
}

function kpiSetActive(containerEl, key) {
  containerEl.querySelectorAll('[data-kpi]').forEach(el => {
    el.classList.toggle('kpi-active', el.getAttribute('data-kpi') === key);
  });
}

function buildStatusBadge(status) {
  const ns = normalizeStatus(status);
  return `<span class="${ns.badgeClass}">${ns.label}</span>`;
}

function groupPaidByDay(rows, periodYM) {
  // returns labels [1..n] and values
  const map = {};
  rows.forEach(r => {
    const ns = normalizeStatus(r.status);
    if (ns.key !== 'ok') return;
    const d = parseISODateOnly(r.data);
    if (!d) return;
    const ym = `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}`;
    if (periodYM && ym !== periodYM) return;
    map[d.day] = (map[d.day] || 0) + Number(r.valor || 0);
  });
  const days = Object.keys(map).map(Number).sort((a,b)=>a-b);
  return {
    labels: days.map(d => String(d).padStart(2,'0')),
    values: days.map(d => map[d] || 0),
  };
}

function groupPaidByMonth(rows, year) {
  const map = {};
  rows.forEach(r => {
    const ns = normalizeStatus(r.status);
    if (ns.key !== 'ok') return;
    const d = parseISODateOnly(r.data);
    if (!d) return;
    if (year && Number(year) !== d.y) return;
    const m = String(d.m).padStart(2,'0');
    map[m] = (map[m] || 0) + Number(r.valor || 0);
  });
  const months = Object.keys(map).sort();
  return {
    labels: months.map(m => monthLabel(m)),
    values: months.map(m => map[m] || 0),
  };
}

function renderTable(containerEl, rows, options) {
  const opts = options || {};
  const showUser = !!opts.showUser;

  if (!rows.length) {
    containerEl.innerHTML = '<p class="small">Nenhum registro para os filtros selecionados.</p>';
    return;
  }

  let html = `<div class="table-wrap"><table class="table"><tr>`;
  html += `<th>ID</th>`;
  if (showUser) html += `<th>Usuário</th>`;
  html += `<th>Data</th><th>Valor</th><th>Tipo</th><th>Status</th></tr>`;

  rows.forEach(r => {
    html += `<tr class="row-click" data-row-id="${r.id}">`;
    html += `<td>${r.id}</td>`;
    if (showUser) html += `<td>${r.nome || ''}</td>`;
    html += `<td>${(r.data || '').split(' ')[0]}</td>`;
    html += `<td>${fmtBRL(r.valor)}</td>`;
    html += `<td>${r.tipo || ''}</td>`;
    html += `<td>${buildStatusBadge(r.status)}</td>`;
    html += `</tr>`;
  });

  html += `</table></div>`;
  containerEl.innerHTML = html;
}

function ensureModal() {
  let modal = document.getElementById('ui-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'ui-modal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal__overlay" data-modal-close></div>
    <div class="modal__content">
      <div class="modal__header">
        <div class="modal__title" id="ui-modal-title">Detalhes</div>
        <button class="btn btn-secondary" data-modal-close>Fechar</button>
      </div>
      <div class="modal__body" id="ui-modal-body"></div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', () => modal.classList.add('hidden'));
  });
  return modal;
}

function openDetailsModal(row) {
  const modal = ensureModal();
  const title = document.getElementById('ui-modal-title');
  const body = document.getElementById('ui-modal-body');

  title.textContent = `Registro ${row.id}`;
  body.innerHTML = `
    <div class="detail-grid">
      <div><div class="small">Data</div><div>${(row.data||'').split(' ')[0]}</div></div>
      <div><div class="small">Valor</div><div>${fmtBRL(row.valor)}</div></div>
      <div><div class="small">Tipo</div><div>${row.tipo || ''}</div></div>
      <div><div class="small">Status</div><div>${buildStatusBadge(row.status)}</div></div>
      ${row.nome ? `<div><div class="small">Usuário</div><div>${row.nome}</div></div>` : ''}
    </div>
  `;

  modal.classList.remove('hidden');
}

function attachRowClick(containerEl, rows) {
  const map = new Map(rows.map(r => [String(r.id), r]));
  containerEl.addEventListener('click', (ev) => {
    const tr = ev.target.closest('.row-click');
    if (!tr) return;
    const id = tr.getAttribute('data-row-id');
    const row = map.get(String(id));
    if (row) openDetailsModal(row);
  });
}
