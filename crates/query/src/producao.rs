//! Consultas da produção do SUS (SIA e SIH) de uma UF: quem produziu um procedimento, o que uma
//! unidade produziu e o que o SIH rejeitou nela. Só totais: o banco não tem linha de paciente.
//!
//! Os números são "apresentados e aprovados" no SIA e AIH aprovadas no SIH, como o DATASUS
//! publica. Nomes de estabelecimento e de procedimento ficam com quem chama (CNES e SIGTAP).

use crate::ErroConsulta;
use rusqlite::{Connection, OptionalExtension};
use sa_packs::producao::{ArquivoCarregado, BancoProducao};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

/// Consultas sobre o banco de produção de uma UF.
pub struct ConsultaProducao {
    pub(crate) banco: BancoProducao,
}

/// Qual produção: ambulatorial (SIA) ou hospitalar (SIH).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origem {
    Ambulatorial,
    Hospitalar,
}

impl Origem {
    fn tabela(self) -> &'static str {
        match self {
            Origem::Ambulatorial => "prod_amb",
            Origem::Hospitalar => "prod_hosp",
        }
    }
    fn coluna_qtd(self) -> &'static str {
        match self {
            Origem::Ambulatorial => "qtd",
            Origem::Hospitalar => "aih",
        }
    }
    /// `"sia"` ou `"sih"`.
    pub fn sistema(self) -> &'static str {
        match self {
            Origem::Ambulatorial => "sia",
            Origem::Hospitalar => "sih",
        }
    }
}

/// O que está carregado.
#[derive(Debug, Clone, Serialize)]
pub struct ResumoProducao {
    pub arquivos: Vec<ArquivoCarregado>,
    pub competencias_sia: Vec<String>,
    pub competencias_sih: Vec<String>,
    pub competencias_rejeicao: Vec<String>,
    /// Todos os tipos carregados têm os nomes de campo conferidos com arquivo real?
    pub campos_confirmados: bool,
}

/// Um estabelecimento que produziu o procedimento.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Produtor {
    pub cnes: String,
    /// Quantidade aprovada (SIA) ou número de AIH (SIH).
    pub quantidade: i64,
    pub valor_centavos: i64,
    /// Em quantas competências o estabelecimento produziu.
    pub meses: u32,
}

/// Quem produziu um procedimento.
#[derive(Debug, Clone, Serialize)]
pub struct Produtores {
    pub procedimento: String,
    pub sistema: &'static str,
    /// Primeira e última competência com produção do procedimento (vazias se não houve).
    pub de: String,
    pub ate: String,
    pub estabelecimentos: u64,
    pub quantidade: i64,
    pub valor_centavos: i64,
    /// Os maiores produtores, por quantidade.
    pub lista: Vec<Produtor>,
}

/// Procedimento produzido por uma unidade.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcedimentoProduzido {
    pub procedimento: String,
    pub quantidade: i64,
    pub valor_centavos: i64,
    pub meses: u32,
}

/// Motivo de rejeição de uma unidade.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Rejeicao {
    pub motivo: String,
    /// Descrição oficial (tabela MOTERRO), se foi carregada.
    pub descricao: Option<String>,
    pub quantidade: i64,
    pub meses: u32,
}

/// O que uma unidade produziu e o que foi rejeitado.
#[derive(Debug, Clone, Serialize)]
pub struct DaUnidade {
    pub cnes: String,
    pub ambulatorial: Vec<ProcedimentoProduzido>,
    pub hospitalar: Vec<ProcedimentoProduzido>,
    pub rejeicoes: Vec<Rejeicao>,
    pub total_ambulatorial: i64,
    pub total_hospitalar: i64,
    pub total_rejeitadas: i64,
    pub valor_ambulatorial_centavos: i64,
    pub valor_hospitalar_centavos: i64,
    pub competencias_sia: Vec<String>,
    pub competencias_sih: Vec<String>,
}

impl ConsultaProducao {
    /// Abre o banco de produção de uma UF (confere a versão do esquema).
    pub fn abrir(caminho: &Path) -> Result<Self, ErroConsulta> {
        Ok(Self {
            banco: BancoProducao::abrir(caminho)
                .map_err(|e| ErroConsulta::Entrada(e.to_string()))?,
        })
    }

    /// Usa um banco já aberto (testes).
    pub fn de_banco(banco: BancoProducao) -> Self {
        Self { banco }
    }

    pub(crate) fn conn(&self) -> &Connection {
        self.banco.conexao()
    }

    fn competencias(&self, tabela: &'static str) -> Result<Vec<String>, ErroConsulta> {
        let mut st = self
            .conn()
            .prepare(&format!("SELECT DISTINCT comp FROM {tabela} ORDER BY comp"))?;
        let v = st
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(v)
    }

    /// O que está carregado.
    pub fn resumo(&self) -> Result<ResumoProducao, ErroConsulta> {
        let arquivos = self
            .banco
            .arquivos()
            .map_err(|e| ErroConsulta::Entrada(e.to_string()))?;
        let campos_confirmados = !arquivos.is_empty() && arquivos.iter().all(|a| a.confirmado);
        Ok(ResumoProducao {
            arquivos,
            competencias_sia: self.competencias("prod_amb")?,
            competencias_sih: self.competencias("prod_hosp")?,
            competencias_rejeicao: self.competencias("rej_hosp")?,
            campos_confirmados,
        })
    }

    /// Quem produziu o procedimento (código de 10 dígitos), nas competências carregadas.
    pub fn produtores(
        &self,
        origem: Origem,
        procedimento: &str,
        limite: usize,
    ) -> Result<Produtores, ErroConsulta> {
        let proc = crate::ficha::normalizar_codigo(procedimento)?;
        let (t, q) = (origem.tabela(), origem.coluna_qtd());
        let (n, total, valor, de, ate): (i64, i64, i64, Option<String>, Option<String>) = self
            .conn()
            .query_row(
                &format!(
                    "SELECT count(DISTINCT cnes), coalesce(sum({q}), 0), coalesce(sum(valor_cent), 0), min(comp), max(comp)
                     FROM {t} WHERE proc = ?1"
                ),
                [&proc],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )?;
        let mut st = self.conn().prepare(&format!(
            "SELECT cnes, sum({q}) AS s, sum(valor_cent), count(DISTINCT comp) FROM {t}
             WHERE proc = ?1 GROUP BY cnes ORDER BY s DESC, cnes LIMIT ?2"
        ))?;
        let lista = st
            .query_map(
                rusqlite::params![proc, i64::try_from(limite.clamp(1, 2000)).unwrap_or(2000)],
                |r| {
                    Ok(Produtor {
                        cnes: r.get(0)?,
                        quantidade: r.get(1)?,
                        valor_centavos: r.get(2)?,
                        meses: r.get(3)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Produtores {
            procedimento: proc,
            sistema: origem.sistema(),
            de: de.unwrap_or_default(),
            ate: ate.unwrap_or_default(),
            estabelecimentos: n.unsigned_abs(),
            quantidade: total,
            valor_centavos: valor,
            lista,
        })
    }

    /// Todos os estabelecimentos que produziram o procedimento (SIA ou SIH).
    pub fn quem_produziu(&self, procedimento: &str) -> Result<HashSet<String>, ErroConsulta> {
        let proc = crate::ficha::normalizar_codigo(procedimento)?;
        let mut st = self.conn().prepare(
            "SELECT cnes FROM prod_amb WHERE proc = ?1 UNION SELECT cnes FROM prod_hosp WHERE proc = ?1",
        )?;
        let v = st
            .query_map([&proc], |r| r.get(0))?
            .collect::<Result<HashSet<String>, _>>()?;
        Ok(v)
    }

    fn procedimentos_de(
        &self,
        origem: Origem,
        cnes: &str,
        limite: usize,
    ) -> Result<Vec<ProcedimentoProduzido>, ErroConsulta> {
        let (t, q) = (origem.tabela(), origem.coluna_qtd());
        let mut st = self.conn().prepare(&format!(
            "SELECT proc, sum({q}) AS s, sum(valor_cent), count(DISTINCT comp) FROM {t}
             WHERE cnes = ?1 GROUP BY proc ORDER BY s DESC, proc LIMIT ?2"
        ))?;
        let v = st
            .query_map(
                rusqlite::params![cnes, i64::try_from(limite.clamp(1, 5000)).unwrap_or(5000)],
                |r| {
                    Ok(ProcedimentoProduzido {
                        procedimento: r.get(0)?,
                        quantidade: r.get(1)?,
                        valor_centavos: r.get(2)?,
                        meses: r.get(3)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// O que a unidade produziu (os `limite` procedimentos de maior quantidade de cada sistema) e
    /// o que o SIH rejeitou nela.
    pub fn da_unidade(&self, cnes: &str, limite: usize) -> Result<DaUnidade, ErroConsulta> {
        let soma = |sql: &str| -> Result<i64, ErroConsulta> {
            Ok(self.conn().query_row(sql, [cnes], |r| r.get(0))?)
        };
        let comps = |tabela: &str| -> Result<Vec<String>, ErroConsulta> {
            let mut st = self.conn().prepare(&format!(
                "SELECT DISTINCT comp FROM {tabela} WHERE cnes = ?1 ORDER BY comp"
            ))?;
            Ok(st
                .query_map([cnes], |r| r.get(0))?
                .collect::<Result<Vec<String>, _>>()?)
        };
        let mut st = self.conn().prepare(
            "SELECT r.motivo, m.descricao, sum(r.qtd) AS s, count(DISTINCT r.comp)
             FROM rej_hosp r LEFT JOIN moterro m ON m.codigo = r.motivo
             WHERE r.cnes = ?1 GROUP BY r.motivo ORDER BY s DESC, r.motivo",
        )?;
        let rejeicoes = st
            .query_map([cnes], |r| {
                Ok(Rejeicao {
                    motivo: r.get(0)?,
                    descricao: r.get(1)?,
                    quantidade: r.get(2)?,
                    meses: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(DaUnidade {
            cnes: cnes.into(),
            ambulatorial: self.procedimentos_de(Origem::Ambulatorial, cnes, limite)?,
            hospitalar: self.procedimentos_de(Origem::Hospitalar, cnes, limite)?,
            rejeicoes,
            total_ambulatorial: soma("SELECT coalesce(sum(qtd), 0) FROM prod_amb WHERE cnes = ?1")?,
            total_hospitalar: soma("SELECT coalesce(sum(aih), 0) FROM prod_hosp WHERE cnes = ?1")?,
            total_rejeitadas: soma("SELECT coalesce(sum(qtd), 0) FROM rej_hosp WHERE cnes = ?1")?,
            valor_ambulatorial_centavos: soma(
                "SELECT coalesce(sum(valor_cent), 0) FROM prod_amb WHERE cnes = ?1",
            )?,
            valor_hospitalar_centavos: soma(
                "SELECT coalesce(sum(valor_cent), 0) FROM prod_hosp WHERE cnes = ?1",
            )?,
            competencias_sia: comps("prod_amb")?,
            competencias_sih: comps("prod_hosp")?,
        })
    }

    /// Descrição de um motivo de rejeição, se a tabela foi carregada.
    pub fn motivo(&self, codigo: &str) -> Result<Option<String>, ErroConsulta> {
        Ok(self
            .conn()
            .query_row(
                "SELECT descricao FROM moterro WHERE codigo = ?1",
                [codigo],
                |r| r.get(0),
            )
            .optional()?)
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use sa_packs::producao::{Origem as Orig, sintetico::dbf};
    use sa_sources::producao::Manifesto;

    fn l(v: &[&str]) -> Vec<String> {
        v.iter().map(ToString::to_string).collect()
    }

    fn orig(a: &str) -> Orig<'_> {
        Orig {
            uf: "MS",
            arquivo: a,
            sha256: "0",
            bytes: 1,
        }
    }

    /// Produção sintética com totais conferíveis à mão.
    ///  SIA 0301010072: A(2000001) 10+5 em 06 e 07 = 15; B(2000002) 8 em 07; C(2000003) 1 em 07.
    ///  SIA 0202010503: A 3.
    ///  SIH 0407040064: A 2 AIH (R$ 3.001,00); B 1 AIH.
    ///  Rejeições de A: motivo 023 = 3, motivo 101 = 1.
    fn consulta() -> ConsultaProducao {
        consulta_com(Manifesto::carregar())
    }

    fn consulta_com(m: Manifesto) -> ConsultaProducao {
        let mut b = BancoProducao::em_memoria().unwrap();
        let pa = dbf(
            &[
                ("PA_CODUNI", 7),
                ("PA_MVM", 6),
                ("PA_PROC_ID", 10),
                ("PA_QTDAPR", 8),
                ("PA_VALAPR", 12),
            ],
            &[
                l(&["2000001", "202606", "0301010072", "10", "100.00"]),
                l(&["2000001", "202607", "0301010072", "5", "50.50"]),
                l(&["2000002", "202607", "0301010072", "8", "80.00"]),
                l(&["2000003", "202607", "0301010072", "1", "10.00"]),
                l(&["2000001", "202607", "0202010503", "3", "9.45"]),
            ],
        );
        b.carregar(&m, "PA", &orig("PAMS2607a.dbc"), &pa).unwrap();
        let rd = dbf(
            &[
                ("CNES", 7),
                ("ANO_CMPT", 4),
                ("MES_CMPT", 2),
                ("PROC_REA", 10),
                ("VAL_TOT", 12),
            ],
            &[
                l(&["2000001", "2026", "07", "0407040064", "1500.50"]),
                l(&["2000001", "2026", "07", "0407040064", "1500.50"]),
                l(&["2000002", "2026", "07", "0407040064", "900"]),
            ],
        );
        b.carregar(&m, "RD", &orig("RDMS2607.dbc"), &rd).unwrap();
        let er = dbf(
            &[("CNES", 7), ("ANO", 4), ("MES", 2), ("CO_ERRO", 3)],
            &[
                l(&["2000001", "2026", "07", "023"]),
                l(&["2000001", "2026", "07", "023"]),
                l(&["2000001", "2026", "06", "023"]),
                l(&["2000001", "2026", "07", "101"]),
            ],
        );
        b.carregar(&m, "ER", &orig("ERMS2607.dbc"), &er).unwrap();
        b.gravar_moterro(
            &[("023".into(), "Procedimento exige habilitação".into())],
            "TAB_SIH.zip",
        )
        .unwrap();
        ConsultaProducao::de_banco(b)
    }

    #[test]
    fn produtores_do_sia_somam_e_ordenam_por_quantidade() {
        let q = consulta();
        let r = q
            .produtores(Origem::Ambulatorial, "03.01.01.007-2", 10)
            .unwrap();
        assert_eq!(r.procedimento, "0301010072");
        assert_eq!((r.de.as_str(), r.ate.as_str()), ("202606", "202607"));
        assert_eq!(r.estabelecimentos, 3);
        assert_eq!(r.quantidade, 24);
        assert_eq!(r.valor_centavos, 24_050);
        let cnes: Vec<&str> = r.lista.iter().map(|p| p.cnes.as_str()).collect();
        assert_eq!(cnes, ["2000001", "2000002", "2000003"]);
        assert_eq!((r.lista[0].quantidade, r.lista[0].meses), (15, 2));
        // limite
        assert_eq!(
            q.produtores(Origem::Ambulatorial, "0301010072", 1)
                .unwrap()
                .lista
                .len(),
            1
        );
    }

    #[test]
    fn produtores_do_sih_contam_aih_e_valor() {
        let r = consulta()
            .produtores(Origem::Hospitalar, "0407040064", 10)
            .unwrap();
        assert_eq!((r.estabelecimentos, r.quantidade), (2, 3));
        assert_eq!(r.valor_centavos, 390_100);
        assert_eq!(r.lista[0].cnes, "2000001");
        assert_eq!(r.lista[0].quantidade, 2);
    }

    #[test]
    fn procedimento_sem_producao_volta_vazio_e_codigo_ruim_e_recusado() {
        let q = consulta();
        let r = q
            .produtores(Origem::Ambulatorial, "0101010010", 10)
            .unwrap();
        assert_eq!((r.estabelecimentos, r.quantidade), (0, 0));
        assert!(r.lista.is_empty() && r.de.is_empty());
        assert!(q.produtores(Origem::Ambulatorial, "abc", 10).is_err());
    }

    #[test]
    fn quem_produziu_junta_sia_e_sih() {
        let q = consulta();
        let mut v: Vec<String> = q.quem_produziu("0301010072").unwrap().into_iter().collect();
        v.sort();
        assert_eq!(v, ["2000001", "2000002", "2000003"]);
        let v = q.quem_produziu("0407040064").unwrap();
        assert_eq!(v.len(), 2);
    }

    #[test]
    fn da_unidade_traz_producao_e_rejeicoes_com_o_motivo_oficial() {
        let u = consulta().da_unidade("2000001", 10).unwrap();
        assert_eq!(u.total_ambulatorial, 18);
        assert_eq!(u.total_hospitalar, 2);
        assert_eq!(u.total_rejeitadas, 4);
        assert_eq!(u.valor_hospitalar_centavos, 300_100);
        assert_eq!(u.ambulatorial[0].procedimento, "0301010072");
        assert_eq!(u.ambulatorial[0].quantidade, 15);
        assert_eq!(u.competencias_sia, ["202606", "202607"]);
        assert_eq!(u.rejeicoes.len(), 2);
        assert_eq!(u.rejeicoes[0].motivo, "023");
        assert_eq!(u.rejeicoes[0].quantidade, 3);
        assert_eq!(u.rejeicoes[0].meses, 2);
        assert_eq!(
            u.rejeicoes[0].descricao.as_deref(),
            Some("Procedimento exige habilitação")
        );
        assert_eq!(
            u.rejeicoes[1].descricao, None,
            "sem MOTERRO carregado para 101"
        );
    }

    #[test]
    fn unidade_sem_producao_volta_zerada() {
        let u = consulta().da_unidade("9999999", 10).unwrap();
        assert_eq!(
            (u.total_ambulatorial, u.total_hospitalar, u.total_rejeitadas),
            (0, 0, 0)
        );
        assert!(u.ambulatorial.is_empty() && u.rejeicoes.is_empty());
    }

    #[test]
    fn resumo_lista_competencias_e_diz_se_os_campos_foram_confirmados() {
        let r = consulta().resumo().unwrap();
        assert_eq!(r.competencias_sia, ["202606", "202607"]);
        assert_eq!(r.competencias_sih, ["202607"]);
        assert_eq!(r.competencias_rejeicao, ["202606", "202607"]);
        assert_eq!(r.arquivos.len(), 3);
        assert!(
            r.campos_confirmados,
            "PA, RD e ER têm os nomes vistos em arquivo real"
        );
        // Um manifesto com um tipo não conferido faz o resumo avisar.
        let mut m = Manifesto::carregar();
        m.tipos
            .iter_mut()
            .find(|t| t.codigo == "RD")
            .unwrap()
            .confirmado = false;
        assert!(!consulta_com(m).resumo().unwrap().campos_confirmados);
    }

    #[test]
    fn produtores_batem_com_soma_independente_em_sql() {
        let q = consulta();
        let r = q
            .produtores(Origem::Ambulatorial, "0301010072", 10)
            .unwrap();
        let direto: i64 = q
            .conn()
            .query_row(
                "SELECT sum(qtd) FROM prod_amb WHERE proc='0301010072'",
                [],
                |x| x.get(0),
            )
            .unwrap();
        let da_lista: i64 = r.lista.iter().map(|p| p.quantidade).sum();
        assert_eq!((r.quantidade, da_lista), (direto, direto));
    }
}
