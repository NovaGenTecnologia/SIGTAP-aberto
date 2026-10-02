//! Cruzamento SIGTAP × CNES: a unidade do usuário, se ela está apta a um procedimento e quem
//! na rede está.
//!
//! O banco do CNES (um por UF) e o do SIGTAP ficam em conexões separadas; o cruzamento é feito
//! aqui, pelas chaves que os dois compartilham: habilitação (`SGRUPHAB` = `co_habilitacao`),
//! serviço/classificação (`SERV_ESP` + `CLASS_SR` = `co_servico` + `co_classificacao`) e leito
//! (manifesto do CNES).
//!
//! **Regra de aptidão — NÃO CONFIRMADA** (estudo em `docs/fontes/cnes.md`):
//! - habilitação: basta uma alternativa. Cada linha sem grupo é uma alternativa; cada grupo
//!   (`tb_grupo_habilitacao`, cujo nome é literalmente "0801 e 0803") é uma alternativa que
//!   exige todas as habilitações do grupo;
//! - serviço/classificação: basta um dos pares;
//! - habilitação e serviço são exigidos ao mesmo tempo;
//! - leito: a unidade precisa ter leito de um dos tipos exigidos (a correspondência de códigos
//!   SIGTAP × CNES é por nome igual, também não confirmada).
//!
//! A vigência da habilitação é conferida na competência do próprio CNES carregado.

use crate::{Consulta, ErroConsulta};
use rusqlite::{Connection, OptionalExtension, params_from_iter};
use sa_core::Competencia;
use sa_packs::cnes::{ArquivoCarregado, BancoCnes};
use sa_sources::cnes::Manifesto;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

/// Consultas sobre o banco do CNES de uma UF.
pub struct ConsultaCnes {
    banco: BancoCnes,
    manifesto: Manifesto,
}

/// O que há no banco.
#[derive(Debug, Clone, Serialize)]
pub struct ResumoCnes {
    pub uf: String,
    /// Competência dos estabelecimentos (`AAAAMM`); as outras tabelas trazem a sua em `arquivos`.
    pub competencia: String,
    pub estabelecimentos: u64,
    pub tem_nomes: bool,
    /// CNES que têm profissionais carregados.
    pub profissionais_de: Vec<String>,
    pub arquivos: Vec<ArquivoCarregado>,
}

/// Estabelecimento numa lista.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Estabelecimento {
    pub cnes: String,
    /// Nome fantasia; vazio se o cadastro de nomes não foi carregado.
    pub nome: String,
    pub municipio: String,
    pub tipo: String,
    pub tipo_nome: Option<String>,
}

/// Código com o nome (quando a fonte dá um).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Codigo {
    pub codigo: String,
    pub nome: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HabilitacaoDaUnidade {
    pub codigo: String,
    /// Nome no SIGTAP da competência consultada.
    pub nome: Option<String>,
    pub inicio: String,
    pub fim: String,
    pub vigente: bool,
    pub portaria: String,
    pub data_portaria: String,
    pub leitos: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServicoDaUnidade {
    pub servico: Codigo,
    pub classificacao: Codigo,
    pub ambulatorial_sus: bool,
    pub hospitalar_sus: bool,
    /// CNES do terceiro que presta o serviço, quando há.
    pub terceiro: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LeitoDaUnidade {
    pub tipo: Codigo,
    pub especialidade: Codigo,
    pub existentes: i64,
    pub sus: i64,
    pub nao_sus: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EquipamentoDaUnidade {
    pub equipamento: Codigo,
    pub existentes: i64,
    pub em_uso: i64,
    pub disponivel_sus: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OcupacaoDaUnidade {
    pub cbo: Codigo,
    pub profissionais: u64,
    pub atendem_sus: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Profissional {
    pub nome: String,
    pub cbo: Codigo,
    pub vinculo: Codigo,
    pub atende_sus: bool,
    pub horas_ambulatorio: i64,
    pub horas_hospital: i64,
    pub horas_outros: i64,
}

/// A unidade inteira.
#[derive(Debug, Clone, Serialize)]
pub struct Unidade {
    pub cnes: String,
    pub nome: String,
    pub razao_social: String,
    pub municipio: String,
    pub pessoa_fisica: bool,
    /// Competência do CNES usada (`AAAAMM`).
    pub competencia_cnes: String,
    /// Competência do SIGTAP usada para os nomes (`AAAAMM`).
    pub competencia_sigtap: String,
    /// Campos gerais decodificados: rótulo, código, nome.
    pub gerais: Vec<(String, Codigo)>,
    pub habilitacoes: Vec<HabilitacaoDaUnidade>,
    pub servicos: Vec<ServicoDaUnidade>,
    pub leitos: Vec<LeitoDaUnidade>,
    pub equipamentos: Vec<EquipamentoDaUnidade>,
    /// `None`: os profissionais desta unidade não foram carregados.
    pub ocupacoes: Option<Vec<OcupacaoDaUnidade>>,
    pub profissionais: Option<Vec<Profissional>>,
}

/// Uma alternativa de habilitação: uma habilitação sozinha, ou um grupo (todas juntas).
#[derive(Debug, Clone, Serialize)]
pub struct AlternativaHabilitacao {
    /// Código do grupo; `None` para habilitação avulsa.
    pub grupo: Option<Codigo>,
    pub habilitacoes: Vec<ItemExigido>,
    pub atende: bool,
}

/// Item exigido e se a unidade o tem.
#[derive(Debug, Clone, Serialize)]
pub struct ItemExigido {
    pub codigo: String,
    pub nome: Option<String>,
    pub tem: bool,
    /// Para habilitação que a unidade teve mas está fora da vigência: "até 202312".
    pub observacao: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExigenciaHabilitacao {
    pub exige: bool,
    pub atende: bool,
    pub alternativas: Vec<AlternativaHabilitacao>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParExigido {
    pub servico: Codigo,
    pub classificacao: Codigo,
    pub tem: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExigenciaServico {
    pub exige: bool,
    pub atende: bool,
    pub pares: Vec<ParExigido>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LeitoExigido {
    pub tipo: Codigo,
    pub tem: bool,
    pub leitos_sus: i64,
    /// Como o tipo do SIGTAP foi procurado no CNES (texto do manifesto).
    pub correspondencia: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExigenciaLeito {
    pub exige: bool,
    pub atende: bool,
    pub tipos: Vec<LeitoExigido>,
}

/// Resposta de "minha unidade está apta?".
#[derive(Debug, Clone, Serialize)]
pub struct Aptidao {
    pub cnes: String,
    pub procedimento: String,
    pub competencia_cnes: String,
    pub competencia_sigtap: String,
    /// Habilitação e serviço/classificação atendidos (ou não exigidos).
    pub apta: bool,
    /// O que falta, em português, pronto para a tela.
    pub motivos: Vec<String>,
    pub habilitacao: ExigenciaHabilitacao,
    pub servico: ExigenciaServico,
    pub leito: ExigenciaLeito,
    /// Sempre `false` por enquanto: a regra não foi confirmada com rejeição real.
    pub regra_confirmada: bool,
    pub avisos: Vec<String>,
}

/// "Quem faz na rede".
#[derive(Debug, Clone, Serialize)]
pub struct Rede {
    pub procedimento: String,
    pub competencia_cnes: String,
    pub competencia_sigtap: String,
    /// O procedimento exige habilitação ou serviço? Se não, a lista não se aplica.
    pub exige: bool,
    /// O procedimento exige serviço/classificação? A contagem então só vê serviço próprio.
    pub exige_servico: bool,
    /// Estabelecimentos do escopo.
    pub no_escopo: u64,
    pub aptos: u64,
    /// Os primeiros `limite` aptos, por município e nome.
    pub estabelecimentos: Vec<Estabelecimento>,
    pub regra_confirmada: bool,
}

/// Situação resumida de uma unidade diante de um procedimento (marcador da lista).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Estado {
    /// O SIGTAP não pede habilitação nem serviço.
    Livre,
    /// Habilitação e serviço conferem.
    Apta,
    /// A habilitação confere; o serviço exigido não está entre os próprios (pode ser terceirizado).
    Ressalva,
    /// Falta habilitação ou serviço.
    Nao,
}

/// Procedimento que a unidade pode cobrar pelo cadastro.
#[derive(Debug, Clone, Serialize)]
pub struct ProcedimentoDaUnidade {
    pub codigo: String,
    pub nome: String,
    pub estado: Estado,
}

/// O arquivo público de serviços (SR) só traz serviço próprio: nos seis arquivos de MS conferidos
/// (01/2008 a 08/2026) nenhuma linha é de serviço terceirizado, e a unidade conferida no site do
/// CNES tinha 17 pares terceirizados que não estão no arquivo. Ver `docs/fontes/cnes.md`.
pub const AVISO_TERCEIRIZADOS: &str = "O arquivo público do CNES traz só os serviços próprios. Se a unidade presta este serviço por um terceiro contratado, ele não aparece aqui: confira no site do CNES (aba Serviços e classificação) antes de concluir.";

/// CNES -> habilitações em vigor.
type HabilitacoesPorCnes = HashMap<String, HashSet<String>>;
/// CNES -> pares (serviço, classificação).
type ParesPorCnes = HashMap<String, HashSet<(String, String)>>;

/// O que um procedimento exige, na competência do SIGTAP.
struct Exigencias {
    /// (habilitação, grupo ou vazio).
    habilitacoes: Vec<(String, String)>,
    servicos: Vec<(String, String)>,
    leitos: Vec<String>,
}

fn erro(e: impl std::fmt::Display) -> ErroConsulta {
    ErroConsulta::Entrada(e.to_string())
}

/// A habilitação está em vigor na competência `ref_` (`AAAAMM`)? Fim vazio = sem fim.
fn vigente(inicio: &str, fim: &str, ref_: &str) -> bool {
    (inicio.is_empty() || inicio <= ref_) && (fim.is_empty() || fim >= ref_)
}

impl ConsultaCnes {
    /// Abre o banco do CNES de uma UF (confere a versão do esquema).
    pub fn abrir(caminho: &Path) -> Result<Self, ErroConsulta> {
        Ok(Self {
            banco: BancoCnes::abrir(caminho).map_err(erro)?,
            manifesto: Manifesto::carregar(),
        })
    }

    /// Usa um banco já aberto (testes).
    pub fn de_banco(banco: BancoCnes) -> Self {
        Self {
            banco,
            manifesto: Manifesto::carregar(),
        }
    }

    fn conn(&self) -> &Connection {
        self.banco.conexao()
    }

    fn tem(&self, tabela: &str) -> bool {
        self.banco.tem_tabela(tabela).unwrap_or(false)
    }

    fn colunas(&self, tabela: &str) -> HashSet<String> {
        let Ok(mut st) = self
            .conn()
            .prepare("SELECT name FROM pragma_table_info(?1)")
        else {
            return HashSet::new();
        };
        st.query_map([tabela], |r| r.get::<_, String>(0))
            .map(|l| l.flatten().collect())
            .unwrap_or_default()
    }

    /// Expressão SQL da coluna, ou `''` se o arquivo carregado não a tem (o leiaute muda no tempo).
    /// `coluna` é sempre um literal deste arquivo, nunca um dado.
    fn col(colunas: &HashSet<String>, coluna: &'static str) -> String {
        if colunas.contains(coluna) {
            coluna.to_string()
        } else {
            "''".to_string()
        }
    }

    fn decod(&self, campo: &str, codigo: &str) -> Option<String> {
        self.conn()
            .query_row(
                "SELECT descricao FROM cnes_decod WHERE campo = ?1 AND codigo = ?2",
                [campo, codigo],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    fn codigo(&self, campo: &str, codigo: String) -> Codigo {
        let nome = self.decod(campo, &codigo).or_else(|| {
            self.manifesto
                .valor_fixo(campo, &codigo)
                .map(str::to_string)
        });
        Codigo { codigo, nome }
    }

    /// Competência (`AAAAMM`) do arquivo de um tipo; vazio se não foi carregado.
    fn competencia_de(&self, tipo: &str) -> String {
        self.conn()
            .query_row(
                "SELECT competencia FROM sa_arquivo WHERE tipo = ?1",
                [tipo],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    /// O que está carregado.
    pub fn resumo(&self) -> Result<ResumoCnes, ErroConsulta> {
        let arquivos = self.banco.arquivos().map_err(erro)?;
        let uf = arquivos.first().map(|a| a.uf.clone()).unwrap_or_default();
        let estabelecimentos = if self.tem("cnes_st") {
            self.conn()
                .query_row("SELECT count(*) FROM cnes_st", [], |r| r.get::<_, i64>(0))?
                .unsigned_abs()
        } else {
            0
        };
        let profissionais_de = if self.tem("cnes_pf") {
            let mut st = self
                .conn()
                .prepare("SELECT DISTINCT cnes FROM cnes_pf ORDER BY 1")?;
            st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?
        } else {
            Vec::new()
        };
        Ok(ResumoCnes {
            uf,
            competencia: self.competencia_de("ST"),
            estabelecimentos,
            tem_nomes: self.tem("cnes_cad"),
            profissionais_de,
            arquivos,
        })
    }

    fn estabelecimentos_onde(
        &self,
        onde: &str,
        parametros: &[String],
        limite: usize,
    ) -> Result<Vec<Estabelecimento>, ErroConsulta> {
        if !self.tem("cnes_st") {
            return Ok(Vec::new());
        }
        let nome = if self.tem("cnes_cad") {
            "coalesce((SELECT c.fantasia FROM cnes_cad c WHERE c.cnes = s.cnes), '')"
        } else {
            "''"
        };
        let sql = format!(
            "SELECT s.cnes, {nome} AS nome, s.codufmun, s.tp_unid FROM cnes_st s WHERE {onde} \
             ORDER BY s.codufmun, nome, s.cnes LIMIT {limite}"
        );
        let mut st = self.conn().prepare(&sql)?;
        let v = st
            .query_map(params_from_iter(parametros.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v.into_iter()
            .map(|(cnes, nome, municipio, tipo)| Estabelecimento {
                tipo_nome: self.decod("TP_UNID", &tipo),
                cnes,
                nome,
                municipio,
                tipo,
            })
            .collect())
    }

    /// Procura estabelecimentos pelo número do CNES (começo) ou por parte do nome.
    pub fn buscar(&self, texto: &str, limite: usize) -> Result<Vec<Estabelecimento>, ErroConsulta> {
        let t = texto.trim();
        if t.is_empty() {
            return Ok(Vec::new());
        }
        let limite = limite.clamp(1, 200);
        if t.bytes().all(|b| b.is_ascii_digit()) {
            return self.estabelecimentos_onde("s.cnes LIKE ?1", &[format!("{t}%")], limite);
        }
        if !self.tem("cnes_cad") {
            return Ok(Vec::new());
        }
        let padrao = format!("%{}%", t.replace(['%', '_'], " ").to_uppercase());
        self.estabelecimentos_onde(
            "s.cnes IN (SELECT c.cnes FROM cnes_cad c WHERE upper(c.fantasia) LIKE ?1 OR upper(c.raz_soci) LIKE ?1)",
            &[padrao],
            limite,
        )
    }

    /// Nomes do SIGTAP numa competência: `tabela(col_codigo -> col_nome)`.
    fn nomes_sigtap(
        sig: &Consulta,
        seq: i64,
        tabela: &'static str,
        col_codigo: &'static str,
        col_nome: &'static str,
    ) -> HashMap<String, String> {
        let sql = format!(
            "SELECT t.{col_codigo}, t.{col_nome} FROM {tabela} t JOIN {tabela}__vig v ON v.sa_id = t.sa_id \
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1"
        );
        let Ok(mut st) = sig.conn().prepare(&sql) else {
            return HashMap::new();
        };
        st.query_map([seq], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map(|l| l.flatten().collect())
        .unwrap_or_default()
    }

    fn classificacoes(sig: &Consulta, seq: i64) -> HashMap<(String, String), String> {
        let sql = "SELECT t.co_servico, t.co_classificacao, t.no_classificacao FROM tb_servico_classificacao t \
                   JOIN tb_servico_classificacao__vig v ON v.sa_id = t.sa_id WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1";
        let Ok(mut st) = sig.conn().prepare(sql) else {
            return HashMap::new();
        };
        st.query_map([seq], |r| {
            Ok((
                (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                r.get::<_, String>(2)?,
            ))
        })
        .map(|l| l.flatten().collect())
        .unwrap_or_default()
    }

    /// Tudo sobre uma unidade. `None` se o CNES não está no banco.
    pub fn unidade(
        &self,
        sig: &Consulta,
        comp: Competencia,
        cnes: &str,
    ) -> Result<Option<Unidade>, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        if !self.tem("cnes_st") {
            return Ok(None);
        }
        let c_st = self.colunas("cnes_st");
        let gerais_def: [(&str, &'static str, &str); 9] = [
            ("Tipo de estabelecimento", "tp_unid", "TP_UNID"),
            ("Gestão", "tpgestao", "TPGESTAO"),
            ("Pessoa", "pf_pj", "PF_PJ"),
            ("Natureza jurídica", "nat_jur", "NAT_JUR"),
            ("Esfera administrativa", "esfera_a", "ESFERA_A"),
            ("Natureza da organização", "natureza", "NATUREZA"),
            ("Nível de hierarquia", "niv_hier", "NIV_HIER"),
            ("Turno de atendimento", "turno_at", "TURNO_AT"),
            ("Vínculo com o SUS", "vinc_sus", "VINC_SUS"),
        ];
        let cols: Vec<String> = gerais_def.iter().map(|g| Self::col(&c_st, g.1)).collect();
        let sql = format!(
            "SELECT codufmun, {}, {} FROM cnes_st WHERE cnes = ?1",
            Self::col(&c_st, "pf_pj"),
            cols.join(", ")
        );
        let linha: Option<Vec<String>> = self
            .conn()
            .query_row(&sql, [cnes], |r| {
                (0..2 + gerais_def.len())
                    .map(|i| r.get::<_, String>(i))
                    .collect()
            })
            .optional()?;
        let Some(linha) = linha else {
            return Ok(None);
        };
        let pessoa_fisica = self
            .manifesto
            .privacidade_de("ST")
            .iter()
            .find_map(|p| p.quando_valor.clone())
            .is_some_and(|v| v == linha[1]);
        let gerais = gerais_def
            .iter()
            .enumerate()
            .filter(|(i, _)| !linha[2 + i].is_empty())
            .map(|(i, g)| (g.0.to_string(), self.codigo(g.2, linha[2 + i].clone())))
            .collect();
        let (nome, razao_social) = if self.tem("cnes_cad") {
            self.conn()
                .query_row(
                    "SELECT fantasia, raz_soci FROM cnes_cad WHERE cnes = ?1",
                    [cnes],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .optional()?
                .unwrap_or_default()
        } else {
            Default::default()
        };
        let ref_ = self.competencia_de("ST");

        // Habilitações (todas, com a vigência).
        let mut habilitacoes = Vec::new();
        if self.tem("cnes_hb") {
            let nomes = Self::nomes_sigtap(
                sig,
                seq,
                "tb_habilitacao",
                "co_habilitacao",
                "no_habilitacao",
            );
            let c = self.colunas("cnes_hb");
            let sql = format!(
                "SELECT sgruphab, cmpt_ini, cmpt_fim, {}, {}, {} FROM cnes_hb WHERE cnes = ?1 ORDER BY sgruphab, cmpt_ini",
                Self::col(&c, "portaria"),
                Self::col(&c, "dtportar"),
                if c.contains("nuleitos") {
                    "nuleitos"
                } else {
                    "NULL"
                }
            );
            let mut st = self.conn().prepare(&sql)?;
            let v = st
                .query_map([cnes], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, Option<i64>>(5)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let ref_hb = self.competencia_de("HB");
            for (codigo, inicio, fim, portaria, data_portaria, leitos) in v {
                habilitacoes.push(HabilitacaoDaUnidade {
                    nome: nomes.get(&codigo).cloned(),
                    vigente: vigente(&inicio, &fim, &ref_hb),
                    codigo,
                    inicio,
                    fim,
                    portaria,
                    data_portaria,
                    leitos,
                });
            }
        }

        // Serviços e classificações.
        let mut servicos = Vec::new();
        if self.tem("cnes_sr") {
            let ns = Self::nomes_sigtap(sig, seq, "tb_servico", "co_servico", "no_servico");
            let nc = Self::classificacoes(sig, seq);
            let c = self.colunas("cnes_sr");
            let sql = format!(
                "SELECT serv_esp, class_sr, {}, {}, {} FROM cnes_sr WHERE cnes = ?1 ORDER BY serv_esp, class_sr",
                Self::col(&c, "amb_sus"),
                Self::col(&c, "hosp_sus"),
                Self::col(&c, "cnesterc")
            );
            let mut st = self.conn().prepare(&sql)?;
            let v = st
                .query_map([cnes], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (s, cl, amb, hosp, terceiro) in v {
                servicos.push(ServicoDaUnidade {
                    servico: Codigo {
                        nome: ns.get(&s).cloned(),
                        codigo: s.clone(),
                    },
                    classificacao: Codigo {
                        nome: nc.get(&(s, cl.clone())).cloned(),
                        codigo: cl,
                    },
                    ambulatorial_sus: amb == "1",
                    hospitalar_sus: hosp == "1",
                    terceiro,
                });
            }
        }

        // Leitos.
        let mut leitos = Vec::new();
        if self.tem("cnes_lt") {
            let c = self.colunas("cnes_lt");
            let sql = format!(
                "SELECT tp_leito, codleito, coalesce(qt_exist, 0), coalesce(qt_sus, 0), coalesce({}, 0) \
                 FROM cnes_lt WHERE cnes = ?1 ORDER BY tp_leito, codleito",
                if c.contains("qt_nsus") {
                    "qt_nsus"
                } else {
                    "0"
                }
            );
            let mut st = self.conn().prepare(&sql)?;
            let v = st
                .query_map([cnes], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (tp, cod, existentes, sus, nao_sus) in v {
                leitos.push(LeitoDaUnidade {
                    tipo: self.codigo("TP_LEITO", tp),
                    especialidade: self.codigo("CODLEITO", cod),
                    existentes,
                    sus,
                    nao_sus,
                });
            }
        }

        // Equipamentos.
        let mut equipamentos = Vec::new();
        if self.tem("cnes_eq") {
            let c = self.colunas("cnes_eq");
            let sql = format!(
                "SELECT tipequip || codequip, coalesce(qt_exist, 0), coalesce({}, 0), {} FROM cnes_eq WHERE cnes = ?1 ORDER BY 1",
                if c.contains("qt_uso") { "qt_uso" } else { "0" },
                Self::col(&c, "ind_sus")
            );
            let mut st = self.conn().prepare(&sql)?;
            let v = st
                .query_map([cnes], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (cod, existentes, em_uso, sus) in v {
                equipamentos.push(EquipamentoDaUnidade {
                    equipamento: self.codigo("TIPEQUIP+CODEQUIP", cod),
                    existentes,
                    em_uso,
                    disponivel_sus: sus == "1",
                });
            }
        }

        // Profissionais (só se os desta unidade foram carregados).
        let (mut ocupacoes, mut profissionais) = (None, None);
        if self.tem("cnes_pf") {
            let n: i64 = self.conn().query_row(
                "SELECT count(*) FROM cnes_pf WHERE cnes = ?1",
                [cnes],
                |r| r.get(0),
            )?;
            if n > 0 {
                let nomes =
                    Self::nomes_sigtap(sig, seq, "tb_ocupacao", "co_ocupacao", "no_ocupacao");
                let c = self.colunas("cnes_pf");
                let sus = Self::col(&c, "prof_sus");
                let mut st = self.conn().prepare(&format!(
                    "SELECT cbo, count(*), sum(CASE WHEN {sus} = '1' THEN 1 ELSE 0 END) FROM cnes_pf WHERE cnes = ?1 GROUP BY cbo ORDER BY 2 DESC, 1"
                ))?;
                let v = st
                    .query_map([cnes], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                ocupacoes = Some(
                    v.into_iter()
                        .map(|(cbo, n, s)| OcupacaoDaUnidade {
                            cbo: Codigo {
                                nome: nomes.get(&cbo).cloned(),
                                codigo: cbo,
                            },
                            profissionais: n.unsigned_abs(),
                            atendem_sus: s.unsigned_abs(),
                        })
                        .collect(),
                );
                let num = |col: &'static str| {
                    if c.contains(col) {
                        format!("coalesce({col}, 0)")
                    } else {
                        "0".to_string()
                    }
                };
                let mut st = self.conn().prepare(&format!(
                    "SELECT {}, cbo, {}, {sus}, {}, {}, {} FROM cnes_pf WHERE cnes = ?1 ORDER BY 1, 2",
                    Self::col(&c, "nomeprof"),
                    Self::col(&c, "vinculac"),
                    num("hora_amb"),
                    num("horahosp"),
                    num("horaoutr")
                ))?;
                let v = st
                    .query_map([cnes], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)?,
                            r.get::<_, i64>(5)?,
                            r.get::<_, i64>(6)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                profissionais = Some(
                    v.into_iter()
                        .map(|(nome, cbo, vinc, sus, a, h, o)| Profissional {
                            nome,
                            cbo: Codigo {
                                nome: nomes.get(&cbo).cloned(),
                                codigo: cbo,
                            },
                            vinculo: self.codigo("VINCULAC", vinc),
                            atende_sus: sus == "1",
                            horas_ambulatorio: a,
                            horas_hospital: h,
                            horas_outros: o,
                        })
                        .collect(),
                );
            }
        }
        Ok(Some(Unidade {
            cnes: cnes.to_string(),
            nome,
            razao_social,
            municipio: linha[0].clone(),
            pessoa_fisica,
            competencia_cnes: ref_,
            competencia_sigtap: comp.to_string(),
            gerais,
            habilitacoes,
            servicos,
            leitos,
            equipamentos,
            ocupacoes,
            profissionais,
        }))
    }

    /// O que o procedimento exige na competência (linhas vigentes das três relações).
    fn exigencias(
        sig: &Consulta,
        seq: i64,
        procedimento: &str,
    ) -> Result<Exigencias, ErroConsulta> {
        let tem = |tabela: &str| -> bool {
            sig.conn()
                .query_row(
                    "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [tabela],
                    |r| r.get(0),
                )
                .unwrap_or(false)
        };
        let pares = |tabela: &'static str,
                     a: &'static str,
                     b: &'static str|
         -> Result<Vec<(String, String)>, ErroConsulta> {
            if !tem(tabela) {
                return Ok(Vec::new());
            }
            let sql = format!(
                "SELECT t.{a}, coalesce(t.{b}, '') FROM {tabela} t JOIN {tabela}__vig v ON v.sa_id = t.sa_id \
                 WHERE t.co_procedimento = ?1 AND v.vig_ini <= ?2 AND v.vig_fim >= ?2 ORDER BY 2, 1"
            );
            let mut st = sig.conn().prepare(&sql)?;
            let v = st
                .query_map(rusqlite::params![procedimento, seq], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        };
        Ok(Exigencias {
            habilitacoes: pares(
                "rl_procedimento_habilitacao",
                "co_habilitacao",
                "nu_grupo_habilitacao",
            )?,
            servicos: pares("rl_procedimento_servico", "co_servico", "co_classificacao")?,
            leitos: pares("rl_procedimento_leito", "co_tipo_leito", "co_tipo_leito")?
                .into_iter()
                .map(|p| p.0)
                .collect(),
        })
    }

    /// Alternativas de habilitação: (grupo ou vazio, habilitações que precisam estar todas).
    fn alternativas(habilitacoes: &[(String, String)]) -> Vec<(String, Vec<String>)> {
        let mut grupos: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut avulsas = Vec::new();
        for (h, g) in habilitacoes {
            if g.is_empty() {
                avulsas.push((String::new(), vec![h.clone()]));
            } else {
                grupos.entry(g.clone()).or_default().push(h.clone());
            }
        }
        avulsas.extend(grupos);
        avulsas
    }

    fn atende_habilitacao(alternativas: &[(String, Vec<String>)], tem: &HashSet<String>) -> bool {
        alternativas.is_empty()
            || alternativas
                .iter()
                .any(|(_, hs)| hs.iter().all(|h| tem.contains(h)))
    }

    /// A unidade está apta ao procedimento? `None` se o CNES não está no banco.
    pub fn aptidao(
        &self,
        sig: &Consulta,
        comp: Competencia,
        procedimento: &str,
        cnes: &str,
    ) -> Result<Option<Aptidao>, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        let procedimento = crate::ficha::normalizar_codigo(procedimento)?;
        if !self.tem("cnes_st") {
            return Ok(None);
        }
        let existe: bool = self.conn().query_row(
            "SELECT count(*) > 0 FROM cnes_st WHERE cnes = ?1",
            [cnes],
            |r| r.get(0),
        )?;
        if !existe {
            return Ok(None);
        }
        let ex = Self::exigencias(sig, seq, &procedimento)?;
        let mut avisos = Vec::new();
        let mut motivos = Vec::new();

        // Habilitações da unidade: vigentes e as demais (para explicar).
        let ref_hb = self.competencia_de("HB");
        let mut vigentes: HashSet<String> = HashSet::new();
        let mut fora: HashMap<String, String> = HashMap::new();
        if self.tem("cnes_hb") {
            let mut st = self
                .conn()
                .prepare("SELECT sgruphab, cmpt_ini, cmpt_fim FROM cnes_hb WHERE cnes = ?1")?;
            let v = st
                .query_map([cnes], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (h, ini, fim) in v {
                if vigente(&ini, &fim, &ref_hb) {
                    vigentes.insert(h);
                } else {
                    fora.insert(h, format!("fora da vigência ({ini} a {fim})"));
                }
            }
        } else if !ex.habilitacoes.is_empty() {
            avisos.push("As habilitações do CNES não foram carregadas: baixe o CNES desta UF em Módulos e dados.".to_string());
        }
        let nomes_h = Self::nomes_sigtap(
            sig,
            seq,
            "tb_habilitacao",
            "co_habilitacao",
            "no_habilitacao",
        );
        let nomes_g = Self::nomes_sigtap(
            sig,
            seq,
            "tb_grupo_habilitacao",
            "nu_grupo_habilitacao",
            "no_grupo_habilitacao",
        );
        let alternativas = Self::alternativas(&ex.habilitacoes);
        let alts: Vec<AlternativaHabilitacao> = alternativas
            .iter()
            .map(|(g, hs)| AlternativaHabilitacao {
                grupo: (!g.is_empty()).then(|| Codigo {
                    codigo: g.clone(),
                    nome: nomes_g.get(g).cloned(),
                }),
                atende: hs.iter().all(|h| vigentes.contains(h)),
                habilitacoes: hs
                    .iter()
                    .map(|h| ItemExigido {
                        nome: nomes_h.get(h).cloned(),
                        tem: vigentes.contains(h),
                        observacao: fora.get(h).cloned(),
                        codigo: h.clone(),
                    })
                    .collect(),
            })
            .collect();
        let hab_ok = Self::atende_habilitacao(&alternativas, &vigentes);
        if !hab_ok {
            let lista: BTreeSet<&str> = ex.habilitacoes.iter().map(|h| h.0.as_str()).collect();
            let codigos = lista.into_iter().collect::<Vec<_>>().join(", ");
            motivos.push(if alternativas.len() > 1 {
                format!(
                    "Falta habilitação: o procedimento aceita {} alternativas (habilitações {codigos}) e a unidade não tem nenhuma delas completa e em vigor.",
                    alternativas.len()
                )
            } else {
                format!(
                    "Falta habilitação: o procedimento exige {codigos} e a unidade não a tem em vigor."
                )
            });
        }
        if ex.habilitacoes.iter().any(|h| h.0.starts_with("38")) {
            avisos.push("O procedimento lista habilitação do grupo 38 (Agora Tem Especialistas). O Ministério da Saúde informa regra própria para essas habilitações; confira antes de concluir.".to_string());
        }

        // Serviço/classificação.
        let mut tem_sr: HashSet<(String, String)> = HashSet::new();
        if self.tem("cnes_sr") {
            let mut st = self
                .conn()
                .prepare("SELECT serv_esp, class_sr FROM cnes_sr WHERE cnes = ?1")?;
            tem_sr = st
                .query_map([cnes], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<_, _>>()?;
        } else if !ex.servicos.is_empty() {
            avisos.push("Os serviços do CNES não foram carregados: baixe o CNES desta UF em Módulos e dados.".to_string());
        }
        let ns = Self::nomes_sigtap(sig, seq, "tb_servico", "co_servico", "no_servico");
        let nc = Self::classificacoes(sig, seq);
        let pares: Vec<ParExigido> = ex
            .servicos
            .iter()
            .map(|(s, c)| ParExigido {
                servico: Codigo {
                    codigo: s.clone(),
                    nome: ns.get(s).cloned(),
                },
                classificacao: Codigo {
                    codigo: c.clone(),
                    nome: nc.get(&(s.clone(), c.clone())).cloned(),
                },
                tem: tem_sr.contains(&(s.clone(), c.clone())),
            })
            .collect();
        let serv_ok = pares.is_empty() || pares.iter().any(|p| p.tem);
        if !serv_ok {
            motivos.push(format!(
                "Serviço/classificação não achado entre os serviços próprios: o procedimento exige um destes e nenhum está no arquivo público do CNES para a unidade: {}.",
                pares.iter().map(|p| format!("{}/{}", p.servico.codigo, p.classificacao.codigo)).collect::<Vec<_>>().join(", ")
            ));
            avisos.push(AVISO_TERCEIRIZADOS.to_string());
        }

        // Leito (correspondência por manifesto; código igual quando não há linha).
        let mut tipos = Vec::new();
        if !ex.leitos.is_empty() {
            let nl =
                Self::nomes_sigtap(sig, seq, "tb_tipo_leito", "co_tipo_leito", "no_tipo_leito");
            let tem_lt = self.tem("cnes_lt");
            if !tem_lt {
                avisos.push("Os leitos do CNES não foram carregados: baixe o CNES desta UF em Módulos e dados.".to_string());
            }
            for t in &ex.leitos {
                let regra = self.manifesto.leitos.iter().find(|l| &l.sigtap == t);
                let (onde, valores, texto): (&str, Vec<String>, String) = match regra {
                    Some(r) if !r.tp_leito.is_empty() => {
                        ("tp_leito", r.tp_leito.clone(), r.base.clone())
                    }
                    Some(r) => ("codleito", r.codleito.clone(), r.base.clone()),
                    None => (
                        "codleito",
                        vec![t.clone()],
                        format!("mesmo código nas duas tabelas ({t})"),
                    ),
                };
                let sus = if tem_lt {
                    let marcas = vec!["?"; valores.len()].join(", ");
                    let mut p = vec![cnes.to_string()];
                    p.extend(valores);
                    self.conn().query_row(
                        &format!("SELECT coalesce(sum(qt_sus), 0), count(*) FROM cnes_lt WHERE cnes = ?1 AND {onde} IN ({marcas})"),
                        params_from_iter(p.iter()),
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                    )?
                } else {
                    (0, 0)
                };
                tipos.push(LeitoExigido {
                    tipo: Codigo {
                        codigo: t.clone(),
                        nome: nl.get(t).cloned(),
                    },
                    tem: sus.1 > 0,
                    leitos_sus: sus.0,
                    correspondencia: texto,
                });
            }
        }
        let leito_ok = tipos.is_empty() || tipos.iter().any(|t| t.tem);
        if !leito_ok {
            motivos.push(format!(
                "Leito: o procedimento pede leito de um destes tipos e não achamos nenhum no cadastro da unidade: {}.",
                tipos.iter().map(|t| t.tipo.codigo.clone()).collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(Some(Aptidao {
            cnes: cnes.to_string(),
            procedimento,
            competencia_cnes: self.competencia_de("ST"),
            competencia_sigtap: comp.to_string(),
            apta: hab_ok && serv_ok,
            motivos,
            habilitacao: ExigenciaHabilitacao {
                exige: !alts.is_empty(),
                atende: hab_ok,
                alternativas: alts,
            },
            servico: ExigenciaServico {
                exige: !pares.is_empty(),
                atende: serv_ok,
                pares,
            },
            leito: ExigenciaLeito {
                exige: !tipos.is_empty(),
                atende: leito_ok,
                tipos,
            },
            regra_confirmada: false,
            avisos,
        }))
    }

    /// Para cada CNES, as habilitações em vigor entre as `codigos` e os pares serviço/classificação.
    fn cadastro_para(
        &self,
        ex: &Exigencias,
    ) -> Result<(HabilitacoesPorCnes, ParesPorCnes), ErroConsulta> {
        let mut hab: HashMap<String, HashSet<String>> = HashMap::new();
        let codigos: BTreeSet<&String> = ex.habilitacoes.iter().map(|h| &h.0).collect();
        if !codigos.is_empty() && self.tem("cnes_hb") {
            let ref_hb = self.competencia_de("HB");
            let marcas = vec!["?"; codigos.len()].join(", ");
            let mut st = self.conn().prepare(&format!(
                "SELECT cnes, sgruphab, cmpt_ini, cmpt_fim FROM cnes_hb WHERE sgruphab IN ({marcas})"
            ))?;
            let linhas = st.query_map(params_from_iter(codigos.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?;
            for l in linhas {
                let (c, h, ini, fim) = l?;
                if vigente(&ini, &fim, &ref_hb) {
                    hab.entry(c).or_default().insert(h);
                }
            }
        }
        let mut sr: HashMap<String, HashSet<(String, String)>> = HashMap::new();
        let servicos: BTreeSet<&String> = ex.servicos.iter().map(|s| &s.0).collect();
        if !servicos.is_empty() && self.tem("cnes_sr") {
            let exigidos: HashSet<&(String, String)> = ex.servicos.iter().collect();
            let marcas = vec!["?"; servicos.len()].join(", ");
            let mut st = self.conn().prepare(&format!(
                "SELECT cnes, serv_esp, class_sr FROM cnes_sr WHERE serv_esp IN ({marcas})"
            ))?;
            let linhas = st.query_map(params_from_iter(servicos.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
                ))
            })?;
            for l in linhas {
                let (c, par) = l?;
                if exigidos.contains(&par) {
                    sr.entry(c).or_default().insert(par);
                }
            }
        }
        Ok((hab, sr))
    }

    /// CNES aptos (habilitação e serviço) a um procedimento, em todo o banco.
    fn aptos(&self, ex: &Exigencias) -> Result<HashSet<String>, ErroConsulta> {
        let (hab, sr) = self.cadastro_para(ex)?;
        let alternativas = Self::alternativas(&ex.habilitacoes);
        let vazio = HashSet::new();
        // Candidatos: quem aparece em alguma das duas listas.
        let candidatos: HashSet<&String> = if alternativas.is_empty() {
            sr.keys().collect()
        } else {
            hab.keys().collect()
        };
        Ok(candidatos
            .into_iter()
            .filter(|c| Self::atende_habilitacao(&alternativas, hab.get(*c).unwrap_or(&vazio)))
            .filter(|c| ex.servicos.is_empty() || sr.contains_key(*c))
            .cloned()
            .collect())
    }

    /// Exigências de todos os procedimentos vigentes na competência (uma consulta por relação).
    fn exigencias_de_todos(sig: &Consulta, seq: i64) -> HashMap<String, Exigencias> {
        let mut m: HashMap<String, Exigencias> = HashMap::new();
        let mut ler = |tabela: &'static str,
                       a: &'static str,
                       b: &'static str,
                       pr: &mut dyn FnMut(&mut Exigencias, String, String)| {
            let sql = format!(
                "SELECT t.co_procedimento, t.{a}, coalesce(t.{b}, '') FROM {tabela} t JOIN {tabela}__vig v ON v.sa_id = t.sa_id \
                 WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1"
            );
            let Ok(mut st) = sig.conn().prepare(&sql) else {
                return;
            };
            let Ok(linhas) = st.query_map([seq], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            }) else {
                return;
            };
            for (p, x, y) in linhas.flatten() {
                let e = m.entry(p).or_insert_with(|| Exigencias {
                    habilitacoes: Vec::new(),
                    servicos: Vec::new(),
                    leitos: Vec::new(),
                });
                pr(e, x, y);
            }
        };
        ler(
            "rl_procedimento_habilitacao",
            "co_habilitacao",
            "nu_grupo_habilitacao",
            &mut |e, x, y| e.habilitacoes.push((x, y)),
        );
        ler(
            "rl_procedimento_servico",
            "co_servico",
            "co_classificacao",
            &mut |e, x, y| e.servicos.push((x, y)),
        );
        m
    }

    /// Situação da unidade diante de cada procedimento vigente que tem exigência de habilitação
    /// ou serviço (mesma regra de `aptidao`, em uma passada só). Procedimento ausente do mapa =
    /// sem exigência. `None` se o CNES não está no banco.
    pub fn estados(
        &self,
        sig: &Consulta,
        comp: Competencia,
        cnes: &str,
    ) -> Result<Option<HashMap<String, Estado>>, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        if !self.tem("cnes_st") {
            return Ok(None);
        }
        let existe: bool = self.conn().query_row(
            "SELECT count(*) > 0 FROM cnes_st WHERE cnes = ?1",
            [cnes],
            |r| r.get(0),
        )?;
        if !existe {
            return Ok(None);
        }
        let mut vigentes: HashSet<String> = HashSet::new();
        if self.tem("cnes_hb") {
            let ref_hb = self.competencia_de("HB");
            let mut st = self
                .conn()
                .prepare("SELECT sgruphab, cmpt_ini, cmpt_fim FROM cnes_hb WHERE cnes = ?1")?;
            for l in st.query_map([cnes], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })? {
                let (h, ini, fim) = l?;
                if vigente(&ini, &fim, &ref_hb) {
                    vigentes.insert(h);
                }
            }
        }
        let mut tem_sr: HashSet<(String, String)> = HashSet::new();
        if self.tem("cnes_sr") {
            let mut st = self
                .conn()
                .prepare("SELECT serv_esp, class_sr FROM cnes_sr WHERE cnes = ?1")?;
            tem_sr = st
                .query_map([cnes], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<_, _>>()?;
        }
        let mut saida = HashMap::new();
        for (proc_, ex) in Self::exigencias_de_todos(sig, seq) {
            if ex.habilitacoes.is_empty() && ex.servicos.is_empty() {
                continue;
            }
            let alternativas = Self::alternativas(&ex.habilitacoes);
            let hab_ok = Self::atende_habilitacao(&alternativas, &vigentes);
            let serv_ok = ex.servicos.is_empty() || ex.servicos.iter().any(|p| tem_sr.contains(p));
            let estado = match (hab_ok, serv_ok) {
                (true, true) => Estado::Apta,
                (true, false) => Estado::Ressalva,
                _ => Estado::Nao,
            };
            saida.insert(proc_, estado);
        }
        Ok(Some(saida))
    }

    /// Procedimentos que a unidade pode cobrar pelo cadastro (aptos, e os
    /// com ressalva de serviço), com o nome na competência, em ordem de código.
    pub fn procedimentos_da_unidade(
        &self,
        sig: &Consulta,
        comp: Competencia,
        cnes: &str,
    ) -> Result<Option<Vec<ProcedimentoDaUnidade>>, ErroConsulta> {
        let Some(estados) = self.estados(sig, comp, cnes)? else {
            return Ok(None);
        };
        let seq = sig.exigir(comp)?;
        let nomes = Self::nomes_sigtap(
            sig,
            seq,
            "tb_procedimento",
            "co_procedimento",
            "no_procedimento",
        );
        let mut v: Vec<ProcedimentoDaUnidade> = estados
            .into_iter()
            .filter(|(_, e)| matches!(e, Estado::Apta | Estado::Ressalva))
            .filter_map(|(codigo, estado)| {
                let nome = nomes.get(&codigo)?.clone(); // só procedimento vigente
                Some(ProcedimentoDaUnidade {
                    codigo,
                    nome,
                    estado,
                })
            })
            .collect();
        v.sort_by(|a, b| a.codigo.cmp(&b.codigo));
        Ok(Some(v))
    }

    /// Quem na rede está apto ao procedimento. `municipios`: restringe o escopo (códigos de 6
    /// dígitos); `None` = a UF inteira.
    pub fn rede(
        &self,
        sig: &Consulta,
        comp: Competencia,
        procedimento: &str,
        municipios: Option<&HashSet<String>>,
        limite: usize,
    ) -> Result<Rede, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        let procedimento = crate::ficha::normalizar_codigo(procedimento)?;
        let ex = Self::exigencias(sig, seq, &procedimento)?;
        let exige = !ex.habilitacoes.is_empty() || !ex.servicos.is_empty();
        let mut rede = Rede {
            procedimento,
            competencia_cnes: self.competencia_de("ST"),
            competencia_sigtap: comp.to_string(),
            exige,
            exige_servico: !ex.servicos.is_empty(),
            no_escopo: 0,
            aptos: 0,
            estabelecimentos: Vec::new(),
            regra_confirmada: false,
        };
        if !self.tem("cnes_st") {
            return Ok(rede);
        }
        // Estabelecimentos do escopo.
        let mut st = self.conn().prepare("SELECT cnes, codufmun FROM cnes_st")?;
        let todos: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let no_escopo: HashSet<&String> = todos
            .iter()
            .filter(|(_, m)| municipios.is_none_or(|ms| ms.contains(m)))
            .map(|(c, _)| c)
            .collect();
        rede.no_escopo = no_escopo.len() as u64;
        if !exige {
            return Ok(rede);
        }
        let aptos = self.aptos(&ex)?;
        let mut escolhidos: Vec<&String> = aptos.iter().filter(|c| no_escopo.contains(c)).collect();
        rede.aptos = escolhidos.len() as u64;
        escolhidos.sort();
        // Detalhes dos aptos (em blocos, para não passar do limite de parâmetros do SQLite).
        let mut lista = Vec::new();
        for bloco in escolhidos.chunks(500) {
            let marcas = vec!["?"; bloco.len()].join(", ");
            let p: Vec<String> = bloco.iter().map(|c| (*c).clone()).collect();
            lista.extend(self.estabelecimentos_onde(&format!("s.cnes IN ({marcas})"), &p, 500)?);
        }
        lista.sort_by(|a, b| {
            (&a.municipio, &a.nome, &a.cnes).cmp(&(&b.municipio, &b.nome, &b.cnes))
        });
        lista.truncate(limite.clamp(1, 2000));
        rede.estabelecimentos = lista;
        Ok(rede)
    }

    /// Para a prova: quantos procedimentos com exigência têm ao menos um estabelecimento apto.
    /// Devolve (procedimentos com exigência, com ao menos um apto).
    pub fn cobertura(&self, sig: &Consulta, comp: Competencia) -> Result<(u64, u64), ErroConsulta> {
        let seq = sig.exigir(comp)?;
        let mut st = sig.conn().prepare(
            "SELECT DISTINCT t.co_procedimento FROM rl_procedimento_habilitacao t JOIN rl_procedimento_habilitacao__vig v ON v.sa_id = t.sa_id \
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 \
             UNION SELECT DISTINCT t.co_procedimento FROM rl_procedimento_servico t JOIN rl_procedimento_servico__vig v ON v.sa_id = t.sa_id \
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
        )?;
        let procs: Vec<String> = st
            .query_map([seq], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        let mut com_apto = 0u64;
        for p in &procs {
            let ex = Self::exigencias(sig, seq, p)?;
            if !self.aptos(&ex)?.is_empty() {
                com_apto += 1;
            }
        }
        Ok((procs.len() as u64, com_apto))
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn vigencia_da_habilitacao() {
        assert!(vigente("202001", "999999", "202608"));
        assert!(vigente("202608", "202608", "202608"));
        assert!(vigente("", "", "202608"));
        assert!(!vigente("202609", "999999", "202608"));
        assert!(!vigente("201001", "202607", "202608"));
    }

    #[test]
    fn alternativas_de_habilitacao_avulsa_ou_grupo_completo() {
        let ex = vec![
            ("2902".to_string(), String::new()),
            ("0801".to_string(), "0001".to_string()),
            ("0803".to_string(), "0001".to_string()),
            ("0802".to_string(), "0006".to_string()),
            ("0803".to_string(), "0006".to_string()),
        ];
        let alt = ConsultaCnes::alternativas(&ex);
        assert_eq!(alt.len(), 3);
        let tem = |v: &[&str]| -> HashSet<String> { v.iter().map(|s| s.to_string()).collect() };
        // Avulsa basta.
        assert!(ConsultaCnes::atende_habilitacao(&alt, &tem(&["2902"])));
        // Grupo completo basta; meio grupo não.
        assert!(ConsultaCnes::atende_habilitacao(
            &alt,
            &tem(&["0802", "0803"])
        ));
        assert!(!ConsultaCnes::atende_habilitacao(&alt, &tem(&["0801"])));
        assert!(!ConsultaCnes::atende_habilitacao(&alt, &tem(&["0803"])));
        assert!(!ConsultaCnes::atende_habilitacao(
            &alt,
            &tem(&["0801", "0802"])
        ));
        // Sem exigência, atende.
        assert!(ConsultaCnes::atende_habilitacao(&[], &tem(&[])));
    }
}
