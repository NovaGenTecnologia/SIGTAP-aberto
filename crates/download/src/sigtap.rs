//! Download e importação dos ZIPs do SIGTAP.
//!
//! Fonte: `ftp2.datasus.gov.br/pub/sistemas/tup/downloads` (catalogo/fontes.toml, [sigtap]).
//! O FTP guarda só a versão mais nova de cada competência; uma versão remota mais nova que a
//! local é uma republicação e deve ser baixada.

use crate::cortesia::{Cortesia, ErroDownload};
use crate::ftp::{Entrada, Ftp};
use sa_core::Competencia;
use sa_sources::sigtap::{ZipSigtap, interpretar_nome};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const SERVIDOR: &str = "ftp2.datasus.gov.br";
pub const PASTA: &str = "/pub/sistemas/tup/downloads";

/// ZIP disponível no servidor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Disponivel {
    pub competencia: Competencia,
    pub nome: String,
    pub versao: Option<String>,
    pub tamanho: u64,
}

/// ZIPs do SIGTAP numa listagem, um por competência (a versão mais nova).
pub fn disponiveis(entradas: &[Entrada]) -> Vec<Disponivel> {
    let mut por_comp: BTreeMap<Competencia, Disponivel> = BTreeMap::new();
    for e in entradas {
        let (Some(t), Some(n)) = (e.tamanho, interpretar_nome(&e.nome)) else {
            continue;
        };
        let d = Disponivel {
            competencia: n.competencia,
            nome: e.nome.clone(),
            versao: n.versao,
            tamanho: t,
        };
        match por_comp.get(&n.competencia) {
            Some(atual) if atual.versao >= d.versao => {}
            _ => {
                por_comp.insert(n.competencia, d);
            }
        }
    }
    por_comp.into_values().collect()
}

/// ZIPs do SIGTAP já presentes numa pasta local: competência → (versão, caminho).
pub fn locais(pasta: &Path) -> BTreeMap<Competencia, (Option<String>, PathBuf)> {
    let mut m: BTreeMap<Competencia, (Option<String>, PathBuf)> = BTreeMap::new();
    let Ok(rd) = std::fs::read_dir(pasta) else {
        return m;
    };
    for e in rd.flatten() {
        let nome = e.file_name().to_string_lossy().into_owned();
        if let Some(n) = interpretar_nome(&nome) {
            match m.get(&n.competencia) {
                Some((v, _)) if *v >= n.versao => {}
                _ => {
                    m.insert(n.competencia, (n.versao, e.path()));
                }
            }
        }
    }
    m
}

/// O que baixar: competências que não existem na pasta ou cuja versão remota é mais nova.
pub fn planejar(
    disp: &[Disponivel],
    pasta: &Path,
    filtro: impl Fn(Competencia) -> bool,
) -> Vec<Disponivel> {
    let ja = locais(pasta);
    disp.iter()
        .filter(|d| filtro(d.competencia))
        .filter(|d| match ja.get(&d.competencia) {
            None => true,
            Some((v, _)) => d.versao > *v,
        })
        .cloned()
        .collect()
}

/// Lista o servidor oficial.
pub fn listar_servidor(cortesia: &Cortesia) -> Result<Vec<Disponivel>, ErroDownload> {
    let mut f = Ftp::conectar(SERVIDOR, cortesia.porta, cortesia.tempo_limite)?;
    let e = f.listar(PASTA)?;
    f.sair();
    Ok(disponiveis(&e))
}

/// Confere que um arquivo é um ZIP do SIGTAP legível (nome, limites e todas as tabelas).
/// `nome_oficial` é o nome com que ele vai ficar guardado.
pub fn validar_zip(arquivo: &Path, nome_oficial: &str) -> Result<(), String> {
    let mut z = ZipSigtap::abrir_como(arquivo, nome_oficial).map_err(|e| e.to_string())?;
    let tabelas = z.tabelas();
    if tabelas.is_empty() {
        return Err("nenhuma tabela no ZIP".to_string());
    }
    for t in tabelas {
        z.ler_tabela(&t).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resultado da importação: arquivos copiados e recusados (nome, motivo).
pub type Importacao = (Vec<PathBuf>, Vec<(String, String)>);

/// Modo manual: copia para `destino` os ZIPs do SIGTAP válidos encontrados em `origem`
/// (para rede que bloqueia FTP). Devolve (copiados, recusados com motivo).
pub fn importar_pasta(origem: &Path, destino: &Path) -> Result<Importacao, ErroDownload> {
    std::fs::create_dir_all(destino)
        .map_err(|e| ErroDownload::Arquivo(destino.to_path_buf(), e.to_string()))?;
    let mut ok = Vec::new();
    let mut recusados = Vec::new();
    let rd = std::fs::read_dir(origem)
        .map_err(|e| ErroDownload::Arquivo(origem.to_path_buf(), e.to_string()))?;
    let mut nomes: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    nomes.sort();
    for p in nomes {
        let nome = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if interpretar_nome(&nome).is_none() {
            continue;
        }
        match validar_zip(&p, &nome) {
            Ok(()) => {
                let alvo = destino.join(&nome);
                if alvo != p {
                    std::fs::copy(&p, &alvo)
                        .map_err(|e| ErroDownload::Arquivo(alvo.clone(), e.to_string()))?;
                }
                ok.push(alvo);
            }
            Err(e) => recusados.push((nome, e)),
        }
    }
    Ok((ok, recusados))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn e(nome: &str, t: u64) -> Entrada {
        Entrada {
            nome: nome.into(),
            tamanho: Some(t),
        }
    }

    #[test]
    fn escolhe_versao_mais_nova_e_ignora_o_resto() {
        let l = vec![
            e("TabelaUnificada_202608_v2608141139.zip", 10),
            e("TabelaUnificada_202609_v2609171117.zip", 20),
            e("TabelaUnificada_202609_v2610011200.zip", 21),
            e("sigtap-setup-1.4.1703301403.exe", 5),
            e("TabelaUnificada_200801.zip", 1),
            Entrada {
                nome: "notastecnicas".into(),
                tamanho: None,
            },
        ];
        let d = disponiveis(&l);
        assert_eq!(d.len(), 3);
        assert_eq!(d[2].nome, "TabelaUnificada_202609_v2610011200.zip");
        assert_eq!(d[0].competencia.to_string(), "200801");
    }

    #[test]
    fn planeja_so_o_que_falta_ou_foi_republicado() {
        let dir = std::env::temp_dir().join(format!("sa-dl-plan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("TabelaUnificada_202608_v2608141139.zip"), b"x").unwrap();
        std::fs::write(dir.join("TabelaUnificada_202609_v2609171117.zip"), b"x").unwrap();
        let d = disponiveis(&[
            e("TabelaUnificada_202607_v2607101010.zip", 1),
            e("TabelaUnificada_202608_v2608141139.zip", 1),
            e("TabelaUnificada_202609_v2610011200.zip", 1),
        ]);
        let p = planejar(&d, &dir, |_| true);
        let nomes: Vec<_> = p.iter().map(|x| x.nome.as_str()).collect();
        assert_eq!(
            nomes,
            [
                "TabelaUnificada_202607_v2607101010.zip",
                "TabelaUnificada_202609_v2610011200.zip"
            ]
        );
        let so_ultima = planejar(&d, &dir, |c| c.to_string() == "202607");
        assert_eq!(so_ultima.len(), 1);
    }
}
