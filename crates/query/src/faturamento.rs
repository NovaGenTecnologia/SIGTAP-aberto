//! Cruzamentos da produção para o faturista: séries mensais, meses completos, curva ABC, tendência,
//! rejeições por 100 AIH, apresentado × aprovado e financiamento. Tudo sobre totais (nenhuma linha
//! de paciente). Os cruzamentos com o SIGTAP e o CNES ficam em `sa-unidade`.
//!
//! Regras fixadas com a produção real de MS (08/2025 a 07/2026) e testadas em
//! `crates/unidade/tests/producao_real.rs`:
//!
//! - **Mês completo.** Um mês só entra em análise de volume se tem pelo menos
//!   [`LIMIAR_MES_COMPLETO`]% dos estabelecimentos da mediana dos até três meses anteriores. No SIA de
//!   MS, 07/2026 tinha 476 estabelecimentos contra 622 (76,5%): incompleto; os outros 11 meses ficaram
//!   entre 92,4% e 101,3%. No SIH, 79 contra 81 (97,5%): completo.
//! - **Rejeições.** O `ER` traz uma linha por erro, não por AIH: em 07/2026, 847 linhas para 694 AIH
//!   distintas. Por isso a taxa é "rejeições por 100 AIH aprovadas", nunca "% de AIH rejeitadas".

use crate::cnes::{Estado, EstadoDetalhado};
use crate::producao::{ConsultaProducao, Origem};
use crate::{Consulta, ErroConsulta};
use sa_core::Competencia;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Percentual mínimo de estabelecimentos, sobre a mediana dos meses anteriores, para o mês valer.
pub const LIMIAR_MES_COMPLETO: u64 = 90;
/// Meses completos usados nas análises de volume (curva ABC, oportunidades, impacto).
pub const JANELA_MESES: usize = 12;
/// Máximo de meses do gráfico de série longa (o que o usuário baixou, até 5 anos).
pub const JANELA_LONGA_MESES: usize = 60;

/// Quantos estabelecimentos produziram em um mês e se o mês parece completo.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MesCobertura {
    pub competencia: String,
    pub estabelecimentos: u64,
    pub completo: bool,
    /// Não havia mês anterior carregado para comparar: o mês vale, mas não foi conferido.
    pub sem_base: bool,
}

/// Marca os meses completos. `meses`: (competência, estabelecimentos) em ordem.
pub fn marcar_cobertura(meses: &[(String, u64)]) -> Vec<MesCobertura> {
    let mut v = Vec::with_capacity(meses.len());
    for (i, (comp, n)) in meses.iter().enumerate() {
        let mut anteriores: Vec<u64> = meses[i.saturating_sub(3)..i].iter().map(|m| m.1).collect();
        anteriores.sort_unstable();
        let (completo, sem_base) = match anteriores.get(anteriores.len() / 2) {
            None => (true, true),
            Some(&mediana) => (n * 100 >= mediana * LIMIAR_MES_COMPLETO, false),
        };
        v.push(MesCobertura {
            competencia: comp.clone(),
            estabelecimentos: *n,
            completo,
            sem_base,
        });
    }
    v
}

/// Os últimos `n` meses completos (competências, em ordem crescente).
pub fn janela(cobertura: &[MesCobertura], n: usize) -> Vec<String> {
    let mut v: Vec<String> = cobertura
        .iter()
        .rev()
        .filter(|m| m.completo)
        .take(n)
        .map(|m| m.competencia.clone())
        .collect();
    v.reverse();
    v
}

/// Último mês completo contra o mesmo mês do ano anterior.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VariacaoAnual {
    pub competencia: String,
    pub valor_centavos: i64,
    pub competencia_anterior: String,
    pub valor_anterior_centavos: i64,
    /// `None` se o valor do ano anterior foi zero.
    pub variacao_percentual: Option<f64>,
}

/// Compara o último mês completo com o mesmo mês do ano anterior. `valores`: (competência, valor) dos meses em que
/// a unidade produziu; `completos`: os meses completos do sistema (um mês completo sem linha da unidade vale zero).
/// `None` se o ano anterior não está entre os meses completos baixados.
pub fn mesmo_mes_do_ano_anterior(
    valores: &[(String, i64)],
    completos: &[String],
) -> Option<VariacaoAnual> {
    let ultimo = completos.iter().max()?;
    let (ano, mes) = ultimo.split_at(ultimo.len().checked_sub(2)?);
    let anterior = format!("{}{mes}", ano.parse::<u32>().ok()?.checked_sub(1)?);
    if !completos.contains(&anterior) {
        return None;
    }
    let valor = |c: &str| valores.iter().find(|v| v.0 == c).map_or(0, |v| v.1);
    let (atual, antes) = (valor(ultimo), valor(&anterior));
    Some(VariacaoAnual {
        competencia: ultimo.clone(),
        valor_centavos: atual,
        competencia_anterior: anterior,
        valor_anterior_centavos: antes,
        variacao_percentual: (antes > 0).then(|| (atual - antes) as f64 * 100.0 / antes as f64),
    })
}

/// Classe da curva ABC: A até 80% do valor acumulado, B até 95%, C o resto.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ItemAbc {
    pub procedimento: String,
    pub quantidade: i64,
    pub valor_centavos: i64,
    /// Participação no valor total (0 a 100).
    pub percentual: f64,
    /// Participação acumulada até este item (0 a 100).
    pub acumulado: f64,
    pub classe: char,
}

/// Curva ABC pelo valor. Itens de valor zero ficam na classe C, no fim.
pub fn curva_abc(itens: &[(String, i64, i64)]) -> Vec<ItemAbc> {
    let mut v: Vec<&(String, i64, i64)> = itens.iter().collect();
    v.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    let total: i64 = v.iter().map(|x| x.2.max(0)).sum();
    let mut acumulado = 0i64;
    v.into_iter()
        .map(|(p, q, valor)| {
            let antes = acumulado;
            acumulado += (*valor).max(0);
            let pct = |x: i64| {
                if total > 0 {
                    x as f64 * 100.0 / total as f64
                } else {
                    0.0
                }
            };
            // A classe é a do ponto em que o item começa: o item que cruza os 80% ainda é A.
            let classe = if total == 0 || pct(antes) >= 95.0 {
                'C'
            } else if pct(antes) >= 80.0 {
                'B'
            } else {
                'A'
            };
            ItemAbc {
                procedimento: p.clone(),
                quantidade: *q,
                valor_centavos: *valor,
                percentual: pct((*valor).max(0)),
                acumulado: pct(acumulado),
                classe,
            }
        })
        .collect()
}

/// Média dos três últimos meses contra a dos três anteriores.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Tendencia {
    pub media_recente: f64,
    pub media_anterior: f64,
    /// Variação percentual; `None` se a média anterior é zero.
    pub variacao_percentual: Option<f64>,
    /// `sobe`, `cai` ou `estavel` (variação dentro de 3%).
    pub sentido: &'static str,
}

/// Tendência da série (valores de meses completos consecutivos); precisa de pelo menos seis meses.
pub fn tendencia(serie: &[i64]) -> Option<Tendencia> {
    if serie.len() < 6 {
        return None;
    }
    let n = serie.len();
    let media = |s: &[i64]| s.iter().sum::<i64>() as f64 / s.len() as f64;
    let (rec, ant) = (media(&serie[n - 3..]), media(&serie[n - 6..n - 3]));
    let variacao = (ant > 0.0).then(|| (rec - ant) * 100.0 / ant);
    let sentido = match variacao {
        Some(x) if x > 3.0 => "sobe",
        Some(x) if x < -3.0 => "cai",
        _ => "estavel",
    };
    Some(Tendencia {
        media_recente: rec,
        media_anterior: ant,
        variacao_percentual: variacao,
        sentido,
    })
}

/// Mediana de uma lista (média dos dois do meio se o tamanho é par). `None` se vazia.
pub fn mediana(valores: &[f64]) -> Option<f64> {
    let mut v: Vec<f64> = valores.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    let m = v.len() / 2;
    Some(if v.len() % 2 == 1 {
        v[m]
    } else {
        (v[m - 1] + v[m]) / 2.0
    })
}

/// Percentual dos `outros` com valor menor que `x` (0 a 100). `None` sem outros.
pub fn percentil_abaixo(outros: &[i64], x: i64) -> Option<f64> {
    (!outros.is_empty())
        .then(|| outros.iter().filter(|&&o| o < x).count() as f64 * 100.0 / outros.len() as f64)
}

/// Dias do mês de uma competência `AAAAMM`.
pub fn dias_no_mes(comp: &str) -> Option<u32> {
    let ano: u32 = comp.get(..4)?.parse().ok()?;
    let mes: u32 = comp.get(4..6)?.parse().ok()?;
    Some(match mes {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if (ano.is_multiple_of(4) && !ano.is_multiple_of(100)) || ano.is_multiple_of(400) => 29,
        2 => 28,
        _ => return None,
    })
}

/// Rejeições por 100 AIH aprovadas. `None` sem AIH.
pub fn por_100_aih(rejeicoes: i64, aih: i64) -> Option<f64> {
    (aih > 0).then(|| rejeicoes as f64 * 100.0 / aih as f64)
}

/// Um mês de uma unidade.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MesUnidade {
    pub competencia: String,
    pub sia_quantidade: i64,
    pub sia_valor_centavos: i64,
    /// Valor apresentado no SIA (antes da crítica); `None` se o mês foi carregado sem esse campo.
    pub sia_apresentado_centavos: Option<i64>,
    pub sih_aih: i64,
    pub sih_valor_centavos: i64,
    /// Dias de permanência das AIH do mês; `None` se o mês foi carregado sem esse campo.
    pub sih_dias: Option<i64>,
    pub rejeicoes: i64,
}

/// Evolução de um motivo de rejeição.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EvolucaoRejeicao {
    pub motivo: String,
    pub descricao: Option<String>,
    /// Início e fim (`AAAAMM`; `999999` = sem fim) da vigência do motivo na tabela oficial de críticas do SIH.
    pub vigencia: Option<(String, String)>,
    /// O motivo já tinha acabado de valer quando a unidade o recebeu pela última vez.
    pub encerrado: bool,
    /// A descrição oficial fala em AIH bloqueada: é decisão de auditoria sobre a AIH, não erro de processamento.
    pub bloqueio: bool,
    pub total: i64,
    /// (competência, rejeições).
    pub por_mes: Vec<(String, i64)>,
}

/// Total de um procedimento na UF.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TotalUf {
    pub produtores: u64,
    pub quantidade: i64,
    pub valor_centavos: i64,
}

/// Um mês de um procedimento na UF.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MesProcedimento {
    pub competencia: String,
    pub estabelecimentos: u64,
    pub quantidade: i64,
    pub valor_centavos: i64,
    pub apresentado_quantidade: Option<i64>,
    pub apresentado_centavos: Option<i64>,
}

/// Valor por financiamento (código do arquivo; o nome vem do SIGTAP).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PorFinanciamento {
    pub codigo: String,
    pub quantidade: i64,
    pub valor_centavos: i64,
}

/// Procedimento do SIA em que o apresentado passou do aprovado.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Diferenca {
    pub procedimento: String,
    pub quantidade_apresentada: i64,
    pub quantidade_aprovada: i64,
    pub valor_apresentado_centavos: i64,
    pub valor_aprovado_centavos: i64,
}

/// Apresentado × aprovado de uma unidade no SIA, só nos meses que têm o campo.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ApresentadoAprovado {
    /// Competências comparáveis (as que foram carregadas com os campos de apresentado).
    pub competencias: Vec<String>,
    pub valor_apresentado_centavos: i64,
    pub valor_aprovado_centavos: i64,
    /// Maiores diferenças (apresentado − aprovado, em valor).
    pub maiores: Vec<Diferenca>,
    /// A diferença dividida pelo motivo oficial (`PA_FLQT`): teto financeiro, teto físico, sem orçamento...
    /// Vazia nos meses carregados antes do esquema 3 (a tela pede para baixar de novo).
    pub motivos: Vec<MotivoNaoPago>,
}

/// Total de um instrumento de registro (`PA_DOCORIG`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PorInstrumento {
    pub codigo: String,
    pub descricao: Option<String>,
    pub quantidade: i64,
    pub valor_centavos: i64,
}

/// Valor da unidade sob uma regra contratual do CNES (`PA_REGCT` no SIA, `REGCT` no SIH). Código vazio = sem regra.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ValorPorRegra {
    /// `SIA` ou `SIH`.
    pub origem: String,
    pub codigo: String,
    pub quantidade: i64,
    pub valor_centavos: i64,
}

/// Soma de um campo de valor que complementa o pagamento (complemento local ou federal, UTI, parte do gestor...).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Complemento {
    pub origem: String,
    pub campo: String,
    pub valor_centavos: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PerfilFinanceiro {
    pub regras: Vec<ValorPorRegra>,
    pub complementos: Vec<Complemento>,
}

/// Parte do valor das AIH da unidade por tipo de valor (`fin` = `IN_TP_VAL`: 1 serviços hospitalares, 2 serviços
/// profissionais, 3 e 4 complementos federais), ao lado do mesmo total da UF.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ValorPorTipo {
    pub fin: String,
    pub valor_centavos: i64,
    pub valor_uf_centavos: i64,
}

/// De que é feito o valor das AIH da unidade (arquivo SP do SIH): SH, SP e complementos; quanto vem de órteses,
/// próteses e materiais (grupo 07) e de procedimentos FAEC; e a UTI, que já está dentro do valor hospitalar.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ComposicaoAih {
    pub total_centavos: i64,
    pub tipos: Vec<ValorPorTipo>,
    pub opm_centavos: i64,
    pub opm_uf_centavos: i64,
    pub faec_centavos: i64,
    pub faec_uf_centavos: i64,
    /// Soma de `VAL_UTI` do RD; `None` se o arquivo carregado não traz o campo.
    pub uti_centavos: Option<i64>,
}

/// Serviço/classificação (`PA_SRV_C`: 3 dígitos do serviço e 3 da classificação) executado pela unidade no SIA.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ServicoExecutado {
    pub codigo: String,
    pub quantidade: i64,
    pub valor_centavos: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ServicosExecutados {
    pub executados: Vec<ServicoExecutado>,
    /// Valor apresentado sem serviço informado no registro.
    pub sem_servico_centavos: i64,
}

/// Como o serviço executado aparece no cadastro do CNES da unidade.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SituacaoServico {
    /// Cadastrado e marcado como ambulatorial SUS.
    CadastradoSus,
    /// Cadastrado, mas sem a marca de atendimento ambulatorial SUS.
    CadastradoSemAmbulatorialSus,
    /// Não consta no cadastro da unidade.
    ForaDoCadastro,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ServicoConfrontado {
    pub codigo: String,
    pub quantidade: i64,
    pub valor_centavos: i64,
    pub situacao: SituacaoServico,
}

/// Confronta o serviço executado com o cadastro (`código de 6 dígitos` -> ambulatorial SUS?).
pub fn confrontar_servicos(
    executados: &[ServicoExecutado],
    cadastro: &BTreeMap<String, bool>,
) -> Vec<ServicoConfrontado> {
    executados
        .iter()
        .map(|x| ServicoConfrontado {
            codigo: x.codigo.clone(),
            quantidade: x.quantidade,
            valor_centavos: x.valor_centavos,
            situacao: match cadastro.get(&x.codigo) {
                Some(true) => SituacaoServico::CadastradoSus,
                Some(false) => SituacaoServico::CadastradoSemAmbulatorialSus,
                None => SituacaoServico::ForaDoCadastro,
            },
        })
        .collect()
}

/// Valor apresentado num mês de processamento, separando o que é do próprio mês do que é de meses anteriores
/// (`PA_CMP` antes de `PA_MVM`: produção que atrasou ou foi reapresentada), ao lado do mesmo total da UF.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MesReapresentacao {
    pub competencia: String,
    pub do_mes_centavos: i64,
    pub anteriores_centavos: i64,
    pub uf_do_mes_centavos: i64,
    pub uf_anteriores_centavos: i64,
}

/// Valor de um mês de atendimento apresentado depois dele.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OrigemDoAtraso {
    pub competencia: String,
    pub valor_centavos: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Reapresentacao {
    pub meses: Vec<MesReapresentacao>,
    pub origem_dos_atrasos: Vec<OrigemDoAtraso>,
}

/// A permanência média real de um procedimento é destacada se passa de 1,5 vez a prevista no SIGTAP (ou fica abaixo
/// de 1/1,5 dela) **e** se afasta também da média da UF em 25% (a prevista não é a média: em MS 07/2026, 82 dos 207
/// procedimentos com 10 AIH ou mais já têm a média da UF inteira fora dessa faixa). Pelo menos 10 AIH no período:
/// média de poucas AIH não diz nada.
pub const PERMANENCIA_RAZAO: f64 = 1.5;
pub const PERMANENCIA_RAZAO_UF: f64 = 1.25;
pub const PERMANENCIA_MIN_AIH: i64 = 10;

/// AIH e dias de permanência de um procedimento, na unidade e na UF (só AIH de arquivos que trazem os dias).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PermanenciaProcedimento {
    pub procedimento: String,
    pub aih: i64,
    pub dias: i64,
    pub aih_uf: i64,
    pub dias_uf: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PermanenciaComparada {
    pub procedimento: String,
    pub aih: i64,
    pub dias: i64,
    pub media_real: f64,
    pub media_uf: Option<f64>,
    /// Dias de permanência previstos no SIGTAP.
    pub previsto: i64,
    /// `media_real / previsto`.
    pub razao: f64,
}

/// Compara a permanência média real com a prevista no SIGTAP (`previstos`: procedimento -> dias; 0 e 9999 = sem
/// previsão). Devolve só os fora do padrão ([`PERMANENCIA_RAZAO`] do previsto e [`PERMANENCIA_RAZAO_UF`] da média da
/// UF, quando há), com base mínima ([`PERMANENCIA_MIN_AIH`]), os que mais se afastam do previsto (em dias a mais ou
/// a menos no período) primeiro.
pub fn comparar_permanencia(
    itens: &[PermanenciaProcedimento],
    previstos: &HashMap<String, i64>,
) -> Vec<PermanenciaComparada> {
    let mut v: Vec<(i64, PermanenciaComparada)> = itens
        .iter()
        .filter(|x| x.aih >= PERMANENCIA_MIN_AIH)
        .filter_map(|x| {
            let previsto = *previstos.get(&x.procedimento)?;
            if previsto <= 0 || previsto >= 9999 {
                return None;
            }
            let media = x.dias as f64 / x.aih as f64;
            let razao = media / previsto as f64;
            if razao < PERMANENCIA_RAZAO && razao > 1.0 / PERMANENCIA_RAZAO {
                return None;
            }
            let media_uf = (x.aih_uf > 0).then(|| x.dias_uf as f64 / x.aih_uf as f64);
            if let Some(uf) = media_uf {
                let acima = razao >= PERMANENCIA_RAZAO;
                let junto_da_uf = if acima {
                    media < PERMANENCIA_RAZAO_UF * uf
                } else {
                    media > uf / PERMANENCIA_RAZAO_UF
                };
                if junto_da_uf {
                    return None;
                }
            }
            Some((
                (x.dias - previsto * x.aih).abs(),
                PermanenciaComparada {
                    procedimento: x.procedimento.clone(),
                    aih: x.aih,
                    dias: x.dias,
                    media_real: media,
                    media_uf,
                    previsto,
                    razao,
                },
            ))
        })
        .collect();
    v.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.procedimento.cmp(&b.1.procedimento))
    });
    v.into_iter().map(|x| x.1).collect()
}

/// Limiares do alerta de quantidade atípica (registrados aqui e mostrados na tela): a quantidade apresentada
/// de um procedimento num mês é atípica se passa de 10 vezes a mediana dos meses anteriores da própria
/// unidade (pelo menos 3 meses de base), passa de 10 vezes a mediana dos outros estabelecimentos da UF que
/// produziram o mesmo procedimento no mês, e excede a mediana própria em pelo menos 100 unidades.
pub const ATIPICA_RAZAO: f64 = 10.0;
pub const ATIPICA_MESES_BASE: usize = 3;
pub const ATIPICA_EXCESSO_MINIMO: i64 = 100;

/// Quantidade apresentada que foge da série da unidade e do que os outros estabelecimentos da UF produzem.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct QuantidadeAtipica {
    pub procedimento: String,
    pub competencia: String,
    pub quantidade_apresentada: i64,
    pub valor_apresentado_centavos: i64,
    /// Mediana da quantidade apresentada nos meses anteriores da unidade.
    pub mediana_propria: f64,
    pub meses_base: usize,
    /// Mediana, entre os outros estabelecimentos da UF, da quantidade do mesmo procedimento no mês (`None`
    /// se ninguém mais produziu).
    pub mediana_uf: Option<f64>,
}

/// Por que o SIA não pagou parte do apresentado: um valor de `PA_FLQT` (com a descrição de `CODOCO.CNV`).
/// **Teto não é erro**: `M` e `O` (ultrapassou o teto financeiro) são limite do gestor, não crítica do faturamento.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MotivoNaoPago {
    /// Letra de `PA_FLQT` (`K` aprovado totalmente, `M`/`O` teto financeiro, `L`/`N` teto físico...).
    pub codigo: String,
    /// Descrição oficial (`CODOCO.CNV`), se a tabela foi carregada.
    pub descricao: Option<String>,
    pub quantidade_apresentada: i64,
    pub quantidade_aprovada: i64,
    pub valor_apresentado_centavos: i64,
    pub valor_aprovado_centavos: i64,
}

/// Resumo de uma unidade numa janela (comparação com pares).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ResumoUnidade {
    pub cnes: String,
    pub sia_valor_centavos: i64,
    pub sih_aih: i64,
    pub sih_valor_centavos: i64,
    pub rejeicoes: i64,
    pub rejeicoes_por_100_aih: Option<f64>,
}

/// Onde a unidade está diante de um procedimento que ela produziu ou poderia produzir.
///
/// `estado` é `None` quando o procedimento não exige habilitação nem serviço. O resultado não
/// depende de as habilitações 38.xx valerem ou não como condição: quem as separa vê o motivo `so_38`.
///
/// Devolve (classe, motivo), ou `None` quando não há o que dizer (sem exigência e sem produção;
/// ou exigência não atendida e sem produção).
pub fn classificar_procedimento(
    estado: Option<EstadoDetalhado>,
    produziu: bool,
) -> Option<(&'static str, Option<&'static str>)> {
    match (estado, produziu) {
        (None, true) => Some(("produz_sem_exigencia", None)),
        (None, false) => None,
        (Some(e), produziu) => match (e.estado, produziu) {
            (Estado::Livre, true) => Some(("produz_sem_exigencia", None)),
            (Estado::Livre, false) => None,
            (Estado::Apta, true) => Some(("produz_apta", None)),
            (Estado::Apta, false) => Some(("apta_nao_produz", None)),
            // A habilitação confere e falta só o serviço próprio: pode ser terceirizado.
            (Estado::Ressalva, true) => Some(("produz_com_ressalva", Some("so_servico"))),
            (Estado::Ressalva, false) => Some(("apta_nao_produz", Some("com_ressalva_de_servico"))),
            (Estado::Nao, true) => Some((
                "produz_sem_aptidao",
                Some(if e.habilitacao_so_38 && !e.falta_servico {
                    "so_38"
                } else if e.falta_habilitacao && e.falta_servico {
                    "habilitacao_e_servico"
                } else {
                    "habilitacao"
                }),
            )),
            (Estado::Nao, false) => None,
        },
    }
}

/// Valores de um procedimento na tabela, em centavos.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ValoresProcedimento {
    /// Serviço ambulatorial (o que o SIA paga).
    pub sa: i64,
    /// Serviço hospitalar.
    pub sh: i64,
    /// Serviço profissional.
    pub sp: i64,
    /// Código do financiamento no SIGTAP (o mesmo domínio do `PA_TPFIN`).
    pub financiamento: String,
}

impl ValoresProcedimento {
    /// Valor hospitalar do procedimento (serviço hospitalar + profissional).
    pub fn hospitalar(&self) -> i64 {
        self.sh + self.sp
    }
}

/// Procedimento cujo valor mudou entre duas competências.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MudancaDeValor {
    pub procedimento: String,
    pub antes: ValoresProcedimento,
    pub depois: ValoresProcedimento,
}

/// Procedimento com exigência de habilitação ou serviço nova ou alterada.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExigenciaNova {
    pub procedimento: String,
    /// Não exigia nada na competência anterior.
    pub antes_sem_exigencia: bool,
}

/// Exigências de um procedimento, em texto (`H:habilitação:grupo` e `S:serviço:classificação`).
fn pares_de_exigencia(
    sig: &Consulta,
    seq: i64,
) -> Result<HashMap<String, BTreeSet<String>>, ErroConsulta> {
    let mut m: HashMap<String, BTreeSet<String>> = HashMap::new();
    for (t, tag, a, b) in [
        (
            "rl_procedimento_habilitacao",
            "H",
            "co_habilitacao",
            "nu_grupo_habilitacao",
        ),
        (
            "rl_procedimento_servico",
            "S",
            "co_servico",
            "co_classificacao",
        ),
    ] {
        let mut st = sig.conn().prepare(&format!(
            "SELECT t.co_procedimento, t.{a}, coalesce(t.{b}, '') FROM {t} t JOIN {t}__vig v ON v.sa_id = t.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1"
        ))?;
        for l in st.query_map([seq], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (p, x, y) = l?;
            m.entry(p).or_default().insert(format!("{tag}:{x}:{y}"));
        }
    }
    Ok(m)
}

impl Consulta {
    /// Instrumentos de registro (códigos de `tb_registro`) que o SIGTAP lista para cada procedimento vigente.
    pub fn registros_dos_procedimentos(
        &self,
        comp: Competencia,
    ) -> Result<HashMap<String, BTreeSet<String>>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let mut st = self.conn().prepare(
            "SELECT c.co_procedimento, c.co_registro FROM rl_procedimento_registro c
             JOIN rl_procedimento_registro__vig v ON v.sa_id = c.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
        )?;
        let mut m: HashMap<String, BTreeSet<String>> = HashMap::new();
        for l in st.query_map([seq], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })? {
            let (p, r) = l?;
            m.entry(p).or_default().insert(r);
        }
        Ok(m)
    }

    /// Dias de permanência previstos no SIGTAP para cada procedimento vigente na competência (0 e 9999 = sem previsão).
    pub fn dias_de_permanencia(
        &self,
        comp: Competencia,
    ) -> Result<HashMap<String, i64>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let mut st = self.conn().prepare(
            "SELECT t.co_procedimento, coalesce(t.qt_dias_permanencia, 0)
             FROM tb_procedimento t JOIN tb_procedimento__vig v ON v.sa_id = t.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
        )?;
        Ok(st
            .query_map([seq], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<HashMap<_, _>, _>>()?)
    }

    /// Valores (SA, SH, SP) e financiamento de todos os procedimentos vigentes na competência.
    pub fn valores_dos_procedimentos(
        &self,
        comp: Competencia,
    ) -> Result<HashMap<String, ValoresProcedimento>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let mut st = self.conn().prepare(
            "SELECT t.co_procedimento, t.vl_sa, t.vl_sh, t.vl_sp, coalesce(t.co_financiamento, '')
             FROM tb_procedimento t JOIN tb_procedimento__vig v ON v.sa_id = t.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
        )?;
        let mut m = HashMap::new();
        for l in st.query_map([seq], |r| {
            Ok((
                r.get::<_, String>(0)?,
                ValoresProcedimento {
                    sa: r.get(1)?,
                    sh: r.get(2)?,
                    sp: r.get(3)?,
                    financiamento: r.get(4)?,
                },
            ))
        })? {
            let (p, v) = l?;
            m.entry(p).or_insert(v);
        }
        Ok(m)
    }

    /// Valores de um procedimento numa competência; `None` se ele não existe nela.
    pub fn valores_do_procedimento(
        &self,
        comp: Competencia,
        procedimento: &str,
    ) -> Result<Option<ValoresProcedimento>, ErroConsulta> {
        use rusqlite::OptionalExtension;
        let seq = self.exigir(comp)?;
        Ok(self
            .conn()
            .prepare_cached(
                "SELECT t.vl_sa, t.vl_sh, t.vl_sp, coalesce(t.co_financiamento, '')
                 FROM tb_procedimento t JOIN tb_procedimento__vig v ON v.sa_id = t.sa_id
                 WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND t.co_procedimento = ?2 LIMIT 1",
            )?
            .query_row(rusqlite::params![seq, procedimento], |r| {
                Ok(ValoresProcedimento {
                    sa: r.get(0)?,
                    sh: r.get(1)?,
                    sp: r.get(2)?,
                    financiamento: r.get(3)?,
                })
            })
            .optional()?)
    }

    /// Nome de cada código de financiamento na competência.
    pub fn nomes_de_financiamento(
        &self,
        comp: Competencia,
    ) -> Result<HashMap<String, String>, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let mut st = self.conn().prepare(
            "SELECT t.co_financiamento, t.no_financiamento FROM tb_financiamento t
             JOIN tb_financiamento__vig v ON v.sa_id = t.sa_id WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
        )?;
        Ok(st
            .query_map([seq], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?)
    }

    /// Procedimentos cujo valor (SA, SH ou SP) mudou de `de` para `para` (existem nas duas).
    pub fn mudancas_de_valor(
        &self,
        de: Competencia,
        para: Competencia,
    ) -> Result<Vec<MudancaDeValor>, ErroConsulta> {
        let (a, b) = (
            self.valores_dos_procedimentos(de)?,
            self.valores_dos_procedimentos(para)?,
        );
        let mut v: Vec<MudancaDeValor> = b
            .into_iter()
            .filter_map(|(p, depois)| {
                let antes = a.get(&p)?;
                (antes.sa != depois.sa || antes.sh != depois.sh || antes.sp != depois.sp).then(
                    || MudancaDeValor {
                        procedimento: p,
                        antes: antes.clone(),
                        depois,
                    },
                )
            })
            .collect();
        v.sort_by(|x, y| x.procedimento.cmp(&y.procedimento));
        Ok(v)
    }

    /// Procedimentos vigentes em `de` que deixaram de existir em `para`.
    pub fn procedimentos_excluidos(
        &self,
        de: Competencia,
        para: Competencia,
    ) -> Result<Vec<String>, ErroConsulta> {
        let (a, b) = (
            self.valores_dos_procedimentos(de)?,
            self.valores_dos_procedimentos(para)?,
        );
        let mut v: Vec<String> = a.into_keys().filter(|p| !b.contains_key(p)).collect();
        v.sort();
        Ok(v)
    }

    /// Procedimentos que existem nas duas competências e têm, em `para`, exigência de habilitação
    /// ou de serviço que não havia em `de`. `antes_sem_exigencia`: o procedimento não exigia nada
    /// (a regra ficou mais restrita). Se já exigia, a exigência foi **alterada** (pode ter ganhado
    /// uma alternativa, que relaxa a regra, ou uma condição, que a restringe).
    pub fn exigencias_novas(
        &self,
        de: Competencia,
        para: Competencia,
    ) -> Result<Vec<ExigenciaNova>, ErroConsulta> {
        let (sa, sb) = (self.exigir(de)?, self.exigir(para)?);
        let (a, b) = (pares_de_exigencia(self, sa)?, pares_de_exigencia(self, sb)?);
        let existia = self.valores_dos_procedimentos(de)?;
        let vazio = BTreeSet::new();
        let mut v: Vec<ExigenciaNova> = b
            .iter()
            .filter(|(p, novas)| {
                existia.contains_key(*p) && !novas.is_subset(a.get(*p).unwrap_or(&vazio))
            })
            .map(|(p, _)| ExigenciaNova {
                procedimento: p.clone(),
                antes_sem_exigencia: a.get(p).is_none_or(BTreeSet::is_empty),
            })
            .collect();
        v.sort_by(|x, y| x.procedimento.cmp(&y.procedimento));
        Ok(v)
    }
}

fn lista(comps: &[String]) -> Result<String, ErroConsulta> {
    if let Some(c) = comps
        .iter()
        .find(|c| c.len() != 6 || !c.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(ErroConsulta::Entrada(format!("competência inválida: {c}")));
    }
    Ok(if comps.is_empty() {
        "''".to_string()
    } else {
        comps
            .iter()
            .map(|c| format!("'{c}'"))
            .collect::<Vec<_>>()
            .join(",")
    })
}

impl ConsultaProducao {
    /// Garante que os totais derivados da UF valem (refaz se uma carga os invalidou).
    fn totais(&self) -> Result<(), ErroConsulta> {
        self.banco
            .garantir_totais()
            .map_err(|e| ErroConsulta::Entrada(e.to_string()))
    }

    /// Meses com produção do SIA ou do SIH, com a marca de mês completo.
    pub fn cobertura(&self, origem: Origem) -> Result<Vec<MesCobertura>, ErroConsulta> {
        self.banco
            .garantir_totais()
            .map_err(|e| ErroConsulta::Entrada(e.to_string()))?;
        let o = match origem {
            Origem::Ambulatorial => "A",
            Origem::Hospitalar => "H",
        };
        let mut st = self
            .conn()
            .prepare("SELECT comp, estab FROM uf_cobertura WHERE origem = ?1 ORDER BY comp")?;
        let meses = st
            .query_map([o], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(c, n)| (c, n.unsigned_abs()))
            .collect::<Vec<_>>();
        Ok(marcar_cobertura(&meses))
    }

    /// Os últimos [`JANELA_MESES`] meses completos do sistema.
    pub fn janela_do(&self, origem: Origem) -> Result<Vec<String>, ErroConsulta> {
        Ok(janela(&self.cobertura(origem)?, JANELA_MESES))
    }

    /// Competências carregadas antes dos campos do esquema 2 (apresentado, incremento, dias).
    pub fn sem_campos_novos(&self) -> Result<Vec<String>, ErroConsulta> {
        let mut st = self.conn().prepare(
            "SELECT DISTINCT comp FROM prod_amb WHERE qtd_pro IS NULL
             UNION SELECT DISTINCT comp FROM prod_hosp WHERE dias IS NULL ORDER BY 1",
        )?;
        Ok(st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// A unidade tem produção do sistema em algum dos meses.
    pub fn unidade_produziu(
        &self,
        origem: Origem,
        cnes: &str,
        comps: &[String],
    ) -> Result<bool, ErroConsulta> {
        let tabela = match origem {
            Origem::Ambulatorial => "prod_amb",
            Origem::Hospitalar => "prod_hosp",
        };
        Ok(self.conn().query_row(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM {tabela} WHERE cnes = ?1 AND comp IN ({}))",
                lista(comps)?
            ),
            [cnes],
            |r| r.get(0),
        )?)
    }

    /// Meses da janela em que algum estabelecimento tem linha de alguma das dimensões.
    pub fn meses_com_dimensao(
        &self,
        dims: &[&str],
        comps: &[String],
    ) -> Result<Vec<String>, ErroConsulta> {
        let dims = dims
            .iter()
            .map(|d| format!("'{d}'"))
            .collect::<Vec<_>>()
            .join(",");
        self.meses_de(&format!("SELECT DISTINCT comp FROM prod_dim WHERE dim IN ({dims}) AND comp IN ({}) ORDER BY comp", lista(comps)?))
    }

    /// Meses da janela em que o arquivo do SIA trouxe o apresentado por motivo (`PA_FLQT` com quantidade apresentada).
    pub fn meses_com_motivos(&self, comps: &[String]) -> Result<Vec<String>, ErroConsulta> {
        self.meses_de(&format!("SELECT DISTINCT comp FROM prod_dim WHERE dim = 'PA_FLQT' AND qtd_pro IS NOT NULL AND comp IN ({}) ORDER BY comp", lista(comps)?))
    }

    /// Meses da janela com atos de AIH (serviços profissionais do SIH).
    pub fn meses_com_atos(&self, comps: &[String]) -> Result<Vec<String>, ErroConsulta> {
        self.meses_de(&format!(
            "SELECT DISTINCT comp FROM prod_ato WHERE comp IN ({}) ORDER BY comp",
            lista(comps)?
        ))
    }

    /// Meses da janela em que o arquivo do SIH trouxe os dias de permanência.
    pub fn meses_com_dias(&self, comps: &[String]) -> Result<Vec<String>, ErroConsulta> {
        self.meses_de(&format!("SELECT DISTINCT comp FROM prod_hosp WHERE dias IS NOT NULL AND comp IN ({}) ORDER BY comp", lista(comps)?))
    }

    fn meses_de(&self, sql: &str) -> Result<Vec<String>, ErroConsulta> {
        let mut st = self.conn().prepare(sql)?;
        Ok(st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Mês a mês da unidade (SIA, SIH e rejeições).
    pub fn serie_da_unidade(&self, cnes: &str) -> Result<Vec<MesUnidade>, ErroConsulta> {
        let mut m: BTreeMap<String, MesUnidade> = BTreeMap::new();
        let novo = |c: &str| MesUnidade {
            competencia: c.to_string(),
            sia_quantidade: 0,
            sia_valor_centavos: 0,
            sia_apresentado_centavos: None,
            sih_aih: 0,
            sih_valor_centavos: 0,
            sih_dias: None,
            rejeicoes: 0,
        };
        let mut st = self.conn().prepare(
            "SELECT comp, sum(qtd), sum(valor_cent), sum(valor_pro_cent) FROM prod_amb WHERE cnes = ?1 GROUP BY comp",
        )?;
        for l in st.query_map([cnes], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        })? {
            let (c, q, v, ap) = l?;
            let e = m.entry(c.clone()).or_insert_with(|| novo(&c));
            (
                e.sia_quantidade,
                e.sia_valor_centavos,
                e.sia_apresentado_centavos,
            ) = (q, v, ap);
        }
        let mut st = self.conn().prepare(
            "SELECT comp, sum(aih), sum(valor_cent), sum(dias) FROM prod_hosp WHERE cnes = ?1 GROUP BY comp",
        )?;
        for l in st.query_map([cnes], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        })? {
            let (c, a, v, d) = l?;
            let e = m.entry(c.clone()).or_insert_with(|| novo(&c));
            (e.sih_aih, e.sih_valor_centavos, e.sih_dias) = (a, v, d);
        }
        let mut st = self
            .conn()
            .prepare("SELECT comp, sum(qtd) FROM rej_hosp WHERE cnes = ?1 GROUP BY comp")?;
        for l in st.query_map([cnes], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })? {
            let (c, q) = l?;
            m.entry(c.clone()).or_insert_with(|| novo(&c)).rejeicoes = q;
        }
        Ok(m.into_values().collect())
    }

    /// Os `limite` motivos mais frequentes da unidade, mês a mês.
    pub fn evolucao_das_rejeicoes(
        &self,
        cnes: &str,
        limite: usize,
        janela: Option<&[String]>,
    ) -> Result<Vec<EvolucaoRejeicao>, ErroConsulta> {
        let filtro = match janela {
            Some(j) => format!(" AND r.comp IN ({})", lista(j)?),
            None => String::new(),
        };
        // A tabela de vigências (CO_TAB 0027 = rejeição) completa a descrição quando a MOTERRO não tem o código.
        let mut st = self.conn().prepare(&format!(
            "SELECT r.motivo,
                    coalesce(m.descricao, (SELECT v.descricao FROM aux_vigencia v WHERE v.tabela = '0027' AND v.codigo = trim(r.motivo)
                                           ORDER BY v.inicio DESC LIMIT 1)),
                    (SELECT v.inicio || '|' || v.fim FROM aux_vigencia v WHERE v.tabela = '0027' AND v.codigo = trim(r.motivo)
                     ORDER BY v.inicio DESC LIMIT 1),
                    max(r.comp), sum(r.qtd) AS s
             FROM rej_hosp r LEFT JOIN moterro m ON m.codigo = r.motivo
             WHERE r.cnes = ?1{filtro} GROUP BY r.motivo ORDER BY s DESC, r.motivo LIMIT ?2",
        ))?;
        #[allow(clippy::type_complexity)]
        let topo: Vec<(String, Option<String>, Option<String>, String, i64)> = st
            .query_map(
                rusqlite::params![cnes, i64::try_from(limite).unwrap_or(5)],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )?
            .collect::<Result<_, _>>()?;
        let filtro_mes = filtro.replace("r.comp", "comp");
        let mut st = self.conn().prepare(&format!(
            "SELECT comp, sum(qtd) FROM rej_hosp WHERE cnes = ?1 AND motivo = ?2{filtro_mes} GROUP BY comp ORDER BY comp",
        ))?;
        let mut v = Vec::new();
        for (motivo, descricao, vigencia, ultimo_mes, total) in topo {
            let vigencia = vigencia.and_then(|v| {
                v.split_once('|')
                    .map(|(a, b)| (a.to_string(), b.to_string()))
            });
            let encerrado = vigencia
                .as_ref()
                .is_some_and(|(_, fim)| !fim.is_empty() && *fim < ultimo_mes);
            let bloqueio = descricao
                .as_deref()
                .is_some_and(|d| d.to_uppercase().contains("BLOQUEAD"));
            let por_mes = st
                .query_map(rusqlite::params![cnes, motivo], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            v.push(EvolucaoRejeicao {
                motivo,
                descricao,
                vigencia,
                encerrado,
                bloqueio,
                total,
                por_mes,
            });
        }
        Ok(v)
    }

    /// Procedimentos da unidade nas competências dadas: (procedimento, quantidade, valor).
    pub fn da_unidade_na_janela(
        &self,
        origem: Origem,
        cnes: &str,
        comps: &[String],
    ) -> Result<Vec<(String, i64, i64)>, ErroConsulta> {
        let (t, q) = match origem {
            Origem::Ambulatorial => ("prod_amb", "qtd"),
            Origem::Hospitalar => ("prod_hosp", "aih"),
        };
        let mut st = self.conn().prepare(&format!(
            "SELECT proc, sum({q}), sum(valor_cent) FROM {t} WHERE cnes = ?1 AND comp IN ({})
             GROUP BY proc ORDER BY proc",
            lista(comps)?
        ))?;
        Ok(st
            .query_map([cnes], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Totais da UF por procedimento nas competências dadas.
    pub fn uf_por_procedimento(
        &self,
        origem: Origem,
        comps: &[String],
    ) -> Result<HashMap<String, TotalUf>, ErroConsulta> {
        let (t, q, o) = match origem {
            Origem::Ambulatorial => ("prod_amb", "qtd", "A"),
            Origem::Hospitalar => ("prod_hosp", "aih", "H"),
        };
        let ls = lista(comps)?;
        // Pelos totais da UF (tabelas derivadas); a máscara dos produtores só vale se o período
        // carregado cabe em 62 meses, senão volta à soma direta.
        let mascara = sa_packs::producao::mascara_da_janela(comps);
        let rapido = mascara.is_some()
            && self
                .banco
                .mascara_vale()
                .map_err(|e| ErroConsulta::Entrada(e.to_string()))?;
        let sql = if rapido {
            format!(
                "SELECT t.proc, coalesce(p.n, 0), t.qtd, t.valor FROM
                   (SELECT proc, sum(qtd) AS qtd, sum(valor_cent) AS valor FROM uf_proc_mes
                    WHERE origem = '{o}' AND comp IN ({ls}) GROUP BY proc) t
                 LEFT JOIN (SELECT proc, count(*) AS n FROM uf_produtor_mes
                    WHERE origem = '{o}' AND meses & {} <> 0 GROUP BY proc) p ON p.proc = t.proc",
                mascara.unwrap_or(0)
            )
        } else {
            format!(
                "SELECT proc, count(DISTINCT cnes), sum({q}), sum(valor_cent) FROM {t} WHERE comp IN ({ls}) GROUP BY proc"
            )
        };
        let mut st = self.conn().prepare(&sql)?;
        let mut m = HashMap::new();
        for l in st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })? {
            let (p, n, q, v) = l?;
            m.insert(
                p,
                TotalUf {
                    produtores: n.unsigned_abs(),
                    quantidade: q,
                    valor_centavos: v,
                },
            );
        }
        Ok(m)
    }

    /// Mês a mês de um procedimento na UF (código de 10 dígitos).
    pub fn serie_do_procedimento(
        &self,
        origem: Origem,
        procedimento: &str,
    ) -> Result<Vec<MesProcedimento>, ErroConsulta> {
        let proc = crate::ficha::normalizar_codigo(procedimento)?;
        self.banco
            .garantir_totais()
            .map_err(|e| ErroConsulta::Entrada(e.to_string()))?;
        let o = match origem {
            Origem::Ambulatorial => "A",
            Origem::Hospitalar => "H",
        };
        let mut st = self.conn().prepare(&format!(
            "SELECT comp, estab, qtd, valor_cent, qtd_pro, valor_pro_cent
             FROM uf_proc_mes WHERE origem = '{o}' AND proc = ?1 ORDER BY comp"
        ))?;
        Ok(st
            .query_map([proc], |r| {
                Ok(MesProcedimento {
                    competencia: r.get(0)?,
                    estabelecimentos: r.get::<_, i64>(1)?.unsigned_abs(),
                    quantidade: r.get(2)?,
                    valor_centavos: r.get(3)?,
                    apresentado_quantidade: r.get(4)?,
                    apresentado_centavos: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Divisão por financiamento: de um procedimento (se dado) ou da unidade (se dado), nas
    /// competências dadas. Financiamento vazio = mês carregado antes do campo existir.
    pub fn por_financiamento(
        &self,
        origem: Origem,
        procedimento: Option<&str>,
        cnes: Option<&str>,
        comps: &[String],
    ) -> Result<Vec<PorFinanciamento>, ErroConsulta> {
        let (t, q) = match origem {
            Origem::Ambulatorial => ("prod_amb", "qtd"),
            Origem::Hospitalar => ("prod_hosp", "aih"),
        };
        let proc = procedimento
            .map(crate::ficha::normalizar_codigo)
            .transpose()?;
        let mut st = self.conn().prepare(&format!(
            "SELECT fin, sum({q}), sum(valor_cent) FROM {t}
             WHERE comp IN ({}) AND (?1 IS NULL OR proc = ?1) AND (?2 IS NULL OR cnes = ?2)
             GROUP BY fin ORDER BY sum(valor_cent) DESC, fin",
            lista(comps)?
        ))?;
        Ok(st
            .query_map(rusqlite::params![proc, cnes], |r| {
                Ok(PorFinanciamento {
                    codigo: r.get(0)?,
                    quantidade: r.get(1)?,
                    valor_centavos: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Apresentado × aprovado do SIA da unidade, nas competências dadas que têm o campo.
    pub fn apresentado_e_aprovado(
        &self,
        cnes: &str,
        comps: &[String],
        limite: usize,
    ) -> Result<ApresentadoAprovado, ErroConsulta> {
        let ls = lista(comps)?;
        let mut st = self.conn().prepare(&format!(
            "SELECT DISTINCT comp FROM prod_amb WHERE cnes = ?1 AND qtd_pro IS NOT NULL AND comp IN ({ls}) ORDER BY comp"
        ))?;
        let competencias = st
            .query_map([cnes], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let (apres, aprov): (i64, i64) = self.conn().query_row(
            &format!(
                "SELECT coalesce(sum(valor_pro_cent), 0), coalesce(sum(valor_cent), 0) FROM prod_amb
                 WHERE cnes = ?1 AND qtd_pro IS NOT NULL AND comp IN ({ls})"
            ),
            [cnes],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut st = self.conn().prepare(&format!(
            "SELECT proc, sum(qtd_pro), sum(qtd), sum(valor_pro_cent), sum(valor_cent) FROM prod_amb
             WHERE cnes = ?1 AND qtd_pro IS NOT NULL AND comp IN ({ls})
             GROUP BY proc HAVING sum(valor_pro_cent) > sum(valor_cent)
             ORDER BY sum(valor_pro_cent) - sum(valor_cent) DESC, proc LIMIT ?2"
        ))?;
        let maiores = st
            .query_map(
                rusqlite::params![cnes, i64::try_from(limite).unwrap_or(10)],
                |r| {
                    Ok(Diferenca {
                        procedimento: r.get(0)?,
                        quantidade_apresentada: r.get(1)?,
                        quantidade_aprovada: r.get(2)?,
                        valor_apresentado_centavos: r.get(3)?,
                        valor_aprovado_centavos: r.get(4)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let mut st = self.conn().prepare(&format!(
            "SELECT d.cod,
                    (SELECT a.descricao FROM aux_codigo a WHERE a.tabela = 'CODOCO' AND substr(a.codigo, -1) = d.cod LIMIT 1),
                    sum(d.qtd_pro), sum(d.qtd), sum(d.valor_pro_cent), sum(d.valor_cent)
             FROM prod_dim d
             WHERE d.cnes = ?1 AND d.dim = 'PA_FLQT' AND d.qtd_pro IS NOT NULL AND d.comp IN ({ls})
             GROUP BY d.cod
             HAVING sum(d.valor_pro_cent) <> sum(d.valor_cent)
             ORDER BY sum(d.valor_pro_cent) - sum(d.valor_cent) DESC, d.cod"
        ))?;
        let motivos = st
            .query_map([cnes], |r| {
                Ok(MotivoNaoPago {
                    codigo: r.get(0)?,
                    descricao: r.get(1)?,
                    quantidade_apresentada: r.get(2)?,
                    quantidade_aprovada: r.get(3)?,
                    valor_apresentado_centavos: r.get(4)?,
                    valor_aprovado_centavos: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ApresentadoAprovado {
            competencias,
            valor_apresentado_centavos: apres,
            valor_aprovado_centavos: aprov,
            maiores,
            motivos,
        })
    }

    /// Valor aprovado da unidade por instrumento de registro (BPA-C, BPA-I, APAC, RAAS), nas competências dadas.
    pub fn instrumentos_da_unidade(
        &self,
        cnes: &str,
        comps: &[String],
    ) -> Result<Vec<PorInstrumento>, ErroConsulta> {
        let mut st = self.conn().prepare(&format!(
            "SELECT d.cod, (SELECT a.descricao FROM aux_codigo a WHERE a.tabela = 'DOCORIG' AND a.codigo = d.cod),
                    sum(d.qtd), sum(d.valor_cent)
             FROM prod_dim d WHERE d.cnes = ?1 AND d.dim = 'PA_DOCORIG' AND d.comp IN ({})
             GROUP BY d.cod ORDER BY sum(d.valor_cent) DESC, d.cod",
            lista(comps)?
        ))?;
        Ok(st
            .query_map([cnes], |r| {
                Ok(PorInstrumento {
                    codigo: r.get(0)?,
                    descricao: r.get(1)?,
                    quantidade: r.get(2)?,
                    valor_centavos: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Valor da unidade por regra contratual e a soma dos campos de complemento, no SIA e no SIH.
    /// Só aparece o que o arquivo carregado trouxe (campo ausente não vira zero).
    pub fn perfil_financeiro(
        &self,
        cnes: &str,
        comps_sia: &[String],
        comps_sih: &[String],
    ) -> Result<PerfilFinanceiro, ErroConsulta> {
        let mut p = PerfilFinanceiro::default();
        for (origem, tipo, regra, somas, comps) in [
            (
                "SIA",
                "PA",
                "PA_REGCT",
                ["PA_VL_CL", "PA_VL_CF", "PA_VL_CRD"].as_slice(),
                comps_sia,
            ),
            (
                "SIH",
                "RD",
                "REGCT",
                [
                    "VAL_SH_FED",
                    "VAL_SP_FED",
                    "VAL_SH_GES",
                    "VAL_SP_GES",
                    "VAL_UTI",
                ]
                .as_slice(),
                comps_sih,
            ),
        ] {
            let lista = lista(comps)?;
            let mut st = self.conn().prepare(&format!(
                "SELECT cod, sum(qtd), sum(valor_cent) FROM prod_dim
                 WHERE cnes = ?1 AND tipo = ?2 AND dim = ?3 AND comp IN ({lista})
                 GROUP BY cod ORDER BY sum(valor_cent) DESC, cod"
            ))?;
            for r in st.query_map([cnes, tipo, regra], |r| {
                Ok(ValorPorRegra {
                    origem: origem.to_string(),
                    codigo: r.get(0)?,
                    quantidade: r.get(1)?,
                    valor_centavos: r.get(2)?,
                })
            })? {
                p.regras.push(r?);
            }
            let mut st = self.conn().prepare(&format!(
                "SELECT dim, sum(valor_cent) FROM prod_dim
                 WHERE cnes = ?1 AND tipo = ?2 AND cod = '' AND comp IN ({lista})
                 GROUP BY dim"
            ))?;
            let mut achados: BTreeMap<String, i64> = BTreeMap::new();
            for r in st.query_map([cnes, tipo], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (campo, v) = r?;
                achados.insert(campo, v);
            }
            for campo in somas {
                if let Some(&v) = achados.get(*campo) {
                    p.complementos.push(Complemento {
                        origem: origem.to_string(),
                        campo: (*campo).to_string(),
                        valor_centavos: v,
                    });
                }
            }
        }
        Ok(p)
    }

    /// Composição do valor das AIH da unidade nas competências dadas, comparada com a UF. Vazia se o arquivo SP
    /// do SIH não foi carregado. `SP_CO_FAEC` em branco é financiamento sem FAEC.
    pub fn composicao_da_aih(
        &self,
        cnes: &str,
        comps: &[String],
    ) -> Result<ComposicaoAih, ErroConsulta> {
        self.totais()?;
        let lista = lista(comps)?;
        let mut c = ComposicaoAih::default();
        let uf: BTreeMap<String, (i64, i64)> = {
            let mut st = self.conn().prepare(&format!(
                "SELECT fin, sum(valor_cent), sum(CASE WHEN opm = 1 THEN valor_cent ELSE 0 END)
                 FROM uf_ato_mes WHERE comp IN ({lista}) GROUP BY fin"
            ))?;
            st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?
                .collect::<Result<_, _>>()?
        };
        let mut st = self.conn().prepare(&format!(
            "SELECT fin, sum(valor_cent), sum(CASE WHEN proc LIKE '07%' THEN valor_cent ELSE 0 END)
             FROM prod_ato WHERE cnes = ?1 AND comp IN ({lista}) GROUP BY fin ORDER BY fin"
        ))?;
        let linhas = st
            .query_map([cnes], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (fin, valor, opm) in linhas {
            let (valor_uf, _) = uf.get(&fin).copied().unwrap_or_default();
            c.total_centavos += valor;
            c.opm_centavos += opm;
            c.tipos.push(ValorPorTipo {
                fin,
                valor_centavos: valor,
                valor_uf_centavos: valor_uf,
            });
        }
        c.opm_uf_centavos = uf.values().map(|x| x.1).sum();
        let faec = |tabela: &str, filtro: &str, args: &[&str]| -> Result<i64, ErroConsulta> {
            Ok(self.conn().query_row(
                &format!(
                    "SELECT coalesce(sum(valor_cent), 0) FROM {tabela}
                     WHERE tipo = 'SP' AND dim = 'SP_CO_FAEC' AND trim(cod) <> '' AND comp IN ({lista}){filtro}"
                ),
                rusqlite::params_from_iter(args),
                |r| r.get(0),
            )?)
        };
        c.faec_centavos = faec("prod_dim", " AND cnes = ?1", &[cnes])?;
        c.faec_uf_centavos = faec("uf_dim_mes", "", &[])?;
        c.uti_centavos = self.conn().query_row(
            &format!(
                "SELECT sum(valor_cent) FROM prod_dim
                     WHERE cnes = ?1 AND tipo = 'RD' AND dim = 'VAL_UTI' AND comp IN ({lista})"
            ),
            [cnes],
            |r| r.get::<_, Option<i64>>(0),
        )?;
        Ok(c)
    }

    /// Serviço/classificação executado pela unidade no SIA (campo `PA_SRV_C`), do maior valor para o menor.
    pub fn servicos_executados(
        &self,
        cnes: &str,
        comps: &[String],
    ) -> Result<ServicosExecutados, ErroConsulta> {
        let mut st = self.conn().prepare(&format!(
            "SELECT trim(cod), sum(qtd), sum(valor_cent) FROM prod_dim
             WHERE cnes = ?1 AND tipo = 'PA' AND dim = 'PA_SRV_C' AND comp IN ({})
             GROUP BY trim(cod) ORDER BY sum(valor_cent) DESC, 1",
            lista(comps)?
        ))?;
        let mut s = ServicosExecutados::default();
        for r in st.query_map([cnes], |r| {
            Ok(ServicoExecutado {
                codigo: r.get(0)?,
                quantidade: r.get(1)?,
                valor_centavos: r.get(2)?,
            })
        })? {
            let x = r?;
            if x.codigo.is_empty() {
                s.sem_servico_centavos += x.valor_centavos;
            } else {
                s.executados.push(x);
            }
        }
        Ok(s)
    }

    /// Quanto do valor apresentado em cada mês é de meses anteriores (campo `PA_CMP`), na unidade e na UF.
    /// Vazia se o arquivo carregado não tem o campo.
    pub fn reapresentacao(
        &self,
        cnes: &str,
        comps: &[String],
    ) -> Result<Reapresentacao, ErroConsulta> {
        self.totais()?;
        let lista = lista(comps)?;
        // O mês do arquivo (`comp`) contra o mês do atendimento (`cod`): anterior = produção de outro mês.
        let somas = "sum(CASE WHEN cod >= comp THEN valor_cent ELSE 0 END),
                     sum(CASE WHEN cod < comp AND trim(cod) <> '' THEN valor_cent ELSE 0 END)";
        let mut uf: BTreeMap<String, (i64, i64)> = BTreeMap::new();
        let mut st = self.conn().prepare(&format!(
            "SELECT comp, {somas} FROM uf_dim_mes WHERE tipo = 'PA' AND dim = 'PA_CMP' AND comp IN ({lista}) GROUP BY comp"
        ))?;
        for x in st.query_map([], |x| Ok((x.get::<_, String>(0)?, (x.get(1)?, x.get(2)?))))? {
            let (c, v) = x?;
            uf.insert(c, v);
        }
        let mut st = self.conn().prepare(&format!(
            "SELECT comp, {somas} FROM prod_dim
             WHERE cnes = ?1 AND tipo = 'PA' AND dim = 'PA_CMP' AND comp IN ({lista}) GROUP BY comp ORDER BY comp"
        ))?;
        let mut r = Reapresentacao::default();
        for x in st.query_map([cnes], |x| {
            Ok((
                x.get::<_, String>(0)?,
                x.get::<_, i64>(1)?,
                x.get::<_, i64>(2)?,
            ))
        })? {
            let (competencia, do_mes, anteriores) = x?;
            let (uf_do_mes, uf_anteriores) = uf.get(&competencia).copied().unwrap_or_default();
            r.meses.push(MesReapresentacao {
                competencia,
                do_mes_centavos: do_mes,
                anteriores_centavos: anteriores,
                uf_do_mes_centavos: uf_do_mes,
                uf_anteriores_centavos: uf_anteriores,
            });
        }
        let mut st = self.conn().prepare(&format!(
            "SELECT trim(cod), sum(valor_cent) FROM prod_dim
             WHERE cnes = ?1 AND tipo = 'PA' AND dim = 'PA_CMP' AND comp IN ({lista})
               AND cod < comp AND trim(cod) <> ''
             GROUP BY trim(cod) ORDER BY sum(valor_cent) DESC, 1"
        ))?;
        for x in st.query_map([cnes], |x| {
            Ok(OrigemDoAtraso {
                competencia: x.get(0)?,
                valor_centavos: x.get(1)?,
            })
        })? {
            r.origem_dos_atrasos.push(x?);
        }
        Ok(r)
    }

    /// AIH e dias de permanência da unidade por procedimento, com os mesmos totais da UF. Só entram AIH de
    /// arquivos que trazem os dias (esquema 2 em diante).
    pub fn permanencia_da_unidade(
        &self,
        cnes: &str,
        comps: &[String],
    ) -> Result<Vec<PermanenciaProcedimento>, ErroConsulta> {
        self.totais()?;
        let lista = lista(comps)?;
        let mut st = self.conn().prepare(&format!(
            "WITH minha AS (
                 SELECT proc, sum(aih) aih, sum(dias) dias FROM prod_hosp
                 WHERE cnes = ?1 AND dias IS NOT NULL AND comp IN ({lista}) GROUP BY proc),
             uf AS (
                 SELECT proc, sum(aih) aih, sum(dias) dias FROM uf_dias_proc
                 WHERE comp IN ({lista}) AND proc IN (SELECT proc FROM minha) GROUP BY proc)
             SELECT m.proc, m.aih, m.dias, u.aih, u.dias FROM minha m JOIN uf u ON u.proc = m.proc ORDER BY m.proc"
        ))?;
        Ok(st
            .query_map([cnes], |r| {
                Ok(PermanenciaProcedimento {
                    procedimento: r.get(0)?,
                    aih: r.get(1)?,
                    dias: r.get(2)?,
                    aih_uf: r.get(3)?,
                    dias_uf: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Total da UF por procedimento e instrumento de registro, nas competências dadas:
    /// `(procedimento, instrumento, quantidade, valor)`.
    pub fn instrumentos_da_uf(
        &self,
        comps: &[String],
    ) -> Result<Vec<(String, String, i64, i64)>, ErroConsulta> {
        let mut st = self.conn().prepare(&format!(
            "SELECT proc, cod, sum(qtd), sum(valor_cent) FROM prod_uf_dim WHERE dim = 'PA_DOCORIG' AND comp IN ({}) GROUP BY proc, cod",
            lista(comps)?
        ))?;
        Ok(st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    /// Procedimentos em que a quantidade apresentada de um mês foge da série da própria unidade e do que
    /// os outros estabelecimentos da UF produzem (limiares em [`ATIPICA_RAZAO`] e vizinhos). Só olha as
    /// competências dadas (`comps`), comparando com os meses **anteriores** da unidade; o mais valioso primeiro.
    pub fn quantidades_atipicas(
        &self,
        cnes: &str,
        comps: &[String],
        limite: usize,
    ) -> Result<Vec<QuantidadeAtipica>, ErroConsulta> {
        let mut st = self.conn().prepare(
            "SELECT proc, comp, sum(qtd_pro), sum(valor_pro_cent) FROM prod_amb
             WHERE cnes = ?1 AND qtd_pro IS NOT NULL GROUP BY proc, comp ORDER BY proc, comp",
        )?;
        let linhas = st
            .query_map([cnes], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut achados = Vec::new();
        let mut por_proc: BTreeMap<&str, Vec<(&str, i64, i64)>> = BTreeMap::new();
        for (p, c, q, v) in &linhas {
            por_proc.entry(p).or_default().push((c, *q, *v));
        }
        let mut uf = self.conn().prepare(
            "SELECT sum(qtd_pro) FROM prod_amb WHERE proc = ?1 AND comp = ?2 AND cnes <> ?3 AND qtd_pro IS NOT NULL
             GROUP BY cnes",
        )?;
        for (proc, serie) in &por_proc {
            for (i, &(comp, q, v)) in serie.iter().enumerate() {
                if !comps.iter().any(|c| c == comp) {
                    continue;
                }
                let base: Vec<f64> = serie[..i].iter().map(|x| x.1 as f64).collect();
                if base.len() < ATIPICA_MESES_BASE {
                    continue;
                }
                let Some(med) = mediana(&base) else { continue };
                if med <= 0.0
                    || (q as f64) < ATIPICA_RAZAO * med
                    || q - (med as i64) < ATIPICA_EXCESSO_MINIMO
                {
                    continue;
                }
                let outros: Vec<f64> = uf
                    .query_map(rusqlite::params![proc, comp, cnes], |r| r.get::<_, i64>(0))?
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .map(|x| x as f64)
                    .collect();
                let med_uf = mediana(&outros);
                if med_uf.is_some_and(|m| (q as f64) < ATIPICA_RAZAO * m) {
                    continue;
                }
                achados.push(QuantidadeAtipica {
                    procedimento: (*proc).to_string(),
                    competencia: comp.to_string(),
                    quantidade_apresentada: q,
                    valor_apresentado_centavos: v,
                    mediana_propria: med,
                    meses_base: base.len(),
                    mediana_uf: med_uf,
                });
            }
        }
        achados.sort_by(|a, b| {
            b.valor_apresentado_centavos
                .cmp(&a.valor_apresentado_centavos)
                .then_with(|| a.procedimento.cmp(&b.procedimento))
        });
        achados.truncate(limite);
        Ok(achados)
    }

    /// Resumo de várias unidades nas janelas do SIA e do SIH (comparação com pares).
    pub fn resumo_de_unidades(
        &self,
        cnes: &[String],
        comps_sia: &[String],
        comps_sih: &[String],
    ) -> Result<Vec<ResumoUnidade>, ErroConsulta> {
        self.totais()?;
        let (ls, lh) = (lista(comps_sia)?, lista(comps_sih)?);
        let mut m: BTreeMap<String, ResumoUnidade> = cnes
            .iter()
            .map(|c| {
                (
                    c.clone(),
                    ResumoUnidade {
                        cnes: c.clone(),
                        sia_valor_centavos: 0,
                        sih_aih: 0,
                        sih_valor_centavos: 0,
                        rejeicoes: 0,
                        rejeicoes_por_100_aih: None,
                    },
                )
            })
            .collect();
        for bloco in cnes.chunks(500) {
            let marcas = vec!["?"; bloco.len()].join(",");
            let consulta =
                |sql: String, f: &mut dyn FnMut(&str, i64, i64)| -> Result<(), ErroConsulta> {
                    let mut st = self.conn().prepare(&sql)?;
                    for l in st.query_map(rusqlite::params_from_iter(bloco.iter()), |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, i64>(2)?,
                        ))
                    })? {
                        let (c, a, b) = l?;
                        f(&c, a, b);
                    }
                    Ok(())
                };
            consulta(
                format!(
                    "SELECT cnes, sum(valor_cent), 0 FROM uf_estab_mes WHERE origem = 'A' AND cnes IN ({marcas}) AND comp IN ({ls}) GROUP BY cnes"
                ),
                &mut |c, a, _| {
                    if let Some(e) = m.get_mut(c) {
                        e.sia_valor_centavos = a;
                    }
                },
            )?;
            consulta(
                format!(
                    "SELECT cnes, sum(qtd), sum(valor_cent) FROM uf_estab_mes WHERE origem = 'H' AND cnes IN ({marcas}) AND comp IN ({lh}) GROUP BY cnes"
                ),
                &mut |c, a, b| {
                    if let Some(e) = m.get_mut(c) {
                        (e.sih_aih, e.sih_valor_centavos) = (a, b);
                    }
                },
            )?;
            consulta(
                format!(
                    "SELECT cnes, sum(qtd), 0 FROM rej_hosp WHERE cnes IN ({marcas}) AND comp IN ({lh}) GROUP BY cnes"
                ),
                &mut |c, a, _| {
                    if let Some(e) = m.get_mut(c) {
                        e.rejeicoes = a;
                    }
                },
            )?;
        }
        Ok(m.into_values()
            .map(|mut e| {
                e.rejeicoes_por_100_aih = por_100_aih(e.rejeicoes, e.sih_aih);
                e
            })
            .collect())
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use sa_packs::producao::{BancoProducao, Origem as Orig, sintetico::dbf};
    use sa_sources::producao::Manifesto;

    fn s(v: &[(&str, u64)]) -> Vec<(String, u64)> {
        v.iter().map(|(c, n)| (c.to_string(), *n)).collect()
    }

    #[test]
    fn mes_completo_pelos_numeros_reais_de_ms() {
        // Estabelecimentos por mês no SIA de MS (08/2025 a 07/2026) e no SIH.
        let sia = marcar_cobertura(&s(&[
            ("202508", 669),
            ("202509", 668),
            ("202510", 675),
            ("202511", 655),
            ("202512", 617),
            ("202601", 618),
            ("202602", 619),
            ("202603", 626),
            ("202604", 622),
            ("202605", 622),
            ("202606", 591),
            ("202607", 476),
        ]));
        let incompletos: Vec<&str> = sia
            .iter()
            .filter(|m| !m.completo)
            .map(|m| m.competencia.as_str())
            .collect();
        assert_eq!(incompletos, ["202607"], "só julho (76,5%) fica de fora");
        assert!(
            sia[0].sem_base && sia[0].completo,
            "o primeiro mês não tem com o que comparar"
        );
        assert!(!sia[1].sem_base);
        let sih = marcar_cobertura(&s(&[
            ("202606", 81),
            ("202607", 79),
            ("202605", 85),
            ("202604", 80),
        ]));
        assert!(sih.iter().all(|m| m.completo));
        // A janela pega os últimos meses completos, em ordem.
        assert_eq!(janela(&sia, 3), ["202604", "202605", "202606"]);
        assert_eq!(janela(&sia, 50).len(), 11);
    }

    #[test]
    fn curva_abc_classifica_pelo_valor_acumulado() {
        let itens: Vec<(String, i64, i64)> = [
            ("A1", 1, 7000),
            ("A2", 1, 1500),
            ("B1", 1, 900),
            ("C1", 1, 400),
            ("C2", 1, 200),
            ("Z", 1, 0),
        ]
        .iter()
        .map(|(p, q, v)| (p.to_string(), *q, *v))
        .collect();
        let r = curva_abc(&itens);
        let classes: String = r.iter().map(|x| x.classe).collect();
        // total 10000: 70% | 85% (começa em 70: A) | 94% (começa em 85: B) | 98% (começa em 94: B) | 100% | zero
        assert_eq!(classes, "AABBCC");
        assert_eq!(r[0].procedimento, "A1");
        assert!((r[0].percentual - 70.0).abs() < 1e-9);
        assert!((r[4].acumulado - 100.0).abs() < 1e-9);
        assert!(curva_abc(&[]).is_empty());
        let zero = curva_abc(&[("X".to_string(), 3, 0)]);
        assert_eq!(zero[0].classe, 'C');
    }

    #[test]
    fn tendencia_compara_tres_meses_com_os_tres_anteriores() {
        assert_eq!(
            tendencia(&[1, 2, 3, 4, 5]),
            None,
            "menos de seis meses não tem tendência"
        );
        let t = tendencia(&[100, 100, 100, 110, 110, 110]).unwrap();
        assert_eq!(t.sentido, "sobe");
        assert!((t.variacao_percentual.unwrap() - 10.0).abs() < 1e-9);
        assert_eq!(
            tendencia(&[100, 100, 100, 90, 90, 90]).unwrap().sentido,
            "cai"
        );
        assert_eq!(
            tendencia(&[100, 100, 100, 101, 102, 101]).unwrap().sentido,
            "estavel"
        );
        let z = tendencia(&[0, 0, 0, 5, 5, 5]).unwrap();
        assert_eq!((z.variacao_percentual, z.sentido), (None, "estavel"));
    }

    #[test]
    fn classificacao_separa_produz_e_nao_produz_com_o_motivo() {
        let e = |estado, so_38, fh, fs| {
            Some(EstadoDetalhado {
                estado,
                habilitacao_so_38: so_38,
                falta_habilitacao: fh,
                falta_servico: fs,
            })
        };
        assert_eq!(
            classificar_procedimento(None, true),
            Some(("produz_sem_exigencia", None))
        );
        assert_eq!(classificar_procedimento(None, false), None);
        let apta = e(Estado::Apta, false, false, false);
        assert_eq!(
            classificar_procedimento(apta, true),
            Some(("produz_apta", None))
        );
        assert_eq!(
            classificar_procedimento(apta, false),
            Some(("apta_nao_produz", None))
        );
        let ress = e(Estado::Ressalva, false, false, true);
        assert_eq!(
            classificar_procedimento(ress, true),
            Some(("produz_com_ressalva", Some("so_servico")))
        );
        assert_eq!(
            classificar_procedimento(ress, false),
            Some(("apta_nao_produz", Some("com_ressalva_de_servico")))
        );
        // Quem não é apto só interessa se produziu; e o motivo diz por quê.
        let so38 = e(Estado::Nao, true, true, false);
        assert_eq!(
            classificar_procedimento(so38, true),
            Some(("produz_sem_aptidao", Some("so_38")))
        );
        assert_eq!(classificar_procedimento(so38, false), None);
        let hab = e(Estado::Nao, false, true, false);
        assert_eq!(
            classificar_procedimento(hab, true),
            Some(("produz_sem_aptidao", Some("habilitacao")))
        );
        // 38.xx e serviço faltando: não é só 38.xx.
        let ambos = e(Estado::Nao, true, true, true);
        assert_eq!(
            classificar_procedimento(ambos, true),
            Some(("produz_sem_aptidao", Some("habilitacao_e_servico")))
        );
    }

    #[test]
    fn mediana_percentil_e_dias_do_mes() {
        assert_eq!(mediana(&[]), None);
        assert_eq!(mediana(&[3.0, 1.0, 2.0]), Some(2.0));
        assert_eq!(mediana(&[4.0, 1.0, 2.0, 3.0]), Some(2.5));
        assert_eq!(mediana(&[f64::NAN, 5.0]), Some(5.0));
        assert_eq!(percentil_abaixo(&[], 5), None);
        assert_eq!(percentil_abaixo(&[1, 2, 3, 4], 3), Some(50.0));
        assert_eq!(percentil_abaixo(&[10, 20], 5), Some(0.0));
        assert_eq!(dias_no_mes("202607"), Some(31));
        assert_eq!(dias_no_mes("202602"), Some(28));
        assert_eq!(dias_no_mes("202402"), Some(29));
        assert_eq!(dias_no_mes("190002"), Some(28));
        assert_eq!(dias_no_mes("200002"), Some(29));
        assert_eq!(dias_no_mes("202613"), None);
        assert_eq!(dias_no_mes("x"), None);
    }

    #[test]
    fn taxa_de_rejeicao_e_por_100_aih_e_nao_percentual_de_aih() {
        assert_eq!(
            por_100_aih(847, 17323).map(|x| (x * 100.0).round() / 100.0),
            Some(4.89)
        );
        assert_eq!(por_100_aih(5, 0), None);
    }

    fn origem(a: &str) -> Orig<'_> {
        Orig {
            uf: "MS",
            arquivo: a,
            sha256: "0",
            bytes: 1,
        }
    }

    fn l(v: &[&str]) -> Vec<String> {
        v.iter().map(ToString::to_string).collect()
    }

    const PA: [(&str, u8); 9] = [
        ("PA_CODUNI", 7),
        ("PA_MVM", 6),
        ("PA_PROC_ID", 10),
        ("PA_QTDAPR", 8),
        ("PA_VALAPR", 12),
        ("PA_TPFIN", 2),
        ("PA_QTDPRO", 8),
        ("PA_VALPRO", 12),
        ("PA_VL_INC", 12),
    ];

    fn banco_com_producao() -> ConsultaProducao {
        let mut b = BancoProducao::em_memoria().unwrap();
        let m = Manifesto::carregar();
        // Unidade 1: dois meses, um com apresentado maior que o aprovado; unidade 2: um mês.
        let pa = |linhas: &[Vec<String>]| dbf(&PA, linhas);
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2606a.dbc"),
            &pa(&[
                l(&[
                    "1000001",
                    "202606",
                    "0301010072",
                    "10",
                    "100.00",
                    "06",
                    "10",
                    "100.00",
                    "0",
                ]),
                l(&[
                    "1000001",
                    "202606",
                    "0301010072",
                    "2",
                    "20.00",
                    "04",
                    "2",
                    "20.00",
                    "0",
                ]),
                l(&[
                    "1000001",
                    "202606",
                    "0211060127",
                    "5",
                    "50.00",
                    "06",
                    "8",
                    "80.00",
                    "0",
                ]),
                l(&[
                    "1000002",
                    "202606",
                    "0301010072",
                    "7",
                    "70.00",
                    "06",
                    "7",
                    "70.00",
                    "0",
                ]),
            ]),
        )
        .unwrap();
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2607a.dbc"),
            &pa(&[l(&[
                "1000001",
                "202607",
                "0301010072",
                "12",
                "120.00",
                "06",
                "12",
                "120.00",
                "0",
            ])]),
        )
        .unwrap();
        let rd = |linhas: &[Vec<String>]| {
            dbf(
                &[
                    ("CNES", 7),
                    ("ANO_CMPT", 4),
                    ("MES_CMPT", 2),
                    ("PROC_REA", 10),
                    ("VAL_TOT", 12),
                    ("FINANC", 2),
                    ("DIAS_PERM", 5),
                    ("UTI_MES_TO", 3),
                ],
                linhas,
            )
        };
        b.carregar(
            &m,
            "RD",
            &origem("RDMS2606.dbc"),
            &rd(&[
                l(&[
                    "1000001",
                    "2026",
                    "06",
                    "0407040064",
                    "1000.00",
                    "06",
                    "4",
                    "0",
                ]),
                l(&[
                    "1000001",
                    "2026",
                    "06",
                    "0407040064",
                    "1000.00",
                    "06",
                    "6",
                    "2",
                ]),
                l(&[
                    "1000001",
                    "2026",
                    "06",
                    "0303010037",
                    "500.00",
                    "06",
                    "3",
                    "0",
                ]),
            ]),
        )
        .unwrap();
        let er = |linhas: &[Vec<String>]| {
            dbf(
                &[("CNES", 7), ("ANO", 4), ("MES", 2), ("CO_ERRO", 6)],
                linhas,
            )
        };
        b.carregar(
            &m,
            "ER",
            &origem("ERMS2606.dbc"),
            &er(&[
                l(&["1000001", "2026", "06", "020069"]),
                l(&["1000001", "2026", "06", "020069"]),
                l(&["1000001", "2026", "06", "020075"]),
            ]),
        )
        .unwrap();
        b.carregar(
            &m,
            "ER",
            &origem("ERMS2607.dbc"),
            &er(&[l(&["1000001", "2026", "07", "020069"])]),
        )
        .unwrap();
        b.gravar_moterro(
            &[(
                "020069".to_string(),
                "AIH BLOQUEADA PARA AUDITORIA".to_string(),
            )],
            "TAB_SIH.zip",
        )
        .unwrap();
        ConsultaProducao::de_banco(b)
    }

    #[test]
    fn serie_da_unidade_junta_sia_sih_e_rejeicoes_por_mes() {
        let q = banco_com_producao();
        let s = q.serie_da_unidade("1000001").unwrap();
        assert_eq!(s.len(), 2);
        let jun = &s[0];
        assert_eq!(jun.competencia, "202606");
        assert_eq!((jun.sia_quantidade, jun.sia_valor_centavos), (17, 17000));
        assert_eq!(jun.sia_apresentado_centavos, Some(20000));
        assert_eq!(
            (jun.sih_aih, jun.sih_valor_centavos, jun.sih_dias),
            (3, 250000, Some(13))
        );
        assert_eq!(jun.rejeicoes, 3);
        let jul = &s[1];
        assert_eq!(
            (jul.sih_aih, jul.rejeicoes),
            (0, 1),
            "rejeição num mês sem AIH aprovada aparece"
        );
        assert!(q.serie_da_unidade("9999999").unwrap().is_empty());
    }

    #[test]
    fn evolucao_das_rejeicoes_traz_descricao_e_meses() {
        let q = banco_com_producao();
        let e = q.evolucao_das_rejeicoes("1000001", 5, None).unwrap();
        assert_eq!(e[0].motivo, "020069");
        assert_eq!(e[0].total, 3);
        assert_eq!(
            e[0].descricao.as_deref(),
            Some("AIH BLOQUEADA PARA AUDITORIA")
        );
        assert_eq!(
            e[0].por_mes,
            [("202606".to_string(), 2), ("202607".to_string(), 1)]
        );
        assert_eq!(e[1].descricao, None);
        assert_eq!(
            q.evolucao_das_rejeicoes("1000001", 1, None).unwrap().len(),
            1
        );
    }

    #[test]
    fn evolucao_das_rejeicoes_respeita_a_janela() {
        let q = banco_com_producao();
        let janela = vec!["202607".to_string()];
        let e = q
            .evolucao_das_rejeicoes("1000001", 5, Some(&janela))
            .unwrap();
        assert_eq!(e[0].total, 1, "só o mês da janela entra no total");
        assert_eq!(e[0].por_mes, [("202607".to_string(), 1)]);
    }

    #[test]
    fn motivo_de_rejeicao_traz_vigencia_encerramento_e_bloqueio() {
        let b = BancoProducao::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "INSERT INTO rej_hosp(arq, cnes, comp, motivo, qtd) VALUES
                   ('ER.dbc', '1', '202607', '020069', 5),
                   ('ER.dbc', '1', '202607', '030001', 3),
                   ('ER.dbc', '1', '202607', '040002', 2);
                 INSERT INTO moterro VALUES ('030001', 'ERRO DE CONSISTENCIA', 'TAB_SIH.zip');
                 INSERT INTO aux_vigencia VALUES
                   ('0027', '020069', '200701', '999999', 'AIH BLOQUEADA PARA AUDITORIA', 'x'),
                   ('0027', '030001', '200701', '202512', 'ERRO DE CONSISTENCIA', 'x'),
                   ('0024', '0001', '200701', '999999', 'DUPLICIDADE', 'x');",
            )
            .unwrap();
        let q = ConsultaProducao::de_banco(b);
        let e = q.evolucao_das_rejeicoes("1", 5, None).unwrap();
        let por = |m: &str| e.iter().find(|x| x.motivo == m).unwrap();
        let bloq = por("020069");
        assert_eq!(
            bloq.descricao.as_deref(),
            Some("AIH BLOQUEADA PARA AUDITORIA"),
            "descrição vem da tabela de vigências"
        );
        assert!(bloq.bloqueio && !bloq.encerrado);
        assert_eq!(
            bloq.vigencia,
            Some(("200701".to_string(), "999999".to_string()))
        );
        let velho = por("030001");
        assert!(velho.encerrado, "fim 202512 antes de 202607");
        assert!(!velho.bloqueio);
        let sem = por("040002");
        assert_eq!(
            (sem.vigencia.clone(), sem.encerrado, sem.descricao.clone()),
            (None, false, None)
        );
    }

    #[test]
    fn janela_da_unidade_e_totais_da_uf() {
        let q = banco_com_producao();
        let c = vec!["202606".to_string()];
        let u = q
            .da_unidade_na_janela(Origem::Ambulatorial, "1000001", &c)
            .unwrap();
        assert_eq!(
            u,
            [
                ("0211060127".to_string(), 5, 5000),
                ("0301010072".to_string(), 12, 12000)
            ]
        );
        let uf = q.uf_por_procedimento(Origem::Ambulatorial, &c).unwrap();
        let t = &uf["0301010072"];
        assert_eq!(
            (t.produtores, t.quantidade, t.valor_centavos),
            (2, 19, 19000)
        );
        assert!(
            q.da_unidade_na_janela(Origem::Ambulatorial, "1000001", &[])
                .unwrap()
                .is_empty()
        );
        assert!(
            q.da_unidade_na_janela(Origem::Ambulatorial, "1000001", &["x'; DROP".to_string()])
                .is_err()
        );
    }

    #[test]
    fn apresentado_maior_que_aprovado_aparece_por_procedimento() {
        let q = banco_com_producao();
        let c = vec!["202606".to_string(), "202607".to_string()];
        let a = q.apresentado_e_aprovado("1000001", &c, 10).unwrap();
        assert_eq!(a.competencias, ["202606", "202607"]);
        assert_eq!(
            (a.valor_apresentado_centavos, a.valor_aprovado_centavos),
            (32000, 29000)
        );
        assert_eq!(a.maiores.len(), 1);
        assert_eq!(a.maiores[0].procedimento, "0211060127");
        assert_eq!(
            (
                a.maiores[0].quantidade_apresentada,
                a.maiores[0].quantidade_aprovada
            ),
            (8, 5)
        );
    }

    #[test]
    fn motivos_do_sia_dividem_a_diferenca_pelo_flqt_e_somam_a_diferenca_toda() {
        let mut b = BancoProducao::em_memoria().unwrap();
        let m = Manifesto::carregar();
        let campos = [
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
            ("PA_QTDPRO", 8),
            ("PA_VALPRO", 12),
            ("PA_FLQT", 1),
        ];
        let linha = |p: &str, qa: &str, va: &str, qp: &str, vp: &str, f: &str| {
            l(&["1000001", "202607", p, qa, va, qp, vp, f])
        };
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2607a.dbc"),
            &dbf(
                &campos,
                &[
                    linha("0301010072", "10", "100.00", "10", "100.00", "K"),
                    linha("0301010072", "0", "0.00", "5", "50.00", "O"),
                    linha("0211060127", "3", "30.00", "6", "60.00", "M"),
                    linha("0211060127", "0", "0.00", "2", "20.00", "N"),
                ],
            ),
        )
        .unwrap();
        b.gravar_auxiliar(
            "CODOCO",
            &[
                ("1K".to_string(), "APROVADO TOTALMENTE (K)".to_string()),
                (
                    "5O".to_string(),
                    "ULTRAPASSOU TETO FINANCEIRO (O)".to_string(),
                ),
            ],
            "TAB_SIA.zip",
        )
        .unwrap();
        let q = ConsultaProducao::de_banco(b);
        let a = q
            .apresentado_e_aprovado("1000001", &l(&["202607"]), 5)
            .unwrap();
        let diferenca = a.valor_apresentado_centavos - a.valor_aprovado_centavos;
        assert_eq!(diferenca, 10000);
        let soma: i64 = a
            .motivos
            .iter()
            .map(|x| x.valor_apresentado_centavos - x.valor_aprovado_centavos)
            .sum();
        assert_eq!(
            soma, diferenca,
            "a soma dos motivos é a diferença, ao centavo"
        );
        let cod: Vec<&str> = a.motivos.iter().map(|x| x.codigo.as_str()).collect();
        assert_eq!(
            cod,
            ["O", "M", "N"],
            "K (aprovado inteiro) não aparece: não há diferença"
        );
        assert_eq!(
            a.motivos[0].descricao.as_deref(),
            Some("ULTRAPASSOU TETO FINANCEIRO (O)")
        );
        assert_eq!(
            a.motivos[1].descricao, None,
            "sem a tabela, o código aparece sem inventar texto"
        );
    }

    #[test]
    fn instrumentos_somam_o_total_da_unidade_e_da_uf_por_procedimento() {
        let mut b = BancoProducao::em_memoria().unwrap();
        let m = Manifesto::carregar();
        let campos = [
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
            ("PA_DOCORIG", 1),
        ];
        let linha = |u: &str, p: &str, q: &str, v: &str, d: &str| l(&[u, "202607", p, q, v, d]);
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2607a.dbc"),
            &dbf(
                &campos,
                &[
                    linha("1000001", "0301010072", "10", "100.00", "C"),
                    linha("1000001", "0301010072", "2", "20.00", "I"),
                    linha("1000001", "0211060127", "1", "50.00", "P"),
                    linha("1000002", "0301010072", "5", "50.00", "C"),
                ],
            ),
        )
        .unwrap();
        b.gravar_auxiliar(
            "DOCORIG",
            &[("C".to_string(), "BPA-C".to_string())],
            "TAB_SIA.zip",
        )
        .unwrap();
        let q = ConsultaProducao::de_banco(b);
        let c = l(&["202607"]);
        let u = q.instrumentos_da_unidade("1000001", &c).unwrap();
        let por: Vec<(&str, i64)> = u
            .iter()
            .map(|x| (x.codigo.as_str(), x.valor_centavos))
            .collect();
        assert_eq!(por, [("C", 10000), ("P", 5000), ("I", 2000)]);
        assert_eq!(u[0].descricao.as_deref(), Some("BPA-C"));
        assert_eq!(u[1].descricao, None, "sem a tabela, só o código");
        let uf = q.instrumentos_da_uf(&c).unwrap();
        let total: i64 = uf.iter().map(|x| x.3).sum();
        assert_eq!(
            total,
            10000 + 2000 + 5000 + 5000,
            "o total por instrumento é o total do PA"
        );
        assert!(uf.contains(&("0301010072".to_string(), "C".to_string(), 15, 15000)));
    }

    #[test]
    fn perfil_financeiro_separa_regra_contratual_e_complementos_da_unidade() {
        let mut b = BancoProducao::em_memoria().unwrap();
        let m = Manifesto::carregar();
        let campos = [
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
            ("PA_REGCT", 4),
            ("PA_VL_CL", 12),
            ("PA_VL_CF", 12),
        ];
        let linha = |u: &str, v: &str, r: &str, cl: &str, cf: &str| {
            l(&[u, "202607", "0301010072", "1", v, r, cl, cf])
        };
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2607a.dbc"),
            &dbf(
                &campos,
                &[
                    linha("1000001", "100.00", "7100", "10.00", "0.00"),
                    linha("1000001", "50.00", "7100", "5.00", "2.00"),
                    linha("1000001", "30.00", "", "0.00", "0.00"),
                    linha("1000002", "999.00", "7100", "99.00", "99.00"),
                ],
            ),
        )
        .unwrap();
        b.conexao()
            .execute(
                "INSERT INTO prod_dim(arq, tipo, cnes, comp, dim, cod, qtd, valor_cent)
                 VALUES('RDMS2607.dbc', 'RD', '1000001', '202607', 'REGCT', '7100', 3, 40000),
                       ('RDMS2607.dbc', 'RD', '1000001', '202607', 'VAL_UTI', '', 0, 9000),
                       ('RDMS2607.dbc', 'RD', '1000002', '202607', 'VAL_UTI', '', 0, 1)",
                [],
            )
            .unwrap();
        let q = ConsultaProducao::de_banco(b);
        let c = l(&["202607"]);
        let p = q.perfil_financeiro("1000001", &c, &c).unwrap();
        let regra = |o: &str, cod: &str| {
            p.regras
                .iter()
                .find(|r| r.origem == o && r.codigo == cod)
                .map(|r| (r.quantidade, r.valor_centavos))
        };
        assert_eq!(regra("SIA", "7100"), Some((2, 15000)));
        assert_eq!(
            regra("SIA", ""),
            Some((1, 3000)),
            "sem regra também aparece"
        );
        assert_eq!(regra("SIH", "7100"), Some((3, 40000)));
        let comp = |o: &str, campo: &str| {
            p.complementos
                .iter()
                .find(|r| r.origem == o && r.campo == campo)
                .map(|r| r.valor_centavos)
        };
        assert_eq!(comp("SIA", "PA_VL_CL"), Some(1500));
        assert_eq!(comp("SIA", "PA_VL_CF"), Some(200));
        assert_eq!(comp("SIH", "VAL_UTI"), Some(9000));
        assert_eq!(
            comp("SIA", "PA_VL_CRD"),
            None,
            "campo que o arquivo não tem não vira zero"
        );
        let vazio = q.perfil_financeiro("9999999", &c, &c).unwrap();
        assert!(vazio.regras.is_empty() && vazio.complementos.is_empty());
    }

    #[test]
    fn composicao_da_aih_separa_sh_sp_complementos_opm_e_faec() {
        let b = BancoProducao::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "INSERT INTO prod_ato(arq, cnes, comp, proc, fin, qtd, valor_cent) VALUES
                   ('SP.dbc', '1', '202607', '0407010068', '1', 2, 60000),
                   ('SP.dbc', '1', '202607', '0407010068', '2', 2, 20000),
                   ('SP.dbc', '1', '202607', '0407010068', '3', 2, 5000),
                   ('SP.dbc', '1', '202607', '0715010012', '1', 1, 10000),
                   ('SP.dbc', '2', '202607', '0407010068', '1', 1, 100000),
                   ('SP.dbc', '1', '202501', '0407010068', '1', 1, 7777);
                 INSERT INTO prod_dim(arq, tipo, cnes, comp, dim, cod, qtd, valor_cent) VALUES
                   ('SP.dbc', 'SP', '1', '202607', 'SP_CO_FAEC', '', 3, 70000),
                   ('SP.dbc', 'SP', '1', '202607', 'SP_CO_FAEC', '040032', 1, 25000),
                   ('SP.dbc', 'SP', '2', '202607', 'SP_CO_FAEC', '040032', 1, 100000),
                   ('RD.dbc', 'RD', '1', '202607', 'VAL_UTI', '', 0, 12000);",
            )
            .unwrap();
        b.refazer_totais().unwrap();
        let q = ConsultaProducao::de_banco(b);
        let c = q.composicao_da_aih("1", &l(&["202607"])).unwrap();
        assert_eq!(c.total_centavos, 95000);
        let t = |fin: &str| {
            c.tipos
                .iter()
                .find(|x| x.fin == fin)
                .map(|x| (x.valor_centavos, x.valor_uf_centavos))
        };
        assert_eq!(t("1"), Some((70000, 170000)));
        assert_eq!(t("2"), Some((20000, 20000)));
        assert_eq!(t("3"), Some((5000, 5000)));
        assert_eq!(t("4"), None);
        assert_eq!((c.opm_centavos, c.opm_uf_centavos), (10000, 10000));
        assert_eq!((c.faec_centavos, c.faec_uf_centavos), (25000, 125000));
        assert_eq!(c.uti_centavos, Some(12000));
        let vazia = q.composicao_da_aih("9", &l(&["202607"])).unwrap();
        assert_eq!(vazia.total_centavos, 0);
        assert!(vazia.tipos.is_empty());
    }

    #[test]
    fn servicos_executados_somam_por_codigo_e_confrontam_com_o_cadastro() {
        let b = BancoProducao::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "INSERT INTO prod_dim(arq, tipo, cnes, comp, dim, cod, qtd, valor_cent) VALUES
                   ('PA.dbc', 'PA', '1', '202607', 'PA_SRV_C', '130001', 5, 50000),
                   ('PA.dbc', 'PA', '1', '202606', 'PA_SRV_C', '130001', 5, 30000),
                   ('PA.dbc', 'PA', '1', '202607', 'PA_SRV_C', '121003', 2, 20000),
                   ('PA.dbc', 'PA', '1', '202607', 'PA_SRV_C', '164001', 1, 10000),
                   ('PA.dbc', 'PA', '1', '202607', 'PA_SRV_C', '', 9, 7000),
                   ('PA.dbc', 'PA', '2', '202607', 'PA_SRV_C', '130001', 1, 99999);",
            )
            .unwrap();
        let q = ConsultaProducao::de_banco(b);
        let e = q
            .servicos_executados("1", &l(&["202607", "202606"]))
            .unwrap();
        let por: Vec<(&str, i64)> = e
            .executados
            .iter()
            .map(|x| (x.codigo.as_str(), x.valor_centavos))
            .collect();
        assert_eq!(
            por,
            [("130001", 80000), ("121003", 20000), ("164001", 10000)]
        );
        assert_eq!(
            e.sem_servico_centavos, 7000,
            "sem serviço informado fica à parte"
        );
        let cad: BTreeMap<String, bool> =
            [("130001".to_string(), true), ("121003".to_string(), false)].into();
        let c = confrontar_servicos(&e.executados, &cad);
        let sit: Vec<(&str, SituacaoServico)> =
            c.iter().map(|x| (x.codigo.as_str(), x.situacao)).collect();
        assert_eq!(
            sit,
            [
                ("130001", SituacaoServico::CadastradoSus),
                ("121003", SituacaoServico::CadastradoSemAmbulatorialSus),
                ("164001", SituacaoServico::ForaDoCadastro),
            ]
        );
    }

    #[test]
    fn reapresentacao_separa_o_mes_dos_meses_anteriores_e_compara_com_a_uf() {
        let b = BancoProducao::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "INSERT INTO prod_dim(arq, tipo, cnes, comp, dim, cod, qtd, valor_cent) VALUES
                   ('PA7.dbc', 'PA', '1', '202607', 'PA_CMP', '202607', 10, 90000),
                   ('PA7.dbc', 'PA', '1', '202607', 'PA_CMP', '202606', 2, 8000),
                   ('PA7.dbc', 'PA', '1', '202607', 'PA_CMP', '202604', 1, 2000),
                   ('PA7.dbc', 'PA', '2', '202607', 'PA_CMP', '202607', 50, 900000),
                   ('PA7.dbc', 'PA', '2', '202607', 'PA_CMP', '202606', 5, 50000),
                   ('PA6.dbc', 'PA', '1', '202606', 'PA_CMP', '202606', 10, 100000);",
            )
            .unwrap();
        b.refazer_totais().unwrap();
        let q = ConsultaProducao::de_banco(b);
        let r = q.reapresentacao("1", &l(&["202606", "202607"])).unwrap();
        let por: Vec<(&str, i64, i64, i64, i64)> = r
            .meses
            .iter()
            .map(|m| {
                (
                    m.competencia.as_str(),
                    m.do_mes_centavos,
                    m.anteriores_centavos,
                    m.uf_do_mes_centavos,
                    m.uf_anteriores_centavos,
                )
            })
            .collect();
        assert_eq!(
            por,
            [
                ("202606", 100000, 0, 100000, 0),
                ("202607", 90000, 10000, 990000, 60000)
            ]
        );
        let origem: Vec<(&str, i64)> = r
            .origem_dos_atrasos
            .iter()
            .map(|o| (o.competencia.as_str(), o.valor_centavos))
            .collect();
        assert_eq!(
            origem,
            [("202606", 8000), ("202604", 2000)],
            "maior valor primeiro"
        );
        assert!(
            q.reapresentacao("9", &l(&["202607"]))
                .unwrap()
                .meses
                .is_empty()
        );
    }

    #[test]
    fn permanencia_real_da_unidade_e_da_uf_por_procedimento() {
        let b = BancoProducao::em_memoria().unwrap();
        b.conexao()
            .execute_batch(
                "INSERT INTO prod_hosp(arq, cnes, comp, proc, fin, aih, valor_cent, dias) VALUES
                   ('RD.dbc', '1', '202607', '0303010010', '', 10, 100000, 80),
                   ('RD.dbc', '1', '202606', '0303010010', '', 10, 100000, 70),
                   ('RD.dbc', '1', '202607', '0407010068', '', 4, 40000, NULL),
                   ('RD.dbc', '2', '202607', '0303010010', '', 30, 300000, 90),
                   ('RD.dbc', '2', '202607', '0505010016', '', 5, 50000, 25);",
            )
            .unwrap();
        b.refazer_totais().unwrap();
        let q = ConsultaProducao::de_banco(b);
        let p = q
            .permanencia_da_unidade("1", &l(&["202606", "202607"]))
            .unwrap();
        assert_eq!(p.len(), 1, "sem o campo de dias o procedimento não entra");
        assert_eq!(
            (p[0].aih, p[0].dias, p[0].aih_uf, p[0].dias_uf),
            (20, 150, 50, 240)
        );
    }

    #[test]
    fn permanencia_compara_com_o_sigtap_so_com_base_minima_e_diferenca_grande() {
        // `media_uf` em dias por AIH, sobre 40 AIH da UF.
        let it = |p: &str, aih, dias, media_uf: i64| PermanenciaProcedimento {
            procedimento: p.to_string(),
            aih,
            dias,
            aih_uf: 40,
            dias_uf: 40 * media_uf,
        };
        let previstos: HashMap<String, i64> = [
            ("A", 3),
            ("B", 3),
            ("C", 3),
            ("D", 3),
            ("E", 9999),
            ("F", 0),
            ("H", 3),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        let itens = [
            it("A", 20, 100, 3),
            it("B", 20, 65, 3),
            it("C", 20, 20, 2),
            it("D", 5, 100, 3),
            it("E", 20, 400, 3),
            it("F", 20, 400, 3),
            it("G", 20, 400, 3),
            it("H", 20, 100, 5),
        ];
        let r = comparar_permanencia(&itens, &previstos);
        let nomes: Vec<&str> = r.iter().map(|x| x.procedimento.as_str()).collect();
        assert_eq!(
            nomes,
            ["A", "C"],
            "B fica perto do previsto, D tem poucas AIH, E/F/G sem previsão, H acompanha a UF"
        );
        assert_eq!(r[0].media_real, 5.0);
        assert_eq!(r[0].media_uf, Some(3.0));
        assert_eq!(r[1].media_real, 1.0);
    }

    #[test]
    fn mesmo_mes_do_ano_anterior_exige_o_mes_completo_e_trata_zero() {
        let c = |v: &[&str]| -> Vec<String> { v.iter().map(|s| s.to_string()).collect() };
        let valores = vec![("202507".to_string(), 1000), ("202607".to_string(), 1500)];
        let v = mesmo_mes_do_ano_anterior(&valores, &c(&["202507", "202606", "202607"])).unwrap();
        assert_eq!(
            (
                v.competencia.as_str(),
                v.valor_centavos,
                v.valor_anterior_centavos
            ),
            ("202607", 1500, 1000)
        );
        assert_eq!(v.variacao_percentual, Some(50.0));
        assert!(
            mesmo_mes_do_ano_anterior(&valores, &c(&["202606", "202607"])).is_none(),
            "sem o mês de um ano antes entre os completos baixados"
        );
        let sem_producao =
            mesmo_mes_do_ano_anterior(&valores[1..], &c(&["202507", "202607"])).unwrap();
        assert_eq!(sem_producao.valor_anterior_centavos, 0);
        assert_eq!(
            sem_producao.variacao_percentual, None,
            "base zero não vira percentual"
        );
        assert!(mesmo_mes_do_ano_anterior(&valores, &[]).is_none());
    }

    #[test]
    fn quantidade_atipica_aparece_so_quando_foge_da_unidade_e_dos_outros() {
        let mut b = BancoProducao::em_memoria().unwrap();
        let m = Manifesto::carregar();
        let campos = [
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
            ("PA_QTDPRO", 8),
            ("PA_VALPRO", 12),
        ];
        let mut carrega = |arq: &str, linhas: Vec<Vec<String>>| {
            b.carregar(&m, "PA", &origem(arq), &dbf(&campos, &linhas))
                .unwrap();
        };
        let linha = |u: &str, c: &str, p: &str, q: u32| {
            l(&[
                u,
                c,
                p,
                &q.to_string(),
                "1.00",
                &q.to_string(),
                &format!("{q}.00"),
            ])
        };
        // A unidade 1 produz 20 por mês e em julho apresenta 5.000: o salto. Os outros produzem de 15 a 25.
        // Outro procedimento da unidade 1 também salta, mas todos os outros estabelecimentos fazem tanto quanto.
        for (arq, c, q) in [
            ("PAMS2604a.dbc", "202604", 20),
            ("PAMS2605a.dbc", "202605", 22),
            ("PAMS2606a.dbc", "202606", 18),
            ("PAMS2607a.dbc", "202607", 5000),
        ] {
            let outros = if c == "202607" { 6000 } else { 20 };
            carrega(
                arq,
                vec![
                    linha("1000001", c, "0301010072", q),
                    linha("1000002", c, "0301010072", 15),
                    linha("1000003", c, "0301010072", 25),
                    linha(
                        "1000001",
                        c,
                        "0211060127",
                        if c == "202607" { 3000 } else { 10 },
                    ),
                    linha("1000002", c, "0211060127", outros),
                ],
            );
        }
        let q = ConsultaProducao::de_banco(b);
        let a = q
            .quantidades_atipicas("1000001", &l(&["202607"]), 10)
            .unwrap();
        assert_eq!(a.len(), 1, "{a:?}");
        assert_eq!(a[0].procedimento, "0301010072");
        assert_eq!(a[0].quantidade_apresentada, 5000);
        assert_eq!(a[0].meses_base, 3);
        assert_eq!(a[0].mediana_propria, 20.0);
        assert_eq!(a[0].mediana_uf, Some(20.0));
        // Fora da janela pedida, nada é avaliado; com menos de 3 meses de base, também não.
        assert!(
            q.quantidades_atipicas("1000001", &l(&["202606"]), 10)
                .unwrap()
                .is_empty()
        );
        assert!(
            q.quantidades_atipicas("1000002", &l(&["202607"]), 10)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn por_financiamento_separa_mac_e_faec() {
        let q = banco_com_producao();
        let c = vec!["202606".to_string()];
        let f = q
            .por_financiamento(Origem::Ambulatorial, Some("0301010072"), None, &c)
            .unwrap();
        assert_eq!(f[0].codigo, "06");
        assert_eq!(f[0].valor_centavos, 17000);
        assert_eq!(f[1].codigo, "04");
        let u = q
            .por_financiamento(Origem::Ambulatorial, None, Some("1000002"), &c)
            .unwrap();
        assert_eq!(u.len(), 1);
        assert_eq!(q.sem_campos_novos().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn serie_do_procedimento_conta_estabelecimentos_por_mes() {
        let q = banco_com_producao();
        let s = q
            .serie_do_procedimento(Origem::Ambulatorial, "0301010072")
            .unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].estabelecimentos, s[0].quantidade), (2, 19));
        assert_eq!((s[1].estabelecimentos, s[1].quantidade), (1, 12));
        assert_eq!(s[0].apresentado_quantidade, Some(19));
        let h = q
            .serie_do_procedimento(Origem::Hospitalar, "0407040064")
            .unwrap();
        assert_eq!(h[0].quantidade, 2);
        assert_eq!(h[0].apresentado_quantidade, None);
    }

    #[test]
    fn resumo_de_unidades_calcula_rejeicoes_por_100_aih() {
        let q = banco_com_producao();
        let c = vec!["202606".to_string()];
        let r = q
            .resumo_de_unidades(&["1000001".to_string(), "1000002".to_string()], &c, &c)
            .unwrap();
        assert_eq!(r[0].rejeicoes, 3);
        assert_eq!(r[0].sih_aih, 3);
        assert_eq!(r[0].rejeicoes_por_100_aih, Some(100.0));
        assert_eq!(r[1].sia_valor_centavos, 7000);
        assert_eq!(r[1].rejeicoes_por_100_aih, None, "sem AIH não há taxa");
    }
}
