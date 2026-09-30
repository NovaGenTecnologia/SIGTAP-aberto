//! Carga, reconstrução, retroativo, republicação e remoção com ZIPs sintéticos que imitam
//! os casos reais do SIGTAP: largura fixa, LF dentro do texto, linhas repetidas, ordem física
//! fora da ordem de bytes, mudança de leiaute (largura e coluna nova), tabela que aparece e
//! some.

use sa_core::Competencia;
use sa_packs::sigtap::BancoSigtap;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

/// Tabela sintética: nome, leiaute e dados.
type Tabela = (&'static str, Vec<u8>, Vec<u8>);

fn leiaute(cols: &[(&str, usize, &str)]) -> Vec<u8> {
    let mut s = String::from("Coluna,Tamanho,Inicio,Fim,Tipo\r\n");
    let mut ini = 1;
    for (n, t, tipo) in cols {
        s.push_str(&format!("{n},{t},{ini},{},{tipo}\r\n", ini + t - 1));
        ini += t;
    }
    s.into_bytes()
}

fn dados(regs: &[&[u8]]) -> Vec<u8> {
    let mut v = Vec::new();
    for r in regs {
        v.extend_from_slice(r);
        v.extend_from_slice(b"\r\n");
    }
    v
}

fn criar_zip(dir: &Path, nome: &str, tabs: &[Tabela]) -> PathBuf {
    let p = dir.join(nome);
    let mut w = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
    for (t, l, d) in tabs {
        w.start_file(format!("{t}_layout.txt"), SimpleFileOptions::default())
            .unwrap();
        w.write_all(l).unwrap();
        w.start_file(format!("{t}.txt"), SimpleFileOptions::default())
            .unwrap();
        w.write_all(d).unwrap();
    }
    w.finish().unwrap();
    p
}

fn dir_temp(rotulo: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sa-packs-{rotulo}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn c(t: &str) -> Competencia {
    Competencia::de_texto(t).unwrap()
}

/// Quatro competências. `tb_proc`: VL_SH passa de 4 para 6 posições em 202603 e ganha
/// TP_SEXO em 202604. `rl_x`: ordem física fora da ordem de bytes, linha repetida, LF no
/// texto; some em 202603 e volta em 202604.
fn cenario() -> Vec<(&'static str, Vec<Tabela>)> {
    let l1 = leiaute(&[
        ("CO_PROC", 4, "VARCHAR2"),
        ("NO_PROC", 8, "VARCHAR2"),
        ("VL_SH", 4, "NUMBER"),
        ("DT_COMPETENCIA", 6, "CHAR"),
    ]);
    let l2 = leiaute(&[
        ("CO_PROC", 4, "VARCHAR2"),
        ("NO_PROC", 8, "VARCHAR2"),
        ("VL_SH", 6, "NUMBER"),
        ("DT_COMPETENCIA", 6, "CHAR"),
    ]);
    let l3 = leiaute(&[
        ("CO_PROC", 4, "VARCHAR2"),
        ("NO_PROC", 8, "VARCHAR2"),
        ("VL_SH", 6, "NUMBER"),
        ("TP_SEXO", 1, "VARCHAR2"),
        ("DT_COMPETENCIA", 6, "CHAR"),
    ]);
    let lx = leiaute(&[
        ("CO_PROC", 4, "VARCHAR2"),
        ("DS", 6, "VARCHAR2"),
        ("DT_COMPETENCIA", 6, "DATE"),
    ]);
    vec![
        (
            "202601",
            vec![
                (
                    "tb_proc",
                    l1.clone(),
                    dados(&[b"0001Consulta0010202601", b"0002 Exame  0200202601"]),
                ),
                (
                    "rl_x",
                    lx.clone(),
                    dados(&[
                        b"0002b\nc   202601",
                        b"0001a     202601",
                        b"0001a     202601",
                    ]),
                ),
            ],
        ),
        (
            "202602",
            vec![
                (
                    "tb_proc",
                    l1.clone(),
                    dados(&[
                        b"0001Consulta0010202602",
                        b"0002 Exame  0250202602",
                        b"0003Cirurgia9999202602",
                    ]),
                ),
                (
                    "rl_x",
                    lx.clone(),
                    dados(&[
                        b"0002b\nc   202602",
                        b"0001a     202602",
                        b"0001a     202602",
                    ]),
                ),
            ],
        ),
        (
            "202603",
            vec![(
                "tb_proc",
                l2.clone(),
                dados(&[b"0001Consulta000010202603", b"0003Cirurgia009999202603"]),
            )],
        ),
        (
            "202604",
            vec![
                (
                    "tb_proc",
                    l3.clone(),
                    dados(&[b"0001Consulta000010A202604", b"0003Cirurgia009999M202604"]),
                ),
                (
                    "rl_x",
                    lx.clone(),
                    dados(&[b"0003z     202604", b"0001a     202604"]),
                ),
            ],
        ),
    ]
}

fn gerar(dir: &Path) -> Vec<(Competencia, PathBuf, Vec<Tabela>)> {
    cenario()
        .into_iter()
        .map(|(comp, tabs)| {
            let p = criar_zip(
                dir,
                &format!("TabelaUnificada_{comp}_v2610010000.zip"),
                &tabs,
            );
            (c(comp), p, tabs)
        })
        .collect()
}

fn conferir_reconstrucao(b: &BancoSigtap, casos: &[(Competencia, PathBuf, Vec<Tabela>)]) {
    for (comp, _, tabs) in casos {
        let mut esperadas: Vec<&str> = tabs.iter().map(|t| t.0).collect();
        esperadas.sort_unstable();
        assert_eq!(b.tabelas(*comp).unwrap(), esperadas, "{comp}");
        for (t, l, d) in tabs {
            assert_eq!(
                &b.exportar_tabela(*comp, t).unwrap().unwrap(),
                d,
                "{t} em {comp}"
            );
            assert_eq!(
                &b.exportar_leiaute(*comp, t).unwrap().unwrap(),
                l,
                "leiaute {t} em {comp}"
            );
        }
    }
}

#[test]
fn carga_sequencial_reconstroi_byte_a_byte() {
    let d = dir_temp("seq");
    let casos = gerar(&d);
    let mut b = BancoSigtap::em_memoria().unwrap();
    for (_, p, _) in &casos {
        b.carregar_zip(p).unwrap();
    }
    conferir_reconstrucao(&b, &casos);
    // Tabela ausente numa competência não aparece nela.
    assert_eq!(b.exportar_tabela(c("202603"), "rl_x").unwrap(), None);
    // VL_SH mudou de largura sem mudar valor: "0001 Consulta 10" é um só conteúdo.
    let n: i64 = b
        .conexao()
        .query_row(
            "SELECT count(*) FROM tb_proc WHERE co_proc = '0001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        n, 2,
        "um conteúdo sem TP_SEXO (202601–202603) e outro com TP_SEXO (202604)"
    );
    let iv: (i64, i64) = b
        .conexao()
        .query_row(
            "SELECT v.vig_ini, v.vig_fim FROM tb_proc c JOIN tb_proc__vig v USING(sa_id)
             WHERE c.co_proc = '0001' AND c.tp_sexo IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(iv, (c("202601").seq(), c("202603").seq()));
}

#[test]
fn qualquer_ordem_de_carga_da_o_mesmo_banco() {
    let d = dir_temp("ordens");
    let casos = gerar(&d);
    let mut seq = BancoSigtap::em_memoria().unwrap();
    for (_, p, _) in &casos {
        seq.carregar_zip(p).unwrap();
    }
    let esperado = seq.resumo_logico().unwrap();
    for ordem in [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 2, 1, 3]] {
        let mut b = BancoSigtap::em_memoria().unwrap();
        for i in ordem {
            b.carregar_zip(&casos[i].1).unwrap();
        }
        assert_eq!(b.resumo_logico().unwrap(), esperado, "ordem {ordem:?}");
        conferir_reconstrucao(&b, &casos);
    }
}

#[test]
fn republicacao_substitui_e_volta_ao_original() {
    let d = dir_temp("repub");
    let casos = gerar(&d);
    let mut b = BancoSigtap::em_memoria().unwrap();
    for (_, p, _) in &casos {
        b.carregar_zip(p).unwrap();
    }
    let original = b.resumo_logico().unwrap();
    // 202602 republicado: um valor muda, um registro sai, a rl_x some.
    let l1 = leiaute(&[
        ("CO_PROC", 4, "VARCHAR2"),
        ("NO_PROC", 8, "VARCHAR2"),
        ("VL_SH", 4, "NUMBER"),
        ("DT_COMPETENCIA", 6, "CHAR"),
    ]);
    let novo: Vec<Tabela> = vec![(
        "tb_proc",
        l1,
        dados(&[b"0001Consulta0011202602", b"0003Cirurgia9999202602"]),
    )];
    let dir2 = d.join("republicado");
    std::fs::create_dir_all(&dir2).unwrap();
    let p = criar_zip(&dir2, "TabelaUnificada_202602_v2610020000.zip", &novo);
    let r = b.carregar_zip(&p).unwrap();
    assert!(r.substituiu);
    let mut esperados = casos.clone_sem_caminho();
    esperados[1].2 = novo;
    conferir_reconstrucao(&b, &esperados);
    // Recarregar o original devolve exatamente o banco anterior.
    b.carregar_zip(&casos[1].1).unwrap();
    assert_eq!(b.resumo_logico().unwrap(), original);
}

#[test]
fn remover_e_recarregar_devolve_o_mesmo_banco() {
    let d = dir_temp("remover");
    let casos = gerar(&d);
    let mut b = BancoSigtap::em_memoria().unwrap();
    for (_, p, _) in &casos {
        b.carregar_zip(p).unwrap();
    }
    let original = b.resumo_logico().unwrap();
    for i in 0..casos.len() {
        b.remover(casos[i].0).unwrap();
        let restantes: Vec<_> = casos
            .clone_sem_caminho()
            .into_iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, x)| x)
            .collect();
        conferir_reconstrucao(&b, &restantes);
        assert!(
            b.exportar_tabela(casos[i].0, "tb_proc").is_err(),
            "competência removida não pode ser consultada"
        );
        b.carregar_zip(&casos[i].1).unwrap();
        assert_eq!(
            b.resumo_logico().unwrap(),
            original,
            "remover e recarregar {}",
            casos[i].0
        );
    }
    // Remover todas deixa o banco vazio (sem conteúdo órfão).
    for (comp, _, _) in &casos {
        b.remover(*comp).unwrap();
    }
    assert_eq!(b.contagens().unwrap(), (0, 0));
}

#[test]
fn recusa_dt_competencia_diferente_do_nome() {
    let d = dir_temp("dtcomp");
    let l = leiaute(&[("CO", 2, "VARCHAR2"), ("DT_COMPETENCIA", 6, "CHAR")]);
    let p = criar_zip(
        &d,
        "TabelaUnificada_202601.zip",
        &[("tb_a", l, dados(&[b"01202512"]))],
    );
    let mut b = BancoSigtap::em_memoria().unwrap();
    let e = b.carregar_zip(&p).unwrap_err().to_string();
    assert!(e.contains("DT_COMPETENCIA"), "{e}");
    assert!(
        b.competencias().unwrap().is_empty(),
        "carga com erro não deixa nada gravado"
    );
}

#[test]
fn recusa_number_fora_da_regra() {
    let d = dir_temp("number");
    let l = leiaute(&[("CO", 2, "VARCHAR2"), ("QT", 3, "NUMBER")]);
    let p = criar_zip(
        &d,
        "TabelaUnificada_202601.zip",
        &[("tb_a", l, dados(&[b"01 12"]))],
    );
    let mut b = BancoSigtap::em_memoria().unwrap();
    let e = b.carregar_zip(&p).unwrap_err().to_string();
    assert!(e.contains("NUMBER") && e.contains("interrompida"), "{e}");
}

#[test]
fn proveniencia_guardada() {
    let d = dir_temp("proven");
    let casos = gerar(&d);
    let mut b = BancoSigtap::em_memoria().unwrap();
    b.carregar_zip(&casos[0].1).unwrap();
    let cs = b.competencias().unwrap();
    assert_eq!(cs.len(), 1);
    assert_eq!(cs[0].arquivo, "TabelaUnificada_202601_v2610010000.zip");
    assert_eq!(cs[0].versao.as_deref(), Some("2610010000"));
    assert_eq!(cs[0].sha256.len(), 64);
}

/// Cópia dos casos só com competência e tabelas (o caminho não importa para conferir).
trait ClonarCasos {
    fn clone_sem_caminho(&self) -> Vec<(Competencia, PathBuf, Vec<Tabela>)>;
}

impl ClonarCasos for Vec<(Competencia, PathBuf, Vec<Tabela>)> {
    fn clone_sem_caminho(&self) -> Vec<(Competencia, PathBuf, Vec<Tabela>)> {
        self.iter()
            .map(|(c, p, t)| {
                (
                    *c,
                    p.clone(),
                    t.iter()
                        .map(|(n, l, d)| (*n, l.clone(), d.clone()))
                        .collect(),
                )
            })
            .collect()
    }
}
