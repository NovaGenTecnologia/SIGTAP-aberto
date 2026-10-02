//! Cliente FTP mínimo (RFC 959, modo passivo) para os servidores públicos do DATASUS.
//!
//! Só o necessário: login anônimo, listagem, tamanho, download com retomada (REST). Uma
//! conexão de controle por vez; a política de cortesia fica em `crate::cortesia`.

use std::fmt;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Erro de FTP, com orientação.
#[derive(Debug)]
pub enum ErroFtp {
    Conexao(String, String),
    Resposta(String, String),
    Protocolo(String),
}

impl fmt::Display for ErroFtp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroFtp::Conexao(h, e) => write!(
                f,
                "não foi possível conectar a {h} ({e}). Verifique a internet ou se a rede do hospital bloqueia FTP; \
                 se bloquear, baixe os arquivos em outro computador e use a importação por pasta"
            ),
            ErroFtp::Resposta(cmd, r) => write!(f, "o servidor recusou \"{cmd}\": {r}"),
            ErroFtp::Protocolo(e) => write!(f, "resposta inesperada do servidor FTP: {e}"),
        }
    }
}

impl std::error::Error for ErroFtp {}

/// Quanto esperar o canal de dados abrir antes de pedir outra porta.
const TEMPO_CANAL_DADOS: Duration = Duration::from_secs(10);
/// Quantas portas pedir na mesma sessão antes de desistir dela.
const TENTATIVAS_CANAL: u32 = 3;

/// Entrada de uma listagem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entrada {
    pub nome: String,
    /// `None` para pasta.
    pub tamanho: Option<u64>,
}

/// Conexão FTP aberta.
pub struct Ftp {
    host: String,
    controle: BufReader<TcpStream>,
    tempo_limite: Duration,
    reaproveitavel: bool,
}

impl Ftp {
    /// Conecta e entra como anônimo.
    pub fn conectar(host: &str, porta: u16, tempo_limite: Duration) -> Result<Self, ErroFtp> {
        let endereco = (host, porta)
            .to_socket_addrs()
            .map_err(|e| ErroFtp::Conexao(host.into(), e.to_string()))?
            .next()
            .ok_or_else(|| ErroFtp::Conexao(host.into(), "nome não encontrado".into()))?;
        let s = TcpStream::connect_timeout(&endereco, tempo_limite)
            .map_err(|e| ErroFtp::Conexao(host.into(), e.to_string()))?;
        s.set_read_timeout(Some(tempo_limite)).ok();
        s.set_write_timeout(Some(tempo_limite)).ok();
        let mut ftp = Self {
            host: host.to_string(),
            controle: BufReader::new(s),
            tempo_limite,
            reaproveitavel: false,
        };
        ftp.esperar(&[220], "conexão")?;
        let (c, _) = ftp.comando("USER anonymous")?;
        if c == 331 {
            ftp.exigir("PASS anonymous@", &[230, 202])?;
        } else if c != 230 {
            return Err(ErroFtp::Resposta("USER".into(), c.to_string()));
        }
        ftp.exigir("TYPE I", &[200])?;
        Ok(ftp)
    }

    fn ler_resposta(&mut self) -> Result<(u32, String), ErroFtp> {
        let mut linha = String::new();
        self.controle
            .read_line(&mut linha)
            .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?;
        if linha.len() < 4 {
            return Err(ErroFtp::Protocolo(format!("linha curta: {linha:?}")));
        }
        let codigo: u32 = linha[..3]
            .parse()
            .map_err(|_| ErroFtp::Protocolo(linha.clone()))?;
        let mut texto = linha.clone();
        if linha.as_bytes()[3] == b'-' {
            // Resposta de várias linhas: termina em "NNN " com o mesmo código.
            let fim = format!("{codigo} ");
            loop {
                let mut l = String::new();
                let n = self
                    .controle
                    .read_line(&mut l)
                    .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?;
                if n == 0 {
                    return Err(ErroFtp::Protocolo(
                        "conexão fechada no meio da resposta".into(),
                    ));
                }
                texto.push_str(&l);
                if l.starts_with(&fim) {
                    break;
                }
            }
        }
        Ok((codigo, texto.trim_end().to_string()))
    }

    fn esperar(&mut self, codigos: &[u32], contexto: &str) -> Result<String, ErroFtp> {
        let (c, t) = self.ler_resposta()?;
        if codigos.contains(&c) {
            Ok(t)
        } else {
            Err(ErroFtp::Resposta(contexto.into(), t))
        }
    }

    fn comando(&mut self, cmd: &str) -> Result<(u32, String), ErroFtp> {
        let s = self.controle.get_mut();
        s.write_all(format!("{cmd}\r\n").as_bytes())
            .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?;
        self.ler_resposta()
    }

    fn exigir(&mut self, cmd: &str, codigos: &[u32]) -> Result<String, ErroFtp> {
        let (c, t) = self.comando(cmd)?;
        if codigos.contains(&c) {
            Ok(t)
        } else {
            let visivel = if cmd.starts_with("PASS") { "PASS" } else { cmd };
            Err(ErroFtp::Resposta(visivel.into(), t))
        }
    }

    /// Abre o canal de dados (modo passivo). O servidor do DATASUS às vezes anuncia uma porta
    /// que não aceita a conexão (medido em 02/10/2026: cerca de metade das tentativas, com a
    /// resposta chegando só depois de ~20 s). Falha rápido (`TEMPO_CANAL_DADOS`) e pede outra
    /// porta na mesma sessão, em vez de derrubar a sessão inteira.
    fn abrir_dados(&mut self) -> Result<TcpStream, ErroFtp> {
        let mut ultimo = String::new();
        for _ in 0..TENTATIVAS_CANAL {
            let t = self.exigir("PASV", &[227])?;
            let ini = t.find('(').ok_or_else(|| ErroFtp::Protocolo(t.clone()))?;
            let fim = t[ini..]
                .find(')')
                .ok_or_else(|| ErroFtp::Protocolo(t.clone()))?
                + ini;
            let n: Vec<u16> = t[ini + 1..fim]
                .split(',')
                .map(|x| x.trim().parse::<u16>())
                .collect::<Result<_, _>>()
                .map_err(|_| ErroFtp::Protocolo(t.clone()))?;
            if n.len() != 6 {
                return Err(ErroFtp::Protocolo(t));
            }
            let porta = n[4] * 256 + n[5];
            // Usa o mesmo host do controle (ignora o IP informado, que pode ser interno).
            let endereco = (self.host.as_str(), porta)
                .to_socket_addrs()
                .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?
                .next()
                .ok_or_else(|| ErroFtp::Conexao(self.host.clone(), "endereço de dados".into()))?;
            match TcpStream::connect_timeout(&endereco, self.tempo_limite.min(TEMPO_CANAL_DADOS)) {
                Ok(s) => {
                    s.set_read_timeout(Some(self.tempo_limite)).ok();
                    return Ok(s);
                }
                Err(e) => ultimo = e.to_string(),
            }
        }
        Err(ErroFtp::Conexao(
            self.host.clone(),
            format!("o servidor não abriu o canal de dados ({ultimo})"),
        ))
    }

    /// Lista uma pasta (formatos Unix e Windows/IIS, os dois vistos no DATASUS).
    pub fn listar(&mut self, pasta: &str) -> Result<Vec<Entrada>, ErroFtp> {
        self.exigir(&format!("CWD {pasta}"), &[250])?;
        let mut dados = self.abrir_dados()?;
        self.exigir("LIST", &[125, 150])?;
        let mut texto = Vec::new();
        dados
            .read_to_end(&mut texto)
            .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?;
        drop(dados);
        self.esperar(&[226, 250], "LIST")?;
        Ok(String::from_utf8_lossy(&texto)
            .lines()
            .filter_map(interpretar_linha_list)
            .collect())
    }

    /// Tamanho de um arquivo (comando SIZE).
    pub fn tamanho(&mut self, caminho: &str) -> Result<u64, ErroFtp> {
        let t = self.exigir(&format!("SIZE {caminho}"), &[213])?;
        let n = t[4..].trim().parse().map_err(|_| ErroFtp::Protocolo(t))?;
        self.reaproveitavel = true;
        Ok(n)
    }

    /// Baixa `caminho` a partir de `desde` bytes, escrevendo em `saida`. Devolve os bytes
    /// recebidos. `limite` barra arquivo maior que o esperado.
    pub fn baixar<W: Write>(
        &mut self,
        caminho: &str,
        desde: u64,
        limite: u64,
        saida: &mut W,
    ) -> Result<u64, ErroFtp> {
        let mut dados = self.abrir_dados()?;
        if desde > 0 {
            self.exigir(&format!("REST {desde}"), &[350])?;
        }
        self.exigir(&format!("RETR {caminho}"), &[125, 150])?;
        let mut buf = [0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let n = dados
                .read(&mut buf)
                .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if desde + total > limite {
                let _ = dados.shutdown(Shutdown::Both);
                return Err(ErroFtp::Protocolo(format!(
                    "{caminho} passou do tamanho esperado ({limite} bytes)"
                )));
            }
            saida
                .write_all(&buf[..n])
                .map_err(|e| ErroFtp::Conexao(self.host.clone(), format!("gravar: {e}")))?;
        }
        drop(dados);
        self.esperar(&[226, 250], "RETR")?;
        Ok(total)
    }

    /// Baixa só um trecho de `caminho`: `quantos` bytes a partir de `desde`. Depois de ler o
    /// que precisa, fecha o canal de dados e lê a resposta do servidor (426, ou 226 se o trecho
    /// foi até o fim), deixando a sessão pronta para o próximo trecho: assim o índice, o cadastro
    /// e as tabelas saem de uma sessão só, em vez de uma por trecho. Se a resposta não vier, a
    /// sessão fica marcada como não reaproveitável (`reaproveitavel`).
    pub fn baixar_trecho(
        &mut self,
        caminho: &str,
        desde: u64,
        quantos: u64,
        mut progresso: impl FnMut(u64),
    ) -> Result<Vec<u8>, ErroFtp> {
        self.reaproveitavel = false;
        let mut dados = self.abrir_dados()?;
        if desde > 0 {
            self.exigir(&format!("REST {desde}"), &[350])?;
        }
        self.exigir(&format!("RETR {caminho}"), &[125, 150])?;
        let alvo = usize::try_from(quantos)
            .map_err(|_| ErroFtp::Protocolo("trecho grande demais".into()))?;
        let mut saida = Vec::with_capacity(alvo.min(64 * 1024 * 1024));
        let mut buf = [0u8; 64 * 1024];
        while saida.len() < alvo {
            let falta = (alvo - saida.len()).min(buf.len());
            let n = dados
                .read(&mut buf[..falta])
                .map_err(|e| ErroFtp::Conexao(self.host.clone(), e.to_string()))?;
            if n == 0 {
                break; // fim do arquivo antes do fim do trecho: quem chama confere o tamanho
            }
            saida.extend_from_slice(&buf[..n]);
            progresso(saida.len() as u64);
        }
        let _ = dados.shutdown(Shutdown::Both);
        drop(dados);
        self.controle
            .get_ref()
            .set_read_timeout(Some(self.tempo_limite.min(TEMPO_CANAL_DADOS)))
            .ok();
        if let Ok((codigo, _)) = self.ler_resposta()
            && matches!(codigo, 226 | 250 | 426 | 451)
        {
            self.reaproveitavel = true;
        }
        self.controle
            .get_ref()
            .set_read_timeout(Some(self.tempo_limite))
            .ok();
        Ok(saida)
    }

    /// A sessão ainda serve para outro comando (o último trecho terminou limpo)?
    pub fn reaproveitavel(&self) -> bool {
        self.reaproveitavel
    }

    pub fn sair(mut self) {
        let _ = self.comando("QUIT");
    }
}

/// Interpreta uma linha de LIST (Unix: `-rw-r--r-- 1 ftp ftp 123 Jan 01 2020 nome`;
/// Windows: `10-17-17  11:43AM  743162 nome` ou `<DIR>`).
pub fn interpretar_linha_list(linha: &str) -> Option<Entrada> {
    let l = linha.trim_end();
    if l.is_empty() || l.starts_with("total ") {
        return None;
    }
    let partes: Vec<&str> = l.split_whitespace().collect();
    if l.as_bytes()[0].is_ascii_digit() {
        // Windows/IIS: data, hora, tamanho ou <DIR>, nome (pode ter espaços).
        if partes.len() < 4 {
            return None;
        }
        let tamanho = if partes[2] == "<DIR>" {
            None
        } else {
            Some(partes[2].parse().ok()?)
        };
        return Some(Entrada {
            nome: depois_de_campos(l, 3)?.to_string(),
            tamanho,
        });
    }
    if partes.len() < 9 {
        return None;
    }
    let tamanho = if l.starts_with('d') {
        None
    } else {
        Some(partes[4].parse().ok()?)
    };
    // Unix: o nome é tudo depois do 8º campo.
    Some(Entrada {
        nome: depois_de_campos(l, 8)?.to_string(),
        tamanho,
    })
}

/// Texto depois dos `n` primeiros campos separados por espaço.
fn depois_de_campos(linha: &str, n: usize) -> Option<&str> {
    let mut resto = linha;
    for _ in 0..n {
        resto = resto.trim_start();
        resto = &resto[resto.find(char::is_whitespace)?..];
    }
    let nome = resto.trim_start();
    (!nome.is_empty()).then_some(nome)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn interpreta_listagens_vistas_no_datasus() {
        let u = interpretar_linha_list("-rwxr-xr-x    1 ftp      ftp        119133 Mar 04  2016 nota_tecnica_cgsi_sigtap_2008_01.pdf").unwrap();
        assert_eq!(
            u,
            Entrada {
                nome: "nota_tecnica_cgsi_sigtap_2008_01.pdf".into(),
                tamanho: Some(119133)
            }
        );
        let d = interpretar_linha_list(
            "drwxr-xr-x    2 ftp      ftp          4096 Jan 01  2020 instaladores antigos",
        )
        .unwrap();
        assert_eq!(
            d,
            Entrada {
                nome: "instaladores antigos".into(),
                tamanho: None
            }
        );
        let w = interpretar_linha_list("10-17-17  11:43AM               743162 IT_CNES_1706.pdf")
            .unwrap();
        assert_eq!(
            w,
            Entrada {
                nome: "IT_CNES_1706.pdf".into(),
                tamanho: Some(743162)
            }
        );
        let wd = interpretar_linha_list("06-21-21  03:10PM       <DIR>          Auxiliar").unwrap();
        assert_eq!(
            wd,
            Entrada {
                nome: "Auxiliar".into(),
                tamanho: None
            }
        );
        assert!(interpretar_linha_list("total 12").is_none());
        let esp = interpretar_linha_list(
            "-rw-r--r--    1 ftp      ftp        10 Jan 01  2020 NOTA INFORMATIVA MAPEAMENTO.doc",
        )
        .unwrap();
        assert_eq!(esp.nome, "NOTA INFORMATIVA MAPEAMENTO.doc");
        // Tamanho que também aparece na data não confunde o nome.
        let x = interpretar_linha_list("10-17-17  11:43AM                   17 a 17.txt").unwrap();
        assert_eq!(
            x,
            Entrada {
                nome: "a 17.txt".into(),
                tamanho: Some(17)
            }
        );
    }
}
