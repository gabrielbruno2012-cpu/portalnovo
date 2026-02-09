// Incentivos charts (monthly) - uses Chart.js
// Expects global helpers from ui-common.js (fmtBRL, monthLabel)

async function loadIncentivosMonthlyCharts({ userId }) {
  const campanha = await fetch('/api/campanhas/ativa').then(r => r.json()).catch(()=>null);
  if (!campanha?.id || !userId) return { ok:false, reason:'no_campanha' };

  // pontos por usuário (assumimos que retorno tem data_criado ou criado_em ou data)
  const pontosRes = await fetch(`/api/incentivos/pontos/usuario?courier_id=${userId}&campanha_id=${campanha.id}`);
  let pontos = await pontosRes.json().catch(()=>[]);
  if (!Array.isArray(pontos)) pontos = [];

  // agrega por mês (YYYY-MM)
  const byMonth = {};
  pontos.forEach(p => {
    const ds = String(p.data || p.data_criado || p.criado_em || p.created_at || '').split(' ')[0];
    const parts = ds.split('-');
    if (parts.length !== 3) return;
    const ym = `${parts[0]}-${parts[1]}`;
    byMonth[ym] = (byMonth[ym] || 0) + Number(p.pontos || 0);
  });

  const months = Object.keys(byMonth).sort();
  const labels = months.map(ym => {
    const [y,m] = ym.split('-');
    return `${monthLabel(m)}/${y}`;
  });
  const values = months.map(ym => byMonth[ym]);

  const el = document.getElementById('chartPontos');
  if (el && window.Chart) {
    const ctx = el.getContext('2d');
    if (window._chartPontos) window._chartPontos.destroy();

    window._chartPontos = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Pontos (por mês)',
          data: values,
          borderColor: '#F6C21B',
          backgroundColor: 'rgba(246,194,27,0.18)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.raw} pts` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => v + ' pts' } }
        }
      }
    });
  }

  // SLA mensal (últimos SLA por mês)
  const slaRes = await fetch(`/api/campanha/sla/listar?campanha_id=${campanha.id}`);
  let slas = await slaRes.json().catch(()=>[]);
  if (!Array.isArray(slas)) slas = [];

  const slaByMonth = {};
  slas.forEach(s => {
    const ds = String(s.data || s.data_criado || s.criado_em || s.created_at || '').split(' ')[0];
    const parts = ds.split('-');
    if (parts.length !== 3) return;
    const ym = `${parts[0]}-${parts[1]}`;
    // pega o último do mês (assumindo id crescente)
    if (!slaByMonth[ym] || Number(s.id) > Number(slaByMonth[ym].id)) {
      slaByMonth[ym] = s;
    }
  });

  const slaMonths = Object.keys(slaByMonth).sort();
  const slaLabels = slaMonths.map(ym => {
    const [y,m] = ym.split('-');
    return `${monthLabel(m)}/${y}`;
  });
  const slaValues = slaMonths.map(ym => Number(slaByMonth[ym].sla_percentual || 0));

  const elSla = document.getElementById('chartSla');
  if (elSla && window.Chart) {
    const ctx = elSla.getContext('2d');
    if (window._chartSla) window._chartSla.destroy();

    window._chartSla = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: slaLabels,
        datasets: [{
          label: 'SLA (%)',
          data: slaValues,
          backgroundColor: 'rgba(207,232,255,0.18)',
          borderColor: 'rgba(207,232,255,0.55)',
          borderWidth: 1,
          borderRadius: 8,
        }, {
          label: 'Meta SLA (%)',
          data: slaLabels.map(() => Number(campanha.meta_sla || 0)),
          backgroundColor: 'rgba(246,194,27,0.30)',
          borderRadius: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#d6e6f5' } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + ctx.raw + '%' } }
        },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + '%' } }
        }
      }
    });
  }

  return { ok:true };
}
