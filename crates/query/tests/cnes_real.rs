//! Prova dos cruzamentos SIGTAP × CNES com dados reais (não versionados).
//!
//! `SA_SIGTAP_BANCO_CONSULTA` = banco do SIGTAP com 202608 e 202609; `SA_CNES_DBC` = pasta com os
//! `.dbc` de MS de 08/2026 e `tab_cnes/` (ver `docs/fontes/cnes.md`). Sem as duas, não roda.

use rusqlite::Connection;
use sa_core::Competencia;
use sa_packs::cnes::{BancoCnes, Filtro, Origem};
use sa_query::Consulta;
use sa_query::cnes::ConsultaCnes;
use sa_sources::cnes::{Manifesto, ler_cnv};
use sa_sources::{dbc, latin1};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

fn preparado() -> Option<(PathBuf, PathBuf)> {
    let sig = PathBuf::from(std::env::var("SA_SIGTAP_BANCO_CONSULTA").ok()?);
    let cnes = PathBuf::from(std::env::var("SA_CNES_DBC").ok()?);
    (sig.exists() && cnes.join("STMS2608.dbc").exists()).then_some((sig, cnes))
}

/// Monta o banco do CNES de MS (08/2026) com tudo: tabelas, nomes, decodificadores e os
/// profissionais do estabelecimento com mais habilitações.
fn montar(pasta: &Path) -> (PathBuf, String) {
    let m = Manifesto::carregar();
    let arq = std::env::temp_dir().join(format!("sa_q_cnes_{}.db", std::process::id()));
    let _ = std::fs::remove_file(&arq);
    let mut b = BancoCnes::abrir(&arq).unwrap();
    let ler = |tipo: &str| {
        let nome = format!("{tipo}MS2608.dbc");
        let bruto = std::fs::read(pasta.join(&nome)).unwrap();
        (
            nome,
            bruto.len() as u64,
            dbc::para_dbf(&bruto, dbc::LIMITE_PADRAO).unwrap(),
        )
    };
    for tipo in ["ST", "HB", "SR", "LT", "EQ"] {
        let (nome, bytes, dbf) = ler(tipo);
        b.carregar(
            &m,
            tipo,
            &Origem {
                uf: "MS",
                arquivo: &nome,
                sha256: "prova",
                bytes,
            },
            &dbf,
            &Filtro::default(),
        )
        .unwrap();
    }
    let meu: String = b
        .conexao()
        .query_row(
            "SELECT cnes FROM cnes_hb GROUP BY cnes ORDER BY count(*) DESC, cnes LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let meus: HashSet<String> = [meu.clone()].into();
    let (nome, bytes, dbf) = ler("PF");
    b.carregar(
        &m,
        "PF",
        &Origem {
            uf: "MS",
            arquivo: &nome,
            sha256: "prova",
            bytes,
        },
        &dbf,
        &Filtro {
            municipios: None,
            cnes: Some(&meus),
        },
    )
    .unwrap();
    let tab = pasta.join("tab_cnes");
    if tab.join("DBF/CADGERMS.dbf").exists() {
        let cad = std::fs::read(tab.join("DBF/CADGERMS.dbf")).unwrap();
        b.carregar_cadastro(
            &m,
            &Origem {
                uf: "MS",
                arquivo: "CADGERMS.dbf",
                sha256: "prova",
                bytes: cad.len() as u64,
            },
            &cad,
        )
        .unwrap();
        for d in &m.decodificadores {
            let t = latin1::decodificar(&std::fs::read(tab.join("CNV").join(&d.arquivo)).unwrap());
            b.gravar_decodificador(&d.chave(), &d.arquivo, &ler_cnv(&t))
                .unwrap();
        }
    }
    drop(b);
    (arq, meu)
}

fn vigentes(sig: &Connection, comp: &str, sql_colunas: &str, tabela: &str) -> Vec<Vec<String>> {
    let seq: i64 = sig
        .query_row(
            "SELECT seq FROM sa_competencia WHERE aaaamm = ?1",
            [comp],
            |r| r.get(0),
        )
        .unwrap();
    let n = sql_colunas.split(',').count();
    let mut st = sig
        .prepare(&format!("SELECT {sql_colunas} FROM {tabela} t JOIN {tabela}__vig v ON v.sa_id = t.sa_id WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1"))
        .unwrap();
    st.query_map([seq], |r| {
        (0..n)
            .map(|i| r.get::<_, Option<String>>(i).map(Option::unwrap_or_default))
            .collect()
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

#[test]
fn cruzamentos_de_ms_reproduzem_os_numeros_de_referencia() {
    let Some((p_sig, p_cnes)) = preparado() else {
        eprintln!(
            "SA_SIGTAP_BANCO_CONSULTA/SA_CNES_DBC não definidas: prova dos cruzamentos não executada"
        );
        return;
    };
    let (arq_cnes, meu) = montar(&p_cnes);
    let banco = BancoCnes::abrir(&arq_cnes).unwrap();
    let sig_sql = Connection::open(&p_sig).unwrap();
    let um = |sql: &str| -> i64 { banco.conexao().query_row(sql, [], |r| r.get(0)).unwrap() };

    // 1. Chaves de junção, CNES 08/2026 × SIGTAP 08/2026 (números do documento-mestre).
    let hab: HashSet<String> = vigentes(&sig_sql, "202608", "t.co_habilitacao", "tb_habilitacao")
        .into_iter()
        .map(|v| v[0].clone())
        .collect();
    let sc: HashSet<(String, String)> = vigentes(
        &sig_sql,
        "202608",
        "t.co_servico, t.co_classificacao",
        "tb_servico_classificacao",
    )
    .into_iter()
    .map(|v| (v[0].clone(), v[1].clone()))
    .collect();
    let mut st = banco
        .conexao()
        .prepare("SELECT sgruphab FROM cnes_hb")
        .unwrap();
    let hb: Vec<String> = st
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        (hb.iter().filter(|h| hab.contains(*h)).count(), hb.len()),
        (537, 537),
        "HB"
    );
    let mut st = banco
        .conexao()
        .prepare("SELECT serv_esp, class_sr FROM cnes_sr")
        .unwrap();
    let sr: Vec<(String, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        (sr.iter().filter(|p| sc.contains(*p)).count(), sr.len()),
        (15_947, 15_968),
        "SR"
    );
    // Leitos: os 1.036 registros de LT pertencem a estabelecimentos de ST; e quantos têm tipo
    // de leito do SIGTAP pelo manifesto (correspondência não confirmada).
    assert_eq!(
        um(
            "SELECT count(*) FROM cnes_lt l WHERE EXISTS (SELECT 1 FROM cnes_st s WHERE s.cnes = l.cnes)"
        ),
        1036
    );
    let m = Manifesto::carregar();
    let lt_sig: HashSet<String> = vigentes(&sig_sql, "202608", "t.co_tipo_leito", "tb_tipo_leito")
        .into_iter()
        .map(|v| v[0].clone())
        .collect();
    let mut st = banco
        .conexao()
        .prepare("SELECT tp_leito, codleito FROM cnes_lt")
        .unwrap();
    let lt: Vec<(String, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let com_tipo = lt
        .iter()
        .filter(|(tp, cod)| {
            lt_sig.contains(cod)
                || m.leitos
                    .iter()
                    .any(|l| l.tp_leito.contains(tp) || l.codleito.contains(cod))
        })
        .count();
    eprintln!(
        "leitos com tipo do SIGTAP pelo manifesto: {com_tipo} de {}",
        lt.len()
    );
    assert!(
        com_tipo * 100 >= lt.len() * 95,
        "{com_tipo} de {}",
        lt.len()
    );

    // 2. Aptidão. Número do documento-mestre (SIGTAP 202609 × CNES 202608, E entre habilitação e
    //    serviço, OU simples entre habilitações): 3.563 de 3.728, refeito aqui por conta própria.
    let ph = vigentes(
        &sig_sql,
        "202609",
        "t.co_procedimento, t.co_habilitacao, t.nu_grupo_habilitacao",
        "rl_procedimento_habilitacao",
    );
    let ps = vigentes(
        &sig_sql,
        "202609",
        "t.co_procedimento, t.co_servico, t.co_classificacao",
        "rl_procedimento_servico",
    );
    let mut rh: HashMap<String, Vec<(String, String)>> = HashMap::new();
    let mut rs: HashMap<String, HashSet<(String, String)>> = HashMap::new();
    for v in &ph {
        rh.entry(v[0].clone())
            .or_default()
            .push((v[1].clone(), v[2].clone()));
    }
    for v in &ps {
        rs.entry(v[0].clone())
            .or_default()
            .insert((v[1].clone(), v[2].clone()));
    }
    let mut hab_cnes: HashMap<String, HashSet<String>> = HashMap::new();
    let mut st = banco
        .conexao()
        .prepare("SELECT cnes, sgruphab, cmpt_ini, cmpt_fim FROM cnes_hb")
        .unwrap();
    for l in st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .unwrap()
    {
        let (c, h, ini, fim) = l.unwrap();
        if ini.as_str() <= "202608" && (fim.is_empty() || fim.as_str() >= "202608") {
            hab_cnes.entry(c).or_default().insert(h);
        }
    }
    let mut sr_cnes: HashMap<String, HashSet<(String, String)>> = HashMap::new();
    for (c, p) in banco
        .conexao()
        .prepare("SELECT cnes, serv_esp, class_sr FROM cnes_sr")
        .unwrap()
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
            ))
        })
        .unwrap()
        .map(Result::unwrap)
    {
        sr_cnes.entry(c).or_default().insert(p);
    }
    let cnes_todos: Vec<String> = banco
        .conexao()
        .prepare("SELECT cnes FROM cnes_st")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let vazio_h = HashSet::new();
    let vazio_s = HashSet::new();
    let exigem: HashSet<&String> = rh.keys().chain(rs.keys()).collect();
    assert_eq!(exigem.len(), 3728);
    // Regra do programa, refeita aqui: avulsa = alternativa; grupo = todas as do grupo.
    let atende_h = |p: &String, tem: &HashSet<String>, simples: bool| -> bool {
        let Some(l) = rh.get(p) else { return true };
        if simples {
            return l.iter().any(|(h, _)| tem.contains(h));
        }
        let mut grupos: HashMap<&String, Vec<&String>> = HashMap::new();
        for (h, g) in l {
            if g.is_empty() {
                if tem.contains(h) {
                    return true;
                }
            } else {
                grupos.entry(g).or_default().push(h);
            }
        }
        grupos
            .values()
            .any(|hs| hs.iter().all(|h| tem.contains(*h)))
    };
    let atende_s = |p: &String, tem: &HashSet<(String, String)>| {
        rs.get(p).is_none_or(|l| l.iter().any(|x| tem.contains(x)))
    };
    let conta = |simples: bool| {
        exigem
            .iter()
            .filter(|p| {
                cnes_todos.iter().any(|c| {
                    atende_h(p, hab_cnes.get(c).unwrap_or(&vazio_h), simples)
                        && atende_s(p, sr_cnes.get(c).unwrap_or(&vazio_s))
                })
            })
            .count() as u64
    };
    assert_eq!(conta(true), 3563, "número do documento-mestre");
    let pela_regra = conta(false);
    eprintln!("aptidão em MS: regra simples 3563; regra com grupos {pela_regra}; de 3728");

    let sig = Consulta::abrir(&p_sig).unwrap();
    let q = ConsultaCnes::abrir(&arq_cnes).unwrap();
    let c09 = Competencia::de_texto("202609").unwrap();
    assert_eq!(q.cobertura(&sig, c09).unwrap(), (3728, pela_regra));

    // 3. A unidade: contagens iguais às do banco; nomes vindos do SIGTAP e do TAB_CNES.
    let u = q.unidade(&sig, c09, &meu).unwrap().unwrap();
    assert_eq!(u.competencia_cnes, "202608");
    assert!(!u.pessoa_fisica);
    assert!(u.habilitacoes.len() >= 10, "{}", u.habilitacoes.len());
    assert!(
        u.habilitacoes.iter().all(|h| h.nome.is_some()),
        "habilitação sem nome"
    );
    assert!(
        u.servicos
            .iter()
            .filter(|s| s.servico.nome.is_some())
            .count()
            * 100
            >= u.servicos.len() * 95
    );
    assert!(
        !u.leitos.is_empty()
            && u.leitos
                .iter()
                .all(|l| l.tipo.nome.is_some() && l.especialidade.nome.is_some())
    );
    assert!(
        !u.equipamentos.is_empty() && u.equipamentos.iter().all(|e| e.equipamento.nome.is_some())
    );
    assert!(!u.nome.is_empty() && !u.gerais.is_empty());
    let prof = u.profissionais.as_ref().unwrap();
    let ocup = u.ocupacoes.as_ref().unwrap();
    assert_eq!(
        ocup.iter().map(|o| o.profissionais).sum::<u64>(),
        prof.len() as u64
    );
    assert!(ocup.iter().filter(|o| o.cbo.nome.is_some()).count() * 100 >= ocup.len() * 90);
    // Outra unidade: sem profissionais carregados.
    let outra = sig_outro(&q, &meu);
    assert!(
        q.unidade(&sig, c09, &outra)
            .unwrap()
            .unwrap()
            .profissionais
            .is_none()
    );
    assert!(q.unidade(&sig, c09, "9999999").unwrap().is_none());

    // 4. Aptidão da unidade em todos os procedimentos com exigência: igual à conta independente.
    let (mut aptos, mut conferidos) = (0, 0);
    for p in exigem.iter().take(900) {
        let a = q.aptidao(&sig, c09, p, &meu).unwrap().unwrap();
        let esperado = atende_h(p, hab_cnes.get(&meu).unwrap_or(&vazio_h), false)
            && atende_s(p, sr_cnes.get(&meu).unwrap_or(&vazio_s));
        assert_eq!(a.apta, esperado, "{p}");
        assert_eq!(
            a.apta,
            a.motivos.iter().all(|m| m.starts_with("Leito")),
            "{p}: motivos {:?}",
            a.motivos
        );
        assert!(!a.regra_confirmada);
        aptos += usize::from(a.apta);
        conferidos += 1;
    }
    eprintln!("aptidão da unidade conferida em {conferidos} procedimentos ({aptos} aptos)");
    assert!(aptos > 0 && aptos < conferidos);
    // Procedimento sem exigência: apta, sem alternativas.
    let livre = vigentes(&sig_sql, "202609", "t.co_procedimento", "tb_procedimento")
        .into_iter()
        .map(|v| v[0].clone())
        .find(|p| !exigem.contains(p))
        .unwrap();
    let a = q.aptidao(&sig, c09, &livre, &meu).unwrap().unwrap();
    assert!(a.apta && !a.habilitacao.exige && !a.servico.exige);

    // 5. Quem faz na rede: município ⊂ UF; todos os listados são aptos pela conta independente.
    let p = exigem
        .iter()
        .find(|p| rh.contains_key(**p) && rs.contains_key(**p))
        .unwrap();
    let uf = q.rede(&sig, c09, p, None, 2000).unwrap();
    assert_eq!(uf.no_escopo, 7108);
    let esperado: HashSet<&String> = cnes_todos
        .iter()
        .filter(|c| {
            atende_h(p, hab_cnes.get(*c).unwrap_or(&vazio_h), false)
                && atende_s(p, sr_cnes.get(*c).unwrap_or(&vazio_s))
        })
        .collect();
    assert_eq!(uf.aptos as usize, esperado.len());
    assert!(
        uf.estabelecimentos
            .iter()
            .all(|e| esperado.contains(&e.cnes))
    );
    let mun: HashSet<String> = [u.municipio.clone()].into();
    let m = q.rede(&sig, c09, p, Some(&mun), 2000).unwrap();
    assert!(m.aptos <= uf.aptos && m.no_escopo < uf.no_escopo);
    assert!(
        m.estabelecimentos
            .iter()
            .all(|e| e.municipio == u.municipio)
    );
    assert!(!q.rede(&sig, c09, &livre, None, 10).unwrap().exige);

    // 6. Busca de estabelecimento por número e por nome.
    assert_eq!(q.buscar(&meu, 10).unwrap()[0].cnes, meu);
    let parte: String = u
        .nome
        .split_whitespace()
        .max_by_key(|p| p.len())
        .unwrap()
        .to_lowercase();
    assert!(
        q.buscar(&parte, 200).unwrap().iter().any(|e| e.cnes == meu),
        "{parte}"
    );
    let r = q.resumo().unwrap();
    assert_eq!(
        (r.uf.as_str(), r.competencia.as_str(), r.estabelecimentos),
        ("MS", "202608", 7108)
    );
    assert_eq!(r.profissionais_de, [meu]);
    let _ = std::fs::remove_file(&arq_cnes);
}

fn sig_outro(q: &ConsultaCnes, meu: &str) -> String {
    q.buscar("0", 50)
        .unwrap()
        .into_iter()
        .map(|e| e.cnes)
        .find(|c| c != meu)
        .unwrap()
}
