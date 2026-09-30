//! Conversão entre o campo de largura fixa do SIGTAP e o valor guardado no banco.
//!
//! Regras medidas nos 225 ZIPs reais (30/09/2026) e provadas pela reconstrução exata:
//! - texto (VARCHAR2, CHAR, DATE): completado com espaços à direita; guarda-se sem esses
//!   espaços (espaço à esquerda é dado e fica);
//! - NUMBER: só dígitos, completado com zeros à esquerda; guarda-se como inteiro.

use sa_sources::latin1;
use sa_sources::sigtap::{Coluna, Tipo};
use std::fmt;

/// Valor de uma coluna.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Valor {
    Texto(String),
    Inteiro(i64),
}

/// Campo que não segue a regra de preenchimento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CampoForaDaRegra {
    pub coluna: String,
    pub motivo: String,
}

impl fmt::Display for CampoForaDaRegra {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "coluna {}: {}", self.coluna, self.motivo)
    }
}

/// Lê o valor de um campo.
pub fn ler(coluna: &Coluna, campo: &[u8]) -> Result<Valor, CampoForaDaRegra> {
    match coluna.tipo {
        Tipo::Number => {
            if campo.is_empty() || !campo.iter().all(u8::is_ascii_digit) {
                return Err(CampoForaDaRegra {
                    coluna: coluna.nome.como_str().to_string(),
                    motivo: format!(
                        "NUMBER com conteúdo \"{}\" (esperados só dígitos com zeros à esquerda)",
                        latin1::decodificar(campo)
                    ),
                });
            }
            // Até 18 dígitos cabem em i64; o maior NUMBER do SIGTAP tem 12.
            let texto = std::str::from_utf8(campo).unwrap_or("0");
            texto
                .parse::<i64>()
                .map(Valor::Inteiro)
                .map_err(|_| CampoForaDaRegra {
                    coluna: coluna.nome.como_str().to_string(),
                    motivo: format!("NUMBER \"{texto}\" grande demais"),
                })
        }
        Tipo::Varchar2 | Tipo::Char | Tipo::Date => {
            let fim = campo.iter().rposition(|&b| b != b' ').map_or(0, |p| p + 1);
            Ok(Valor::Texto(latin1::decodificar(&campo[..fim])))
        }
    }
}

/// Escreve o valor no formato de largura fixa da coluna.
pub fn escrever(
    coluna: &Coluna,
    valor: &Valor,
    saida: &mut Vec<u8>,
) -> Result<(), CampoForaDaRegra> {
    let erro = |motivo: String| CampoForaDaRegra {
        coluna: coluna.nome.como_str().to_string(),
        motivo,
    };
    match (coluna.tipo, valor) {
        (Tipo::Number, Valor::Inteiro(n)) => {
            let t = n.to_string();
            if *n < 0 || t.len() > coluna.tamanho {
                return Err(erro(format!("{n} não cabe em {} posições", coluna.tamanho)));
            }
            saida.extend(std::iter::repeat_n(b'0', coluna.tamanho - t.len()));
            saida.extend_from_slice(t.as_bytes());
        }
        (Tipo::Varchar2 | Tipo::Char | Tipo::Date, Valor::Texto(s)) => {
            let b =
                latin1::codificar(s).ok_or_else(|| erro("caractere fora do ISO-8859-1".into()))?;
            if b.len() > coluna.tamanho {
                return Err(erro(format!(
                    "texto de {} bytes não cabe em {} posições",
                    b.len(),
                    coluna.tamanho
                )));
            }
            saida.extend_from_slice(&b);
            saida.extend(std::iter::repeat_n(b' ', coluna.tamanho - b.len()));
        }
        (t, v) => {
            return Err(erro(format!(
                "valor {v:?} incompatível com o tipo {}",
                t.como_str()
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use sa_core::safe_ident;

    fn col(tipo: Tipo, tamanho: usize) -> Coluna {
        Coluna {
            nome: safe_ident("c").unwrap(),
            nome_origem: "C".into(),
            tamanho,
            inicio: 1,
            fim: tamanho,
            tipo,
        }
    }

    #[test]
    fn ida_e_volta() {
        let casos: &[(Tipo, &[u8])] = &[
            (Tipo::Varchar2, b"ABC  "),
            (Tipo::Varchar2, b" ABC "), // espaço à esquerda é dado
            (Tipo::Varchar2, b"     "),
            (Tipo::Char, b"A\xe7\xe3o "),
            (Tipo::Number, b"00012"),
            (Tipo::Number, b"00000"),
            (Tipo::Date, b"202609"),
        ];
        for (tipo, campo) in casos {
            let c = col(*tipo, campo.len());
            let v = ler(&c, campo).unwrap();
            let mut s = Vec::new();
            escrever(&c, &v, &mut s).unwrap();
            assert_eq!(&s, campo, "{tipo:?}");
        }
        assert_eq!(
            ler(&col(Tipo::Number, 4), b"0042").unwrap(),
            Valor::Inteiro(42)
        );
    }

    #[test]
    fn largura_nova_nao_muda_o_valor() {
        // VL_SH passou de 10 para 12 posições: o valor guardado é o mesmo.
        assert_eq!(
            ler(&col(Tipo::Number, 10), b"0000002316").unwrap(),
            ler(&col(Tipo::Number, 12), b"000000002316").unwrap()
        );
    }

    #[test]
    fn recusa_fora_da_regra() {
        assert!(ler(&col(Tipo::Number, 4), b"12 3").is_err());
        assert!(ler(&col(Tipo::Number, 4), b"  12").is_err());
        let mut s = Vec::new();
        assert!(escrever(&col(Tipo::Number, 2), &Valor::Inteiro(123), &mut s).is_err());
        assert!(escrever(&col(Tipo::Char, 2), &Valor::Texto("abc".into()), &mut s).is_err());
        assert!(escrever(&col(Tipo::Char, 2), &Valor::Inteiro(1), &mut s).is_err());
    }
}
