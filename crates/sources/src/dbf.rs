//! Leitor de DBF (dBase III) tolerante, com o esquema lido do próprio arquivo.
//!
//! Os DBF do DATASUS nem sempre seguem o padrão: há cabeçalhos sem o terminador `0x0D`
//! (visto nos arquivos ST do CNES) e o marcador de fim `0x1A` pode faltar. Aqui o número de
//! campos vem do tamanho do cabeçalho, e a soma dos campos é conferida com o tamanho do registro.
//! O texto é ISO-8859-1. Nada é presumido sobre nomes ou posições: tudo vem do arquivo.

use crate::latin1;
use std::fmt;

/// Um campo, como o cabeçalho o descreve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Campo {
    pub nome: String,
    /// Tipo dBase: `C` texto, `N` número, `D` data, `L` lógico...
    pub tipo: char,
    pub tamanho: usize,
    pub decimais: u8,
    /// Posição dentro do registro (o byte 0 é o marcador de exclusão).
    pub inicio: usize,
}

/// Erro de leitura de DBF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroDbf {
    Cabecalho(String),
    Tamanho(String),
}

impl fmt::Display for ErroDbf {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroDbf::Cabecalho(m) => write!(f, "cabeçalho de DBF inválido ({m})"),
            ErroDbf::Tamanho(m) => write!(f, "DBF com tamanho inconsistente ({m})"),
        }
    }
}

impl std::error::Error for ErroDbf {}

/// Só o cabeçalho: campos, tamanhos e quantos registros o arquivo declara.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cabecalho {
    pub campos: Vec<Campo>,
    pub registros: usize,
    pub tamanho_cabecalho: usize,
    pub tamanho_registro: usize,
    /// O terminador `0x0D` estava no lugar esperado.
    pub terminador_padrao: bool,
}

impl Cabecalho {
    /// Interpreta o cabeçalho a partir do início do arquivo.
    pub fn ler(bytes: &[u8]) -> Result<Self, ErroDbf> {
        if bytes.len() < 32 {
            return Err(ErroDbf::Cabecalho("menos de 32 bytes".into()));
        }
        let registros = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
        let tamanho_cabecalho = usize::from(u16::from_le_bytes([bytes[8], bytes[9]]));
        let tamanho_registro = usize::from(u16::from_le_bytes([bytes[10], bytes[11]]));
        if tamanho_cabecalho < 65 || tamanho_registro < 2 {
            return Err(ErroDbf::Cabecalho(format!(
                "cabeçalho de {tamanho_cabecalho} bytes, registro de {tamanho_registro}"
            )));
        }
        if bytes.len() < tamanho_cabecalho {
            return Err(ErroDbf::Cabecalho(format!(
                "o arquivo tem {} bytes e o cabeçalho declara {tamanho_cabecalho}",
                bytes.len()
            )));
        }
        // 32 bytes gerais + 32 por campo + 1 de terminador (que pode não ser 0x0D).
        let maximo = (tamanho_cabecalho - 33) / 32;
        let mut campos = Vec::with_capacity(maximo);
        let mut inicio = 1usize;
        for i in 0..maximo {
            let d = &bytes[32 + 32 * i..64 + 32 * i];
            if d[0] == 0x0D {
                break;
            }
            let fim_nome = d[..11].iter().position(|&b| b == 0).unwrap_or(11);
            let nome = latin1::decodificar(&d[..fim_nome]).trim().to_string();
            if nome.is_empty() {
                return Err(ErroDbf::Cabecalho(format!("campo {} sem nome", i + 1)));
            }
            let tamanho = usize::from(d[16]);
            campos.push(Campo {
                nome,
                tipo: char::from(d[11]),
                tamanho,
                decimais: d[17],
                inicio,
            });
            inicio += tamanho;
        }
        if campos.is_empty() {
            return Err(ErroDbf::Cabecalho("nenhum campo".into()));
        }
        if inicio != tamanho_registro {
            return Err(ErroDbf::Tamanho(format!(
                "os campos somam {inicio} bytes e o registro declara {tamanho_registro}"
            )));
        }
        let terminador_padrao = bytes.get(32 + 32 * campos.len()) == Some(&0x0D);
        Ok(Self {
            campos,
            registros,
            tamanho_cabecalho,
            tamanho_registro,
            terminador_padrao,
        })
    }

    /// Posição de um campo pelo nome (maiúsculas e minúsculas indiferentes).
    pub fn indice(&self, nome: &str) -> Option<usize> {
        self.campos
            .iter()
            .position(|c| c.nome.eq_ignore_ascii_case(nome))
    }
}

/// Um DBF inteiro em memória.
#[derive(Debug)]
pub struct Dbf<'a> {
    pub cabecalho: Cabecalho,
    dados: &'a [u8],
}

impl<'a> Dbf<'a> {
    /// Abre e confere o tamanho: os registros declarados têm de caber no arquivo.
    pub fn abrir(bytes: &'a [u8]) -> Result<Self, ErroDbf> {
        let cabecalho = Cabecalho::ler(bytes)?;
        let dados = &bytes[cabecalho.tamanho_cabecalho..];
        let precisa = cabecalho.registros * cabecalho.tamanho_registro;
        if dados.len() < precisa {
            return Err(ErroDbf::Tamanho(format!(
                "o cabeçalho declara {} registros ({precisa} bytes) e há {} bytes de dados",
                cabecalho.registros,
                dados.len()
            )));
        }
        Ok(Self { cabecalho, dados })
    }

    /// Os registros, na ordem do arquivo. Registros marcados como excluídos (`*`) são pulados.
    pub fn registros(&self) -> impl Iterator<Item = Registro<'_>> {
        let t = self.cabecalho.tamanho_registro;
        (0..self.cabecalho.registros)
            .map(move |i| &self.dados[i * t..(i + 1) * t])
            .filter(|r| r[0] != b'*')
            .map(|bytes| Registro {
                campos: &self.cabecalho.campos,
                bytes,
            })
    }
}

/// Um registro: bytes crus mais o esquema.
#[derive(Debug, Clone, Copy)]
pub struct Registro<'a> {
    campos: &'a [Campo],
    bytes: &'a [u8],
}

impl Registro<'_> {
    /// Texto do campo `i`, sem espaços nas pontas.
    pub fn texto(&self, i: usize) -> String {
        let c = &self.campos[i];
        latin1::decodificar(&self.bytes[c.inicio..c.inicio + c.tamanho])
            .trim()
            .to_string()
    }

    /// Bytes crus do registro (com o marcador de exclusão no byte 0).
    pub fn bytes(&self) -> &[u8] {
        self.bytes
    }
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;

    /// Monta um DBF sintético. `terminador`: o byte depois dos campos (0x0D é o padrão).
    pub(crate) fn montar(
        campos: &[(&str, char, u8)],
        linhas: &[&[&str]],
        terminador: u8,
    ) -> Vec<u8> {
        let tam_reg: usize = 1 + campos.iter().map(|c| usize::from(c.2)).sum::<usize>();
        let tam_cab = 32 + 32 * campos.len() + 1;
        let mut b = vec![0u8; 32];
        b[0] = 3;
        b[4..8].copy_from_slice(&u32::try_from(linhas.len()).unwrap().to_le_bytes());
        b[8..10].copy_from_slice(&u16::try_from(tam_cab).unwrap().to_le_bytes());
        b[10..12].copy_from_slice(&u16::try_from(tam_reg).unwrap().to_le_bytes());
        for (nome, tipo, tam) in campos {
            let mut d = [0u8; 32];
            d[..nome.len()].copy_from_slice(nome.as_bytes());
            d[11] = *tipo as u8;
            d[16] = *tam;
            b.extend_from_slice(&d);
        }
        b.push(terminador);
        for linha in linhas {
            b.push(b' ');
            for (valor, (_, _, tam)) in linha.iter().zip(campos) {
                let v = latin1::codificar(valor).unwrap();
                let mut c = vec![b' '; usize::from(*tam)];
                c[..v.len()].copy_from_slice(&v);
                b.extend_from_slice(&c);
            }
        }
        b.push(0x1A);
        b
    }

    #[test]
    fn le_campos_e_registros() {
        let b = montar(
            &[("CNES", 'C', 7), ("NOME", 'C', 10), ("QT", 'N', 4)],
            &[&["0000001", "Ação", "12"], &["0000002", "B", "3"]],
            0x0D,
        );
        let d = Dbf::abrir(&b).unwrap();
        assert!(d.cabecalho.terminador_padrao);
        assert_eq!(d.cabecalho.campos.len(), 3);
        assert_eq!(d.cabecalho.campos[2].inicio, 18);
        assert_eq!(d.cabecalho.indice("nome"), Some(1));
        let r: Vec<_> = d
            .registros()
            .map(|r| (r.texto(0), r.texto(1), r.texto(2)))
            .collect();
        assert_eq!(r[0], ("0000001".into(), "Ação".into(), "12".into()));
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn tolera_terminador_fora_do_padrao_e_fim_sem_marcador() {
        let mut b = montar(&[("A", 'C', 2)], &[&["xy"]], 0x00);
        b.pop(); // sem 0x1A
        let d = Dbf::abrir(&b).unwrap();
        assert!(!d.cabecalho.terminador_padrao);
        assert_eq!(d.registros().next().unwrap().texto(0), "xy");
    }

    #[test]
    fn pula_excluidos_e_recusa_arquivo_curto_ou_inconsistente() {
        let mut b = montar(&[("A", 'C', 2)], &[&["aa"], &["bb"]], 0x0D);
        let cab = 32 + 32 + 1;
        b[cab] = b'*';
        let d = Dbf::abrir(&b).unwrap();
        assert_eq!(
            d.registros().map(|r| r.texto(0)).collect::<Vec<_>>(),
            ["bb"]
        );
        assert!(matches!(
            Dbf::abrir(&b[..cab + 4]),
            Err(ErroDbf::Tamanho(_))
        ));
        let mut ruim = b.clone();
        ruim[10] = 9; // registro declarado maior que a soma dos campos
        assert!(matches!(Dbf::abrir(&ruim), Err(ErroDbf::Tamanho(_))));
        assert!(matches!(Dbf::abrir(&b[..20]), Err(ErroDbf::Cabecalho(_))));
    }
}
