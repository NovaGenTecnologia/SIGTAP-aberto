//! HTTP com cortesia contra um servidor falso local: paginação pelo tamanho devolvido, queda
//! de conexão com nova tentativa, erro que não se repete, limite de tamanho, cancelamento.

use sa_download::cortesia::{Cortesia, Evento};
use sa_download::http::{ErroHttp, Http};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Resposta roteirizada.
#[derive(Clone)]
enum Resp {
    Ok(String),
    Status(u16),
    Queda,
}

/// Sobe um servidor que responde em ordem; devolve a URL base e o registro das requisições.
fn servidor(roteiro: Vec<Resp>) -> (String, Arc<Mutex<Vec<String>>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let porta = l.local_addr().unwrap().port();
    let log = Arc::new(Mutex::new(Vec::new()));
    let log2 = log.clone();
    std::thread::spawn(move || {
        for (i, s) in l.incoming().enumerate() {
            let Ok(mut s) = s else { break };
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut linha = String::new();
            r.read_line(&mut linha).unwrap();
            loop {
                let mut h = String::new();
                r.read_line(&mut h).unwrap();
                if h == "\r\n" || h.is_empty() {
                    break;
                }
            }
            log2.lock()
                .unwrap()
                .push(linha.split(' ').nth(1).unwrap_or("").to_string());
            match roteiro.get(i).cloned().unwrap_or(Resp::Status(500)) {
                Resp::Ok(corpo) => {
                    let _ = write!(
                        s,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}",
                        corpo.len()
                    );
                }
                Resp::Status(c) => {
                    let _ = write!(
                        s,
                        "HTTP/1.1 {c} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                }
                Resp::Queda => drop(s),
            }
        }
    });
    (format!("http://127.0.0.1:{porta}/api"), log)
}

fn rapida() -> Cortesia {
    Cortesia {
        pausa_entre_arquivos: Duration::from_millis(10),
        tentativas: 3,
        espera_inicial: Duration::from_millis(20),
        tempo_limite: Duration::from_secs(5),
        porta: 0,
    }
}

fn pagina(de: usize, n: usize) -> String {
    let itens: Vec<String> = (de..de + n).map(|i| format!("{{\"id\":{i}}}")).collect();
    format!("{{\"lista\":[{}]}}", itens.join(","))
}

#[test]
fn paginacao_pelo_tamanho_devolvido_com_queda() {
    // Pede 1000 por página, o servidor devolve 860 (como o DEMAS); uma queda no meio.
    let (url, log) = servidor(vec![
        Resp::Ok(pagina(0, 860)),
        Resp::Queda,
        Resp::Ok(pagina(860, 860)),
        Resp::Ok(pagina(1720, 5)),
        Resp::Ok(pagina(0, 0)),
    ]);
    let h = Http::novo(rapida());
    let mut eventos = Vec::new();
    let itens = h
        .paginado_json(&url, "lista", 1000, &AtomicBool::new(false), &mut |e| {
            eventos.push(e)
        })
        .unwrap();
    assert_eq!(itens.len(), 1725);
    assert!(itens.iter().enumerate().all(|(i, v)| v["id"] == i));
    let pedidos = log.lock().unwrap().clone();
    assert_eq!(
        pedidos,
        [
            "/api?limit=1000&offset=0",
            "/api?limit=1000&offset=860",
            "/api?limit=1000&offset=860",
            "/api?limit=1000&offset=1720",
            "/api?limit=1000&offset=1725",
        ]
    );
    assert!(
        eventos
            .iter()
            .any(|e| matches!(e, Evento::NovaTentativa { .. }))
    );
}

#[test]
fn erro_404_nao_repete_e_503_repete() {
    let (url, log) = servidor(vec![Resp::Status(404)]);
    let h = Http::novo(rapida());
    let e = h
        .obter(&url, &AtomicBool::new(false), &mut |_| {})
        .unwrap_err();
    assert!(matches!(e, ErroHttp::Status { codigo: 404, .. }), "{e}");
    assert_eq!(log.lock().unwrap().len(), 1);

    let (url, log) = servidor(vec![
        Resp::Status(503),
        Resp::Status(503),
        Resp::Status(503),
    ]);
    let e = h
        .obter(&url, &AtomicBool::new(false), &mut |_| {})
        .unwrap_err();
    assert!(matches!(e, ErroHttp::Rede { .. }), "{e}");
    assert_eq!(log.lock().unwrap().len(), 3, "três tentativas");
    assert!(e.to_string().contains("importação manual"));
}

#[test]
fn resposta_grande_e_recusada() {
    let (url, _) = servidor(vec![Resp::Ok("x".repeat(5000))]);
    let h = Http::novo(rapida()).com_limite(1000);
    let e = h
        .obter(&url, &AtomicBool::new(false), &mut |_| {})
        .unwrap_err();
    assert!(matches!(e, ErroHttp::Grande { .. }), "{e}");
}

#[test]
fn formato_inesperado_e_cancelamento() {
    let (url, _) = servidor(vec![Resp::Ok("{\"outra\":[]}".into())]);
    let h = Http::novo(rapida());
    let e = h
        .paginado_json(&url, "lista", 10, &AtomicBool::new(false), &mut |_| {})
        .unwrap_err();
    assert!(matches!(e, ErroHttp::Formato { .. }), "{e}");
    let (url, _) = servidor(vec![Resp::Ok(pagina(0, 3))]);
    let e = h
        .paginado_json(&url, "lista", 10, &AtomicBool::new(true), &mut |_| {})
        .unwrap_err();
    assert!(matches!(e, ErroHttp::Cancelado));
}

#[test]
fn territorio_baixado_validado_e_lido_da_pasta() {
    use sa_download::territorio as ter;
    let ibge = r#"[{"municipio-id":1100015,"municipio-nome":"A","microrregiao-id":1,"microrregiao-nome":"m","mesorregiao-id":1,"mesorregiao-nome":"m","regiao-imediata-id":1,"regiao-imediata-nome":"i","regiao-intermediaria-id":1,"regiao-intermediaria-nome":"i","UF-id":11,"UF-sigla":"RO","UF-nome":"Rondônia","regiao-id":1,"regiao-sigla":"N","regiao-nome":"Norte"}]"#;
    let item = r#"{"codigo_regiao_pais":"1","regiao_pais":"Norte","codigo_uf":"11","uf":"Rondônia","codigo_macrorregiao_saude":"1101","macrorregiao_saude":"M","codigo_regiao_saude":"11001","regiao_saude":"R","codigo_municipio":"110001","municipio":"RO - A","populacao_estimada_ibge_2022":5}"#;
    let (url_i, _) = servidor(vec![Resp::Ok(ibge.into())]);
    let (url_d, log_d) = servidor(vec![
        Resp::Ok(format!("{{\"{}\":[{item}]}}", ter::LISTA_DEMAS)),
        Resp::Ok(format!("{{\"{}\":[]}}", ter::LISTA_DEMAS)),
    ]);
    let pasta = std::env::temp_dir().join(format!("sa-ter-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&pasta);
    let h = Http::novo(rapida());
    ter::baixar_de(
        &h,
        &url_i,
        &url_d,
        &pasta,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(log_d.lock().unwrap().len(), 2);
    let t = ter::ler_pasta(&pasta).unwrap();
    assert_eq!((t.ibge.len(), t.demas.len()), (1, 1));
    assert_eq!(t.origem_ibge.url, url_i);
    assert!(t.origem_ibge.obtido_em.ends_with('Z'));
    // Arquivo trocado à mão: a origem passa a ser "importação manual".
    std::fs::write(pasta.join(ter::ARQ_DEMAS), format!("[{item}]")).unwrap();
    let t = ter::ler_pasta(&pasta).unwrap();
    assert!(t.origem_demas.url.starts_with("importação manual"));
    assert_eq!(t.origem_ibge.url, url_i);
    // Fonte com formato novo: download recusado e arquivos anteriores intactos.
    let (url_i2, _) = servidor(vec![Resp::Ok(ibge.replace("\"UF-nome\"", "\"UF_nome\""))]);
    let e = ter::baixar_de(
        &h,
        &url_i2,
        &url_d,
        &pasta,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap_err();
    assert!(e.to_string().contains("formato"), "{e}");
    assert!(ter::ler_pasta(&pasta).is_ok());
    let _ = std::fs::remove_dir_all(&pasta);
}
