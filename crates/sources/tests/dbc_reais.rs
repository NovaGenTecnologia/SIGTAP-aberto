//! Prova com arquivos reais do DATASUS (não versionados).
//!
//! `SA_CNES_DBC` = pasta com `.dbc` baixados do FTP oficial; `SA_CNES_ORACULO` = pasta com o
//! `.dbf` que a ferramenta de referência produz para cada um (mesmo nome, extensão `.dbf`).
//! Sem as variáveis, o teste termina sem rodar.

use sa_sources::dbc;
use sa_sources::dbf::Dbf;
use std::path::PathBuf;

#[test]
fn descompressao_identica_ao_oraculo_e_dbf_consistente() {
    let (Ok(dbcs), Ok(oraculo)) = (
        std::env::var("SA_CNES_DBC"),
        std::env::var("SA_CNES_ORACULO"),
    ) else {
        eprintln!("SA_CNES_DBC/SA_CNES_ORACULO não definidas: prova de DBC não executada");
        return;
    };
    let mut arquivos: Vec<PathBuf> = std::fs::read_dir(&dbcs)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("dbc")))
        .collect();
    arquivos.sort();
    assert!(!arquivos.is_empty(), "nenhum .dbc em {dbcs}");
    let (mut fora_do_padrao, mut com_codigo, mut bytes) = (0, 0, 0usize);
    for a in &arquivos {
        let nome = a.file_stem().unwrap().to_string_lossy().into_owned();
        let bruto = std::fs::read(a).unwrap();
        let dbf =
            dbc::para_dbf(&bruto, dbc::LIMITE_PADRAO).unwrap_or_else(|e| panic!("{nome}: {e}"));
        let esperado = std::fs::read(PathBuf::from(&oraculo).join(format!("{nome}.dbf")))
            .unwrap_or_else(|e| panic!("{nome}: sem oráculo ({e})"));
        assert!(
            dbf == esperado,
            "{nome}: difere do oráculo ({} x {} bytes)",
            dbf.len(),
            esperado.len()
        );
        let d = Dbf::abrir(&dbf).unwrap_or_else(|e| panic!("{nome}: {e}"));
        assert_eq!(
            d.registros().count(),
            d.cabecalho.registros,
            "{nome}: registros"
        );
        let soma: usize = d.cabecalho.campos.iter().map(|c| c.tamanho).sum();
        assert_eq!(soma + 1, d.cabecalho.tamanho_registro, "{nome}: campos");
        fora_do_padrao += usize::from(!d.cabecalho.terminador_padrao);
        com_codigo += usize::from(bruto[d.cabecalho.tamanho_cabecalho + 4] == 1);
        bytes += dbf.len();
    }
    eprintln!(
        "{} arquivos idênticos ao oráculo, {bytes} bytes; {fora_do_padrao} com cabeçalho fora do padrão; {com_codigo} com literais codificados",
        arquivos.len()
    );
}
