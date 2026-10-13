//! Estruturas derivadas para consulta: índices e índice de texto (FTS5).
//!
//! Tudo aqui é refeito a partir das tabelas de origem e não entra no resumo lógico do banco.
//! Nomes começam com `sa_q_`.

use crate::ErroConsulta;
use crate::util::ident;
use rusqlite::{Connection, OptionalExtension};
use sa_sources::sigtap::referencias::Referencia;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Muda quando a forma das estruturas derivadas muda (força refazer).
const VERSAO_CONSULTA: &str = "2";

fn hex8(texto: &str) -> String {
    Sha256::digest(texto.as_bytes())
        .iter()
        .take(4)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Colunas existentes (no banco) de cada tabela de origem.
fn colunas_do_banco(conn: &Connection) -> Result<BTreeMap<String, BTreeSet<String>>, ErroConsulta> {
    let mut m: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut st = conn.prepare("SELECT DISTINCT tabela, coluna FROM sa_leiaute")?;
    let v = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (t, c) in v {
        m.entry(t).or_default().insert(c);
    }
    Ok(m)
}

/// Conjuntos de colunas a indexar por tabela: chave natural, grupos de referência e chaves
/// das tabelas de destino.
fn indices_desejados(
    cols: &BTreeMap<String, BTreeSet<String>>,
    refs: &[Referencia],
) -> BTreeMap<String, BTreeSet<Vec<String>>> {
    let chaves = sa_sources::sigtap::chaves_naturais();
    let mut m: BTreeMap<String, BTreeSet<Vec<String>>> = BTreeMap::new();
    for (t, cs) in cols {
        let tem = |g: &[String]| g.iter().all(|c| cs.contains(c));
        if let Some(k) = chaves.get(t).filter(|k| !k.is_empty() && tem(k)) {
            m.entry(t.clone()).or_default().insert(k.clone());
        }
        for r in refs {
            if &r.tabela == t && tem(&r.chave) {
                m.entry(t.clone()).or_default().insert(r.chave.clone());
            }
            for g in &r.de {
                if &r.tabela != t && tem(g) {
                    m.entry(t.clone()).or_default().insert(g.clone());
                }
            }
        }
    }
    m
}

/// Carimbo dos dados: muda a cada carga, remoção ou republicação.
fn carimbo(conn: &Connection) -> Result<String, ErroConsulta> {
    let mut h = Sha256::new();
    h.update(VERSAO_CONSULTA);
    let mut st = conn.prepare("SELECT seq, sha256 FROM sa_competencia ORDER BY seq")?;
    let mut r = st.query([])?;
    while let Some(x) = r.next()? {
        h.update(format!(
            "|{}:{}",
            x.get::<_, i64>(0)?,
            x.get::<_, String>(1)?
        ));
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Cria os índices que faltam e refaz o índice de texto se os dados mudaram.
pub fn preparar(conn: &Connection, refs: &[Referencia]) -> Result<(), ErroConsulta> {
    let cols = colunas_do_banco(conn)?;
    for (t, conjuntos) in indices_desejados(&cols, refs) {
        let ti = ident(&t)?;
        for g in conjuntos {
            let nome = ident(&format!("sa_q_{t}_{}", hex8(&g.join(","))))?;
            let lista = g
                .iter()
                .map(|c| ident(c).map(|i| i.to_string()))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            conn.execute_batch(&format!(
                "CREATE INDEX IF NOT EXISTS {nome} ON {ti}({lista})"
            ))?;
        }
    }
    let novo = carimbo(conn)?;
    let atual: Option<String> = conn
        .query_row(
            "SELECT valor FROM sa_info WHERE chave = 'consulta_carimbo'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if atual.as_deref() == Some(novo.as_str()) {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "DROP TABLE IF EXISTS sa_q_busca;
         CREATE VIRTUAL TABLE sa_q_busca USING fts5(texto, tabela UNINDEXED, sa_id UNINDEXED,
             tokenize = 'unicode61 remove_diacritics 2');",
    )?;
    let alvos: BTreeSet<(&str, &str)> = refs
        .iter()
        .map(|r| (r.tabela.as_str(), r.nomes[0].as_str()))
        .collect();
    for (t, nome) in alvos {
        if !cols.get(t).is_some_and(|c| c.contains(nome)) {
            continue;
        }
        let ti = ident(t)?;
        let ni = ident(nome)?;
        tx.execute(
            &format!("INSERT INTO sa_q_busca(texto, tabela, sa_id) SELECT {ni}, ?1, sa_id FROM {ti} WHERE {ni} IS NOT NULL"),
            [t],
        )?;
    }
    // Descrição oficial do procedimento (texto longo): entra no índice como `tb_descricao`.
    if cols
        .get("tb_descricao")
        .is_some_and(|c| c.contains("ds_procedimento"))
    {
        tx.execute(
            "INSERT INTO sa_q_busca(texto, tabela, sa_id) SELECT ds_procedimento, 'tb_descricao', sa_id
             FROM tb_descricao WHERE ds_procedimento IS NOT NULL",
            [],
        )?;
    }
    tx.execute(
        "INSERT INTO sa_info(chave, valor) VALUES('consulta_carimbo', ?1)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        [&novo],
    )?;
    tx.commit()?;
    Ok(())
}
