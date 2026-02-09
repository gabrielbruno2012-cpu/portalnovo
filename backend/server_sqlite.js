const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require("multer");
const sqlite3 = require('sqlite3').verbose();

const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// liberar acesso público aos uploads
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"))
);


// Caminho do banco correto
const DB = path.join(__dirname, "sql", "coelholog.db");
const db = new sqlite3.Database(DB);

// ======================================
// LOGIN
// ======================================
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    db.get(
        `SELECT id, nome, email, role 
         FROM usuarios 
         WHERE email = ? AND senha = ?`,
        [email, password],
        (err, row) => {
            if (err) return res.status(500).json({ error: 'db' });
            if (!row) return res.status(401).json({ error: 'invalid' });
            res.json(row);
        }
    );
});

// ======================================
// USUÁRIOS
// ======================================
app.get('/api/usuarios', (req, res) => {
    db.all(
        `SELECT id, nome, email, role, cnpj, telefone 
         FROM usuarios ORDER BY id`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'db' });
            res.json(rows);
        }
    );
});

app.post('/api/usuarios', (req, res) => {
    const { nome, email, senha, role, cnpj, telefone } = req.body;

    db.get(
        `SELECT id FROM usuarios WHERE email = ?`,
        [email],
        (err, row) => {
            if (row) return res.status(409).json({ error: 'exists' });

            db.run(
                `INSERT INTO usuarios (nome, email, senha, role, cnpj, telefone)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [nome, email, senha, role || 'colaborador', cnpj || '', telefone || ''],
                function (err2) {
                    if (err2) return res.status(500).json({ error: 'db' });

                    db.get(
                        `SELECT id, nome, email, role 
                         FROM usuarios WHERE id = ?`,
                        [this.lastID],
                        (err3, user) => {
                            res.json(user);
                        }
                    );
                }
            );
        }
    );
});

// ======================================
// RECEBÍVEIS
// ======================================
app.get('/api/recebiveis', (req, res) => {
    const userId = req.query.user_id;

    let sql = `
        SELECT r.id, r.usuario_id, u.nome, r.data, r.valor, r.tipo, r.status
        FROM recebiveis r
        LEFT JOIN usuarios u ON u.id = r.usuario_id
    `;

    const params = [];

    if (userId) {
        sql += ` WHERE r.usuario_id = ?`;
        params.push(userId);
    }

    sql += ` ORDER BY r.id DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'db' });
        res.json(rows);
    });
});

app.post('/api/recebiveis', (req, res) => {
    const { usuario_id, data, valor, tipo, status } = req.body;

    db.run(
        `INSERT INTO recebiveis (usuario_id, data, valor, tipo, status)
         VALUES (?, ?, ?, ?, ?)`,
        [usuario_id, data, valor, tipo, status || 'Pendente'],
        function (err) {
            if (err) return res.status(500).json({ error: 'db' });
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/recebiveis/:id', (req, res) => {
    const id = req.params.id;
    const { data, valor, tipo, status } = req.body;

    db.run(
        `UPDATE recebiveis 
         SET data = ?, valor = ?, tipo = ?, status = ? 
         WHERE id = ?`,
        [data, valor, tipo, status, id],
        function (err) {
            if (err) return res.status(500).json({ error: 'db' });
            res.json({ ok: true });
        }
    );
});

// ======================================
// EMPRÉSTIMOS (AUTO PARCELAS / DESCONTO QUINZENAL)
// ======================================

function getQuinzenaFromDate(dateObj){
  const d = dateObj.getDate();
  return d <= 15 ? 1 : 2;
}

function addMonths(year, month, delta){
  // month 1-12
  let y=year, m=month+delta;
  while(m>12){m-=12;y+=1;}
  while(m<1){m+=12;y-=1;}
  return {year:y, month:m};
}

function nextQuinzenaRef(fromDate){
  const y=fromDate.getFullYear();
  const m=fromDate.getMonth()+1;
  const q=getQuinzenaFromDate(fromDate);
  if(q===1) return {ano:y, mes:m, quinzena:2};
  const nm=addMonths(y,m,1);
  return {ano:nm.year, mes:nm.month, quinzena:1};
}

function parcelaRefAt(start, step){
  // step 0 => start, step 1 => próxima quinzena, etc.
  let ano=start.ano, mes=start.mes, quinzena=start.quinzena;
  for(let i=0;i<step;i++){
    if(quinzena===1){ quinzena=2; }
    else { quinzena=1; const nm=addMonths(ano, mes, 1); ano=nm.year; mes=nm.month; }
  }
  return {ano, mes, quinzena};
}

function createParcelasForEmprestimo(db, emprestimo){
  return new Promise((resolve,reject)=>{
    const total=Number(emprestimo.valor||0);
    const n=Math.max(1, Number(emprestimo.parcelamentos||1));
    const base = Math.floor((total / n) * 100) / 100;
    const diff = Math.round((total - base*n) * 100) / 100;
    const start = nextQuinzenaRef(new Date());

    db.serialize(()=>{
      const stmt=db.prepare(`INSERT OR IGNORE INTO emprestimo_parcelas
        (emprestimo_id, usuario_id, parcela_num, total_parcelas, valor_parcela, ano, mes, quinzena, status, criado_em)
        VALUES (?,?,?,?,?,?,?,?, 'pendente', datetime('now'))`);

      for(let i=1;i<=n;i++){
        const step=i-1;
        const ref=parcelaRefAt(start, step);
        const valorParcela = (i===1) ? Math.round((base+diff)*100)/100 : base;
        stmt.run([emprestimo.id, emprestimo.usuario_id, i, n, valorParcela, ref.ano, ref.mes, ref.quinzena]);
      }

      stmt.finalize((err)=>{
        if(err) return reject(err);
        resolve({ok:true, parcelas:n, start});
      });
    });
  });
}

function applyParcelasForUsuarioPeriodo(db, usuario_id, ano, mes, quinzena){
  return new Promise((resolve,reject)=>{
    db.all(`SELECT * FROM emprestimo_parcelas
            WHERE usuario_id=? AND ano=? AND mes=? AND quinzena=? AND status='pendente'
            ORDER BY criado_em ASC, id ASC`,
      [usuario_id, ano, mes, quinzena],
      (err, rows)=>{
        if(err) return reject(err);
        if(!rows || !rows.length) return resolve({total:0, parcelas:[]});

        const total = rows.reduce((s,r)=>s+Number(r.valor_parcela||0),0);
        const ids = rows.map(r=>r.id);
        db.run(`UPDATE emprestimo_parcelas
                SET status='aplicada', aplicada_em=datetime('now')
                WHERE id IN (${ids.map(()=>'?').join(',')})`,
          ids,
          (err2)=>{
            if(err2) return reject(err2);
            resolve({total, parcelas: rows});
          });
      });
  });
}

function getResumoEmprestimoUsuario(db, usuario_id){
  return new Promise((resolve,reject)=>{
    db.all(`SELECT e.id as emprestimo_id, e.valor, e.parcelamentos, e.status, e.criado_em,
                   SUM(CASE WHEN p.status='aplicada' THEN 1 ELSE 0 END) as parcelas_aplicadas,
                   SUM(CASE WHEN p.status='aplicada' THEN p.valor_parcela ELSE 0 END) as total_descontado
            FROM emprestimos e
            LEFT JOIN emprestimo_parcelas p ON p.emprestimo_id=e.id
            WHERE e.usuario_id=?
            GROUP BY e.id
            ORDER BY e.id DESC`,
      [usuario_id],
      (err, rows)=>{
        if(err) return reject(err);
        resolve(rows||[]);
      });
  });
}

// ======================================
// EMPRÉSTIMOS
// ======================================
app.get('/api/emprestimos', (req, res) => {
    const userId = req.query.user_id;

    let sql = `
        SELECT e.id, e.usuario_id, u.nome, e.valor, 
               e.parcelamentos, e.status, e.criado_em
        FROM emprestimos e
        LEFT JOIN usuarios u ON u.id = e.usuario_id
    `;

    const params = [];

    if (userId) {
        sql += ` WHERE e.usuario_id = ?`;
        params.push(userId);
    }

    sql += ` ORDER BY e.id DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'db' });
        res.json(rows);
    });
});

app.post('/api/emprestimos', (req, res) => {
    const { usuario_id, valor, parcelamentos } = req.body;

    db.get(
        `SELECT id FROM emprestimos 
         WHERE usuario_id = ? AND status IN ("Em análise", "Aprovado")`,
        [usuario_id],
        (err, row) => {
            if (row) {
                return res.status(400).json({ error: 'Já existe um empréstimo ativo' });
            }

            db.run(
                `INSERT INTO emprestimos 
                 (usuario_id, valor, parcelamentos, status, criado_em)
                 VALUES (?, ?, ?, ?, datetime("now"))`,
                [usuario_id, valor, parcelamentos, 'Em análise'],
                function (err2) {
                    if (err2) return res.status(500).json({ error: 'db' });
                    res.json({ id: this.lastID, status: 'Em análise' });
                }
            );
        }
    );
});

app.put('/api/emprestimos/:id', (req, res) => {
    const { status, valor, parcelamentos } = req.body;
    const id = req.params.id;

    db.run(
        `UPDATE emprestimos 
         SET status = ?, valor = ?, parcelamentos = ?
         WHERE id = ?`,
        [status, valor, parcelamentos, id],
        function (err) {
            if (err) return res.status(500).json({ error: 'db' });
            res.json({ ok: true });
        }
    );
});



// ======================================
// EMPRÉSTIMOS - GERAR PARCELAS (AO APROVAR)
// ======================================
app.post('/api/emprestimos/:id/gerar-parcelas', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM emprestimos WHERE id=?', [id], async (err, emp) => {
    if (err) return res.status(500).json({ error: 'db' });
    if (!emp) return res.status(404).json({ error: 'not_found' });
    if (String(emp.status).toLowerCase() !== 'aprovado') {
      return res.status(400).json({ error: 'status_not_aprovado' });
    }

    try {
      const r = await createParcelasForEmprestimo(db, emp);
      res.json({ ok: true, ...r });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'db' });
    }
  });
});

// ======================================
// EMPRÉSTIMOS - PARCELAS PENDENTES DO PERÍODO
// ======================================
app.get('/api/emprestimos/parcelas', (req, res) => {
  const { usuario_id, ano, mes, quinzena } = req.query;
  if (!usuario_id || !ano || !mes || !quinzena) return res.status(400).json({ error: 'params' });
  db.all(`SELECT * FROM emprestimo_parcelas
          WHERE usuario_id=? AND ano=? AND mes=? AND quinzena=?
          ORDER BY id ASC`,
    [usuario_id, ano, mes, quinzena],
    (err, rows)=>{
      if(err) return res.status(500).json({ error:'db' });
      res.json(rows||[]);
    });
});

// ======================================
// EMPRÉSTIMOS - APLICAR DESCONTO DA QUINZENA (RETORNA TOTAL + MARCA APLICADA)
// ======================================
app.post('/api/emprestimos/aplicar-desconto', async (req, res) => {
  const { usuario_id, ano, mes, quinzena } = req.body;
  if (!usuario_id || !ano || !mes || !quinzena) return res.status(400).json({ error: 'params' });
  try {
    const r = await applyParcelasForUsuarioPeriodo(db, usuario_id, Number(ano), Number(mes), Number(quinzena));
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db' });
  }
});

// ======================================
// EMPRÉSTIMOS - RESUMO DO USUÁRIO
// ======================================
app.get('/api/emprestimos/resumo', async (req, res) => {
  const { usuario_id } = req.query;
  if (!usuario_id) return res.status(400).json({ error: 'params' });
  try {
    const rows = await getResumoEmprestimoUsuario(db, usuario_id);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'db' });
  }
});



// ======================================
// FECHAMENTO QUINZENAL (HISTÓRICO + AUDITORIA)
// ======================================
app.post('/api/fechamentos_quinzena', async (req, res) => {
  const {
    usuario_id, ano, mes, quinzena,
    diaria, valor_entrega,
    obs, diario_rows,
    criado_por
  } = req.body || {};

  if(!usuario_id || !ano || !mes || !quinzena) return res.status(400).json({ error: 'params' });

  const entTotal = (diario_rows||[]).reduce((s,r)=>s+Number(r.quantidade||0),0);
  const diariaN = Number(diaria||0);
  const valorEnt = Number(valor_entrega||0);
  const bruto = entTotal * valorEnt + diariaN;

  try{
    // aplica desconto de empréstimo automaticamente e marca aplicada
    const emp = await applyParcelasForUsuarioPeriodo(db, Number(usuario_id), Number(ano), Number(mes), Number(quinzena));
    const descontoEmp = Number(emp.total||0);
    const descontosOutros = 0;
    const liquido = bruto - descontoEmp - descontosOutros;

    db.serialize(()=>{
      // upsert (substitui fechamento do período)
      db.run(`INSERT INTO fechamentos_quinzena
          (usuario_id, ano, mes, quinzena, diaria, valor_entrega, entregas_total, bruto, desconto_emprestimo, descontos_outros, liquido, obs, criado_por, criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
          ON CONFLICT(usuario_id, ano, mes, quinzena) DO UPDATE SET
            diaria=excluded.diaria,
            valor_entrega=excluded.valor_entrega,
            entregas_total=excluded.entregas_total,
            bruto=excluded.bruto,
            desconto_emprestimo=excluded.desconto_emprestimo,
            descontos_outros=excluded.descontos_outros,
            liquido=excluded.liquido,
            obs=excluded.obs,
            criado_por=excluded.criado_por,
            criado_em=datetime('now')
        `,
        [usuario_id, ano, mes, quinzena, diariaN, valorEnt, entTotal, bruto, descontoEmp, descontosOutros, liquido, obs||'', criado_por||null],
        function(err){
          if(err){ console.error(err); return res.status(500).json({ error:'db' }); }

          // obter id do fechamento
          db.get(`SELECT id FROM fechamentos_quinzena WHERE usuario_id=? AND ano=? AND mes=? AND quinzena=?`,
            [usuario_id, ano, mes, quinzena],
            (err2, row)=>{
              if(err2 || !row){ console.error(err2); return res.status(500).json({ error:'db' }); }
              const fechamentoId=row.id;

              // limpar diário antigo e inserir novo
              db.run('DELETE FROM fechamento_diario WHERE fechamento_id=?', [fechamentoId], (err3)=>{
                if(err3){ console.error(err3); return res.status(500).json({ error:'db' }); }

                const stmt=db.prepare(`INSERT INTO fechamento_diario
                  (fechamento_id, data, quantidade, valor_entrega, total_entregas, obs, criado_em)
                  VALUES (?,?,?,?,?,?, datetime('now'))`);

                (diario_rows||[]).forEach(r=>{
                  const qtd=Number(r.quantidade||0);
                  const ve=Number(r.valor_entrega||valorEnt||0);
                  const tot=qtd*ve;
                  stmt.run([fechamentoId, r.data, qtd, ve, tot, r.obs||'']);
                });

                stmt.finalize(()=>{
                  // auditoria
                  const payload = JSON.stringify({ usuario_id, ano, mes, quinzena, diaria:diariaN, valor_entrega:valorEnt, entregas_total:entTotal, bruto, descontoEmp, liquido, parcelas_aplicadas:(emp.parcelas||[]).map(p=>p.id) });
                  db.run(`INSERT INTO auditoria_fechamento (fechamento_id, acao, payload, criado_por, criado_em)
                          VALUES (?,?,?,?, datetime('now'))`,
                    [fechamentoId, 'SALVAR_FECHAMENTO', payload, criado_por||null],
                    ()=>{
                      return res.json({ ok:true, fechamento_id:fechamentoId, bruto, desconto_emprestimo:descontoEmp, liquido, parcelas_aplicadas: emp.parcelas||[] });
                    });
                });
              });
            });
        });
    });

  } catch(e){
    console.error(e);
    return res.status(500).json({ error:'db' });
  }
});

app.get('/api/fechamentos_quinzena', (req, res) => {
  const { usuario_id, ano, mes, quinzena } = req.query;
  if(!usuario_id || !ano || !mes || !quinzena) return res.status(400).json({ error:'params' });
  db.get(`SELECT * FROM fechamentos_quinzena WHERE usuario_id=? AND ano=? AND mes=? AND quinzena=?`,
    [usuario_id, ano, mes, quinzena],
    (err, row)=>{
      if(err) return res.status(500).json({ error:'db' });
      if(!row) return res.json(null);
      db.all(`SELECT * FROM fechamento_diario WHERE fechamento_id=? ORDER BY data ASC`,
        [row.id],
        (err2, rows)=>{
          if(err2) return res.status(500).json({ error:'db' });
          res.json({ ...row, diario: rows||[] });
        });
    });
});

app.get('/api/fechamentos_quinzena/listar', (req,res)=>{
  const { ano, mes, quinzena } = req.query;
  let sql=`SELECT f.*, u.nome FROM fechamentos_quinzena f LEFT JOIN usuarios u ON u.id=f.usuario_id`;
  const params=[];
  const wh=[];
  if(ano){ wh.push('f.ano=?'); params.push(ano); }
  if(mes){ wh.push('f.mes=?'); params.push(mes); }
  if(quinzena){ wh.push('f.quinzena=?'); params.push(quinzena); }
  if(wh.length) sql += ' WHERE ' + wh.join(' AND ');
  sql += ' ORDER BY f.ano DESC, f.mes DESC, f.quinzena DESC, f.id DESC';
  db.all(sql, params, (err, rows)=>{
    if(err) return res.status(500).json({ error:'db' });
    res.json(rows||[]);
  });
});

app.get('/api/fechamentos_quinzena/auditoria', (req,res)=>{
  const { fechamento_id } = req.query;
  if(!fechamento_id) return res.status(400).json({ error:'params' });
  db.all(`SELECT * FROM auditoria_fechamento WHERE fechamento_id=? ORDER BY id DESC`,
    [fechamento_id],
    (err, rows)=>{
      if(err) return res.status(500).json({ error:'db' });
      res.json(rows||[]);
    });
});

// ======================================
// CLIENTES EMPRESAS
// ======================================
app.get('/api/clientes', (req, res) => {
    db.all(
        `SELECT * FROM clientes_empresas ORDER BY id DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'db' });
            res.json(rows);
        }
    );
});

app.post('/api/clientes', (req, res) => {
    const { nome, cnpj, telefone, email, endereco, obs } = req.body;

    db.run(
        `INSERT INTO clientes_empresas 
         (nome, cnpj, telefone, email, endereco, obs)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nome, cnpj, telefone, email, endereco, obs],
        function (err) {
            if (err) return res.status(500).json({ error: 'db' });
            res.json({ id: this.lastID });
        }
    );
});

// ======================================
// FATURAMENTO
// ======================================
app.get('/api/faturamento', (req, res) => {
    db.all(
        `SELECT 
            f.id,
            f.cliente_id,
            c.nome AS cliente_nome,
            f.mes,
            f.ano,
            f.valor,
            f.obs,
            f.criado_em
        FROM faturamento f
        LEFT JOIN clientes_empresas c 
               ON c.id = f.cliente_id
        ORDER BY f.id DESC`,
        [],
        (err, rows) => {
            if (err) {
    console.error("ERRO SQLITE:", err);
    return res.status(500).json({ error: 'db' });
}
            res.json(rows);
        }
    );
});

app.get('/api/faturamento/cliente/:id', (req, res) => {
    const id = req.params.id;

    db.all(
        `SELECT 
            f.id,
            f.cliente_id,
            c.nome AS cliente_nome,
            f.mes,
            f.ano,
            f.valor,
            f.obs,
            f.criado_em
        FROM faturamento f
        LEFT JOIN clientes_empresas c 
               ON c.id = f.cliente_id
        WHERE f.cliente_id = ?
        ORDER BY f.id DESC`,
        [id],
        (err, rows) => {
           if (err) {
    console.error("ERRO SQLITE:", err);
    return res.status(500).json({ error: 'db' });
}
            res.json(rows);
        }
    );
});

app.post('/api/faturamento', (req, res) => {
    const { cliente_id, mes, ano, valor, observacoes } = req.body;
    const obs = observacoes || "";


    db.run(
        `INSERT INTO faturamento 
         (cliente_id, mes, ano, valor, obs, criado_em)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [cliente_id, mes, ano, valor, obs || ""],
        function (err) {
            if (err) {
    console.error("ERRO SQLITE:", err);
    return res.status(500).json({ error: 'db' });
}
            res.json({
                id: this.lastID,
                cliente_id,
                mes,
                ano,
                valor,
                obs
            });
        }
    );
});

/// ============================
//   LANÇAR PRODUÇÃO (CORRIGIDO)
// ============================



// ===== PRODUÇÃO: DESCONTO AUTOMÁTICO DE EMPRÉSTIMO POR COMPETÊNCIA (Opção B) =====
function quinzenaFromISO(iso){
  try{ const d = Number(String(iso||'').split('-')[2]); return d<=15?1:2; }catch(e){ return null; }
}

function aplicarParcelasEmprestimo(usuario_id, dataISO, cb){
  const q = quinzenaFromISO(dataISO);
  if(!q) return cb(null, { total:0, parcelas:[] });
  const [anoS, mesS] = String(dataISO).split('-');
  const ano = Number(anoS);
  const mes = Number(mesS);

  db.all(`SELECT * FROM emprestimo_parcelas WHERE usuario_id=? AND ano=? AND mes=? AND quinzena=? AND status!='aplicada' ORDER BY id ASC`,
    [usuario_id, ano, mes, q],
    (err, rows)=>{
      if(err) return cb(err);
      if(!rows || !rows.length) return cb(null, { total:0, parcelas:[] });
      const total = rows.reduce((s,r)=> s + Number(r.valor_parcela||0), 0);
      const ids = rows.map(r=>r.id);
      const placeholders = ids.map(()=>'?').join(',');
      db.run(`UPDATE emprestimo_parcelas SET status='aplicada', aplicada_em=datetime('now') WHERE id IN (${placeholders}) AND status!='aplicada'`, ids, (e2)=>{
        if(e2) return cb(e2);
        cb(null, { total, parcelas: rows });
      });
    }
  );
}
app.post('/api/producao', (req, res) => {
    const {
        usuario_id,
        data,
        entregas,
        valor_por_entrega,
        producao_fs,
        valor_fs,
        producao_bobina,
        valor_bobina,
        fixo_diaria,
        desconto,
        total_calculado,
        obs
    } = req.body;

    if (!usuario_id || !data) {
        return res.status(400).json({ error: "missing_params" });
    }

    const sql = `
        INSERT INTO producao_colaborador (
            usuario_id,
            data,
            entregas,
            valor_por_entrega,
            producao_fs,
            valor_fs,
            producao_bobina,
            valor_bobina,
            fixo_diaria,
            desconto,
            total_calculado,
            obs,
            criado_em
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `;

    const params = [
        usuario_id,
        data,
        entregas,
        valor_por_entrega,
        producao_fs,
        valor_fs,
        producao_bobina,
        valor_bobina,
        fixo_diaria,
        desconto,
        total_calculado,
        obs || ""
    ];

    aplicarParcelasEmprestimo(usuario_id, data, (eLoan, loanOut)=>{
      if (eLoan) {
        console.error(eLoan);
        return res.status(500).json({ error: 'loan_apply_failed' });
      }
      const descontoAuto = Number((loanOut||{}).total||0);
      params[9] = Number(params[9]||0) + descontoAuto;
      params[10] = Number(params[10]||0) - descontoAuto;

      db.run(sql, params, function (err) {
        if (err) {
            console.log("Erro INSERT produção:", err);
            return res.status(500).json({ error: "db" });
        }

        res.json({ ok: true, id: this.lastID, desconto_auto: descontoAuto });
      });
    });
});


// ======================================
// PRODUÇÃO - BUSCAR POR COLABORADOR
// ======================================
app.get('/api/producao/colaborador', (req, res) => {
    const { usuario_id, mes, ano } = req.query;

    if (!usuario_id || !mes || !ano) {
        return res.status(400).json({ error: "params" });
    }

    const sql = `
        SELECT 
            p.id,
            p.usuario_id,
            u.nome AS colaborador,
            p.data,
            p.entregas,
            p.valor_por_entrega,
            p.producao_fs,
            p.valor_fs,
            p.producao_bobina,
            p.valor_bobina,
            p.fixo_diaria,
            p.desconto,
            p.total_calculado,
            p.obs,
            p.nota,
            p.nota_status
        FROM producao_colaborador p
        LEFT JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.usuario_id = ?
          AND strftime('%m', p.data) = ?
          AND strftime('%Y', p.data) = ?
        ORDER BY p.data ASC
    `;

    db.all(sql, [usuario_id, mes, ano], (err, rows) => {
        if (err) {
            console.log("Erro SELECT produção:", err);
            return res.status(500).json({ error: "db" });
        }

        res.json(rows);
    });
});

// ======================================
// UPLOAD NOTA 
// ======================================
// pasta onde vão ficar as notas
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, "uploads/notas/");
    },
    filename: function(req, file, cb) {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// ======================================
// UPLOAD DE NOTA (COM TRAVA)
// ======================================

app.post("/api/producao/enviar-nota", upload.single("nota"), (req, res) => {
    const { producao_id, usuario_id } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: "Arquivo não enviado" });
    }

    const arquivo = req.file.filename;

    // 1️⃣ Verificar se a produção existe e se a nota pode ser enviada
    db.get(`
        SELECT nota_status 
        FROM producao_colaborador 
        WHERE id = ? AND usuario_id = ?
    `, [producao_id, usuario_id], (err, row) => {

        if (!row) {
            return res.status(404).json({ error: "Produção não encontrada" });
        }

        // Se já enviou e está pendente ou aprovado → TRAVA
        if (row.nota_status === "pendente" || row.nota_status === "aprovado") {
            return res.status(403).json({
                error: "Nota já enviada. Aguarde análise do administrador."
            });
        }

        // 2️⃣ Permitir envio caso esteja recusada ou null
        db.run(`
            UPDATE producao_colaborador
            SET nota = ?, nota_status = 'pendente'
            WHERE id = ? AND usuario_id = ?
        `, [arquivo, producao_id, usuario_id], (err2) => {

            if (err2) {
                return res.status(500).json({ error: "Erro ao salvar nota" });
            }

            res.json({
                success: true,
                file: arquivo,
                status: "pendente"
            });
        });
    });
});

// ======================================
// ADMIN - APROVAR NOTA
// ======================================
app.put("/api/producao/aprovar-nota/:id", (req, res) => {
    db.run(`
        UPDATE producao_colaborador
        SET nota_status = 'aprovado'
        WHERE id = ?
    `, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: "db" });
        res.json({ ok: true });
    });
});

// ======================================
// ADMIN - RECUSAR NOTA
// ======================================
app.put("/api/producao/recusar-nota/:id", (req, res) => {
    db.run(`
        UPDATE producao_colaborador
        SET nota = NULL,
            nota_status = 'recusado'
        WHERE id = ?
    `, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: "db" });
        res.json({ ok: true });
    });
});

// ======================================
// ADMIN – LISTAR TODAS AS PRODUÇÕES PENDENTES
// ======================================
app.get("/api/producao/pendentes", (req, res) => {
    const sql = `
        SELECT 
            p.id,
            p.data,
            p.total_calculado,
            p.nota,
            p.nota_status,
            u.nome AS colaborador
        FROM producao_colaborador p
        LEFT JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.nota_status = 'pendente'
        ORDER BY p.data DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: "db" });
        res.json(rows);
    });
});

// ======================================
// API CAMPANHA
// ======================================
app.post("/api/campanhas/criar", (req, res) => {
    const { nome, periodo_inicio, periodo_fim, meta_sla, tema } = req.body;

    const sql = `
        INSERT INTO campanhas (nome, periodo_inicio, periodo_fim, meta_sla, tema)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [nome, periodo_inicio, periodo_fim, meta_sla, tema], function(err){
        if(err) return res.status(500).json({ erro: err.message });

        res.json({ sucesso: true, campanha_id: this.lastID });
    });
});

app.get("/api/campanhas/listar", (req, res) => {
    db.all("SELECT * FROM campanhas ORDER BY id DESC", [], (err, rows) => {
        if(err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post("/api/campanhas/ativar", (req, res) => {
    const { campanha_id } = req.body;

    db.serialize(() => {
        db.run("UPDATE campanhas SET ativa = 0");
        db.run("UPDATE campanhas SET ativa = 1 WHERE id = ?", [campanha_id], function(err){
            if(err) return res.status(500).json({ erro: err.message });
            res.json({ sucesso: true });
        });
    });
});

app.get("/api/campanhas/ativa", (req, res) => {
    db.get("SELECT * FROM campanhas WHERE ativa = 1 LIMIT 1", [], (err, row) => {
        if(err) return res.status(500).json({ erro: err.message });
        res.json(row || {});
    });
});

// ==========================
//  Registrar SLA
// ==========================
app.post("/api/campanha/sla/registrar", (req, res) => {
    const { campanha_id, periodo, sla_percentual } = req.body;

    db.run(`
        INSERT INTO campanha_sla (campanha_id, periodo, sla_percentual, criado_em)
        VALUES (?, ?, ?, datetime('now'))
    `,
    [campanha_id, periodo, sla_percentual],
    (err) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

// ==========================
//  Listar SLA da campanha
// ==========================
app.get("/api/campanha/sla/listar", (req, res) => {
    const { campanha_id } = req.query;

    db.all(`
        SELECT * 
        FROM campanha_sla
        WHERE campanha_id = ?
        ORDER BY id DESC
    `, 
    [campanha_id],
    (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});


app.post("/api/incentivos/pontos/registrar", (req, res) => {
    const { courier_id, campanha_id, periodo, pontos, motivo } = req.body;

    db.run(`
        INSERT INTO campanha_pontos (courier_id, campanha_id, periodo, pontos, motivo, criado_em)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
    `,
    [courier_id, campanha_id, periodo, pontos, motivo],
    (err) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});



app.get("/api/incentivos/pontos/usuario", (req, res) => {
    const { courier_id, campanha_id } = req.query;

    db.all(`
        SELECT pontos 
        FROM campanha_pontos
        WHERE courier_id = ? AND campanha_id = ?
    `,
    [courier_id, campanha_id],
    (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});



app.post("/api/incentivos/bonus/registrar", (req, res) => {
    const { campanha_id, titulo, descricao, valor, data } = req.body;

    db.run(`
        INSERT INTO campanha_bonus 
        (campanha_id, titulo, descricao, valor, data, ativo, criado_em)
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `,
    [campanha_id, titulo, descricao, valor, data],
    function(err){
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true, id: this.lastID });
    });
});


app.get("/api/incentivos/bonus/listar", (req, res) => {
    const { campanha_id } = req.query;

    db.all(`
        SELECT * 
        FROM campanha_bonus
        WHERE campanha_id = ?
        ORDER BY id DESC
    `,
    [campanha_id],
    (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.put("/api/incentivos/bonus/editar", (req, res) => {
    const { id, titulo, descricao, valor, data } = req.body;

    db.run(`
        UPDATE campanha_bonus
        SET titulo = ?, descricao = ?, valor = ?, data = ?
        WHERE id = ?
    `,
    [titulo, descricao, valor, data, id],
    function(err){
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

app.put("/api/incentivos/bonus/status", (req, res) => {
    const { id, ativo } = req.body;

    db.run(`
        UPDATE campanha_bonus
        SET ativo = ?
        WHERE id = ?
    `,
    [ativo, id],
    function(err){
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

app.get("/api/incentivos/bonus/colaborador", async (req, res) => {

    // 1 — Buscar campanha ativa
    db.get(`SELECT id FROM campanhas WHERE ativa = 1`, [], (err, campanha) => {
        if (err) return res.status(500).json({ erro: err.message });

        if (!campanha) return res.json([]);

        // 2 — Buscar bônus ativos dessa campanha
        db.all(`
            SELECT titulo, descricao, valor
            FROM campanha_bonus
            WHERE campanha_id = ? AND ativo = 1
            ORDER BY id DESC
        `,
        [campanha.id],
        (err2, rows) => {
            if (err2) return res.status(500).json({ erro: err2.message });
            res.json(rows);
        });
    });
});



app.get("/api/incentivos/bonus/usuario", (req, res) => {
    const courier_id = req.query.courier_id;

    db.all("SELECT * FROM bonus_historico WHERE courier_id = ?", [courier_id], (err, rows) => {
        if(err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post("/api/campanha/ranking/recalcular", (req, res) => {
    const { campanha_id } = req.body;

    const sql = `
        SELECT courier_id, SUM(pontos) AS total
        FROM incentivos_pontos
        WHERE campanha_id = ?
        GROUP BY courier_id
        ORDER BY total DESC
    `;

    db.all(sql, [campanha_id], (err, rows) => {
        if(err) return res.status(500).json({ erro: err.message });

        db.run("DELETE FROM campanha_ranking WHERE campanha_id = ?", [campanha_id]);

        let pos = 1;

        rows.forEach(r => {
            db.run(`
                INSERT INTO campanha_ranking (campanha_id, courier_id, pontos_total, posicao)
                VALUES (?, ?, ?, ?)
            `, [campanha_id, r.courier_id, r.total, pos]);
            pos++;
        });

        res.json({ sucesso: true });
    });
});

// RANKING DA CAMPANHA ATIVA
app.get("/api/campanha/ranking", (req, res) => {
    const campanha_id = req.query.campanha_id;

    const sql = `
        SELECT u.nome,
               COALESCE(SUM(p.pontos), 0) AS pontos_total
        FROM usuarios u
        LEFT JOIN campanha_pontos p 
               ON p.courier_id = u.id 
               AND p.campanha_id = ?
        GROUP BY u.id
        HAVING pontos_total > 0
        ORDER BY pontos_total DESC
    `;

    db.all(sql, [campanha_id], (err, rows) => {
        if(err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});



// ======================================
// API - REGISTRAR PONTOS - LISTA DE USUARIO
// ======================================

app.get("/api/usuarios/listar", (req, res) => {
    const sql = "SELECT id, nome, email FROM usuarios ORDER BY nome ASC";

    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ erro: err.message });
        }
        res.json(rows);
    });
});

// ===============================
// API - Registrar múltiplos bônus
// ===============================
// ===================================================
// API - Registrar múltiplos bônus da mesma campanha
// Tabela correta: bonus_historico
// ===================================================
app.post("/api/bonus/add-multiple", (req, res) => {
    const { campanha_id, bonus } = req.body;

    if (!campanha_id || !Array.isArray(bonus) || bonus.length === 0) {
        return res.status(400).json({ error: "Dados inválidos" });
    }

    const sql = `
        INSERT INTO bonus_historico (campanha_id, titulo, descricao, valor)
        VALUES (?, ?, ?, ?)
    `;

    db.serialize(() => {
        const stmt = db.prepare(sql);

        bonus.forEach(b => {
            stmt.run(
                campanha_id,
                b.nome,        // vira "titulo" no banco
                b.descricao,
                b.valor,
                err => {
                    if (err) {
                        console.error("Erro ao registrar bônus:", err);
                    }
                }
            );
        });

        stmt.finalize(err => {
            if (err) {
                console.error("Erro ao finalizar registro de bônus:", err);
                return res.status(500).json({ error: "Erro ao salvar bônus" });
            }

            res.json({
                success: true,
                message: "Histórico de bônus registrado com sucesso!"
            });
        });
    });
});

// ============================
// LISTAR CAMPANHAS ATIVAS
// ============================
app.get("/api/campanhas", (req, res) => {
    db.all("SELECT * FROM campanhas ORDER BY id DESC", (err, rows) => {
        if (err) {
            console.error("Erro ao buscar campanhas:", err);
            return res.status(500).json({ error: "Erro interno" });
        }
        res.json(rows);
    });
});

// ======================================
// CAMPANHA - LISTAR BÔNUS DA CAMPANHA (NOVA)
// ======================================
app.get("/api/campanha/bonus/listar", (req, res) => {
    const campanha_id = req.query.campanha_id;

    if (!campanha_id) {
        return res.status(400).json({ error: "campanha_id é obrigatório." });
    }

    const sql = `
        SELECT id, titulo, descricao, valor
        FROM campanha_bonus
        WHERE campanha_id = ?
        ORDER BY id ASC
    `;

    db.all(sql, [campanha_id], (err, rows) => {
        if (err) {
            console.error("Erro ao listar bônus da campanha:", err);
            return res.status(500).json({ error: "db" });
        }

        res.json(rows);
    });
});

// ======================================
// EDITAR PONTOS E CAMPANHAS
// ====================================

app.post("/api/campanhas/desativar", (req, res) => {
    db.run("UPDATE campanhas SET ativa = 0", [], err => {
        if (err) return res.status(500).json({ error: "db" });
        res.json({ sucesso: true });
    });
});

app.get("/api/incentivos/pontos/listar", (req, res) => {
    const { campanha_id } = req.query;

    db.all(`
        SELECT campanha_pontos.*, usuarios.nome
        FROM campanha_pontos
        JOIN usuarios ON usuarios.id = campanha_pontos.courier_id
        WHERE campanha_pontos.campanha_id = ?
        ORDER BY campanha_pontos.id DESC
    `,
    [campanha_id],
    (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});


app.put("/api/incentivos/pontos/editar", (req, res) => {
    const { id, pontos } = req.body;

    db.run(`
        UPDATE campanha_pontos
        SET pontos = ?
        WHERE id = ?
    `,
    [pontos, id],
    (err) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});


app.delete("/api/incentivos/pontos/excluir/:id", (req, res) => {
    const { id } = req.params;

    db.run(`
        DELETE FROM campanha_pontos
        WHERE id = ?
    `,
    [id],
    (err) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

// ======================================
// MOSTRAR TODAS AS PRODUÇÕES
// ======================================

app.get("/api/producao/admin", (req, res) => {
  const { mes, ano } = req.query;

  db.all(`
    SELECT 
      p.*,
      u.nome AS colaborador
    FROM producao_colaborador p
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE strftime('%m', p.data) = ?
      AND strftime('%Y', p.data) = ?
    ORDER BY p.data DESC
  `,
  [mes, ano],
  (err, rows) => {
    if (err) return res.status(500).json({ error: "db" });
    res.json(rows);
  });
});


// ======================================
// START SERVER
// ======================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log('Server running on port', PORT);
});
