//! Busca global: código de procedimento (com ou sem máscara, inteiro ou prefixo), nome sem
//! acento e por partes, e códigos/nomes das tabelas de apoio (CID, CBO, habilitação, serviço,
//! atributo, regra condicionada...). Também: procedimentos ligados a um código de apoio.

use crate::util::{self, ident, ident_vig, mascarar, texto};
use crate::{Consulta, ErroConsulta};
use rusqlite::types::Value;
use sa_core::Competencia;
use sa_sources::sigtap::dominios::Descricao;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Limite de procedimentos devolvidos numa busca (o total vem à parte).
pub const LIMITE_PROCEDIMENTOS: usize = 200;
/// Limite de itens de apoio.
pub const LIMITE_APOIO: usize = 50;

/// Procedimento num resultado.
#[derive(Debug, Clone, Serialize)]
pub struct ItemProcedimento {
    pub codigo: String,
    pub codigo_mascarado: String,
    pub nome: String,
    pub tp_complexidade: String,
    pub complexidade: Option<String>,
    /// SH + SA + SP, em centavos.
    pub valor_total_centavos: i64,
    /// Instrumentos de registro (nomes de `tb_registro`).
    pub instrumentos: Vec<String>,
    /// Forma de organização (6 dígitos) e seu nome na competência, para agrupar listas.
    pub forma: String,
    pub forma_nome: Option<String>,
}

/// Código de uma tabela de apoio encontrado.
#[derive(Debug, Clone, Serialize)]
pub struct ItemApoio {
    pub tabela: String,
    pub colunas: Vec<String>,
    pub codigo: Vec<String>,
    pub nome: String,
    /// Procedimentos vigentes ligados a este código.
    pub procedimentos: usize,
}

/// Resultado da busca.
#[derive(Debug, Clone, Serialize)]
pub struct Busca {
    pub consulta: String,
    pub competencia: String,
    /// `codigo` (entrada numérica) ou `texto`.
    pub modo: &'static str,
    pub total_procedimentos: usize,
    pub procedimentos: Vec<ItemProcedimento>,
    pub apoio: Vec<ItemApoio>,
}

/// Termos para o índice de texto: só letras e dígitos (sem aspas nem operadores), cada um
/// como prefixo. `None` se não sobrar termo.
fn termos_fts(entrada: &str) -> Option<String> {
    let termos: Vec<String> = entrada
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if termos.is_empty() {
        None
    } else {
        Some(termos.join(" AND "))
    }
}

impl Consulta {
    /// Resumo de um procedimento vigente para listas.
    fn item_procedimento(
        &self,
        seq: i64,
        codigo: &str,
    ) -> Result<Option<ItemProcedimento>, ErroConsulta> {
        let cols: Vec<(String, String)> = [
            "co_procedimento",
            "no_procedimento",
            "tp_complexidade",
            "vl_sh",
            "vl_sa",
            "vl_sp",
        ]
        .iter()
        .map(|c| (c.to_string(), String::new()))
        .collect();
        let Some((_, v)) = self
            .linhas_vigentes(
                seq,
                "tb_procedimento",
                &cols,
                &[("co_procedimento", codigo)],
            )?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        let num = |x: &Value| if let Value::Integer(n) = x { *n } else { 0 };
        let tp = texto(&v[2]);
        let complexidade = match self
            .dominios
            .descrever("tb_procedimento", "tp_complexidade", &tp)
        {
            Some(Descricao::Oficial(s)) => Some(s.to_string()),
            _ => None,
        };
        let mut st = self.conn().prepare_cached(
            "SELECT DISTINCT n.no_registro FROM rl_procedimento_registro c
             JOIN rl_procedimento_registro__vig v ON v.sa_id = c.sa_id
             JOIN tb_registro n ON n.co_registro = c.co_registro
             JOIN tb_registro__vig w ON w.sa_id = n.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND w.vig_ini <= ?1 AND w.vig_fim >= ?1
               AND c.co_procedimento = ?2 ORDER BY c.co_registro",
        )?;
        let instrumentos = st
            .query_map(rusqlite::params![seq, codigo], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        let presentes: std::collections::BTreeSet<String> =
            util::tabelas(self.conn(), seq)?.into_iter().collect();
        let forma_nome = self
            .estrutura(seq, &presentes, codigo)?
            .pop()
            .and_then(|n| n.nome);
        Ok(Some(ItemProcedimento {
            forma: codigo[..6].to_string(),
            forma_nome,
            codigo: codigo.to_string(),
            codigo_mascarado: mascarar(codigo),
            nome: texto(&v[1]),
            tp_complexidade: tp,
            complexidade,
            valor_total_centavos: num(&v[3]) + num(&v[4]) + num(&v[5]),
            instrumentos,
        }))
    }

    /// Procedimentos vigentes ligados a um código de apoio (ex.: CID `I420` →
    /// procedimentos de `rl_procedimento_cid`). `tabela` é a tabela de destino do manifesto
    /// de referências (ex.: `tb_cid`) e `codigo` os valores da chave.
    pub fn procedimentos_ligados(
        &self,
        comp: Competencia,
        tabela: &str,
        codigo: &[&str],
    ) -> Result<Vec<ItemProcedimento>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let codigos = self.codigos_ligados(seq, tabela, codigo)?;
        let mut v = Vec::with_capacity(codigos.len());
        for c in codigos {
            if let Some(i) = self.item_procedimento(seq, &c)? {
                v.push(i);
            }
        }
        Ok(v)
    }

    /// Códigos de CID vigentes que começam com `prefixo` (a categoria e suas subcategorias), com nome.
    fn cids_com_prefixo(
        &self,
        seq: i64,
        prefixo: &str,
    ) -> Result<Vec<(String, Option<String>)>, ErroConsulta> {
        let t = ident("tb_cid")?;
        let v = ident_vig("tb_cid")?;
        let mut st = self.conn().prepare_cached(&format!(
            "SELECT DISTINCT c.co_cid, c.no_cid FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_cid >= ?2 AND c.co_cid < ?3
             ORDER BY c.co_cid"
        ))?;
        let fim = format!("{prefixo}~");
        let linhas = st
            .query_map(rusqlite::params![seq, prefixo, fim], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(linhas)
    }

    fn codigos_ligados(
        &self,
        seq: i64,
        tabela: &str,
        codigo: &[&str],
    ) -> Result<BTreeSet<String>, ErroConsulta> {
        // Categoria de CID (3 caracteres): leva junto os procedimentos das subcategorias (Z00 → Z000, Z001...).
        if tabela == "tb_cid" && codigo.len() == 1 && codigo[0].len() == 3 {
            let mut todos = BTreeSet::new();
            for (c, _) in self.cids_com_prefixo(seq, codigo[0])? {
                if c.len() != 3 {
                    todos.extend(self.codigos_ligados(seq, tabela, &[c.as_str()])?);
                }
            }
            todos.extend(self.codigos_ligados_exato(seq, tabela, codigo)?);
            return Ok(todos);
        }
        self.codigos_ligados_exato(seq, tabela, codigo)
    }

    fn codigos_ligados_exato(
        &self,
        seq: i64,
        tabela: &str,
        codigo: &[&str],
    ) -> Result<BTreeSet<String>, ErroConsulta> {
        let r = self
            .refs
            .iter()
            .find(|r| r.tabela == tabela)
            .ok_or_else(|| ErroConsulta::Entrada(format!("tabela sem referência: {tabela}")))?;
        if codigo.len() != r.chave.len() {
            return Err(ErroConsulta::Entrada(format!(
                "{tabela}: informe {} valor(es) de código",
                r.chave.len()
            )));
        }
        let mut out = BTreeSet::new();
        for t in util::tabelas(self.conn(), seq)? {
            if t == tabela || !t.starts_with("rl_") {
                continue;
            }
            let cols = util::colunas(self.conn(), seq, &t)?;
            if !cols.iter().any(|(c, _)| c == "co_procedimento") {
                continue;
            }
            for g in &r.de {
                if !g.iter().all(|gc| cols.iter().any(|(c, _)| c == gc)) {
                    continue;
                }
                let filtros: Vec<(&str, &str)> = g
                    .iter()
                    .map(String::as_str)
                    .zip(codigo.iter().copied())
                    .collect();
                let sel = vec![("co_procedimento".to_string(), String::new())];
                for (_, v) in self.linhas_vigentes(seq, &t, &sel, &filtros)? {
                    out.insert(texto(&v[0]));
                }
            }
        }
        Ok(out)
    }

    /// Busca global na competência (até `LIMITE_PROCEDIMENTOS` procedimentos; o total vem à parte).
    pub fn buscar(&self, comp: Competencia, entrada: &str) -> Result<Busca, ErroConsulta> {
        self.buscar_ate(comp, entrada, Some(LIMITE_PROCEDIMENTOS))
    }

    /// A mesma busca, com todos os procedimentos encontrados (para exportar a lista inteira).
    pub fn buscar_todos(&self, comp: Competencia, entrada: &str) -> Result<Busca, ErroConsulta> {
        self.buscar_ate(comp, entrada, None)
    }

    fn buscar_ate(
        &self,
        comp: Competencia,
        entrada: &str,
        limite: Option<usize>,
    ) -> Result<Busca, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let entrada = entrada.trim();
        if entrada.is_empty() {
            return Err(ErroConsulta::Entrada(
                "digite um código, parte do nome, CID, CBO ou habilitação".into(),
            ));
        }
        let digitos: String = entrada
            .chars()
            .filter(|c| !matches!(c, '.' | '-' | ' '))
            .collect();
        let numerico = digitos.len() >= 2 && digitos.bytes().all(|b| b.is_ascii_digit());
        let mut codigos: BTreeSet<String> = BTreeSet::new();
        let mut apoio: BTreeMap<(String, Vec<String>), String> = BTreeMap::new();
        let presentes: BTreeSet<String> = util::tabelas(self.conn(), seq)?.into_iter().collect();
        let t = ident("tb_procedimento")?;
        let v = ident_vig("tb_procedimento")?;
        if numerico {
            let mut st = self.conn().prepare_cached(&format!(
                "SELECT DISTINCT c.co_procedimento FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
                 WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND c.co_procedimento >= ?2 AND c.co_procedimento < ?3"
            ))?;
            let fim = format!("{digitos}~");
            for c in st.query_map(rusqlite::params![seq, digitos, fim], |r| {
                r.get::<_, String>(0)
            })? {
                codigos.insert(c?);
            }
        }
        // Códigos de apoio com chave de uma coluna (CID, CBO, habilitação...): igualdade exata.
        let chave_apoio = entrada.replace('.', "").to_uppercase();
        if chave_apoio.len() >= 3 && chave_apoio.bytes().all(|b| b.is_ascii_alphanumeric()) {
            for r in &self.refs {
                if r.tabela == "tb_procedimento"
                    || r.chave.len() != 1
                    || !presentes.contains(&r.tabela)
                {
                    continue;
                }
                // CID de 3 caracteres: a categoria e todas as suas subcategorias (Z00 → Z00, Z000, Z001...).
                if r.tabela == "tb_cid" && chave_apoio.len() == 3 {
                    for (c, nome) in self.cids_com_prefixo(seq, &chave_apoio)? {
                        apoio.insert((r.tabela.clone(), vec![c]), nome.unwrap_or_default());
                    }
                    continue;
                }
                let cols = util::colunas(self.conn(), seq, &r.tabela)?;
                let Some(nome) = r.nomes.iter().find(|n| cols.iter().any(|(c, _)| c == *n)) else {
                    continue;
                };
                let sel = vec![(nome.clone(), String::new())];
                for (_, x) in
                    self.linhas_vigentes(seq, &r.tabela, &sel, &[(&r.chave[0], &chave_apoio)])?
                {
                    apoio.insert((r.tabela.clone(), vec![chave_apoio.clone()]), texto(&x[0]));
                }
            }
        }
        // Texto: índice FTS5 (sem acento, por partes).
        if !numerico && let Some(q) = termos_fts(entrada) {
            let mut st = self.conn().prepare_cached(&format!(
                "SELECT DISTINCT c.co_procedimento FROM sa_q_busca b
                 JOIN {t} c ON c.sa_id = b.sa_id JOIN {v} v ON v.sa_id = c.sa_id
                 WHERE sa_q_busca MATCH ?2 AND b.tabela = 'tb_procedimento'
                   AND v.vig_ini <= ?1 AND v.vig_fim >= ?1"
            ))?;
            for c in st.query_map(rusqlite::params![seq, q], |r| r.get::<_, String>(0))? {
                codigos.insert(c?);
            }
            for r in &self.refs {
                if r.tabela == "tb_procedimento" || !presentes.contains(&r.tabela) {
                    continue;
                }
                let ti = ident(&r.tabela)?;
                let vi = ident_vig(&r.tabela)?;
                let chave = r
                    .chave
                    .iter()
                    .map(|c| ident(c).map(|i| format!("c.{i}")))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(", ");
                let mut st = self.conn().prepare_cached(&format!(
                    "SELECT {chave}, b.texto FROM sa_q_busca b
                     JOIN {ti} c ON c.sa_id = b.sa_id JOIN {vi} v ON v.sa_id = c.sa_id
                     WHERE sa_q_busca MATCH ?2 AND b.tabela = ?3
                       AND v.vig_ini <= ?1 AND v.vig_fim >= ?1 LIMIT ?4"
                ))?;
                let n = r.chave.len();
                let linhas = st
                    .query_map(
                        rusqlite::params![seq, q, r.tabela, LIMITE_APOIO as i64],
                        |x| {
                            let mut k = Vec::with_capacity(n);
                            for i in 0..n {
                                k.push(texto(&x.get::<_, Value>(i)?));
                            }
                            Ok((k, x.get::<_, String>(n)?))
                        },
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                for (k, nome) in linhas {
                    apoio.insert((r.tabela.clone(), k), nome);
                }
            }
        }
        let total = codigos.len();
        let mut procedimentos = Vec::new();
        for c in codigos.iter().take(limite.unwrap_or(usize::MAX)) {
            if let Some(i) = self.item_procedimento(seq, c)? {
                procedimentos.push(i);
            }
        }
        let mut itens = Vec::new();
        for ((tabela, codigo), nome) in apoio.into_iter().take(LIMITE_APOIO) {
            let r = self
                .refs
                .iter()
                .find(|r| r.tabela == tabela)
                .expect("referência");
            let refs: Vec<&str> = codigo.iter().map(String::as_str).collect();
            let procedimentos = self.codigos_ligados(seq, &tabela, &refs)?.len();
            itens.push(ItemApoio {
                colunas: r.chave.clone(),
                tabela,
                codigo,
                nome,
                procedimentos,
            });
        }
        Ok(Busca {
            consulta: entrada.to_string(),
            competencia: comp.to_string(),
            modo: if numerico { "codigo" } else { "texto" },
            total_procedimentos: total,
            procedimentos,
            apoio: itens,
        })
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn termos_sem_operadores() {
        assert_eq!(
            termos_fts("cardio desfib").unwrap(),
            "\"cardio\"* AND \"desfib\"*"
        );
        assert_eq!(
            termos_fts("a\" OR x NEAR(").unwrap(),
            "\"a\"* AND \"OR\"* AND \"x\"* AND \"NEAR\"*"
        );
        assert!(termos_fts("--- ...").is_none());
    }
}
