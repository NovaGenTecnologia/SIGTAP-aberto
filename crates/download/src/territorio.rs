//! Território: baixa as respostas oficiais do IBGE e do DEMAS para `dados\territorio\`, com
//! validação antes de entrar na pasta, e lê a pasta (download ou importação manual).
//!
//! Arquivos na pasta (os mesmos para importação manual):
//! - `ibge_municipios.json`: resposta de `URL_IBGE`, sem alteração;
//! - `demas_municipios.json`: lista JSON com os itens de todas as páginas de `URL_DEMAS`;
//! - `origem.json`: de onde e quando cada arquivo veio (só no download; na importação manual,
//!   a origem registrada é "importação manual" com a data do arquivo).

use crate::cortesia::Evento;
use crate::http::{ErroHttp, Http};
use sa_sources::territorio::{ErroTerritorio, MunicipioIbge, MunicipioSaude, ler_demas, ler_ibge};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

pub const URL_IBGE: &str =
    "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";
pub const URL_DEMAS: &str =
    "https://apidadosabertos.saude.gov.br/macrorregiao-e-regiao-de-saude/municipio";
/// Lista dentro da resposta do DEMAS.
pub const LISTA_DEMAS: &str = "macrorregiao_regiao_saude_municipios";
/// Tamanho de página pedido ao DEMAS (ele devolve no máximo 860).
pub const PAGINA_DEMAS: usize = 1000;

pub const ARQ_IBGE: &str = "ibge_municipios.json";
pub const ARQ_DEMAS: &str = "demas_municipios.json";
pub const ARQ_ORIGEM: &str = "origem.json";

/// Erro do território.
#[derive(Debug)]
pub enum ErroTerritorioDl {
    Http(ErroHttp),
    Fonte(ErroTerritorio),
    Arquivo(PathBuf, String),
}

impl fmt::Display for ErroTerritorioDl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroTerritorioDl::Http(e) => e.fmt(f),
            ErroTerritorioDl::Fonte(e) => e.fmt(f),
            ErroTerritorioDl::Arquivo(p, e) => write!(
                f,
                "não foi possível usar {} ({e}). Para importar à mão, coloque {ARQ_IBGE} e {ARQ_DEMAS} nessa pasta",
                p.display()
            ),
        }
    }
}

impl std::error::Error for ErroTerritorioDl {}

impl From<ErroHttp> for ErroTerritorioDl {
    fn from(e: ErroHttp) -> Self {
        ErroTerritorioDl::Http(e)
    }
}

impl From<ErroTerritorio> for ErroTerritorioDl {
    fn from(e: ErroTerritorio) -> Self {
        ErroTerritorioDl::Fonte(e)
    }
}

/// Origem de um arquivo do território.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrigemArquivo {
    pub url: String,
    pub obtido_em: String,
    pub sha256: String,
}

/// Conteúdo lido da pasta, já validado.
#[derive(Debug, Clone)]
pub struct Territorio {
    pub ibge: Vec<MunicipioIbge>,
    pub demas: Vec<MunicipioSaude>,
    pub origem_ibge: OrigemArquivo,
    pub origem_demas: OrigemArquivo,
}

fn sha256(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

fn gravar_validado(pasta: &Path, nome: &str, conteudo: &[u8]) -> Result<(), ErroTerritorioDl> {
    let final_ = pasta.join(nome);
    let parcial = pasta.join(format!("{nome}.parcial"));
    std::fs::write(&parcial, conteudo)
        .map_err(|e| ErroTerritorioDl::Arquivo(parcial.clone(), e.to_string()))?;
    std::fs::rename(&parcial, &final_).map_err(|e| ErroTerritorioDl::Arquivo(final_, e.to_string()))
}

/// Baixa as duas fontes para `pasta` (cria a pasta). Só substitui os arquivos anteriores
/// depois que os dois novos passam na validação.
pub fn baixar(
    http: &Http,
    pasta: &Path,
    cancelar: &AtomicBool,
    aviso: &mut dyn FnMut(Evento),
) -> Result<(), ErroTerritorioDl> {
    baixar_de(http, URL_IBGE, URL_DEMAS, pasta, cancelar, aviso)
}

/// Como [`baixar`], com os endereços dados (testes com servidor local).
pub fn baixar_de(
    http: &Http,
    url_ibge: &str,
    url_demas: &str,
    pasta: &Path,
    cancelar: &AtomicBool,
    aviso: &mut dyn FnMut(Evento),
) -> Result<(), ErroTerritorioDl> {
    std::fs::create_dir_all(pasta)
        .map_err(|e| ErroTerritorioDl::Arquivo(pasta.to_path_buf(), e.to_string()))?;
    aviso(Evento::Iniciando {
        arquivo: ARQ_IBGE.into(),
        total: 0,
        retomando_de: 0,
    });
    let ibge = http.obter(url_ibge, cancelar, aviso)?;
    let quando_ibge = sa_core::tempo::agora_iso_utc();
    ler_ibge(&ibge)?;
    aviso(Evento::Concluido {
        arquivo: ARQ_IBGE.into(),
    });
    aviso(Evento::Iniciando {
        arquivo: ARQ_DEMAS.into(),
        total: 0,
        retomando_de: 0,
    });
    let itens = http.paginado_json(url_demas, LISTA_DEMAS, PAGINA_DEMAS, cancelar, aviso)?;
    let quando_demas = sa_core::tempo::agora_iso_utc();
    ler_demas(&itens)?;
    let demas = serde_json::to_vec(&itens)
        .map_err(|e| ErroTerritorioDl::Arquivo(pasta.join(ARQ_DEMAS), e.to_string()))?;
    let origem = serde_json::json!({
        "ibge": { "url": url_ibge, "obtido_em": quando_ibge, "sha256": sha256(&ibge) },
        "demas": { "url": url_demas, "obtido_em": quando_demas, "sha256": sha256(&demas),
                   "paginas_de": PAGINA_DEMAS },
    });
    gravar_validado(pasta, ARQ_IBGE, &ibge)?;
    gravar_validado(pasta, ARQ_DEMAS, &demas)?;
    gravar_validado(pasta, ARQ_ORIGEM, origem.to_string().as_bytes())?;
    Ok(())
}

fn data_do_arquivo(p: &Path) -> String {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .map(sa_core::tempo::iso_utc)
        .unwrap_or_else(|_| "desconhecida".into())
}

/// Lê e valida os arquivos da pasta (download anterior ou importação manual).
pub fn ler_pasta(pasta: &Path) -> Result<Territorio, ErroTerritorioDl> {
    let ler = |nome: &str| -> Result<Vec<u8>, ErroTerritorioDl> {
        let p = pasta.join(nome);
        // Limite de memória: os arquivos esperados têm ~2–3 MB.
        let m = std::fs::metadata(&p)
            .map_err(|e| ErroTerritorioDl::Arquivo(p.clone(), e.to_string()))?;
        if m.len() > crate::http::LIMITE_RESPOSTA {
            return Err(ErroTerritorioDl::Arquivo(p, "arquivo grande demais".into()));
        }
        std::fs::read(&p).map_err(|e| ErroTerritorioDl::Arquivo(p, e.to_string()))
    };
    let b_ibge = ler(ARQ_IBGE)?;
    let b_demas = ler(ARQ_DEMAS)?;
    let ibge = ler_ibge(&b_ibge)?;
    let itens: Vec<serde_json::Value> = serde_json::from_slice(&b_demas).map_err(|e| {
        ErroTerritorioDl::Fonte(ErroTerritorio(format!(
            "{ARQ_DEMAS} não é uma lista JSON ({e})"
        )))
    })?;
    let demas = ler_demas(&itens)?;
    let origem: Option<serde_json::Value> = std::fs::read(pasta.join(ARQ_ORIGEM))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let manual = |nome: &str, b: &[u8]| OrigemArquivo {
        url: format!("importação manual: {nome}"),
        obtido_em: data_do_arquivo(&pasta.join(nome)),
        sha256: sha256(b),
    };
    let da_origem = |chave: &str, nome: &str, b: &[u8]| -> OrigemArquivo {
        let s = sha256(b);
        match &origem {
            // Só vale a origem registrada se o arquivo for o mesmo que foi baixado.
            Some(o) if o[chave]["sha256"].as_str() == Some(s.as_str()) => OrigemArquivo {
                url: o[chave]["url"].as_str().unwrap_or_default().to_string(),
                obtido_em: o[chave]["obtido_em"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                sha256: s,
            },
            _ => manual(nome, b),
        }
    };
    Ok(Territorio {
        origem_ibge: da_origem("ibge", ARQ_IBGE, &b_ibge),
        origem_demas: da_origem("demas", ARQ_DEMAS, &b_demas),
        ibge,
        demas,
    })
}

/// Importação manual: prepara em `destino` os arquivos do território encontrados em `origem`.
/// Aceita `ibge_municipios.json` e, para o DEMAS, `demas_municipios.json` (lista já juntada)
/// ou as páginas salvas do navegador (`demas*.json`, cada uma com a lista
/// `macrorregiao_regiao_saude_municipios` ou uma lista simples), que são juntadas.
/// Devolve `Ok(None)` quando a pasta não tem território, ou o número de páginas juntadas.
/// Não valida o conteúdo: chame [`ler_pasta`] em `destino` depois.
pub fn preparar_importacao(
    origem: &Path,
    destino: &Path,
) -> Result<Option<usize>, ErroTerritorioDl> {
    let ibge = origem.join(ARQ_IBGE);
    if !ibge.exists() {
        return Ok(None);
    }
    let erro = |p: &Path, e: String| ErroTerritorioDl::Arquivo(p.to_path_buf(), e);
    let paginas: Vec<PathBuf> = if origem.join(ARQ_DEMAS).exists() {
        vec![origem.join(ARQ_DEMAS)]
    } else {
        let mut v: Vec<PathBuf> = std::fs::read_dir(origem)
            .map_err(|e| erro(origem, e.to_string()))?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                let n = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                n.starts_with("demas") && n.ends_with(".json")
            })
            .collect();
        v.sort();
        v
    };
    if paginas.is_empty() {
        return Ok(None);
    }
    let mut itens: Vec<serde_json::Value> = Vec::new();
    for p in &paginas {
        let m = std::fs::metadata(p).map_err(|e| erro(p, e.to_string()))?;
        if m.len() > crate::http::LIMITE_RESPOSTA {
            return Err(erro(p, "arquivo grande demais".into()));
        }
        let b = std::fs::read(p).map_err(|e| erro(p, e.to_string()))?;
        let v: serde_json::Value = serde_json::from_slice(&b)
            .map_err(|e| erro(p, format!("não é um JSON válido ({e})")))?;
        let lista = match &v {
            serde_json::Value::Array(a) => a,
            serde_json::Value::Object(o) => o
                .get(LISTA_DEMAS)
                .and_then(|x| x.as_array())
                .ok_or_else(|| erro(p, format!("não tem a lista '{LISTA_DEMAS}'")))?,
            _ => return Err(erro(p, "formato inesperado".into())),
        };
        itens.extend(lista.iter().cloned());
    }
    std::fs::create_dir_all(destino).map_err(|e| erro(destino, e.to_string()))?;
    std::fs::copy(&ibge, destino.join(ARQ_IBGE)).map_err(|e| erro(&ibge, e.to_string()))?;
    let juntos = serde_json::to_vec(&itens).map_err(|e| erro(destino, e.to_string()))?;
    std::fs::write(destino.join(ARQ_DEMAS), juntos)
        .map_err(|e| erro(&destino.join(ARQ_DEMAS), e.to_string()))?;
    let _ = std::fs::remove_file(destino.join(ARQ_ORIGEM));
    Ok(Some(paginas.len()))
}
