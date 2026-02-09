// Common helpers for dashboards (admin/colaborador)
(function(){
  function getUser(){
    const raw = localStorage.getItem('user') || localStorage.getItem('usuario');
    if(!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function requireLogin(){
    // compat: sync usuario->user
    if (localStorage.getItem('usuario') && !localStorage.getItem('user')) {
      localStorage.setItem('user', localStorage.getItem('usuario'));
    }
    const u = getUser();
    if(!u || !u.id){ window.location = '/'; return null; }
    return u;
  }

  function logout(){
    localStorage.removeItem('user');
    localStorage.removeItem('usuario');
    window.location = '/';
  }

  function fmtBRL(v){
    return 'R$ ' + Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function parseISODate(dateStr){
    // supports 'YYYY-MM-DD ...'
    if(!dateStr) return null;
    const d = dateStr.split(' ')[0];
    const parts = d.split('-');
    if(parts.length !== 3) return null;
    const [y,m,dd] = parts.map(x=>parseInt(x,10));
    if(!y || !m || !dd) return null;
    return {y, m, d: dd, iso: `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`};
  }

  function monthLabel(m){
    const names = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return names[(m||1)-1] || String(m);
  }

  function statusGroup(raw){
    const st = String(raw||'').toLowerCase();
    if(st.includes('pago') || st.includes('aprov')) return 'pago';
    if(st.includes('pend')) return 'pendente';
    if(st.includes('reprov') || st.includes('cancel')) return 'reprovado';
    return 'processando';
  }

  function statusBadge(raw){
    const g = statusGroup(raw);
    if(g==='pago') return `<span class="tag-green">${raw||'Pago'}</span>`;
    if(g==='pendente') return `<span class="tag-yellow">${raw||'Pendente'}</span>`;
    if(g==='reprovado') return `<span class="tag-red">${raw||'Reprovado'}</span>`;
    return `<span class="tag-yellow">${raw||'Processando'}</span>`;
  }

  function uniq(arr){
    return [...new Set(arr.filter(Boolean))];
  }

  window.DashboardCommon = {
    getUser, requireLogin, logout,
    fmtBRL, parseISODate, monthLabel,
    statusGroup, statusBadge,
    uniq,
  };
})();
