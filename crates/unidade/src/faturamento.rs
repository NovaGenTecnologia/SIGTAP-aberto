//! Informações para o faturista, a partir da produção do SUS (SIA e SIH), do CNES e do SIGTAP:
//! o que a unidade fatura, o que perde, o que deixa de faturar e o que muda com a tabela.
//!
//! Só totais. Os números têm limites que a tela repete (ver `docs/fases/fase-4.md`, matriz de
//! validação): a produção sai com atraso; o último mês pode vir incompleto (por isso as análises de
//! volume usam os últimos meses completos); a taxa de rejeição é "por 100 AIH" porque o `ER` traz uma
//! linha por erro; o arquivo público do CNES não traz serviço terceirizado.

use crate::producao::consulta_producao;
use crate::{Pastas, consulta_cnes, exigir_uf};
use sa_core::Competencia;
use sa_query::Consulta;
use sa_query::cnes::{CriterioPar, Estado, EstadoDetalhado};
use sa_query::faturamento::{
    JANELA_LONGA_MESES, JANELA_MESES, classificar_procedimento, curva_abc, dias_no_mes, janela,
    mediana, mesmo_mes_do_ano_anterior, percentil_abaixo, por_100_aih, tendencia,
};
use sa_query::producao::{ConsultaProducao, Origem};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap, HashSet};

/// Quantos itens da curva ABC e das listas vão para a tela (o resto entra só na contagem).
const LIMITE_LISTA: usize = 40;
/// Procedimentos de cada classe que vão para a tela.
const LIMITE_CLASSE: usize = 300;
/// Unidades do mesmo tipo com pelo menos tantas AIH na janela entram na comparação da taxa.
const MINIMO_AIH_PARA_TAXA: i64 = 50;

pub const AVISO_FATURAMENTO: &str = "Números da produção apresentada e aprovada no SIA e das AIH aprovadas no SIH (DATASUS), com atraso de publicação. Análises de volume usam só os meses completos. O CNES público não traz serviço terceirizado.";

fn alvo_da_unidade(p: &Pastas, alvo: Option<(&str, &str)>) -> Result<(String, String), String> {
    match alvo {
        Some((u, c)) => {
            exigir_uf(u)?;
            Ok((u.to_string(), c.to_string()))
        }
        None => crate::minha(p).ok_or_else(|| {
            "nenhuma unidade escolhida. Escolha a sua unidade em Minha unidade".to_string()
        }),
    }
}

fn indisponivel(uf: &str) -> Value {
    json!({
        "disponivel": false,
        "uf": uf,
        "mensagem": format!("A produção de {uf} não está carregada. Baixe em Módulos e dados para ver estas análises."),
    })
}

/// Procedimento -> (quantidade, valor em centavos).
type Totais = HashMap<String, (i64, i64)>;

/// Competências da produção que a janela usa, por sistema.
struct Janelas {
    sia: Vec<String>,
    sih: Vec<String>,
}

fn janelas(q: &ConsultaProducao) -> Result<(Janelas, Value), String> {
    let cob_sia = q
        .cobertura(Origem::Ambulatorial)
        .map_err(|e| e.to_string())?;
    let cob_sih = q.cobertura(Origem::Hospitalar).map_err(|e| e.to_string())?;
    let j = Janelas {
        sia: janela(&cob_sia, JANELA_MESES),
        sih: janela(&cob_sih, JANELA_MESES),
    };
    let completos = |c: &[sa_query::faturamento::MesCobertura]| janela(c, usize::MAX);
    let v = json!({
        "cobertura": { "sia": cob_sia, "sih": cob_sih },
        "janela": { "sia": j.sia, "sih": j.sih },
        "janela_longa": { "sia": janela(&cob_sia, JANELA_LONGA_MESES), "sih": janela(&cob_sih, JANELA_LONGA_MESES) },
        "meses_completos": { "sia": completos(&cob_sia), "sih": completos(&cob_sih) },
    });
    Ok((j, v))
}

/// Valor da unidade por instrumento de registro e, na UF, o que foi produzido em instrumento que o SIGTAP
/// não lista para o procedimento (o instrumento do SIA vira o registro do SIGTAP pelo manifesto).
fn instrumentos_json(
    q: &ConsultaProducao,
    sig: &Consulta,
    comp: Competencia,
    cnes: &str,
    comps: &[String],
) -> Result<Value, sa_query::ErroConsulta> {
    let por = q.instrumentos_da_unidade(cnes, comps)?;
    if por.is_empty() {
        return Ok(Value::Null);
    }
    let m = sa_sources::producao::Manifesto::carregar();
    let registro: HashMap<&str, &str> = m
        .instrumento
        .iter()
        .map(|i| (i.docorig.as_str(), i.registro.as_str()))
        .collect();
    let listados = sig.registros_dos_procedimentos(comp)?;
    let vigentes = sig.valores_dos_procedimentos(comp)?;
    let (mut n, mut valor) = (BTreeSet::new(), 0i64);
    let mut itens: Vec<(i64, Value)> = Vec::new();
    for (proc, doc, qtd, v) in q.instrumentos_da_uf(comps)? {
        let Some(&reg) = registro.get(doc.as_str()) else {
            continue;
        };
        // Procedimento que nem existe na tabela vigente já aparece como "produz fora da tabela".
        if !vigentes.contains_key(&proc) || listados.get(&proc).is_some_and(|s| s.contains(reg)) {
            continue;
        }
        n.insert(proc.clone());
        valor += v;
        itens.push((
            v,
            json!({
                "procedimento": proc, "nome": nome_do(sig, comp, &proc), "instrumento": doc,
                "quantidade": qtd, "valor_centavos": v,
                "registros_do_sigtap": listados.get(&proc).map(|s| s.iter().collect::<Vec<_>>()),
            }),
        ));
    }
    itens.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(json!({
        "da_unidade": por,
        "divergencias_da_uf": {
            "procedimentos": n.len(),
            "valor_centavos": valor,
            "itens": itens.into_iter().take(20).map(|x| x.1).collect::<Vec<_>>(),
        },
        "aviso": "Instrumento = como a produção foi registrada (BPA consolidado, BPA individualizado, APAC, RAAS). A divergência compara o instrumento usado na UF inteira com os que o SIGTAP lista para o procedimento: indica registro fora do previsto, não erro certo.",
    }))
}

/// Perfil financeiro: marcas do CNES (regra contratual, incentivo, gestão e metas, filantropia), valor produzido
/// sob cada regra contratual e soma dos campos de complemento. `marcas` vem do CNES (vazio se não há).
fn perfil_json(
    q: &ConsultaProducao,
    marcas: &[sa_query::cnes::MarcaDaUnidade],
    cnes: &str,
    j: &Janelas,
) -> Result<Value, sa_query::ErroConsulta> {
    let p = q.perfil_financeiro(cnes, &j.sia, &j.sih)?;
    if p.regras.is_empty() && p.complementos.is_empty() && marcas.is_empty() {
        return Ok(Value::Null);
    }
    let descricao: HashMap<&str, &str> = marcas
        .iter()
        .filter(|m| m.tipo == "RC")
        .filter_map(|m| Some((m.codigo.as_str(), m.descricao.as_deref()?)))
        .collect();
    let regras: Vec<Value> = p
        .regras
        .iter()
        .map(|r| {
            let mut x = serde_json::to_value(r).unwrap_or_default();
            x["descricao"] = descricao
                .get(r.codigo.as_str())
                .map_or(Value::Null, |d| json!(d));
            x
        })
        .collect();
    Ok(json!({
        "marcas": marcas,
        "regras": regras,
        "complementos": p.complementos,
        "aviso": "As marcas vêm do CNES (regra contratual, incentivo, gestão e metas, filantropia) e valem na competência mais recente da janela. O valor por regra é o produzido pela unidade sob cada regra registrada nos arquivos do SIA e do SIH; \"sem regra\" é o código vazio ou 0000. Uma regra de não geração de crédito não indica erro: diz que parte da produção não gera crédito para o gestor.",
    }))
}

/// De que é feito o valor das AIH da unidade (SH, SP, complementos, OPM, FAEC), ao lado da UF.
fn composicao_json(
    q: &ConsultaProducao,
    cnes: &str,
    comps: &[String],
) -> Result<Value, sa_query::ErroConsulta> {
    let c = q.composicao_da_aih(cnes, comps)?;
    if c.total_centavos == 0 {
        return Ok(Value::Null);
    }
    let nome = |fin: &str| match fin {
        "1" => "Serviços hospitalares (SH)",
        "2" => "Serviços profissionais (SP)",
        "3" => "Complemento federal de SH",
        "4" => "Complemento federal de SP",
        _ => "Outro tipo de valor",
    };
    let tipos: Vec<Value> = c
        .tipos
        .iter()
        .map(|t| {
            let mut x = serde_json::to_value(t).unwrap_or_default();
            x["nome"] = json!(nome(&t.fin));
            x
        })
        .collect();
    let uf_total: i64 = c.tipos.iter().map(|t| t.valor_uf_centavos).sum();
    Ok(json!({
        "total_centavos": c.total_centavos,
        "total_uf_centavos": uf_total,
        "tipos": tipos,
        "opm_centavos": c.opm_centavos,
        "opm_uf_centavos": c.opm_uf_centavos,
        "faec_centavos": c.faec_centavos,
        "faec_uf_centavos": c.faec_uf_centavos,
        "uti_centavos": c.uti_centavos,
        "aviso": "Do arquivo de serviços profissionais do SIH (SP): cada ato da AIH tem um tipo de valor. A UTI já está dentro do valor hospitalar (SH). OPM = órteses, próteses e materiais (grupo 07). FAEC = procedimentos com código de financiamento FAEC. A coluna da UF soma todos os estabelecimentos, inclusive este.",
    }))
}

/// Serviço/classificação que a unidade declarou executar no SIA (`PA_SRV_C`) contra o que tem cadastrado no CNES.
/// `Null` sem produção do campo ou sem o arquivo de serviços (SR) do CNES: sem cadastro não há o que confrontar.
fn servicos_json(
    q: &ConsultaProducao,
    c: &sa_query::cnes::ConsultaCnes,
    sig: &Consulta,
    comp: Competencia,
    cnes: &str,
    comps: &[String],
) -> Result<Value, sa_query::ErroConsulta> {
    use sa_query::faturamento::{SituacaoServico, confrontar_servicos};
    let e = q.servicos_executados(cnes, comps)?;
    let cadastro = c.servicos_cadastrados(cnes)?;
    if e.executados.is_empty() || cadastro.is_empty() {
        return Ok(Value::Null);
    }
    let nomes = sa_query::cnes::ConsultaCnes::nomes_de_servicos(sig, comp);
    let conf = confrontar_servicos(&e.executados, &cadastro);
    let fora: i64 = conf
        .iter()
        .filter(|x| x.situacao == SituacaoServico::ForaDoCadastro)
        .map(|x| x.valor_centavos)
        .sum();
    let sem_marca: i64 = conf
        .iter()
        .filter(|x| x.situacao == SituacaoServico::CadastradoSemAmbulatorialSus)
        .map(|x| x.valor_centavos)
        .sum();
    let itens: Vec<Value> = conf
        .iter()
        .map(|x| {
            let mut v = serde_json::to_value(x).unwrap_or_default();
            v["nome"] = nomes.get(&x.codigo).map_or(Value::Null, |n| json!(n));
            v
        })
        .collect();
    Ok(json!({
        "itens": itens,
        "fora_do_cadastro_centavos": fora,
        "sem_marca_sus_centavos": sem_marca,
        "sem_servico_centavos": e.sem_servico_centavos,
        "aviso": "Serviço/classificação que o registro do SIA diz ter sido executado (3 dígitos do serviço e 3 da classificação), confrontado com os serviços cadastrados no CNES da unidade. Serviço fora do cadastro ou sem a marca de atendimento ambulatorial SUS pode indicar cadastro desatualizado ou código errado no registro; confira antes de corrigir.",
    }))
}

/// Quanto do que a unidade apresentou em cada mês é produção de meses anteriores (atraso ou reapresentação).
fn reapresentacao_json(
    q: &ConsultaProducao,
    cnes: &str,
    comps: &[String],
) -> Result<Value, sa_query::ErroConsulta> {
    let r = q.reapresentacao(cnes, comps)?;
    let anteriores: i64 = r.meses.iter().map(|m| m.anteriores_centavos).sum();
    let total: i64 = r
        .meses
        .iter()
        .map(|m| m.do_mes_centavos + m.anteriores_centavos)
        .sum();
    if total == 0 {
        return Ok(Value::Null);
    }
    let uf_anteriores: i64 = r.meses.iter().map(|m| m.uf_anteriores_centavos).sum();
    let uf_total: i64 = r
        .meses
        .iter()
        .map(|m| m.uf_do_mes_centavos + m.uf_anteriores_centavos)
        .sum();
    Ok(json!({
        "meses": r.meses,
        "anteriores_centavos": anteriores,
        "total_centavos": total,
        "uf_anteriores_centavos": uf_anteriores,
        "uf_total_centavos": uf_total,
        "origem_dos_atrasos": r.origem_dos_atrasos.iter().take(6).collect::<Vec<_>>(),
        "aviso": "Competência do atendimento (PA_CMP) menor que a do arquivo (PA_MVM): produção de um mês apresentada em outro, por atraso ou reapresentação. Um pouco é normal; muito, de forma repetida, sugere atraso no envio ou rejeições refeitas. O valor é o apresentado.",
    }))
}

/// Permanência média real das AIH da unidade contra a prevista no SIGTAP, só nos procedimentos que fogem do previsto.
fn permanencia_json(
    q: &ConsultaProducao,
    sig: &Consulta,
    comp: Competencia,
    cnes: &str,
    comps: &[String],
) -> Result<Value, sa_query::ErroConsulta> {
    use sa_query::faturamento::{
        PERMANENCIA_MIN_AIH, PERMANENCIA_RAZAO, PERMANENCIA_RAZAO_UF, comparar_permanencia,
    };
    let itens = q.permanencia_da_unidade(cnes, comps)?;
    if itens.is_empty() {
        return Ok(Value::Null);
    }
    let achados = comparar_permanencia(&itens, &sig.dias_de_permanencia(comp)?);
    let analisados = itens
        .iter()
        .filter(|x| x.aih >= PERMANENCIA_MIN_AIH)
        .count();
    let lista: Vec<Value> = achados
        .iter()
        .take(15)
        .map(|a| {
            let mut x = serde_json::to_value(a).unwrap_or_default();
            x["nome"] = nome_do(sig, comp, &a.procedimento);
            x
        })
        .collect();
    Ok(json!({
        "itens": lista,
        "fora_do_previsto": achados.len(),
        "analisados": analisados,
        "limiares": { "razao": PERMANENCIA_RAZAO, "razao_uf": PERMANENCIA_RAZAO_UF, "min_aih": PERMANENCIA_MIN_AIH },
        "aviso": "Dias de permanência informados nas AIH aprovadas ÷ número de AIH, por procedimento, contra os dias previstos no SIGTAP e contra a média da UF. Só aparece o procedimento que foge dos dois: o previsto do SIGTAP não é uma média, e muitos procedimentos têm a UF inteira acima ou abaixo dele. Permanência bem acima costuma indicar caso mais grave que o padrão ou internação prolongada sem justificativa; bem abaixo, que o procedimento pode estar sendo usado para casos mais leves. Só mostra procedimentos com base mínima de AIH. Não é auditoria: a conferência é no prontuário.",
    }))
}

fn nome_do(sig: &Consulta, comp: Competencia, proc: &str) -> Value {
    json!(sig.nome_procedimento(comp, proc).ok().flatten())
}

fn nomes_financiamento(sig: &Consulta, comp: Competencia) -> HashMap<String, String> {
    sig.nomes_de_financiamento(comp).unwrap_or_default()
}

fn financiamento_json(
    v: Vec<sa_query::faturamento::PorFinanciamento>,
    nomes: &HashMap<String, String>,
) -> Value {
    json!(
        v.into_iter()
            .map(|f| json!({
                "codigo": f.codigo,
                "nome": nomes.get(&f.codigo),
                "quantidade": f.quantidade,
                "valor_centavos": f.valor_centavos,
            }))
            .collect::<Vec<_>>()
    )
}

/// Resumo da curva ABC: itens e valor por classe, mais os primeiros itens com nome.
fn abc_json(
    sig: &Consulta,
    comp: Competencia,
    itens: &[(String, i64, i64)],
    quantidade_e_aih: &str,
) -> Value {
    let abc = curva_abc(itens);
    let mut resumo = json!({});
    for c in ['A', 'B', 'C'] {
        let (n, valor) = abc
            .iter()
            .filter(|x| x.classe == c)
            .fold((0usize, 0i64), |(n, v), x| (n + 1, v + x.valor_centavos));
        resumo[c.to_string()] = json!({ "procedimentos": n, "valor_centavos": valor });
    }
    let topo: Vec<Value> = abc
        .iter()
        .take(LIMITE_LISTA)
        .map(|x| {
            json!({
                "procedimento": x.procedimento,
                "nome": nome_do(sig, comp, &x.procedimento),
                "quantidade": x.quantidade,
                "valor_centavos": x.valor_centavos,
                "percentual": x.percentual,
                "acumulado": x.acumulado,
                "classe": x.classe.to_string(),
            })
        })
        .collect();
    json!({
        "unidade_quantidade": quantidade_e_aih,
        "total_procedimentos": abc.len(),
        "resumo": resumo,
        "itens": topo,
        "omitidos": abc.len().saturating_sub(LIMITE_LISTA),
    })
}

/// Soma, nos meses da janela, de um campo da série da unidade.
fn soma_na_janela(
    serie: &[sa_query::faturamento::MesUnidade],
    meses: &[String],
    f: impl Fn(&sa_query::faturamento::MesUnidade) -> i64,
) -> i64 {
    serie
        .iter()
        .filter(|m| meses.contains(&m.competencia))
        .map(f)
        .sum()
}

/// Dados de leitos e internações: AIH por leito SUS e, com os dias de permanência (esquema 2),
/// a ocupação aproximada. `leitos_sus` vem do CNES.
fn leitos_json(
    serie: &[sa_query::faturamento::MesUnidade],
    meses_sih: &[String],
    leitos_sus: i64,
    leitos_existentes: i64,
) -> Value {
    let por_mes: Vec<Value> = serie
        .iter()
        .filter(|m| meses_sih.contains(&m.competencia))
        .map(|m| {
            let ocupacao = match (m.sih_dias, dias_no_mes(&m.competencia)) {
                (Some(d), Some(n)) if leitos_sus > 0 => {
                    Some(d as f64 * 100.0 / (leitos_sus as f64 * f64::from(n)))
                }
                _ => None,
            };
            json!({
                "competencia": m.competencia,
                "aih": m.sih_aih,
                "dias_de_permanencia": m.sih_dias,
                "aih_por_leito_sus": (leitos_sus > 0).then(|| m.sih_aih as f64 / leitos_sus as f64),
                "ocupacao_percentual": ocupacao,
            })
        })
        .collect();
    json!({
        "leitos_sus": leitos_sus,
        "leitos_existentes": leitos_existentes,
        "por_mes": por_mes,
        "aviso": "Ocupação aproximada: dias de permanência das AIH aprovadas na competência ÷ (leitos SUS do cadastro × dias do mês). Não é o censo hospitalar.",
    })
}

/// Comparação com unidades do mesmo tipo da UF.
fn pares_json(
    q: &ConsultaProducao,
    c: &sa_query::cnes::ConsultaCnes,
    cnes: &str,
    j: &Janelas,
) -> Value {
    let Ok(Some((tipo, nome_tipo, todos))) = c.do_mesmo_tipo(cnes) else {
        return Value::Null;
    };
    // Os recortes são subconjuntos do mesmo tipo: o resumo da UF por estabelecimento é calculado uma vez só.
    let Ok(resumos) = q.resumo_de_unidades(&todos, &j.sia, &j.sih) else {
        return Value::Null;
    };
    let Some(mut geral) = comparacao_com(&resumos, cnes, None) else {
        return Value::Null;
    };
    // Recortes mais estreitos: o tipo sozinho mistura público, filantrópico, privado e de ensino.
    let grupos: Vec<Value> = [
        CriterioPar::TipoENaturezaJuridica,
        CriterioPar::TipoEFilantropia,
        CriterioPar::TipoEEnsino,
    ]
    .into_iter()
    .filter_map(|criterio| {
        let g = c.pares_por_criterio(cnes, criterio).ok()??;
        let membros: HashSet<&str> = g.cnes.iter().map(String::as_str).collect();
        let mut x = comparacao_com(&resumos, cnes, Some(&membros))?;
        x["criterio"] = json!(g.criterio);
        x["rotulo"] = json!(g.rotulo);
        Some(x)
    })
    .collect();
    geral["tipo"] = json!(tipo);
    geral["nome_tipo"] = json!(nome_tipo);
    geral["grupos"] = json!(grupos);
    geral["aviso"] = json!(
        "Comparação com os estabelecimentos do mesmo tipo (CNES) na UF que produziram no período. Percentil = % dos pares com valor menor. Os grupos mais estreitos separam por natureza jurídica, filantropia (arquivo EF) e atividade de ensino ou pesquisa (campo ATIVIDAD do CNES)."
    );
    geral
}

/// Posição da unidade entre `grupo` (ela incluída): valor no SIA e no SIH e taxa de rejeição por 100 AIH.
fn comparacao_com(
    resumos: &[sa_query::faturamento::ResumoUnidade],
    cnes: &str,
    grupo: Option<&HashSet<&str>>,
) -> Option<Value> {
    let eu = resumos.iter().find(|r| r.cnes == cnes)?;
    let outros: Vec<&sa_query::faturamento::ResumoUnidade> = resumos
        .iter()
        .filter(|r| grupo.is_none_or(|g| g.contains(r.cnes.as_str())))
        .filter(|r| r.cnes != cnes && (r.sia_valor_centavos > 0 || r.sih_valor_centavos > 0))
        .collect();
    let taxas: Vec<f64> = outros
        .iter()
        .filter(|r| r.sih_aih >= MINIMO_AIH_PARA_TAXA)
        .filter_map(|r| r.rejeicoes_por_100_aih)
        .collect();
    let valores_sia: Vec<i64> = outros.iter().map(|r| r.sia_valor_centavos).collect();
    let valores_sih: Vec<i64> = outros.iter().map(|r| r.sih_valor_centavos).collect();
    Some(json!({
        "pares_com_producao": outros.len(),
        "pares_com_taxa": taxas.len(),
        "minimo_aih_para_taxa": MINIMO_AIH_PARA_TAXA,
        "taxa_da_unidade": eu.rejeicoes_por_100_aih,
        "taxa_mediana_dos_pares": mediana(&taxas),
        "valor_sia_da_unidade_centavos": eu.sia_valor_centavos,
        "valor_sia_percentil": percentil_abaixo(&valores_sia, eu.sia_valor_centavos),
        "valor_sih_da_unidade_centavos": eu.sih_valor_centavos,
        "valor_sih_percentil": percentil_abaixo(&valores_sih, eu.sih_valor_centavos),
    }))
}

/// A unidade mês a mês e o que se tira disso: taxa de rejeição, tendência, curva ABC, apresentado ×
/// aprovado, financiamento, leitos e comparação com pares.
pub fn faturamento_da_unidade(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    alvo: Option<(&str, &str)>,
) -> Result<Value, String> {
    let (uf, cnes) = alvo_da_unidade(p, alvo)?;
    let Ok(q) = consulta_producao(p, &uf) else {
        return Ok(indisponivel(&uf));
    };
    let (j, mut saida) = janelas(&q)?;
    let serie = q.serie_da_unidade(&cnes).map_err(|e| e.to_string())?;
    let e = |x: sa_query::ErroConsulta| x.to_string();

    saida["disponivel"] = json!(true);
    saida["uf"] = json!(uf);
    saida["cnes"] = json!(cnes);
    saida["aviso"] = json!(AVISO_FATURAMENTO);
    saida["sem_campos_novos"] = json!(q.sem_campos_novos().map_err(e)?);
    saida["tem_rejeicoes"] = json!(serie.iter().any(|m| m.rejeicoes > 0));

    // Rejeições por 100 AIH, mês a mês e na janela.
    let rej = soma_na_janela(&serie, &j.sih, |m| m.rejeicoes);
    let aih = soma_na_janela(&serie, &j.sih, |m| m.sih_aih);
    saida["rejeicoes"] = json!({
        "janela_rejeicoes": rej,
        "janela_aih": aih,
        "por_100_aih": por_100_aih(rej, aih),
        "por_mes": serie.iter().map(|m| json!({
            "competencia": m.competencia,
            "rejeicoes": m.rejeicoes,
            "aih": m.sih_aih,
            "por_100_aih": por_100_aih(m.rejeicoes, m.sih_aih),
            "completo": j.sih.contains(&m.competencia),
        })).collect::<Vec<_>>(),
        "motivos": q.evolucao_das_rejeicoes(&cnes, 5).map_err(e)?,
        "aviso": "Rejeições por 100 AIH aprovadas. O arquivo de rejeições traz uma linha por erro (uma AIH pode ter vários) e a AIH rejeitada pode ser reapresentada e aprovada depois: não é o percentual de AIH perdidas.",
    });
    saida["meses"] = json!(serie);
    let anual = |campo: fn(&sa_query::faturamento::MesUnidade) -> i64, completos: &Value| {
        let c: Vec<String> = completos
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let v: Vec<(String, i64)> = serie
            .iter()
            .map(|m| (m.competencia.clone(), campo(m)))
            .collect();
        mesmo_mes_do_ano_anterior(&v, &c)
    };
    saida["ano_anterior"] = json!({
        "sia": anual(|m| m.sia_valor_centavos, &saida["meses_completos"]["sia"]),
        "sih": anual(|m| m.sih_valor_centavos, &saida["meses_completos"]["sih"]),
    });

    // Tendência do valor, nos meses completos.
    let valores =
        |meses: &[String], f: &dyn Fn(&sa_query::faturamento::MesUnidade) -> i64| -> Vec<i64> {
            meses
                .iter()
                .map(|c| serie.iter().find(|m| &m.competencia == c).map_or(0, f))
                .collect()
        };
    saida["tendencia"] = json!({
        "sia_valor": tendencia(&valores(&j.sia, &|m| m.sia_valor_centavos)),
        "sih_valor": tendencia(&valores(&j.sih, &|m| m.sih_valor_centavos)),
        "criterio": "média dos 3 últimos meses completos contra a dos 3 anteriores (precisa de 6 meses completos)",
    });

    // Curva ABC.
    let sia = q
        .da_unidade_na_janela(Origem::Ambulatorial, &cnes, &j.sia)
        .map_err(e)?;
    let sih = q
        .da_unidade_na_janela(Origem::Hospitalar, &cnes, &j.sih)
        .map_err(e)?;
    saida["abc"] = json!({
        "sia": abc_json(sig, comp, &sia, "quantidade aprovada"),
        "sih": abc_json(sig, comp, &sih, "AIH"),
    });

    // Apresentado × aprovado e financiamento (esquema 2).
    let apr = q.apresentado_e_aprovado(&cnes, &j.sia, 10).map_err(e)?;
    saida["apresentado"] = if apr.competencias.is_empty() {
        Value::Null
    } else {
        let nomes = |v: &Vec<sa_query::faturamento::Diferenca>| -> Vec<Value> {
            v.iter()
                .map(|d| {
                    let mut x = serde_json::to_value(d).unwrap_or_default();
                    x["nome"] = nome_do(sig, comp, &d.procedimento);
                    x
                })
                .collect()
        };
        let atipicas: Vec<Value> = q
            .quantidades_atipicas(&cnes, &j.sia, 10)
            .map_err(e)?
            .iter()
            .map(|a| {
                let mut x = serde_json::to_value(a).unwrap_or_default();
                x["nome"] = nome_do(sig, comp, &a.procedimento);
                x
            })
            .collect();
        json!({
            "competencias": apr.competencias,
            "valor_apresentado_centavos": apr.valor_apresentado_centavos,
            "valor_aprovado_centavos": apr.valor_aprovado_centavos,
            "maiores": nomes(&apr.maiores),
            "motivos": apr.motivos,
            "atipicas": atipicas,
            "limiares_atipica": {
                "razao": sa_query::faturamento::ATIPICA_RAZAO,
                "meses_base": sa_query::faturamento::ATIPICA_MESES_BASE,
                "excesso_minimo": sa_query::faturamento::ATIPICA_EXCESSO_MINIMO,
            },
            "aviso": "Diferença entre o que foi apresentado e o que o SIA aprovou. O motivo oficial vem do campo PA_FLQT: teto financeiro ou físico e falta de orçamento são limite do gestor, não erro; o que sobra é o que vale conferir no retorno da crítica do seu sistema.",
        })
    };
    saida["instrumentos"] = instrumentos_json(&q, sig, comp, &cnes, &j.sia).map_err(e)?;
    saida["composicao_aih"] = composicao_json(&q, &cnes, &j.sih).map_err(e)?;
    saida["reapresentacao"] = reapresentacao_json(&q, &cnes, &j.sia).map_err(e)?;
    saida["permanencia"] = permanencia_json(&q, sig, comp, &cnes, &j.sih).map_err(e)?;
    let nomes = nomes_financiamento(sig, comp);
    saida["financiamento"] = json!({
        "sia": financiamento_json(q.por_financiamento(Origem::Ambulatorial, None, Some(&cnes), &j.sia).map_err(e)?, &nomes),
        "sih": financiamento_json(q.por_financiamento(Origem::Hospitalar, None, Some(&cnes), &j.sih).map_err(e)?, &nomes),
    });

    // CNES: leitos e pares.
    saida["leitos"] = Value::Null;
    saida["pares"] = Value::Null;
    let cnes_aberto = consulta_cnes(p, &uf);
    let marcas = match &cnes_aberto {
        Ok(c) => c
            .marcas_da_unidade(
                &cnes,
                j.sia.last().or(j.sih.last()).map_or("", String::as_str),
            )
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    saida["perfil"] = perfil_json(&q, &marcas, &cnes, &j).map_err(e)?;
    saida["servicos"] = match &cnes_aberto {
        Ok(c) => servicos_json(&q, c, sig, comp, &cnes, &j.sia).map_err(e)?,
        Err(_) => Value::Null,
    };
    if let Ok(c) = cnes_aberto {
        if let Ok(Some(u)) = c.unidade(sig, comp, &cnes) {
            let sus: i64 = u.leitos.iter().map(|l| l.sus).sum();
            let existentes: i64 = u.leitos.iter().map(|l| l.existentes).sum();
            if existentes > 0 {
                saida["leitos"] = leitos_json(&serie, &j.sih, sus, existentes);
            }
        }
        saida["pares"] = pares_json(&q, &c, &cnes, &j);
    }
    Ok(saida)
}

/// Grupo de prioridade da Aptidão para uma classe do Rust: o que está em risco, o que é oportunidade e o
/// que está em ordem.
pub(crate) fn grupo_da_classe(classe: &str) -> Option<&'static str> {
    match classe {
        "produz_sem_aptidao" | "produz_com_ressalva" | "produz_fora_da_tabela" => Some("risco"),
        "apta_nao_produz" => Some("oportunidade"),
        "produz_apta" | "produz_sem_exigencia" => Some("ordem"),
        _ => None,
    }
}

/// Situação do item em texto estável para a tela (nunca só cor).
pub(crate) fn situacao_do_item(classe: &str, motivo: Option<&str>) -> &'static str {
    match (classe, motivo) {
        ("produz_sem_aptidao", _) => "nao_apta",
        ("produz_com_ressalva", _) => "servico_a_confirmar",
        ("produz_fora_da_tabela", _) => "fora_da_tabela",
        ("apta_nao_produz", Some("com_ressalva_de_servico")) => "apta_ressalva_servico",
        ("apta_nao_produz" | "produz_apta", _) => "apta",
        _ => "sem_exigencia",
    }
}

/// O que falta à unidade para um procedimento, a partir da `Aptidao` serializada: só o que a unidade
/// não tem, sem repetir o mesmo código.
pub(crate) fn faltas_da_aptidao(a: &Value) -> Vec<Value> {
    let mut v: Vec<Value> = Vec::new();
    let mut ver = std::collections::HashSet::new();
    let mut poe = |tipo: &str, codigo: String, nome: Option<String>| {
        if ver.insert((tipo.to_string(), codigo.clone())) {
            v.push(json!({ "tipo": tipo, "codigo": codigo, "nome": nome }));
        }
    };
    let texto = |x: &Value| x.as_str().map(String::from);
    for alt in a["habilitacao"]["alternativas"]
        .as_array()
        .into_iter()
        .flatten()
    {
        for h in alt["habilitacoes"].as_array().into_iter().flatten() {
            if h["tem"] == json!(false) {
                poe(
                    "habilitacao",
                    texto(&h["codigo"]).unwrap_or_default(),
                    texto(&h["nome"]),
                );
            }
        }
    }
    for par in a["servico"]["pares"].as_array().into_iter().flatten() {
        if par["tem"] != json!(false) {
            continue;
        }
        let (s, c) = (&par["servico"], &par["classificacao"]);
        let codigo = format!(
            "{}/{}",
            s["codigo"].as_str().unwrap_or(""),
            c["codigo"].as_str().unwrap_or("")
        );
        let nome = match (s["nome"].as_str(), c["nome"].as_str()) {
            (Some(x), Some(y)) => Some(format!("{x} · {y}")),
            (Some(x), None) | (None, Some(x)) => Some(x.to_string()),
            _ => None,
        };
        poe("servico", codigo, nome);
    }
    for l in a["leito"]["tipos"].as_array().into_iter().flatten() {
        if l["tem"] == json!(false) {
            poe(
                "leito",
                texto(&l["tipo"]["codigo"]).unwrap_or_default(),
                texto(&l["tipo"]["nome"]),
            );
        }
    }
    v
}

/// Estado da unidade num procedimento, em texto para a tela.
fn estado_texto(e: Option<EstadoDetalhado>) -> Value {
    json!(e.map(|x| x.estado))
}

/// Um procedimento da unidade diante da aptidão e da produção.
struct ItemDeAptidao {
    classe: &'static str,
    /// Ordem da lista: valor da UF na oportunidade; valor da unidade nas outras classes.
    chave: i64,
    proprio: i64,
    valor_uf: i64,
    json: Value,
}

struct ContextoDeItens<'a> {
    sig: &'a Consulta,
    comp: Competencia,
    estados: &'a HashMap<String, EstadoDetalhado>,
    sia: &'a Totais,
    sih: &'a Totais,
    uf_sia: &'a HashMap<String, sa_query::faturamento::TotalUf>,
    uf_sih: &'a HashMap<String, sa_query::faturamento::TotalUf>,
    vigentes: &'a HashMap<String, sa_query::faturamento::ValoresProcedimento>,
}

/// Classifica cada procedimento que a unidade produz ou poderia produzir.
fn itens_de_aptidao(c: &ContextoDeItens) -> Vec<ItemDeAptidao> {
    let (sig, comp, estados, sia, sih, uf_sia, uf_sih, vigentes) = (
        c.sig, c.comp, c.estados, c.sia, c.sih, c.uf_sia, c.uf_sih, c.vigentes,
    );
    let todos: BTreeSet<&String> = estados.keys().chain(sia.keys()).chain(sih.keys()).collect();
    let mut saida = Vec::new();
    for proc_ in todos {
        let produziu = sia.contains_key(proc_) || sih.contains_key(proc_);
        let est = estados.get(proc_).copied();
        let (classe, motivo) = if produziu && !vigentes.contains_key(proc_) {
            ("produz_fora_da_tabela", None)
        } else if let Some(x) = classificar_procedimento(est, produziu) {
            x
        } else {
            continue;
        };
        let (s, h) = (
            sia.get(proc_).copied().unwrap_or((0, 0)),
            sih.get(proc_).copied().unwrap_or((0, 0)),
        );
        let (us, uh) = (uf_sia.get(proc_), uf_sih.get(proc_));
        let valor_uf = us.map_or(0, |t| t.valor_centavos) + uh.map_or(0, |t| t.valor_centavos);
        let proprio = s.1 + h.1;
        let chave = if classe == "apta_nao_produz" {
            valor_uf
        } else {
            proprio
        };
        saida.push(ItemDeAptidao {
            classe,
            chave,
            proprio,
            valor_uf,
            json: json!({
                "codigo": proc_,
                "nome": nome_do(sig, comp, proc_),
                "classe": classe,
                "motivo": motivo,
                "estado": estado_texto(est),
                "sia": { "quantidade": s.0, "valor_centavos": s.1 },
                "sih": { "aih": h.0, "valor_centavos": h.1 },
                "uf": {
                    "produtores_sia": us.map_or(0, |t| t.produtores),
                    "produtores_sih": uh.map_or(0, |t| t.produtores),
                    "valor_centavos": valor_uf,
                },
            }),
        });
    }
    saida
}

const PAGINA_APTIDAO: usize = 50;

/// O que a produção traz para classificar os procedimentos de uma unidade.
struct ProducaoBruta {
    sia: Totais,
    sih: Totais,
    uf_sia: HashMap<String, sa_query::faturamento::TotalUf>,
    uf_sih: HashMap<String, sa_query::faturamento::TotalUf>,
    vigentes: HashMap<String, sa_query::faturamento::ValoresProcedimento>,
}

fn producao_bruta(
    q: &ConsultaProducao,
    sig: &Consulta,
    comp: Competencia,
    cnes: &str,
    j: &Janelas,
) -> Result<ProducaoBruta, String> {
    let e = |x: sa_query::ErroConsulta| x.to_string();
    let da_unidade = |o: Origem, meses: &[String]| -> Result<Totais, String> {
        Ok(q.da_unidade_na_janela(o, cnes, meses)
            .map_err(e)?
            .into_iter()
            .map(|(p, a, b)| (p, (a, b)))
            .collect())
    };
    Ok(ProducaoBruta {
        sia: da_unidade(Origem::Ambulatorial, &j.sia)?,
        sih: da_unidade(Origem::Hospitalar, &j.sih)?,
        uf_sia: q
            .uf_por_procedimento(Origem::Ambulatorial, &j.sia)
            .map_err(e)?,
        uf_sih: q
            .uf_por_procedimento(Origem::Hospitalar, &j.sih)
            .map_err(e)?,
        vigentes: sig.valores_dos_procedimentos(comp).map_err(e)?,
    })
}

/// Minúsculas e sem acento, para a busca por nome.
fn sem_acento(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        })
        .collect()
}

/// Resumo por grupo e, se pedido, a página de um grupo (busca, habilitação, ordem e paginação).
/// Os itens da página ganham `situacao`; `falta[]` é preenchido por quem tem acesso ao cadastro.
fn montar_aptidao(
    itens: &[ItemDeAptidao],
    grupo: Option<&str>,
    q: Option<&str>,
    hab: Option<&HashSet<String>>,
    desde: usize,
    so_produzidos_na_uf: bool,
) -> Value {
    let (mut r, mut o, mut ordem) = ((0usize, 0i64), (0usize, 0usize, 0i64), (0usize, 0i64));
    for it in itens {
        match grupo_da_classe(it.classe) {
            Some("risco") => (r.0, r.1) = (r.0 + 1, r.1 + it.proprio),
            Some("oportunidade") => {
                o = (
                    o.0 + 1,
                    o.1 + usize::from(it.valor_uf > 0),
                    o.2 + it.valor_uf,
                );
            }
            Some("ordem") => (ordem.0, ordem.1) = (ordem.0 + 1, ordem.1 + it.proprio),
            _ => {}
        }
    }
    let resumo = json!({
        "risco": { "procedimentos": r.0, "valor_da_unidade_centavos": r.1 },
        "oportunidade": { "procedimentos": o.0, "com_producao_na_uf": o.1, "valor_da_uf_centavos": o.2 },
        "ordem": { "procedimentos": ordem.0, "valor_da_unidade_centavos": ordem.1 },
    });
    let Some(id) = grupo.filter(|g| matches!(*g, "risco" | "oportunidade" | "ordem")) else {
        return json!({ "resumo": resumo, "grupo": null });
    };
    let busca = q.map(sem_acento).filter(|t| !t.trim().is_empty());
    let mut do_grupo: Vec<&ItemDeAptidao> = itens
        .iter()
        .filter(|it| grupo_da_classe(it.classe) == Some(id))
        .filter(|it| hab.is_none_or(|h| it.json["codigo"].as_str().is_some_and(|c| h.contains(c))))
        .filter(|it| {
            busca.as_ref().is_none_or(|t| {
                let texto = format!(
                    "{} {}",
                    it.json["codigo"].as_str().unwrap_or(""),
                    it.json["nome"].as_str().unwrap_or("")
                );
                sem_acento(&texto).contains(t.trim())
            })
        })
        .collect();
    let mut ninguem_produziu = None;
    if so_produzidos_na_uf && id == "oportunidade" {
        let antes = do_grupo.len();
        do_grupo.retain(|it| it.valor_uf > 0);
        ninguem_produziu = Some(antes - do_grupo.len());
    }
    do_grupo.sort_by(|a, b| {
        b.chave
            .cmp(&a.chave)
            .then_with(|| a.json["codigo"].as_str().cmp(&b.json["codigo"].as_str()))
    });
    let total = do_grupo.len();
    let pagina: Vec<Value> = do_grupo
        .into_iter()
        .skip(desde)
        .take(PAGINA_APTIDAO)
        .map(|it| {
            let mut v = it.json.clone();
            v["situacao"] = json!(situacao_do_item(it.classe, it.json["motivo"].as_str()));
            v["falta"] = json!([]);
            v
        })
        .collect();
    json!({
        "resumo": resumo,
        "grupo": {
            "id": id,
            "itens": pagina,
            "desde": desde,
            "itens_omitidos": total.saturating_sub(desde + PAGINA_APTIDAO),
            "total": total,
            "ninguem_produziu": ninguem_produziu,
        },
    })
}

/// Habilitações da unidade e a produção dos procedimentos que as citam.
fn habilitacoes_com_producao(
    habilitacoes: &[sa_query::cnes::HabilitacaoDaUnidade],
    mapa: &HashMap<String, Vec<String>>,
    sia: &Totais,
    sih: &Totais,
) -> Vec<Value> {
    let produzidos: BTreeSet<&String> = sia.keys().chain(sih.keys()).collect();
    habilitacoes
        .iter()
        .map(|h| {
            let exigidos = mapa.get(&h.codigo).map_or(&[][..], Vec::as_slice);
            let feitos: Vec<&String> = exigidos.iter().filter(|x| produzidos.contains(x)).collect();
            let valor: i64 = feitos
                .iter()
                .map(|x| sia.get(*x).map_or(0, |v| v.1) + sih.get(*x).map_or(0, |v| v.1))
                .sum();
            json!({
                "codigo": h.codigo,
                "nome": h.nome,
                "vigente": h.vigente,
                "inicio": h.inicio,
                "fim": h.fim,
                "portaria": h.portaria,
                "data_portaria": h.data_portaria,
                "programa_38": h.codigo.starts_with("38"),
                "procedimentos_que_citam": exigidos.len(),
                "procedimentos_produzidos": feitos.len(),
                "valor_centavos": valor,
            })
        })
        .collect()
}

/// A Aptidão da unidade: resumo por prioridade (Risco, Oportunidade, Em ordem), a lista de um grupo
/// e as habilitações com a produção dos procedimentos que as citam. Sem a produção carregada, devolve
/// só as oportunidades pelo cadastro (`sem_producao`).
#[allow(clippy::too_many_arguments)]
pub fn aptidao_da_unidade(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    alvo: Option<(&str, &str)>,
    grupo: Option<&str>,
    q: Option<&str>,
    hab: Option<&str>,
    desde: usize,
    so_produzidos_na_uf: bool,
) -> Result<Value, String> {
    let (uf, cnes) = alvo_da_unidade(p, alvo)?;
    let c = consulta_cnes(p, &uf)?;
    let estados = c
        .estados_detalhados(sig, comp, &cnes)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("o CNES {cnes} não está no cadastro de {uf} carregado"))?;
    let e = |x: sa_query::ErroConsulta| x.to_string();
    let mapa = sa_query::cnes::ConsultaCnes::procedimentos_por_habilitacao(sig, comp).map_err(e)?;
    let do_filtro: Option<HashSet<String>> = hab.map(|h| {
        mapa.get(h)
            .map(|v| v.iter().cloned().collect())
            .unwrap_or_default()
    });

    let producao = consulta_producao(p, &uf).ok();
    let (mut base, bruta) = match &producao {
        Some(pq) => {
            let (j, base) = janelas(pq)?;
            (base, producao_bruta(pq, sig, comp, &cnes, &j)?)
        }
        None => (
            json!({}),
            ProducaoBruta {
                sia: Totais::new(),
                sih: Totais::new(),
                uf_sia: HashMap::new(),
                uf_sih: HashMap::new(),
                vigentes: HashMap::new(),
            },
        ),
    };
    let ctx = ContextoDeItens {
        sig,
        comp,
        estados: &estados,
        sia: &bruta.sia,
        sih: &bruta.sih,
        uf_sia: &bruta.uf_sia,
        uf_sih: &bruta.uf_sih,
        vigentes: &bruta.vigentes,
    };
    let itens = itens_de_aptidao(&ctx);
    let mut saida = montar_aptidao(
        &itens,
        grupo,
        q,
        do_filtro.as_ref(),
        desde,
        so_produzidos_na_uf,
    );

    // O que falta, só para os itens da página que a unidade produz sem aptidão plena.
    if let Some(lista) = saida
        .get_mut("grupo")
        .and_then(|g| g.get_mut("itens"))
        .and_then(Value::as_array_mut)
    {
        for it in lista {
            let precisa = matches!(
                it["classe"].as_str(),
                Some("produz_sem_aptidao" | "produz_com_ressalva")
            );
            if !precisa {
                continue;
            }
            let codigo = it["codigo"].as_str().unwrap_or_default().to_string();
            let a = c.aptidao(sig, comp, &codigo, &cnes).map_err(e)?;
            let a = serde_json::to_value(&a).map_err(|x| x.to_string())?;
            it["falta"] = json!(faltas_da_aptidao(&a));
        }
    }

    let sem_producao = producao.is_none();
    if sem_producao {
        saida["resumo"]["risco"] = Value::Null;
        saida["resumo"]["ordem"] = Value::Null;
    }
    let u = c.unidade(sig, comp, &cnes).map_err(e)?;
    base["disponivel"] = json!(true);
    base["uf"] = json!(uf);
    base["cnes"] = json!(cnes);
    base["sem_producao"] = json!(sem_producao);
    base["resumo"] = saida["resumo"].take();
    base["grupo"] = saida["grupo"].take();
    base["habilitacoes"] = match u {
        None => Value::Null,
        Some(u) => json!(habilitacoes_com_producao(
            &u.habilitacoes,
            &mapa,
            &bruta.sia,
            &bruta.sih
        )),
    };
    base["avisos"] = json!({
        "producao": AVISO_FATURAMENTO,
        "terceirizados": sa_query::cnes::AVISO_TERCEIRIZADOS,
        "programa_38": "Habilitações 38.xx (programa \"Agora Tem Especialistas\") não foram condição para a aprovação na produção real de MS (07/2026); por isso aparecem à parte (motivo so_38).",
        "oportunidade": "\"Apta e não produz\" lista só procedimentos com exigência de habilitação ou serviço; o valor é o produzido por todos na UF na janela, não o que a unidade receberia.",
        "habilitacoes": "Procedimentos que citam a habilitação como exigência (pode haver outras alternativas de habilitação). Um procedimento citado por duas habilitações da unidade conta nas duas.",
    });
    Ok(base)
}

/// Os procedimentos da unidade diante da regra de aptidão e da produção: o que produz e pode, o que
/// pode e não produz (oportunidade), e o que produz sem o cadastro mostrar aptidão (com o motivo).
pub fn procedimentos_com_producao(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    alvo: Option<(&str, &str)>,
) -> Result<Value, String> {
    let (uf, cnes) = alvo_da_unidade(p, alvo)?;
    let Ok(q) = consulta_producao(p, &uf) else {
        return Ok(indisponivel(&uf));
    };
    let c = consulta_cnes(p, &uf)?;
    let estados = c
        .estados_detalhados(sig, comp, &cnes)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("o CNES {cnes} não está no cadastro de {uf} carregado"))?;
    let (j, mut saida) = janelas(&q)?;
    let e = |x: sa_query::ErroConsulta| x.to_string();
    let ProducaoBruta {
        sia,
        sih,
        uf_sia,
        uf_sih,
        vigentes,
    } = producao_bruta(&q, sig, comp, &cnes, &j)?;
    // classe -> (linhas, valor produzido pela unidade, quantidade)
    let mut linhas: HashMap<&'static str, Vec<(i64, Value)>> = HashMap::new();
    let mut resumo: HashMap<&'static str, (usize, i64)> = HashMap::new();
    // Dos "aptos que não produz", quantos a UF produz (os demais ninguém produziu nos meses completos).
    let mut oportunidades_com_producao = 0usize;
    let ctx = ContextoDeItens {
        sig,
        comp,
        estados: &estados,
        sia: &sia,
        sih: &sih,
        uf_sia: &uf_sia,
        uf_sih: &uf_sih,
        vigentes: &vigentes,
    };
    for it in itens_de_aptidao(&ctx) {
        let r = resumo.entry(it.classe).or_default();
        r.0 += 1;
        r.1 += it.proprio;
        if it.classe == "apta_nao_produz" && it.valor_uf > 0 {
            oportunidades_com_producao += 1;
        }
        linhas
            .entry(it.classe)
            .or_default()
            .push((it.chave, it.json));
    }
    let mut classes = json!({});
    for (classe, mut v) in linhas {
        v.sort_by_key(|x| std::cmp::Reverse(x.0));
        let total = v.len();
        let (n, valor) = resumo.get(classe).copied().unwrap_or_default();
        classes[classe] = json!({
            "procedimentos": n,
            "valor_da_unidade_centavos": valor,
            "itens": v.into_iter().take(LIMITE_CLASSE).map(|x| x.1).collect::<Vec<_>>(),
            "omitidos": total.saturating_sub(LIMITE_CLASSE),
        });
        if classe == "apta_nao_produz" {
            classes[classe]["com_producao_na_uf"] = json!(oportunidades_com_producao);
        }
    }
    saida["disponivel"] = json!(true);
    saida["uf"] = json!(uf);
    saida["cnes"] = json!(cnes);
    saida["classes"] = classes;
    saida["aviso"] = json!(AVISO_FATURAMENTO);
    saida["aviso_terceirizados"] = json!(sa_query::cnes::AVISO_TERCEIRIZADOS);
    saida["aviso_38"] = json!(
        "Habilitações 38.xx (programa \"Agora Tem Especialistas\") não foram condição para a aprovação na produção real de MS (07/2026); por isso aparecem à parte (motivo so_38)."
    );
    saida["oportunidade"] = json!(
        "\"Apta e não produz\" lista só procedimentos com exigência de habilitação ou serviço; o valor é o produzido por todos na UF na janela, não uma previsão para a unidade."
    );

    // Habilitações da unidade e a produção dos procedimentos que as citam.
    let u = c.unidade(sig, comp, &cnes).map_err(e)?;
    let mapa = sa_query::cnes::ConsultaCnes::procedimentos_por_habilitacao(sig, comp).map_err(e)?;
    let produzidos: BTreeSet<&String> = sia.keys().chain(sih.keys()).collect();
    saida["habilitacoes"] = match u {
        None => Value::Null,
        Some(u) => json!(
            u.habilitacoes
                .iter()
                .filter(|h| h.vigente)
                .map(|h| {
                    let exigidos = mapa.get(&h.codigo).map_or(&[][..], Vec::as_slice);
                    let feitos: Vec<&String> =
                        exigidos.iter().filter(|x| produzidos.contains(x)).collect();
                    let valor: i64 = feitos
                        .iter()
                        .map(|x| sia.get(*x).map_or(0, |v| v.1) + sih.get(*x).map_or(0, |v| v.1))
                        .sum();
                    json!({
                        "codigo": h.codigo,
                        "nome": h.nome,
                        "programa_38": h.codigo.starts_with("38"),
                        "procedimentos_que_citam": exigidos.len(),
                        "procedimentos_produzidos": feitos.len(),
                        "valor_centavos": valor,
                    })
                })
                .collect::<Vec<_>>()
        ),
    };
    saida["habilitacoes_aviso"] = json!(
        "Procedimentos que citam a habilitação como exigência (pode haver outras alternativas de habilitação). Um procedimento citado por duas habilitações da unidade conta nas duas."
    );
    Ok(saida)
}

/// Um procedimento visto pelo faturista: série mensal na UF, tendência, concentração, valor médio,
/// financiamento, apresentado × aprovado e quando o valor da tabela mudou. A UF é a da unidade
/// ativa (ou `uf`).
pub fn faturamento_do_procedimento(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    procedimento: &str,
    uf: Option<&str>,
) -> Result<Value, String> {
    let uf = match uf {
        Some(u) => {
            exigir_uf(u)?;
            u.to_string()
        }
        None => crate::minha(p).map(|(u, _)| u).ok_or_else(|| {
            "nenhuma unidade escolhida. Escolha a sua unidade em Minha unidade".to_string()
        })?,
    };
    let Ok(q) = consulta_producao(p, &uf) else {
        return Ok(indisponivel(&uf));
    };
    let cod = sa_query::ficha::normalizar_codigo(procedimento).map_err(|e| e.to_string())?;
    let e = |x: sa_query::ErroConsulta| x.to_string();
    let (j, mut saida) = janelas(&q)?;
    let nomes = nomes_financiamento(sig, comp);
    let carregadas: BTreeSet<String> = sig
        .competencias()
        .map_err(e)?
        .into_iter()
        .map(|c| c.competencia)
        .collect();
    let tabela_em = |m: &str| -> Option<sa_query::faturamento::ValoresProcedimento> {
        let c = Competencia::de_texto(m).ok()?;
        carregadas
            .contains(m)
            .then(|| sig.valores_do_procedimento(c, &cod).ok().flatten())
            .flatten()
    };

    for origem in [Origem::Ambulatorial, Origem::Hospitalar] {
        let (meses, cob) = match origem {
            Origem::Ambulatorial => (&j.sia, "sia"),
            Origem::Hospitalar => (&j.sih, "sih"),
        };
        let serie = q.serie_do_procedimento(origem, &cod).map_err(e)?;
        let completos: Vec<&sa_query::faturamento::MesProcedimento> = serie
            .iter()
            .filter(|m| meses.contains(&m.competencia))
            .collect();
        let qtd: i64 = completos.iter().map(|m| m.quantidade).sum();
        let valor: i64 = completos.iter().map(|m| m.valor_centavos).sum();
        let valores: Vec<i64> = meses
            .iter()
            .map(|c| {
                serie
                    .iter()
                    .find(|m| &m.competencia == c)
                    .map_or(0, |m| m.valor_centavos)
            })
            .collect();
        let prod = q.produtores(origem, &cod, 15).map_err(e)?;
        let top3: i64 = prod.lista.iter().take(3).map(|x| x.quantidade).sum();
        let mut dado = json!({
            "serie": serie.iter().map(|m| {
                let mut x = serde_json::to_value(m).unwrap_or_default();
                x["completo"] = json!(meses.contains(&m.competencia));
                // Só o SIA tem comparação com a tabela: o valor da AIH inclui OPM, UTI e outros
                // procedimentos, não só o do procedimento principal.
                if matches!(origem, Origem::Ambulatorial) {
                    let t = tabela_em(&m.competencia);
                    x["tabela_sa_centavos"] = json!(t.as_ref().map(|t| t.sa));
                    x["esperado_centavos"] = json!(t.as_ref().map(|t| t.sa * m.quantidade));
                }
                x
            }).collect::<Vec<_>>(),
            "meses_na_janela": meses.len(),
            "quantidade_na_janela": qtd,
            "valor_na_janela_centavos": valor,
            "valor_medio_centavos": (qtd > 0).then(|| valor / qtd),
            "tendencia": tendencia(&valores),
            "estabelecimentos_na_janela": serie.iter().filter(|m| meses.contains(&m.competencia)).map(|m| m.estabelecimentos).max().unwrap_or(0),
            "concentracao_top3_percentual": (prod.quantidade > 0).then(|| top3 as f64 * 100.0 / prod.quantidade as f64),
            "financiamento": financiamento_json(q.por_financiamento(origem, Some(&cod), None, meses).map_err(e)?, &nomes),
        });
        if matches!(origem, Origem::Hospitalar) {
            dado["aviso_valor"] = json!(
                "Valor médio da AIH (inclui OPM, UTI e outros procedimentos). Não é comparável ao valor do procedimento na tabela."
            );
        }
        saida[cob] = dado;
    }

    // Quando o valor da tabela mudou entre meses seguidos da produção carregada.
    let mut meses_prod: BTreeSet<String> = BTreeSet::new();
    for origem in [Origem::Ambulatorial, Origem::Hospitalar] {
        for m in q.serie_do_procedimento(origem, &cod).map_err(e)? {
            meses_prod.insert(m.competencia);
        }
    }
    let mut eventos = Vec::new();
    let mut anterior: Option<(String, Option<sa_query::faturamento::ValoresProcedimento>)> = None;
    for m in &meses_prod {
        let atual = tabela_em(m);
        if let Some((ma, antes)) = &anterior
            && carregadas.contains(m)
            && carregadas.contains(ma)
            && *antes != atual
        {
            eventos.push(json!({
                "competencia": m,
                "antes": antes,
                "depois": atual,
            }));
        }
        anterior = Some((m.clone(), atual));
    }
    saida["eventos_da_tabela"] = json!(eventos);
    saida["tabela"] = json!(sig.valores_do_procedimento(comp, &cod).map_err(e)?);
    saida["disponivel"] = json!(true);
    saida["uf"] = json!(uf);
    saida["procedimento"] = json!(cod);
    saida["aviso"] = json!(AVISO_FATURAMENTO);
    saida["sem_campos_novos"] = json!(q.sem_campos_novos().map_err(e)?);
    Ok(saida)
}

/// Meses (AAAAMM) como texto `MM/AAAA`.
fn rotulo(c: &str) -> String {
    if c.len() == 6 {
        format!("{}/{}", &c[4..], &c[..4])
    } else {
        c.to_string()
    }
}

/// Impacto financeiro estimado das mudanças da tabela (de `de` para `para`) sobre a produção da UF
/// e da unidade. Estimativa: quantidade produzida nos meses completos × diferença de valor, levada a
/// 12 meses. No SIH usa só o valor do procedimento principal (SH + SP).
pub fn impacto_das_mudancas(
    p: &Pastas,
    sig: &Consulta,
    de: Option<Competencia>,
    para: Competencia,
    alvo: Option<(&str, &str)>,
) -> Result<Value, String> {
    let de = match de {
        Some(d) => d,
        None => {
            let cs = sig.competencias().map_err(|e| e.to_string())?;
            let pos = cs
                .iter()
                .position(|c| c.competencia == para.to_string())
                .ok_or_else(|| format!("competência {para} não carregada"))?;
            if pos == 0 {
                return Err(format!(
                    "não há competência carregada antes de {para}. Baixe o histórico em Módulos e dados para comparar."
                ));
            }
            Competencia::de_texto(&cs[pos - 1].competencia).map_err(|e| e.to_string())?
        }
    };
    let (uf, cnes) = match alvo {
        Some((u, c)) => {
            exigir_uf(u)?;
            (u.to_string(), Some(c.to_string()))
        }
        None => match crate::minha(p) {
            Some((u, c)) => (u, Some(c)),
            None => {
                return Ok(json!({
                    "disponivel": false,
                    "mensagem": "Escolha a sua unidade em Minha unidade (ou baixe a produção de uma UF) para ver o impacto estimado.",
                }));
            }
        },
    };
    let Ok(q) = consulta_producao(p, &uf) else {
        return Ok(indisponivel(&uf));
    };
    let e = |x: sa_query::ErroConsulta| x.to_string();
    let (j, _) = janelas(&q)?;
    let uf_sia = q
        .uf_por_procedimento(Origem::Ambulatorial, &j.sia)
        .map_err(e)?;
    let uf_sih = q
        .uf_por_procedimento(Origem::Hospitalar, &j.sih)
        .map_err(e)?;
    let (u_sia, u_sih): (Totais, Totais) = match &cnes {
        Some(c) => (
            q.da_unidade_na_janela(Origem::Ambulatorial, c, &j.sia)
                .map_err(e)?
                .into_iter()
                .map(|(p, a, b)| (p, (a, b)))
                .collect(),
            q.da_unidade_na_janela(Origem::Hospitalar, c, &j.sih)
                .map_err(e)?
                .into_iter()
                .map(|(p, a, b)| (p, (a, b)))
                .collect(),
        ),
        None => (HashMap::new(), HashMap::new()),
    };
    // Leva a janela a 12 meses.
    let anual = |valor: i128, meses: usize| -> i64 {
        if meses == 0 {
            0
        } else {
            i64::try_from(valor * 12 / meses as i128).unwrap_or(i64::MAX)
        }
    };
    let (ns, nh) = (j.sia.len(), j.sih.len());
    let estados_unidade = match (&cnes, consulta_cnes(p, &uf)) {
        (Some(c), Ok(cn)) => cn.estados_detalhados(sig, para, c).ok().flatten(),
        _ => None,
    };
    let mut valores = Vec::new();
    let (mut total_uf, mut total_unidade) = (0i64, 0i64);
    for m in sig.mudancas_de_valor(de, para).map_err(e)? {
        let d_sa = i128::from(m.depois.sa - m.antes.sa);
        let d_h = i128::from(m.depois.hospitalar() - m.antes.hospitalar());
        let q_sia = uf_sia.get(&m.procedimento).map_or(0, |t| t.quantidade);
        let q_sih = uf_sih.get(&m.procedimento).map_or(0, |t| t.quantidade);
        let imp_uf = anual(d_sa * i128::from(q_sia), ns) + anual(d_h * i128::from(q_sih), nh);
        let u_q_sia = u_sia.get(&m.procedimento).map_or(0, |t| t.0);
        let u_q_sih = u_sih.get(&m.procedimento).map_or(0, |t| t.0);
        let imp_un = anual(d_sa * i128::from(u_q_sia), ns) + anual(d_h * i128::from(u_q_sih), nh);
        total_uf += imp_uf;
        total_unidade += imp_un;
        let produz = u_q_sia > 0 || u_q_sih > 0;
        let apta = estados_unidade.as_ref().map(|mapa| {
            matches!(
                mapa.get(&m.procedimento).map(|e| e.estado),
                Some(Estado::Apta | Estado::Ressalva)
            )
        });
        valores.push((
            imp_uf.unsigned_abs(),
            json!({
                "procedimento": m.procedimento,
                "nome": nome_do(sig, para, &m.procedimento),
                "antes": m.antes,
                "depois": m.depois,
                "quantidade_sia_uf": q_sia,
                "aih_uf": q_sih,
                "impacto_uf_anual_centavos": imp_uf,
                "unidade_produz": produz,
                "unidade_apta": apta,
                "afeta": afeta(produz, apta),
                "impacto_unidade_anual_centavos": imp_un,
            }),
        ));
    }
    valores.sort_by_key(|x| std::cmp::Reverse(x.0));
    let com_producao = valores.iter().filter(|x| x.0 > 0).count();

    // Excluídos e exigências novas: quem produzia.
    let produziu_uf = |proc_: &str| -> (u64, i64) {
        let a = uf_sia.get(proc_);
        let h = uf_sih.get(proc_);
        (
            a.map_or(0, |t| t.produtores)
                .max(h.map_or(0, |t| t.produtores)),
            a.map_or(0, |t| t.valor_centavos) + h.map_or(0, |t| t.valor_centavos),
        )
    };
    let unidade_produz =
        |proc_: &str| -> bool { u_sia.contains_key(proc_) || u_sih.contains_key(proc_) };
    let excluidos: Vec<Value> = sig
        .procedimentos_excluidos(de, para)
        .map_err(e)?
        .into_iter()
        .filter_map(|proc_| {
            let (n, valor) = produziu_uf(&proc_);
            (n > 0).then(|| {
                json!({
                    "procedimento": proc_,
                    "nome": nome_do(sig, de, &proc_),
                    "produtores_na_uf": n,
                    "valor_uf_janela_centavos": valor,
                    "unidade_produz": unidade_produz(&proc_),
                })
            })
        })
        .collect();
    let novas = sig.exigencias_novas(de, para).map_err(e)?;
    let mut exigencias: Vec<(i64, Value)> = novas
        .into_iter()
        .filter_map(|nova| {
            let proc_ = nova.procedimento;
            let (n, valor) = produziu_uf(&proc_);
            (n > 0).then(|| {
                let est = estados_unidade
                    .as_ref()
                    .and_then(|m| m.get(&proc_))
                    .copied();
                (
                    valor,
                    json!({
                        "procedimento": proc_,
                        "antes_sem_exigencia": nova.antes_sem_exigencia,
                        "nome": nome_do(sig, para, &proc_),
                        "produtores_na_uf": n,
                        "valor_uf_janela_centavos": valor,
                        "unidade_produz": unidade_produz(&proc_),
                        "estado_da_unidade": estado_texto(est),
                    }),
                )
            })
        })
        .collect();
    exigencias.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(json!({
        "disponivel": true,
        "uf": uf,
        "cnes": cnes,
        "de": de.to_string(),
        "para": para.to_string(),
        "janela_sia": j.sia.iter().map(|c| rotulo(c)).collect::<Vec<_>>(),
        "janela_sih": j.sih.iter().map(|c| rotulo(c)).collect::<Vec<_>>(),
        "mudancas_de_valor": valores.len(),
        "mudancas_com_producao": com_producao,
        "impacto_uf_anual_centavos": total_uf,
        "impacto_unidade_anual_centavos": total_unidade,
        "valores": valores.into_iter().take(100).map(|x| x.1).collect::<Vec<_>>(),
        "excluidos_com_producao": excluidos,
        "exigencias_novas_com_producao": exigencias.iter().take(100).map(|x| x.1.clone()).collect::<Vec<_>>(),
        "exigencias_realmente_novas_com_producao": exigencias.iter().filter(|x| x.1["antes_sem_exigencia"] == json!(true)).count(),
        "aviso": "Estimativa: quantidade produzida nos meses completos × diferença de valor, levada a 12 meses. No SIH conta só o valor do procedimento principal (SH + SP); a AIH tem outros componentes. Não considera mudança de volume nem incrementos por habilitação.",
    }))
}

/// Participação mínima, e múltiplo da UF, a partir dos quais a parte reapresentada vira alerta.
const REAPRESENTACAO_MINIMA_PCT: f64 = 10.0;
const REAPRESENTACAO_VEZES_A_UF: f64 = 2.0;

/// Valor em reais no formato brasileiro: "R$ 1.234,56" (negativo com "−").
fn reais_br(centavos: i64) -> String {
    let c = centavos.unsigned_abs();
    let inteiro = (c / 100).to_string();
    let mut milhar = String::new();
    for (i, ch) in inteiro.chars().enumerate() {
        if i > 0 && (inteiro.len() - i).is_multiple_of(3) {
            milhar.push('.');
        }
        milhar.push(ch);
    }
    format!(
        "{}R$ {milhar},{:02}",
        if centavos < 0 { "−" } else { "" },
        c % 100
    )
}

/// Número com uma casa decimal e vírgula ("1,7").
fn dec1(x: f64) -> String {
    format!("{x:.1}").replace('.', ",")
}

/// Tira do texto do alerta a remissão a abas da interface antiga ("(ver a aba …)").
fn sem_remissao_a_abas(texto: &str) -> String {
    match texto.find(" (ver a aba ") {
        Some(i) => match texto[i..].find(')') {
            Some(f) => format!("{}{}", &texto[..i], &texto[i + f + 1..]),
            None => texto.to_string(),
        },
        None => texto.to_string(),
    }
}

/// Alertas que saem dos blocos de produção da Fase 4.5 (serviço fora do cadastro, reapresentação, permanência,
/// motivo de rejeição encerrado, regra sem geração de crédito), a partir do JSON da unidade. `(tipo, gravidade, texto)`.
fn alertas_de_perfil(f: &Value) -> Vec<(&'static str, &'static str, String)> {
    let mut v = Vec::new();
    let reais = reais_br;

    let sv = &f["servicos"];
    let fora = sv["fora_do_cadastro_centavos"].as_i64().unwrap_or(0);
    if fora > 0 {
        let n = sv["itens"].as_array().map_or(0, |a| {
            a.iter()
                .filter(|x| x["situacao"] == json!("fora_do_cadastro"))
                .count()
        });
        v.push((
            "servico_fora_do_cadastro",
            "atencao",
            format!(
                "{} apresentados em {n} serviço(s)/classificação que o CNES da unidade não tem cadastrados (ver a aba Produção da unidade).",
                reais(fora)
            ),
        ));
    }

    let r = &f["reapresentacao"];
    if let (Some(a), Some(t), Some(ua), Some(ut)) = (
        r["anteriores_centavos"].as_i64(),
        r["total_centavos"].as_i64(),
        r["uf_anteriores_centavos"].as_i64(),
        r["uf_total_centavos"].as_i64(),
    ) && t > 0
        && ut > 0
    {
        let minha = a as f64 * 100.0 / t as f64;
        let da_uf = ua as f64 * 100.0 / ut as f64;
        if minha >= REAPRESENTACAO_MINIMA_PCT && minha >= REAPRESENTACAO_VEZES_A_UF * da_uf {
            v.push((
                "reapresentacao_alta",
                "atencao",
                format!(
                    "{}% do valor apresentado no SIA é de meses anteriores (na UF: {}%). Pode ser atraso no envio ou reapresentação de produção recusada.",
                    dec1(minha),
                    dec1(da_uf)
                ),
            ));
        }
    }

    let fora_prev = f["permanencia"]["fora_do_previsto"].as_u64().unwrap_or(0);
    if fora_prev > 0 {
        v.push((
            "permanencia_fora_do_previsto",
            "info",
            format!(
                "{fora_prev} procedimento(s) com permanência média bem diferente da prevista no SIGTAP (ver a aba Produção da unidade)."
            ),
        ));
    }

    let encerrados = f["rejeicoes"]["motivos"].as_array().map_or(0, |m| {
        m.iter().filter(|x| x["encerrado"] == json!(true)).count()
    });
    if encerrados > 0 {
        v.push((
            "motivo_de_rejeicao_encerrado",
            "atencao",
            format!(
                "{encerrados} dos principais motivos de rejeição já não constam como vigentes na tabela oficial de críticas do SIH: confira a descrição no retorno da AIH."
            ),
        ));
    }

    let sem_credito: Vec<&str> = f["perfil"]["marcas"]
        .as_array()
        .map(|m| {
            m.iter()
                .filter(|x| x["sem_credito"] == json!(true) && x["vigente"] == json!(true))
                .filter_map(|x| x["codigo"].as_str())
                .collect()
        })
        .unwrap_or_default();
    if !sem_credito.is_empty() {
        v.push((
            "regra_sem_geracao_de_credito",
            "info",
            format!(
                "A unidade tem regra contratual de não geração de crédito vigente ({}): parte da produção não gera crédito para o gestor.",
                sem_credito.join(", ")
            ),
        ));
    }
    v
}

/// Título curto de cada tipo de alerta; a queda de valor leva o sistema.
fn titulo_da_pendencia(tipo: &str, sistema: Option<&str>) -> String {
    let nome_sistema = if sistema == Some("sih") { "SIH" } else { "SIA" };
    match tipo {
        "queda_de_valor" => format!("Valor aprovado do {nome_sistema} em queda"),
        "apresentado_maior_que_aprovado" => "Apresentado acima do aprovado".into(),
        "servico_fora_do_cadastro" => "Serviço fora do cadastro do CNES".into(),
        "reapresentacao_alta" => "Reapresentação acima da UF".into(),
        "quantidade_atipica" => "Quantidade apresentada atípica".into(),
        "produz_sem_aptidao" => "Produz sem aptidão no cadastro".into(),
        "produz_com_ressalva" => "Produz sem o serviço no cadastro".into(),
        "rejeicao_acima_dos_pares" => "Rejeições acima dos pares".into(),
        "permanencia_fora_do_previsto" => "Permanência fora do previsto".into(),
        "motivo_de_rejeicao_encerrado" => "Motivo de rejeição encerrado".into(),
        "regra_sem_geracao_de_credito" => "Regra sem geração de crédito".into(),
        "habilitacao_sem_producao" => "Habilitação sem produção".into(),
        "mes_incompleto" => "Mês incompleto na fonte".into(),
        "baixar_de_novo" => "Produção a baixar de novo".into(),
        outro => outro.replace('_', " "),
    }
}

/// Valor envolvido, perda estimada e itens de uma pendência, a partir do JSON da unidade.
fn valor_da_pendencia(
    tipo: &str,
    sistema: Option<&str>,
    f: &Value,
    pr: Option<&Value>,
) -> (Option<i64>, Option<Value>, Vec<Value>) {
    let classe = |nome: &str| -> (Option<i64>, Vec<Value>) {
        let c = &pr.map_or(Value::Null, |p| p["classes"][nome].clone());
        let valor = c["valor_da_unidade_centavos"].as_i64().filter(|v| *v > 0);
        let mut itens: Vec<(i64, Value)> = c["itens"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| {
                        let v = x["sia"]["valor_centavos"].as_i64().unwrap_or(0)
                            + x["sih"]["valor_centavos"].as_i64().unwrap_or(0);
                        (v, json!({ "codigo": x["codigo"], "nome": x["nome"], "valor_centavos": v }))
                    })
                    .collect()
            })
            .unwrap_or_default();
        itens.sort_by_key(|x| std::cmp::Reverse(x.0));
        (valor, itens.into_iter().take(10).map(|x| x.1).collect())
    };
    match tipo {
        "queda_de_valor" => {
            let k = if sistema == Some("sih") {
                "sih_valor"
            } else {
                "sia_valor"
            };
            let t = &f["tendencia"][k];
            match (t["media_anterior"].as_f64(), t["media_recente"].as_f64()) {
                (Some(ant), Some(rec)) if ant - rec > 0.0 => {
                    let d = ant - rec;
                    (
                        Some((d * 3.0).round() as i64),
                        Some(json!({
                            "centavos": (d * 12.0).round() as i64,
                            "horizonte_meses": 12,
                            "premissa": "se a queda se mantiver",
                        })),
                        Vec::new(),
                    )
                }
                _ => (None, None, Vec::new()),
            }
        }
        "apresentado_maior_que_aprovado" => {
            let a = f["apresentado"]["valor_apresentado_centavos"].as_i64();
            let b = f["apresentado"]["valor_aprovado_centavos"].as_i64();
            (
                a.zip(b).map(|(a, b)| a - b).filter(|v| *v > 0),
                None,
                Vec::new(),
            )
        }
        "servico_fora_do_cadastro" => (
            f["servicos"]["fora_do_cadastro_centavos"]
                .as_i64()
                .filter(|v| *v > 0),
            None,
            Vec::new(),
        ),
        "reapresentacao_alta" => (
            f["reapresentacao"]["anteriores_centavos"]
                .as_i64()
                .filter(|v| *v > 0),
            None,
            Vec::new(),
        ),
        "quantidade_atipica" => {
            let itens: Vec<Value> = f["apresentado"]["atipicas"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|x| json!({
                            "codigo": x["procedimento"], "nome": x["nome"],
                            "valor_centavos": x["valor_apresentado_centavos"].as_i64().unwrap_or(0),
                        }))
                        .collect()
                })
                .unwrap_or_default();
            let soma: i64 = itens
                .iter()
                .map(|x| x["valor_centavos"].as_i64().unwrap_or(0))
                .sum();
            (
                (soma > 0).then_some(soma),
                None,
                itens.into_iter().take(10).collect(),
            )
        }
        "produz_sem_aptidao" => {
            let (v, i) = classe("produz_sem_aptidao");
            (v, None, i)
        }
        "produz_com_ressalva" => {
            let (v, i) = classe("produz_com_ressalva");
            (v, None, i)
        }
        _ => (None, None, Vec::new()),
    }
}

/// De onde vem o número: fonte, competências, conta e o que ela não prova.
fn origem_da_pendencia(tipo: &str, sistema: Option<&str>, f: &Value) -> Value {
    let (fonte, chave) = if sistema == Some("sih") {
        ("SIH", "sih")
    } else {
        ("SIA", "sia")
    };
    let competencias = f["janela"][chave].clone();
    let (fonte, competencias, conta, nao_prova) = match tipo {
        "queda_de_valor" => (
            fonte,
            competencias,
            "(média dos 3 meses anteriores − média dos 3 últimos) × 3 meses",
            "Não prova a causa da queda; mostra só a diferença de valor aprovado.",
        ),
        "apresentado_maior_que_aprovado" => (
            "SIA",
            f["janela"]["sia"].clone(),
            "valor apresentado − valor aprovado, nos meses carregados",
            "Não diz quanto será pago nem o motivo da glosa.",
        ),
        "servico_fora_do_cadastro" => (
            "SIA e CNES",
            f["janela"]["sia"].clone(),
            "soma do apresentado em serviços que o CNES da unidade não tem",
            "Não prova que o serviço não exista; o cadastro pode estar desatualizado.",
        ),
        "reapresentacao_alta" => (
            "SIA",
            f["janela"]["sia"].clone(),
            "valor apresentado de meses anteriores dentro da janela",
            "Não separa atraso de envio de reapresentação recusada.",
        ),
        "quantidade_atipica" => (
            "SIA",
            f["janela"]["sia"].clone(),
            "soma do apresentado nos procedimentos fora da série da unidade e dos pares",
            "Não prova erro; só aponta o que foge do padrão.",
        ),
        "rejeicao_acima_dos_pares"
        | "motivo_de_rejeicao_encerrado"
        | "permanencia_fora_do_previsto" => (
            "SIH",
            f["janela"]["sih"].clone(),
            "contagem e valor das AIH da unidade contra os pares e o previsto no SIGTAP",
            "Não prova erro da unidade; só aponta o que foge do padrão.",
        ),
        "produz_sem_aptidao" | "produz_com_ressalva" => (
            "SIA, SIH e CNES",
            f["janela"]["sia"].clone(),
            "valor produzido pela unidade nos procedimentos da classe",
            "Não diz se o cadastro está errado ou se o serviço é de terceiros.",
        ),
        _ => (fonte, competencias, "", ""),
    };
    json!({ "fonte": fonte, "competencias": competencias, "conta": conta, "nao_prova": nao_prova })
}

/// Transforma os alertas do painel em pendências: valor em R$, origem, itens e ordem por valor.
pub(crate) fn montar_pendencias(alertas: &[Value], f: &Value, pr: Option<&Value>) -> Vec<Value> {
    let mut v: Vec<(Option<i64>, u8, usize, Value)> = Vec::new();
    for (i, a) in alertas.iter().enumerate() {
        let tipo = a["tipo"].as_str().unwrap_or("");
        let sistema = a["sistema"].as_str();
        let gravidade = a["gravidade"].as_str().unwrap_or("info");
        let (valor, perda, itens) = valor_da_pendencia(tipo, sistema, f, pr);
        let id = match sistema {
            Some(s) => format!("{tipo}:{s}"),
            None => tipo.to_string(),
        };
        let tem_itens = !itens.is_empty();
        v.push((
            valor,
            u8::from(gravidade != "atencao"),
            i,
            json!({
                "id": id,
                "tipo": tipo,
                "gravidade": gravidade,
                "titulo": titulo_da_pendencia(tipo, sistema),
                "texto": sem_remissao_a_abas(a["texto"].as_str().unwrap_or("")),
                "valor_envolvido_centavos": valor,
                "perda_estimada": perda,
                "origem": origem_da_pendencia(tipo, sistema, f),
                "acao": { "rotulo": "Ver itens", "destino": if tem_itens { "itens" } else { "origem" } },
                "itens": itens,
            }),
        ));
    }
    v.sort_by(|a, b| {
        let (va, vb) = (a.0.unwrap_or(i64::MIN), b.0.unwrap_or(i64::MIN));
        vb.cmp(&va).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2))
    });
    v.into_iter().map(|x| x.3).collect()
}

/// Alerta da queda de valor aprovado de um sistema (`sistema`: "SIA" ou "SIH"; `queda_pct` positivo).
fn alerta_de_queda(sistema: &str, queda_pct: f64) -> Value {
    json!({
        "tipo": "queda_de_valor",
        "gravidade": "atencao",
        "sistema": sistema.to_lowercase(),
        "texto": format!(
            "O valor aprovado no {sistema} caiu {queda_pct:.0}% (3 últimos meses contra os 3 anteriores)."
        ),
    })
}

/// A unidade é afetada por um procedimento se produz ou está apta. Sem cadastro, só a produção conta.
fn afeta(produz: bool, apta: Option<bool>) -> bool {
    produz || apta == Some(true)
}

/// Marca cada item das tabelas com `co_procedimento` com `afeta` (e conta `afetam` por tabela). Com
/// `so_afeta`, deixa só os que afetam. Tabelas sem `co_procedimento` ficam como estão.
pub fn anotar_afeta(
    m: &mut Value,
    produzidos: &HashSet<String>,
    aptos: Option<&HashSet<String>>,
    so_afeta: bool,
) {
    let Some(tabelas) = m["tabelas"].as_array_mut() else {
        return;
    };
    for t in tabelas {
        let Some(itens) = t["itens"].as_array_mut() else {
            continue;
        };
        if !itens
            .iter()
            .any(|i| i["chave"]["co_procedimento"].is_string())
        {
            continue;
        }
        let mut afetam = 0usize;
        for i in itens.iter_mut() {
            let Some(cod) = i["chave"]["co_procedimento"].as_str().map(String::from) else {
                continue;
            };
            let a = afeta(produzidos.contains(&cod), aptos.map(|s| s.contains(&cod)));
            i["afeta"] = json!(a);
            afetam += usize::from(a);
        }
        if so_afeta {
            itens.retain(|i| i["afeta"] != json!(false));
        }
        t["afetam"] = json!(afetam);
    }
}

/// O que mudou entre `de` e `para`, com a marca `afeta` por procedimento para a unidade ativa.
/// Sem unidade escolhida, devolve o mesmo que `o_que_mudou`, sem marcas. Com `tabela`, devolve só
/// ela (no mesmo formato, com uma tabela).
pub fn mudancas_da_unidade(
    p: &Pastas,
    sig: &Consulta,
    de: Competencia,
    para: Competencia,
    tabela: Option<&str>,
    desde: usize,
    so_afeta: bool,
) -> Result<Value, String> {
    let e = |x: sa_query::ErroConsulta| x.to_string();
    let mut m = match tabela {
        Some(t) => {
            let t = sig
                .o_que_mudou_tabela(de, para, t, desde, sa_query::mudancas::LIMITE_ITENS)
                .map_err(e)?;
            json!({ "de": de.to_string(), "para": para.to_string(), "tabelas": [t] })
        }
        None => serde_json::to_value(
            sig.o_que_mudou(de, para, sa_query::mudancas::LIMITE_ITENS)
                .map_err(e)?,
        )
        .map_err(|x| x.to_string())?,
    };
    let Some((uf, cnes)) = crate::minha(p) else {
        m["unidade"] = json!(false);
        return Ok(m);
    };
    let mut produzidos: HashSet<String> = HashSet::new();
    if let Ok(q) = consulta_producao(p, &uf) {
        let (j, _) = janelas(&q)?;
        for (origem, janela) in [(Origem::Ambulatorial, &j.sia), (Origem::Hospitalar, &j.sih)] {
            for (proc_, _, _) in q.da_unidade_na_janela(origem, &cnes, janela).map_err(e)? {
                produzidos.insert(proc_);
            }
        }
    }
    let aptos: Option<HashSet<String>> = consulta_cnes(p, &uf)
        .ok()
        .and_then(|cn| cn.estados_detalhados(sig, para, &cnes).ok().flatten())
        .map(|mapa| {
            mapa.into_iter()
                .filter(|(_, e)| matches!(e.estado, Estado::Apta | Estado::Ressalva))
                .map(|(k, _)| k)
                .collect()
        });
    anotar_afeta(&mut m, &produzidos, aptos.as_ref(), so_afeta);
    m["unidade"] = json!(true);
    m["unidade_com_cadastro"] = json!(aptos.is_some());
    Ok(m)
}

/// Painel do faturista (tela de início): o resumo da unidade ativa com os alertas que merecem olhar.
pub fn painel_do_faturista(p: &Pastas, sig: &Consulta, comp: Competencia) -> Result<Value, String> {
    let Some((uf, cnes)) = crate::minha(p) else {
        return Ok(json!({
            "disponivel": false,
            "mensagem": "Escolha a sua unidade em Minha unidade para ver o painel do faturista.",
        }));
    };
    let alvo = Some((uf.as_str(), cnes.as_str()));
    let f = faturamento_da_unidade(p, sig, comp, alvo)?;
    if f["disponivel"] != json!(true) {
        return Ok(f);
    }
    let alertas: std::cell::RefCell<Vec<Value>> = std::cell::RefCell::new(Vec::new());
    let alerta = |tipo: &str, gravidade: &str, texto: String| {
        alertas
            .borrow_mut()
            .push(json!({ "tipo": tipo, "gravidade": gravidade, "texto": texto }));
    };

    // Último mês completo e variação.
    let meses = f["meses"].as_array().cloned().unwrap_or_default();
    let ultimo = |sistema: &str, campo_valor: &str, campo_qtd: &str| -> Value {
        let janela: Vec<String> = f["janela"][sistema]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let Some(ult) = janela.last() else {
            return Value::Null;
        };
        let v = |c: &str| -> Option<(i64, i64)> {
            meses
                .iter()
                .find(|m| m["competencia"] == json!(c))
                .map(|m| {
                    (
                        m[campo_valor].as_i64().unwrap_or(0),
                        m[campo_qtd].as_i64().unwrap_or(0),
                    )
                })
        };
        let atual = v(ult).unwrap_or((0, 0));
        let anterior = janela.len().checked_sub(2).and_then(|i| v(&janela[i]));
        let media3: Option<f64> = (janela.len() >= 4).then(|| {
            janela[janela.len() - 4..janela.len() - 1]
                .iter()
                .map(|c| v(c).map_or(0, |x| x.0) as f64)
                .sum::<f64>()
                / 3.0
        });
        json!({
            "competencia": ult,
            "valor_centavos": atual.0,
            "quantidade": atual.1,
            "variacao_mes_anterior": anterior.and_then(|a| (a.0 > 0).then(|| (atual.0 - a.0) as f64 * 100.0 / a.0 as f64)),
            "variacao_media_3_meses": media3.and_then(|m| (m > 0.0).then(|| (atual.0 as f64 - m) * 100.0 / m)),
        })
    };
    let sia = ultimo("sia", "sia_valor_centavos", "sia_quantidade");
    let sih = ultimo("sih", "sih_valor_centavos", "sih_aih");

    // Defasagem entre as fontes.
    let cobertura =
        |s: &str| -> Vec<Value> { f["cobertura"][s].as_array().cloned().unwrap_or_default() };
    for (nome, s) in [("SIA", "sia"), ("SIH", "sih")] {
        if let Some(u) = cobertura(s).last()
            && u["completo"] == json!(false)
        {
            alerta(
                "mes_incompleto",
                "info",
                format!(
                    "O {nome} de {} está incompleto ({} estabelecimentos): as análises de volume usam até o mês anterior.",
                    rotulo(u["competencia"].as_str().unwrap_or("")),
                    u["estabelecimentos"]
                ),
            );
            if let Some(ultimo) = alertas.borrow_mut().last_mut() {
                ultimo["sistema"] = json!(s);
            }
        }
    }
    if !f["sem_campos_novos"].as_array().is_none_or(Vec::is_empty) {
        alerta(
            "baixar_de_novo",
            "info",
            "Parte da produção foi baixada antes dos campos novos (apresentado, financiamento, dias de internação). Baixe de novo em Módulos e dados para ver esses números.".to_string(),
        );
    }

    // Rejeição acima dos pares.
    if let (Some(t), Some(m)) = (
        f["pares"]["taxa_da_unidade"].as_f64(),
        f["pares"]["taxa_mediana_dos_pares"].as_f64(),
    ) && m > 0.0
        && t > m * 1.5
        && f["rejeicoes"]["janela_aih"].as_i64().unwrap_or(0) >= MINIMO_AIH_PARA_TAXA
    {
        alerta(
            "rejeicao_acima_dos_pares",
            "atencao",
            format!(
                "Rejeições por 100 AIH: {} na unidade contra {} (mediana das unidades do mesmo tipo).",
                dec1(t),
                dec1(m)
            ),
        );
    }
    // Queda de valor.
    for (nome, k) in [("SIA", "sia_valor"), ("SIH", "sih_valor")] {
        if f["tendencia"][k]["sentido"] == json!("cai")
            && f["tendencia"][k]["variacao_percentual"]
                .as_f64()
                .unwrap_or(0.0)
                < -10.0
        {
            alertas.borrow_mut().push(alerta_de_queda(
                nome,
                -f["tendencia"][k]["variacao_percentual"]
                    .as_f64()
                    .unwrap_or(0.0),
            ));
        }
    }
    // Apresentado maior que o aprovado.
    if let (Some(a), Some(b)) = (
        f["apresentado"]["valor_apresentado_centavos"].as_i64(),
        f["apresentado"]["valor_aprovado_centavos"].as_i64(),
    ) && a > b
    {
        alerta(
            "apresentado_maior_que_aprovado",
            "atencao",
            format!(
                "No SIA, o apresentado passou do aprovado em {} nos meses carregados (ver a aba Produção da unidade).",
                reais_br(a - b)
            ),
        );
    }

    // Quantidade apresentada que foge da série da unidade e dos outros estabelecimentos.
    if let Some(a) = f["apresentado"]["atipicas"].as_array()
        && let Some(primeira) = a.first()
    {
        alerta(
            "quantidade_atipica",
            "atencao",
            format!(
                "{} procedimento(s) com quantidade apresentada muito acima da série da unidade e dos outros estabelecimentos. O maior: {} em {}, {} apresentados ({}). Confira se não é erro de digitação ou de lote (ver a aba Produção da unidade).",
                a.len(),
                primeira["procedimento"].as_str().unwrap_or(""),
                primeira["competencia"].as_str().unwrap_or(""),
                primeira["quantidade_apresentada"].as_i64().unwrap_or(0),
                reais_br(primeira["valor_apresentado_centavos"].as_i64().unwrap_or(0))
            ),
        );
    }

    for (tipo, gravidade, texto) in alertas_de_perfil(&f) {
        alerta(tipo, gravidade, texto);
    }

    // Procedimentos: oportunidades e produção sem aptidão.
    let mut oportunidades = Value::Null;
    let mut procedimentos_json: Option<Value> = None;
    if let Ok(pr) = procedimentos_com_producao(p, sig, comp, alvo)
        && pr["disponivel"] == json!(true)
    {
        let n = |c: &str, m: Option<&str>| -> usize {
            pr["classes"][c]["itens"].as_array().map_or(0, |v| {
                v.iter()
                    .filter(|x| m.is_none_or(|m| x["motivo"] == json!(m)))
                    .count()
            })
        };
        let sem_apt = pr["classes"]["produz_sem_aptidao"]["procedimentos"]
            .as_u64()
            .unwrap_or(0);
        if sem_apt > 0 {
            let so38 = n("produz_sem_aptidao", Some("so_38"));
            alerta(
                "produz_sem_aptidao",
                "atencao",
                format!(
                    "{sem_apt} procedimento(s) produzidos sem o cadastro do CNES mostrar aptidão ({so38} só por habilitação 38.xx). Confira o CNES: cadastro desatualizado ou serviço terceirizado."
                ),
            );
        }
        let ress = pr["classes"]["produz_com_ressalva"]["procedimentos"]
            .as_u64()
            .unwrap_or(0);
        if ress > 0 {
            alerta(
                "produz_com_ressalva",
                "info",
                format!(
                    "{ress} procedimento(s) produzidos em que falta só o serviço no cadastro (provável serviço terceirizado)."
                ),
            );
        }
        if let Some(h) = pr["habilitacoes"].as_array() {
            let sem: Vec<&Value> = h
                .iter()
                .filter(|x| {
                    x["programa_38"] == json!(false)
                        && x["procedimentos_que_citam"].as_u64().unwrap_or(0) > 0
                        && x["procedimentos_produzidos"].as_u64().unwrap_or(0) == 0
                })
                .collect();
            if !sem.is_empty() {
                alerta(
                    "habilitacao_sem_producao",
                    "atencao",
                    format!(
                        "{} habilitação(ões) vigentes sem nenhuma produção nos procedimentos que as citam (ver a aba Habilitações).",
                        sem.len()
                    ),
                );
            }
        }
        oportunidades = json!({
            "total": pr["classes"]["apta_nao_produz"]["com_producao_na_uf"],
            "itens": pr["classes"]["apta_nao_produz"]["itens"].as_array().map(|v| v.iter().filter(|x| x["uf"]["valor_centavos"].as_i64().unwrap_or(0) > 0).take(5).cloned().collect::<Vec<_>>()),
        });
        procedimentos_json = Some(pr);
    }

    let alertas = alertas.into_inner();
    let pendencias = montar_pendencias(&alertas, &f, procedimentos_json.as_ref());
    let mut v = json!({
        "disponivel": true,
        "uf": uf,
        "cnes": cnes,
        "aviso": AVISO_FATURAMENTO,
        "sia": sia,
        "sih": sih,
        "rejeicoes": {
            "por_100_aih": f["rejeicoes"]["por_100_aih"],
            "janela_rejeicoes": f["rejeicoes"]["janela_rejeicoes"],
            "janela_aih": f["rejeicoes"]["janela_aih"],
            "motivos": f["rejeicoes"]["motivos"].as_array().map(|m| m.iter().take(3).cloned().collect::<Vec<_>>()),
        },
        "tendencia": f["tendencia"],
        "pares": f["pares"],
        "oportunidades": oportunidades,
        "alertas": alertas,
        "pendencias": pendencias,
    });
    v["fontes"] = json!({
        "producao_sia_ate": f["janela"]["sia"].as_array().and_then(|a| a.last().cloned()),
        "producao_sih_ate": f["janela"]["sih"].as_array().and_then(|a| a.last().cloned()),
        "sigtap": comp.to_string(),
    });
    Ok(v)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn item(cod: &str, nome: &str, classe: &'static str, proprio: i64, uf: i64) -> ItemDeAptidao {
        let chave = if classe == "apta_nao_produz" {
            uf
        } else {
            proprio
        };
        ItemDeAptidao {
            classe,
            chave,
            proprio,
            valor_uf: uf,
            json: json!({ "codigo": cod, "nome": nome, "classe": classe, "motivo": null }),
        }
    }

    fn amostra() -> Vec<ItemDeAptidao> {
        vec![
            item(
                "0301010010",
                "Consulta de média complexidade",
                "produz_apta",
                500,
                900,
            ),
            item(
                "0302020020",
                "Fisioterapia de alta",
                "produz_sem_aptidao",
                300,
                700,
            ),
            item(
                "0303030030",
                "Ação de saúde",
                "produz_com_ressalva",
                800,
                100,
            ),
            item(
                "0404040040",
                "Cirurgia de catarata",
                "apta_nao_produz",
                0,
                5000,
            ),
            item("0505050050", "Terapia rara", "apta_nao_produz", 0, 0),
            item("0606060060", "Exame antigo", "produz_fora_da_tabela", 50, 0),
        ]
    }

    fn codigos(g: &Value) -> Vec<&str> {
        g["itens"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["codigo"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn resumo_soma_os_tres_grupos() {
        let r = montar_aptidao(&amostra(), None, None, None, 0, false)["resumo"].clone();
        assert_eq!(r["risco"]["procedimentos"], 3);
        assert_eq!(r["risco"]["valor_da_unidade_centavos"], 1150);
        assert_eq!(r["oportunidade"]["procedimentos"], 2);
        assert_eq!(r["oportunidade"]["com_producao_na_uf"], 1);
        assert_eq!(r["oportunidade"]["valor_da_uf_centavos"], 5000);
        assert_eq!(r["ordem"]["procedimentos"], 1);
        assert_eq!(r["ordem"]["valor_da_unidade_centavos"], 500);
    }

    #[test]
    fn sem_grupo_nao_traz_lista() {
        assert!(montar_aptidao(&amostra(), None, None, None, 0, false)["grupo"].is_null());
    }

    #[test]
    fn risco_e_ordem_vao_pelo_valor_da_unidade_e_oportunidade_pelo_da_uf() {
        let v = amostra();
        let r = montar_aptidao(&v, Some("risco"), None, None, 0, false);
        assert_eq!(
            codigos(&r["grupo"]),
            ["0303030030", "0302020020", "0606060060"]
        );
        let o = montar_aptidao(&v, Some("oportunidade"), None, None, 0, false);
        assert_eq!(codigos(&o["grupo"]), ["0404040040", "0505050050"]);
        assert_eq!(o["grupo"]["itens"][0]["situacao"], "apta");
        assert_eq!(r["grupo"]["itens"][1]["situacao"], "nao_apta");
    }

    #[test]
    fn busca_por_codigo_ou_nome_sem_acento_nem_maiuscula() {
        let v = amostra();
        let por_nome = montar_aptidao(&v, Some("risco"), Some("ACAO de saude"), None, 0, false);
        assert_eq!(codigos(&por_nome["grupo"]), ["0303030030"]);
        let por_codigo = montar_aptidao(&v, Some("risco"), Some("0302020"), None, 0, false);
        assert_eq!(codigos(&por_codigo["grupo"]), ["0302020020"]);
        assert_eq!(por_codigo["grupo"]["total"], 1);
        // o resumo não muda com a busca
        assert_eq!(por_codigo["resumo"]["risco"]["procedimentos"], 3);
    }

    #[test]
    fn habilitacao_filtra_pelos_procedimentos_que_a_citam() {
        let hab: HashSet<String> = ["0404040040".to_string(), "0302020020".to_string()].into();
        let o = montar_aptidao(&amostra(), Some("oportunidade"), None, Some(&hab), 0, false);
        assert_eq!(codigos(&o["grupo"]), ["0404040040"]);
        let r = montar_aptidao(&amostra(), Some("risco"), None, Some(&hab), 0, false);
        assert_eq!(codigos(&r["grupo"]), ["0302020020"]);
    }

    #[test]
    fn pagina_de_cinquenta_com_omitidos_e_total() {
        let muitos: Vec<ItemDeAptidao> = (0..120)
            .map(|i| {
                item(
                    &format!("{i:010}"),
                    "Procedimento",
                    "produz_sem_aptidao",
                    1000 - i,
                    0,
                )
            })
            .collect();
        let g = montar_aptidao(&muitos, Some("risco"), None, None, 50, false)["grupo"].clone();
        assert_eq!(g["desde"], 50);
        assert_eq!(g["total"], 120);
        assert_eq!(g["itens"].as_array().unwrap().len(), 50);
        assert_eq!(g["itens_omitidos"], 20);
        assert_eq!(g["itens"][0]["codigo"], "0000000050");
        let ultima =
            montar_aptidao(&muitos, Some("risco"), None, None, 100, false)["grupo"].clone();
        assert_eq!(ultima["itens"].as_array().unwrap().len(), 20);
        assert_eq!(ultima["itens_omitidos"], 0);
    }

    #[test]
    fn so_produzidos_na_uf_tira_o_que_ninguem_produziu_e_diz_quantos() {
        let o =
            montar_aptidao(&amostra(), Some("oportunidade"), None, None, 0, true)["grupo"].clone();
        assert_eq!(codigos(&o), ["0404040040"]);
        assert_eq!(o["total"], 1);
        assert_eq!(o["ninguem_produziu"], 1);
        let sem =
            montar_aptidao(&amostra(), Some("oportunidade"), None, None, 0, false)["grupo"].clone();
        assert!(sem["ninguem_produziu"].is_null());
    }

    #[test]
    fn grupo_desconhecido_vira_lista_vazia_sem_quebrar() {
        let g = montar_aptidao(&amostra(), Some("nada"), None, None, 0, false);
        assert!(g["grupo"].is_null());
    }

    #[test]
    fn texto_de_busca_ignora_acento_e_caixa() {
        assert_eq!(sem_acento("Ação Cirúrgica ÇÃO"), "acao cirurgica cao");
    }

    fn tipos(f: &Value) -> Vec<&'static str> {
        alertas_de_perfil(f).into_iter().map(|a| a.0).collect()
    }

    #[test]
    fn alertas_de_perfil_so_aparecem_com_motivo_e_calam_quando_esta_tudo_certo() {
        assert!(
            tipos(&json!({})).is_empty(),
            "sem os blocos novos, nenhum alerta"
        );
        let f = json!({
            "servicos": { "fora_do_cadastro_centavos": 5000, "itens": [{"situacao": "fora_do_cadastro"}, {"situacao": "cadastrado_sus"}] },
            "reapresentacao": { "anteriores_centavos": 30, "total_centavos": 100, "uf_anteriores_centavos": 5, "uf_total_centavos": 100 },
            "permanencia": { "fora_do_previsto": 2 },
            "rejeicoes": { "motivos": [{"encerrado": true}, {"encerrado": false}] },
            "perfil": { "marcas": [
                {"codigo": "7101", "sem_credito": true, "vigente": true},
                {"codigo": "7102", "sem_credito": true, "vigente": false}
            ] },
        });
        assert_eq!(
            tipos(&f),
            [
                "servico_fora_do_cadastro",
                "reapresentacao_alta",
                "permanencia_fora_do_previsto",
                "motivo_de_rejeicao_encerrado",
                "regra_sem_geracao_de_credito"
            ]
        );
        let textos: Vec<String> = alertas_de_perfil(&f).into_iter().map(|a| a.2).collect();
        assert!(textos[0].contains("R$ 50,00") && textos[0].contains("1 serviço"));
        assert!(textos[4].contains("7101") && !textos[4].contains("7102"));
    }

    #[test]
    fn reapresentacao_parecida_com_a_da_uf_ou_pequena_nao_alerta() {
        let r = |a: i64, ua: i64| {
            json!({ "reapresentacao": { "anteriores_centavos": a, "total_centavos": 100,
                                         "uf_anteriores_centavos": ua, "uf_total_centavos": 100 } })
        };
        assert!(
            tipos(&r(30, 20)).is_empty(),
            "30% contra 20% na UF: menos de 2 vezes"
        );
        assert!(
            tipos(&r(8, 1)).is_empty(),
            "8% fica abaixo do mínimo de 10%"
        );
        assert_eq!(tipos(&r(10, 5)), ["reapresentacao_alta"]);
    }

    fn alerta(tipo: &str, gravidade: &str) -> Value {
        json!({ "tipo": tipo, "gravidade": gravidade, "texto": format!("texto de {tipo}") })
    }

    fn queda(sistema: &str) -> Value {
        json!({ "tipo": "queda_de_valor", "gravidade": "atencao", "texto": "caiu", "sistema": sistema })
    }

    #[test]
    fn queda_de_valor_tem_valor_envolvido_vezes_tres_e_perda_vezes_doze() {
        let f = json!({
            "tendencia": { "sia_valor": { "media_anterior": 1_000_000.0, "media_recente": 900_000.0, "sentido": "cai" } },
            "janela": { "sia": ["202604", "202605", "202606", "202607", "202608", "202609"] },
        });
        let p = montar_pendencias(&[queda("sia")], &f, None);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0]["id"], "queda_de_valor:sia");
        assert_eq!(p[0]["valor_envolvido_centavos"], 300_000);
        assert_eq!(p[0]["perda_estimada"]["centavos"], 1_200_000);
        assert_eq!(p[0]["perda_estimada"]["horizonte_meses"], 12);
        assert_eq!(p[0]["perda_estimada"]["premissa"], "se a queda se mantiver");
        assert_eq!(p[0]["origem"]["fonte"], "SIA");
        assert_eq!(p[0]["origem"]["competencias"].as_array().unwrap().len(), 6);
        assert!(
            p[0]["origem"]["nao_prova"]
                .as_str()
                .unwrap()
                .contains("causa")
        );
    }

    #[test]
    fn queda_sem_diferenca_positiva_nao_ganha_valor_nem_perda() {
        let f = json!({
            "tendencia": { "sia_valor": { "media_anterior": 100.0, "media_recente": 100.0 } },
        });
        let p = montar_pendencias(&[queda("sia")], &f, None);
        assert_eq!(p[0]["valor_envolvido_centavos"], Value::Null);
        assert_eq!(p[0]["perda_estimada"], Value::Null);
        let sem_campo = montar_pendencias(&[queda("sih")], &json!({}), None);
        assert_eq!(sem_campo[0]["valor_envolvido_centavos"], Value::Null);
    }

    #[test]
    fn so_a_queda_de_valor_tem_perda_estimada() {
        let f = json!({
            "apresentado": { "valor_apresentado_centavos": 15_000, "valor_aprovado_centavos": 10_000 },
            "servicos": { "fora_do_cadastro_centavos": 7_000 },
        });
        let a = [
            alerta("apresentado_maior_que_aprovado", "atencao"),
            alerta("servico_fora_do_cadastro", "atencao"),
        ];
        for p in montar_pendencias(&a, &f, None) {
            assert_eq!(p["perda_estimada"], Value::Null, "{p}");
            assert!(p["valor_envolvido_centavos"].is_i64(), "{p}");
        }
    }

    #[test]
    fn valores_envolvidos_por_tipo() {
        let f = json!({
            "apresentado": {
                "valor_apresentado_centavos": 15_000, "valor_aprovado_centavos": 10_000,
                "atipicas": [
                    { "procedimento": "0301010072", "competencia": "202608", "quantidade_apresentada": 900, "valor_apresentado_centavos": 4_000 },
                    { "procedimento": "0301010080", "competencia": "202609", "quantidade_apresentada": 500, "valor_apresentado_centavos": 1_000 },
                ],
            },
            "servicos": { "fora_do_cadastro_centavos": 7_000 },
            "reapresentacao": { "anteriores_centavos": 3_000, "total_centavos": 10_000 },
        });
        let a = [
            alerta("apresentado_maior_que_aprovado", "atencao"),
            alerta("servico_fora_do_cadastro", "atencao"),
            alerta("reapresentacao_alta", "atencao"),
            alerta("quantidade_atipica", "atencao"),
        ];
        let p = montar_pendencias(&a, &f, None);
        let por_tipo = |t: &str| {
            p.iter().find(|x| x["tipo"] == t).unwrap()["valor_envolvido_centavos"].as_i64()
        };
        assert_eq!(por_tipo("apresentado_maior_que_aprovado"), Some(5_000));
        assert_eq!(por_tipo("servico_fora_do_cadastro"), Some(7_000));
        assert_eq!(por_tipo("reapresentacao_alta"), Some(3_000));
        assert_eq!(por_tipo("quantidade_atipica"), Some(5_000));
        let atipica = p
            .iter()
            .find(|x| x["tipo"] == "quantidade_atipica")
            .unwrap();
        assert_eq!(atipica["itens"][0]["codigo"], "0301010072");
        assert_eq!(atipica["itens"][0]["valor_centavos"], 4_000);
    }

    #[test]
    fn produz_sem_aptidao_leva_o_valor_da_classe_e_os_dez_maiores_itens() {
        let itens: Vec<Value> = (0..15)
            .map(|i| json!({ "codigo": format!("03010100{i:02}"), "nome": "x",
                              "sia": { "quantidade": 1, "valor_centavos": 100 - i }, "sih": { "aih": 0, "valor_centavos": 0 } }))
            .collect();
        let pr = json!({ "classes": { "produz_sem_aptidao": { "procedimentos": 15, "valor_da_unidade_centavos": 9_000, "itens": itens } } });
        let p = montar_pendencias(
            &[alerta("produz_sem_aptidao", "atencao")],
            &json!({}),
            Some(&pr),
        );
        assert_eq!(p[0]["valor_envolvido_centavos"], 9_000);
        assert_eq!(p[0]["itens"].as_array().unwrap().len(), 10);
        assert_eq!(p[0]["itens"][0]["valor_centavos"], 100);
    }

    #[test]
    fn tipos_sem_valor_calculavel_ficam_nulos() {
        let a = [
            alerta("rejeicao_acima_dos_pares", "atencao"),
            alerta("permanencia_fora_do_previsto", "info"),
            alerta("motivo_de_rejeicao_encerrado", "atencao"),
            alerta("regra_sem_geracao_de_credito", "info"),
            alerta("habilitacao_sem_producao", "atencao"),
            alerta("mes_incompleto", "info"),
            alerta("baixar_de_novo", "info"),
        ];
        for p in montar_pendencias(&a, &json!({}), None) {
            assert_eq!(p["valor_envolvido_centavos"], Value::Null, "{p}");
            assert_eq!(p["itens"], json!([]), "{p}");
        }
    }

    #[test]
    fn ordem_valoradas_por_valor_depois_sem_valor_por_gravidade() {
        let f = json!({
            "apresentado": { "valor_apresentado_centavos": 15_000, "valor_aprovado_centavos": 10_000 },
            "servicos": { "fora_do_cadastro_centavos": 7_000 },
        });
        let a = [
            alerta("mes_incompleto", "info"),
            alerta("apresentado_maior_que_aprovado", "atencao"),
            alerta("rejeicao_acima_dos_pares", "atencao"),
            alerta("servico_fora_do_cadastro", "atencao"),
        ];
        let tipos: Vec<String> = montar_pendencias(&a, &f, None)
            .iter()
            .map(|x| x["tipo"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            tipos,
            [
                "servico_fora_do_cadastro",
                "apresentado_maior_que_aprovado",
                "rejeicao_acima_dos_pares",
                "mes_incompleto"
            ]
        );
    }

    #[test]
    fn origem_dos_alertas_do_sih_cita_o_sih() {
        let f = json!({ "janela": { "sia": ["202601"], "sih": ["202602"] } });
        for t in [
            "rejeicao_acima_dos_pares",
            "motivo_de_rejeicao_encerrado",
            "permanencia_fora_do_previsto",
        ] {
            let o = origem_da_pendencia(t, None, &f);
            assert_eq!(o["fonte"], "SIH", "{t}");
            assert_eq!(o["competencias"], json!(["202602"]), "{t}");
            assert_ne!(o["nao_prova"], "", "{t}");
        }
    }

    #[test]
    fn classes_do_rust_viram_os_tres_grupos() {
        assert_eq!(grupo_da_classe("produz_sem_aptidao"), Some("risco"));
        assert_eq!(grupo_da_classe("produz_com_ressalva"), Some("risco"));
        assert_eq!(grupo_da_classe("produz_fora_da_tabela"), Some("risco"));
        assert_eq!(grupo_da_classe("apta_nao_produz"), Some("oportunidade"));
        assert_eq!(grupo_da_classe("produz_apta"), Some("ordem"));
        assert_eq!(grupo_da_classe("produz_sem_exigencia"), Some("ordem"));
        assert_eq!(grupo_da_classe("outra"), None);
    }

    #[test]
    fn situacao_em_texto_para_a_tela() {
        assert_eq!(
            situacao_do_item("produz_sem_aptidao", Some("habilitacao")),
            "nao_apta"
        );
        assert_eq!(
            situacao_do_item("produz_com_ressalva", Some("so_servico")),
            "servico_a_confirmar"
        );
        assert_eq!(
            situacao_do_item("produz_fora_da_tabela", None),
            "fora_da_tabela"
        );
        assert_eq!(
            situacao_do_item("apta_nao_produz", Some("com_ressalva_de_servico")),
            "apta_ressalva_servico"
        );
        assert_eq!(situacao_do_item("apta_nao_produz", None), "apta");
        assert_eq!(situacao_do_item("produz_apta", None), "apta");
        assert_eq!(
            situacao_do_item("produz_sem_exigencia", None),
            "sem_exigencia"
        );
    }

    #[test]
    fn falta_lista_so_o_que_a_unidade_nao_tem() {
        let a = json!({
            "habilitacao": { "alternativas": [{ "habilitacoes": [
                { "codigo": "0203", "nome": "Obesidade", "tem": false, "observacao": null },
                { "codigo": "0204", "nome": "Outra", "tem": true, "observacao": null }
            ] }] },
            "servico": { "pares": [
                { "servico": {"codigo":"104","nome":"Regulação"}, "classificacao": {"codigo":"001","nome":"Central"}, "tem": false },
                { "servico": {"codigo":"105","nome":"X"}, "classificacao": {"codigo":"002","nome":"Y"}, "tem": true }
            ] },
            "leito": { "tipos": [{ "tipo": {"codigo":"03","nome":null}, "tem": false }] }
        });
        let f = faltas_da_aptidao(&a);
        assert_eq!(f.len(), 3);
        assert_eq!(
            f[0],
            json!({"tipo":"habilitacao","codigo":"0203","nome":"Obesidade"})
        );
        assert_eq!(
            f[1],
            json!({"tipo":"servico","codigo":"104/001","nome":"Regulação · Central"})
        );
        assert_eq!(f[2]["tipo"], "leito");
        assert_eq!(f[2]["codigo"], "03");
    }

    #[test]
    fn falta_vazia_quando_apta_e_sem_duplicar() {
        assert!(faltas_da_aptidao(&json!({ "habilitacao": {"alternativas": []}, "servico": {"pares": []}, "leito": {"tipos": []} })).is_empty());
        let dup = json!({ "habilitacao": { "alternativas": [
            { "habilitacoes": [{ "codigo": "0203", "nome": null, "tem": false }] },
            { "habilitacoes": [{ "codigo": "0203", "nome": null, "tem": false }] }
        ] }, "servico": {"pares": []}, "leito": {"tipos": []} });
        assert_eq!(faltas_da_aptidao(&dup).len(), 1);
    }

    #[test]
    fn alerta_de_queda_carrega_o_sistema() {
        let a = alerta_de_queda("SIH", 23.0);
        assert_eq!(a["tipo"], "queda_de_valor");
        assert_eq!(a["sistema"], "sih");
        assert!(a["texto"].as_str().unwrap().contains("23%"));
        assert!(a["texto"].as_str().unwrap().contains("SIH"));
    }

    #[test]
    fn afeta_e_produz_ou_apta_e_sem_cadastro_so_conta_a_producao() {
        assert!(afeta(true, Some(false)));
        assert!(afeta(false, Some(true)));
        assert!(!afeta(false, Some(false)));
        assert!(afeta(true, None));
        assert!(!afeta(false, None));
    }

    fn mudancas_de_exemplo() -> Value {
        json!({ "de": "202608", "para": "202609", "tabelas": [
            { "tabela": "rl_procedimento_habilitacao", "incluidos": 2, "excluidos": 0, "alterados": 0, "itens": [
                { "tipo": "incluido", "chave": { "co_procedimento": "0301010072", "co_habilitacao": "1" } },
                { "tipo": "incluido", "chave": { "co_procedimento": "0401010015", "co_habilitacao": "2" } },
            ]},
            { "tabela": "tb_forma_organizacao", "incluidos": 1, "excluidos": 0, "alterados": 0, "itens": [
                { "tipo": "incluido", "chave": { "co_forma": "010101" } },
            ]},
        ]})
    }

    #[test]
    fn anotar_afeta_marca_sem_filtrar_e_filtra_quando_pedido() {
        let produzidos: HashSet<String> = ["0301010072".to_string()].into();
        let mut m = mudancas_de_exemplo();
        anotar_afeta(&mut m, &produzidos, None, false);
        let t = &m["tabelas"][0];
        assert_eq!(t["itens"][0]["afeta"], true);
        assert_eq!(t["itens"][1]["afeta"], false);
        assert_eq!(t["afetam"], 1);
        assert_eq!(
            t["itens"].as_array().unwrap().len(),
            2,
            "sem filtro, todos ficam"
        );
        assert!(
            m["tabelas"][1]["itens"][0].get("afeta").is_none(),
            "tabela sem procedimento não é marcada"
        );

        let mut m = mudancas_de_exemplo();
        let aptos: HashSet<String> = ["0401010015".to_string()].into();
        anotar_afeta(&mut m, &produzidos, Some(&aptos), true);
        assert_eq!(
            m["tabelas"][0]["itens"].as_array().unwrap().len(),
            2,
            "produz ou apta"
        );
        let mut m = mudancas_de_exemplo();
        anotar_afeta(&mut m, &produzidos, Some(&HashSet::new()), true);
        assert_eq!(m["tabelas"][0]["itens"].as_array().unwrap().len(), 1);
        assert_eq!(
            m["tabelas"][1]["itens"].as_array().unwrap().len(),
            1,
            "tabela sem procedimento não é filtrada"
        );
    }

    #[test]
    fn reais_br_usa_ponto_de_milhar_e_virgula() {
        assert_eq!(reais_br(0), "R$ 0,00");
        assert_eq!(reais_br(5), "R$ 0,05");
        assert_eq!(reais_br(624_428), "R$ 6.244,28");
        assert_eq!(reais_br(123_456_789), "R$ 1.234.567,89");
        assert_eq!(reais_br(-100_000), "−R$ 1.000,00");
    }

    #[test]
    fn pendencia_nao_manda_o_usuario_para_abas_que_nao_existem() {
        let a = json!({ "tipo": "mes_incompleto", "gravidade": "info",
                         "texto": "Confira o lote (ver a aba Produção da unidade)." });
        let p = montar_pendencias(&[a], &json!({}), None);
        assert_eq!(p[0]["texto"], "Confira o lote.");
        assert_eq!(sem_remissao_a_abas("sem remissão"), "sem remissão");
    }
}
