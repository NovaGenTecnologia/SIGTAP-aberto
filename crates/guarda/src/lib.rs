//! Guarda do repositório.
//!
//! Dados oficiais (SIGTAP, CNES, SIA, SIH, TUSS…) nunca são redistribuídos, e arquivos
//! do hospital (com dados de paciente) nunca saem da máquina. Esta guarda examina cada
//! arquivo que o git versionaria e recusa o que parece dado. O teste
//! `tests/repositorio.rs` roda a guarda sobre o repositório real.

use std::path::Path;

/// Tamanho máximo de um arquivo versionado.
pub const TAMANHO_MAXIMO: u64 = 1024 * 1024;

/// Extensões de dados oficiais, bancos e documentos de terceiros.
const EXTENSOES_PROIBIDAS: &[&str] = &[
    "zip",
    "7z",
    "rar",
    "gz",
    "tgz", // pacotes baixados
    "db",
    "sqlite",
    "sqlite3",
    "db-journal",
    "db-wal",
    "db-shm", // bancos gerados
    "dbc",
    "dbf",
    "cnv",
    "def", // DATASUS
    "xls",
    "xlsx",
    "csv",
    "pdf", // planilhas e documentos oficiais
    "bck",
    "fdb",
    "qrp", // exportação do SCNES
    "xml", // TISS com dados de paciente; XSDs de teste entram como .xsd
];

/// Extensões de mês usadas nas remessas do BPA e da APAC (ex.: `PA406882.AGO`).
const EXTENSOES_DE_MES: &[&str] = &[
    "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

/// Início de cabeçalho das remessas conhecidas.
const ASSINATURAS: &[&[u8]] = &[b"01#BPA#", b"01#APAC"];

/// Motivo pelo qual um arquivo não pode ser versionado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Motivo {
    ExtensaoProibida(String),
    RemessaPorNome,
    RemessaPorConteudo,
    Grande(u64),
}

impl std::fmt::Display for Motivo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Motivo::ExtensaoProibida(e) => write!(
                f,
                "extensão .{e} é de dado oficial, banco ou documento de terceiro; mantenha fora do repositório (pasta dados_dev ou modelos)"
            ),
            Motivo::RemessaPorNome => write!(
                f,
                "o nome parece remessa de faturamento (BPA, APAC ou AIH), que contém dados de paciente; nunca versione"
            ),
            Motivo::RemessaPorConteudo => write!(
                f,
                "o conteúdo começa como remessa de BPA ou APAC, que contém dados de paciente; nunca versione"
            ),
            Motivo::Grande(t) => write!(
                f,
                "arquivo de {t} bytes passa do limite de {TAMANHO_MAXIMO}; dado grande não entra no repositório"
            ),
        }
    }
}

/// Examina um arquivo pelo caminho, pelo tamanho e pelos primeiros bytes.
pub fn examinar(caminho: &Path, tamanho: u64, inicio: &[u8]) -> Option<Motivo> {
    let nome = caminho
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let extensao = caminho
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if EXTENSOES_PROIBIDAS.contains(&extensao.as_str()) {
        return Some(Motivo::ExtensaoProibida(extensao));
    }
    if EXTENSOES_DE_MES.contains(&extensao.as_str()) || nome.contains("aih") {
        return Some(Motivo::RemessaPorNome);
    }
    if ASSINATURAS.iter().any(|a| inicio.starts_with(a)) {
        return Some(Motivo::RemessaPorConteudo);
    }
    if tamanho > TAMANHO_MAXIMO {
        return Some(Motivo::Grande(tamanho));
    }
    None
}

#[cfg(test)]
mod testes {
    use super::*;

    fn ex(nome: &str, tamanho: u64, inicio: &[u8]) -> Option<Motivo> {
        examinar(Path::new(nome), tamanho, inicio)
    }

    #[test]
    fn recusa_dado_oficial() {
        assert!(ex("dados/TabelaUnificada_202609_v2609171117.zip", 10, b"PK").is_some());
        assert!(ex("x/sigtap.db", 10, b"").is_some());
        assert!(ex("HBMS2608.dbc", 10, b"").is_some());
        assert!(ex("MOTERRO.DBF", 10, b"").is_some());
        assert!(ex("leiautes/Layout_Exportacao_BPA.pdf", 10, b"%PDF").is_some());
    }

    #[test]
    fn recusa_remessa_por_nome() {
        assert_eq!(ex("PA406882.AGO", 10, b""), Some(Motivo::RemessaPorNome));
        assert_eq!(ex("AP406882.set", 10, b""), Some(Motivo::RemessaPorNome));
        assert_eq!(
            ex("202609AIH0000000.txt", 10, b""),
            Some(Motivo::RemessaPorNome)
        );
    }

    #[test]
    fn recusa_remessa_por_conteudo() {
        assert_eq!(
            ex("qualquer.txt", 10, b"01#BPA#202608"),
            Some(Motivo::RemessaPorConteudo)
        );
        assert_eq!(
            ex("outro.dat", 10, b"01#APAC202608"),
            Some(Motivo::RemessaPorConteudo)
        );
    }

    #[test]
    fn recusa_arquivo_grande() {
        assert_eq!(
            ex("grande.txt", TAMANHO_MAXIMO + 1, b""),
            Some(Motivo::Grande(TAMANHO_MAXIMO + 1))
        );
    }

    #[test]
    fn aceita_codigo_e_documentacao() {
        assert_eq!(ex("crates/core/src/lib.rs", 500, b"//!"), None);
        assert_eq!(ex("README.md", 5000, b"# SIGTAP"), None);
        assert_eq!(ex("crates/app/icons/icon.ico", 20000, b"\0\0\x01\0"), None);
        assert_eq!(ex("Cargo.lock", 200_000, b"#"), None);
    }
}
