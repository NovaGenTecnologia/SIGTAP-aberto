//! Árvore de CIDs: letra → categoria (3 caracteres) → subcategoria (4 caracteres).
//!
//! O SIGTAP traz só as categorias e subcategorias (`tb_cid`, com nome). Capítulos e blocos da
//! CID-10 não vêm nele e não são inventados aqui: a letra inicial é só um agrupamento do
//! próprio código.

use crate::util::{ident, ident_vig};
use crate::{Consulta, ErroConsulta};
use sa_core::Competencia;
use serde::Serialize;
use std::collections::BTreeMap;

/// Nó da árvore de CIDs.
#[derive(Debug, Clone, Serialize)]
pub struct NoCid {
    /// `letra`, `categoria` ou `subcategoria`.
    pub nivel: &'static str,
    /// Letra (1), categoria (3) ou subcategoria (4), como no SIGTAP (sem ponto).
    pub codigo: String,
    /// Com ponto (`T74.2`) a partir de 4 caracteres.
    pub codigo_mascarado: String,
    /// `None` na letra e quando o código existe só como prefixo de outros.
    pub nome: Option<String>,
    /// Códigos de categoria ou subcategoria abaixo do nó (1 na subcategoria).
    pub codigos: i64,
    /// Procedimentos vigentes ligados a algum CID do nó (`rl_procedimento_cid`).
    pub procedimentos: i64,
}

fn mascarar_cid(c: &str) -> String {
    if c.len() == 4 {
        format!("{}.{}", &c[..3], &c[3..])
    } else {
        c.to_string()
    }
}

impl Consulta {
    /// Filhos de um nó (`pai` = `None` para as letras; 1 caractere para as categorias;
    /// 3 caracteres para as subcategorias).
    pub fn arvore_cid(
        &self,
        comp: Competencia,
        pai: Option<&str>,
    ) -> Result<Vec<NoCid>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let pai = pai.unwrap_or("").to_uppercase();
        if !(matches!(pai.len(), 0 | 1 | 3) && pai.bytes().all(|b| b.is_ascii_alphanumeric())) {
            return Err(ErroConsulta::Entrada(format!(
                "nó da árvore de CIDs inválido: '{pai}'. Use a letra (1 caractere) ou a categoria (3)."
            )));
        }
        let conn = self.conn();
        let t = ident("tb_cid")?;
        let v = ident_vig("tb_cid")?;
        let n = if pai.is_empty() {
            1
        } else if pai.len() == 1 {
            3
        } else {
            4
        };
        let fim = format!("{pai}~");
        // Só entram códigos com o tamanho do nível (3 ou 4); a letra agrupa os de 3 ou mais.
        let minimo = n.max(3) as i64;
        // Códigos do próximo nível, com contagem de códigos e nome.
        let mut codigos: BTreeMap<String, i64> = BTreeMap::new();
        let mut nomes: BTreeMap<String, String> = BTreeMap::new();
        {
            let mut st = conn.prepare_cached(&format!(
                "SELECT substr(c.co_cid, 1, ?4), count(*) FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
                 WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_cid >= ?2 AND c.co_cid < ?3
                   AND length(c.co_cid) >= ?5
                 GROUP BY 1"
            ))?;
            for r in st.query_map(rusqlite::params![seq, pai, fim, n as i64, minimo], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (c, k) = r?;
                codigos.insert(c, k);
            }
            if n >= 3 {
                let mut st = conn.prepare_cached(&format!(
                    "SELECT c.co_cid, c.no_cid FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
                     WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_cid >= ?2 AND c.co_cid < ?3
                       AND length(c.co_cid) = ?4"
                ))?;
                for r in st.query_map(rusqlite::params![seq, pai, fim, n as i64], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })? {
                    let (c, nome) = r?;
                    if let Some(nome) = nome {
                        nomes.insert(c, nome);
                    }
                }
            }
        }
        // Procedimentos ligados, por prefixo do próximo nível.
        let mut procs: BTreeMap<String, i64> = BTreeMap::new();
        if super::util::tabelas(conn, seq)?
            .iter()
            .any(|x| x == "rl_procedimento_cid")
        {
            let r = ident("rl_procedimento_cid")?;
            let rv = ident_vig("rl_procedimento_cid")?;
            let mut st = conn.prepare_cached(&format!(
                "SELECT substr(c.co_cid, 1, ?4), count(DISTINCT c.co_procedimento)
                 FROM {r} c JOIN {rv} v ON v.sa_id = c.sa_id
                 WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_cid >= ?2 AND c.co_cid < ?3
                   AND length(c.co_cid) >= ?5
                 GROUP BY 1"
            ))?;
            for x in st.query_map(rusqlite::params![seq, pai, fim, n as i64, minimo], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (c, k) = x?;
                procs.insert(c, k);
            }
        }
        let nivel = match n {
            1 => "letra",
            3 => "categoria",
            _ => "subcategoria",
        };
        Ok(codigos
            .into_iter()
            .map(|(codigo, k)| NoCid {
                nivel,
                codigo_mascarado: mascarar_cid(&codigo),
                nome: nomes.remove(&codigo),
                codigos: k,
                procedimentos: procs.get(&codigo).copied().unwrap_or(0),
                codigo,
            })
            .collect())
    }
}
