(function(){
  const fmtBRL = window.fmtBRL || ((n)=>'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2}));

  function parseBR(v){
    if(v==null) return 0;
    v=String(v).trim();
    if(!v) return 0;
    v=v.replace(/[^0-9,\.]/g,'').replace(/\./g,'').replace(',', '.');
    const n=Number(v);
    return isFinite(n)?n:0;
  }

  function buildMonthYear(){
    const now=new Date();
    const fMes=document.getElementById('fMes');
    const fAno=document.getElementById('fAno');
    const months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    for(let m=1;m<=12;m++){
      const opt=document.createElement('option');
      opt.value=String(m).padStart(2,'0');
      opt.textContent=months[m-1];
      fMes.appendChild(opt);
    }
    const y=now.getFullYear();
    for(let yy=y-1;yy<=y+1;yy++){
      const opt=document.createElement('option');
      opt.value=String(yy);
      opt.textContent=String(yy);
      fAno.appendChild(opt);
    }
    fMes.value=String(now.getMonth()+1).padStart(2,'0');
    fAno.value=String(y);
  }

  async function loadUsers(){
    const sel=document.getElementById('fUser');
    const users=await fetch('/api/usuarios').then(r=>r.json());
    sel.innerHTML = '<option value="">Selecione</option>';
    users.filter(u=>u.role==='colaborador').forEach(u=>{
      const opt=document.createElement('option');
      opt.value=u.id;
      opt.textContent=`${u.nome} (#${u.id})`;
      sel.appendChild(opt);
    });
  }

  function parseDiario(text){
    const lines=(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const rows=[];
    for(const line of lines){
      const parts=line.split(/\t|\s{2,}|;|,/).map(s=>s.trim()).filter(Boolean);
      if(parts.length<2) continue;
      const data=parts[0];
      const qtd=Number(String(parts[1]).replace(/[^0-9]/g,''));
      if(!qtd) continue;
      rows.push({data, quantidade:qtd});
    }
    return rows;
  }

  async function loadParcelasPreview(usuario_id, ano, mes, quinzena){
    if(!usuario_id) return {total:0, rows:[]};
    const url=`/api/emprestimos/parcelas?usuario_id=${usuario_id}&ano=${ano}&mes=${Number(mes)}&quinzena=${Number(quinzena)}`;
    const rows=await fetch(url).then(r=>r.json());
    const pend = (rows||[]).filter(r=>String(r.status||'').toLowerCase()==='pendente');
    const total=pend.reduce((s,r)=>s+Number(r.valor_parcela||0),0);
    return {total, rows:pend};
  }

  function renderParcelas(box, rows){
    if(!rows.length){ box.innerHTML='<div class="small">Sem parcelas pendentes nesta quinzena.</div>'; return; }
    let html='<div class="table-wrap"><table class="table"><thead><tr><th>Empréstimo</th><th>Parcela</th><th>Competência</th><th>Valor</th><th>Status</th></tr></thead><tbody>';
    rows.forEach(r=>{
      html+=`<tr><td>#${r.emprestimo_id}</td><td>${r.parcela_num}/${r.total_parcelas}</td><td>${String(r.mes).padStart(2,'0')}/${r.ano} • Q${r.quinzena}</td><td>${fmtBRL(r.valor_parcela)}</td><td><span class="tag tag-yellow">Pendente</span></td></tr>`;
    });
    html+='</tbody></table></div>';
    box.innerHTML=html;
  }

  function computeTotals(diarioRows, diaria, valorEntrega){
    const entregas = diarioRows.reduce((s,r)=>s+Number(r.quantidade||0),0);
    const totalEntregas = entregas * valorEntrega;
    // regra simples: diária/fixo é um valor do período (como no seu Excel base). Se quiser por dia, a gente evolui depois.
    const totalBruto = totalEntregas + diaria;
    return {entregas, totalEntregas, totalBruto};
  }

  async function preview(){
    const usuario_id=document.getElementById('fUser').value;
    const quinzena=document.getElementById('fQuinzena').value;
    const mes=document.getElementById('fMes').value;
    const ano=document.getElementById('fAno').value;

    const diaria=parseBR(document.getElementById('vDiaria').value);
    const valorEntrega=parseBR(document.getElementById('vEntrega').value);

    const diarioRows=parseDiario(document.getElementById('txtDiario').value);
    document.getElementById('diarioStatus').textContent = `${diarioRows.length} linhas lidas.`;

    const {entregas,totalBruto}=computeTotals(diarioRows, diaria, valorEntrega);

    const empPrev=await loadParcelasPreview(usuario_id, ano, mes, quinzena);
    renderParcelas(document.getElementById('parcelasBox'), empPrev.rows);

    document.getElementById('kEnt').textContent=String(entregas);
    document.getElementById('kBruto').textContent=fmtBRL(totalBruto);
    document.getElementById('kEmp').textContent=fmtBRL(empPrev.total);
    document.getElementById('kLiq').textContent=fmtBRL(totalBruto - empPrev.total);

    document.getElementById('msg').textContent = 'Prévia pronta. Ao salvar, o desconto de empréstimo será aplicado e marcado como aplicado.';

    return {usuario_id, ano, mes:Number(mes), quinzena:Number(quinzena), diaria, valorEntrega, diarioRows, empPrev, totalBruto};
  }

  async function salvar(){
    const data = await preview();
    if(!data.usuario_id) return alert('Selecione o colaborador.');
    if(!data.diarioRows || !data.diarioRows.length) return alert('Cole o diário (DATA x QUANTIDADE).');

    // criado_por: tenta pegar do localStorage (admin)
    let criadoPor=null;
    try{
      const u = getUserFromStorage ? getUserFromStorage() : null;
      criadoPor = u && u.id ? u.id : null;
    }catch(e){}

    const diario_rows = (data.diarioRows||[]).map(r=>({
      data: r.data,
      quantidade: r.quantidade,
      valor_entrega: data.valorEntrega,
      obs: ''
    }));

    const resp = await fetch('/api/fechamentos_quinzena', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        usuario_id: Number(data.usuario_id),
        ano: Number(data.ano),
        mes: Number(data.mes),
        quinzena: Number(data.quinzena),
        diaria: Number(data.diaria),
        valor_entrega: Number(data.valorEntrega),
        obs: '',
        diario_rows,
        criado_por: criadoPor
      })
    });

    const r = await resp.json();
    if(!resp.ok) return alert('Erro ao salvar fechamento quinzenal.');

    document.getElementById('msg').textContent = `Fechamento salvo (#${r.fechamento_id}). Desconto empréstimo aplicado: ${fmtBRL(r.desconto_emprestimo)}.`;
    alert(`Fechamento salvo (#${r.fechamento_id}).
Bruto: ${fmtBRL(r.bruto)}
Desconto empréstimo: ${fmtBRL(r.desconto_emprestimo)}
Líquido: ${fmtBRL(r.liquido)}`);

    await preview();
  }

document.getElementById('btnPreview')?.addEventListener('click', preview);
  document.getElementById('btnSalvar')?.addEventListener('click', salvar);
  document.getElementById('btnLimpar')?.addEventListener('click', ()=>{ document.getElementById('txtDiario').value=''; document.getElementById('diarioStatus').textContent=''; });

  buildMonthYear();
  loadUsers();
})();
