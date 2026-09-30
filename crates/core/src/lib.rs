//! Núcleo do SIGTAP Aberto.
//!
//! Fronteira: competência (AAAAMM) e sua sequência, intervalos de vigência
//! (`vig_ini`/`vig_fim`), manifestos (de leiaute, de chaves, de módulos) como dados.
//! Não lê arquivo nem acessa rede: isso é de `sa-sources` e `sa-download`.
//! Conteúdo a partir da Fase 1.

/// Versão do programa, igual à do workspace.
pub const VERSAO: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod testes {
    #[test]
    fn versao_preenchida() {
        assert!(!super::VERSAO.is_empty());
    }
}
