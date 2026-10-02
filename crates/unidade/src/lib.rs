//! Fase 3: módulo CNES por UF (baixar, importar, carregar), a unidade do usuário,
//! aptidão, rede e os dados do próprio usuário (favoritos, anotações, exportação).
//!
//! Onde fica cada coisa, sempre ao lado do programa:
//! - `dados\cnes\<UF>.db`: o banco do CNES da UF;
//! - `dados\cnes\arquivos\<UF>\`: os `.dbc` oficiais, `CADGER<UF>.dbf` e `cnv\`, guardados para
//!   o banco poder ser refeito sem baixar de novo. O arquivo de profissionais (PF) é a exceção:
//!   traz todas as pessoas da UF, então é apagado logo depois de carregar a unidade escolhida;
//! - `dados\usuario.db`: favoritos, anotações e a unidade escolhida.

use sa_core::Competencia;
use sa_download::cnes as dl;
use sa_download::cortesia::Evento;
use sa_packs::cnes::{BancoCnes, Filtro, Origem, sha256_hex};
use sa_packs::saude;
use sa_packs::territorio::BancoTerritorio;
use sa_packs::usuario::BancoUsuario;
use sa_query::Consulta;
use sa_query::cnes::{ConsultaCnes, Estado};
use sa_sources::cnes::{Manifesto, ler_cnv};
use sa_sources::{dbc, latin1};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

/// Onde o programa guarda os dados (a pasta `dados` ao lado do executável).
#[derive(Debug, Clone)]
pub struct Pastas {
    pub dados: PathBuf,
}

impl Pastas {
    pub fn territorio_db(&self) -> PathBuf {
        self.dados.join("territorio.db")
    }
}

/// Andamento de uma tarefa longa.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Progresso {
    pub resumo: String,
    pub mensagem: String,
    /// De 0 a 1.
    pub fracao: f64,
    pub indeterminado: bool,
}

/// Recebe o andamento (de qualquer thread).
pub type Emissor<'a> = &'a (dyn Fn(Progresso) + Sync);

const CHAVE_UNIDADE: &str = "minha_unidade";
/// Unidades guardadas para troca rápida: "UF:CNES,UF:CNES". A de `CHAVE_UNIDADE` é a ativa.
const CHAVE_UNIDADES: &str = "minhas_unidades";
/// Terceiros contratados de uma unidade: chave `terceiros:UF:CNES` da unidade, valor "UF:CNES,UF:CNES".
/// Cada unidade tem a sua lista; o mesmo terceiro pode estar em várias.
fn chave_terceiros(uf: &str, cnes: &str) -> String {
    format!("terceiros:{uf}:{cnes}")
}
/// Tipos sempre baixados; PF só quando a unidade do usuário é da UF.
const TIPOS_BASE: [&str; 5] = ["ST", "HB", "SR", "LT", "EQ"];

pub fn pasta_cnes(p: &Pastas) -> PathBuf {
    p.dados.join("cnes")
}
pub fn banco_cnes(p: &Pastas, uf: &str) -> PathBuf {
    pasta_cnes(p).join(format!("{uf}.db"))
}
pub fn arquivos_cnes(p: &Pastas, uf: &str) -> PathBuf {
    pasta_cnes(p).join("arquivos").join(uf)
}
pub fn banco_usuario(p: &Pastas) -> PathBuf {
    p.dados.join("usuario.db")
}

fn exigir_uf(uf: &str) -> Result<(), String> {
    if dl::uf_valida(uf) {
        Ok(())
    } else {
        Err(format!("\"{uf}\" não é a sigla de uma UF"))
    }
}

/// Abre o banco do usuário (cria a pasta de dados se preciso).
pub fn usuario(p: &Pastas) -> Result<BancoUsuario, String> {
    std::fs::create_dir_all(&p.dados).map_err(|e| {
        format!(
            "não foi possível criar {} ({e}). Verifique se a pasta do programa não é só leitura",
            p.dados.display()
        )
    })?;
    BancoUsuario::abrir(&banco_usuario(p)).map_err(|e| e.to_string())
}

/// A unidade que o usuário escolheu: (UF, CNES).
pub fn minha(p: &Pastas) -> Option<(String, String)> {
    if !banco_usuario(p).exists() {
        return None;
    }
    let v = usuario(p).ok()?.config(CHAVE_UNIDADE).ok()??;
    let (uf, cnes) = v.split_once(':')?;
    (dl::uf_valida(uf) && cnes.len() == 7).then(|| (uf.to_string(), cnes.to_string()))
}

fn ler_par(v: &str) -> Option<(String, String)> {
    let (uf, cnes) = v.trim().split_once(':')?;
    (dl::uf_valida(uf) && cnes.len() == 7 && cnes.bytes().all(|b| b.is_ascii_digit()))
        .then(|| (uf.to_string(), cnes.to_string()))
}

/// As unidades guardadas para troca rápida (a ativa sempre está entre elas).
pub fn minhas(p: &Pastas) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = Vec::new();
    if banco_usuario(p).exists()
        && let Ok(u) = usuario(p)
        && let Ok(Some(lista)) = u.config(CHAVE_UNIDADES)
    {
        for par in lista.split(',').filter_map(ler_par) {
            if !v.contains(&par) {
                v.push(par);
            }
        }
    }
    if let Some(ativa) = minha(p)
        && !v.contains(&ativa)
    {
        v.insert(0, ativa);
    }
    v
}

/// Terceiros contratados da unidade (na ordem de cadastro).
pub fn terceiros(p: &Pastas, uf: &str, cnes: &str) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = Vec::new();
    if banco_usuario(p).exists()
        && let Ok(u) = usuario(p)
        && let Ok(Some(lista)) = u.config(&chave_terceiros(uf, cnes))
    {
        for par in lista.split(',').filter_map(ler_par) {
            if !v.contains(&par) {
                v.push(par);
            }
        }
    }
    v
}

fn gravar_terceiros(
    p: &Pastas,
    uf: &str,
    cnes: &str,
    v: &[(String, String)],
) -> Result<(), String> {
    let texto = v
        .iter()
        .map(|(u, c)| format!("{u}:{c}"))
        .collect::<Vec<_>>()
        .join(",");
    usuario(p)?
        .gravar_config(
            &chave_terceiros(uf, cnes),
            (!texto.is_empty()).then_some(texto.as_str()),
        )
        .map_err(|e| e.to_string())
}

fn nome_da_unidade(p: &Pastas, uf: &str, cnes: &str) -> String {
    consulta_cnes(p, uf)
        .ok()
        .and_then(|q| q.buscar(cnes, 1).ok())
        .and_then(|v| v.into_iter().find(|e| e.cnes == cnes))
        .map(|e| e.nome)
        .unwrap_or_default()
}

/// Terceiros da unidade com o nome (vazio se o CNES da UF não está carregado).
pub fn terceiros_com_nome(p: &Pastas, uf: &str, cnes: &str) -> serde_json::Value {
    let v: Vec<serde_json::Value> = terceiros(p, uf, cnes)
        .into_iter()
        .map(|(tuf, tcnes)| {
            let nome = nome_da_unidade(p, &tuf, &tcnes);
            json!({ "uf": tuf, "cnes": tcnes, "nome": nome })
        })
        .collect();
    json!(v)
}

/// Cadastra `tcnes` (de `tuf`) como terceiro contratado da unidade `uf`/`cnes`. O CNES do
/// terceiro tem de estar no cadastro da UF carregada, e uma unidade não é terceira de si mesma.
pub fn adicionar_terceiro(
    p: &Pastas,
    uf: &str,
    cnes: &str,
    tuf: &str,
    tcnes: &str,
) -> Result<serde_json::Value, String> {
    exigir_uf(uf)?;
    exigir_uf(tuf)?;
    if uf == tuf && cnes == tcnes {
        return Err("a unidade não pode ser terceira de si mesma".into());
    }
    let q = consulta_cnes(p, tuf)?;
    let achado = q
        .buscar(tcnes, 5)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|e| e.cnes == tcnes)
        .ok_or_else(|| format!("o CNES {tcnes} não está no cadastro de {tuf} carregado. Confira o número ou baixe o CNES de {tuf}"))?;
    drop(q);
    let mut lista = terceiros(p, uf, cnes);
    let par = (tuf.to_string(), tcnes.to_string());
    if !lista.contains(&par) {
        lista.push(par);
    }
    gravar_terceiros(p, uf, cnes, &lista)?;
    Ok(json!({ "uf": tuf, "cnes": tcnes, "nome": achado.nome }))
}

pub fn remover_terceiro(
    p: &Pastas,
    uf: &str,
    cnes: &str,
    tuf: &str,
    tcnes: &str,
) -> Result<(), String> {
    let par = (tuf.to_string(), tcnes.to_string());
    let mut lista = terceiros(p, uf, cnes);
    lista.retain(|x| x != &par);
    gravar_terceiros(p, uf, cnes, &lista)
}

fn gravar_unidades(p: &Pastas, v: &[(String, String)]) -> Result<(), String> {
    let texto = v
        .iter()
        .map(|(u, c)| format!("{u}:{c}"))
        .collect::<Vec<_>>()
        .join(",");
    usuario(p)?
        .gravar_config(
            CHAVE_UNIDADES,
            (!texto.is_empty()).then_some(texto.as_str()),
        )
        .map_err(|e| e.to_string())
}

/// UFs com banco do CNES.
pub fn ufs_carregadas(p: &Pastas) -> Vec<String> {
    dl::UFS
        .iter()
        .filter(|uf| banco_cnes(p, uf).exists())
        .map(|uf| uf.to_string())
        .collect()
}

/// Abre as consultas do CNES de uma UF. Banco gravado por versão anterior do programa é guardado
/// à parte e refeito dos arquivos; por versão mais nova, é recusado sem alteração.
pub fn consulta_cnes(p: &Pastas, uf: &str) -> Result<ConsultaCnes, String> {
    exigir_uf(uf)?;
    let db = banco_cnes(p, uf);
    if !db.exists() {
        return Err(format!(
            "o CNES de {uf} ainda não foi baixado. Baixe em Módulos e dados"
        ));
    }
    match saude::compatibilidade(
        saude::versao_esquema(&db)?.as_deref(),
        sa_packs::cnes::VERSAO_ESQUEMA,
    ) {
        saude::Compatibilidade::MaisNova(v) => {
            return Err(format!(
                "o CNES de {uf} foi gravado por uma versão mais nova do programa (esquema {v}). Atualize o programa; nada foi alterado"
            ));
        }
        saude::Compatibilidade::Anterior(v) => {
            let leiame = format!(
                "Banco do CNES gravado por uma versão anterior do SIGTAP Aberto (esquema {v}).\r\n\
                 O programa o refez a partir dos arquivos oficiais guardados em dados\\cnes\\arquivos.\r\n\
                 Pode apagar esta pasta.\r\n"
            );
            saude::guardar_em_pasta(&db, &p.dados, "versao_anterior", &leiame)?;
            carregar_uf(p, uf, &|_| {})?;
        }
        _ => {}
    }
    ConsultaCnes::abrir(&db).map_err(|e| e.to_string())
}

fn ler_dbc(caminho: &Path) -> Result<(u64, String, Vec<u8>), String> {
    let bruto = std::fs::read(caminho)
        .map_err(|e| format!("não foi possível ler {} ({e})", caminho.display()))?;
    let dbf = dbc::para_dbf(&bruto, dbc::LIMITE_PADRAO)
        .map_err(|e| format!("{}: {e}. Baixe o arquivo de novo", caminho.display()))?;
    Ok((bruto.len() as u64, sha256_hex(&bruto), dbf))
}

/// (Re)monta o banco do CNES de uma UF a partir dos arquivos guardados. Devolve um resumo.
pub fn carregar_uf(p: &Pastas, uf: &str, avisar: &dyn Fn(&str)) -> Result<String, String> {
    carregar(p, uf, false, avisar)
}

/// Carrega só os profissionais da unidade escolhida (sem refazer o resto do banco).
fn carregar_profissionais(p: &Pastas, uf: &str) -> Result<String, String> {
    carregar(p, uf, true, &|_| {})
}

fn carregar(
    p: &Pastas,
    uf: &str,
    so_escolhidos: bool,
    avisar: &dyn Fn(&str),
) -> Result<String, String> {
    exigir_uf(uf)?;
    let pasta = arquivos_cnes(p, uf);
    let locais = dl::locais(&pasta, uf);
    if !locais.contains_key("ST") {
        return Err(format!(
            "não há arquivo de estabelecimentos (ST{uf}AAMM.dbc) em {}. Baixe o CNES de {uf} ou importe os arquivos",
            pasta.display()
        ));
    }
    std::fs::create_dir_all(pasta_cnes(p)).map_err(|e| e.to_string())?;
    let m = Manifesto::carregar();
    let mut b = BancoCnes::abrir(&banco_cnes(p, uf)).map_err(|e| e.to_string())?;
    let meus: Option<HashSet<String>> = minha(p).filter(|(u, _)| u == uf).map(|(_, c)| [c].into());
    let mut partes = Vec::new();
    let mut competencias: HashSet<String> = HashSet::new();
    for t in &m.tipos {
        let Some((_, caminho)) = locais.get(&t.codigo) else {
            continue;
        };
        if so_escolhidos && !t.so_cnes_escolhidos {
            continue;
        }
        if t.so_cnes_escolhidos && meus.is_none() {
            // Arquivo de pessoas sem unidade escolhida: não é carregado nem guardado.
            let _ = std::fs::remove_file(caminho);
            continue;
        }
        avisar(&format!(
            "Carregando {} ({})",
            t.nome,
            caminho.file_name().unwrap_or_default().to_string_lossy()
        ));
        let (bytes, sha, dbf) = ler_dbc(caminho)?;
        let nome = caminho
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let origem = Origem {
            uf,
            arquivo: &nome,
            sha256: &sha,
            bytes,
        };
        let filtro = Filtro {
            municipios: None,
            cnes: if t.so_cnes_escolhidos {
                meus.as_ref()
            } else {
                None
            },
        };
        let c = b
            .carregar(&m, &t.codigo, &origem, &dbf, &filtro)
            .map_err(|e| e.to_string())?;
        if t.so_cnes_escolhidos {
            // O arquivo traz todas as pessoas da UF: fica só o que foi para o banco (a unidade
            // escolhida, sem CPF nem CNS). Trocar de unidade pede baixar de novo.
            drop(dbf);
            std::fs::remove_file(caminho).map_err(|e| {
                format!(
                    "não foi possível apagar {} depois de carregar ({e})",
                    caminho.display()
                )
            })?;
        } else {
            competencias.insert(c.competencia.clone());
        }
        partes.push(format!("{} {}", c.gravados, t.nome.to_lowercase()));
    }
    if so_escolhidos {
        return Ok(partes.join(", "));
    }
    let cad = pasta.join(format!("CADGER{uf}.dbf"));
    if cad.exists() {
        avisar("Carregando os nomes dos estabelecimentos");
        let bytes = std::fs::read(&cad).map_err(|e| e.to_string())?;
        let origem = Origem {
            uf,
            arquivo: &format!("CADGER{uf}.dbf"),
            sha256: &sha256_hex(&bytes),
            bytes: bytes.len() as u64,
        };
        b.carregar_cadastro(&m, &origem, &bytes)
            .map_err(|e| e.to_string())?;
    }
    let comp_st = locais
        .get("ST")
        .map(|(c, _)| c.to_string())
        .unwrap_or_default();
    for d in &m.decodificadores {
        let arq = pasta.join("cnv").join(d.arquivo.to_ascii_lowercase());
        if d.vale_em(&comp_st)
            && let Ok(bytes) = std::fs::read(&arq)
        {
            b.gravar_decodificador(
                &d.chave(),
                &d.arquivo,
                &ler_cnv(&latin1::decodificar(&bytes)),
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let mut msg = format!("CNES de {uf} carregado: {}.", partes.join(", "));
    if competencias.len() > 1 {
        msg.push_str(" Atenção: os arquivos são de competências diferentes; baixe o CNES de novo para alinhar.");
    }
    if !cad.exists() {
        msg.push_str(" Nomes dos estabelecimentos e descrições de órgão responsável indisponíveis no momento (arquivo auxiliar do DATASUS não baixado); tente \"Baixar de novo\" mais tarde.");
    }
    Ok(msg)
}

/// O que baixar do CNES.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PedidoCnes {
    pub uf: String,
    /// `AAAAMM`; vazio = a mais recente do servidor.
    #[serde(default)]
    pub competencia: String,
}

fn emitir(emissor: Emissor<'_>, resumo: &str, mensagem: &str, fracao: f64, indeterminado: bool) {
    emissor(Progresso {
        resumo: resumo.into(),
        mensagem: mensagem.into(),
        fracao: fracao.clamp(0.0, 1.0),
        indeterminado,
    });
}

/// Baixa o CNES de uma UF do servidor oficial e carrega.
pub fn baixar_cnes(
    p: &Pastas,
    pedido: &PedidoCnes,
    cancelar: &AtomicBool,
    emissor: Emissor<'_>,
) -> Result<String, String> {
    baixar_cnes_de(&dl::Fonte::oficial(), p, pedido, cancelar, emissor)
}

pub fn baixar_cnes_de(
    fonte: &dl::Fonte,
    p: &Pastas,
    pedido: &PedidoCnes,
    cancelar: &AtomicBool,
    emissor: Emissor<'_>,
) -> Result<String, String> {
    let uf = pedido.uf.as_str();
    exigir_uf(uf)?;
    let resumo = format!("Baixando o CNES de {uf}");
    emitir(
        emissor,
        &resumo,
        "Consultando o servidor do DATASUS",
        0.0,
        true,
    );
    let competencia = if pedido.competencia.is_empty() {
        dl::competencias(fonte, uf)
            .map_err(|e| e.to_string())?
            .last()
            .map(|c| c.0)
            .ok_or_else(|| {
                format!("o servidor do DATASUS não tem arquivos do CNES de {uf}. Tente mais tarde")
            })?
    } else {
        Competencia::de_texto(&pedido.competencia).map_err(|e| e.to_string())?
    };
    let mut tipos: Vec<String> = TIPOS_BASE.iter().map(|t| t.to_string()).collect();
    if minha(p).is_some_and(|(u, _)| u == uf) {
        tipos.push("PF".into());
    }
    let destino = arquivos_cnes(p, uf);
    // Etapas: cada arquivo, mais 3 trechos dos auxiliares, mais a carga.
    let etapas = (tipos.len() + 4) as f64;
    let feitos = std::sync::atomic::AtomicUsize::new(0);
    let progresso = |e: Evento| {
        use std::sync::atomic::Ordering::SeqCst;
        let n = feitos.load(SeqCst) as f64;
        let (msg, parte) = match &e {
            Evento::Iniciando { arquivo, total, .. } => {
                (format!("Baixando {arquivo} ({} KB)", total / 1024), 0.0)
            }
            Evento::Progresso {
                arquivo,
                feito,
                total,
            } => (
                format!("Baixando {arquivo}"),
                if *total > 0 {
                    *feito as f64 / *total as f64
                } else {
                    0.0
                },
            ),
            Evento::NovaTentativa {
                arquivo,
                tentativa,
                espera_s,
                motivo,
            } => (
                format!(
                    "{arquivo}: nova tentativa ({tentativa}) em {espera_s} s. Motivo: {motivo}"
                ),
                0.0,
            ),
            Evento::Concluido { arquivo } => {
                feitos.fetch_add(1, SeqCst);
                (format!("{arquivo} baixado"), 1.0)
            }
        };
        emitir(emissor, &resumo, &msg, (n + parte) / etapas, false);
    };
    // Mesma competência já guardada, com o cadastro de nomes: não baixa os auxiliares de novo
    // (é o caso de "baixar os profissionais" depois de escolher a unidade).
    let auxiliares_em_dia = dl::locais(&destino, uf)
        .get("ST")
        .is_some_and(|(c, _)| *c == competencia)
        && destino.join(format!("CADGER{uf}.dbf")).exists();
    dl::baixar(
        fonte,
        uf,
        competencia,
        &tipos,
        &destino,
        cancelar,
        &progresso,
    )
    .map_err(|e| e.to_string())?;
    let m = Manifesto::carregar();
    let cnv: Vec<String> = m
        .decodificadores
        .iter()
        .map(|d| d.arquivo.clone())
        .collect();
    let aux = (!auxiliares_em_dia)
        .then(|| dl::baixar_auxiliares(fonte, uf, &cnv, &destino, cancelar, &progresso));
    let aviso_aux = match aux {
        None => String::new(),
        Some(Ok(a)) if a.cnv_ausentes.is_empty() => String::new(),
        Some(Ok(a)) => format!(
            " Tabelas de nomes ausentes na fonte: {}.",
            a.cnv_ausentes.join(", ")
        ),
        Some(Err(sa_download::cortesia::ErroDownload::Cancelado)) => {
            return Err(sa_download::cortesia::ErroDownload::Cancelado.to_string());
        }
        // Sem os auxiliares o CNES ainda serve (códigos sem nome): avisa em vez de falhar.
        Some(Err(e)) => format!(
            " Os nomes dos estabelecimentos e as descrições de órgão responsável, natureza jurídica e esfera estão indisponíveis no momento: o servidor do DATASUS não entregou o arquivo auxiliar ({e}). Não é falha do programa; tente \"Baixar de novo\" mais tarde."
        ),
    };
    emitir(
        emissor,
        &resumo,
        "Carregando no banco",
        (etapas - 1.0) / etapas,
        false,
    );
    let msg = carregar_uf(p, uf, &|t| {
        emitir(emissor, &resumo, t, (etapas - 1.0) / etapas, false)
    })?;
    Ok(format!("{msg}{aviso_aux}"))
}

/// Importação manual: arquivos que o usuário baixou por conta própria.
pub fn importar_cnes(
    p: &Pastas,
    origem: &Path,
    uf: &str,
    emissor: Emissor<'_>,
) -> Result<String, String> {
    exigir_uf(uf)?;
    let resumo = format!("Importando o CNES de {uf}");
    emitir(
        emissor,
        &resumo,
        "Conferindo os arquivos da pasta",
        0.1,
        false,
    );
    let m = Manifesto::carregar();
    let cnv: Vec<String> = m
        .decodificadores
        .iter()
        .map(|d| d.arquivo.clone())
        .collect();
    let r =
        dl::importar_pasta(origem, &arquivos_cnes(p, uf), uf, &cnv).map_err(|e| e.to_string())?;
    if r.dbc.is_empty() && !r.cadastro && r.cnv == 0 {
        let recusas = if r.recusados.is_empty() {
            String::new()
        } else {
            format!(
                " Recusados: {}.",
                r.recusados
                    .iter()
                    .map(|(n, m)| format!("{n} ({m})"))
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        };
        return Err(format!(
            "não achei arquivos do CNES de {uf} em {}. Esperados: ST{uf}AAMM.dbc, HB, SR, LT, EQ (e PF), CADGER{uf}.dbf ou TAB_CNES.zip.{recusas}",
            origem.display()
        ));
    }
    let msg = carregar_uf(p, uf, &|t| emitir(emissor, &resumo, t, 0.6, false))?;
    let mut fim = format!("{msg} Importados {} arquivo(s) .dbc", r.dbc.len());
    if !r.recusados.is_empty() {
        fim.push_str(&format!(
            "; {} recusado(s): {}",
            r.recusados.len(),
            r.recusados
                .iter()
                .map(|x| x.0.clone())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    fim.push('.');
    Ok(fim)
}

/// Situação do módulo CNES para "Módulos e dados" e para a barra.
pub fn situacao(p: &Pastas) -> serde_json::Value {
    let ufs: Vec<serde_json::Value> = ufs_carregadas(p)
        .iter()
        .map(|uf| match consulta_cnes(p, uf).and_then(|q| q.resumo().map_err(|e| e.to_string())) {
            Ok(r) => json!({ "uf": uf, "resumo": r, "bytes": std::fs::metadata(banco_cnes(p, uf)).map(|m| m.len()).unwrap_or(0) }),
            Err(e) => json!({ "uf": uf, "erro": e }),
        })
        .collect();
    let minha = minha(p).map(|(uf, cnes)| {
        let nome = consulta_cnes(p, &uf)
            .ok()
            .and_then(|q| q.buscar(&cnes, 1).ok())
            .and_then(|v| v.into_iter().next())
            .map(|e| e.nome)
            .unwrap_or_default();
        json!({ "uf": uf, "cnes": cnes, "nome": nome })
    });
    let unidades: Vec<serde_json::Value> = minhas(p)
        .into_iter()
        .map(|(uf, cnes)| {
            let nome = consulta_cnes(p, &uf)
                .ok()
                .and_then(|q| q.buscar(&cnes, 1).ok())
                .and_then(|v| v.into_iter().next())
                .map(|e| e.nome)
                .unwrap_or_default();
            json!({ "uf": uf, "cnes": cnes, "nome": nome })
        })
        .collect();
    json!({ "ufs": ufs, "minha": minha, "unidades": unidades, "terceiros": minha.as_ref().map_or_else(|| json!([]), |m| terceiros_com_nome(p, m["uf"].as_str().unwrap_or_default(), m["cnes"].as_str().unwrap_or_default())), "ufs_disponiveis": dl::UFS })
}

/// Escolhe a unidade ativa (e a guarda na lista de troca rápida). Carrega os profissionais dela
/// se o arquivo já estiver guardado. Escolher a que já está ativa não muda nada.
pub fn definir_minha(p: &Pastas, uf: &str, cnes: &str) -> Result<serde_json::Value, String> {
    exigir_uf(uf)?;
    let q = consulta_cnes(p, uf)?;
    let achado = q
        .buscar(cnes, 5)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|e| e.cnes == cnes)
        .ok_or_else(|| format!("o CNES {cnes} não está no cadastro de {uf} carregado. Confira o número ou baixe o CNES de novo"))?;
    drop(q);
    let mut lista = minhas(p);
    let par = (uf.to_string(), cnes.to_string());
    if !lista.contains(&par) {
        lista.push(par.clone());
    }
    if minha(p).as_ref() == Some(&par) {
        gravar_unidades(p, &lista)?;
        return Ok(json!({ "uf": uf, "cnes": cnes, "nome": achado.nome, "profissionais": false }));
    }
    // Os profissionais são só da unidade ativa: os da anterior saem do banco.
    if let Some((uf_antes, _)) = minha(p) {
        remover_profissionais(p, &uf_antes)?;
    }
    usuario(p)?
        .gravar_config(CHAVE_UNIDADE, Some(&format!("{uf}:{cnes}")))
        .map_err(|e| e.to_string())?;
    gravar_unidades(p, &lista)?;
    let tem_pf = dl::locais(&arquivos_cnes(p, uf), uf).contains_key("PF");
    if tem_pf {
        carregar_profissionais(p, uf)?;
    }
    Ok(json!({ "uf": uf, "cnes": cnes, "nome": achado.nome, "profissionais": tem_pf }))
}

/// Tira uma unidade da lista de troca rápida. Se era a ativa, passa a ativa a primeira que
/// sobrar (ou nenhuma); os profissionais dela saem do banco.
pub fn remover_unidade(p: &Pastas, uf: &str, cnes: &str) -> Result<(), String> {
    let par = (uf.to_string(), cnes.to_string());
    let mut lista = minhas(p);
    lista.retain(|x| x != &par);
    let era_ativa = minha(p).as_ref() == Some(&par);
    gravar_unidades(p, &lista)?;
    gravar_terceiros(p, uf, cnes, &[])?;
    if era_ativa {
        remover_profissionais(p, uf)?;
        usuario(p)?
            .gravar_config(CHAVE_UNIDADE, None)
            .map_err(|e| e.to_string())?;
        if let Some((u, c)) = lista.first() {
            definir_minha(p, u, c)?;
        }
    }
    Ok(())
}

/// Esquece a unidade ativa (sai da lista de troca rápida; os profissionais dela saem do banco).
pub fn limpar_minha(p: &Pastas) -> Result<(), String> {
    match minha(p) {
        Some((uf, cnes)) => remover_unidade(p, &uf, &cnes),
        None => Ok(()),
    }
}

/// Apaga do banco da UF as tabelas que só existem para a unidade escolhida (profissionais).
fn remover_profissionais(p: &Pastas, uf: &str) -> Result<(), String> {
    if !banco_cnes(p, uf).exists() {
        return Ok(());
    }
    let m = Manifesto::carregar();
    let mut b = BancoCnes::abrir(&banco_cnes(p, uf)).map_err(|e| e.to_string())?;
    for t in m.tipos.iter().filter(|t| t.so_cnes_escolhidos) {
        b.remover(&t.codigo).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sem_unidade() -> String {
    "nenhuma unidade escolhida. Escolha a sua unidade em Minha unidade".to_string()
}

/// Uma unidade, completa: a `alvo` (UF, CNES) ou, sem alvo, a ativa. Qualquer estabelecimento
/// de uma UF carregada pode ser visto; os profissionais só existem para a unidade ativa.
pub fn unidade(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    alvo: Option<(&str, &str)>,
) -> Result<serde_json::Value, String> {
    let (uf, cnes) = match alvo {
        Some((u, c)) => {
            exigir_uf(u)?;
            (u.to_string(), c.to_string())
        }
        None => minha(p).ok_or_else(sem_unidade)?,
    };
    let q = consulta_cnes(p, &uf)?;
    let u = q
        .unidade(sig, comp, &cnes)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("o CNES {cnes} não está mais no cadastro de {uf} carregado. Escolha a unidade de novo"))?;
    let mut v = serde_json::to_value(&u).map_err(|e| e.to_string())?;
    v["uf"] = json!(uf);
    v["ativa"] = json!(minha(p).as_ref() == Some(&(uf.clone(), cnes.clone())));
    v["guardada"] = json!(minhas(p).contains(&(uf.clone(), cnes.clone())));
    v["municipio_nome"] = json!(nome_municipio(p, &u.municipio));
    v["tem_arquivo_de_profissionais"] =
        json!(dl::locais(&arquivos_cnes(p, &uf), &uf).contains_key("PF"));
    Ok(v)
}

/// Aptidão da unidade do usuário a um procedimento. `null` quando não há unidade ou CNES.
pub fn aptidao(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    procedimento: &str,
) -> Result<serde_json::Value, String> {
    let Some((uf, cnes)) = minha(p) else {
        return Ok(serde_json::Value::Null);
    };
    if !banco_cnes(p, &uf).exists() {
        return Ok(serde_json::Value::Null);
    }
    let q = consulta_cnes(p, &uf)?;
    let a = q
        .aptidao(sig, comp, procedimento, &cnes)
        .map_err(|e| e.to_string())?;
    drop(q);
    let mut v = serde_json::to_value(&a).map_err(|e| e.to_string())?;
    if a.as_ref().is_some_and(|a| !a.apta) {
        let mut dos_terceiros = Vec::new();
        for (tuf, tcnes) in terceiros(p, &uf, &cnes) {
            if !banco_cnes(p, &tuf).exists() {
                continue;
            }
            let tq = consulta_cnes(p, &tuf)?;
            if let Ok(Some(t)) = tq.aptidao(sig, comp, procedimento, &tcnes) {
                let nome = tq
                    .buscar(&tcnes, 1)
                    .ok()
                    .and_then(|l| l.into_iter().find(|e| e.cnes == tcnes))
                    .map(|e| e.nome)
                    .unwrap_or_default();
                dos_terceiros.push(json!({
                    "uf": tuf, "cnes": tcnes, "nome": nome,
                    "apta": t.apta, "motivos": t.motivos,
                }));
            }
        }
        v["terceiros"] = json!(dos_terceiros);
    }
    Ok(v)
}

type CacheEstados = Vec<(String, Arc<HashMap<String, Estado>>)>;
static CACHE_ESTADOS: Mutex<CacheEstados> = Mutex::new(Vec::new());
/// A unidade ativa e os terceiros cabem juntos; passou disso, sai a mais antiga.
const ENTRADAS_CACHE: usize = 8;

/// Estados de uma unidade diante dos procedimentos, com cache de uma entrada (a lista da
/// esquerda chama a cada grupo aberto). A chave inclui a data do banco do CNES, então um
/// download novo invalida o cache.
fn estados_da_unidade(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    uf: &str,
    cnes: &str,
) -> Result<Option<Arc<HashMap<String, Estado>>>, String> {
    exigir_uf(uf)?;
    if !banco_cnes(p, uf).exists() {
        return Ok(None);
    }
    let mtime = std::fs::metadata(banco_cnes(p, uf))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let chave = format!("{uf}:{cnes}:{comp}:{mtime}");
    if let Ok(g) = CACHE_ESTADOS.lock()
        && let Some((_, v)) = g.iter().find(|(k, _)| *k == chave)
    {
        return Ok(Some(v.clone()));
    }
    let q = consulta_cnes(p, uf)?;
    let Some(m) = q.estados(sig, comp, cnes).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let m = Arc::new(m);
    if let Ok(mut g) = CACHE_ESTADOS.lock() {
        g.retain(|(k, _)| *k != chave);
        if g.len() >= ENTRADAS_CACHE {
            g.remove(0);
        }
        g.push((chave, m.clone()));
    }
    Ok(Some(m))
}

/// Marcador da lista de procedimentos: para cada código pedido que a unidade ativa tem
/// exigência, `apta`, `ressalva` ou `nao`. Sem unidade ativa, mapa vazio.
pub fn marcadores(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    codigos: &[String],
) -> Result<serde_json::Value, String> {
    let Some((uf, cnes)) = minha(p) else {
        return Ok(json!({}));
    };
    let Some(estados) = estados_da_unidade(p, sig, comp, &uf, &cnes)? else {
        return Ok(json!({}));
    };
    // Estados de cada terceiro contratado (UFs sem banco carregado ficam de fora).
    let mut dos_terceiros = Vec::new();
    for (tuf, tcnes) in terceiros(p, &uf, &cnes) {
        if let Ok(Some(e)) = estados_da_unidade(p, sig, comp, &tuf, &tcnes) {
            dos_terceiros.push(e);
        }
    }
    let mut m = serde_json::Map::new();
    for c in codigos {
        if let Some(e) = estados.get(c) {
            let por_terceiro = matches!(e, Estado::Nao | Estado::Ressalva)
                && dos_terceiros
                    .iter()
                    .any(|t| t.get(c) == Some(&Estado::Apta));
            let v = if por_terceiro {
                json!("terceiro")
            } else {
                serde_json::to_value(e).map_err(|e| e.to_string())?
            };
            m.insert(c.clone(), v);
        }
    }
    Ok(serde_json::Value::Object(m))
}

/// Procedimentos que uma unidade (qualquer uma de uma UF carregada) pode cobrar pelo cadastro.
pub fn procedimentos_da_unidade(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    uf: &str,
    cnes: &str,
) -> Result<serde_json::Value, String> {
    let q = consulta_cnes(p, uf)?;
    let v = q
        .procedimentos_da_unidade(sig, comp, cnes)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("o CNES {cnes} não está no cadastro de {uf} carregado"))?;
    serde_json::to_value(&v).map_err(|e| e.to_string())
}

/// Procura estabelecimentos por nome ou número em todas as UFs carregadas (a busca da barra).
pub fn buscar_unidades(p: &Pastas, texto: &str, limite: usize) -> serde_json::Value {
    let mut saida = Vec::new();
    for uf in ufs_carregadas(p) {
        if saida.len() >= limite {
            break;
        }
        let Ok(q) = consulta_cnes(p, &uf) else {
            continue;
        };
        let Ok(v) = q.buscar(texto, limite) else {
            continue;
        };
        for e in v {
            if saida.len() >= limite {
                break;
            }
            saida.push(json!({ "uf": uf, "cnes": e.cnes, "nome": e.nome, "municipio": e.municipio,
                               "municipio_nome": nome_municipio(p, &e.municipio), "tipo_nome": e.tipo_nome }));
        }
    }
    json!(saida)
}

fn territorio(p: &Pastas) -> Option<BancoTerritorio> {
    p.territorio_db()
        .exists()
        .then(|| BancoTerritorio::abrir(&p.territorio_db()).ok())
        .flatten()
}

fn nome_municipio(p: &Pastas, codigo6: &str) -> String {
    territorio(p)
        .and_then(|t| {
            t.conexao()
                .query_row(
                    "SELECT municipio_nome FROM ibge_municipio WHERE codigo6 = CAST(?1 AS INTEGER)",
                    [codigo6],
                    |r| r.get(0),
                )
                .ok()
        })
        .unwrap_or_default()
}

/// Municípios (6 dígitos) da região de saúde de um município, com o nome da região.
fn regiao_de(p: &Pastas, codigo6: &str) -> Option<(String, HashSet<String>)> {
    let t = territorio(p)?;
    let (cod, nome): (String, String) = t
        .conexao()
        .query_row(
            "SELECT codigo_regiao_saude, regiao_saude FROM demas_municipio WHERE CAST(codigo_municipio AS INTEGER) = CAST(?1 AS INTEGER)",
            [codigo6],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    let mut st = t
        .conexao()
        .prepare("SELECT printf('%06d', CAST(codigo_municipio AS INTEGER)) FROM demas_municipio WHERE codigo_regiao_saude = ?1")
        .ok()?;
    let ms: HashSet<String> = st.query_map([&cod], |r| r.get(0)).ok()?.flatten().collect();
    Some((nome, ms))
}

/// "Quem faz na rede": contagem no município, na região de saúde e na UF da unidade do usuário,
/// e a lista do `escopo` pedido (`municipio`, `regiao` ou `uf`).
pub fn rede(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    procedimento: &str,
    escopo: &str,
) -> Result<serde_json::Value, String> {
    let (uf, cnes) = minha(p).ok_or_else(sem_unidade)?;
    let q = consulta_cnes(p, &uf)?;
    let municipio = q
        .buscar(&cnes, 1)
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .map(|e| e.municipio)
        .ok_or_else(|| format!("o CNES {cnes} não está no cadastro de {uf} carregado"))?;
    let so_municipio: HashSet<String> = [municipio.clone()].into();
    let regiao = regiao_de(p, &municipio);
    let limite = |e: &str| if e == escopo { 500 } else { 1 };
    let r_mun = q
        .rede(
            sig,
            comp,
            procedimento,
            Some(&so_municipio),
            limite("municipio"),
        )
        .map_err(|e| e.to_string())?;
    let r_reg = match &regiao {
        Some((_, ms)) => Some(
            q.rede(sig, comp, procedimento, Some(ms), limite("regiao"))
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };
    let r_uf = q
        .rede(sig, comp, procedimento, None, limite("uf"))
        .map_err(|e| e.to_string())?;
    let escolhido = match escopo {
        "municipio" => &r_mun,
        "regiao" => r_reg.as_ref().unwrap_or(&r_mun),
        _ => &r_uf,
    };
    let lista: Vec<serde_json::Value> = escolhido
        .estabelecimentos
        .iter()
        .map(|e| {
            json!({ "cnes": e.cnes, "nome": e.nome, "municipio": e.municipio, "municipio_nome": nome_municipio(p, &e.municipio),
                    "tipo": e.tipo, "tipo_nome": e.tipo_nome, "minha": e.cnes == cnes })
        })
        .collect();
    Ok(json!({
        "procedimento": r_uf.procedimento,
        "exige": r_uf.exige,
        "exige_servico": r_uf.exige_servico,
        "competencia_cnes": r_uf.competencia_cnes,
        "competencia_sigtap": r_uf.competencia_sigtap,
        "regra_confirmada": false,
        "escopo": escopo,
        "municipio": { "nome": nome_municipio(p, &municipio), "codigo": municipio, "aptos": r_mun.aptos, "estabelecimentos": r_mun.no_escopo },
        "regiao": r_reg.as_ref().map(|r| json!({ "nome": regiao.as_ref().map(|x| x.0.clone()), "aptos": r.aptos, "estabelecimentos": r.no_escopo })),
        "uf": { "nome": uf, "aptos": r_uf.aptos, "estabelecimentos": r_uf.no_escopo },
        "lista": lista,
        "lista_total": escolhido.aptos,
    }))
}

/// Procura estabelecimentos numa UF carregada (para escolher a unidade).
pub fn buscar_estabelecimentos(
    p: &Pastas,
    uf: &str,
    texto: &str,
) -> Result<serde_json::Value, String> {
    let q = consulta_cnes(p, uf)?;
    let v = q.buscar(texto, 30).map_err(|e| e.to_string())?;
    Ok(json!(v
        .iter()
        .map(|e| json!({ "cnes": e.cnes, "nome": e.nome, "municipio": e.municipio, "municipio_nome": nome_municipio(p, &e.municipio),
                         "tipo": e.tipo, "tipo_nome": e.tipo_nome }))
        .collect::<Vec<_>>()))
}

/// Grava uma planilha exportada pela interface. A extensão escolhe o formato.
pub fn exportar(
    destino: &Path,
    planilha: &sa_query::exportar::Planilha,
    aba: usize,
) -> Result<String, String> {
    let ext = destino
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let bytes = match ext.as_str() {
        "xlsx" => planilha.xlsx()?,
        "csv" => planilha.csv(aba)?,
        outro => {
            return Err(format!(
                "formato \".{outro}\" não é aceito. Escolha .xlsx ou .csv"
            ));
        }
    };
    std::fs::write(destino, &bytes)
        .map_err(|e| format!("não foi possível gravar {} ({e}). Feche o arquivo se ele estiver aberto no Excel e tente de novo", destino.display()))?;
    Ok(format!(
        "Arquivo gravado: {} ({} KB)",
        destino.display(),
        bytes.len().div_ceil(1024)
    ))
}

/// Confere no servidor oficial se há CNES mais novo que o carregado, UF por UF (uma consulta por
/// vez). Devolve `{ "novas": [{uf, atual, nova, bytes}], "erro": texto ou null }`. Falha de rede
/// não é erro de programa: volta em `erro`, junto com o que deu para conferir.
pub fn verificar_cnes(p: &Pastas) -> serde_json::Value {
    verificar_cnes_em(p, &dl::Fonte::oficial())
}

fn verificar_cnes_em(p: &Pastas, fonte: &dl::Fonte) -> serde_json::Value {
    let mut novas = Vec::new();
    let mut erro: Option<String> = None;
    for uf in ufs_carregadas(p) {
        let Some(atual) = consulta_cnes(p, &uf)
            .ok()
            .and_then(|q| q.resumo().ok())
            .map(|r| r.competencia)
        else {
            continue;
        };
        match dl::competencias(fonte, &uf) {
            Ok(cs) => {
                if let Some((c, bytes)) = cs.last()
                    && c.to_string() > atual
                {
                    novas.push(
                        json!({ "uf": uf, "atual": atual, "nova": c.to_string(), "bytes": bytes }),
                    );
                }
            }
            Err(e) => {
                erro = Some(e.to_string());
                break;
            }
        }
    }
    json!({ "novas": novas, "erro": erro })
}

/// Competências do CNES no servidor oficial para a UF (mais recente primeiro), com o tamanho do
/// arquivo de estabelecimentos.
pub fn competencias_no_servidor(uf: &str) -> Result<serde_json::Value, String> {
    exigir_uf(uf)?;
    let mut cs = dl::competencias(&dl::Fonte::oficial(), uf).map_err(|e| e.to_string())?;
    cs.reverse();
    Ok(json!(
        cs.iter()
            .take(36)
            .map(|(c, bytes)| json!({ "competencia": c.to_string(), "bytes": bytes }))
            .collect::<Vec<_>>()
    ))
}

/// Apaga o CNES de uma UF: o banco e os arquivos oficiais guardados (podem ser baixados de novo).
pub fn apagar_uf(p: &Pastas, uf: &str) -> Result<String, String> {
    exigir_uf(uf)?;
    if minhas(p).iter().any(|(u, _)| u == uf) {
        return Err(format!(
            "há unidade de {uf} na sua lista. Remova-a em Minha unidade antes de apagar o CNES de {uf}"
        ));
    }
    let db = banco_cnes(p, uf);
    if db.exists() {
        std::fs::remove_file(&db)
            .map_err(|e| format!("não foi possível apagar {} ({e}). Feche outros programas que usem a pasta e tente de novo", db.display()))?;
    }
    let arqs = arquivos_cnes(p, uf);
    if arqs.exists() {
        std::fs::remove_dir_all(&arqs).map_err(|e| {
            format!(
                "o banco foi apagado, mas não os arquivos em {} ({e})",
                arqs.display()
            )
        })?;
    }
    Ok(format!(
        "CNES de {uf} apagado. Para usar de novo, baixe em Módulos e dados."
    ))
}

/// Favoritos e anotações com o nome do procedimento na competência (vazio se não existe nela).
pub fn marcados_com_nome(
    sig: &Consulta,
    comp: Competencia,
    itens: &[sa_packs::usuario::Marcado],
) -> Result<serde_json::Value, String> {
    let mut v = Vec::with_capacity(itens.len());
    for m in itens {
        let nome = if m.tipo == "procedimento" {
            sig.nome_procedimento(comp, &m.codigo)
                .map_err(|e| e.to_string())?
        } else {
            None
        };
        let mut j = serde_json::to_value(m).map_err(|e| e.to_string())?;
        j["existe"] = json!(nome.is_some());
        j["nome"] = json!(nome.unwrap_or_default());
        v.push(j);
    }
    Ok(json!(v))
}

#[cfg(test)]
mod testes {
    //! Prova de ponta a ponta com os arquivos reais de MS (08/2026) servidos pelo FTP falso.
    //! Precisa de `SA_CNES_DBC`, `SA_SIGTAP_BANCO_CONSULTA` e `SA_TERRITORIO_JSON`.
    use super::*;
    use sa_download::cortesia::Cortesia;
    use std::collections::BTreeMap;
    use std::io::Write;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn terceiros_sao_por_unidade() {
        let d = std::env::temp_dir().join(format!("sa-terc-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = Pastas { dados: d.clone() };
        let par = |u: &str, c: &str| (u.to_string(), c.to_string());
        let grava = |ua: &str, ca: &str, ts: &[&str]| {
            let v: Vec<_> = ts.iter().map(|c| par("MS", c)).collect();
            gravar_terceiros(&p, ua, ca, &v).unwrap();
        };
        assert!(terceiros(&p, "MS", "1000001").is_empty());
        // Alpha tem A, B, C, D; Beta tem B, D, E, F, G (B e D nas duas).
        grava(
            "MS",
            "1000001",
            &["2000001", "2000002", "2000003", "2000004"],
        );
        grava(
            "MS",
            "1000002",
            &[
                "2000002", "2000004", "2000005", "2000006", "2000007", "2000002",
            ],
        );
        let nomes = |ua: &str, ca: &str| -> Vec<String> {
            terceiros(&p, ua, ca).into_iter().map(|(_, c)| c).collect()
        };
        assert_eq!(
            nomes("MS", "1000001"),
            ["2000001", "2000002", "2000003", "2000004"]
        );
        assert_eq!(
            nomes("MS", "1000002"),
            ["2000002", "2000004", "2000005", "2000006", "2000007"]
        );
        // Tirar B da Alpha não mexe na Beta.
        remover_terceiro(&p, "MS", "1000001", "MS", "2000002").unwrap();
        assert_eq!(nomes("MS", "1000001"), ["2000001", "2000003", "2000004"]);
        assert_eq!(
            nomes("MS", "1000002"),
            ["2000002", "2000004", "2000005", "2000006", "2000007"]
        );
        // Uma unidade não é terceira de si mesma.
        assert!(adicionar_terceiro(&p, "MS", "1000001", "MS", "1000001").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    fn ambiente() -> Option<(PathBuf, PathBuf, PathBuf)> {
        let cnes = PathBuf::from(std::env::var("SA_CNES_DBC").ok()?);
        let sig = PathBuf::from(std::env::var("SA_SIGTAP_BANCO_CONSULTA").ok()?);
        let ter = PathBuf::from(std::env::var("SA_TERRITORIO_JSON").ok()?);
        (cnes.join("STMS2608.dbc").exists() && sig.exists() && ter.exists())
            .then_some((cnes, sig, ter))
    }

    /// TAB_CNES.zip de teste: o cadastro de MS e as tabelas de nomes reais.
    fn tab_cnes(origem: &Path, destino: &Path) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(destino).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        for (pasta, filtro) in [("DBF", "CADGERMS.dbf"), ("CNV", "")] {
            for e in std::fs::read_dir(origem.join("tab_cnes").join(pasta))
                .unwrap()
                .flatten()
            {
                let nome = e.file_name().to_string_lossy().into_owned();
                if filtro.is_empty() || nome == filtro {
                    z.start_file(format!("{pasta}/{nome}"), o).unwrap();
                    z.write_all(&std::fs::read(e.path()).unwrap()).unwrap();
                }
            }
        }
        z.finish().unwrap();
    }

    fn gravar_territorio(pasta: &Path, banco: &Path) {
        use sa_download::territorio as ter;
        use sa_packs::territorio::Origem;
        let t = ter::ler_pasta(pasta).unwrap();
        let conv = |x: &ter::OrigemArquivo| Origem {
            url: x.url.clone(),
            obtido_em: x.obtido_em.clone(),
            sha256: x.sha256.clone(),
        };
        BancoTerritorio::abrir(banco)
            .unwrap()
            .gravar(
                &t.ibge,
                &t.demas,
                &conv(&t.origem_ibge),
                &conv(&t.origem_demas),
            )
            .unwrap();
    }

    #[test]
    fn cnes_do_download_a_aptidao_e_a_rede() {
        let Some((origem, sig, ter)) = ambiente() else {
            eprintln!(
                "SA_CNES_DBC/SA_SIGTAP_BANCO_CONSULTA/SA_TERRITORIO_JSON não definidas: prova do CNES no aplicativo não executada"
            );
            return;
        };
        let d = std::env::temp_dir().join(format!("sa-app-cnes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let p = Pastas {
            dados: d.join("dados"),
        };
        std::fs::create_dir_all(&p.dados).unwrap();
        gravar_territorio(&ter, &p.territorio_db());
        tab_cnes(&origem, &d.join("TAB_CNES.zip"));
        let mut arquivos: BTreeMap<String, PathBuf> = ["ST", "HB", "SR", "LT", "EQ", "PF"]
            .iter()
            .map(|t| {
                (
                    format!("{t}MS2608.dbc"),
                    origem.join(format!("{t}MS2608.dbc")),
                )
            })
            .collect();
        arquivos.insert("STMS2401.dbc".into(), origem.join("STMS2401.dbc"));
        arquivos.insert("TAB_CNES.zip".into(), d.join("TAB_CNES.zip"));
        let mut com_mais_novo = arquivos.clone();
        com_mais_novo.insert("STMS2609.dbc".into(), origem.join("STMS2608.dbc"));
        let porta_nova = sa_download::servidor_falso::iniciar(com_mais_novo);
        let porta = sa_download::servidor_falso::iniciar(arquivos);
        let fonte = dl::Fonte {
            servidor: "127.0.0.1".into(),
            pasta_dados: "/dados".into(),
            tab_cnes: "/aux/TAB_CNES.zip".into(),
            cortesia: Cortesia {
                pausa_entre_arquivos: Duration::from_millis(5),
                espera_inicial: Duration::from_millis(5),
                porta,
                ..Cortesia::default()
            },
        };
        let registro: Arc<Mutex<Vec<Progresso>>> = Arc::default();
        let r2 = registro.clone();
        let emissor = move |x| r2.lock().unwrap().push(x);
        let cancelar = AtomicBool::new(false);

        // 1. Sem unidade escolhida: baixa a competência mais recente e NÃO baixa profissionais.
        let pedido = PedidoCnes {
            uf: "MS".into(),
            competencia: String::new(),
        };
        let msg = baixar_cnes_de(&fonte, &p, &pedido, &cancelar, &emissor).unwrap();
        assert!(msg.contains("7108 estabelecimentos"), "{msg}");
        assert!(!arquivos_cnes(&p, "MS").join("PFMS2608.dbc").exists());
        assert!(
            registro
                .lock()
                .unwrap()
                .iter()
                .all(|x| (0.0..=1.0).contains(&x.fracao))
        );
        let sit = situacao(&p);
        assert_eq!(sit["ufs"][0]["uf"], "MS");
        assert_eq!(sit["ufs"][0]["resumo"]["competencia"], "202608", "{sit}");
        assert!(sit["minha"].is_null());
        // Verificação de atualização: em dia com o servidor que só tem 08/2026; defasado com o que já tem 09/2026.
        let em_dia = verificar_cnes_em(&p, &fonte);
        assert!(em_dia["novas"].as_array().unwrap().is_empty(), "{em_dia}");
        let mut fonte_nova = fonte.clone();
        fonte_nova.cortesia.porta = porta_nova;
        let defasado = verificar_cnes_em(&p, &fonte_nova);
        assert_eq!(defasado["novas"][0]["uf"], "MS", "{defasado}");
        assert_eq!(defasado["novas"][0]["atual"], "202608");
        assert_eq!(defasado["novas"][0]["nova"], "202609");
        let sig = Consulta::abrir(&sig).unwrap();
        let comp = Competencia::nova(2026, 9).unwrap();
        // Sem unidade: aptidão é nula (a ficha não mostra o bloco) e a rede orienta.
        assert!(aptidao(&p, &sig, comp, "0301010072").unwrap().is_null());
        assert!(
            rede(&p, &sig, comp, "0301010072", "uf")
                .unwrap_err()
                .contains("Minha unidade")
        );

        // 2. Escolhe a unidade com mais habilitações do estado (achada nos dados, sem nome fixo).
        let meu: String = BancoCnes::abrir(&banco_cnes(&p, "MS"))
            .unwrap()
            .conexao()
            .query_row(
                "SELECT cnes FROM cnes_hb GROUP BY cnes ORDER BY count(*) DESC, cnes LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(definir_minha(&p, "MS", "0000000").is_err());
        let def = definir_minha(&p, "MS", &meu).unwrap();
        assert_eq!(def["profissionais"], false);
        assert_eq!(minha(&p), Some(("MS".to_string(), meu.clone())));
        let u = unidade(&p, &sig, comp, None).unwrap();
        assert!(!u["habilitacoes"].as_array().unwrap().is_empty());
        assert!(
            u["profissionais"].is_null(),
            "sem arquivo de profissionais, a tela diz que não foram carregados"
        );
        assert!(
            !u["municipio_nome"].as_str().unwrap().is_empty(),
            "{}",
            u["municipio"]
        );

        // 3. Baixar de novo, agora com unidade: traz os profissionais só dela, sem CPF nem CNS.
        baixar_cnes_de(&fonte, &p, &pedido, &cancelar, &emissor).unwrap();
        {
            let b = BancoCnes::abrir(&banco_cnes(&p, "MS")).unwrap();
            let (n, outros): (i64, i64) = b
                .conexao()
                .query_row(
                    "SELECT count(*), sum(cnes <> ?1) FROM cnes_pf",
                    [&meu],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert!(n > 0);
            assert_eq!(outros, 0, "profissionais de outra unidade no banco");
            let colunas: Vec<String> = b
                .conexao()
                .prepare("SELECT lower(name) FROM pragma_table_info('cnes_pf')")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .flatten()
                .collect();
            for proibida in ["cpf_prof", "cns_prof"] {
                assert!(!colunas.iter().any(|c| c == proibida), "{proibida} gravado");
            }
        }
        assert!(
            !arquivos_cnes(&p, "MS").join("PFMS2608.dbc").exists(),
            "o arquivo com todas as pessoas da UF não pode ficar guardado"
        );
        let u = unidade(&p, &sig, comp, None).unwrap();
        assert!(!u["profissionais"].as_array().unwrap().is_empty());
        assert!(!u["ocupacoes"].as_array().unwrap().is_empty());

        // 4. Aptidão e rede na ficha.
        let a = aptidao(&p, &sig, comp, "0301010072").unwrap();
        assert!(a.is_object(), "{a}");
        let r = rede(&p, &sig, comp, "0301010072", "regiao").unwrap();
        assert!(r["uf"]["aptos"].as_u64().unwrap() >= r["municipio"]["aptos"].as_u64().unwrap());
        assert!(
            r["regiao"].is_object(),
            "a região de saúde tem de vir do território: {r}"
        );
        assert_eq!(r["regra_confirmada"], false);
        let busca = buscar_estabelecimentos(&p, "MS", &meu).unwrap();
        assert_eq!(busca[0]["cnes"], meu.as_str());

        // 4b. Marcador da lista, procedimentos da unidade e busca por nome em qualquer UF carregada.
        let mar = marcadores(
            &p,
            &sig,
            comp,
            &["0301010072".to_string(), "9999999999".to_string()],
        )
        .unwrap();
        assert!(mar.get("9999999999").is_none());
        let todos = procedimentos_da_unidade(&p, &sig, comp, "MS", &meu).unwrap();
        let todos = todos.as_array().unwrap();
        assert!(!todos.is_empty());
        let um = todos[0]["codigo"].as_str().unwrap().to_string();
        let mar = marcadores(&p, &sig, comp, std::slice::from_ref(&um)).unwrap();
        assert!(["apta", "ressalva"].contains(&mar[um.as_str()].as_str().unwrap()));
        let nome_unidade = unidade(&p, &sig, comp, None).unwrap()["nome"]
            .as_str()
            .unwrap()
            .to_string();
        let achadas = buscar_unidades(&p, &nome_unidade, 8);
        assert!(
            achadas
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["cnes"] == meu.as_str() && e["uf"] == "MS")
        );

        // 4c. Mais de uma unidade: a lista guarda as duas, a troca é rápida e só a ativa tem
        // profissionais; ver outra unidade não a torna ativa.
        let outra: String = BancoCnes::abrir(&banco_cnes(&p, "MS"))
            .unwrap()
            .conexao()
            .query_row(
                "SELECT cnes FROM cnes_hb WHERE cnes <> ?1 GROUP BY cnes ORDER BY count(*) DESC, cnes LIMIT 1",
                [&meu],
                |r| r.get(0),
            )
            .unwrap();
        let visto = unidade(&p, &sig, comp, Some(("MS", &outra))).unwrap();
        assert_eq!(visto["ativa"], false);
        assert_eq!(minha(&p), Some(("MS".to_string(), meu.clone())));
        definir_minha(&p, "MS", &meu).unwrap(); // a mesma: não mexe em nada
        assert!(
            !BancoCnes::abrir(&banco_cnes(&p, "MS"))
                .unwrap()
                .conexao()
                .query_row("SELECT count(*) FROM cnes_pf", [], |r| r.get::<_, i64>(0))
                .map(|n| n == 0)
                .unwrap(),
            "escolher de novo a unidade ativa não pode apagar os profissionais"
        );
        definir_minha(&p, "MS", &outra).unwrap();
        assert_eq!(
            minhas(&p),
            vec![
                ("MS".to_string(), meu.clone()),
                ("MS".to_string(), outra.clone())
            ]
        );
        assert_eq!(minha(&p), Some(("MS".to_string(), outra.clone())));
        assert_eq!(situacao(&p)["unidades"].as_array().unwrap().len(), 2);
        remover_unidade(&p, "MS", &outra).unwrap();
        assert_eq!(
            minha(&p),
            Some(("MS".to_string(), meu.clone())),
            "volta para a outra"
        );
        assert_eq!(minhas(&p).len(), 1);

        // 5. Não apaga a UF da unidade; esquecer a unidade tira os profissionais do banco.
        assert!(apagar_uf(&p, "MS").unwrap_err().contains("sua lista"));
        limpar_minha(&p).unwrap();
        assert!(minha(&p).is_none());
        assert!(minhas(&p).is_empty());
        assert!(
            !BancoCnes::abrir(&banco_cnes(&p, "MS"))
                .unwrap()
                .tem_tabela("cnes_pf")
                .unwrap()
        );

        // 6. Banco de versão mais nova é recusado sem alteração; de versão anterior é refeito.
        let db = banco_cnes(&p, "MS");
        let mudar = |v: &str| {
            rusqlite::Connection::open(&db)
                .unwrap()
                .execute(
                    "UPDATE sa_info SET valor = ?1 WHERE chave = 'versao_esquema'",
                    [v],
                )
                .unwrap();
        };
        mudar("999");
        let antes = std::fs::read(&db).unwrap();
        assert!(consulta_cnes(&p, "MS").err().unwrap().contains("mais nova"));
        assert_eq!(std::fs::read(&db).unwrap(), antes);
        mudar("0");
        assert_eq!(
            consulta_cnes(&p, "MS")
                .unwrap()
                .resumo()
                .unwrap()
                .estabelecimentos,
            7108
        );

        // 7. Importação manual numa pasta nova e apagar.
        let p2 = Pastas {
            dados: d.join("dados2"),
        };
        let m = importar_cnes(&p2, &arquivos_cnes(&p, "MS"), "MS", &emissor).unwrap();
        assert!(m.contains("7108 estabelecimentos"), "{m}");
        assert!(
            importar_cnes(&p2, &d.join("dados2"), "SP", &emissor)
                .unwrap_err()
                .contains("não achei")
        );
        assert!(apagar_uf(&p2, "MS").is_ok());
        assert!(ufs_carregadas(&p2).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn exporta_pelo_formato_da_extensao() {
        let d = std::env::temp_dir().join(format!("sa-app-exp-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let pl: sa_query::exportar::Planilha = serde_json::from_value(json!({
            "titulo": "Teste", "abas": [{ "nome": "A", "colunas": ["Código", "Nome"], "linhas": [["0301010072", "Consulta"]] }]
        }))
        .unwrap();
        assert!(
            exportar(&d.join("a.xlsx"), &pl, 0)
                .unwrap()
                .contains("a.xlsx")
        );
        assert_eq!(&std::fs::read(d.join("a.xlsx")).unwrap()[..2], b"PK");
        exportar(&d.join("a.csv"), &pl, 0).unwrap();
        assert!(
            String::from_utf8_lossy(&std::fs::read(d.join("a.csv")).unwrap())
                .contains("0301010072")
        );
        assert!(
            exportar(&d.join("a.pdf"), &pl, 0)
                .unwrap_err()
                .contains(".xlsx")
        );
        let _ = std::fs::remove_dir_all(&d);
    }
}
