//! Download com cortesia contra um servidor FTP falso local: listagem, retomada depois de
//! queda no meio do arquivo, nova tentativa, validação e cancelamento.

use sa_download::cortesia::{Cortesia, ErroDownload, Evento, Pedido, baixar_lista};
use sa_download::ftp::Ftp;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Servidor FTP mínimo. `cortar_primeiro_retr_em`: o primeiro RETR fecha a conexão depois de
/// N bytes (simula queda de rede).
struct Servidor {
    porta: u16,
    conexoes: Arc<AtomicUsize>,
    rests: Arc<Mutex<Vec<u64>>>,
}

fn iniciar(
    arquivos: BTreeMap<String, Vec<u8>>,
    cortar_primeiro_retr_em: Option<usize>,
) -> Servidor {
    let escuta = TcpListener::bind("127.0.0.1:0").unwrap();
    let porta = escuta.local_addr().unwrap().port();
    let conexoes = Arc::new(AtomicUsize::new(0));
    let rests = Arc::new(Mutex::new(Vec::new()));
    let (c2, r2) = (conexoes.clone(), rests.clone());
    let arquivos = Arc::new(arquivos);
    let cortar = Arc::new(Mutex::new(cortar_primeiro_retr_em));
    std::thread::spawn(move || {
        for s in escuta.incoming() {
            let Ok(s) = s else { continue };
            c2.fetch_add(1, Ordering::SeqCst);
            let (arquivos, r2, cortar) = (arquivos.clone(), r2.clone(), cortar.clone());
            std::thread::spawn(move || atender(s, &arquivos, &r2, &cortar));
        }
    });
    Servidor {
        porta,
        conexoes,
        rests,
    }
}

fn atender(
    s: TcpStream,
    arquivos: &BTreeMap<String, Vec<u8>>,
    rests: &Mutex<Vec<u64>>,
    cortar: &Mutex<Option<usize>>,
) {
    let mut w = s.try_clone().unwrap();
    let mut r = BufReader::new(s);
    let mut dados: Option<TcpListener> = None;
    let mut rest = 0u64;
    let _ = w.write_all(b"220 falso\r\n");
    loop {
        let mut l = String::new();
        if r.read_line(&mut l).unwrap_or(0) == 0 {
            return;
        }
        let l = l.trim_end();
        let (cmd, arg) = l.split_once(' ').unwrap_or((l, ""));
        let resp: String = match cmd {
            "USER" => "331 senha\r\n".into(),
            "PASS" => "230 ok\r\n".into(),
            "TYPE" => "200 ok\r\n".into(),
            "CWD" => "250 ok\r\n".into(),
            "PASV" => {
                let d = TcpListener::bind("127.0.0.1:0").unwrap();
                let p = d.local_addr().unwrap().port();
                dados = Some(d);
                format!(
                    "227 Entering Passive Mode (127,0,0,1,{},{})\r\n",
                    p / 256,
                    p % 256
                )
            }
            "SIZE" => match arquivos.get(arg.rsplit('/').next().unwrap()) {
                Some(a) => format!("213 {}\r\n", a.len()),
                None => "550 nao\r\n".into(),
            },
            "REST" => {
                rest = arg.parse().unwrap();
                rests.lock().unwrap().push(rest);
                "350 ok\r\n".into()
            }
            "LIST" => {
                let _ = w.write_all(b"150 lista\r\n");
                let (mut c, _) = dados.take().unwrap().accept().unwrap();
                for (n, a) in arquivos {
                    let _ = c.write_all(
                        format!(
                            "-rw-r--r--    1 ftp      ftp     {:>9} Sep 17  2026 {n}\r\n",
                            a.len()
                        )
                        .as_bytes(),
                    );
                }
                drop(c);
                "226 fim\r\n".into()
            }
            "RETR" => {
                let nome = arg.rsplit('/').next().unwrap();
                let Some(a) = arquivos.get(nome) else {
                    let _ = w.write_all(b"550 nao\r\n");
                    continue;
                };
                let _ = w.write_all(b"150 enviando\r\n");
                let (mut c, _) = dados.take().unwrap().accept().unwrap();
                let parte = &a[rest as usize..];
                rest = 0;
                let corte = cortar.lock().unwrap().take();
                if let Some(n) = corte {
                    let _ = c.write_all(&parte[..n.min(parte.len())]);
                    drop(c);
                    // Queda: fecha também o controle, sem 226.
                    return;
                }
                let _ = c.write_all(parte);
                drop(c);
                "226 fim\r\n".into()
            }
            "QUIT" => {
                let _ = w.write_all(b"221 tchau\r\n");
                return;
            }
            _ => "502 nao\r\n".into(),
        };
        let _ = w.write_all(resp.as_bytes());
    }
}

fn cortesia_rapida(porta: u16) -> Cortesia {
    Cortesia {
        pausa_entre_arquivos: Duration::from_millis(10),
        tentativas: 3,
        espera_inicial: Duration::from_millis(10),
        tempo_limite: Duration::from_secs(5),
        porta,
    }
}

fn dir_temp(r: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("sa-ftp-{r}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn conteudo(n: usize, semente: u8) -> Vec<u8> {
    (0..n)
        .map(|i| (i as u8).wrapping_mul(31).wrapping_add(semente))
        .collect()
}

#[test]
fn lista_e_baixa_um_por_vez_numa_conexao() {
    let mut arqs = BTreeMap::new();
    arqs.insert("a.zip".to_string(), conteudo(300_000, 1));
    arqs.insert("b.zip".to_string(), conteudo(10, 2));
    let srv = iniciar(arqs.clone(), None);
    let mut f = Ftp::conectar("127.0.0.1", srv.porta, Duration::from_secs(5)).unwrap();
    let l = f.listar("/pub").unwrap();
    assert_eq!(l.len(), 2);
    assert_eq!(l[0].tamanho, Some(300_000));
    f.sair();
    let d = dir_temp("lista");
    let pedidos: Vec<Pedido> = l
        .iter()
        .map(|e| Pedido {
            pasta_remota: "/pub".into(),
            nome: e.nome.clone(),
            tamanho: e.tamanho.unwrap(),
        })
        .collect();
    let antes = srv.conexoes.load(Ordering::SeqCst);
    let mut eventos = Vec::new();
    let feitos = baixar_lista(
        "127.0.0.1",
        &pedidos,
        &d,
        &cortesia_rapida(srv.porta),
        &AtomicBool::new(false),
        |e| eventos.push(e),
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(feitos.len(), 2);
    for (n, a) in &arqs {
        assert_eq!(&std::fs::read(d.join(n)).unwrap(), a);
        assert!(!d.join(format!("{n}.parcial")).exists());
    }
    assert_eq!(
        srv.conexoes.load(Ordering::SeqCst) - antes,
        1,
        "uma única conexão para a lista inteira"
    );
    assert!(
        eventos
            .iter()
            .any(|e| matches!(e, Evento::Concluido { arquivo } if arquivo == "a.zip"))
    );
}

#[test]
fn queda_no_meio_retoma_do_ponto_certo() {
    let mut arqs = BTreeMap::new();
    let a = conteudo(500_000, 7);
    arqs.insert(
        "TabelaUnificada_202609_v2609171117.zip".to_string(),
        a.clone(),
    );
    let srv = iniciar(arqs, Some(123_456));
    let d = dir_temp("queda");
    let pedidos = vec![Pedido {
        pasta_remota: "/pub".into(),
        nome: "TabelaUnificada_202609_v2609171117.zip".into(),
        tamanho: a.len() as u64,
    }];
    let mut tentativas = 0;
    baixar_lista(
        "127.0.0.1",
        &pedidos,
        &d,
        &cortesia_rapida(srv.porta),
        &AtomicBool::new(false),
        |e| {
            if matches!(e, Evento::NovaTentativa { .. }) {
                tentativas += 1;
            }
        },
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(std::fs::read(d.join(&pedidos[0].nome)).unwrap(), a);
    assert_eq!(tentativas, 1);
    assert_eq!(
        *srv.rests.lock().unwrap(),
        vec![123_456],
        "retomou com REST no byte em que caiu"
    );
}

#[test]
fn arquivo_invalido_e_descartado() {
    let mut arqs = BTreeMap::new();
    arqs.insert(
        "TabelaUnificada_202609_v2609171117.zip".to_string(),
        b"nao sou zip".to_vec(),
    );
    let srv = iniciar(arqs, None);
    let d = dir_temp("invalido");
    let p = vec![Pedido {
        pasta_remota: "/pub".into(),
        nome: "TabelaUnificada_202609_v2609171117.zip".into(),
        tamanho: 11,
    }];
    let e = baixar_lista(
        "127.0.0.1",
        &p,
        &d,
        &cortesia_rapida(srv.porta),
        &AtomicBool::new(false),
        |_| {},
        |caminho| {
            sa_download::sigtap::validar_zip(caminho, "TabelaUnificada_202609_v2609171117.zip")
        },
    )
    .unwrap_err();
    assert!(matches!(e, ErroDownload::Invalido(..)), "{e}");
    assert!(
        std::fs::read_dir(&d).unwrap().next().is_none(),
        "nada fica na pasta"
    );
}

#[test]
fn cancelamento_para_e_guarda_o_parcial() {
    let mut arqs = BTreeMap::new();
    arqs.insert("x.zip".to_string(), conteudo(2_000_000, 3));
    let srv = iniciar(arqs, None);
    let d = dir_temp("cancelar");
    let cancelar = AtomicBool::new(false);
    let p = vec![Pedido {
        pasta_remota: "/pub".into(),
        nome: "x.zip".into(),
        tamanho: 2_000_000,
    }];
    let e = baixar_lista(
        "127.0.0.1",
        &p,
        &d,
        &cortesia_rapida(srv.porta),
        &cancelar,
        |ev| {
            if let Evento::Progresso { feito, .. } = ev
                && feito > 500_000
            {
                cancelar.store(true, Ordering::SeqCst);
            }
        },
        |_| Ok(()),
    )
    .unwrap_err();
    assert!(matches!(e, ErroDownload::Cancelado));
    assert!(e.to_string().contains("retomado"));
    let parcial = std::fs::metadata(d.join("x.zip.parcial")).unwrap().len();
    assert!(parcial > 0 && parcial < 2_000_000);
    assert!(!d.join("x.zip").exists());
}
