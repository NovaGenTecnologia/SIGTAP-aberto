//! Servidor FTP mínimo e local, só para testes (recurso `servidor-falso`): serve arquivos de
//! uma lista, com LIST, SIZE, REST e RETR em modo passivo. Não é usado pelo programa.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;

/// Sobe o servidor em 127.0.0.1 numa porta livre e devolve a porta. `arquivos`: nome
/// remoto → arquivo local.
pub fn iniciar(arquivos: BTreeMap<String, PathBuf>) -> u16 {
    let escuta = TcpListener::bind("127.0.0.1:0").expect("porta local");
    let porta = escuta.local_addr().expect("endereço").port();
    let arquivos = Arc::new(arquivos);
    std::thread::spawn(move || {
        for s in escuta.incoming().flatten() {
            let a = arquivos.clone();
            std::thread::spawn(move || atender(s, &a));
        }
    });
    porta
}

fn atender(s: TcpStream, arquivos: &BTreeMap<String, PathBuf>) {
    let Ok(mut w) = s.try_clone() else { return };
    let mut r = BufReader::new(s);
    let mut dados: Option<TcpListener> = None;
    let mut rest = 0usize;
    let _ = w.write_all(b"220 falso\r\n");
    loop {
        let mut l = String::new();
        if r.read_line(&mut l).unwrap_or(0) == 0 {
            return;
        }
        let l = l.trim_end();
        let (cmd, arg) = l.split_once(' ').unwrap_or((l, ""));
        let nome = arg.rsplit('/').next().unwrap_or_default();
        let resp: String = match cmd {
            "USER" => "331 senha\r\n".into(),
            "PASS" => "230 ok\r\n".into(),
            "TYPE" => "200 ok\r\n".into(),
            "CWD" => "250 ok\r\n".into(),
            "PASV" => {
                let Ok(d) = TcpListener::bind("127.0.0.1:0") else {
                    return;
                };
                let p = d.local_addr().map(|a| a.port()).unwrap_or(0);
                dados = Some(d);
                format!(
                    "227 Entering Passive Mode (127,0,0,1,{},{})\r\n",
                    p / 256,
                    p % 256
                )
            }
            "SIZE" => match arquivos.get(nome).and_then(|p| std::fs::metadata(p).ok()) {
                Some(m) => format!("213 {}\r\n", m.len()),
                None => "550 nao\r\n".into(),
            },
            "REST" => {
                rest = arg.parse().unwrap_or(0);
                "350 ok\r\n".into()
            }
            "LIST" => {
                let _ = w.write_all(b"150 lista\r\n");
                let Some(Ok((mut c, _))) = dados.take().map(|d| d.accept()) else {
                    return;
                };
                for (n, p) in arquivos {
                    let t = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                    let _ = c.write_all(
                        format!("-rw-r--r--    1 ftp      ftp     {t:>9} Sep 17  2026 {n}\r\n")
                            .as_bytes(),
                    );
                }
                drop(c);
                "226 fim\r\n".into()
            }
            "RETR" => {
                let Some(conteudo) = arquivos.get(nome).and_then(|p| std::fs::read(p).ok()) else {
                    let _ = w.write_all(b"550 nao\r\n");
                    continue;
                };
                let _ = w.write_all(b"150 enviando\r\n");
                let Some(Ok((mut c, _))) = dados.take().map(|d| d.accept()) else {
                    return;
                };
                let _ = c.write_all(&conteudo[rest.min(conteudo.len())..]);
                rest = 0;
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
