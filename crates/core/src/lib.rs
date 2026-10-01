//! Núcleo do SIGTAP Aberto.
//!
//! Fronteira: competência (AAAAMM) e sua sequência, identificadores SQL seguros e, nas fases
//! seguintes, manifestos. Não lê arquivo nem acessa rede: isso é de `sa-sources` e
//! `sa-download`.

pub mod competencia;
pub mod ident;
pub mod tempo;

pub use competencia::{Competencia, CompetenciaInvalida};
pub use ident::{Ident, IdentInvalido, safe_ident};

/// Versão do programa, igual à do workspace.
pub const VERSAO: &str = env!("CARGO_PKG_VERSION");

/// Repositório do projeto no GitHub (`dono/nome`). Confirme quando o repositório for criado:
/// o atualizador, o botão de feedback e o link de apoio usam este valor.
pub const REPOSITORIO: &str = "NovaGenTecnologia/sigtap-aberto";

/// Site oficial do SIGTAP (DATASUS).
pub const SITE_SIGTAP: &str = "http://sigtap.datasus.gov.br/tabela-unificada/app/sec/inicio.jsp";

#[cfg(test)]
mod testes {
    #[test]
    fn versao_preenchida() {
        assert!(!super::VERSAO.is_empty());
    }
}
