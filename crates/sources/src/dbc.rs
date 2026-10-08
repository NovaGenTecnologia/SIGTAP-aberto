//! Arquivos `.dbc` do DATASUS: um DBF com os registros comprimidos em PKWARE DCL.
//!
//! Estrutura (medida nos arquivos reais do CNES e conferida com o resultado da ferramenta
//! de referência): os primeiros `N` bytes são o cabeçalho do DBF, sem compressão, onde `N` é o
//! tamanho de cabeçalho que o próprio DBF declara (bytes 8 e 9); seguem 4 bytes de CRC-32 e,
//! depois, os registros comprimidos ([`crate::dcl`]).

use crate::dbf::{Cabecalho, ErroDbf};
use crate::dcl::{self, ErroDcl};
use std::fmt;

/// Limite padrão do DBF descomprimido: 2 GiB (o maior arquivo do CNES medido tem 293 MB).
pub const LIMITE_PADRAO: usize = 2 * 1024 * 1024 * 1024;

/// Erro ao abrir um `.dbc`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroDbc {
    Dbf(ErroDbf),
    Dcl(ErroDcl),
    /// O conteúdo descomprimido não tem o tamanho que o cabeçalho declara.
    Tamanho {
        esperado: usize,
        obtido: usize,
    },
}

impl fmt::Display for ErroDbc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroDbc::Dbf(e) => write!(f, "{e}"),
            ErroDbc::Dcl(e) => write!(f, "{e}"),
            ErroDbc::Tamanho { esperado, obtido } => write!(
                f,
                "o conteúdo descomprimido tem {obtido} bytes e o cabeçalho declara {esperado}"
            ),
        }
    }
}

impl std::error::Error for ErroDbc {}

/// Descomprime um `.dbc` e devolve o DBF completo (cabeçalho + registros).
///
/// A memória pedida é limitada pelo que o cabeçalho declara (registros × tamanho) e por `limite`.
pub fn para_dbf(dbc: &[u8], limite: usize) -> Result<Vec<u8>, ErroDbc> {
    let cab = Cabecalho::ler(dbc).map_err(ErroDbc::Dbf)?;
    let corpo = cab.registros * cab.tamanho_registro;
    // +1: o marcador de fim de arquivo (0x1A), quando vem.
    let esperado = corpo + 1;
    if cab.tamanho_cabecalho + esperado > limite {
        return Err(ErroDbc::Dcl(ErroDcl::Limite(limite)));
    }
    let comprimido = dbc
        .get(cab.tamanho_cabecalho + 4..)
        .ok_or(ErroDbc::Dcl(ErroDcl::Truncado))?;
    let mut dbf = Vec::with_capacity(cab.tamanho_cabecalho + esperado);
    dbf.extend_from_slice(&dbc[..cab.tamanho_cabecalho]);
    dcl::descomprimir_em(comprimido, esperado, &mut dbf).map_err(ErroDbc::Dcl)?;
    let obtido = dbf.len() - cab.tamanho_cabecalho;
    if obtido != corpo && obtido != esperado {
        return Err(ErroDbc::Tamanho {
            esperado: corpo,
            obtido,
        });
    }
    Ok(dbf)
}

/// Monta um `.dbc` a partir de um DBF, só com literais sem compressão. **Só para testes** (fixtures
/// sintéticas): o programa nunca grava `.dbc`. O CRC fica zerado, porque a leitura não o confere.
pub fn de_dbf_sintetico(dbf: &[u8]) -> Vec<u8> {
    let cab = Cabecalho::ler(dbf).expect("DBF sintético válido");
    let mut saida = dbf[..cab.tamanho_cabecalho].to_vec();
    saida.extend_from_slice(&[0; 4]);
    saida.extend_from_slice(&[0, 4]);
    let mut bits: Vec<u8> = Vec::new();
    for &byte in &dbf[cab.tamanho_cabecalho..] {
        bits.push(0);
        bits.extend((0..8).map(|i| (byte >> i) & 1));
    }
    // Fim do fluxo: bit 1, código do comprimento 519 (sete zeros) e oito bits 1.
    bits.push(1);
    bits.extend([0; 7]);
    bits.extend([1; 8]);
    for grupo in bits.chunks(8) {
        saida.push(
            grupo
                .iter()
                .enumerate()
                .fold(0u8, |acc, (i, b)| acc | (b << i)),
        );
    }
    saida
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn dbc_sintetico_volta_ao_dbf_original() {
        let dbf = crate::dbf::testes::montar(
            &[("CNES", 'C', 7), ("QT", 'N', 4)],
            &[&["0000001", "12"], &["0000002", "3"]],
            0x0D,
        );
        let dbc = de_dbf_sintetico(&dbf);
        assert_eq!(para_dbf(&dbc, 1 << 20).unwrap(), dbf);
    }

    #[test]
    fn recusa_arquivo_que_nao_e_dbc() {
        assert!(matches!(para_dbf(b"nao e dbc", 1000), Err(ErroDbc::Dbf(_))));
    }

    #[test]
    fn limite_vale_antes_de_alocar() {
        // Cabeçalho que declara 4 bilhões de registros: recusado sem alocar.
        let mut b = crate::dbf::testes::montar(&[("A", 'C', 2)], &[], 0x0D);
        b[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        b.extend_from_slice(&[0; 8]);
        assert!(matches!(
            para_dbf(&b, 1 << 20),
            Err(ErroDbc::Dcl(ErroDcl::Limite(_)))
        ));
    }
}
