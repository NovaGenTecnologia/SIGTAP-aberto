//! Leitura parcial de um ZIP grande sem baixá-lo inteiro: o índice fica no fim do arquivo e diz
//! onde está cada entrada; com ele, baixa-se só o trecho de cada arquivo desejado.
//!
//! Usado para o `TAB_CNES.zip` do DATASUS (127 MB), do qual o programa precisa de poucos
//! megabytes: o cadastro de nomes da UF e as tabelas de conversão. Tudo com limites: nome
//! perigoso, tamanho declarado e tamanho real são conferidos.

use std::fmt;
use std::io::Read;

/// Uma entrada do índice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entrada {
    pub nome: String,
    pub comprimido: u64,
    pub tamanho: u64,
    /// Posição do cabeçalho local da entrada, a partir do início do ZIP.
    pub posicao: u64,
}

impl Entrada {
    /// Quantos bytes baixar, a partir de `posicao`, para ter a entrada inteira: cabeçalho local
    /// (30 bytes + nome + campo extra, que pode diferir do índice; folga de 512) + dados.
    pub fn bytes_necessarios(&self) -> u64 {
        30 + self.nome.len() as u64 + 512 + self.comprimido
    }
}

/// Erro de leitura parcial.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroZipParcial {
    /// O trecho do fim não contém o índice inteiro: é preciso baixar a partir de `a_partir_de`.
    IndiceIncompleto {
        a_partir_de: u64,
    },
    Formato(String),
    Limite(String),
}

impl fmt::Display for ErroZipParcial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroZipParcial::IndiceIncompleto { a_partir_de } => {
                write!(
                    f,
                    "o índice do ZIP começa em {a_partir_de}, antes do trecho lido"
                )
            }
            ErroZipParcial::Formato(m) => write!(f, "ZIP em formato inesperado ({m})"),
            ErroZipParcial::Limite(m) => write!(f, "ZIP recusado por segurança ({m})"),
        }
    }
}

impl std::error::Error for ErroZipParcial {}

fn u16_em(b: &[u8], p: usize) -> usize {
    usize::from(u16::from_le_bytes([b[p], b[p + 1]]))
}
fn u32_em(b: &[u8], p: usize) -> u64 {
    u64::from(u32::from_le_bytes([b[p], b[p + 1], b[p + 2], b[p + 3]]))
}

/// Lê o índice a partir do fim do arquivo. `cauda` são os últimos bytes; `tamanho_total`, o
/// tamanho do ZIP inteiro. Não aceita ZIP64 (o TAB_CNES não é).
pub fn ler_indice(
    cauda: &[u8],
    tamanho_total: u64,
    max_entradas: usize,
) -> Result<Vec<Entrada>, ErroZipParcial> {
    let base = tamanho_total
        .checked_sub(cauda.len() as u64)
        .ok_or_else(|| ErroZipParcial::Formato("trecho maior que o arquivo".into()))?;
    let fim = (0..cauda.len().saturating_sub(21))
        .rev()
        .find(|&i| cauda[i..i + 4] == *b"PK\x05\x06")
        .ok_or_else(|| ErroZipParcial::Formato("fim do índice não encontrado".into()))?;
    let total = u16_em(cauda, fim + 10);
    let tam_indice = u32_em(cauda, fim + 12);
    let pos_indice = u32_em(cauda, fim + 16);
    if total > max_entradas {
        return Err(ErroZipParcial::Limite(format!(
            "{total} entradas, máximo {max_entradas}"
        )));
    }
    if pos_indice == u64::from(u32::MAX) || total == usize::from(u16::MAX) {
        return Err(ErroZipParcial::Formato("ZIP64 não é aceito".into()));
    }
    if pos_indice < base {
        return Err(ErroZipParcial::IndiceIncompleto {
            a_partir_de: pos_indice,
        });
    }
    let mut p = usize::try_from(pos_indice - base)
        .map_err(|_| ErroZipParcial::Formato("posição".into()))?;
    let limite = p + usize::try_from(tam_indice)
        .unwrap_or(usize::MAX)
        .min(cauda.len());
    let mut entradas = Vec::with_capacity(total);
    for _ in 0..total {
        if p + 46 > cauda.len() || p + 46 > limite + 46 || cauda[p..p + 4] != *b"PK\x01\x02" {
            return Err(ErroZipParcial::Formato("entrada do índice inválida".into()));
        }
        let (n, e, c) = (
            u16_em(cauda, p + 28),
            u16_em(cauda, p + 30),
            u16_em(cauda, p + 32),
        );
        if p + 46 + n > cauda.len() {
            return Err(ErroZipParcial::Formato("nome além do trecho".into()));
        }
        // Os nomes do TAB_CNES são ASCII; bytes altos são trocados para não virar caminho inesperado.
        let nome: String = cauda[p + 46..p + 46 + n]
            .iter()
            .map(|&b| if b.is_ascii() { char::from(b) } else { '?' })
            .collect();
        entradas.push(Entrada {
            nome,
            comprimido: u32_em(cauda, p + 20),
            tamanho: u32_em(cauda, p + 24),
            posicao: u32_em(cauda, p + 42),
        });
        p += 46 + n + e + c;
    }
    Ok(entradas)
}

/// Extrai uma entrada de `trecho`, que começa no cabeçalho local dela. Confere o tamanho
/// declarado no índice e o limite.
pub fn extrair(
    trecho: &[u8],
    entrada: &Entrada,
    max_bytes: u64,
) -> Result<Vec<u8>, ErroZipParcial> {
    if entrada.tamanho > max_bytes {
        return Err(ErroZipParcial::Limite(format!(
            "{} declara {} bytes, máximo {max_bytes}",
            entrada.nome, entrada.tamanho
        )));
    }
    let mut cursor = std::io::Cursor::new(trecho);
    let mut arq = zip::read::read_zipfile_from_stream(&mut cursor)
        .map_err(|e| ErroZipParcial::Formato(format!("{}: {e}", entrada.nome)))?
        .ok_or_else(|| ErroZipParcial::Formato(format!("{}: cabeçalho ausente", entrada.nome)))?;
    let mut saida = Vec::with_capacity(usize::try_from(entrada.tamanho).unwrap_or(0));
    (&mut arq)
        .take(max_bytes + 1)
        .read_to_end(&mut saida)
        .map_err(|e| ErroZipParcial::Formato(format!("{}: {e}", entrada.nome)))?;
    if saida.len() as u64 != entrada.tamanho {
        return Err(ErroZipParcial::Formato(format!(
            "{}: {} bytes extraídos, o índice declara {}",
            entrada.nome,
            saida.len(),
            entrada.tamanho
        )));
    }
    Ok(saida)
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::io::Write;

    fn zip_de(arquivos: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            for (n, c) in arquivos {
                z.start_file(*n, zip::write::SimpleFileOptions::default())
                    .unwrap();
                z.write_all(c).unwrap();
            }
            z.finish().unwrap();
        }
        buf
    }

    #[test]
    fn le_o_indice_pela_cauda_e_extrai_so_uma_entrada() {
        let grande: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let z = zip_de(&[
            ("DBF/CADGERMS.dbf", grande.clone()),
            (
                "CNV/TP_ESTAB.CNV",
                b"45 2 L\n      1  POSTO DE SAUDE     01\n".to_vec(),
            ),
            ("DBF/CADGERSP.dbf", vec![7u8; 50_000]),
        ]);
        let total = z.len() as u64;
        // Só os últimos 400 bytes: bastam para o índice.
        let cauda = &z[z.len() - 400..];
        let idx = ler_indice(cauda, total, 100).unwrap();
        assert_eq!(
            idx.iter().map(|e| e.nome.as_str()).collect::<Vec<_>>(),
            ["DBF/CADGERMS.dbf", "CNV/TP_ESTAB.CNV", "DBF/CADGERSP.dbf"]
        );
        let e = &idx[1];
        let ini = usize::try_from(e.posicao).unwrap();
        let fim = (ini + usize::try_from(e.bytes_necessarios()).unwrap()).min(z.len());
        assert_eq!(
            extrair(&z[ini..fim], e, 1 << 20).unwrap(),
            b"45 2 L\n      1  POSTO DE SAUDE     01\n"
        );
        let e = &idx[0];
        let fim = usize::try_from(e.bytes_necessarios()).unwrap().min(z.len());
        assert_eq!(extrair(&z[..fim], e, 1 << 20).unwrap(), grande);
        assert!(matches!(
            extrair(&z[..fim], e, 1000),
            Err(ErroZipParcial::Limite(_))
        ));
        // Trecho cortado: erro, nunca conteúdo parcial.
        assert!(extrair(&z[..1000], e, 1 << 20).is_err());
    }

    #[test]
    fn cauda_curta_diz_de_onde_baixar_e_limite_de_entradas_vale() {
        let z = zip_de(&[("a.txt", vec![1; 10]), ("b.txt", vec![2; 10])]);
        let total = z.len() as u64;
        let r = ler_indice(&z[z.len() - 30..], total, 100);
        assert!(
            matches!(r, Err(ErroZipParcial::IndiceIncompleto { .. })),
            "{r:?}"
        );
        assert!(matches!(
            ler_indice(&z, total, 1),
            Err(ErroZipParcial::Limite(_))
        ));
        assert!(ler_indice(b"nada aqui, nem perto de um zip", 30, 10).is_err());
    }
}
