//! Download do CNES de disseminação, com cortesia: os `.dbc` de uma UF e competência, e os
//! auxiliares (nome dos estabelecimentos e tabelas de conversão) lidos **em parte** do
//! `TAB_CNES.zip`, sem baixar os 127 MB.
//!
//! Fonte oficial (estudo de 01/10/2026): `ftp.datasus.gov.br/dissemin/publicos/CNES/200508_/`,
//! pastas `Dados/<TIPO>/<TIPO><UF><AAMM>.dbc` e `Auxiliar/TAB_CNES.zip`.

use crate::cortesia::{Cortesia, ErroDownload, Evento, Pedido, baixar_lista};
use crate::ftp::{ErroFtp, Ftp};
use sa_core::Competencia;
use sa_sources::zip_parcial::{self, Entrada};
use sa_sources::{dbc, dbf};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const SERVIDOR: &str = "ftp.datasus.gov.br";
pub const PASTA_DADOS: &str = "/dissemin/publicos/CNES/200508_/Dados";
pub const TAB_CNES: &str = "/dissemin/publicos/CNES/200508_/Auxiliar/TAB_CNES.zip";

/// Siglas das 27 UF, como aparecem nos nomes dos arquivos.
pub const UFS: [&str; 27] = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE",
    "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

/// Cauda do ZIP pedida de primeira para achar o índice (o do TAB_CNES de 09/2026 ocupa 65 KB).
const CAUDA: u64 = 256 * 1024;
/// Limites de segurança dos auxiliares.
const MAX_ENTRADAS: usize = 5_000;
const MAX_CADASTRO: u64 = 400 * 1024 * 1024;
const MAX_CNV: u64 = 4 * 1024 * 1024;

/// De onde baixar (o oficial, ou um servidor falso nos testes).
#[derive(Debug, Clone)]
pub struct Fonte {
    pub servidor: String,
    pub pasta_dados: String,
    pub tab_cnes: String,
    pub cortesia: Cortesia,
}

impl Fonte {
    pub fn oficial() -> Self {
        Self {
            servidor: SERVIDOR.into(),
            pasta_dados: PASTA_DADOS.into(),
            tab_cnes: TAB_CNES.into(),
            cortesia: Cortesia::default(),
        }
    }
}

/// A sigla é de uma UF?
pub fn uf_valida(uf: &str) -> bool {
    UFS.contains(&uf)
}

/// Nome oficial do arquivo: `STMS2608.dbc`.
/// Tipos que podem faltar no servidor sem derrubar o download.
pub const TIPOS_OPCIONAIS: [&str; 4] = ["RC", "IN", "GM", "EF"];

pub fn nome(tipo: &str, uf: &str, c: Competencia) -> String {
    format!("{tipo}{uf}{:02}{:02}.dbc", c.ano() % 100, c.mes())
}

/// Interpreta `STMS2608.dbc` -> ("ST", "MS", 2026-08). O ano de dois dígitos é 20AA (a série
/// começa em 08/2005).
pub fn interpretar(nome: &str) -> Option<(String, String, Competencia)> {
    let base = nome
        .strip_suffix(".dbc")
        .or_else(|| nome.strip_suffix(".DBC"))?;
    if base.len() != 8 || !base.is_ascii() {
        return None;
    }
    let (tipo, uf, aamm) = (&base[..2], &base[2..4], &base[4..]);
    if !tipo.bytes().all(|b| b.is_ascii_uppercase()) || !uf_valida(uf) {
        return None;
    }
    let ano: u16 = aamm[..2].parse().ok()?;
    let mes: u8 = aamm[2..].parse().ok()?;
    Some((
        tipo.into(),
        uf.into(),
        Competencia::nova(2000 + ano, mes).ok()?,
    ))
}

/// Competências disponíveis no servidor para uma UF (pela pasta dos estabelecimentos, ST), da
/// mais antiga para a mais recente, com o tamanho do arquivo ST.
pub fn competencias(fonte: &Fonte, uf: &str) -> Result<Vec<(Competencia, u64)>, ErroDownload> {
    let pasta = format!("{}/ST", fonte.pasta_dados.trim_end_matches('/'));
    let nunca = AtomicBool::new(false);
    let mut sessao = Sessao::nova(fonte);
    let lista = sessao.com_tentativas("lista de competências", &nunca, &mut |_| {}, |f, _| {
        f.listar(&pasta)
    })?;
    sessao.sair();
    let mut v: Vec<(Competencia, u64)> = lista
        .iter()
        .filter_map(|e| {
            let (t, u, c) = interpretar(&e.nome)?;
            (t == "ST" && u == uf).then_some((c, e.tamanho.unwrap_or(0)))
        })
        .collect();
    v.sort();
    Ok(v)
}

/// Confere que um `.dbc` baixado descomprime e é um DBF coerente.
pub fn validar_dbc(arquivo: &Path) -> Result<(), String> {
    let bruto = std::fs::read(arquivo).map_err(|e| e.to_string())?;
    let d = dbc::para_dbf(&bruto, dbc::LIMITE_PADRAO).map_err(|e| e.to_string())?;
    dbf::Dbf::abrir(&d).map_err(|e| e.to_string())?;
    Ok(())
}

/// Baixa os arquivos dos `tipos` pedidos (uma UF, uma competência) para `destino`, um por vez.
/// Cada arquivo só entra na pasta depois de descomprimir sem erro. Devolve os caminhos.
pub fn baixar(
    fonte: &Fonte,
    uf: &str,
    competencia: Competencia,
    tipos: &[String],
    destino: &Path,
    cancelar: &AtomicBool,
    progresso: impl FnMut(Evento),
) -> Result<Vec<PathBuf>, ErroDownload> {
    // Tamanhos: uma sessão, um SIZE por arquivo (com novas tentativas se o servidor falhar).
    let mut progresso = progresso;
    let mut sessao = Sessao::nova(fonte);
    let base = fonte.pasta_dados.trim_end_matches('/');
    let mut pedidos = Vec::new();
    for t in tipos {
        let n = nome(t, uf, competencia);
        let pasta = format!("{base}/{t}");
        let tamanho = match sessao.tamanho(&format!("{pasta}/{n}"), cancelar, &mut progresso) {
            // Tipos opcionais (marcas RC, IN, GM, EF): o servidor pode não ter o arquivo da UF.
            Err(ErroDownload::Ftp(ErroFtp::Resposta(..)))
                if TIPOS_OPCIONAIS.contains(&t.as_str()) =>
            {
                continue;
            }
            r => r?,
        };
        pedidos.push(Pedido {
            pasta_remota: pasta,
            nome: n,
            tamanho,
        });
    }
    sessao.sair();
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

/// O que veio do TAB_CNES.zip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Auxiliares {
    /// `CADGER<UF>.dbf` (nome dos estabelecimentos).
    pub cadastro: PathBuf,
    /// Tabelas de conversão gravadas em `destino/cnv/`.
    pub cnv: Vec<PathBuf>,
    /// Arquivos `.cnv` pedidos que não existem no ZIP.
    pub cnv_ausentes: Vec<String>,
    pub bytes_baixados: u64,
    pub tamanho_do_zip: u64,
}

/// Sessão FTP reaproveitada entre os trechos e os SIZE. Se cair (ou o servidor não abrir o
/// canal de dados), reabre e repete, com espera crescente.
pub(crate) struct Sessao<'a> {
    fonte: &'a Fonte,
    ftp: Option<Ftp>,
}

impl<'a> Sessao<'a> {
    pub(crate) fn nova(fonte: &'a Fonte) -> Self {
        Self { fonte, ftp: None }
    }

    /// Roda `op` na sessão, reabrindo-a quantas vezes a cortesia permitir.
    pub(crate) fn com_tentativas<T>(
        &mut self,
        rotulo: &str,
        cancelar: &AtomicBool,
        progresso: &mut impl FnMut(Evento),
        mut op: impl FnMut(&mut Ftp, &mut dyn FnMut(Evento)) -> Result<T, ErroFtp>,
    ) -> Result<T, ErroDownload> {
        let c = &self.fonte.cortesia;
        let mut tentativa = 0;
        loop {
            if cancelar.load(Ordering::Relaxed) {
                return Err(ErroDownload::Cancelado);
            }
            let r = match self.ftp.take() {
                Some(f) => Ok(f),
                None => Ftp::conectar(&self.fonte.servidor, c.porta, c.tempo_limite),
            }
            .and_then(|mut f| {
                let r = op(&mut f, &mut *progresso);
                if r.is_ok() && f.reaproveitavel() {
                    self.ftp = Some(f);
                }
                r
            });
            match r {
                Ok(v) => return Ok(v),
                Err(e) => {
                    tentativa += 1;
                    if tentativa >= c.tentativas {
                        return Err(e.into());
                    }
                    let espera = c.espera(tentativa);
                    progresso(Evento::NovaTentativa {
                        arquivo: rotulo.to_string(),
                        tentativa: tentativa + 1,
                        espera_s: espera.as_secs(),
                        motivo: e.to_string(),
                    });
                    std::thread::sleep(espera);
                }
            }
        }
    }

    pub(crate) fn tamanho(
        &mut self,
        caminho: &str,
        cancelar: &AtomicBool,
        progresso: &mut impl FnMut(Evento),
    ) -> Result<u64, ErroDownload> {
        let caminho = caminho.to_string();
        let r = self.com_tentativas("tamanho do arquivo", cancelar, progresso, |f, _| {
            f.tamanho(&caminho)
        })?;
        // O SIZE não deixa a sessão marcada como reaproveitável; é reaproveitável de fato.
        Ok(r)
    }

    pub(crate) fn trecho(
        &mut self,
        desde: u64,
        quantos: u64,
        rotulo: &str,
        cancelar: &AtomicBool,
        progresso: &mut impl FnMut(Evento),
    ) -> Result<Vec<u8>, ErroDownload> {
        let caminho = self.fonte.tab_cnes.clone();
        progresso(Evento::Iniciando {
            arquivo: rotulo.to_string(),
            total: quantos,
            retomando_de: 0,
        });
        let b = self.com_tentativas(rotulo, cancelar, progresso, |f, prog| {
            f.baixar_trecho(&caminho, desde, quantos, |feito| {
                prog(Evento::Progresso {
                    arquivo: rotulo.to_string(),
                    feito,
                    total: quantos,
                });
            })
        })?;
        progresso(Evento::Concluido {
            arquivo: rotulo.to_string(),
        });
        std::thread::sleep(self.fonte.cortesia.pausa_entre_arquivos);
        Ok(b)
    }

    pub(crate) fn sair(mut self) {
        if let Some(f) = self.ftp.take() {
            f.sair();
        }
    }
}

fn gravar(caminho: &Path, bytes: &[u8]) -> Result<(), ErroDownload> {
    if let Some(p) = caminho.parent() {
        std::fs::create_dir_all(p)
            .map_err(|e| ErroDownload::Arquivo(p.to_path_buf(), e.to_string()))?;
    }
    std::fs::write(caminho, bytes)
        .map_err(|e| ErroDownload::Arquivo(caminho.to_path_buf(), e.to_string()))
}

/// Nome (sem pasta) de uma entrada, em minúsculas, para comparar sem diferenciar caixa.
fn chave(nome: &str) -> String {
    nome.rsplit(['/', '\\'])
        .next()
        .unwrap_or(nome)
        .to_ascii_lowercase()
}

/// Baixa do TAB_CNES.zip só o cadastro de nomes da UF e as tabelas de conversão pedidas
/// (três ou quatro trechos, um por vez). Grava `CADGER<UF>.dbf` em `destino` e os `.cnv` em
/// `destino/cnv/`.
pub fn baixar_auxiliares(
    fonte: &Fonte,
    uf: &str,
    cnv_pedidos: &[String],
    destino: &Path,
    cancelar: &AtomicBool,
    mut progresso: impl FnMut(Evento),
) -> Result<Auxiliares, ErroDownload> {
    let invalido = |m: String| ErroDownload::Invalido("TAB_CNES.zip".into(), m);
    let mut sessao = Sessao::nova(fonte);
    let total = sessao.tamanho(&fonte.tab_cnes, cancelar, &mut progresso)?;
    let mut baixados = 0u64;

    // 1. Índice (fim do arquivo).
    let mut desde = total.saturating_sub(CAUDA);
    let mut cauda = sessao.trecho(
        desde,
        total - desde,
        "índice do TAB_CNES.zip",
        cancelar,
        &mut progresso,
    )?;
    baixados += cauda.len() as u64;
    let indice = match zip_parcial::ler_indice(&cauda, total, MAX_ENTRADAS) {
        Ok(i) => i,
        Err(zip_parcial::ErroZipParcial::IndiceIncompleto { a_partir_de }) => {
            desde = a_partir_de;
            cauda = sessao.trecho(
                desde,
                total - desde,
                "índice do TAB_CNES.zip",
                cancelar,
                &mut progresso,
            )?;
            baixados += cauda.len() as u64;
            zip_parcial::ler_indice(&cauda, total, MAX_ENTRADAS)
                .map_err(|e| invalido(e.to_string()))?
        }
        Err(e) => return Err(invalido(e.to_string())),
    };
    let por_nome: BTreeMap<String, &Entrada> = indice.iter().map(|e| (chave(&e.nome), e)).collect();

    // 2. Cadastro de nomes da UF.
    let nome_cad = format!("CADGER{uf}.dbf");
    let cad = por_nome
        .get(&nome_cad.to_ascii_lowercase())
        .ok_or_else(|| invalido(format!("não traz {nome_cad}")))?;
    let pedir = cad.bytes_necessarios().min(total - cad.posicao);
    let b = sessao.trecho(cad.posicao, pedir, &nome_cad, cancelar, &mut progresso)?;
    baixados += b.len() as u64;
    let conteudo =
        zip_parcial::extrair(&b, cad, MAX_CADASTRO).map_err(|e| invalido(e.to_string()))?;
    dbf::Dbf::abrir(&conteudo).map_err(|e| invalido(format!("{nome_cad}: {e}")))?;
    let cadastro = destino.join(&nome_cad);
    gravar(&cadastro, &conteudo)?;

    // 3. Tabelas de conversão: um trecho só, da primeira à última pedida.
    let mut achadas: Vec<&Entrada> = Vec::new();
    let mut cnv_ausentes = Vec::new();
    for pedido in cnv_pedidos {
        match por_nome.get(&pedido.to_ascii_lowercase()) {
            Some(e) => achadas.push(e),
            None => cnv_ausentes.push(pedido.clone()),
        }
    }
    let mut cnv = Vec::new();
    if let (Some(ini), Some(fim)) = (
        achadas.iter().map(|e| e.posicao).min(),
        achadas
            .iter()
            .map(|e| e.posicao + e.bytes_necessarios())
            .max(),
    ) {
        let pedir = (fim - ini).min(total - ini);
        let b = sessao.trecho(
            ini,
            pedir,
            "tabelas de conversão do CNES",
            cancelar,
            &mut progresso,
        )?;
        baixados += b.len() as u64;
        for e in achadas {
            let de = usize::try_from(e.posicao - ini).map_err(|_| invalido("posição".into()))?;
            let dados = b
                .get(de..)
                .ok_or_else(|| invalido(format!("{}: trecho curto", e.nome)))?;
            let conteudo =
                zip_parcial::extrair(dados, e, MAX_CNV).map_err(|x| invalido(x.to_string()))?;
            let alvo = destino.join("cnv").join(chave(&e.nome));
            gravar(&alvo, &conteudo)?;
            cnv.push(alvo);
        }
    }
    sessao.sair();
    Ok(Auxiliares {
        cadastro,
        cnv,
        cnv_ausentes,
        bytes_baixados: baixados,
        tamanho_do_zip: total,
    })
}

/// Os `.dbc` guardados de uma UF: por tipo, o mais recente.
pub fn locais(pasta: &Path, uf: &str) -> BTreeMap<String, (Competencia, PathBuf)> {
    let mut m: BTreeMap<String, (Competencia, PathBuf)> = BTreeMap::new();
    let Ok(dir) = std::fs::read_dir(pasta) else {
        return m;
    };
    for e in dir.flatten() {
        let nome = e.file_name().to_string_lossy().into_owned();
        if let Some((t, u, c)) = interpretar(&nome)
            && u == uf
            && m.get(&t).is_none_or(|(atual, _)| c > *atual)
        {
            m.insert(t, (c, e.path()));
        }
    }
    m
}

/// Resultado da importação manual.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Importacao {
    pub dbc: Vec<String>,
    pub cadastro: bool,
    pub cnv: usize,
    pub recusados: Vec<(String, String)>,
}

/// Modo manual: copia de `origem` para `destino` os arquivos do CNES da UF que o usuário baixou
/// por conta própria (`.dbc`, `CADGER<UF>.dbf` e `.cnv`, soltos ou dentro de `TAB_CNES.zip`).
/// Só entra o que passa na verificação.
pub fn importar_pasta(
    origem: &Path,
    destino: &Path,
    uf: &str,
    cnv_pedidos: &[String],
) -> Result<Importacao, ErroDownload> {
    let erro = |p: &Path, e: std::io::Error| ErroDownload::Arquivo(p.to_path_buf(), e.to_string());
    std::fs::create_dir_all(destino).map_err(|e| erro(destino, e))?;
    let mut r = Importacao::default();
    let pedidos: Vec<String> = cnv_pedidos.iter().map(|c| c.to_ascii_lowercase()).collect();
    let nome_cad = format!("cadger{}.dbf", uf.to_ascii_lowercase());
    let mut pastas = vec![origem.to_path_buf()];
    for sub in ["CNV", "cnv", "DBF", "dbf"] {
        pastas.push(origem.join(sub));
    }
    for pasta in pastas {
        let Ok(dir) = std::fs::read_dir(&pasta) else {
            continue;
        };
        for e in dir.flatten() {
            let caminho = e.path();
            if !caminho.is_file() {
                continue;
            }
            let nome = e.file_name().to_string_lossy().into_owned();
            let baixo = nome.to_ascii_lowercase();
            if let Some((_, u, _)) = interpretar(&nome.to_ascii_uppercase().replace(".DBC", ".dbc"))
            {
                if u != uf {
                    continue;
                }
                match validar_dbc(&caminho) {
                    Ok(()) => {
                        let alvo = destino.join(nome.to_ascii_uppercase().replace(".DBC", ".dbc"));
                        std::fs::copy(&caminho, &alvo).map_err(|e| erro(&alvo, e))?;
                        r.dbc.push(nome);
                    }
                    Err(m) => r.recusados.push((nome, m)),
                }
            } else if baixo == nome_cad {
                let b = std::fs::read(&caminho).map_err(|e| erro(&caminho, e))?;
                match dbf::Dbf::abrir(&b) {
                    Ok(_) => {
                        gravar(&destino.join(format!("CADGER{uf}.dbf")), &b)?;
                        r.cadastro = true;
                    }
                    Err(m) => r.recusados.push((nome, m.to_string())),
                }
            } else if pedidos.contains(&baixo) {
                let b = std::fs::read(&caminho).map_err(|e| erro(&caminho, e))?;
                if b.len() as u64 <= MAX_CNV {
                    gravar(&destino.join("cnv").join(&baixo), &b)?;
                    r.cnv += 1;
                } else {
                    r.recusados.push((
                        nome,
                        "arquivo grande demais para uma tabela de conversão".into(),
                    ));
                }
            } else if baixo == "tab_cnes.zip" {
                // O ZIP inteiro, baixado à mão: tira dele só o que interessa.
                let b = std::fs::read(&caminho).map_err(|e| erro(&caminho, e))?;
                let total = b.len() as u64;
                match zip_parcial::ler_indice(&b, total, MAX_ENTRADAS) {
                    Ok(indice) => {
                        for ent in &indice {
                            let k = chave(&ent.nome);
                            let de = usize::try_from(ent.posicao).unwrap_or(usize::MAX);
                            let Some(dados) = b.get(de..) else { continue };
                            if k == nome_cad {
                                match zip_parcial::extrair(dados, ent, MAX_CADASTRO) {
                                    Ok(c) if dbf::Dbf::abrir(&c).is_ok() => {
                                        gravar(&destino.join(format!("CADGER{uf}.dbf")), &c)?;
                                        r.cadastro = true;
                                    }
                                    Ok(_) => {
                                        r.recusados.push((ent.nome.clone(), "não é um DBF".into()))
                                    }
                                    Err(m) => r.recusados.push((ent.nome.clone(), m.to_string())),
                                }
                            } else if pedidos.contains(&k) {
                                match zip_parcial::extrair(dados, ent, MAX_CNV) {
                                    Ok(c) => {
                                        gravar(&destino.join("cnv").join(&k), &c)?;
                                        r.cnv += 1;
                                    }
                                    Err(m) => r.recusados.push((ent.nome.clone(), m.to_string())),
                                }
                            }
                        }
                    }
                    Err(m) => r.recusados.push((nome, m.to_string())),
                }
            }
        }
    }
    r.dbc.sort();
    Ok(r)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn nomes_dos_arquivos() {
        let c = Competencia::nova(2026, 8).unwrap();
        assert_eq!(nome("ST", "MS", c), "STMS2608.dbc");
        assert_eq!(
            interpretar("STMS2608.dbc"),
            Some(("ST".into(), "MS".into(), c))
        );
        assert_eq!(
            interpretar("PFSP0508.DBC").map(|x| x.2),
            Some(Competencia::nova(2005, 8).unwrap())
        );
        for ruim in [
            "STXX2608.dbc",
            "STMS2613.dbc",
            "STMS2608.zip",
            "STMS26080.dbc",
            "stms2608.dbc",
            "STMSAABB.dbc",
        ] {
            assert_eq!(interpretar(ruim), None, "{ruim}");
        }
        assert!(uf_valida("MS") && !uf_valida("BR"));
    }
}
