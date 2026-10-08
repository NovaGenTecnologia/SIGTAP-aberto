//! Ficha do procedimento: todos os atributos de `tb_procedimento` e **todas** as tabelas do ZIP
//! da competência que citam o procedimento, com os nomes dos códigos.

use crate::util::{self, ColunaLeiaute, ident, ident_vig, json, mascarar, texto};
use crate::{Consulta, ErroConsulta};
use rusqlite::types::Value;
use sa_core::Competencia;
use sa_sources::sigtap::dominios::Descricao;
use sa_sources::sigtap::referencias::Referencia;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Um campo de uma linha, com o valor oficial e como exibi-lo.
#[derive(Debug, Clone, Serialize)]
pub struct Campo {
    pub coluna: String,
    /// Nome da coluna no leiaute oficial.
    pub coluna_origem: String,
    /// Valor como está no arquivo oficial (NUMBER vira número; demais, texto).
    pub valor: serde_json::Value,
    /// Descrição do código pelo `Lay-out.xls`, quando a coluna tem domínio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descricao: Option<String>,
    /// `oficial`, `sem_descricao` (código fora do leiaute) ou `desconhecido`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub situacao: Option<&'static str>,
    /// Significado do valor especial (ex.: 9999 = "Não se aplica").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentinela: Option<String>,
    /// `true` se o significado da sentinela é inferido (a fonte não documenta a coluna).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub sentinela_inferida: bool,
    /// `centavos`, `centesimos_de_percentual` ou `meses`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unidade: Option<&'static str>,
}

/// Nome de um código, buscado na tabela de destino da mesma competência.
#[derive(Debug, Clone, Serialize)]
pub struct Nome {
    pub tabela: String,
    pub colunas: Vec<String>,
    /// `false` quando a tabela de destino não veio no ZIP desta competência.
    pub tabela_presente: bool,
    /// Linhas encontradas (normalmente uma; vazio = código sem nome nesta competência).
    pub encontrados: Vec<BTreeMap<String, String>>,
}

/// Uma linha de tabela oficial.
#[derive(Debug, Clone, Serialize)]
pub struct Linha {
    /// Vezes em que a linha aparece repetida no arquivo oficial (normalmente 1).
    pub quantidade: i64,
    pub campos: Vec<Campo>,
    pub nomes: Vec<Nome>,
}

/// Uma tabela do ZIP que cita o procedimento por uma coluna.
#[derive(Debug, Clone, Serialize)]
pub struct Relacao {
    pub tabela: String,
    /// Coluna que cita o procedimento (ex.: `co_procedimento_principal`).
    pub coluna: String,
    pub linhas: Vec<Linha>,
}

/// Nível da estrutura (grupo, subgrupo, forma de organização).
#[derive(Debug, Clone, Serialize)]
pub struct Nivel {
    pub nivel: &'static str,
    pub codigo: String,
    /// `None` quando a tabela de estrutura não tem o código nesta competência.
    pub nome: Option<String>,
}

/// Ficha completa.
#[derive(Debug, Clone, Serialize)]
pub struct Ficha {
    pub competencia: String,
    pub rotulo: String,
    pub codigo: String,
    pub codigo_mascarado: String,
    pub estrutura: Vec<Nivel>,
    /// Linha(s) de `tb_procedimento` (normalmente uma).
    pub procedimento: Vec<Linha>,
    /// Uma entrada por (tabela, coluna) que pode citar o procedimento, mesmo sem linhas.
    pub relacoes: Vec<Relacao>,
}

/// Linha lida do banco: quantidade e valores na ordem das colunas.
pub(crate) type LinhaBruta = (i64, Vec<Value>);

/// Valida um código de procedimento de 10 dígitos (aceita máscara).
pub fn normalizar_codigo(entrada: &str) -> Result<String, ErroConsulta> {
    let d: String = entrada
        .chars()
        .filter(|c| !matches!(c, '.' | '-' | ' '))
        .collect();
    if d.len() == 10 && d.bytes().all(|b| b.is_ascii_digit()) {
        Ok(d)
    } else {
        let mostrado: String = entrada.chars().take(40).collect();
        Err(ErroConsulta::Entrada(format!(
            "código de procedimento inválido: '{mostrado}'. Use 10 dígitos, com ou sem pontos (ex.: 04.06.01.057-9)."
        )))
    }
}

impl Consulta {
    /// Linhas vigentes em `seq` com filtros de igualdade (`coluna = valor`).
    pub(crate) fn linhas_vigentes(
        &self,
        seq: i64,
        tabela: &str,
        cols: &[ColunaLeiaute],
        filtros: &[(&str, &str)],
    ) -> Result<Vec<LinhaBruta>, ErroConsulta> {
        let t = ident(tabela)?;
        let v = ident_vig(tabela)?;
        // DT_COMPETENCIA não é guardada (é sempre a competência do arquivo): sai da consulta
        // como NULL e é preenchida abaixo.
        let lista = cols
            .iter()
            .map(|(c, _)| {
                if c == util::COL_DT {
                    Ok("NULL".to_string())
                } else {
                    ident(c).map(|i| format!("c.{i}"))
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        let dt = util::texto_competencia(seq);
        let mut sql = format!(
            "SELECT c.sa_qtd{}{} FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
            if lista.is_empty() { "" } else { ", " },
            lista.join(", ")
        );
        for (i, (c, _)) in filtros.iter().enumerate() {
            sql.push_str(&format!(" AND c.{} = ?{}", ident(c)?, i + 2));
        }
        if !lista.is_empty() {
            sql.push_str(&format!(" ORDER BY {}", lista.join(", ")));
        }
        let mut st = self.conn().prepare_cached(&sql)?;
        let mut p: Vec<Value> = vec![Value::Integer(seq)];
        p.extend(filtros.iter().map(|(_, x)| Value::Text((*x).to_string())));
        let v = st
            .query_map(rusqlite::params_from_iter(p), |r| {
                let q: i64 = r.get(0)?;
                let mut vals = Vec::with_capacity(cols.len());
                for (i, (c, _)) in cols.iter().enumerate() {
                    if c == util::COL_DT {
                        vals.push(Value::Text(dt.clone()));
                    } else {
                        vals.push(r.get::<_, Value>(i + 1)?);
                    }
                }
                Ok((q, vals))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// Nomes de um código na tabela de destino da referência.
    fn buscar_nome(
        &self,
        seq: i64,
        presentes: &BTreeSet<String>,
        r: &Referencia,
        valores: &[String],
    ) -> Result<Nome, ErroConsulta> {
        let presente = presentes.contains(&r.tabela);
        let mut encontrados = Vec::new();
        if presente {
            let cols_t = util::colunas(self.conn(), seq, &r.tabela)?;
            let tem = |c: &String| cols_t.iter().any(|(n, _)| n == c);
            if r.chave.iter().all(tem) {
                let nomes: Vec<ColunaLeiaute> = cols_t
                    .iter()
                    .filter(|(n, _)| r.nomes.contains(n))
                    .cloned()
                    .collect();
                let filtros: Vec<(&str, &str)> = r
                    .chave
                    .iter()
                    .map(String::as_str)
                    .zip(valores.iter().map(String::as_str))
                    .collect();
                for (_, vals) in self.linhas_vigentes(seq, &r.tabela, &nomes, &filtros)? {
                    encontrados.push(
                        nomes
                            .iter()
                            .zip(vals.iter())
                            .map(|((n, _), v)| (n.clone(), texto(v)))
                            .collect(),
                    );
                }
            }
        }
        Ok(Nome {
            tabela: r.tabela.clone(),
            colunas: r.chave.clone(),
            tabela_presente: presente,
            encontrados,
        })
    }

    /// Monta uma linha: campos com domínio/sentinela/unidade e nomes das referências.
    /// `ignorar` = coluna que já é o próprio procedimento da ficha (não repete o nome).
    pub(crate) fn montar_linha(
        &self,
        seq: i64,
        presentes: &BTreeSet<String>,
        tabela: &str,
        cols: &[ColunaLeiaute],
        bruta: &LinhaBruta,
        ignorar: Option<&str>,
    ) -> Result<Linha, ErroConsulta> {
        let (qtd, vals) = bruta;
        let mut campos = Vec::with_capacity(cols.len());
        for ((c, origem), v) in cols.iter().zip(vals.iter()) {
            let mut campo = Campo {
                coluna: c.clone(),
                coluna_origem: origem.clone(),
                valor: json(v),
                descricao: None,
                situacao: None,
                sentinela: None,
                sentinela_inferida: false,
                unidade: None,
            };
            if let Some(d) = self.dominios.descrever(tabela, c, &texto(v)) {
                let (desc, sit) = match d {
                    Descricao::Oficial(s) => (Some(s.to_string()), "oficial"),
                    Descricao::SemDescricao(n) => (Some(n.to_string()), "sem_descricao"),
                    Descricao::Desconhecido => (None, "desconhecido"),
                };
                campo.descricao = desc;
                campo.situacao = Some(sit);
            }
            if let (Some(s), Value::Integer(n)) = (self.dominios.sentinela(tabela, c), v)
                && s.valor == *n
            {
                campo.sentinela = Some(s.significado.clone());
                campo.sentinela_inferida = s.inferido;
            }
            campo.unidade = self.dominios.unidade(tabela, c).map(|u| match u {
                sa_sources::sigtap::dominios::Unidade::Centavos => "centavos",
                sa_sources::sigtap::dominios::Unidade::CentesimosDePercentual => {
                    "centesimos_de_percentual"
                }
                sa_sources::sigtap::dominios::Unidade::Meses => "meses",
            });
            campos.push(campo);
        }
        let mut nomes = Vec::new();
        for r in &self.refs {
            if r.tabela == tabela {
                continue;
            }
            for g in &r.de {
                if g.len() == 1 && Some(g[0].as_str()) == ignorar {
                    continue;
                }
                let pos: Option<Vec<usize>> = g
                    .iter()
                    .map(|gc| cols.iter().position(|(c, _)| c == gc))
                    .collect();
                let Some(pos) = pos else { continue };
                let valores: Vec<String> = pos.iter().map(|&i| texto(&vals[i])).collect();
                if valores.iter().all(|v| v.trim().is_empty()) {
                    continue; // campo vazio no arquivo oficial: não há o que procurar
                }
                let mut n = self.buscar_nome(seq, presentes, r, &valores)?;
                n.colunas = g.clone();
                nomes.push(n);
            }
        }
        Ok(Linha {
            quantidade: *qtd,
            campos,
            nomes,
        })
    }

    /// Referência que dá nome ao procedimento (manifesto).
    pub(crate) fn ref_procedimento(&self) -> &Referencia {
        self.refs
            .iter()
            .find(|r| r.tabela == "tb_procedimento")
            .expect("manifesto de referências sem tb_procedimento")
    }

    /// Ficha do procedimento na competência. `Ok(None)` se o código não existe nela.
    pub fn ficha(&self, comp: Competencia, codigo: &str) -> Result<Option<Ficha>, ErroConsulta> {
        let codigo = normalizar_codigo(codigo)?;
        let seq = self.exigir(comp)?;
        let presentes: BTreeSet<String> = util::tabelas(self.conn(), seq)?.into_iter().collect();
        let cols_p = util::colunas(self.conn(), seq, "tb_procedimento")?;
        let brutas = self.linhas_vigentes(
            seq,
            "tb_procedimento",
            &cols_p,
            &[("co_procedimento", &codigo)],
        )?;
        if brutas.is_empty() {
            return Ok(None);
        }
        let procedimento = brutas
            .iter()
            .map(|b| {
                self.montar_linha(
                    seq,
                    &presentes,
                    "tb_procedimento",
                    &cols_p,
                    b,
                    Some("co_procedimento"),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut relacoes = Vec::new();
        let grupos: Vec<String> = self
            .ref_procedimento()
            .de
            .iter()
            .filter(|g| g.len() == 1)
            .map(|g| g[0].clone())
            .collect();
        for t in presentes.iter().filter(|t| *t != "tb_procedimento") {
            let cols = util::colunas(self.conn(), seq, t)?;
            for g in &grupos {
                if !cols.iter().any(|(c, _)| c == g) {
                    continue;
                }
                let linhas = self
                    .linhas_vigentes(seq, t, &cols, &[(g, &codigo)])?
                    .iter()
                    .map(|b| self.montar_linha(seq, &presentes, t, &cols, b, Some(g)))
                    .collect::<Result<Vec<_>, _>>()?;
                relacoes.push(Relacao {
                    tabela: t.clone(),
                    coluna: g.clone(),
                    linhas,
                });
            }
        }
        let estrutura = self.estrutura(seq, &presentes, &codigo)?;
        Ok(Some(Ficha {
            competencia: comp.to_string(),
            rotulo: util::rotulo(comp),
            codigo_mascarado: mascarar(&codigo),
            codigo,
            estrutura,
            procedimento,
            relacoes,
        }))
    }

    /// Grupo, subgrupo e forma de organização pelos prefixos do código (2, 4 e 6 dígitos).
    pub(crate) fn estrutura(
        &self,
        seq: i64,
        presentes: &BTreeSet<String>,
        codigo: &str,
    ) -> Result<Vec<Nivel>, ErroConsulta> {
        let niveis = [
            ("grupo", "tb_grupo", 1usize),
            ("subgrupo", "tb_sub_grupo", 2),
            ("forma", "tb_forma_organizacao", 3),
        ];
        let mut v = Vec::new();
        for (nivel, alvo, n) in niveis {
            let partes: Vec<String> = (0..n)
                .map(|k| codigo[k * 2..k * 2 + 2].to_string())
                .collect();
            let r = self
                .refs
                .iter()
                .find(|r| r.tabela == alvo)
                .expect("manifesto de referências sem tabela de estrutura");
            let nome = self
                .buscar_nome(seq, presentes, r, &partes)?
                .encontrados
                .into_iter()
                .next()
                .and_then(|m| m.into_values().next());
            v.push(Nivel {
                nivel,
                codigo: partes.concat(),
                nome,
            });
        }
        Ok(v)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn codigo_com_e_sem_mascara() {
        assert_eq!(normalizar_codigo("04.06.01.057-9").unwrap(), "0406010579");
        assert_eq!(normalizar_codigo("0406010579").unwrap(), "0406010579");
        assert!(normalizar_codigo("040601057").is_err());
        assert!(normalizar_codigo("04060105a9").is_err());
    }

    #[test]
    fn erro_de_codigo_nao_repete_a_entrada_inteira() {
        let msg = normalizar_codigo(&"9".repeat(1_000_000))
            .unwrap_err()
            .to_string();
        assert!(msg.len() < 300, "{}", msg.len());
    }

    #[test]
    fn padrao_longo_demais_nao_manda_refazer_o_banco() {
        let e = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some("LIKE or GLOB pattern too complex".into()),
        );
        let msg = ErroConsulta::Sql(e).to_string();
        assert!(
            msg.contains("longo demais") && !msg.contains("refaça"),
            "{msg}"
        );
    }
}
