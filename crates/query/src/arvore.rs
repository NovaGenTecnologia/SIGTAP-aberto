//! Árvore grupo → subgrupo → forma de organização → procedimento.

use crate::util::{self, ident, ident_vig, mascarar};
use crate::{Consulta, ErroConsulta};
use sa_core::Competencia;
use serde::Serialize;
use std::collections::BTreeMap;

/// Nó da árvore.
#[derive(Debug, Clone, Serialize)]
pub struct No {
    /// `grupo`, `subgrupo`, `forma` ou `procedimento`.
    pub nivel: &'static str,
    /// Código sem máscara (2, 4, 6 ou 10 dígitos).
    pub codigo: String,
    pub codigo_mascarado: String,
    /// `None` quando o código existe nos procedimentos mas não na tabela de estrutura.
    pub nome: Option<String>,
    /// Procedimentos vigentes debaixo do nó (1 para procedimento).
    pub procedimentos: i64,
}

impl Consulta {
    /// Filhos de um nó (`pai` = `None` para os grupos; senão 2, 4 ou 6 dígitos).
    pub fn arvore(&self, comp: Competencia, pai: Option<&str>) -> Result<Vec<No>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let pai = pai.unwrap_or("");
        if !(matches!(pai.len(), 0 | 2 | 4 | 6) && pai.bytes().all(|b| b.is_ascii_digit())) {
            return Err(ErroConsulta::Entrada(format!(
                "nó da árvore inválido: '{pai}'. Use o código do grupo (2 dígitos), subgrupo (4) ou forma (6)."
            )));
        }
        let t = ident("tb_procedimento")?;
        let v = ident_vig("tb_procedimento")?;
        let conn = self.conn();
        if pai.len() == 6 {
            let mut st = conn.prepare_cached(&format!(
                "SELECT c.co_procedimento, c.no_procedimento FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
                 WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_procedimento >= ?2 AND c.co_procedimento < ?3
                 ORDER BY c.co_procedimento"
            ))?;
            let fim = format!("{pai}~");
            let nos = st
                .query_map(rusqlite::params![seq, pai, fim], |r| {
                    let codigo: String = r.get(0)?;
                    Ok(No {
                        nivel: "procedimento",
                        codigo_mascarado: mascarar(&codigo),
                        codigo,
                        nome: r.get(1)?,
                        procedimentos: 1,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(nos);
        }
        let n = pai.len() + 2;
        // Contagem de procedimentos por prefixo.
        let mut st = conn.prepare_cached(&format!(
            "SELECT substr(c.co_procedimento, 1, ?4), count(DISTINCT c.co_procedimento)
             FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_procedimento >= ?2 AND c.co_procedimento < ?3
             GROUP BY 1"
        ))?;
        let fim = format!("{pai}~");
        let mut contagem: BTreeMap<String, i64> = st
            .query_map(rusqlite::params![seq, pai, fim, n as i64], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<Result<_, _>>()?;
        // Nomes pela tabela de estrutura do nível.
        let (nivel, tabela, nome_col) = match n {
            2 => ("grupo", "tb_grupo", "no_grupo"),
            4 => ("subgrupo", "tb_sub_grupo", "no_sub_grupo"),
            _ => ("forma", "tb_forma_organizacao", "no_forma_organizacao"),
        };
        let chaves = ["co_grupo", "co_sub_grupo", "co_forma_organizacao"];
        let mut nomes: BTreeMap<String, String> = BTreeMap::new();
        if util::tabelas(conn, seq)?.iter().any(|x| x == tabela) {
            let mut cols: Vec<(String, String)> = chaves[..n / 2]
                .iter()
                .map(|c| (c.to_string(), String::new()))
                .collect();
            cols.push((nome_col.to_string(), String::new()));
            let filtros: Vec<(&str, &str)> = (0..pai.len() / 2)
                .map(|k| (chaves[k], &pai[k * 2..k * 2 + 2]))
                .collect();
            for (_, vals) in self.linhas_vigentes(seq, tabela, &cols, &filtros)? {
                let codigo: String = vals[..n / 2].iter().map(util::texto).collect();
                nomes.insert(codigo, util::texto(&vals[n / 2]));
            }
        }
        let mut todos: Vec<String> = nomes.keys().cloned().collect();
        todos.extend(contagem.keys().cloned());
        todos.sort();
        todos.dedup();
        Ok(todos
            .into_iter()
            .map(|codigo| No {
                nivel,
                codigo_mascarado: mascarar(&codigo),
                procedimentos: contagem.remove(&codigo).unwrap_or(0),
                nome: nomes.get(&codigo).cloned(),
                codigo,
            })
            .collect())
    }
}
