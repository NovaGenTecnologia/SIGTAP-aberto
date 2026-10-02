//! Download do CNES contra o servidor FTP falso: auxiliares lidos em parte do ZIP (sem baixar
//! tudo), importação manual e, com `SA_CNES_DBC`, os `.dbc` reais.
#![cfg(feature = "servidor-falso")]

use sa_core::Competencia;
use sa_download::cnes::{self, Fonte};
use sa_download::cortesia::{Cortesia, Evento};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

fn pasta(nome: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("sa_dl_cnes_{nome}_{}", std::process::id()));
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

/// Bytes que não comprimem (gerador xorshift), para o ZIP de teste ficar grande de verdade.
fn ruido(n: usize, semente: u64) -> Vec<u8> {
    let mut x = semente.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..n)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 24) as u8
        })
        .collect()
}

/// ZIP parecido com o TAB_CNES: muita coisa que não interessa em volta do que interessa.
fn tab_cnes() -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let o = zip::write::SimpleFileOptions::default();
        let mut por = |nome: &str, c: &[u8]| {
            z.start_file(nome, o).unwrap();
            z.write_all(c).unwrap();
        };
        por("Estabelecimento.def", &vec![b';'; 20_000]);
        por(
            "CNV/TP_ESTAB.CNV",
            b"N 2 2 L\n        1  POSTO DE SAUDE     01\n        2  HOSPITAL GERAL     05\n",
        );
        por("CNV/lixo.cnv", &ruido(300_000, 7));
        por(
            "CNV/TPGESTAO.CNV",
            b"2 1 L\n      1  ESTADUAL     E\n      2  MUNICIPAL    M\n",
        );
        por("DBF/CADGERBR.dbf", &ruido(900_000, 13));
        por(
            "DBF/CADGERMS.dbf",
            &dbf(
                &[("CNES", 7), ("FANTASIA", 20)],
                &[&["0000001", "HOSPITAL A"], &["0000002", "POSTO B"]],
            ),
        );
        por("DBF/CADGERSP.dbf", &ruido(500_000, 3));
        z.finish().unwrap();
    }
    buf
}

fn fonte(arquivos: BTreeMap<String, PathBuf>) -> Fonte {
    let porta = sa_download::servidor_falso::iniciar(arquivos);
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

#[test]
fn auxiliares_baixam_so_os_trechos_necessarios_do_zip() {
    let d = pasta("aux");
    let zip = tab_cnes();
    let total = zip.len() as u64;
    std::fs::write(d.join("TAB_CNES.zip"), &zip).unwrap();
    let f = fonte([("TAB_CNES.zip".to_string(), d.join("TAB_CNES.zip"))].into());
    let destino = d.join("destino");
    let mut eventos = Vec::new();
    let a = cnes::baixar_auxiliares(
        &f,
        "MS",
        &[
            "TP_ESTAB.CNV".into(),
            "TPGESTAO.CNV".into(),
            "NAO_EXISTE.CNV".into(),
        ],
        &destino,
        &AtomicBool::new(false),
        |e| eventos.push(e),
    )
    .unwrap();
    assert_eq!(a.tamanho_do_zip, total);
    assert!(
        total > 1_500_000,
        "o ZIP de teste tem de ser grande: {total}"
    );
    // Baixou muito menos que o ZIP: índice + cadastro da UF + o trecho das duas tabelas.
    assert!(
        a.bytes_baixados < total / 2,
        "{} de {total}",
        a.bytes_baixados
    );
    assert_eq!(a.cnv_ausentes, ["NAO_EXISTE.CNV"]);
    assert_eq!(a.cnv.len(), 2);
    let cad = std::fs::read(&a.cadastro).unwrap();
    let dbf = sa_sources::dbf::Dbf::abrir(&cad).unwrap();
    assert_eq!(
        dbf.registros().map(|r| r.texto(1)).collect::<Vec<_>>(),
        ["HOSPITAL A", "POSTO B"]
    );
    let cnv = std::fs::read_to_string(destino.join("cnv").join("tp_estab.cnv")).unwrap();
    assert_eq!(
        sa_sources::cnes::ler_cnv(&cnv)
            .get("05")
            .map(String::as_str),
        Some("HOSPITAL GERAL")
    );
    assert!(
        eventos
            .iter()
            .any(|e| matches!(e, Evento::Concluido { arquivo } if arquivo == "CADGERMS.dbf"))
    );
    // UF sem cadastro no ZIP: erro claro, nada de arquivo pela metade.
    let r = cnes::baixar_auxiliares(
        &f,
        "AC",
        &[],
        &d.join("ac"),
        &AtomicBool::new(false),
        |_| {},
    );
    assert!(r.is_err());
    assert!(!d.join("ac").join("CADGERAC.dbf").exists());
    let _ = std::fs::remove_dir_all(&d);
}

/// Falha medida no DATASUS: o servidor anuncia portas de dados que recusam a conexão. O
/// download tem de pedir outra porta na mesma sessão e usar uma sessão só para todos os trechos.
#[test]
fn auxiliares_sobrevivem_a_portas_de_dados_recusadas_numa_sessao_so() {
    let d = pasta("instavel");
    let zip = tab_cnes();
    std::fs::write(d.join("TAB_CNES.zip"), &zip).unwrap();
    let srv = sa_download::servidor_falso::iniciar_instavel(
        [("TAB_CNES.zip".to_string(), d.join("TAB_CNES.zip"))].into(),
        2,
    );
    let f = Fonte {
        servidor: "127.0.0.1".into(),
        pasta_dados: "/dados".into(),
        tab_cnes: "/aux/TAB_CNES.zip".into(),
        cortesia: Cortesia {
            pausa_entre_arquivos: Duration::from_millis(5),
            espera_inicial: Duration::from_millis(5),
            porta: srv.porta,
            ..Cortesia::default()
        },
    };
    let a = cnes::baixar_auxiliares(
        &f,
        "MS",
        &["TP_ESTAB.CNV".into()],
        &d.join("destino"),
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert_eq!(a.cnv.len(), 1);
    assert_eq!(
        srv.conexoes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "índice, cadastro e tabelas saem da mesma sessão"
    );
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn importacao_manual_aceita_arquivos_soltos_ou_o_zip_inteiro() {
    let d = pasta("manual");
    let origem = d.join("origem");
    std::fs::create_dir_all(&origem).unwrap();
    std::fs::write(origem.join("TAB_CNES.zip"), tab_cnes()).unwrap();
    std::fs::write(origem.join("STMS2608.dbc"), b"isto nao e um dbc").unwrap();
    let r =
        cnes::importar_pasta(&origem, &d.join("destino"), "MS", &["TP_ESTAB.CNV".into()]).unwrap();
    assert!(r.cadastro);
    assert_eq!(r.cnv, 1);
    assert!(r.dbc.is_empty());
    assert_eq!(r.recusados.len(), 1, "{:?}", r.recusados);
    assert!(d.join("destino").join("CADGERMS.dbf").exists());
    assert!(d.join("destino").join("cnv").join("tp_estab.cnv").exists());
    assert!(!d.join("destino").join("STMS2608.dbc").exists());
    let _ = std::fs::remove_dir_all(&d);
}

fn reais() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var("SA_CNES_DBC").ok()?);
    p.join("STMS2608.dbc").exists().then_some(p)
}

#[test]
fn baixa_os_dbc_reais_valida_e_lista_competencias() {
    let Some(origem) = reais() else {
        eprintln!("SA_CNES_DBC não definida: prova do download de .dbc não executada");
        return;
    };
    let nomes = [
        "STMS2608.dbc",
        "HBMS2608.dbc",
        "LTMS2608.dbc",
        "STMS2401.dbc",
    ];
    let arquivos: BTreeMap<String, PathBuf> = nomes
        .iter()
        .map(|n| (n.to_string(), origem.join(n)))
        .collect();
    let f = fonte(arquivos);
    let comps = cnes::competencias(&f, "MS").unwrap();
    assert_eq!(
        comps.iter().map(|c| c.0.to_string()).collect::<Vec<_>>(),
        ["202401", "202608"]
    );
    assert!(cnes::competencias(&f, "SP").unwrap().is_empty());
    let d = pasta("dbc");
    let c = Competencia::nova(2026, 8).unwrap();
    let feitos = cnes::baixar(
        &f,
        "MS",
        c,
        &["ST".into(), "HB".into(), "LT".into()],
        &d,
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert_eq!(feitos.len(), 3);
    for (p, n) in feitos
        .iter()
        .zip(["STMS2608.dbc", "HBMS2608.dbc", "LTMS2608.dbc"])
    {
        assert_eq!(
            std::fs::read(p).unwrap(),
            std::fs::read(origem.join(n)).unwrap()
        );
    }
    let l = cnes::locais(&d, "MS");
    assert_eq!(
        l.keys().map(String::as_str).collect::<Vec<_>>(),
        ["HB", "LT", "ST"]
    );
    assert_eq!(l["ST"].0, c);
    // Importação manual dos mesmos arquivos.
    let r = cnes::importar_pasta(&d, &pasta("dbc_imp"), "MS", &[]).unwrap();
    assert_eq!(r.dbc.len(), 3);
    assert!(r.recusados.is_empty());
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn arquivo_corrompido_e_recusado() {
    let d = pasta("ruim");
    std::fs::write(d.join("STMS2608.dbc"), vec![0u8; 5000]).unwrap();
    assert!(cnes::validar_dbc(Path::new(&d.join("STMS2608.dbc"))).is_err());
    let _ = std::fs::remove_dir_all(&d);
}
