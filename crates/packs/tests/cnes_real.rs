//! Prova do módulo CNES com os arquivos reais (não versionados).
//!
//! `SA_CNES_DBC` = pasta com `STMS2608.dbc`, `HBMS2608.dbc`, `SRMS2608.dbc`, `LTMS2608.dbc`,
//! `EQMS2608.dbc`, `PFMS2608.dbc` (FTP do DATASUS) e, opcional, `tab_cnes/` (extraído de
//! TAB_CNES.zip). Sem a variável, o teste termina sem rodar.

use sa_packs::cnes::{BancoCnes, Filtro, Origem};
use sa_sources::cnes::{Manifesto, ler_cnv};
use sa_sources::{dbc, latin1};
use std::collections::HashSet;
use std::path::PathBuf;

fn um(b: &BancoCnes, sql: &str) -> i64 {
    b.conexao().query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn carga_de_ms_agosto_de_2026_com_privacidade() {
    let Ok(pasta) = std::env::var("SA_CNES_DBC") else {
        eprintln!("SA_CNES_DBC não definida: prova do módulo CNES não executada");
        return;
    };
    let pasta = PathBuf::from(pasta);
    let m = Manifesto::carregar();
    let mut b = BancoCnes::em_memoria().unwrap();
    let ler = |tipo: &str| {
        let nome = format!("{tipo}MS2608.dbc");
        let bruto = std::fs::read(pasta.join(&nome)).unwrap();
        (
            nome,
            bruto.len() as u64,
            dbc::para_dbf(&bruto, dbc::LIMITE_PADRAO).unwrap(),
        )
    };
    // Contagens medidas nos arquivos oficiais (cabeçalho do DBF) em 01/10/2026.
    for (tipo, esperado) in [
        ("ST", 7108),
        ("HB", 537),
        ("SR", 15968),
        ("LT", 1036),
        ("EQ", 15658),
    ] {
        let (nome, bytes, dbf) = ler(tipo);
        let o = Origem {
            uf: "MS",
            arquivo: &nome,
            sha256: "prova",
            bytes,
        };
        let c = b.carregar(&m, tipo, &o, &dbf, &Filtro::default()).unwrap();
        assert_eq!((c.lidos, c.gravados), (esperado, esperado), "{tipo}");
        assert_eq!(c.competencia, "202608", "{tipo}");
        // Completude: todos os campos do arquivo viraram coluna.
        let campos = um(
            &b,
            &format!("SELECT count(*) FROM sa_campo WHERE tipo='{tipo}' AND gravado"),
        );
        let colunas = um(
            &b,
            &format!(
                "SELECT count(*) FROM pragma_table_info('cnes_{}')",
                tipo.to_lowercase()
            ),
        );
        assert_eq!(campos, colunas, "{tipo}: colunas");
    }
    assert_eq!(
        um(&b, "SELECT count(*) FROM pragma_table_info('cnes_st')"),
        208
    );
    // Profissionais: só do estabelecimento com mais habilitações.
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
    let o = Origem {
        uf: "MS",
        arquivo: &nome,
        sha256: "prova",
        bytes,
    };
    let c = b
        .carregar(
            &m,
            "PF",
            &o,
            &dbf,
            &Filtro {
                municipios: None,
                cnes: Some(&meus),
            },
        )
        .unwrap();
    assert_eq!(c.lidos, 99946);
    assert!(c.gravados > 0 && c.gravados < c.lidos / 5, "{}", c.gravados);
    assert_eq!(
        um(
            &b,
            &format!("SELECT count(*) FROM cnes_pf WHERE cnes <> '{meu}'")
        ),
        0
    );

    // Privacidade: nenhum CPF de titular pessoa física em nenhuma tabela; profissional sem CPF/CNS.
    for t in ["st", "hb", "sr", "lt", "eq", "pf"] {
        assert_eq!(
            um(
                &b,
                &format!("SELECT count(*) FROM cnes_{t} WHERE pf_pj = '1' AND cpf_cnpj <> ''")
            ),
            0,
            "{t}"
        );
    }
    assert_eq!(
        um(&b, "SELECT count(*) FROM cnes_st WHERE pf_pj = '1'"),
        1669
    );
    assert_eq!(
        um(
            &b,
            "SELECT registros FROM sa_privacidade WHERE tipo='ST' AND campo='CPF_CNPJ'"
        ),
        1669
    );
    assert_eq!(
        um(
            &b,
            "SELECT count(*) FROM cnes_st WHERE pf_pj = '1' AND (co_banco <> '' OR co_agenc <> '' OR c_corren <> '')"
        ),
        0
    );
    assert_eq!(
        um(
            &b,
            "SELECT count(*) FROM pragma_table_info('cnes_pf') WHERE name IN ('cpf_prof','cns_prof')"
        ),
        0
    );
    // Nenhuma coluna de texto do banco guarda algo com cara de CPF de 11 dígitos de pessoa física
    // nas tabelas de estabelecimento pessoa física.
    assert!(
        um(
            &b,
            "SELECT count(*) FROM cnes_st WHERE pf_pj = '3' AND cpf_cnpj <> ''"
        ) > 0
    );

    // Filtro de município: só o município do estabelecimento escolhido.
    let mun: String = b
        .conexao()
        .query_row(
            "SELECT codufmun FROM cnes_st WHERE cnes = ?1",
            [&meu],
            |r| r.get(0),
        )
        .unwrap();
    let no_municipio = um(
        &b,
        &format!("SELECT count(*) FROM cnes_st WHERE codufmun = '{mun}'"),
    );
    let mut so_mun = BancoCnes::em_memoria().unwrap();
    let ms: HashSet<String> = [mun].into();
    let (nome, bytes, dbf) = ler("ST");
    let o = Origem {
        uf: "MS",
        arquivo: &nome,
        sha256: "prova",
        bytes,
    };
    let c = so_mun
        .carregar(
            &m,
            "ST",
            &o,
            &dbf,
            &Filtro {
                municipios: Some(&ms),
                cnes: None,
            },
        )
        .unwrap();
    assert_eq!(c.gravados as i64, no_municipio);

    // Cadastro de nomes e decodificadores (TAB_CNES.zip), quando presentes.
    let tab = pasta.join("tab_cnes");
    if tab.join("DBF/CADGERMS.dbf").exists() {
        let cad = std::fs::read(tab.join("DBF/CADGERMS.dbf")).unwrap();
        let o = Origem {
            uf: "MS",
            arquivo: "CADGERMS.dbf",
            sha256: "prova",
            bytes: cad.len() as u64,
        };
        let c = b.carregar_cadastro(&m, &o, &cad).unwrap();
        assert!(c.gravados <= 7108 && c.gravados > 7000, "{}", c.gravados);
        assert_eq!(
            um(
                &b,
                "SELECT count(*) FROM cnes_cad c JOIN cnes_st s ON s.cnes = c.cnes WHERE s.pf_pj = '1' AND (c.cpf_cnpj <> '' OR c.raz_soci <> '' OR c.telefone <> '' OR c.email <> '')"
            ),
            0
        );
        assert!(um(&b, "SELECT count(*) FROM cnes_cad WHERE fantasia <> ''") > 7000);
        let mut total = 0;
        for d in &m.decodificadores {
            let texto = latin1::decodificar(
                &std::fs::read(tab.join("CNV").join(&d.arquivo))
                    .unwrap_or_else(|e| panic!("{}: {e}", d.arquivo)),
            );
            let mapa = ler_cnv(&texto);
            assert!(!mapa.is_empty(), "{}", d.arquivo);
            total += b
                .gravar_decodificador(&d.campos.join("+"), &d.arquivo, &mapa)
                .unwrap();
        }
        assert!(total > 300, "{total}");
        // Todo tipo de estabelecimento, leito e equipamento em uso tem descrição.
        for (campo, sql) in [
            ("TP_UNID", "SELECT DISTINCT tp_unid FROM cnes_st"),
            ("TP_LEITO", "SELECT DISTINCT tp_leito FROM cnes_lt"),
            ("CODLEITO", "SELECT DISTINCT codleito FROM cnes_lt"),
            ("TPGESTAO", "SELECT DISTINCT tpgestao FROM cnes_st"),
        ] {
            let sem = um(
                &b,
                &format!(
                    "SELECT count(*) FROM ({sql}) x WHERE NOT EXISTS (SELECT 1 FROM cnes_decod d WHERE d.campo = '{campo}' AND d.codigo = x.{})",
                    campo.to_lowercase()
                ),
            );
            // Achado real (01/10/2026): TP_UNID "16" aparece em 1 estabelecimento de MS e não está
            // em TP_ESTAB.CNV. O programa mostra o código sem inventar nome.
            let tolerado = i64::from(campo == "TP_UNID");
            assert!(sem <= tolerado, "{campo}: {sem} códigos sem descrição");
        }
        let eq_sem = um(
            &b,
            "SELECT count(*) FROM (SELECT DISTINCT tipequip || codequip AS c FROM cnes_eq) x WHERE NOT EXISTS (SELECT 1 FROM cnes_decod d WHERE d.campo = 'TIPEQUIP+CODEQUIP' AND d.codigo = x.c)",
        );
        assert_eq!(eq_sem, 0, "equipamentos sem descrição");
    }
}
