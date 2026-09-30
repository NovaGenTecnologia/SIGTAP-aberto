//! ISO-8859-1: cada byte é um caractere Unicode de mesmo número. Conversão sem perda nos
//! dois sentidos (os arquivos do SIGTAP usam ISO-8859-1).

/// Bytes ISO-8859-1 para texto.
pub fn decodificar(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

/// Texto para bytes ISO-8859-1. Recusa caractere fora da faixa (acima de U+00FF).
pub fn codificar(texto: &str) -> Option<Vec<u8>> {
    texto
        .chars()
        .map(|c| u8::try_from(u32::from(c)).ok())
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn ida_e_volta_sem_perda_em_todos_os_bytes() {
        let todos: Vec<u8> = (0..=255u8).collect();
        assert_eq!(codificar(&decodificar(&todos)).unwrap(), todos);
        assert_eq!(decodificar(b"A\xe7\xe3o"), "Ação");
    }

    #[test]
    fn recusa_fora_da_faixa() {
        assert!(codificar("€").is_none());
    }
}
