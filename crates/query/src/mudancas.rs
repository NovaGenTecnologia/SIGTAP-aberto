//! "O que mudou": diferença entre duas competências carregadas, por tabela, com inclusões,
//! exclusões e alterações pareadas pela chave natural (manifesto de chaves).

use crate::ficha::{Linha, LinhaBruta};
use crate::util::{self, ColunaLeiaute, ident, ident_vig, texto};
use crate::{Consulta, ErroConsulta};
use rusqlite::types::Value;
use sa_core::Competencia;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Limite padrão de itens detalhados por tabela.
pub const LIMITE_ITENS: usize = 300;

/// Uma inclusão, exclusão ou alteração.
#[derive(Debug, Clone, Serialize)]
pub struct ItemMudanca {
    /// `incluido`, `excluido` ou `alterado`.
    pub tipo: &'static str,
    /// Valores da chave natural (vazio para tabelas sem chave natural).
    pub chave: BTreeMap<String, String>,
    pub antes: Option<Linha>,
    pub depois: Option<Linha>,
    /// Colunas com valor diferente (só em `alterado`).
    pub campos_alterados: Vec<String>,
}

/// Mudanças de uma tabela.
#[derive(Debug, Clone, Serialize)]
pub struct MudancaTabela {
    pub tabela: String,
    pub presente_antes: bool,
    pub presente_depois: bool,
    pub incluidos: usize,
    pub excluidos: usize,
    pub alterados: usize,
    pub itens: Vec<ItemMudanca>,
    /// Posição do primeiro item de `itens` na lista completa da tabela.
    pub desde: usize,
    /// Itens não detalhados depois de `itens` (por causa do limite).
    pub itens_omitidos: usize,
}

/// Resultado de "o que mudou".
#[derive(Debug, Clone, Serialize)]
pub struct Mudancas {
    pub de: String,
    pub para: String,
    pub tabelas: Vec<MudancaTabela>,
}

/// Linha de conteúdo com todas as colunas do banco (união de leiautes).
pub(crate) struct Conteudo {
    pub(crate) qtd: i64,
    /// Coluna → valor.
    pub(crate) valores: BTreeMap<String, Value>,
}

/// Colunas de origem da tabela no banco (união de todos os leiautes).
pub(crate) fn colunas_do_banco(
    conn: &rusqlite::Connection,
    tabela: &str,
) -> Result<Vec<String>, ErroConsulta> {
    let mut st = conn.prepare_cached("SELECT name FROM pragma_table_info(?1) ORDER BY cid")?;
    let v = st
        .query_map([tabela], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(v.into_iter().filter(|c| !c.starts_with("sa_")).collect())
}

/// Chave natural de uma linha (texto dos valores das colunas da chave).
pub(crate) fn chave_de(chave: &[String], valores: &BTreeMap<String, Value>) -> Vec<String> {
    chave
        .iter()
        .map(|c| valores.get(c).map(texto).unwrap_or_default())
        .collect()
}

/// Colunas cujos valores diferem.
pub(crate) fn diferentes(a: &BTreeMap<String, Value>, b: &BTreeMap<String, Value>) -> Vec<String> {
    let cols: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    cols.into_iter()
        .filter(|c| a.get(*c) != b.get(*c))
        .cloned()
        .collect()
}

/// Pareia exclusões e inclusões pela chave: mesma chave = alteração.
pub(crate) fn parear<T>(
    excluidos: Vec<(Vec<String>, T)>,
    incluidos: Vec<(Vec<String>, T)>,
    com_chave: bool,
) -> Vec<(Vec<String>, Option<T>, Option<T>)> {
    let mut por: BTreeMap<Vec<String>, (Vec<T>, Vec<T>)> = BTreeMap::new();
    for (k, x) in excluidos {
        por.entry(if com_chave { k } else { Vec::new() })
            .or_default()
            .0
            .push(x);
    }
    let mut saida = Vec::new();
    for (k, x) in incluidos {
        por.entry(if com_chave { k } else { Vec::new() })
            .or_default()
            .1
            .push(x);
    }
    for (k, (ex, inc)) in por {
        if !com_chave {
            saida.extend(ex.into_iter().map(|e| (k.clone(), Some(e), None)));
            saida.extend(inc.into_iter().map(|i| (k.clone(), None, Some(i))));
            continue;
        }
        let mut ex = ex.into_iter();
        let mut inc = inc.into_iter();
        loop {
            match (ex.next(), inc.next()) {
                (None, None) => break,
                (a, b) => saida.push((k.clone(), a, b)),
            }
        }
    }
    saida
}

impl Consulta {
    /// Lê conteúdos por `sa_id` com todas as colunas do banco.
    pub(crate) fn conteudos(
        &self,
        tabela: &str,
        ids: &[i64],
    ) -> Result<BTreeMap<i64, Conteudo>, ErroConsulta> {
        let cols = colunas_do_banco(self.conn(), tabela)?;
        let t = ident(tabela)?;
        let lista = cols
            .iter()
            .map(|c| ident(c).map(|i| format!("c.{i}")))
            .collect::<Result<Vec<_>, _>>()?;
        let mut st = self.conn().prepare_cached(&format!(
            "SELECT c.sa_id, c.sa_qtd{}{} FROM {t} c WHERE c.sa_id = ?1",
            if lista.is_empty() { "" } else { ", " },
            lista.join(", ")
        ))?;
        let mut m = BTreeMap::new();
        for id in ids {
            let (qtd, valores) = st.query_row([id], |r| {
                let mut vals = BTreeMap::new();
                for (i, c) in cols.iter().enumerate() {
                    vals.insert(c.clone(), r.get::<_, Value>(i + 2)?);
                }
                Ok((r.get::<_, i64>(1)?, vals))
            })?;
            m.insert(*id, Conteudo { qtd, valores });
        }
        Ok(m)
    }

    /// Linha pronta para exibir com o leiaute da competência `seq`.
    pub(crate) fn linha_em(
        &self,
        seq: i64,
        presentes: &BTreeSet<String>,
        tabela: &str,
        c: &Conteudo,
        ignorar: Option<&str>,
    ) -> Result<Linha, ErroConsulta> {
        let cols: Vec<ColunaLeiaute> = util::colunas(self.conn(), seq, tabela)?;
        let bruta: LinhaBruta = (
            c.qtd,
            cols.iter()
                .map(|(n, _)| {
                    if n == util::COL_DT {
                        Value::Text(util::texto_competencia(seq))
                    } else {
                        c.valores.get(n).cloned().unwrap_or(Value::Null)
                    }
                })
                .collect(),
        );
        self.montar_linha(seq, presentes, tabela, &cols, &bruta, ignorar)
    }

    fn ids_vigentes(&self, tabela: &str, seq: i64) -> Result<BTreeSet<i64>, ErroConsulta> {
        let v = ident_vig(tabela)?;
        let mut st = self.conn().prepare_cached(&format!(
            "SELECT sa_id FROM {v} WHERE vig_ini <= ?1 AND vig_fim >= ?1"
        ))?;
        let r = st
            .query_map([seq], |r| r.get::<_, i64>(0))?
            .collect::<Result<BTreeSet<_>, _>>()?;
        Ok(r)
    }

    /// O que mudou de `de` para `para` (ambas carregadas). `limite` = itens detalhados por
    /// tabela (os demais só entram na contagem).
    pub fn o_que_mudou(
        &self,
        de: Competencia,
        para: Competencia,
        limite: usize,
    ) -> Result<Mudancas, ErroConsulta> {
        self.mudancas(de, para, None, 0, limite)
    }

    /// Mais itens de uma tabela de "o que mudou": `limite` itens a partir da posição `desde`
    /// (botão "ver mais" da interface). A ordem é a mesma de [`Self::o_que_mudou`].
    pub fn o_que_mudou_tabela(
        &self,
        de: Competencia,
        para: Competencia,
        tabela: &str,
        desde: usize,
        limite: usize,
    ) -> Result<Option<MudancaTabela>, ErroConsulta> {
        Ok(self
            .mudancas(de, para, Some(tabela), desde, limite)?
            .tabelas
            .into_iter()
            .next())
    }

    fn mudancas(
        &self,
        de: Competencia,
        para: Competencia,
        so: Option<&str>,
        desde: usize,
        limite: usize,
    ) -> Result<Mudancas, ErroConsulta> {
        let sa = self.exigir(de)?;
        let sb = self.exigir(para)?;
        let pa: BTreeSet<String> = util::tabelas(self.conn(), sa)?.into_iter().collect();
        let pb: BTreeSet<String> = util::tabelas(self.conn(), sb)?.into_iter().collect();
        if let Some(x) = so
            && !pa.contains(x)
            && !pb.contains(x)
        {
            let x: String = x.chars().take(40).collect();
            return Err(ErroConsulta::Entrada(format!(
                "a tabela '{x}' não existe nesta comparação"
            )));
        }
        let chaves = sa_sources::sigtap::chaves_naturais();
        let mut tabelas = Vec::new();
        for t in pa.union(&pb) {
            if so.is_some_and(|x| x != t) {
                continue;
            }
            let a = if pa.contains(t) {
                self.ids_vigentes(t, sa)?
            } else {
                BTreeSet::new()
            };
            let b = if pb.contains(t) {
                self.ids_vigentes(t, sb)?
            } else {
                BTreeSet::new()
            };
            let saiu: Vec<i64> = a.difference(&b).copied().collect();
            let entrou: Vec<i64> = b.difference(&a).copied().collect();
            if saiu.is_empty() && entrou.is_empty() && pa.contains(t) == pb.contains(t) {
                continue;
            }
            let chave = chaves.get(t).cloned().unwrap_or_default();
            let cs = self.conteudos(t, &saiu)?;
            let ce = self.conteudos(t, &entrou)?;
            let ex: Vec<_> = cs
                .values()
                .map(|c| (chave_de(&chave, &c.valores), c))
                .collect();
            let inc: Vec<_> = ce
                .values()
                .map(|c| (chave_de(&chave, &c.valores), c))
                .collect();
            let pares = parear(ex, inc, !chave.is_empty());
            let (mut ni, mut ne, mut na) = (0, 0, 0);
            for (_, x, y) in &pares {
                match (x, y) {
                    (Some(_), Some(_)) => na += 1,
                    (Some(_), None) => ne += 1,
                    _ => ni += 1,
                }
            }
            let mut itens = Vec::new();
            for (k, x, y) in pares.iter().skip(desde).take(limite) {
                let tipo = match (x, y) {
                    (Some(_), Some(_)) => "alterado",
                    (Some(_), None) => "excluido",
                    _ => "incluido",
                };
                let campos_alterados = match (x, y) {
                    (Some(a), Some(b)) => diferentes(&a.valores, &b.valores),
                    _ => Vec::new(),
                };
                itens.push(ItemMudanca {
                    tipo,
                    chave: chave.iter().cloned().zip(k.iter().cloned()).collect(),
                    antes: x.map(|c| self.linha_em(sa, &pa, t, c, None)).transpose()?,
                    depois: y.map(|c| self.linha_em(sb, &pb, t, c, None)).transpose()?,
                    campos_alterados,
                });
            }
            tabelas.push(MudancaTabela {
                tabela: t.clone(),
                presente_antes: pa.contains(t),
                presente_depois: pb.contains(t),
                incluidos: ni,
                excluidos: ne,
                alterados: na,
                desde,
                itens_omitidos: pares.len().saturating_sub(desde + itens.len()),
                itens,
            });
        }
        Ok(Mudancas {
            de: de.to_string(),
            para: para.to_string(),
            tabelas,
        })
    }
}
