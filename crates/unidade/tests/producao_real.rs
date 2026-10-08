//! Produção sintética sobre o cadastro real: a produção é inventada (nenhum dado de produção real
//! está no disco), mas o SIGTAP e o CNES de MS são os reais. Prova a ligação ponta a ponta: arquivo
//! `.dbc` → totais → consulta da ficha → confronto com a regra de aptidão → nomes do CNES.
//!
//! `SA_SIGTAP_BANCO_CONSULTA` = banco do SIGTAP; `SA_CNES_BANCO_MS` = `dados\cnes\MS.db` já carregado.
//! Sem os dois, não roda (ver docs/fases/fase-4.md).

use rusqlite::Connection;
use sa_packs::producao::sintetico::dbf;
use sa_query::Consulta;
use sa_query::cnes::Estado;
use sa_sources::dbc::de_dbf_sintetico;
use sa_unidade::producao::{arquivos_producao, carregar_producao, producao_do_procedimento};
use sa_unidade::{Pastas, consulta_cnes};
use std::collections::HashSet;
use std::path::PathBuf;

fn preparado() -> Option<(PathBuf, PathBuf)> {
    let sig = PathBuf::from(std::env::var("SA_SIGTAP_BANCO_CONSULTA").ok()?);
    let cnes = PathBuf::from(std::env::var("SA_CNES_BANCO_MS").ok()?);
    (sig.exists() && cnes.exists()).then_some((sig, cnes))
}

#[test]
fn produtores_sobre_o_cadastro_real_batem_com_a_regra_de_aptidao() {
    let Some((sig_db, ms_db)) = preparado() else {
        eprintln!("pulado: defina SA_SIGTAP_BANCO_CONSULTA e SA_CNES_BANCO_MS");
        return;
    };
    let dados = std::env::temp_dir().join(format!("sa_un_prod_real_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dados);
    std::fs::create_dir_all(dados.join("cnes")).unwrap();
    std::fs::copy(&ms_db, dados.join("cnes").join("MS.db")).unwrap();
    let p = Pastas {
        dados: dados.clone(),
    };
    let sig = Consulta::abrir(&sig_db).unwrap();
    let comp = sig.mais_recente().unwrap();
    let q = consulta_cnes(&p, "MS").unwrap();

    // Um procedimento que o estabelecimento mais habilitado pode cobrar.
    let conn = Connection::open(dados.join("cnes").join("MS.db")).unwrap();
    let topo: String = conn
        .query_row(
            "SELECT cnes FROM cnes_hb GROUP BY cnes ORDER BY count(*) DESC, cnes LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let estados = q.estados(&sig, comp, &topo).unwrap().unwrap();
    let proc = estados
        .iter()
        .filter(|(_, e)| **e == Estado::Apta)
        .map(|(c, _)| c.clone())
        .min()
        .expect("o estabelecimento mais habilitado tem procedimento apto");

    // Quem a regra considera apto e quem não.
    let rede = q.rede(&sig, comp, &proc, None, 2000).unwrap();
    assert!(
        rede.exige && rede.aptos >= 1 && rede.aptos <= 2000,
        "{} aptos",
        rede.aptos
    );
    let aptos: HashSet<String> = rede
        .estabelecimentos
        .iter()
        .map(|e| e.cnes.clone())
        .collect();
    let mut todos: Vec<String> = conn
        .prepare("SELECT cnes FROM cnes_st ORDER BY cnes")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    todos.retain(|c| !aptos.contains(c));
    let mut aptos_ord: Vec<String> = aptos.into_iter().collect();
    aptos_ord.sort();
    let (com, sem): (Vec<_>, Vec<_>) = (
        aptos_ord.into_iter().take(12).collect(),
        todos.into_iter().take(7).collect(),
    );
    assert_eq!(sem.len(), 7);
    let (n_com, n_tot) = (com.len(), com.len() + sem.len());
    assert!(n_com >= 1);

    // Produção inventada: todos produziram 10 do procedimento em 07/2026 (até 12 aptos e 7 não aptos).
    let linhas: Vec<Vec<String>> = com
        .iter()
        .chain(&sem)
        .map(|c| {
            vec![
                c.clone(),
                "202607".into(),
                proc.clone(),
                "10".into(),
                "5.00".into(),
            ]
        })
        .collect();
    let pa = de_dbf_sintetico(&dbf(
        &[
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
        ],
        &linhas,
    ));
    let pasta = arquivos_producao(&p, "MS");
    std::fs::create_dir_all(&pasta).unwrap();
    std::fs::write(pasta.join("PAMS2607a.dbc"), pa).unwrap();
    carregar_producao(&p, "MS", &|_| {}).unwrap();
    assert!(
        std::fs::read_dir(&pasta).unwrap().next().is_none(),
        "o arquivo oficial não pode ficar em disco"
    );

    eprintln!(
        "procedimento {proc}: {n_com} aptos e {} não aptos produzindo",
        sem.len()
    );
    let j = producao_do_procedimento(&p, &sig, comp, &proc, Some("MS")).unwrap();
    assert_eq!(j["disponivel"], true);
    assert_eq!(j["sia"]["estabelecimentos"], n_tot);
    assert_eq!(j["sia"]["quantidade"], n_tot * 10);
    assert_eq!(j["sia"]["valor_centavos"], n_tot * 500);
    assert_eq!(j["sih"]["estabelecimentos"], 0);
    let c = &j["confronto"];
    assert_eq!(c["produtores"], n_tot);
    assert_eq!(c["no_cadastro"], n_tot);
    assert_eq!(c["aptos"], n_com, "os produtores aptos pela regra");
    assert_eq!(c["total_nao_aptos"], 7, "os 7 sem habilitação ou serviço");
    assert_eq!(c["regra_confirmada"], false);
    // Os nomes vêm do cadastro: ao menos um produtor da lista tem nome.
    let lista = j["sia"]["lista"].as_array().unwrap();
    assert_eq!(lista.len(), n_tot.min(15));
    assert!(
        lista
            .iter()
            .any(|x| x["estabelecimento"]["nome"].is_string())
    );
    assert_eq!(j["campos_confirmados"], true);
    drop(conn);
    drop(q);
    let _ = std::fs::remove_dir_all(dados);
}

/// Gera arquivos `PA`, `RD` e `ER` **sintéticos** (números inventados) para a unidade escolhida no
/// `usuario.db` e alguns vizinhos, para ver as telas de produção sem o servidor do DATASUS. Só roda
/// com `SA_PRODUCAO_SINTETICA_PASTA` (saída), `SA_USUARIO_DB`, `SA_SIGTAP_BANCO_CONSULTA` e
/// `SA_CNES_BANCO_MS`. Nada daqui é produção real.
///
/// Desenho dos dados (para as telas de faturamento): 8 meses (12/2025 a 07/2026); o SIA de 07/2026
/// sai com menos estabelecimentos (mês incompleto); os campos do esquema 2 vêm preenchidos (apresentado
/// maior que o aprovado em um procedimento, incremento em outro, dois financiamentos, dias de
/// internação); a unidade produz também procedimentos para os quais o cadastro não mostra aptidão
/// (só 38.xx, só serviço, falta habilitação); e os vizinhos produzem procedimentos que a unidade
/// poderia produzir e não produz.
#[test]
fn gera_arquivos_de_producao_sinteticos_para_ver_as_telas() {
    let (Some((sig_db, ms_db)), Ok(saida), Ok(usuario)) = (
        preparado(),
        std::env::var("SA_PRODUCAO_SINTETICA_PASTA"),
        std::env::var("SA_USUARIO_DB"),
    ) else {
        eprintln!("pulado: defina SA_PRODUCAO_SINTETICA_PASTA e SA_USUARIO_DB");
        return;
    };
    let saida = PathBuf::from(saida);
    std::fs::create_dir_all(&saida).unwrap();
    let minha: String = Connection::open(&usuario)
        .unwrap()
        .query_row(
            "SELECT valor FROM config WHERE chave = 'minha_unidade'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let cnes_minha = minha.split(':').nth(1).unwrap().to_string();
    let dados = std::env::temp_dir().join(format!("sa_un_prod_gera_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dados);
    std::fs::create_dir_all(dados.join("cnes")).unwrap();
    std::fs::copy(&ms_db, dados.join("cnes").join("MS.db")).unwrap();
    let p = Pastas {
        dados: dados.clone(),
    };
    let sig = Consulta::abrir(&sig_db).unwrap();
    let comp = sig.mais_recente().unwrap();
    let q = consulta_cnes(&p, "MS").unwrap();
    let estados = q
        .estados_detalhados(&sig, comp, &cnes_minha)
        .unwrap()
        .unwrap();
    let mut aptos_da_minha: Vec<String> = estados
        .iter()
        .filter(|(_, e)| e.estado == Estado::Apta)
        .map(|(c, _)| c.clone())
        .collect();
    aptos_da_minha.sort();
    assert!(
        !aptos_da_minha.is_empty(),
        "a unidade escolhida não tem procedimento apto"
    );
    let ambulatoriais: Vec<String> = aptos_da_minha
        .iter()
        .filter(|c| !c.starts_with("04"))
        .take(8)
        .cloned()
        .collect();
    let hospitalares: Vec<String> = aptos_da_minha
        .iter()
        .filter(|c| c.starts_with("04"))
        .take(5)
        .cloned()
        .collect();
    // Produzidos sem aptidão no cadastro: só 38.xx (2), falta habilitação (1) e só serviço (1).
    let ambulatorial_sem = |filtro: &dyn Fn(&sa_query::cnes::EstadoDetalhado) -> bool, n: usize| {
        let mut v: Vec<String> = estados
            .iter()
            .filter(|(c, e)| !c.starts_with("04") && filtro(e))
            .map(|(c, _)| c.clone())
            .collect();
        v.sort();
        v.truncate(n);
        v
    };
    let so38 = ambulatorial_sem(
        &|e| e.estado == Estado::Nao && e.habilitacao_so_38 && !e.falta_servico,
        2,
    );
    let falta_hab = ambulatorial_sem(
        &|e| e.estado == Estado::Nao && !e.habilitacao_so_38 && !e.falta_servico,
        1,
    );
    let so_servico = ambulatorial_sem(&|e| e.estado == Estado::Ressalva, 1);
    // Os vizinhos produzem procedimentos que a unidade poderia produzir e não produz.
    let nao_produzidos: Vec<String> = aptos_da_minha
        .iter()
        .filter(|c| !c.starts_with("04") && !ambulatoriais.contains(c))
        .take(3)
        .cloned()
        .collect();
    let primeiro = ambulatoriais
        .first()
        .cloned()
        .unwrap_or_else(|| aptos_da_minha[0].clone());
    let vizinhos: Vec<String> = q
        .rede(&sig, comp, &primeiro, None, 2000)
        .unwrap()
        .estabelecimentos
        .iter()
        .map(|e| e.cnes.clone())
        .filter(|c| *c != cnes_minha)
        .take(10)
        .collect();
    let valor_sa = |proc_: &str| -> i64 {
        sig.valores_do_procedimento(comp, proc_)
            .unwrap()
            .map_or(1000, |v| v.sa.max(100))
    };
    let dinheiro = |c: i64| format!("{}.{:02}", c / 100, c % 100);

    let meses = [
        "202512", "202601", "202602", "202603", "202604", "202605", "202606", "202607",
    ];
    let mut pa_por_mes: Vec<Vec<Vec<String>>> = Vec::new();
    let mut rd_por_mes: Vec<Vec<Vec<String>>> = Vec::new();
    let mut er_por_mes: Vec<Vec<Vec<String>>> = Vec::new();
    for (mes_i, mes) in meses.iter().enumerate() {
        let (ano, m) = (&mes[..4], mes[4..].trim_start_matches('0'));
        let mut pa: Vec<Vec<String>> = Vec::new();
        // Linha do PA: unidade, mês, procedimento, qtd aprovada, valor aprovado, financiamento,
        // qtd apresentada, valor apresentado, incremento.
        let mut linha = |cnes: &str, proc_: &str, qtd: i64, fin: &str, apres: i64, inc: i64| {
            let sa = valor_sa(proc_);
            pa.push(vec![
                cnes.into(),
                (*mes).into(),
                proc_.into(),
                qtd.to_string(),
                dinheiro(qtd * sa + inc),
                fin.into(),
                (qtd + apres).to_string(),
                dinheiro((qtd + apres) * sa),
                dinheiro(inc),
            ]);
        };
        for (i, proc_) in ambulatoriais.iter().enumerate() {
            // Cresce nos últimos meses; o 1º procedimento teve apresentado maior que o aprovado, o 2º
            // recebeu incremento e o 3º é financiado por outro tipo.
            let base = 120 - 10 * i as i64 + 6 * mes_i as i64;
            let (apres, inc) = match i {
                0 => (base / 5, 0),
                1 => (0, base * valor_sa(proc_) / 10),
                _ => (0, 0),
            };
            let fin = if i == 2 { "04" } else { "06" };
            linha(&cnes_minha, proc_, base, fin, apres, inc);
        }
        for proc_ in so38.iter().chain(&falta_hab).chain(&so_servico) {
            linha(&cnes_minha, proc_, 15 + mes_i as i64, "06", 0, 0);
        }
        // O último mês chega incompleto: três vizinhos ainda não enviaram.
        let ativos = if mes_i == meses.len() - 1 { 7 } else { 10 };
        for (i, v) in vizinhos.iter().take(ativos).enumerate() {
            linha(v, &primeiro, 300 - 20 * i as i64, "06", 0, 0);
            for (j, proc_) in nao_produzidos.iter().enumerate() {
                linha(v, proc_, 200 - 10 * i as i64 - 15 * j as i64, "06", 0, 0);
            }
        }
        pa_por_mes.push(pa);

        let mut rd: Vec<Vec<String>> = Vec::new();
        let mut aih = |cnes: &str, proc_: &str, n: usize| {
            for k in 0..n {
                rd.push(vec![
                    cnes.into(),
                    ano.into(),
                    m.into(),
                    proc_.into(),
                    "1250.75".into(),
                    "06".into(),
                    (4 + (k % 4)).to_string(),
                    (if k % 3 == 0 { 2 } else { 0 }).to_string(),
                ]);
            }
        };
        for (i, proc_) in hospitalares.iter().enumerate() {
            aih(&cnes_minha, proc_, 6 - i + mes_i % 3);
        }
        for v in vizinhos.iter().take(3) {
            aih(v, hospitalares.first().unwrap_or(&primeiro), 4);
        }
        rd_por_mes.push(rd);

        let mut er: Vec<Vec<String>> = Vec::new();
        for (motivo, n) in [
            ("020069", 3 + mes_i % 3),
            ("020075", 1),
            ("020081", mes_i % 2),
        ] {
            for _ in 0..n {
                er.push(vec![
                    cnes_minha.clone(),
                    ano.into(),
                    m.into(),
                    motivo.into(),
                ]);
            }
        }
        for v in vizinhos.iter().take(2) {
            er.push(vec![v.clone(), ano.into(), m.into(), "020069".into()]);
        }
        er_por_mes.push(er);
    }
    let escrever = |nome: &str, bytes: Vec<u8>| std::fs::write(saida.join(nome), bytes).unwrap();
    for (i, mes) in meses.iter().enumerate() {
        let aamm = &mes[2..];
        escrever(
            &format!("PAMS{aamm}a.dbc"),
            de_dbf_sintetico(&dbf(
                &[
                    ("PA_CODUNI", 7),
                    ("PA_MVM", 6),
                    ("PA_PROC_ID", 10),
                    ("PA_QTDAPR", 8),
                    ("PA_VALAPR", 12),
                    ("PA_TPFIN", 2),
                    ("PA_QTDPRO", 8),
                    ("PA_VALPRO", 12),
                    ("PA_VL_INC", 12),
                ],
                &pa_por_mes[i],
            )),
        );
        escrever(
            &format!("RDMS{aamm}.dbc"),
            de_dbf_sintetico(&dbf(
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
                &rd_por_mes[i],
            )),
        );
        escrever(
            &format!("ERMS{aamm}.dbc"),
            de_dbf_sintetico(&dbf(
                &[("CNES", 7), ("ANO", 4), ("MES", 2), ("CO_ERRO", 6)],
                &er_por_mes[i],
            )),
        );
    }
    eprintln!(
        "gerados em {}: {} meses; unidade {cnes_minha}; {} vizinhos; só 38.xx {so38:?}; falta habilitação {falta_hab:?}; só serviço {so_servico:?}; não produzidos {nao_produzidos:?}",
        saida.display(),
        meses.len(),
        vizinhos.len()
    );
    drop(q);
    let _ = std::fs::remove_dir_all(dados);
}

/// Arquivos **reais** do DATASUS (baixados em 05/10/2026): `ERMS2607.dbc` e `TAB_SIH.zip`. Fora do
/// repositório (`dados_dev\producao_real`; o ER traz número de AIH). `SA_PRODUCAO_REAL` = essa pasta.
#[test]
fn er_e_motivos_reais_de_ms_carregam_e_casam() {
    let Ok(pasta) = std::env::var("SA_PRODUCAO_REAL") else {
        eprintln!("pulado: defina SA_PRODUCAO_REAL");
        return;
    };
    let pasta = PathBuf::from(pasta);
    if !pasta.join("ERMS2607.dbc").exists() || !pasta.join("TAB_SIH.zip").exists() {
        eprintln!(
            "pulado: faltam ERMS2607.dbc e TAB_SIH.zip em {}",
            pasta.display()
        );
        return;
    }
    let dados = std::env::temp_dir().join(format!("sa_un_prod_er_real_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dados);
    std::fs::create_dir_all(&dados).unwrap();
    let p = Pastas {
        dados: dados.clone(),
    };
    let msg = sa_unidade::producao::importar_producao(&p, &pasta, "MS", &|_| {}).unwrap();
    eprintln!("{msg}");
    assert!(msg.contains("641 descrições oficiais"), "{msg}");
    assert!(!msg.contains("ainda não foram conferidos"), "{msg}");
    assert!(
        std::fs::read_dir(arquivos_producao(&p, "MS"))
            .unwrap()
            .next()
            .is_none(),
        "o ER real (com número de AIH) não pode ficar guardado"
    );
    let conn = Connection::open(dados.join("producao").join("MS.db")).unwrap();
    let (total, motivos, sem_descricao): (i64, i64, i64) = (
        conn.query_row("SELECT sum(qtd) FROM rej_hosp", [], |r| r.get(0)).unwrap(),
        conn.query_row("SELECT count(DISTINCT motivo) FROM rej_hosp", [], |r| r.get(0)).unwrap(),
        conn.query_row(
            "SELECT count(DISTINCT motivo) FROM rej_hosp WHERE motivo NOT IN (SELECT codigo FROM moterro)",
            [],
            |r| r.get(0),
        )
        .unwrap(),
    );
    eprintln!(
        "ER real MS 07/2026: {total} rejeições, {motivos} motivos, {sem_descricao} sem descrição"
    );
    assert_eq!(total, 847);
    assert!(
        sem_descricao <= 1,
        "só 060225 ficou sem descrição na conferência de 05/10/2026"
    );
    let colunas: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('rej_hosp')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(colunas, ["arq", "cnes", "comp", "motivo", "qtd"]);
    drop(conn);
    let _ = std::fs::remove_dir_all(dados);
}

/// B4 da Fase 4: a produção **real** de MS (SIA e SIH, 07/2026) contra a regra de aptidão da Fase 3.
/// Quem produziu e foi aprovado passou nas críticas do SIA/SIH; se a regra de aptidão diz "não apto"
/// para muitos deles, a regra está errada (ou o serviço é terceirizado, que o arquivo público do CNES
/// não traz). Não afirma nada sobre a regra: imprime os números. `SA_PRODUCAO_BANCO` = `producao\MS.db`
/// baixado de verdade, `SA_CNES_BANCO_MS` e `SA_SIGTAP_BANCO_CONSULTA` como nos outros testes.
#[test]
fn producao_real_de_ms_contra_a_regra_de_aptidao() {
    let (Some((sig_db, ms_db)), Ok(prod)) = (preparado(), std::env::var("SA_PRODUCAO_BANCO"))
    else {
        eprintln!("pulado: defina SA_PRODUCAO_BANCO (o producao/MS.db real)");
        return;
    };
    let dados = std::env::temp_dir().join(format!("sa_un_prod_b4_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dados);
    std::fs::create_dir_all(dados.join("cnes")).unwrap();
    std::fs::copy(&ms_db, dados.join("cnes").join("MS.db")).unwrap();
    let p = Pastas {
        dados: dados.clone(),
    };
    let sig = Consulta::abrir(&sig_db).unwrap();
    let comp = sa_core::Competencia::de_texto("202607").unwrap();
    let q = consulta_cnes(&p, "MS").unwrap();
    let pc =
        Connection::open_with_flags(&prod, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    for (rotulo, tab, col) in [("SIA", "prod_amb", "qtd"), ("SIH", "prod_hosp", "aih")] {
        let procs: Vec<String> = pc
            .prepare(&format!(
                "SELECT DISTINCT proc FROM {tab} WHERE comp = '202607' AND {col} > 0 ORDER BY proc"
            ))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let (mut com_exigencia, mut sem_exigencia, mut pares, mut pares_aptos, mut sem_cadastro) =
            (0u64, 0u64, 0u64, 0u64, 0u64);
        let (mut so_hab, mut so_serv, mut hab_e_serv) = ((0u64, 0u64), (0u64, 0u64), (0u64, 0u64));
        let mut piores: Vec<(u64, String, u64, u64)> = Vec::new();
        for proc in &procs {
            let produtores: HashSet<String> = pc
                .prepare(&format!("SELECT DISTINCT cnes FROM {tab} WHERE comp = '202607' AND {col} > 0 AND proc = ?1"))
                .unwrap()
                .query_map([proc], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            let Ok(c) = q.confronto_producao(&sig, comp, proc, &produtores) else {
                continue; // procedimento que não existe no SIGTAP de 07/2026
            };
            if !c.exige {
                sem_exigencia += 1;
                continue;
            }
            com_exigencia += 1;
            pares += c.no_cadastro;
            pares_aptos += c.aptos;
            sem_cadastro += c.produtores - c.no_cadastro;
            let alvo = match (c.exige_habilitacao, c.exige_servico) {
                (true, false) => &mut so_hab,
                (false, true) => &mut so_serv,
                _ => &mut hab_e_serv,
            };
            alvo.0 += c.no_cadastro;
            alvo.1 += c.aptos;
            if c.total_nao_aptos > 0 {
                piores.push((c.total_nao_aptos, proc.clone(), c.no_cadastro, c.aptos));
            }
        }
        piores.sort_by(|a, b| b.cmp(a));
        let pct = |a: u64, b: u64| {
            if b == 0 {
                0.0
            } else {
                100.0 * a as f64 / b as f64
            }
        };
        eprintln!(
            "{rotulo} 07/2026: {} procedimentos produzidos; {com_exigencia} com exigência de habilitação/serviço, {sem_exigencia} sem; \
             pares (procedimento, estabelecimento) no cadastro: {pares}, considerados aptos pela regra: {pares_aptos} ({:.1}%); produtores fora do cadastro: {sem_cadastro}",
            procs.len(),
            pct(pares_aptos, pares)
        );
        eprintln!(
            "   só habilitação: {}/{} ({:.1}%) | só serviço: {}/{} ({:.1}%) | habilitação e serviço: {}/{} ({:.1}%)",
            so_hab.1,
            so_hab.0,
            pct(so_hab.1, so_hab.0),
            so_serv.1,
            so_serv.0,
            pct(so_serv.1, so_serv.0),
            hab_e_serv.1,
            hab_e_serv.0,
            pct(hab_e_serv.1, hab_e_serv.0)
        );
        for (n, proc, no_cad, aptos) in piores.iter().take(8) {
            eprintln!("   {proc}: {n} não aptos de {no_cad} produtores ({aptos} aptos)");
        }
    }
    drop(q);
    drop(pc);
    let _ = std::fs::remove_dir_all(dados);
}

/// Denominador da taxa de rejeição: no `ER` real cada linha é uma rejeição; uma AIH pode ter mais
/// de uma linha? Conta linhas e AIH distintas **em memória** e imprime só os dois totais (o número
/// da AIH nunca é impresso nem gravado). `SA_PRODUCAO_REAL` = `dados_dev\producao_real`.
#[test]
fn er_real_linhas_contra_aih_distintas() {
    let Ok(pasta) = std::env::var("SA_PRODUCAO_REAL") else {
        eprintln!("pulado: defina SA_PRODUCAO_REAL");
        return;
    };
    let arq = PathBuf::from(pasta).join("ERMS2607.dbc");
    let Ok(dbc) = std::fs::read(&arq) else {
        eprintln!("pulado: falta {}", arq.display());
        return;
    };
    let bytes = sa_sources::dbc::para_dbf(&dbc, 64 * 1024 * 1024).unwrap();
    let d = sa_sources::dbf::Dbf::abrir(&bytes).unwrap();
    let i = d.cabecalho.indice("AIH").expect("campo AIH");
    let mut vistas = HashSet::new();
    let mut linhas = 0usize;
    for r in d.registros() {
        linhas += 1;
        vistas.insert(r.texto(i));
    }
    eprintln!(
        "ER real MS 07/2026: {linhas} linhas, {} AIH distintas",
        vistas.len()
    );
    assert!(linhas >= vistas.len());
}

/// Cabeçalhos (só nomes de campo) dos `PA` e `RD` reais em `dados_dev\producao_real`, para decidir
/// que campos novos o manifesto pode ler. Não imprime nenhum valor de registro.
#[test]
fn cabecalhos_reais_de_pa_e_rd() {
    let Ok(pasta) = std::env::var("SA_PRODUCAO_REAL") else {
        eprintln!("pulado: defina SA_PRODUCAO_REAL");
        return;
    };
    for nome in ["PAMS2607.dbc", "RDMS2607.dbc"] {
        let Ok(dbc) = std::fs::read(PathBuf::from(&pasta).join(nome)) else {
            eprintln!("pulado: falta {nome}");
            continue;
        };
        let cab = sa_sources::dbf::Cabecalho::ler(&dbc).unwrap();
        let campos: Vec<String> = cab
            .campos
            .iter()
            .map(|c| format!("{}:{}{}", c.nome, c.tipo, c.tamanho))
            .collect();
        eprintln!("{nome}: {} registros; {}", cab.registros, campos.join(" "));
    }
}

/// Validação dos campos do esquema 2 com o `PA`/`RD` reais de 07/2026 (`dados_dev\producao_real`):
/// valor aprovado × (quantidade × valor da tabela + incremento), financiamento do arquivo × o da
/// tabela, apresentado × aprovado. Só imprime contagens e somas. `SA_SIGTAP_BANCO_CONSULTA` = sigtap.db.
#[test]
fn campos_do_esquema_2_contra_a_tabela_sigtap() {
    let (Ok(pasta), Ok(sig)) = (
        std::env::var("SA_PRODUCAO_REAL"),
        std::env::var("SA_SIGTAP_BANCO_CONSULTA"),
    ) else {
        eprintln!("pulado: defina SA_PRODUCAO_REAL e SA_SIGTAP_BANCO_CONSULTA");
        return;
    };
    let pasta = PathBuf::from(pasta);
    if !pasta.join("PAMS2607.dbc").exists() {
        eprintln!("pulado: falta PAMS2607.dbc");
        return;
    }
    let dados = std::env::temp_dir().join(format!("sa_un_prod_v2_real_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dados);
    std::fs::create_dir_all(&dados).unwrap();
    let p = Pastas {
        dados: dados.clone(),
    };
    let msg = sa_unidade::producao::importar_producao(&p, &pasta, "MS", &|_| {}).unwrap();
    eprintln!("{msg}");
    let prod = Connection::open(dados.join("producao").join("MS.db")).unwrap();
    let s = Connection::open_with_flags(&sig, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let seq: i64 = s
        .query_row(
            "SELECT max(seq) FROM sa_competencia WHERE aaaamm = '202607'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let mut tabela = std::collections::HashMap::new();
    let mut st = s
        .prepare(
            "SELECT t.co_procedimento, t.vl_sa, t.vl_sh, t.vl_sp, t.co_financiamento FROM tb_procedimento t
             JOIN tb_procedimento__vig v ON v.sa_id = t.sa_id WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1",
        )
        .unwrap();
    for l in st
        .query_map([seq], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, i64>(1)?, r.get::<_, String>(4)?),
            ))
        })
        .unwrap()
    {
        let (k, v) = l.unwrap();
        tabela.insert(k, v);
    }
    // SIA
    let mut st = prod
        .prepare("SELECT cnes, proc, fin, qtd, valor_cent, qtd_pro, valor_pro_cent, valor_inc_cent FROM prod_amb")
        .unwrap();
    let (mut n, mut exato, mut exato_sem_inc, mut fora_com_inc, mut fin_igual, mut fin_dif) =
        (0, 0, 0, 0, 0, 0);
    let (mut apres_maior, mut dif_valor, mut sem_tabela) = (0, 0i64, 0);
    let mut fins = std::collections::BTreeMap::<String, i64>::new();
    for l in st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(2)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })
        .unwrap()
    {
        let (fin, proc, qtd, val, qpro, vpro, vinc) = l.unwrap();
        *fins.entry(fin.clone()).or_default() += 1;
        let Some((vl_sa, fin_tab)) = tabela.get(&proc) else {
            sem_tabela += 1;
            continue;
        };
        if *vl_sa == 0 {
            continue;
        }
        n += 1;
        let esperado = vl_sa * qtd;
        if val == esperado + vinc {
            exato += 1;
        }
        if val == esperado {
            exato_sem_inc += 1;
        } else if vinc > 0 && val == esperado + vinc {
            fora_com_inc += 1;
        }
        if qpro > qtd {
            apres_maior += 1;
            dif_valor += vpro - val;
        }
        if &fin == fin_tab {
            fin_igual += 1;
        } else {
            fin_dif += 1;
        }
    }
    eprintln!(
        "SIA 07/2026 pares={n} valor==qtd*tabela+inc: {exato}; valor==qtd*tabela: {exato_sem_inc}; \
         só com incremento: {fora_com_inc}; apresentado>aprovado: {apres_maior} (R$ {} de diferença); \
         financiamento igual ao da tabela: {fin_igual}, diferente: {fin_dif}; sem tabela: {sem_tabela}; fin={fins:?}",
        dif_valor / 100
    );
    let (aih, dias, uti, valor): (i64, i64, i64, i64) = prod
        .query_row(
            "SELECT sum(aih), sum(dias), sum(dias_uti), sum(valor_cent) FROM prod_hosp",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    eprintln!(
        "SIH 07/2026: {aih} AIH, {dias} dias de permanência, {uti} dias de UTI, R$ {}",
        valor / 100
    );
    let _ = std::fs::remove_dir_all(dados);
}
