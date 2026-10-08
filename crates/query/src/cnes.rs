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

/// Recorte mais estreito que o tipo de unidade para escolher os pares de uma comparação.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CriterioPar {
    /// Mesmo tipo e mesma natureza jurídica (`NAT_JUR`): separa público, filantrópico e privado.
    TipoENaturezaJuridica,
    /// Mesmo tipo e mesma condição de hospital filantrópico (arquivo EF do CNES).
    TipoEFilantropia,
    /// Mesmo tipo e mesma condição de ter ou não atividade de ensino/pesquisa (`ATIVIDAD` diferente de `04`).
    TipoEEnsino,
}

/// Estabelecimentos comparáveis à unidade segundo um [`CriterioPar`], ela incluída.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GrupoDePares {
    pub criterio: CriterioPar,
    /// Texto para a tela, já com o valor da unidade ("mesmo tipo e natureza jurídica 2062-...").
    pub rotulo: String,
    pub cnes: Vec<String>,
}

/// Marca do CNES que muda o que o pagamento faz (regra contratual, incentivo, gestão e metas, hospital filantrópico).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MarcaDaUnidade {
    /// `RC`, `IN`, `GM` ou `EF`.
    pub tipo: String,
    pub codigo: String,
    pub descricao: Option<String>,
    pub inicio: String,
    pub fim: String,
    pub vigente: bool,
    /// Regra contratual cuja descrição oficial diz que não há geração de crédito (total ou em parte do financiamento).
    pub sem_credito: bool,
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

/// Produtores de um procedimento diante da regra de aptidão (a regra segue não confirmada: quem
/// produziu e foi aprovado deve, em tese, estar apto; se muitos não estão, a regra é que está errada
/// ou o serviço é terceirizado, que o arquivo público do CNES não traz).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConfrontoAptidao {
    pub procedimento: String,
    pub competencia_cnes: String,
    pub competencia_sigtap: String,
    /// O procedimento exige habilitação ou serviço? Se não, não há o que confrontar.
    pub exige: bool,
    pub exige_habilitacao: bool,
    pub exige_servico: bool,
    pub produtores: u64,
    /// Produtores que estão no cadastro do CNES carregado.
    pub no_cadastro: u64,
    /// Dos que estão no cadastro, os que a regra considera aptos.
    pub aptos: u64,
    /// Os que a regra considera não aptos (até 50, por CNES).
    pub nao_aptos: Vec<String>,
    pub total_nao_aptos: u64,
    pub regra_confirmada: bool,
}

/// Separa os produtores em fora do cadastro, aptos e não aptos.
fn classificar(
    produtores: &HashSet<String>,
    cadastro: &HashSet<String>,
    aptos: &HashSet<String>,
) -> (u64, u64, Vec<String>) {
    let mut no_cadastro = 0u64;
    let mut ok = 0u64;
    let mut nao: Vec<String> = Vec::new();
    for c in produtores {
        if !cadastro.contains(c) {
            continue;
        }
        no_cadastro += 1;
        if aptos.contains(c) {
            ok += 1;
        } else {
            nao.push(c.clone());
        }
    }
    nao.sort();
    (no_cadastro, ok, nao)
}

/// Uma exigência do procedimento e quantos produtores a têm.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PesoExigencia {
    /// `habilitacao` ou `servico`.
    pub tipo: &'static str,
    pub codigo: String,
    /// Só para serviço.
    pub classificacao: Option<String>,
    pub nome: Option<String>,
    /// Habilitação 38.xx (programa "Agora Tem Especialistas").
    pub programa_38: bool,
    /// Produtores (do cadastro) que têm esta exigência em vigor.
    pub produtores_com: u64,
}

/// O peso de cada exigência de um procedimento entre os produtores.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PesoDasExigencias {
    pub procedimento: String,
    pub produtores_no_cadastro: u64,
    pub itens: Vec<PesoExigencia>,
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

/// Situação da unidade diante de um procedimento, com o motivo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EstadoDetalhado {
    pub estado: Estado,
    /// Toda exigência de habilitação do procedimento é 38.xx.
    pub habilitacao_so_38: bool,
    pub falta_habilitacao: bool,
    pub falta_servico: bool,
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

/// A descrição oficial da regra diz que o estabelecimento não gera crédito ("SEM GERACAO DE CREDITO",
/// "NAO GERACAO DE CREDITO"). Compara em maiúsculas e sem acento, porque o texto do DATASUS varia.
fn descricao_sem_credito(descricao: &str) -> bool {
    let t: String = descricao
        .to_uppercase()
        .chars()
        .map(|c| match c {
            'Ã' | 'Á' | 'À' | 'Â' => 'A',
            'É' | 'Ê' => 'E',
            'Í' => 'I',
            'Õ' | 'Ó' | 'Ô' => 'O',
            'Ú' => 'U',
            'Ç' => 'C',
            c => c,
        })
        .collect();
    t.contains("GERACAO DE CREDITO") && (t.contains("SEM GERACAO") || t.contains("NAO GERACAO"))
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

    /// Regras contratuais, incentivos, gestão e metas e filantropia da unidade (arquivos RC, IN, GM e EF do CNES),
    /// com a descrição oficial e a vigência na competência `comp` (`AAAAMM`). O código `0000` (sem regra) não entra.
    pub fn marcas_da_unidade(
        &self,
        cnes: &str,
        comp: &str,
    ) -> Result<Vec<MarcaDaUnidade>, ErroConsulta> {
        let mut saida = Vec::new();
        for tipo in ["RC", "IN", "GM", "EF"] {
            let tabela = format!("cnes_{}", tipo.to_ascii_lowercase());
            if !self.tem(&tabela) {
                continue;
            }
            let c = self.colunas(&tabela);
            let sql = format!(
                "SELECT DISTINCT sgruphab, {}, {} FROM {tabela} WHERE cnes = ?1 ORDER BY sgruphab, 2",
                Self::col(&c, "cmpt_ini"),
                Self::col(&c, "cmpt_fim")
            );
            let mut st = self.conn().prepare(&sql)?;
            let linhas = st
                .query_map([cnes], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (codigo, inicio, fim) in linhas {
                if codigo.trim().is_empty() || codigo.chars().all(|c| c == '0') {
                    continue;
                }
                let descricao = self.decod(&format!("{tipo}_SGRUPHAB"), &codigo);
                let sem_credito =
                    tipo == "RC" && descricao.as_deref().is_some_and(descricao_sem_credito);
                saida.push(MarcaDaUnidade {
                    tipo: tipo.to_string(),
                    vigente: vigente(&inicio, &fim, comp),
                    codigo,
                    descricao,
                    inicio,
                    fim,
                    sem_credito,
                });
            }
        }
        Ok(saida)
    }

    /// Serviços/classificações cadastrados no CNES da unidade: `SSSCCC` (serviço + classificação) -> tem a marca
    /// de atendimento ambulatorial SUS. Vazio se o arquivo SR não foi carregado.
    pub fn servicos_cadastrados(&self, cnes: &str) -> Result<BTreeMap<String, bool>, ErroConsulta> {
        if !self.tem("cnes_sr") {
            return Ok(BTreeMap::new());
        }
        let c = self.colunas("cnes_sr");
        let mut st = self.conn().prepare(&format!(
            "SELECT trim(serv_esp) || trim(class_sr), {} FROM cnes_sr WHERE cnes = ?1",
            Self::col(&c, "amb_sus")
        ))?;
        let mut m = BTreeMap::new();
        for r in st.query_map([cnes], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)? == "1"))
        })? {
            let (codigo, sus) = r?;
            let e = m.entry(codigo).or_insert(false);
            *e = *e || sus;
        }
        Ok(m)
    }

    /// Nome de cada serviço/classificação do SIGTAP vigente na competência, por `SSSCCC`: "Serviço · Classificação".
    pub fn nomes_de_servicos(sig: &Consulta, comp: Competencia) -> HashMap<String, String> {
        let seq = comp.seq();
        let servicos = Self::nomes_sigtap(sig, seq, "tb_servico", "co_servico", "no_servico");
        Self::classificacoes(sig, seq)
            .into_iter()
            .map(|((s, c), nome)| {
                let base = servicos.get(&s).map_or(s.clone(), |n| n.trim().to_string());
                (format!("{s}{c}"), format!("{base} · {}", nome.trim()))
            })
            .collect()
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
        let t: String = texto.trim().chars().take(100).collect();
        let t = t.as_str();
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
        let sem_curinga = t.replace(['%', '_'], " ");
        if sem_curinga.trim().is_empty() {
            return Ok(Vec::new());
        }
        let padrao = format!("%{}%", sem_curinga.trim().to_uppercase());
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
        Ok(self
            .estados_detalhados(sig, comp, cnes)?
            .map(|m| m.into_iter().map(|(p, d)| (p, d.estado)).collect()))
    }

    /// Como [`Self::estados`], com o que o faturista precisa para ler o resultado: se a única
    /// exigência de habilitação do procedimento são habilitações 38.xx (programa "Agora Tem
    /// Especialistas", que a produção real de MS mostrou não serem condição para a aprovação).
    pub fn estados_detalhados(
        &self,
        sig: &Consulta,
        comp: Competencia,
        cnes: &str,
    ) -> Result<Option<HashMap<String, EstadoDetalhado>>, ErroConsulta> {
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
            let so_38 = !ex.habilitacoes.is_empty()
                && ex.habilitacoes.iter().all(|(h, _)| h.starts_with("38"));
            saida.insert(
                proc_,
                EstadoDetalhado {
                    estado,
                    habilitacao_so_38: so_38,
                    falta_habilitacao: !hab_ok,
                    falta_servico: !serv_ok,
                },
            );
        }
        Ok(Some(saida))
    }

    /// Para cada habilitação, os procedimentos vigentes que a citam como exigência (sozinha ou como
    /// uma das alternativas). Procedimento que aceita mais de uma alternativa aparece em todas.
    pub fn procedimentos_por_habilitacao(
        sig: &Consulta,
        comp: Competencia,
    ) -> Result<HashMap<String, Vec<String>>, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        let mut m: HashMap<String, BTreeSet<String>> = HashMap::new();
        for (p, ex) in Self::exigencias_de_todos(sig, seq) {
            for (h, _) in ex.habilitacoes {
                m.entry(h).or_default().insert(p.clone());
            }
        }
        Ok(m.into_iter()
            .map(|(h, ps)| (h, ps.into_iter().collect()))
            .collect())
    }

    /// Os estabelecimentos do mesmo tipo (`TP_UNID`) que o `cnes`, ele incluído: (código do tipo,
    /// nome do tipo, CNES de todos). `None` se o CNES não está no cadastro.
    #[allow(clippy::type_complexity)]
    pub fn do_mesmo_tipo(
        &self,
        cnes: &str,
    ) -> Result<Option<(String, Option<String>, Vec<String>)>, ErroConsulta> {
        if !self.tem("cnes_st") {
            return Ok(None);
        }
        let tipo: Option<String> = self
            .conn()
            .query_row("SELECT tp_unid FROM cnes_st WHERE cnes = ?1", [cnes], |r| {
                r.get(0)
            })
            .optional()?;
        let Some(tipo) = tipo else {
            return Ok(None);
        };
        let mut st = self
            .conn()
            .prepare("SELECT cnes FROM cnes_st WHERE tp_unid = ?1 ORDER BY cnes")?;
        let todos = st
            .query_map([&tipo], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let nome = self.decod("TP_UNID", &tipo);
        Ok(Some((tipo, nome, todos)))
    }

    /// Estabelecimentos do mesmo tipo e do mesmo perfil que o `cnes` (ele incluído), pelo `criterio`.
    /// `None` se a unidade não está no cadastro ou o arquivo que o critério usa não foi carregado.
    pub fn pares_por_criterio(
        &self,
        cnes: &str,
        criterio: CriterioPar,
    ) -> Result<Option<GrupoDePares>, ErroConsulta> {
        if !self.tem("cnes_st") {
            return Ok(None);
        }
        let c = self.colunas("cnes_st");
        let tipo: Option<String> = self
            .conn()
            .query_row("SELECT tp_unid FROM cnes_st WHERE cnes = ?1", [cnes], |r| {
                r.get(0)
            })
            .optional()?;
        let Some(tipo) = tipo else {
            return Ok(None);
        };
        let nome_tipo = self.decod("TP_UNID", &tipo).unwrap_or_else(|| tipo.clone());
        let (rotulo, filtro, extra): (String, &str, Option<String>) = match criterio {
            CriterioPar::TipoENaturezaJuridica => {
                if !c.contains("nat_jur") {
                    return Ok(None);
                }
                let nj: String = self.conn().query_row(
                    "SELECT nat_jur FROM cnes_st WHERE cnes = ?1",
                    [cnes],
                    |r| r.get(0),
                )?;
                if nj.trim().is_empty() {
                    return Ok(None);
                }
                let nome = self.decod("NAT_JUR", &nj).unwrap_or_else(|| nj.clone());
                (
                    format!("{nome_tipo} com natureza jurídica {}", nome.trim()),
                    "AND nat_jur = ?2",
                    Some(nj),
                )
            }
            CriterioPar::TipoEFilantropia => {
                if !self.tem("cnes_ef") {
                    return Ok(None);
                }
                let eu: bool = self.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM cnes_ef WHERE cnes = ?1)",
                    [cnes],
                    |r| r.get(0),
                )?;
                if eu {
                    (
                        format!("{nome_tipo} filantrópicos"),
                        "AND cnes IN (SELECT cnes FROM cnes_ef)",
                        None,
                    )
                } else {
                    (
                        format!("{nome_tipo} não filantrópicos"),
                        "AND cnes NOT IN (SELECT cnes FROM cnes_ef)",
                        None,
                    )
                }
            }
            CriterioPar::TipoEEnsino => {
                if !c.contains("atividad") {
                    return Ok(None);
                }
                let at: String = self.conn().query_row(
                    "SELECT atividad FROM cnes_st WHERE cnes = ?1",
                    [cnes],
                    |r| r.get(0),
                )?;
                if at.trim().is_empty() {
                    return Ok(None);
                }
                if at == "04" {
                    (
                        format!("{nome_tipo} sem atividade de ensino ou pesquisa"),
                        "AND atividad = '04'",
                        None,
                    )
                } else {
                    (
                        format!("{nome_tipo} com atividade de ensino ou pesquisa"),
                        "AND atividad <> '04' AND trim(atividad) <> ''",
                        None,
                    )
                }
            }
        };
        let sql = format!("SELECT cnes FROM cnes_st WHERE tp_unid = ?1 {filtro} ORDER BY cnes");
        let mut st = self.conn().prepare(&sql)?;
        let primeira = |r: &rusqlite::Row| r.get::<_, String>(0);
        let cnes_do_grupo = match &extra {
            Some(x) => st.query_map([&tipo, x], primeira)?,
            None => st.query_map([&tipo], primeira)?,
        }
        .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(GrupoDePares {
            criterio,
            rotulo,
            cnes: cnes_do_grupo,
        }))
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

    /// Confronta quem produziu o procedimento (SIA ou SIH) com a regra de aptidão.
    pub fn confronto_producao(
        &self,
        sig: &Consulta,
        comp: Competencia,
        procedimento: &str,
        produtores: &HashSet<String>,
    ) -> Result<ConfrontoAptidao, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        let procedimento = crate::ficha::normalizar_codigo(procedimento)?;
        let ex = Self::exigencias(sig, seq, &procedimento)?;
        let exige = !ex.habilitacoes.is_empty() || !ex.servicos.is_empty();
        let mut r = ConfrontoAptidao {
            procedimento,
            competencia_cnes: self.competencia_de("ST"),
            competencia_sigtap: comp.to_string(),
            exige,
            exige_habilitacao: !ex.habilitacoes.is_empty(),
            exige_servico: !ex.servicos.is_empty(),
            produtores: produtores.len() as u64,
            no_cadastro: 0,
            aptos: 0,
            nao_aptos: Vec::new(),
            total_nao_aptos: 0,
            regra_confirmada: false,
        };
        if !exige || !self.tem("cnes_st") {
            return Ok(r);
        }
        let mut st = self.conn().prepare("SELECT cnes FROM cnes_st")?;
        let cadastro: HashSet<String> =
            st.query_map([], |x| x.get(0))?.collect::<Result<_, _>>()?;
        let (no_cadastro, ok, mut nao) = classificar(produtores, &cadastro, &self.aptos(&ex)?);
        r.no_cadastro = no_cadastro;
        r.aptos = ok;
        r.total_nao_aptos = nao.len() as u64;
        nao.truncate(50);
        r.nao_aptos = nao;
        Ok(r)
    }

    /// De cada exigência do procedimento (habilitação ou serviço), quantos dos `produtores` que estão
    /// no cadastro a têm. Mostra qual exigência pesa de fato: uma habilitação que quase nenhum
    /// produtor tem (como as 38.xx) não é o que separa quem produz de quem não produz.
    pub fn peso_das_exigencias(
        &self,
        sig: &Consulta,
        comp: Competencia,
        procedimento: &str,
        produtores: &HashSet<String>,
    ) -> Result<PesoDasExigencias, ErroConsulta> {
        let seq = sig.exigir(comp)?;
        let procedimento = crate::ficha::normalizar_codigo(procedimento)?;
        let ex = Self::exigencias(sig, seq, &procedimento)?;
        let mut r = PesoDasExigencias {
            procedimento,
            produtores_no_cadastro: 0,
            itens: Vec::new(),
        };
        if (ex.habilitacoes.is_empty() && ex.servicos.is_empty()) || !self.tem("cnes_st") {
            return Ok(r);
        }
        let mut st = self.conn().prepare("SELECT cnes FROM cnes_st")?;
        let cadastro: HashSet<String> =
            st.query_map([], |x| x.get(0))?.collect::<Result<_, _>>()?;
        let nos: Vec<&String> = produtores
            .iter()
            .filter(|c| cadastro.contains(*c))
            .collect();
        r.produtores_no_cadastro = nos.len() as u64;
        let (hab, sr) = self.cadastro_para(&ex)?;
        let vazio_h = HashSet::new();
        let vazio_s = HashSet::new();
        let nomes_h = Self::nomes_sigtap(
            sig,
            seq,
            "tb_habilitacao",
            "co_habilitacao",
            "no_habilitacao",
        );
        let nomes_s = Self::nomes_sigtap(sig, seq, "tb_servico", "co_servico", "no_servico");
        let codigos: BTreeSet<&String> = ex.habilitacoes.iter().map(|h| &h.0).collect();
        for h in codigos {
            let com = nos
                .iter()
                .filter(|c| hab.get(**c).unwrap_or(&vazio_h).contains(h))
                .count() as u64;
            r.itens.push(PesoExigencia {
                tipo: "habilitacao",
                codigo: h.clone(),
                classificacao: None,
                nome: nomes_h.get(h).cloned(),
                programa_38: h.starts_with("38"),
                produtores_com: com,
            });
        }
        let pares: BTreeSet<&(String, String)> = ex.servicos.iter().collect();
        for par in pares {
            let com = nos
                .iter()
                .filter(|c| sr.get(**c).unwrap_or(&vazio_s).contains(par))
                .count() as u64;
            r.itens.push(PesoExigencia {
                tipo: "servico",
                codigo: par.0.clone(),
                classificacao: Some(par.1.clone()),
                nome: nomes_s.get(&par.0).cloned(),
                programa_38: false,
                produtores_com: com,
            });
        }
        Ok(r)
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
    fn marcas_da_unidade_trazem_descricao_vigencia_e_regra_sem_credito() {
        let b = BancoCnes::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "CREATE TABLE cnes_rc(cnes TEXT, sgruphab TEXT, cmpt_ini TEXT, cmpt_fim TEXT);
                 INSERT INTO cnes_rc VALUES
                   ('1', '7101', '202607', '202708'), ('1', '0000', '202607', '202708'),
                   ('1', '7102', '202001', '202606'), ('2', '7101', '202607', '202708');
                 CREATE TABLE cnes_ef(cnes TEXT, sgruphab TEXT, cmpt_ini TEXT, cmpt_fim TEXT);
                 INSERT INTO cnes_ef VALUES ('1', '6001', '202607', '999999');
                 INSERT INTO cnes_decod VALUES
                   ('RC_SGRUPHAB', '7101', '7101-ESTABELECIMENTO DE SAUDE SEM GERACAO DE CREDITO NA MEDIA COMPLEXIDADE', 'REGRAS.DBF'),
                   ('RC_SGRUPHAB', '7102', '7102-OUTRA REGRA QUALQUER', 'REGRAS.DBF'),
                   ('EF_SGRUPHAB', '6001', 'HOSPITAL FILANTRÓPICO', 'ESTABFIL.CNV');",
            )
            .unwrap();
        let q = ConsultaCnes::de_banco(b);
        let m = q.marcas_da_unidade("1", "202608").unwrap();
        let por: Vec<(&str, &str, bool, bool)> = m
            .iter()
            .map(|x| (x.tipo.as_str(), x.codigo.as_str(), x.vigente, x.sem_credito))
            .collect();
        assert_eq!(
            por,
            [
                ("RC", "7101", true, true),
                ("RC", "7102", false, false),
                ("EF", "6001", true, false)
            ],
            "0000 não entra; vigência pela competência; só a regra de texto sem geração de crédito é marcada"
        );
        assert!(
            m[0].descricao
                .as_deref()
                .unwrap()
                .contains("MEDIA COMPLEXIDADE")
        );
        assert!(q.marcas_da_unidade("9", "202608").unwrap().is_empty());
        // Banco sem os arquivos novos (carga antiga): lista vazia, sem erro.
        let velho = ConsultaCnes::de_banco(BancoCnes::em_memoria().unwrap());
        assert!(velho.marcas_da_unidade("1", "202608").unwrap().is_empty());
    }

    #[test]
    fn pares_por_criterio_separam_natureza_filantropia_e_ensino() {
        let b = BancoCnes::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "CREATE TABLE cnes_st(cnes TEXT, tp_unid TEXT, nat_jur TEXT, atividad TEXT);
                 INSERT INTO cnes_st VALUES
                   ('1', '05', '1031', '04'), ('2', '05', '1031', '03'), ('3', '05', '3999', '04'),
                   ('4', '05', '1031', '04'), ('5', '07', '1031', '04'), ('6', '05', '', '');
                 CREATE TABLE cnes_ef(cnes TEXT, sgruphab TEXT);
                 INSERT INTO cnes_ef VALUES ('3', '6001');
                 INSERT INTO cnes_decod VALUES
                   ('TP_UNID', '05', 'HOSPITAL GERAL', 'TP_UNID.CNV'),
                   ('NAT_JUR', '1031', '103-1 Órgão Público do Poder Executivo Municipal', 'NAT_JUR.CNV');",
            )
            .unwrap();
        let q = ConsultaCnes::de_banco(b);
        let g = |cnes: &str, c| q.pares_por_criterio(cnes, c).unwrap();
        let nj = g("1", CriterioPar::TipoENaturezaJuridica).unwrap();
        assert_eq!(
            nj.cnes,
            ["1", "2", "4"],
            "mesmo tipo e mesma natureza; o 5 é de outro tipo"
        );
        assert!(nj.rotulo.contains("HOSPITAL GERAL") && nj.rotulo.contains("Municipal"));
        assert!(
            g("6", CriterioPar::TipoENaturezaJuridica).is_none(),
            "sem natureza informada"
        );
        let ef = g("3", CriterioPar::TipoEFilantropia).unwrap();
        assert_eq!(ef.cnes, ["3"]);
        let nao_ef = g("1", CriterioPar::TipoEFilantropia).unwrap();
        assert_eq!(nao_ef.cnes, ["1", "2", "4", "6"]);
        let ensino = g("2", CriterioPar::TipoEEnsino).unwrap();
        assert_eq!(ensino.cnes, ["2"]);
        assert!(ensino.rotulo.contains("com atividade de ensino"));
        let sem = g("1", CriterioPar::TipoEEnsino).unwrap();
        assert_eq!(sem.cnes, ["1", "3", "4"]);
        assert!(g("99", CriterioPar::TipoEEnsino).is_none());
        // Sem o arquivo EF carregado, o critério de filantropia não se aplica.
        let sem_ef = ConsultaCnes::de_banco(BancoCnes::em_memoria().unwrap());
        assert!(
            sem_ef
                .pares_por_criterio("1", CriterioPar::TipoEFilantropia)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn descricao_sem_credito_reconhece_o_texto_oficial() {
        assert!(descricao_sem_credito(
            "7100-TABELA DE NAO GERACAO DE CREDITO POR PRODUCAO NA INTERNACAO"
        ));
        assert!(descricao_sem_credito(
            "7106-ESTABELECIMENTO SEM GERACAO DE CREDITO TOTAL"
        ));
        assert!(!descricao_sem_credito(
            "7001-HOSPITAL DE ENSINO COM CONTRATO DE GESTAO/METAS"
        ));
        assert!(!descricao_sem_credito("0000-SEM REGRA CONTRATUAL"));
    }

    #[test]
    fn vigencia_da_habilitacao() {
        assert!(vigente("202001", "999999", "202608"));
        assert!(vigente("202608", "202608", "202608"));
        assert!(vigente("", "", "202608"));
        assert!(!vigente("202609", "999999", "202608"));
        assert!(!vigente("201001", "202607", "202608"));
    }

    #[test]
    fn confronto_separa_fora_do_cadastro_aptos_e_nao_aptos() {
        let c = |v: &[&str]| -> HashSet<String> { v.iter().map(|s| s.to_string()).collect() };
        let produtores = c(&["1", "2", "3", "4"]);
        let cadastro = c(&["1", "2", "3", "9"]);
        let aptos = c(&["1", "9"]);
        let (no_cad, ok, nao) = classificar(&produtores, &cadastro, &aptos);
        assert_eq!((no_cad, ok), (3, 1));
        assert_eq!(
            nao,
            ["2", "3"],
            "o 4 não está no cadastro: não conta contra a regra"
        );
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
