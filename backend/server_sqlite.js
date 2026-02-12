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



// ======================================
// EMPRÉSTIMOS - PENDENTE (PARCELAS)
// ======================================
app.get('/api/emprestimos/pendente', (req, res) => {
    const usuario_id = Number(req.query.usuario_id || 0);
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id' });

    db.get(
        `SELECT id, usuario_id, valor, parcelamentos, status, COALESCE(parcelas_pagas, 0) AS parcelas_pagas
         FROM emprestimos
         WHERE usuario_id = ? AND status = 'Aprovado'
         ORDER BY id DESC
         LIMIT 1`,
        [usuario_id],
        (err, emp) => {
            if (err) return res.status(500).json({ error: 'db' });
            if (!emp) return res.json({ tem: false });

            const totalParcelas = Number(emp.parcelamentos || 0);
            const pagas = Number(emp.parcelas_pagas || 0);
            if (!totalParcelas || pagas >= totalParcelas) {
                return res.json({ tem: false });
            }

            const proxima = pagas + 1;

            let valorParcela = Number((Number(emp.valor) / totalParcelas).toFixed(2));
            if (proxima === totalParcelas) {
                const jaPago = Number((valorParcela * (totalParcelas - 1)).toFixed(2));
                valorParcela = Number((Number(emp.valor) - jaPago).toFixed(2));
            }

            return res.json({
                tem: true,
                emprestimo_id: emp.id,
                valor_total: Number(emp.valor),
                parcelamentos: totalParcelas,
                parcelas_pagas: pagas,
                proxima_parcela: proxima,
                valor_parcela: valorParcela,
                rotulo: `EMPRÉSTIMO ${proxima}/${totalParcelas}`
            });
        }
    );
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

    const isAprovado = String(status || '').toLowerCase() === 'aprovado';

    const sql = isAprovado
        ? `UPDATE emprestimos
           SET status = ?, valor = ?, parcelamentos = ?, parcelas_pagas = 0, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        : `UPDATE emprestimos
           SET status = ?, valor = ?, parcelamentos = ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`;

    const params = [status, valor, parcelamentos, id];

    db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: 'db' });
        res.json({ ok: true });
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
        obs,
        aplicar_desconto_emprestimo
    } = req.body;

    if (!usuario_id || !data) {
        return res.status(400).json({ error: 'missing_params' });
    }

    const n = (v) => Number(v || 0);
    const entregasN = n(entregas);
    const valorEntrega = n(valor_por_entrega);
    const fsQtd = n(producao_fs);
    const fsVal = n(valor_fs);
    const bobQtd = n(producao_bobina);
    const bobVal = n(valor_bobina);
    const fixo = n(fixo_diaria);

    const entregasNormais = Math.max(0, entregasN - (fsQtd + bobQtd));
    const totalBruto = Number((entregasNormais * valorEntrega + fsQtd * fsVal + bobQtd * bobVal + fixo).toFixed(2));

    const aplicar = String(aplicar_desconto_emprestimo).toLowerCase() === 'true' || aplicar_desconto_emprestimo === true;

    function inserirProducao(descontoFinal, totalFinal, callback) {
        const sql = `
            INSERT INTO producao_colaborador (
                usuario_id, data, entregas, valor_por_entrega,
                producao_fs, valor_fs, producao_bobina, valor_bobina,
                fixo_diaria, desconto, total_calculado, obs, criado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `;

        const params = [
            usuario_id, data, entregasN, valorEntrega,
            fsQtd, fsVal, bobQtd, bobVal,
            fixo, descontoFinal, totalFinal, obs || ''
        ];

        db.run(sql, params, function (err) {
            if (err) return callback(err);
            callback(null, this.lastID);
        });
    }

    const descontoManual = Number(n(desconto).toFixed(2));

    if (!aplicar) {
        const totalFinal = Number((totalBruto - descontoManual).toFixed(2));
        return inserirProducao(descontoManual, totalFinal, (err, producaoId) => {
            if (err) return res.status(500).json({ error: 'db' });
            res.json({ ok: true, id: producaoId });
        });
    }

    db.get(
        `SELECT id, valor, parcelamentos, COALESCE(parcelas_pagas, 0) AS parcelas_pagas
         FROM emprestimos
         WHERE usuario_id = ? AND status = 'Aprovado'
         ORDER BY id DESC
         LIMIT 1`,
        [usuario_id],
        (err, emp) => {
            if (err) return res.status(500).json({ error: 'db' });
            if (!emp) return res.status(400).json({ error: 'sem_emprestimo_aprovado_pendente' });

            const totalParcelas = Number(emp.parcelamentos || 0);
            const pagas = Number(emp.parcelas_pagas || 0);

            if (!totalParcelas || pagas >= totalParcelas) {
                return res.status(400).json({ error: 'sem_emprestimo_aprovado_pendente' });
            }

            const proxima = pagas + 1;

            let valorParcela = Number((Number(emp.valor) / totalParcelas).toFixed(2));
            if (proxima === totalParcelas) {
                const jaPago = Number((valorParcela * (totalParcelas - 1)).toFixed(2));
                valorParcela = Number((Number(emp.valor) - jaPago).toFixed(2));
            }

            if (totalBruto < valorParcela) {
                return res.status(400).json({
                    error: 'producao_insuficiente_para_parcela',
                    valor_parcela: valorParcela,
                    total_bruto: totalBruto
                });
            }

            const descontoFinal = Number((descontoManual + valorParcela).toFixed(2));
            const totalFinal = Number((totalBruto - descontoFinal).toFixed(2));

            inserirProducao(descontoFinal, totalFinal, (err2, producaoId) => {
                if (err2) return res.status(500).json({ error: 'db' });

                db.run(
                    `INSERT INTO emprestimo_descontos
                     (emprestimo_id, producao_id, usuario_id, parcela_numero, total_parcelas, valor_parcela)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [emp.id, producaoId, usuario_id, proxima, totalParcelas, valorParcela],
                    (err3) => {
                        if (err3) return res.status(500).json({ error: 'db' });

                        const quitou = proxima >= totalParcelas;
                        const sqlUp = quitou
                            ? `UPDATE emprestimos SET parcelas_pagas = ?, status = 'Quitado', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
                            : `UPDATE emprestimos SET parcelas_pagas = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`;

                        db.run(sqlUp, [proxima, emp.id], (err4) => {
                            if (err4) return res.status(500).json({ error: 'db' });
                            res.json({
                                ok: true,
                                id: producaoId,
                                emprestimo: {
                                    emprestimo_id: emp.id,
                                    parcela: `${proxima}/${totalParcelas}`,
                                    valor_parcela: valorParcela,
                                    status: quitou ? 'Quitado' : 'Aprovado'
                                }
                            });
                        });
                    }
                );
            });
        }
    );
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
