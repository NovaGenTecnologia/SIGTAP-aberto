//! HTTP(S) com cortesia: uma requisição por vez, pausa entre páginas, novas tentativas com
//! espera crescente para falhas de rede e respostas 429/5xx, limite de tamanho por resposta,
//! cancelamento. Usado pelas APIs públicas (IBGE, DEMAS).
//!
//! Certificados: os do sistema (no Windows, o repositório do Windows), para funcionar também
//! em redes de hospital com inspeção de TLS cujo certificado raiz foi instalado pela TI.
//! Proxy: variáveis de ambiente e, no Windows, o proxy do sistema.

use crate::cortesia::{Cortesia, Evento};
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Limite padrão por resposta (as maiores respostas esperadas têm ~3 MB).
pub const LIMITE_RESPOSTA: u64 = 64 * 1024 * 1024;
/// Máximo de páginas numa consulta paginada (proteção contra servidor que nunca acaba).
pub const MAX_PAGINAS: usize = 10_000;

/// Erro de HTTP, com orientação.
#[derive(Debug)]
pub enum ErroHttp {
    /// Falha de rede depois de todas as tentativas.
    Rede {
        url: String,
        detalhe: String,
    },
    /// Resposta com código de erro que não adianta repetir (ex.: 404).
    Status {
        url: String,
        codigo: u16,
    },
    /// Resposta maior que o limite.
    Grande {
        url: String,
        limite: u64,
    },
    /// Resposta que não é o JSON esperado.
    Formato {
        url: String,
        detalhe: String,
    },
    /// Paginação passou do máximo de páginas.
    Paginas {
        url: String,
    },
    Cancelado,
}

impl fmt::Display for ErroHttp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroHttp::Rede { url, detalhe } => write!(
                f,
                "não foi possível acessar {url} ({detalhe}). Verifique a internet ou o proxy da rede; se o site estiver fora do ar, tente mais tarde ou use a importação manual"
            ),
            ErroHttp::Status { url, codigo } => write!(
                f,
                "o servidor respondeu {codigo} para {url}. O endereço pode ter mudado; avise o projeto e use a importação manual"
            ),
            ErroHttp::Grande { url, limite } => write!(
                f,
                "a resposta de {url} passou de {} MB, o limite de segurança. Nada foi gravado",
                limite / (1024 * 1024)
            ),
            ErroHttp::Formato { url, detalhe } => write!(
                f,
                "a resposta de {url} não está no formato esperado ({detalhe}). A fonte pode ter mudado; nada foi gravado"
            ),
            ErroHttp::Paginas { url } => write!(
                f,
                "{url} devolveu mais de {MAX_PAGINAS} páginas; a consulta foi interrompida por segurança"
            ),
            ErroHttp::Cancelado => write!(f, "download cancelado"),
        }
    }
}

impl std::error::Error for ErroHttp {}

/// Cliente HTTP do programa.
pub struct Http {
    agente: ureq::Agent,
    cortesia: Cortesia,
    limite: u64,
}

/// Espera em passos curtos para responder ao cancelamento.
fn dormir(d: Duration, cancelar: &AtomicBool) -> Result<(), ErroHttp> {
    let passo = Duration::from_millis(100);
    let mut resta = d;
    while !resta.is_zero() {
        if cancelar.load(Ordering::Relaxed) {
            return Err(ErroHttp::Cancelado);
        }
        let p = resta.min(passo);
        std::thread::sleep(p);
        resta -= p;
    }
    Ok(())
}

impl Http {
    /// Cliente com a política de cortesia dada.
    pub fn novo(cortesia: Cortesia) -> Self {
        let tls = ureq::tls::TlsConfig::builder()
            .root_certs(ureq::tls::RootCerts::PlatformVerifier)
            .build();
        let config = ureq::Agent::config_builder()
            .tls_config(tls)
            .timeout_connect(Some(Duration::from_secs(30)))
            .timeout_global(Some(cortesia.tempo_limite.max(Duration::from_secs(120))))
            .user_agent(format!(
                "SIGTAP-Aberto/{} (programa de código aberto; downloads de dados públicos com cortesia)",
                sa_core::VERSAO
            ))
            .http_status_as_error(false)
            .build();
        Self {
            agente: ureq::Agent::new_with_config(config),
            cortesia,
            limite: LIMITE_RESPOSTA,
        }
    }

    /// Muda o limite de tamanho por resposta (testes).
    pub fn com_limite(mut self, bytes: u64) -> Self {
        self.limite = bytes;
        self
    }

    /// Uma tentativa de GET. `Ok(Err(motivo))` = falha que vale repetir.
    fn tentar(&self, url: &str) -> Result<Result<Vec<u8>, String>, ErroHttp> {
        let resp = match self.agente.get(url).call() {
            Ok(r) => r,
            Err(e) => return Ok(Err(e.to_string())),
        };
        let codigo = resp.status().as_u16();
        if codigo == 429 || codigo >= 500 {
            return Ok(Err(format!("servidor respondeu {codigo}")));
        }
        if codigo != 200 {
            return Err(ErroHttp::Status {
                url: url.to_string(),
                codigo,
            });
        }
        match resp
            .into_body()
            .with_config()
            .limit(self.limite)
            .read_to_vec()
        {
            Ok(v) => Ok(Ok(v)),
            Err(ureq::Error::BodyExceedsLimit(_)) => Err(ErroHttp::Grande {
                url: url.to_string(),
                limite: self.limite,
            }),
            Err(e) => Ok(Err(e.to_string())),
        }
    }

    /// GET com novas tentativas e espera crescente.
    pub fn obter(
        &self,
        url: &str,
        cancelar: &AtomicBool,
        aviso: &mut dyn FnMut(Evento),
    ) -> Result<Vec<u8>, ErroHttp> {
        let mut espera = self.cortesia.espera_inicial;
        for tentativa in 1..=self.cortesia.tentativas.max(1) {
            if cancelar.load(Ordering::Relaxed) {
                return Err(ErroHttp::Cancelado);
            }
            match self.tentar(url)? {
                Ok(v) => return Ok(v),
                Err(motivo) if tentativa < self.cortesia.tentativas => {
                    aviso(Evento::NovaTentativa {
                        arquivo: url.to_string(),
                        tentativa: tentativa + 1,
                        espera_s: espera.as_secs(),
                        motivo,
                    });
                    dormir(espera, cancelar)?;
                    espera *= 3;
                }
                Err(motivo) => {
                    return Err(ErroHttp::Rede {
                        url: url.to_string(),
                        detalhe: motivo,
                    });
                }
            }
        }
        unreachable!("o laço sempre devolve")
    }

    /// Consulta paginada por `limit`/`offset` que devolve `{ "<lista>": [...] }`.
    /// O deslocamento avança pelo número de itens **devolvidos** (a API do DEMAS devolve no
    /// máximo 860 itens mesmo pedindo mais) e para na primeira página vazia.
    pub fn paginado_json(
        &self,
        base: &str,
        lista: &str,
        tamanho_pagina: usize,
        cancelar: &AtomicBool,
        aviso: &mut dyn FnMut(Evento),
    ) -> Result<Vec<serde_json::Value>, ErroHttp> {
        let mut itens = Vec::new();
        let sep = if base.contains('?') { '&' } else { '?' };
        for pagina in 0..MAX_PAGINAS {
            if pagina > 0 {
                dormir(self.cortesia.pausa_entre_arquivos, cancelar)?;
            }
            let url = format!("{base}{sep}limit={tamanho_pagina}&offset={}", itens.len());
            let corpo = self.obter(&url, cancelar, aviso)?;
            let v: serde_json::Value =
                serde_json::from_slice(&corpo).map_err(|e| ErroHttp::Formato {
                    url: url.clone(),
                    detalhe: e.to_string(),
                })?;
            let arr = v
                .get(lista)
                .and_then(|x| x.as_array())
                .ok_or_else(|| ErroHttp::Formato {
                    url: url.clone(),
                    detalhe: format!("sem a lista '{lista}'"),
                })?;
            if arr.is_empty() {
                aviso(Evento::Concluido {
                    arquivo: base.to_string(),
                });
                return Ok(itens);
            }
            itens.extend(arr.iter().cloned());
            aviso(Evento::Progresso {
                arquivo: base.to_string(),
                feito: itens.len() as u64,
                total: 0,
            });
        }
        Err(ErroHttp::Paginas {
            url: base.to_string(),
        })
    }
}
