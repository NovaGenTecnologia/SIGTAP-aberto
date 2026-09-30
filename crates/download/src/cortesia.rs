//! Política de cortesia com os servidores do DATASUS e download com retomada.
//!
//! Regras (decisão do projeto): uma conexão por servidor, um arquivo por vez, pausa entre
//! arquivos, novas tentativas com espera crescente, retomada do ponto em que parou, arquivo
//! validado antes de entrar na pasta definitiva, cancelamento a qualquer momento.

use crate::ftp::{ErroFtp, Ftp};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Parâmetros de cortesia.
#[derive(Debug, Clone)]
pub struct Cortesia {
    pub pausa_entre_arquivos: Duration,
    pub tentativas: u32,
    pub espera_inicial: Duration,
    pub tempo_limite: Duration,
    pub porta: u16,
}

impl Default for Cortesia {
    fn default() -> Self {
        Self {
            pausa_entre_arquivos: Duration::from_secs(2),
            tentativas: 4,
            espera_inicial: Duration::from_secs(5),
            tempo_limite: Duration::from_secs(60),
            porta: 21,
        }
    }
}

/// Eventos para a tela de progresso.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Evento {
    Iniciando {
        arquivo: String,
        total: u64,
        retomando_de: u64,
    },
    Progresso {
        arquivo: String,
        feito: u64,
        total: u64,
    },
    NovaTentativa {
        arquivo: String,
        tentativa: u32,
        espera_s: u64,
        motivo: String,
    },
    Concluido {
        arquivo: String,
    },
}

/// Erro de download.
#[derive(Debug)]
pub enum ErroDownload {
    Ftp(ErroFtp),
    Arquivo(PathBuf, String),
    Tamanho {
        arquivo: String,
        esperado: u64,
        recebido: u64,
    },
    Invalido(String, String),
    Cancelado,
}

impl fmt::Display for ErroDownload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroDownload::Ftp(e) => e.fmt(f),
            ErroDownload::Arquivo(p, e) => write!(
                f,
                "não foi possível gravar {} ({e}). Verifique se há espaço em disco e se a pasta do programa não é só leitura",
                p.display()
            ),
            ErroDownload::Tamanho {
                arquivo,
                esperado,
                recebido,
            } => write!(
                f,
                "{arquivo} veio com {recebido} bytes, esperados {esperado}. O download será refeito na próxima tentativa"
            ),
            ErroDownload::Invalido(a, e) => write!(
                f,
                "{a} foi baixado mas não passou na verificação ({e}). O arquivo foi descartado; tente de novo mais tarde"
            ),
            ErroDownload::Cancelado => write!(
                f,
                "download cancelado. O que já foi baixado fica guardado e é retomado na próxima vez"
            ),
        }
    }
}

impl std::error::Error for ErroDownload {}

impl From<ErroFtp> for ErroDownload {
    fn from(e: ErroFtp) -> Self {
        ErroDownload::Ftp(e)
    }
}

/// Escritor que respeita o cancelamento e informa o progresso.
struct Escritor<'a, F: FnMut(Evento)> {
    arquivo: File,
    nome: &'a str,
    feito: u64,
    total: u64,
    cancelar: &'a AtomicBool,
    progresso: &'a mut F,
    ultimo_aviso: u64,
}

impl<F: FnMut(Evento)> Write for Escritor<'_, F> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.cancelar.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("cancelado"));
        }
        let n = self.arquivo.write(buf)?;
        self.feito += n as u64;
        if self.feito - self.ultimo_aviso >= 256 * 1024 || self.feito == self.total {
            self.ultimo_aviso = self.feito;
            (self.progresso)(Evento::Progresso {
                arquivo: self.nome.to_string(),
                feito: self.feito,
                total: self.total,
            });
        }
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.arquivo.flush()
    }
}

/// Um arquivo a baixar.
#[derive(Debug, Clone)]
pub struct Pedido {
    pub pasta_remota: String,
    pub nome: String,
    pub tamanho: u64,
}

/// Baixa uma lista de arquivos de um servidor, um por vez, com cortesia. `validar` recebe o
/// arquivo completo (ainda com nome provisório) e decide se ele entra na pasta de destino.
/// Devolve os caminhos finais, na ordem dos pedidos.
pub fn baixar_lista<F, V>(
    servidor: &str,
    pedidos: &[Pedido],
    destino: &Path,
    cortesia: &Cortesia,
    cancelar: &AtomicBool,
    mut progresso: F,
    validar: V,
) -> Result<Vec<PathBuf>, ErroDownload>
where
    F: FnMut(Evento),
    V: Fn(&Path) -> Result<(), String>,
{
    std::fs::create_dir_all(destino)
        .map_err(|e| ErroDownload::Arquivo(destino.to_path_buf(), e.to_string()))?;
    let mut feitos = Vec::new();
    let mut conexao: Option<Ftp> = None;
    for (i, p) in pedidos.iter().enumerate() {
        if i > 0 {
            std::thread::sleep(cortesia.pausa_entre_arquivos);
        }
        let final_ = destino.join(&p.nome);
        let parcial = destino.join(format!("{}.parcial", p.nome));
        let mut tentativa = 0;
        loop {
            if cancelar.load(Ordering::Relaxed) {
                return Err(ErroDownload::Cancelado);
            }
            let r = baixar_um(
                servidor,
                p,
                &parcial,
                cortesia,
                cancelar,
                &mut progresso,
                &mut conexao,
            );
            match r {
                Ok(()) => break,
                Err(ErroDownload::Cancelado) => return Err(ErroDownload::Cancelado),
                Err(e) => {
                    conexao = None; // reconecta na próxima tentativa
                    tentativa += 1;
                    if tentativa >= cortesia.tentativas {
                        return Err(e);
                    }
                    let espera = cortesia.espera_inicial * 3u32.pow(tentativa - 1);
                    progresso(Evento::NovaTentativa {
                        arquivo: p.nome.clone(),
                        tentativa: tentativa + 1,
                        espera_s: espera.as_secs(),
                        motivo: e.to_string(),
                    });
                    std::thread::sleep(espera);
                }
            }
        }
        if let Err(e) = validar(&parcial) {
            let _ = std::fs::remove_file(&parcial);
            return Err(ErroDownload::Invalido(p.nome.clone(), e));
        }
        std::fs::rename(&parcial, &final_)
            .map_err(|e| ErroDownload::Arquivo(final_.clone(), e.to_string()))?;
        progresso(Evento::Concluido {
            arquivo: p.nome.clone(),
        });
        feitos.push(final_);
    }
    if let Some(c) = conexao {
        c.sair();
    }
    Ok(feitos)
}

fn baixar_um<F: FnMut(Evento)>(
    servidor: &str,
    p: &Pedido,
    parcial: &Path,
    cortesia: &Cortesia,
    cancelar: &AtomicBool,
    progresso: &mut F,
    conexao: &mut Option<Ftp>,
) -> Result<(), ErroDownload> {
    let mut desde = std::fs::metadata(parcial).map(|m| m.len()).unwrap_or(0);
    if desde > p.tamanho {
        std::fs::remove_file(parcial)
            .map_err(|e| ErroDownload::Arquivo(parcial.to_path_buf(), e.to_string()))?;
        desde = 0;
    }
    if desde == p.tamanho && desde > 0 {
        return Ok(());
    }
    if conexao.is_none() {
        *conexao = Some(Ftp::conectar(
            servidor,
            cortesia.porta,
            cortesia.tempo_limite,
        )?);
    }
    let ftp = conexao.as_mut().expect("conexão aberta");
    progresso(Evento::Iniciando {
        arquivo: p.nome.clone(),
        total: p.tamanho,
        retomando_de: desde,
    });
    let arquivo = OpenOptions::new()
        .create(true)
        .append(true)
        .open(parcial)
        .map_err(|e| ErroDownload::Arquivo(parcial.to_path_buf(), e.to_string()))?;
    let mut w = Escritor {
        arquivo,
        nome: &p.nome,
        feito: desde,
        total: p.tamanho,
        cancelar,
        progresso,
        ultimo_aviso: desde,
    };
    let caminho = format!("{}/{}", p.pasta_remota.trim_end_matches('/'), p.nome);
    let r = ftp.baixar(&caminho, desde, p.tamanho, &mut w);
    w.flush().ok();
    if cancelar.load(Ordering::Relaxed) {
        return Err(ErroDownload::Cancelado);
    }
    r?;
    let recebido = std::fs::metadata(parcial).map(|m| m.len()).unwrap_or(0);
    if recebido != p.tamanho {
        return Err(ErroDownload::Tamanho {
            arquivo: p.nome.clone(),
            esperado: p.tamanho,
            recebido,
        });
    }
    Ok(())
}
