//! Utilidades internas: rótulos, máscara do código, colunas por competência, valores.

use crate::ErroConsulta;
use rusqlite::Connection;
use rusqlite::types::Value;
use sa_core::{Competencia, Ident, safe_ident};

/// Coluna do leiaute que não é guardada no banco: é sempre a competência do arquivo
/// (conferido na carga, Fase 1).
pub(crate) const COL_DT: &str = "dt_competencia";

/// `AAAAMM` de uma sequência.
pub(crate) fn texto_competencia(seq: i64) -> String {
    Competencia::de_seq(seq)
        .map(|c| c.to_string())
        .unwrap_or_default()
}

/// `MM/AAAA`.
pub(crate) fn rotulo(c: Competencia) -> String {
    let s = c.to_string();
    format!("{}/{}", &s[4..6], &s[0..4])
}

/// Carimbo `AAMMDDhhmm` do nome do ZIP → `DD/MM/20AA hh:mm`.
pub(crate) fn data_da_versao(v: &str) -> Option<String> {
    let b = v.as_bytes();
    if b.len() != 10 || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    Some(format!(
        "{}/{}/20{} {}:{}",
        &v[4..6],
        &v[2..4],
        &v[0..2],
        &v[6..8],
        &v[8..10]
    ))
}

/// Código de procedimento com máscara `GG.SS.FF.PPP-D` (forma vista no site oficial do
/// SIGTAP, ex.: `03.01.01.007-2`). Devolve o texto sem mudança se não tiver 10 dígitos.
pub fn mascarar(codigo: &str) -> String {
    if codigo.len() == 10 && codigo.bytes().all(|b| b.is_ascii_digit()) {
        format!(
            "{}.{}.{}.{}-{}",
            &codigo[0..2],
            &codigo[2..4],
            &codigo[4..6],
            &codigo[6..9],
            &codigo[9..10]
        )
    } else {
        codigo.to_string()
    }
}

pub(crate) fn ident(nome: &str) -> Result<Ident, ErroConsulta> {
    safe_ident(nome).map_err(|e| ErroConsulta::Entrada(e.to_string()))
}

pub(crate) fn ident_vig(tabela: &str) -> Result<Ident, ErroConsulta> {
    ident(&format!("{tabela}__vig"))
}

/// Coluna do leiaute de uma competência: (nome no banco, nome na fonte).
pub(crate) type ColunaLeiaute = (String, String);

/// Colunas da tabela no leiaute da competência `seq`, na ordem do arquivo oficial.
pub(crate) fn colunas(
    conn: &Connection,
    seq: i64,
    tabela: &str,
) -> Result<Vec<ColunaLeiaute>, ErroConsulta> {
    let mut st = conn.prepare_cached(
        "SELECT coluna, coluna_origem FROM sa_leiaute WHERE seq = ?1 AND tabela = ?2 ORDER BY ordem",
    )?;
    let v = st
        .query_map(rusqlite::params![seq, tabela], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Tabelas presentes no ZIP da competência `seq`.
pub(crate) fn tabelas(conn: &Connection, seq: i64) -> Result<Vec<String>, ErroConsulta> {
    let mut st =
        conn.prepare_cached("SELECT tabela FROM sa_tabela WHERE seq = ?1 ORDER BY tabela")?;
    let v = st
        .query_map([seq], |r| r.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(v)
}

/// Valor do banco → JSON.
pub(crate) fn json(v: &Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::Value::from(*i),
        Value::Real(r) => serde_json::Value::from(*r),
        Value::Text(t) => serde_json::Value::from(t.as_str()),
        Value::Blob(_) => serde_json::Value::Null,
    }
}

/// Valor do banco → texto (para chaves e comparação).
pub(crate) fn texto(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Integer(i) => i.to_string(),
        Value::Real(r) => r.to_string(),
        Value::Text(t) => t.clone(),
        Value::Blob(_) => String::new(),
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn mascara_e_rotulos() {
        assert_eq!(mascarar("0406010579"), "04.06.01.057-9");
        assert_eq!(mascarar("0406"), "0406");
        assert_eq!(
            data_da_versao("2609171117").as_deref(),
            Some("17/09/2026 11:17")
        );
        assert_eq!(data_da_versao("26091711"), None);
        assert_eq!(rotulo(Competencia::de_texto("202609").unwrap()), "09/2026");
    }
}
