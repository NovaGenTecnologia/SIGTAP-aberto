//! ZIP da Tabela Unificada (SIGTAP): identificação pelo nome, leiautes e registros de
//! largura fixa.
//!
//! Achado de 30/09/2026 (225 ZIPs, 8.442 arquivos): todo registro tem exatamente a largura do
//! leiaute seguida de CRLF; 17 arquivos têm LF dentro do texto. Por isso os registros são
//! lidos por tamanho, nunca separando por linha.

pub mod leiaute;

use serde::Deserialize;
use std::collections::BTreeMap;

use crate::zip_seguro::{ErroZip, Limites, ZipSeguro};
pub use leiaute::{Coluna, ErroLeiaute, Leiaute, Tipo, ler_leiaute};
use sa_core::Competencia;
use std::fmt;
use std::path::Path;

#[derive(Deserialize)]
struct ManifestoChaves {
    chaves: BTreeMap<String, Vec<String>>,
}

/// Chaves naturais por tabela (manifesto `manifestos/sigtap_chaves.toml`). Lista vazia =
/// tabela sem chave natural (há linhas inteiras repetidas).
pub fn chaves_naturais() -> BTreeMap<String, Vec<String>> {
    let m: ManifestoChaves = toml::from_str(include_str!("../../manifestos/sigtap_chaves.toml"))
        .expect("manifestos/sigtap_chaves.toml inválido: erro de programação, corrija o manifesto");
    m.chaves
}

/// Identificação de um ZIP do SIGTAP pelo nome: `TabelaUnificada_AAAAMM[_vAAMMDDhhmm].zip`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NomeZip {
    pub competencia: Competencia,
    /// Carimbo de versão `AAMMDDhhmm`, quando existe (a partir de 200905).
    pub versao: Option<String>,
}

/// Interpreta o nome de arquivo oficial. `None` se não seguir o padrão.
pub fn interpretar_nome(nome: &str) -> Option<NomeZip> {
    let resto = nome
        .strip_prefix("TabelaUnificada_")?
        .strip_suffix(".zip")?;
    let (comp, versao) = match resto.split_once("_v") {
        Some((c, v)) => (c, Some(v)),
        None => (resto, None),
    };
    let competencia = Competencia::de_texto(comp).ok()?;
    if let Some(v) = versao
        && (v.len() != 10 || !v.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    Some(NomeZip {
        competencia,
        versao: versao.map(str::to_string),
    })
}

/// Erro ao ler um ZIP do SIGTAP.
#[derive(Debug)]
pub enum ErroSigtap {
    Zip(ErroZip),
    Leiaute(ErroLeiaute),
    Nome(String),
    Registro { arquivo: String, motivo: String },
}

impl fmt::Display for ErroSigtap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroSigtap::Zip(e) => e.fmt(f),
            ErroSigtap::Leiaute(e) => e.fmt(f),
            ErroSigtap::Nome(n) => write!(
                f,
                "\"{n}\" não segue o nome oficial TabelaUnificada_AAAAMM[_vAAMMDDhhmm].zip. Use o arquivo como veio do FTP do DATASUS, sem renomear"
            ),
            ErroSigtap::Registro { arquivo, motivo } => write!(
                f,
                "{arquivo}: {motivo}. O arquivo não bate com o leiaute; baixe o ZIP de novo da fonte oficial"
            ),
        }
    }
}

impl std::error::Error for ErroSigtap {}

impl From<ErroZip> for ErroSigtap {
    fn from(e: ErroZip) -> Self {
        ErroSigtap::Zip(e)
    }
}

impl From<ErroLeiaute> for ErroSigtap {
    fn from(e: ErroLeiaute) -> Self {
        ErroSigtap::Leiaute(e)
    }
}

/// Tabela lida de um ZIP: leiaute e conteúdo bruto.
pub struct TabelaLida {
    pub leiaute: Leiaute,
    pub dados: Vec<u8>,
}

impl TabelaLida {
    /// Número de registros.
    pub fn quantidade(&self) -> usize {
        self.dados.len() / (self.leiaute.largura + 2)
    }

    /// Registros na ordem do arquivo (sem o CRLF).
    pub fn registros(&self) -> impl Iterator<Item = &[u8]> {
        self.dados
            .chunks_exact(self.leiaute.largura + 2)
            .map(move |c| &c[..self.leiaute.largura])
    }
}

/// ZIP do SIGTAP aberto.
pub struct ZipSigtap {
    zip: ZipSeguro,
    pub nome: NomeZip,
    pub arquivo: String,
}

impl ZipSigtap {
    pub fn abrir(caminho: &Path) -> Result<Self, ErroSigtap> {
        let arquivo = caminho
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Self::abrir_como(caminho, &arquivo)
    }

    /// Abre um arquivo com nome provisório (ex.: download em andamento) identificando-o pelo
    /// nome oficial com que ele será guardado.
    pub fn abrir_como(caminho: &Path, nome_oficial: &str) -> Result<Self, ErroSigtap> {
        let nome = interpretar_nome(nome_oficial)
            .ok_or_else(|| ErroSigtap::Nome(nome_oficial.to_string()))?;
        let zip = ZipSeguro::abrir(caminho, Limites::default())?;
        Ok(Self {
            zip,
            nome,
            arquivo: nome_oficial.to_string(),
        })
    }

    /// Tabelas presentes (as que têm `<tabela>_layout.txt`), em ordem alfabética.
    pub fn tabelas(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .zip
            .nomes()
            .iter()
            .filter_map(|n| n.strip_suffix("_layout.txt"))
            .map(str::to_string)
            .collect();
        v.sort();
        v
    }

    /// Lê leiaute e dados de uma tabela e confere a estrutura de todos os registros.
    pub fn ler_tabela(&mut self, tabela: &str) -> Result<TabelaLida, ErroSigtap> {
        let nome_leiaute = format!("{tabela}_layout.txt");
        let nome_dados = format!("{tabela}.txt");
        let b = self.zip.ler(&nome_leiaute)?;
        let leiaute = ler_leiaute(&tabela.to_ascii_lowercase(), &nome_leiaute, &b)?;
        let dados = self.zip.ler(&nome_dados)?;
        conferir_registros(&nome_dados, &leiaute, &dados)?;
        Ok(TabelaLida { leiaute, dados })
    }
}

/// Confere que o conteúdo é uma sequência de registros de largura fixa terminados em CRLF.
pub fn conferir_registros(
    arquivo: &str,
    leiaute: &Leiaute,
    dados: &[u8],
) -> Result<(), ErroSigtap> {
    let passo = leiaute.largura + 2;
    if !dados.len().is_multiple_of(passo) {
        return Err(ErroSigtap::Registro {
            arquivo: arquivo.to_string(),
            motivo: format!(
                "{} bytes não formam registros de {} posições + CRLF",
                dados.len(),
                leiaute.largura
            ),
        });
    }
    for (i, r) in dados.chunks_exact(passo).enumerate() {
        if &r[leiaute.largura..] != b"\r\n" {
            return Err(ErroSigtap::Registro {
                arquivo: arquivo.to_string(),
                motivo: format!(
                    "registro {} não termina em CRLF na posição {}",
                    i + 1,
                    leiaute.largura + 1
                ),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::zip_seguro::testes::{criar_zip, dir_temp};

    #[test]
    fn manifesto_de_chaves_e_valido() {
        let c = chaves_naturais();
        assert_eq!(c.len(), 41);
        assert_eq!(c["tb_procedimento"], ["co_procedimento"]);
        assert!(c["rl_procedimento_renases"].is_empty());
        for (t, cols) in &c {
            sa_core::safe_ident(t).unwrap();
            for col in cols {
                sa_core::safe_ident(col).unwrap();
            }
        }
    }

    #[test]
    fn interpreta_nomes_oficiais() {
        let n = interpretar_nome("TabelaUnificada_202609_v2609171117.zip").unwrap();
        assert_eq!(n.competencia.to_string(), "202609");
        assert_eq!(n.versao.as_deref(), Some("2609171117"));
        let n = interpretar_nome("TabelaUnificada_200801.zip").unwrap();
        assert_eq!(n.versao, None);
        for ruim in [
            "TabelaUnificada_202613.zip",
            "TabelaUnificada_202609_v26.zip",
            "Tabela_202609.zip",
            "TabelaUnificada_202609.ZIP",
        ] {
            assert!(interpretar_nome(ruim).is_none(), "{ruim}");
        }
    }

    #[test]
    fn le_tabela_com_lf_dentro_do_texto() {
        let d = dir_temp("sigtap-lf");
        let leiaute =
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nCO,2,1,2,VARCHAR2\r\nDS,6,3,8,VARCHAR2\r\n";
        // Segundo registro tem LF no meio do texto: separar por linha quebraria o registro.
        let dados = b"01abc   \r\n02a\nb   \r\n";
        let p = criar_zip(
            &d,
            "TabelaUnificada_202609_v2609171117.zip",
            &[("tb_x_layout.txt", leiaute), ("tb_x.txt", dados)],
        );
        let mut z = ZipSigtap::abrir(&p).unwrap();
        assert_eq!(z.tabelas(), ["tb_x"]);
        let t = z.ler_tabela("tb_x").unwrap();
        let regs: Vec<&[u8]> = t.registros().collect();
        assert_eq!(regs, [&b"01abc   "[..], &b"02a\nb   "[..]]);
        assert_eq!(t.quantidade(), 2);
    }

    #[test]
    fn recusa_registro_fora_do_leiaute() {
        let l = ler_leiaute(
            "t",
            "t",
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nA,3,1,3,CHAR\r\n",
        )
        .unwrap();
        assert!(conferir_registros("t.txt", &l, b"abc\r\nab\r\n").is_err());
        assert!(conferir_registros("t.txt", &l, b"abcd\r\n").is_err());
        assert!(conferir_registros("t.txt", &l, b"").is_ok());
    }

    #[test]
    fn recusa_zip_renomeado() {
        let d = dir_temp("sigtap-nome");
        let p = criar_zip(&d, "sigtap_setembro.zip", &[("a.txt", b"x")]);
        let e = ZipSigtap::abrir(&p).err().unwrap();
        assert!(e.to_string().contains("sem renomear"), "{e}");
    }
}
