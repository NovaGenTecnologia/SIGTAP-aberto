//! Cruzamentos do faturista com os dados **reais** de MS (produção 08/2025 a 07/2026, CNES 08/2026,
//! SIGTAP até 09/2026). `SA_DADOS_REAIS` = a pasta `dados` de uma instalação (nada é gravado nela:
//! os bancos são copiados para uma pasta temporária). Sem a variável, o teste é pulado.
//!
//! Os números afirmados aqui são os medidos em 05/10/2026 e estão na matriz de validação de
//! `docs/fases/fase-4.md`.

use sa_core::Competencia;
use sa_query::Consulta;
use sa_query::faturamento::por_100_aih;
use sa_query::producao::{ConsultaProducao, Origem};
use sa_unidade::Pastas;
use sa_unidade::faturamento::{
    faturamento_da_unidade, faturamento_do_procedimento, impacto_das_mudancas, painel_do_faturista,
    procedimentos_com_producao,
};
use std::path::PathBuf;

fn copia(origem: &std::path::Path, destino: &std::path::Path) {
    std::fs::create_dir_all(destino.parent().unwrap()).unwrap();
    std::fs::copy(origem, destino).unwrap();
}

#[test]
fn cruzamentos_do_faturista_com_dados_reais_de_ms() {
    let Ok(base) = std::env::var("SA_DADOS_REAIS") else {
        eprintln!(
            "pulado: defina SA_DADOS_REAIS (a pasta dados de uma instalação com a produção de MS)"
        );
        return;
    };
    let base = PathBuf::from(base);
    for f in ["sigtap.db", "cnes/MS.db", "producao/MS.db"] {
        if !base.join(f).exists() {
            eprintln!("pulado: falta {f} em {}", base.display());
            return;
        }
    }
    let meta = std::fs::metadata(base.join("producao/MS.db")).unwrap();
    let antes = (meta.len(), meta.modified().unwrap());
    let dados = std::env::temp_dir().join(format!("sa_fat_real_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dados);
    for f in ["sigtap.db", "cnes/MS.db", "producao/MS.db"] {
        copia(&base.join(f), &dados.join(f));
    }
    let p = Pastas {
        dados: dados.clone(),
    };
    let sig = Consulta::abrir(&dados.join("sigtap.db")).unwrap();
    let comp = Competencia::de_texto("202609").unwrap();
    let anterior = Competencia::de_texto("202608").unwrap();
    let q = ConsultaProducao::abrir(&dados.join("producao/MS.db")).unwrap();

    // 1. Mês completo (regra do limiar de 90%): SIA de 07/2026 incompleto, o resto completo.
    let sia = q.cobertura(Origem::Ambulatorial).unwrap();
    let sih = q.cobertura(Origem::Hospitalar).unwrap();
    let incompletos: Vec<&str> = sia
        .iter()
        .filter(|m| !m.completo)
        .map(|m| m.competencia.as_str())
        .collect();
    assert_eq!(incompletos, ["202607"]);
    assert!(sih.iter().all(|m| m.completo));
    assert_eq!(sia.last().unwrap().estabelecimentos, 476);
    assert_eq!(q.janela_do(Origem::Ambulatorial).unwrap().len(), 11);
    assert_eq!(q.janela_do(Origem::Hospitalar).unwrap().len(), 12);
    eprintln!(
        "meses sem os campos novos nesta instalação: {}",
        q.sem_campos_novos().unwrap().len()
    );

    // 2. Rejeições por 100 AIH, UF inteira (ER: uma linha por erro).
    let conn = rusqlite::Connection::open(dados.join("producao/MS.db")).unwrap();
    let (rej, aih): (i64, i64) = conn
        .query_row(
            "SELECT (SELECT sum(qtd) FROM rej_hosp WHERE comp = '202508'), (SELECT sum(aih) FROM prod_hosp WHERE comp = '202508')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((rej, aih), (995, 18088));
    assert_eq!(
        por_100_aih(rej, aih).map(|x| (x * 10.0).round() / 10.0),
        Some(5.5)
    );

    // 3. A maior unidade do SIH vira a "minha" para os cruzamentos.
    let (cnes, aih_maior): (String, i64) = conn
        .query_row(
            "SELECT cnes, sum(aih) s FROM prod_hosp GROUP BY cnes ORDER BY s DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    eprintln!("unidade escolhida: {cnes} com {aih_maior} AIH no período");
    sa_unidade::definir_minha(&p, "MS", &cnes).unwrap();

    let t = std::time::Instant::now();
    let f = faturamento_da_unidade(&p, &sig, comp, None).unwrap();
    eprintln!("faturamento_da_unidade em {:?}", t.elapsed());
    assert_eq!(f["disponivel"], true);
    eprintln!(
        "rejeições/100 AIH na janela: {} ({} rejeições, {} AIH); tendência SIH: {}; pares: {}",
        f["rejeicoes"]["por_100_aih"],
        f["rejeicoes"]["janela_rejeicoes"],
        f["rejeicoes"]["janela_aih"],
        f["tendencia"]["sih_valor"],
        f["pares"]
    );
    eprintln!("ABC SIH: {}", f["abc"]["sih"]["resumo"]);
    eprintln!("ABC SIA: {}", f["abc"]["sia"]["resumo"]);
    eprintln!("leitos: {}", f["leitos"]);
    eprintln!("apresentado: {}", f["apresentado"]);
    // Com o banco da instalação ainda no esquema 1, o apresentado é nulo; com a produção baixada de
    // novo, vem preenchido. As duas situações são válidas.
    assert_eq!(
        f["apresentado"].is_null(),
        f["sem_campos_novos"].as_array().unwrap().len() >= 11,
        "apresentado nulo só quando a instalação ainda não tem os campos novos"
    );

    let t = std::time::Instant::now();
    let pr = procedimentos_com_producao(&p, &sig, comp, None).unwrap();
    eprintln!("procedimentos_com_producao em {:?}", t.elapsed());
    for (k, v) in pr["classes"].as_object().unwrap() {
        eprintln!(
            "  {k}: {} procedimentos, R$ {} da unidade",
            v["procedimentos"],
            v["valor_da_unidade_centavos"].as_i64().unwrap_or(0) / 100
        );
    }
    let motivos: std::collections::BTreeMap<String, usize> =
        pr["classes"]["produz_sem_aptidao"]["itens"]
            .as_array()
            .map(|v| {
                let mut m = std::collections::BTreeMap::new();
                for x in v {
                    *m.entry(x["motivo"].as_str().unwrap_or("").to_string())
                        .or_insert(0) += 1;
                }
                m
            })
            .unwrap_or_default();
    eprintln!("  produz sem aptidão por motivo: {motivos:?}");
    eprintln!(
        "  habilitações: {}",
        pr["habilitacoes"].as_array().map_or(0, Vec::len)
    );

    // 4. Procedimento: série, tendência, concentração, tabela.
    let fp = faturamento_do_procedimento(&p, &sig, comp, "0301010072", Some("MS")).unwrap();
    eprintln!(
        "0301010072 SIA: valor médio {} ; concentração top3 {} ; tendência {} ; financiamento {}",
        fp["sia"]["valor_medio_centavos"],
        fp["sia"]["concentracao_top3_percentual"],
        fp["sia"]["tendencia"],
        fp["sia"]["financiamento"]
    );
    eprintln!("0301010072 eventos da tabela: {}", fp["eventos_da_tabela"]);
    let esperado_ok = fp["sia"]["serie"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["completo"] == true)
        .all(|m| m["esperado_centavos"].is_i64());
    assert!(
        esperado_ok,
        "a tabela de cada mês da produção está carregada"
    );

    // 5. Impacto das mudanças da tabela 08/2026 -> 09/2026.
    let im = impacto_das_mudancas(&p, &sig, Some(anterior), comp, None).unwrap();
    eprintln!(
        "impacto 08->09/2026: {} mudanças de valor, {} com produção; UF R$ {} ao ano; unidade R$ {}; excluídos com produção {}; exigências novas com produção {}",
        im["mudancas_de_valor"],
        im["mudancas_com_producao"],
        im["impacto_uf_anual_centavos"].as_i64().unwrap_or(0) / 100,
        im["impacto_unidade_anual_centavos"].as_i64().unwrap_or(0) / 100,
        im["excluidos_com_producao"].as_array().map_or(0, Vec::len),
        im["exigencias_novas_com_producao"]
            .as_array()
            .map_or(0, Vec::len),
    );
    eprintln!(
        "  das quais realmente novas (antes sem exigência): {}",
        im["exigencias_realmente_novas_com_producao"]
    );

    // 6. Painel.
    let painel = painel_do_faturista(&p, &sig, comp).unwrap();
    assert_eq!(painel["disponivel"], true);
    eprintln!(
        "painel: sia {} | sih {} | alertas {}",
        painel["sia"], painel["sih"], painel["alertas"]
    );
    eprintln!("fontes: {}", painel["fontes"]);

    // A instalação do usuário não foi tocada: o banco de produção dela tem o mesmo tamanho e a mesma data.
    let depois = std::fs::metadata(base.join("producao/MS.db")).unwrap();
    assert_eq!(
        (depois.len(), depois.modified().unwrap()),
        antes,
        "o teste só trabalha em cópia"
    );
    let _ = std::fs::remove_dir_all(dados);
}
