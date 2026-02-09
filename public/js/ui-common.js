// UI Common helpers (no framework)
// Used by colaborador + admin dashboards

function fmtBRL(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthLabel(m) {
  const arr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const idx = Number(m) - 1;
  return arr[idx] || String(m);
}

function normalizeStatus(s) {
  const st = String(s || '').trim().toLowerCase();
  if (!st) return { key: 'desconhecido', label: '—', badgeClass: 'tag-yellow' };

  if (st.includes('pago') || st.includes('aprov')) {
    return { key: 'ok', label: 'Pago/Aprovado', badgeClass: 'tag-green' };
  }
  if (st.includes('pend')) {
    return { key: 'pendente', label: 'Pendente', badgeClass: 'tag-yellow' };
  }
  if (st.includes('recus') || st.includes('reprov') || st.includes('cancel')) {
    return { key: 'negado', label: 'Recusado', badgeClass: 'tag-red' };
  }
  return { key: 'processando', label: 'Em processamento', badgeClass: 'tag-yellow' };
}

function getUserFromStorage() {
  // compat: algumas telas usam 'usuario', outras 'user'
  const raw = localStorage.getItem('user') || localStorage.getItem('usuario');
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

function enforceAuthOrRedirect(roleAllowList) {
  const u = getUserFromStorage();
  if (!u) {
    window.location = '/';
    return null;
  }
  if (Array.isArray(roleAllowList) && roleAllowList.length) {
    if (!roleAllowList.includes(u.role)) {
      // fallback: colaborador
      window.location = '/colaborador/dashboard.html';
      return null;
    }
  }
  return u;
}

function logoutEverywhere() {
  localStorage.removeItem('user');
  localStorage.removeItem('usuario');
  window.location = '/';
}

function parseISODateOnly(s) {
  // aceita 'YYYY-MM-DD' ou 'YYYY-MM-DD hh:mm:ss'
  const d = String(s || '').split(' ')[0];
  const parts = d.split('-');
  if (parts.length !== 3) return null;
  const [y, m, day] = parts.map(Number);
  if (!y || !m || !day) return null;
  return { y, m, day, iso: `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}` };
}

function downloadCSV(filename, rows) {
  const header = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = String(v ?? '');
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [header.join(',')];
  rows.forEach(r => lines.push(header.map(h => esc(r[h])).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}


// ===== Sidebar toggle (mobile) =====
function initSidebarToggle() {
  const btn = document.getElementById('btnToggleSidebar');
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  // close on backdrop click
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('sidebar-open')) return;
    const sidebar = document.getElementById('sidebar-container');
    const isBtn = e.target && (e.target.id === 'btnToggleSidebar' || e.target.closest('#btnToggleSidebar'));
    const insideSidebar = sidebar && e.target && (e.target === sidebar || e.target.closest('#sidebar-container'));
    if (!insideSidebar && !isBtn) document.body.classList.remove('sidebar-open');
  });
  // close on ESC
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') document.body.classList.remove('sidebar-open');
  });
}

window.addEventListener('load', () => {
  try { initSidebarToggle(); } catch(e) {}
});
