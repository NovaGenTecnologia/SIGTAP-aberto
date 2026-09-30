//! Histórico de um procedimento: tudo o que entrou, saiu ou mudou, em todas as tabelas que o
//! citam, nas competências carregadas.

use crate::ficha::{Linha, normalizar_codigo};
use crate::mudancas::{chave_de, colunas_do_banco, diferentes, parear};
use crate::util::{self, ident, ident_vig, mascarar};
use crate::{Consulta, ErroConsulta};
use sa_core::Competencia;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Um acontecimento na linha do tempo.
#[derive(Debug, Clone, Serialize)]
pub struct Evento {
    pub competencia: String,
    pub rotulo: String,
    pub tabela: String,
    /// Coluna que cita o procedimento.
    pub coluna: String,
    /// `incluido`, `excluido` ou `alterado`.
    pub tipo: &'static str,
    pub chave: BTreeMap<String, String>,
    pub antes: Option<Linha>,
    pub depois: Option<Linha>,
    pub campos_alterados: Vec<String>,
    /// A tabela inteira não veio no ZIP desta competência (a "exclusão" é ausência do arquivo).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub tabela_ausente: bool,
    /// A tabela voltou a vir no ZIP depois de ausente (a "inclusão" é volta do arquivo).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub tabela_voltou: bool,
}

/// Linha do tempo do procedimento.
#[derive(Debug, Clone, Serialize)]
pub struct Historico {
    pub codigo: String,
    pub codigo_mascarado: String,
    pub primeira_carregada: String,
    pub ultima_carregada: String,
    pub competencias_carregadas: usize,
    /// Competências (AAAAMM) com pelo menos um evento, da mais recente para a mais antiga.
    pub competencias_com_mudanca: Vec<String>,
    /// Eventos da competência mais recente para a mais antiga.
    pub eventos: Vec<Evento>,
}

impl Consulta {
    /// Histórico completo do procedimento nas competências carregadas.
    pub fn historico(&self, codigo: &str) -> Result<Historico, ErroConsulta> {
        let codigo = normalizar_codigo(codigo)?;
        let seqs = self.seqs().to_vec();
        let (Some(&primeira), Some(&ultima)) = (seqs.first(), seqs.last()) else {
            return Err(ErroConsulta::BancoVazio);
        };
        let proxima = |s: i64| seqs.iter().copied().find(|&x| x > s);
        let anterior = |s: i64| seqs.iter().copied().rev().find(|&x| x < s);
        let chaves = sa_sources::sigtap::chaves_naturais();
        let grupos: Vec<String> = self
            .ref_procedimento()
            .de
            .iter()
            .filter(|g| g.len() == 1)
            .map(|g| g[0].clone())
            .collect();
        // Tabelas presentes por competência (para distinguir ausência do arquivo).
        let mut presentes_em: BTreeMap<i64, BTreeSet<String>> = BTreeMap::new();
        for &s in &seqs {
            presentes_em.insert(s, util::tabelas(self.conn(), s)?.into_iter().collect());
        }
        let todas: BTreeSet<String> = presentes_em.values().flatten().cloned().collect();
        let mut eventos = Vec::new();
        for t in &todas {
            let cols = colunas_do_banco(self.conn(), t)?;
            for g in &grupos {
                if !cols.contains(g) || (t == "tb_procedimento" && g != "co_procedimento") {
                    continue;
                }
                let ti = ident(t)?;
                let vi = ident_vig(t)?;
                let gi = ident(g)?;
                let mut st = self.conn().prepare_cached(&format!(
                    "SELECT c.sa_id, v.vig_ini, v.vig_fim FROM {ti} c JOIN {vi} v ON v.sa_id = c.sa_id WHERE c.{gi} = ?1"
                ))?;
                let intervalos = st
                    .query_map([&codigo], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                let ids: Vec<i64> = intervalos
                    .iter()
                    .map(|x| x.0)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect();
                let conteudos = self.conteudos(t, &ids)?;
                // Por competência: (excluídos, incluídos).
                type Lado<'a> = Vec<(Vec<String>, (i64, &'a crate::mudancas::Conteudo))>;
                let mut por: BTreeMap<i64, (Lado<'_>, Lado<'_>)> = BTreeMap::new();
                let chave = chaves.get(t).cloned().unwrap_or_default();
                for (id, ini, fim) in &intervalos {
                    let c = &conteudos[id];
                    let k = chave_de(&chave, &c.valores);
                    if *ini > primeira {
                        por.entry(*ini).or_default().1.push((k.clone(), (*ini, c)));
                    }
                    if let Some(p) = proxima(*fim) {
                        por.entry(p).or_default().0.push((k, (*fim, c)));
                    }
                }
                for (s, (ex, inc)) in por {
                    let comp =
                        Competencia::de_seq(s).map_err(|e| ErroConsulta::Entrada(e.to_string()))?;
                    let ausente = !presentes_em[&s].contains(t);
                    let voltou =
                        anterior(s).is_some_and(|a| !presentes_em[&a].contains(t)) && !ausente;
                    for (k, x, y) in parear(ex, inc, !chave.is_empty()) {
                        let tipo = match (&x, &y) {
                            (Some(_), Some(_)) => "alterado",
                            (Some(_), None) => "excluido",
                            _ => "incluido",
                        };
                        let campos_alterados = match (&x, &y) {
                            (Some(a), Some(b)) => diferentes(&a.1.valores, &b.1.valores),
                            _ => Vec::new(),
                        };
                        let antes = match x {
                            Some((sf, c)) => {
                                Some(self.linha_em(sf, &presentes_em[&sf], t, c, Some(g))?)
                            }
                            None => None,
                        };
                        let depois = match y {
                            Some((si, c)) => {
                                Some(self.linha_em(si, &presentes_em[&si], t, c, Some(g))?)
                            }
                            None => None,
                        };
                        eventos.push(Evento {
                            competencia: comp.to_string(),
                            rotulo: util::rotulo(comp),
                            tabela: t.clone(),
                            coluna: g.clone(),
                            tipo,
                            chave: chave.iter().cloned().zip(k).collect(),
                            antes,
                            depois,
                            campos_alterados,
                            tabela_ausente: ausente,
                            tabela_voltou: voltou,
                        });
                    }
                }
            }
        }
        eventos.sort_by(|a, b| {
            b.competencia
                .cmp(&a.competencia)
                .then(a.tabela.cmp(&b.tabela))
                .then(a.coluna.cmp(&b.coluna))
        });
        let mut com: Vec<String> = eventos.iter().map(|e| e.competencia.clone()).collect();
        com.dedup();
        let c = |s: i64| {
            Competencia::de_seq(s)
                .map(|c| c.to_string())
                .unwrap_or_default()
        };
        Ok(Historico {
            codigo_mascarado: mascarar(&codigo),
            codigo,
            primeira_carregada: c(primeira),
            ultima_carregada: c(ultima),
            competencias_carregadas: seqs.len(),
            competencias_com_mudanca: com,
            eventos,
        })
    }
}
