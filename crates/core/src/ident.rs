//! Identificadores SQL vindos de dados (nomes de tabela e de coluna lidos de leiautes).
//!
//! Regra: só letras ASCII, dígitos e `_`, começando por letra, até 63 caracteres. Tudo o que
//! vem de arquivo passa por aqui antes de virar nome no banco; valores nunca são concatenados
//! em SQL (sempre parâmetros).

use std::fmt;

/// Identificador SQL validado.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Ident(String);

/// Nome recusado como identificador.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentInvalido(pub String);

impl fmt::Display for IdentInvalido {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "nome \"{}\" não pode virar identificador no banco (só letras, dígitos e _, começando por letra, até 63 caracteres). \
             O arquivo de origem pode estar corrompido ou ter mudado de formato: confira a fonte oficial",
            self.0.chars().take(80).collect::<String>()
        )
    }
}

impl std::error::Error for IdentInvalido {}

/// Valida um identificador vindo de dados. Converte para minúsculas.
pub fn safe_ident(nome: &str) -> Result<Ident, IdentInvalido> {
    let ok = !nome.is_empty()
        && nome.len() <= 63
        && nome.as_bytes()[0].is_ascii_alphabetic()
        && nome.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if ok {
        Ok(Ident(nome.to_ascii_lowercase()))
    } else {
        Err(IdentInvalido(nome.to_string()))
    }
}

impl Ident {
    pub fn como_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Ident {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Sempre entre aspas duplas no SQL gerado; o conteúdo já foi validado.
        write!(f, "\"{}\"", self.0)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn aceita_nomes_do_sigtap() {
        assert_eq!(
            safe_ident("CO_PROCEDIMENTO").unwrap().como_str(),
            "co_procedimento"
        );
        assert_eq!(
            safe_ident("rl_procedimento_cid").unwrap().to_string(),
            "\"rl_procedimento_cid\""
        );
    }

    #[test]
    fn recusa_nomes_perigosos() {
        for n in [
            "",
            "1col",
            "a b",
            "x\"; DROP TABLE t; --",
            "REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL)",
            "col-a",
            "ção",
            &"a".repeat(64),
        ] {
            assert!(safe_ident(n).is_err(), "{n}");
        }
    }
}
