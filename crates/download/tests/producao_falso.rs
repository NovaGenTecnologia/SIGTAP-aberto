//! Download da produção (PA, RD, ER) contra o servidor FTP falso e importação manual.
#![cfg(feature = "servidor-falso")]

use sa_core::Competencia;
use sa_download::cnes::Fonte;
use sa_download::cortesia::Cortesia;
use sa_download::producao;
use sa_download::servidor_falso;
use sa_sources::dbc::de_dbf_sintetico;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

fn pasta(nome: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("sa_dl_prod_{nome}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn dbf(campos: &[(&str, u8)], linhas: &[&[&str]]) -> Vec<u8> {
    let tam_reg: usize = 1 + campos.iter().map(|c| usize::from(c.1)).sum::<usize>();
    let mut b = vec![0u8; 32];
    b[0] = 3;
    b[4..8].copy_from_slice(&u32::try_from(linhas.len()).unwrap().to_le_bytes());
    b[8..10].copy_from_slice(
        &u16::try_from(32 + 32 * campos.len() + 1)
            .unwrap()
            .to_le_bytes(),
    );
    b[10..12].copy_from_slice(&u16::try_from(tam_reg).unwrap().to_le_bytes());
    for (nome, tam) in campos {
        let mut d = [0u8; 32];
        d[..nome.len()].copy_from_slice(nome.as_bytes());
        d[11] = b'C';
        d[16] = *tam;
        b.extend_from_slice(&d);
    }
    b.push(0x0D);
    for l in linhas {
        b.push(b' ');
        for (v, (_, t)) in l.iter().zip(campos) {
            let mut c = vec![b' '; usize::from(*t)];
            c[..v.len()].copy_from_slice(v.as_bytes());
            b.extend_from_slice(&c);
        }
    }
    b.push(0x1A);
    b
}

fn dbc_pa(qtd: &str) -> Vec<u8> {
    de_dbf_sintetico(&dbf(
        &[
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
        ],
        &[&["2000001", "202607", "0301010072", qtd, "1.00"]],
    ))
}

fn fonte(porta: u16) -> Fonte {
    Fonte {
        servidor: "127.0.0.1".into(),
        pasta_dados: "/dados".into(),
        tab_cnes: "/aux/TAB_CNES.zip".into(),
        cortesia: Cortesia {
            pausa_entre_arquivos: Duration::from_millis(5),
            espera_inicial: Duration::from_millis(5),
            porta,
            ..Cortesia::default()
        },
    }
}

fn servir(d: &Path, arquivos: &[(&str, Vec<u8>)]) -> u16 {
    let mut m = BTreeMap::new();
    for (n, c) in arquivos {
        std::fs::write(d.join(n), c).unwrap();
        m.insert((*n).to_string(), d.join(n));
    }
    servidor_falso::iniciar(m)
}

#[test]
fn lista_e_baixa_todas_as_partes_do_pa_so_da_uf_e_competencia_pedidas() {
    let srv = pasta("srv");
    let porta = servir(
        &srv,
        &[
            ("PAMS2607a.dbc", dbc_pa("10")),
            ("PAMS2607b.dbc", dbc_pa("20")),
            ("PAMS2606a.dbc", dbc_pa("30")),
            ("PAMT2607a.dbc", dbc_pa("40")),
            ("LEIAME.txt", b"texto".to_vec()),
        ],
    );
    let f = fonte(porta);
    let v = producao::disponiveis(&f, "PA", "MS").unwrap();
    assert_eq!(v.len(), 2, "duas competências de MS");
    assert_eq!(v[0].0, Competencia::nova(2026, 6).unwrap());
    let partes: Vec<&str> = v[1].1.iter().map(|p| p.0.as_str()).collect();
    assert_eq!(partes, ["PAMS2607a.dbc", "PAMS2607b.dbc"]);
    assert!(v[1].1.iter().all(|p| p.1 > 0));

    let dest = pasta("dest");
    let c = Competencia::nova(2026, 7).unwrap();
    let nunca = AtomicBool::new(false);
    let baixados = producao::baixar(&f, "PA", "MS", c, &dest, &nunca, |_| {}).unwrap();
    assert_eq!(baixados.len(), 2);
    let locais = producao::locais(&dest, "MS");
    assert_eq!(locais.len(), 2);
    assert!(locais.contains_key("PAMS2607b.dbc"));
    // Nada provisório ficou na pasta.
    let nomes: Vec<String> = std::fs::read_dir(&dest)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(nomes.iter().all(|n| n.ends_with(".dbc")), "{nomes:?}");
}

#[test]
fn competencia_que_o_servidor_nao_tem_recebe_orientacao() {
    let srv = pasta("srv2");
    let porta = servir(&srv, &[("PAMS2607a.dbc", dbc_pa("1"))]);
    let dest = pasta("dest2");
    let e = producao::baixar(
        &fonte(porta),
        "PA",
        "MS",
        Competencia::nova(2020, 1).unwrap(),
        &dest,
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap_err()
    .to_string();
    assert!(e.contains("não tem PA de MS"), "{e}");
    assert!(std::fs::read_dir(&dest).unwrap().next().is_none());
}

#[test]
fn arquivo_corrompido_no_servidor_nao_entra_na_pasta() {
    let srv = pasta("srv3");
    let mut ruim = dbc_pa("1");
    let n = ruim.len();
    ruim.truncate(n - 6); // fluxo cortado
    let porta = servir(&srv, &[("RDMS2607.dbc", ruim)]);
    let dest = pasta("dest3");
    let r = producao::baixar(
        &fonte(porta),
        "RD",
        "MS",
        Competencia::nova(2026, 7).unwrap(),
        &dest,
        &AtomicBool::new(false),
        |_| {},
    );
    assert!(r.is_err());
    assert!(producao::locais(&dest, "MS").is_empty());
}

#[test]
fn importacao_manual_copia_so_o_valido_da_uf() {
    let orig = pasta("orig");
    std::fs::write(orig.join("PAMS2607a.dbc"), dbc_pa("5")).unwrap();
    std::fs::write(orig.join("PAMT2607a.dbc"), dbc_pa("5")).unwrap();
    std::fs::write(orig.join("PAMS2608a.dbc"), b"isto nao e dbc").unwrap();
    std::fs::write(orig.join("qualquer.txt"), b"x").unwrap();
    let dest = pasta("imp");
    let r = producao::importar_pasta(&orig, &dest, "MS").unwrap();
    assert_eq!(r.dbc, ["PAMS2607a.dbc"]);
    assert_eq!(r.recusados.len(), 1);
    assert_eq!(r.recusados[0].0, "PAMS2608a.dbc");
    assert_eq!(producao::locais(&dest, "MS").len(), 1);
}
