//! E02–E06 (Fase 2): consultas contra o banco completo (225 competências), conferidas por SQL
//! independente. Dados fora do repositório.
//!
//! `SA_SIGTAP_BANCO_CONSULTA=<CÓPIA do banco completo>`: a consulta cria índices e o índice de
//! texto nessa cópia (não use o banco da prova de reconstrução). Rode com `--release`.

use rusqlite::Connection;
use sa_core::Competencia;
use sa_query::Consulta;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

fn caminho() -> Option<PathBuf> {
    std::env::var("SA_SIGTAP_BANCO_CONSULTA")
        .ok()
        .map(PathBuf::from)
}

/// Prepara uma vez (índices e busca) para os testes paralelos não disputarem a escrita.
fn preparado() -> Option<PathBuf> {
    static FEITO: OnceLock<()> = OnceLock::new();
    let p = caminho()?;
    FEITO.get_or_init(|| {
        let t = Instant::now();
        Consulta::abrir(&p).unwrap();
        eprintln!(
            "PROVA preparo (índices e busca): {:.2} s",
            t.elapsed().as_secs_f64()
        );
    });
    Some(p)
}

fn c(s: &str) -> Competencia {
    Competencia::de_texto(s).unwrap()
}

fn seqs(con: &Connection) -> Vec<i64> {
    let mut st = con
        .prepare("SELECT seq FROM sa_competencia ORDER BY seq")
        .unwrap();
    st.query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Tabelas da competência com colunas que citam procedimento (SQL independente do manifesto:
/// qualquer coluna do leiaute que comece com `co_procedimento`, menos `co_procedimento_sia_sih`).
fn tabelas_que_citam(con: &Connection, seq: i64) -> BTreeSet<(String, String)> {
    let mut st = con
        .prepare(
            "SELECT tabela, coluna FROM sa_leiaute WHERE seq = ?1 AND coluna LIKE 'co\\_procedimento%' ESCAPE '\\'
             AND coluna <> 'co_procedimento_sia_sih' AND tabela <> 'tb_procedimento'",
        )
        .unwrap();
    st.query_map([seq], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn contar(con: &Connection, seq: i64, tabela: &str, coluna: &str, codigo: &str) -> usize {
    let t = sa_core::safe_ident(tabela).unwrap();
    let v = sa_core::safe_ident(&format!("{tabela}__vig")).unwrap();
    let k = sa_core::safe_ident(coluna).unwrap();
    con.query_row(
        &format!("SELECT count(*) FROM {t} c, {v} v WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND c.{k} = ?2"),
        rusqlite::params![seq, codigo],
        |r| r.get::<_, i64>(0),
    )
    .unwrap() as usize
}

fn amostra(con: &Connection, seq: i64, passo: usize) -> Vec<String> {
    let mut st = con
        .prepare(
            "SELECT DISTINCT c.co_procedimento FROM tb_procedimento c, tb_procedimento__vig v
             WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim ORDER BY 1",
        )
        .unwrap();
    let todos: Vec<String> = st
        .query_map([seq], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    todos.into_iter().step_by(passo).collect()
}

#[test]
fn ficha_completa_e_conferida() {
    let Some(p) = preparado() else {
        eprintln!("SA_SIGTAP_BANCO_CONSULTA não definida: prova de consultas não executada");
        return;
    };
    let q = Consulta::abrir(&p).unwrap();
    let con = Connection::open(&p).unwrap();
    let (mut fichas, mut relacoes, mut linhas) = (0, 0, 0);
    let mut pior = Duration::ZERO;
    for comp in [
        "200801", "201011", "201404", "201503", "201507", "202206", "202609",
    ] {
        let seq = c(comp).seq();
        let esperadas = tabelas_que_citam(&con, seq);
        let cols_p: Vec<String> = {
            let mut st = con
                .prepare("SELECT coluna FROM sa_leiaute WHERE seq = ?1 AND tabela = 'tb_procedimento' ORDER BY ordem")
                .unwrap();
            st.query_map([seq], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        for cod in amostra(&con, seq, 97) {
            let t = Instant::now();
            let f = q
                .ficha(c(comp), &cod)
                .unwrap()
                .expect("procedimento vigente");
            pior = pior.max(t.elapsed());
            // Todos os campos do leiaute, na ordem oficial.
            let campos: Vec<&str> = f.procedimento[0]
                .campos
                .iter()
                .map(|x| x.coluna.as_str())
                .collect();
            assert_eq!(campos, cols_p, "{cod} {comp}: campos de tb_procedimento");
            // Toda tabela que cita o procedimento aparece, com o número certo de linhas.
            let obtidas: BTreeSet<(String, String)> = f
                .relacoes
                .iter()
                .map(|r| (r.tabela.clone(), r.coluna.clone()))
                .collect();
            assert_eq!(obtidas, esperadas, "{cod} {comp}: tabelas da ficha");
            for r in &f.relacoes {
                assert_eq!(
                    r.linhas.len(),
                    contar(&con, seq, &r.tabela, &r.coluna, &cod),
                    "{cod} {comp} {}",
                    r.tabela
                );
                linhas += r.linhas.len();
                relacoes += 1;
            }
            // Estrutura com nome nos três níveis.
            assert!(
                f.estrutura.iter().all(|n| n.nome.is_some()),
                "{cod} {comp}: estrutura sem nome"
            );
            fichas += 1;
        }
    }
    eprintln!(
        "PROVA ficha: {fichas} fichas em 7 competências; {relacoes} relações e {linhas} linhas conferidas por SQL independente; pior tempo {:.1} ms",
        pior.as_secs_f64() * 1000.0
    );
}

#[test]
fn estrutura_por_prefixo_existe_em_todas_as_competencias() {
    let Some(p) = preparado() else { return };
    let con = Connection::open(&p).unwrap();
    let mut total = 0i64;
    for s in seqs(&con) {
        let sem: i64 = con
            .query_row(
                "SELECT count(*) FROM tb_procedimento p, tb_procedimento__vig v WHERE v.sa_id = p.sa_id
                 AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND NOT EXISTS (
                   SELECT 1 FROM tb_forma_organizacao f, tb_forma_organizacao__vig w WHERE w.sa_id = f.sa_id
                   AND ?1 BETWEEN w.vig_ini AND w.vig_fim AND f.co_grupo = substr(p.co_procedimento, 1, 2)
                   AND f.co_sub_grupo = substr(p.co_procedimento, 3, 2)
                   AND f.co_forma_organizacao = substr(p.co_procedimento, 5, 2))",
                [s],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            sem, 0,
            "competência seq {s}: procedimento sem forma de organização"
        );
        total += 1;
    }
    eprintln!(
        "PROVA estrutura: em {total} competências, todo procedimento vigente tem grupo, subgrupo e forma pelos dígitos 1-2, 3-4 e 5-6"
    );
}

#[test]
fn arvore_bate_com_contagem() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let con = Connection::open(&p).unwrap();
    for comp in ["200801", "202609"] {
        let seq = c(comp).seq();
        let total: i64 = con
            .query_row(
                "SELECT count(DISTINCT c.co_procedimento) FROM tb_procedimento c, tb_procedimento__vig v
                 WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim",
                [seq],
                |r| r.get(0),
            )
            .unwrap();
        let grupos = q.arvore(c(comp), None).unwrap();
        assert_eq!(grupos.iter().map(|g| g.procedimentos).sum::<i64>(), total);
        assert!(grupos.iter().all(|g| g.nome.is_some()));
        let mut folhas = 0;
        for g in &grupos {
            for s in q.arvore(c(comp), Some(&g.codigo)).unwrap() {
                for f in q.arvore(c(comp), Some(&s.codigo)).unwrap() {
                    let procs = q.arvore(c(comp), Some(&f.codigo)).unwrap();
                    assert_eq!(procs.len() as i64, f.procedimentos, "{}", f.codigo);
                    folhas += procs.len();
                }
            }
        }
        assert_eq!(folhas as i64, total);
        eprintln!(
            "PROVA árvore {comp}: {} grupos, {folhas} procedimentos nas folhas = {total} vigentes",
            grupos.len()
        );
    }
}

#[test]
fn busca_casos_reais() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let con = Connection::open(&p).unwrap();
    let comp = c("202609");
    let seq = comp.seq();
    let mut pior = Duration::ZERO;
    let mut b = |t: &str| {
        let i = Instant::now();
        let r = q.buscar(comp, t).unwrap();
        pior = pior.max(i.elapsed());
        r
    };
    // Nome: igual a LIKE em maiúsculas (os nomes do SIGTAP são maiúsculos).
    let like: i64 = con
        .query_row(
            "SELECT count(DISTINCT c.co_procedimento) FROM tb_procedimento c, tb_procedimento__vig v
             WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND c.no_procedimento LIKE '%DESFIBRILADOR%'",
            [seq],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(b("desfibrilador").total_procedimentos as i64, like);
    assert_eq!(like, 19);
    // Sem acento e por partes.
    let r = b("epimiocardico toracotomia cdi");
    assert!(r.procedimentos.iter().any(|x| x.codigo == "0406010579"));
    let r = b("consulta medica atencao especializada");
    assert!(r.procedimentos.iter().any(|x| x.codigo == "0301010072"));
    // Código com e sem máscara, inteiro e prefixo.
    for t in ["04.06.01.057-9", "0406010579"] {
        let r = b(t);
        assert_eq!(r.total_procedimentos, 1, "{t}");
        assert_eq!(r.procedimentos[0].valor_total_centavos, 236_645);
        assert_eq!(r.procedimentos[0].instrumentos, ["AIH (Proc. Principal)"]);
    }
    assert_eq!(b("04.06.01").total_procedimentos, 149);
    // CID: apoio com o número de procedimentos ligados conferido por SQL.
    let r = b("I42.0");
    let cid = r
        .apoio
        .iter()
        .find(|a| a.tabela == "tb_cid")
        .expect("CID I420");
    let ligados: i64 = con
        .query_row(
            "SELECT count(DISTINCT c.co_procedimento) FROM rl_procedimento_cid c, rl_procedimento_cid__vig v
             WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND c.co_cid = 'I420'",
            [seq],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cid.procedimentos as i64, ligados);
    // CBO e habilitação pelo código; habilitação pelo nome.
    assert!(
        b("225120")
            .apoio
            .iter()
            .any(|a| a.tabela == "tb_ocupacao" && a.nome == "Médico cardiologista")
    );
    assert!(b("0802").apoio.iter().any(|a| a.tabela == "tb_habilitacao"));
    assert!(
        b("cirurgia cardiovascular pediatrica")
            .apoio
            .iter()
            .any(|a| a.tabela == "tb_habilitacao" && a.codigo == ["0804"])
    );
    // Procedimentos ligados a um código de apoio.
    let l = q.procedimentos_ligados(comp, "tb_cid", &["I420"]).unwrap();
    assert_eq!(l.len() as i64, ligados);
    eprintln!(
        "PROVA busca: casos reais conferidos; pior tempo {:.1} ms",
        pior.as_secs_f64() * 1000.0
    );
}

#[test]
fn historico_bate_com_mudancas_mes_a_mes() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let con = Connection::open(&p).unwrap();
    let todas = seqs(&con);
    let ultima = *todas.last().unwrap();
    let mut conferidos = 0;
    let mut pior = Duration::ZERO;
    let mut codigos = amostra(&con, ultima, 251);
    codigos.push("0406010579".into());
    for cod in codigos {
        let t = Instant::now();
        let h = q.historico(&cod).unwrap();
        pior = pior.max(t.elapsed());
        // Independente: "impressão digital" do procedimento em cada competência = conjunto de
        // conteúdos vigentes (tabela, sa_id) de todas as tabelas que o citam.
        let mut anterior: Option<BTreeSet<(String, i64)>> = None;
        let mut mudou = Vec::new();
        for &s in &todas {
            let mut atual = BTreeSet::new();
            let mut tabs = tabelas_que_citam(&con, s);
            tabs.insert(("tb_procedimento".into(), "co_procedimento".into()));
            for (t, col) in tabs {
                let ti = sa_core::safe_ident(&t).unwrap();
                let vi = sa_core::safe_ident(&format!("{t}__vig")).unwrap();
                let ki = sa_core::safe_ident(&col).unwrap();
                let mut st = con
                    .prepare(&format!("SELECT c.sa_id FROM {ti} c, {vi} v WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND c.{ki} = ?2"))
                    .unwrap();
                for id in st
                    .query_map(rusqlite::params![s, cod], |r| r.get::<_, i64>(0))
                    .unwrap()
                {
                    atual.insert((format!("{t}.{col}"), id.unwrap()));
                }
            }
            if let Some(a) = &anterior
                && *a != atual
            {
                mudou.push(Competencia::de_seq(s).unwrap().to_string());
            }
            anterior = Some(atual);
        }
        mudou.reverse();
        assert_eq!(h.competencias_com_mudanca, mudou, "{cod}");
        conferidos += 1;
    }
    let h = q.historico("0406010579").unwrap();
    let sp = h
        .eventos
        .iter()
        .find(|e| e.competencia == "202206" && e.tabela == "tb_procedimento")
        .unwrap();
    assert_eq!(sp.tipo, "alterado");
    assert_eq!(sp.campos_alterados, ["vl_sp"]);
    eprintln!(
        "PROVA histórico: {conferidos} procedimentos, competências com mudança iguais às da comparação mês a mês; 0406010579 tem {} competências com mudança; pior tempo {:.1} ms",
        h.competencias_com_mudanca.len(),
        pior.as_secs_f64() * 1000.0
    );
}

#[test]
fn o_que_mudou_bate_com_intervalos_em_todas_as_viradas() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let con = Connection::open(&p).unwrap();
    let todas = seqs(&con);
    let mut pior = Duration::ZERO;
    let mut totais: BTreeMap<&str, usize> = BTreeMap::new();
    for par in todas.windows(2) {
        let (a, b) = (par[0], par[1]);
        let t = Instant::now();
        let m = q
            .o_que_mudou(
                Competencia::de_seq(a).unwrap(),
                Competencia::de_seq(b).unwrap(),
                0,
            )
            .unwrap();
        pior = pior.max(t.elapsed());
        for x in &m.tabelas {
            let vi = sa_core::safe_ident(&format!("{}__vig", x.tabela)).unwrap();
            let entrou: i64 = if x.presente_depois {
                con.query_row(
                    &format!("SELECT count(*) FROM {vi} WHERE vig_ini = ?1"),
                    [b],
                    |r| r.get(0),
                )
                .unwrap()
            } else {
                0
            };
            let saiu: i64 = if x.presente_antes {
                con.query_row(
                    &format!("SELECT count(*) FROM {vi} WHERE vig_fim = ?1"),
                    [a],
                    |r| r.get(0),
                )
                .unwrap()
            } else {
                0
            };
            assert_eq!(
                (x.incluidos + x.alterados) as i64,
                entrou,
                "{} {a}->{b}",
                x.tabela
            );
            assert_eq!(
                (x.excluidos + x.alterados) as i64,
                saiu,
                "{} {a}->{b}",
                x.tabela
            );
            *totais.entry("incluidos").or_default() += x.incluidos;
            *totais.entry("excluidos").or_default() += x.excluidos;
            *totais.entry("alterados").or_default() += x.alterados;
        }
    }
    eprintln!(
        "PROVA o que mudou: {} viradas conferidas contra os intervalos; totais {totais:?}; pior tempo {:.1} ms",
        todas.len() - 1,
        pior.as_secs_f64() * 1000.0
    );
    let m = q.o_que_mudou(c("202608"), c("202609"), 300).unwrap();
    let proc = m
        .tabelas
        .iter()
        .find(|t| t.tabela == "tb_procedimento")
        .unwrap();
    // Valores conhecidos da versão de 17/09/2026 (`v2609171117`). Em 05/10/2026 o DATASUS republicou
    // 09/2026 (`v2610050950`, 14 procedimentos alterados em relação a 08/2026): para essa versão, e
    // para qualquer outra, vale a conferência contra os intervalos feita acima, não um número fixo.
    let versao_09 = q
        .competencias()
        .unwrap()
        .into_iter()
        .find(|x| x.competencia == "202609")
        .and_then(|x| x.versao);
    if versao_09.as_deref() == Some("2609171117") {
        assert_eq!((proc.incluidos, proc.excluidos, proc.alterados), (0, 0, 3));
        let mepo = proc
            .itens
            .iter()
            .find(|i| i.chave["co_procedimento"] == "0604840020")
            .unwrap();
        assert_eq!(mepo.campos_alterados, ["vl_idade_minima"]);
    } else {
        eprintln!(
            "09/2026 versão {versao_09:?}: tb_procedimento incluídos {}, excluídos {}, alterados {}",
            proc.incluidos, proc.excluidos, proc.alterados
        );
    }

    // "Ver mais": páginas pequenas de cada tabela, concatenadas, reproduzem a lista completa.
    let completo = q.o_que_mudou(c("202608"), c("202609"), usize::MAX).unwrap();
    for t in &completo.tabelas {
        let mut juntos = Vec::new();
        let mut desde = 0;
        loop {
            let pg = q
                .o_que_mudou_tabela(c("202608"), c("202609"), &t.tabela, desde, 7)
                .unwrap()
                .unwrap();
            assert_eq!(pg.desde, desde);
            assert_eq!(pg.itens_omitidos + desde + pg.itens.len(), t.itens.len());
            desde += pg.itens.len();
            juntos.extend(pg.itens.into_iter().map(|i| (i.tipo, i.chave)));
            if pg.itens_omitidos == 0 {
                break;
            }
        }
        let todos: Vec<_> = t.itens.iter().map(|i| (i.tipo, i.chave.clone())).collect();
        assert_eq!(juntos, todos, "paginação de {}", t.tabela);
    }
}

/// Completude do manifesto de referências: toda coluna CO_/NU_ de qualquer tabela do banco é
/// chave da própria tabela ou tem referência que dá o nome.
#[test]
fn referencias_cobrem_o_banco() {
    let Some(p) = preparado() else { return };
    let con = Connection::open(&p).unwrap();
    let refs = sa_sources::sigtap::referencias::referencias();
    let mut st = con
        .prepare("SELECT DISTINCT tabela, coluna FROM sa_leiaute WHERE coluna LIKE 'co\\_%' ESCAPE '\\' OR coluna LIKE 'nu\\_%' ESCAPE '\\'")
        .unwrap();
    let pares: Vec<(String, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut sem = Vec::new();
    for (t, col) in &pares {
        let chave_propria = refs.iter().any(|r| &r.tabela == t && r.chave.contains(col));
        let referida = refs
            .iter()
            .any(|r| &r.tabela != t && r.de.iter().any(|g| g.contains(col)));
        if !chave_propria && !referida {
            sem.push(format!("{t}.{col}"));
        }
    }
    assert!(
        sem.is_empty(),
        "colunas sem referência no manifesto: {sem:?}"
    );
    eprintln!(
        "PROVA referências: {} colunas CO_/NU_ cobertas pelo manifesto",
        pares.len()
    );
}

#[test]
fn arvore_de_cids_bate_com_sql_independente() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let con = Connection::open(&p).unwrap();
    for comp in ["201001", "202609"] {
        let seq = c(comp).seq();
        let total: i64 = con
            .query_row(
                "SELECT count(*) FROM tb_cid c, tb_cid__vig v WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND length(c.co_cid) >= 3",
                [seq],
                |r| r.get(0),
            )
            .unwrap();
        let letras = q.arvore_cid(c(comp), None).unwrap();
        assert_eq!(
            letras.iter().map(|l| l.codigos).sum::<i64>(),
            total,
            "{comp}"
        );
        let (mut cats, mut subs) = (0i64, 0i64);
        for l in &letras {
            for cat in q.arvore_cid(c(comp), Some(&l.codigo)).unwrap() {
                cats += 1;
                let filhos = q.arvore_cid(c(comp), Some(&cat.codigo)).unwrap();
                // codigos da categoria = ela mesma (se existe) + subcategorias.
                subs += filhos.len() as i64;
                assert!(
                    filhos
                        .iter()
                        .all(|f| f.nivel == "subcategoria" && f.nome.is_some()),
                    "{}",
                    cat.codigo
                );
                // procedimentos ligados da categoria nunca são menos que os de uma subcategoria.
                assert!(
                    filhos.iter().all(|f| f.procedimentos <= cat.procedimentos),
                    "{}",
                    cat.codigo
                );
            }
        }
        // Categorias = prefixos distintos de 3 caracteres (em 2010 só existem códigos de 4);
        // subcategorias = códigos de 4 caracteres.
        let (cats_sql, subs_sql): (i64, i64) = con
            .query_row(
                "SELECT count(DISTINCT substr(c.co_cid, 1, 3)), sum(length(c.co_cid) = 4) FROM tb_cid c, tb_cid__vig v
                 WHERE v.sa_id = c.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND length(c.co_cid) >= 3",
                [seq],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((cats, subs), (cats_sql, subs_sql), "{comp}");
        eprintln!(
            "PROVA árvore de CIDs {comp}: {} letras, {cats} categorias, {subs} subcategorias (SQL igual); {total} códigos",
            letras.len()
        );
    }
    // Caso do usuário: T742 tem 5 procedimentos ligados; a contagem do nó bate com o SQL.
    let seq = c("202609").seq();
    let sql: i64 = con
        .query_row(
            "SELECT count(DISTINCT r.co_procedimento) FROM rl_procedimento_cid r, rl_procedimento_cid__vig v
             WHERE v.sa_id = r.sa_id AND ?1 BETWEEN v.vig_ini AND v.vig_fim AND r.co_cid = 'T742'",
            [seq],
            |r| r.get(0),
        )
        .unwrap();
    let t74 = q.arvore_cid(c("202609"), Some("T74")).unwrap();
    let t742 = t74.iter().find(|n| n.codigo == "T742").unwrap();
    assert_eq!(t742.procedimentos, sql);
    assert_eq!(t742.codigo_mascarado, "T74.2");
    assert_eq!(t742.nome.as_deref(), Some("Abuso sexual"));
    eprintln!("PROVA T74.2: {} procedimento(s) ligados (SQL igual)", sql);
}

#[test]
fn busca_todos_devolve_sem_o_limite_de_procedimentos() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let comp = c("202609");
    let curta = q.buscar(comp, "procedimento").unwrap();
    let toda = q.buscar_todos(comp, "procedimento").unwrap();
    assert_eq!(toda.total_procedimentos, curta.total_procedimentos);
    assert_eq!(toda.procedimentos.len(), toda.total_procedimentos);
    assert_eq!(
        curta.procedimentos.len(),
        curta
            .total_procedimentos
            .min(sa_query::busca::LIMITE_PROCEDIMENTOS)
    );
    let codigos: Vec<_> = toda.procedimentos.iter().map(|i| &i.codigo).collect();
    assert!(
        curta
            .procedimentos
            .iter()
            .all(|i| codigos.contains(&&i.codigo))
    );
}

#[test]
fn busca_de_categoria_cid_lista_as_subcategorias_e_soma_os_procedimentos() {
    let Some(p) = preparado() else { return };
    let q = Consulta::abrir(&p).unwrap();
    let comp = c("202609");
    let r = q.buscar(comp, "Z00").unwrap();
    let cids: Vec<&str> = r
        .apoio
        .iter()
        .filter(|a| a.tabela == "tb_cid")
        .map(|a| a.codigo[0].as_str())
        .collect();
    assert!(cids.contains(&"Z00"));
    assert!(cids.iter().any(|c| c.len() == 4 && c.starts_with("Z00")));
    let da_categoria = q.procedimentos_ligados(comp, "tb_cid", &["Z00"]).unwrap();
    let soma: usize = cids
        .iter()
        .filter(|c| c.len() == 4)
        .map(|c| q.procedimentos_ligados(comp, "tb_cid", &[c]).unwrap().len())
        .sum();
    assert!(da_categoria.len() <= soma && (soma == 0 || !da_categoria.is_empty()));
}
