//! Download da produção do SUS (SIA `PA`, SIH `RD` e `ER`), com cortesia: uma sessão por pasta,
//! um arquivo por vez, retomada e conferência do `.dbc` antes de ele entrar na pasta.
//!
//! Fonte oficial (estudo de 30/09/2026): `ftp.datasus.gov.br/dissemin/publicos/{SIASUS,SIHSUS}/200801_/Dados/`.
//! O `PA` de uma UF e competência pode vir em partes (`PAMS2607a.dbc`, `PAMS2607b.dbc`…); `RD` e
//! `ER` vêm em um arquivo só. Os arquivos trazem dado de paciente: depois de somados, o programa
//! os apaga (ver `sa-unidade`).

use crate::cnes::{self, Fonte, Sessao, uf_valida, validar_dbc};
use crate::cortesia::{ErroDownload, Evento, Pedido, baixar_lista};
use sa_core::Competencia;
use sa_sources::producao::Moterro;
use sa_sources::zip_parcial;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

pub const SERVIDOR: &str = cnes::SERVIDOR;
/// Tipos de arquivo de produção que o programa lê.
pub const TIPOS: [&str; 4] = ["PA", "RD", "ER", "SP"];

/// Fonte oficial. A pasta de cada tipo vem do manifesto (`sa_sources::producao`).
pub fn fonte_oficial() -> Fonte {
    Fonte::oficial()
}

/// Nome do arquivo: `RDMS2607.dbc`; com parte, `PAMS2607a.dbc`.
pub fn nome(tipo: &str, uf: &str, c: Competencia, parte: Option<char>) -> String {
    format!(
        "{tipo}{uf}{:02}{:02}{}.dbc",
        c.ano() % 100,
        c.mes(),
        parte.map(String::from).unwrap_or_default()
    )
}

/// Interpreta `PAMS2607a.dbc` -> ("PA", "MS", 2026-07, Some('a')). Só os tipos de [`TIPOS`].
pub fn interpretar(nome: &str) -> Option<(String, String, Competencia, Option<char>)> {
    let base = nome
        .strip_suffix(".dbc")
        .or_else(|| nome.strip_suffix(".DBC"))?;
    if !base.is_ascii() || !(8..=9).contains(&base.len()) {
        return None;
    }
    let (tipo, uf, aamm) = (&base[..2], &base[2..4], &base[4..8]);
    let parte = base[8..].chars().next();
    if !TIPOS.contains(&tipo) || !uf_valida(uf) {
        return None;
    }
    // Só o PA tem partes, e a parte é uma letra minúscula.
    match parte {
        Some(p) if tipo != "PA" || !p.is_ascii_lowercase() => return None,
        _ => {}
    }
    let ano: u16 = aamm[..2].parse().ok()?;
    let mes: u8 = aamm[2..].parse().ok()?;
    Some((
        tipo.into(),
        uf.into(),
        Competencia::nova(2000 + ano, mes).ok()?,
        parte,
    ))
}

fn pasta_do_tipo(tipo: &str) -> Result<String, ErroDownload> {
    sa_sources::producao::Manifesto::carregar()
        .tipo(tipo)
        .map(|t| t.pasta.clone())
        .ok_or_else(|| ErroDownload::Invalido(tipo.into(), "tipo de produção desconhecido".into()))
}

/// Partes (nome, bytes) de uma competência no servidor.
pub type Partes = Vec<(String, u64)>;

/// O que há no servidor para uma UF e um tipo: por competência, as partes e o total de bytes.
/// Da mais antiga para a mais recente.
pub fn disponiveis(
    fonte: &Fonte,
    tipo: &str,
    uf: &str,
) -> Result<Vec<(Competencia, Partes)>, ErroDownload> {
    let pasta = pasta_do_tipo(tipo)?;
    let nunca = AtomicBool::new(false);
    let mut sessao = Sessao::nova(fonte);
    let lista = sessao.com_tentativas("lista de produção", &nunca, &mut |_| {}, |f, _| {
        f.listar(&pasta)
    })?;
    sessao.sair();
    let mut por: BTreeMap<Competencia, Partes> = BTreeMap::new();
    for e in &lista {
        if let Some((t, u, c, _)) = interpretar(&e.nome)
            && t == tipo
            && u == uf
        {
            por.entry(c)
                .or_default()
                .push((e.nome.clone(), e.tamanho.unwrap_or(0)));
        }
    }
    for partes in por.values_mut() {
        partes.sort();
    }
    Ok(por.into_iter().collect())
}

/// Um arquivo já listado no servidor (o plano de download), para baixar sem listar de novo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRemoto {
    pub tipo: String,
    pub nome: String,
    pub bytes: u64,
}

/// Baixa os arquivos do plano para `destino`, um por vez, **sem listar o servidor de novo** (a
/// pasta do SIA tem dezenas de milhares de entradas). Cada arquivo só entra na pasta depois de
/// descomprimir sem erro. Devolve os caminhos.
pub fn baixar_itens(
    fonte: &Fonte,
    itens: &[ItemRemoto],
    destino: &Path,
    cancelar: &AtomicBool,
    progresso: impl FnMut(Evento),
) -> Result<Vec<PathBuf>, ErroDownload> {
    let mut pedidos = Vec::new();
    for i in itens {
        pedidos.push(Pedido {
            pasta_remota: pasta_do_tipo(&i.tipo)?,
            nome: i.nome.clone(),
            tamanho: i.bytes,
        });
    }
    std::thread::sleep(fonte.cortesia.pausa_entre_arquivos);
    baixar_lista(
        &fonte.servidor,
        &pedidos,
        destino,
        &fonte.cortesia,
        cancelar,
        progresso,
        validar_dbc,
    )
}

/// Baixa todas as partes de um tipo, UF e competência para `destino`, um arquivo por vez. Cada
/// arquivo só entra na pasta depois de descomprimir sem erro. Devolve os caminhos.
pub fn baixar(
    fonte: &Fonte,
    tipo: &str,
    uf: &str,
    competencia: Competencia,
    destino: &Path,
    cancelar: &AtomicBool,
    progresso: impl FnMut(Evento),
) -> Result<Vec<PathBuf>, ErroDownload> {
    let pasta = pasta_do_tipo(tipo)?;
    let achados = disponiveis(fonte, tipo, uf)?;
    let Some((_, partes)) = achados.into_iter().find(|(c, _)| *c == competencia) else {
        return Err(ErroDownload::Invalido(
            nome(tipo, uf, competencia, None),
            format!(
                "o servidor não tem {tipo} de {uf} em {competencia}. Veja as competências disponíveis e escolha outra"
            ),
        ));
    };
    let pedidos: Vec<Pedido> = partes
        .into_iter()
        .map(|(nome, tamanho)| Pedido {
            pasta_remota: pasta.clone(),
            nome,
            tamanho,
        })
        .collect();
    std::thread::sleep(fonte.cortesia.pausa_entre_arquivos);
    baixar_lista(
        &fonte.servidor,
        &pedidos,
        destino,
        &fonte.cortesia,
        cancelar,
        progresso,
        validar_dbc,
    )
}

/// Cauda do ZIP pedida de primeira para achar o índice (o do TAB_SIH tem poucos arquivos).
const CAUDA: u64 = 256 * 1024;
const MAX_ENTRADAS: usize = 5_000;
const MAX_MOTERRO: u64 = 8 * 1024 * 1024;

fn nome_da_entrada(nome: &str) -> String {
    nome.rsplit(['/', '\\'])
        .next()
        .unwrap_or(nome)
        .to_ascii_lowercase()
}

/// Tira a entrada da tabela de motivos de um ZIP já inteiro na memória (importação manual).
pub fn moterro_de_zip(zip: &[u8], m: &Moterro) -> Result<Vec<u8>, String> {
    let total = zip.len() as u64;
    let indice = zip_parcial::ler_indice(zip, total, MAX_ENTRADAS).map_err(|e| e.to_string())?;
    let e = indice
        .iter()
        .find(|e| nome_da_entrada(&e.nome) == m.entrada)
        .ok_or_else(|| format!("o ZIP não traz {}", m.entrada))?;
    let de = usize::try_from(e.posicao).map_err(|_| "posição".to_string())?;
    let dados = zip.get(de..).ok_or("ZIP truncado")?;
    zip_parcial::extrair(dados, e, MAX_MOTERRO).map_err(|e| e.to_string())
}

/// Baixa de um ZIP do FTP só as `entradas` pedidas (nome sem pasta, em minúsculas): o índice (fim do
/// arquivo) e um trecho por entrada, sem baixar o ZIP inteiro (o `TAB_SIA.zip` tem 73 MB). Uma sessão,
/// um trecho por vez. Entrada que o ZIP não traz fica de fora do resultado.
pub fn entradas_de_zip_remoto(
    fonte: &Fonte,
    zip: &str,
    entradas: &[String],
    cancelar: &AtomicBool,
    mut progresso: impl FnMut(Evento),
) -> Result<BTreeMap<String, Vec<u8>>, ErroDownload> {
    let rotulo = zip.rsplit('/').next().unwrap_or(zip).to_string();
    let invalido = |x: String| ErroDownload::Invalido(rotulo.clone(), x);
    let mut f = fonte.clone();
    f.tab_cnes = zip.to_string();
    let mut sessao = Sessao::nova(&f);
    let total = sessao.tamanho(zip, cancelar, &mut progresso)?;
    let desde = total.saturating_sub(CAUDA);
    let mut cauda = sessao.trecho(
        desde,
        total - desde,
        &format!("índice do {rotulo}"),
        cancelar,
        &mut progresso,
    )?;
    let indice = match zip_parcial::ler_indice(&cauda, total, MAX_ENTRADAS) {
        Ok(i) => i,
        Err(zip_parcial::ErroZipParcial::IndiceIncompleto { a_partir_de }) => {
            cauda = sessao.trecho(
                a_partir_de,
                total - a_partir_de,
                &format!("índice do {rotulo}"),
                cancelar,
                &mut progresso,
            )?;
            zip_parcial::ler_indice(&cauda, total, MAX_ENTRADAS)
                .map_err(|e| invalido(e.to_string()))?
        }
        Err(e) => return Err(invalido(e.to_string())),
    };
    let mut saida = BTreeMap::new();
    for nome in entradas {
        let Some(e) = indice.iter().find(|e| nome_da_entrada(&e.nome) == *nome) else {
            continue;
        };
        let pedir = e.bytes_necessarios().min(total - e.posicao);
        let b = sessao.trecho(e.posicao, pedir, nome, cancelar, &mut progresso)?;
        let dados =
            zip_parcial::extrair(&b, e, MAX_MOTERRO).map_err(|x| invalido(x.to_string()))?;
        saida.insert(nome.clone(), dados);
    }
    sessao.sair();
    Ok(saida)
}

/// Baixa do `TAB_SIH.zip` só a tabela de motivos de rejeição (índice e a entrada, cerca de 100 KB
/// em vez dos 6 MB do ZIP). Devolve o DBF.
pub fn baixar_moterro(
    fonte: &Fonte,
    m: &Moterro,
    cancelar: &AtomicBool,
    progresso: impl FnMut(Evento),
) -> Result<Vec<u8>, ErroDownload> {
    let mut v = entradas_de_zip_remoto(
        fonte,
        &m.zip,
        std::slice::from_ref(&m.entrada),
        cancelar,
        progresso,
    )?;
    let dbf = v.remove(&m.entrada).ok_or_else(|| {
        ErroDownload::Invalido("TAB_SIH.zip".into(), format!("não traz {}", m.entrada))
    })?;
    sa_sources::dbf::Dbf::abrir(&dbf)
        .map_err(|x| ErroDownload::Invalido("TAB_SIH.zip".into(), format!("{}: {x}", m.entrada)))?;
    Ok(dbf)
}

/// Os `.dbc` de produção guardados numa pasta, de uma UF: nome → (tipo, competência).
pub fn locais(pasta: &Path, uf: &str) -> BTreeMap<String, (String, Competencia, PathBuf)> {
    let mut m = BTreeMap::new();
    let Ok(dir) = std::fs::read_dir(pasta) else {
        return m;
    };
    for e in dir.flatten() {
        let nome = e.file_name().to_string_lossy().into_owned();
        if let Some((t, u, c, _)) = interpretar(&nome)
            && u == uf
        {
            m.insert(nome, (t, c, e.path()));
        }
    }
    m
}

/// Resultado da importação manual.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Importacao {
    pub dbc: Vec<String>,
    pub recusados: Vec<(String, String)>,
}

/// Modo manual: copia de `origem` para `destino` os `.dbc` de produção da UF que o usuário baixou
/// por conta própria. Só entra o que passa na verificação.
pub fn importar_pasta(origem: &Path, destino: &Path, uf: &str) -> Result<Importacao, ErroDownload> {
    let erro = |p: &Path, e: std::io::Error| ErroDownload::Arquivo(p.to_path_buf(), e.to_string());
    std::fs::create_dir_all(destino).map_err(|e| erro(destino, e))?;
    let mut r = Importacao::default();
    let Ok(dir) = std::fs::read_dir(origem) else {
        return Ok(r);
    };
    for e in dir.flatten() {
        let caminho = e.path();
        if !caminho.is_file() {
            continue;
        }
        let nome = e.file_name().to_string_lossy().into_owned();
        let Some((_, u, _, _)) = interpretar(&nome.replace(".DBC", ".dbc").to_string()) else {
            continue;
        };
        if u != uf {
            continue;
        }
        match validar_dbc(&caminho) {
            Ok(()) => {
                let alvo = destino.join(nome.replace(".DBC", ".dbc"));
                std::fs::copy(&caminho, &alvo).map_err(|e| erro(&alvo, e))?;
                r.dbc.push(nome);
            }
            Err(m) => r.recusados.push((nome, m)),
        }
    }
    r.dbc.sort();
    Ok(r)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn nomes_dos_arquivos_de_producao() {
        let c = Competencia::nova(2026, 7).unwrap();
        assert_eq!(nome("RD", "MS", c, None), "RDMS2607.dbc");
        assert_eq!(nome("PA", "MS", c, Some('a')), "PAMS2607a.dbc");
        assert_eq!(
            interpretar("PAMS2607b.dbc"),
            Some(("PA".into(), "MS".into(), c, Some('b')))
        );
        assert_eq!(
            interpretar("ERMS2607.dbc"),
            Some(("ER".into(), "MS".into(), c, None))
        );
        assert_eq!(
            interpretar("SPMS2607.dbc"),
            Some(("SP".into(), "MS".into(), c, None))
        );
        assert_eq!(
            interpretar("SPSP2607.dbc").map(|x| (x.0, x.1)),
            Some(("SP".into(), "SP".into()))
        );
        for ruim in [
            "RDMS2607a.dbc", // RD não tem partes
            "PAMS2607A.dbc", // parte em maiúscula
            "QQMS2607.dbc",  // tipo que o programa não carrega
            "SPMS2607a.dbc", // SP não tem partes
            "RDXX2607.dbc",
            "RDMS2613.dbc",
            "RDMS2607.zip",
            "RDMS260.dbc",
        ] {
            assert_eq!(interpretar(ruim), None, "{ruim}");
        }
    }
}
