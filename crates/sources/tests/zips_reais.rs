//! Leitura de todos os ZIPs reais do SIGTAP de uma pasta.
//! Roda só com `SA_SIGTAP_ZIPS=<pasta com TabelaUnificada_*.zip>` (dados fora do repositório).

use sa_sources::sigtap::ZipSigtap;

#[test]
fn le_todos_os_zips_reais() {
    let Ok(pasta) = std::env::var("SA_SIGTAP_ZIPS") else {
        eprintln!("SA_SIGTAP_ZIPS não definida: teste com dados reais não executado");
        return;
    };
    let mut zips: Vec<_> = std::fs::read_dir(&pasta)
        .expect("pasta de SA_SIGTAP_ZIPS não encontrada")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "zip"))
        .collect();
    zips.sort();
    assert!(!zips.is_empty(), "nenhum ZIP em {pasta}");
    let (mut arquivos, mut registros) = (0usize, 0usize);
    for p in &zips {
        let mut z = ZipSigtap::abrir(p).unwrap_or_else(|e| panic!("{e}"));
        for t in z.tabelas() {
            let lida = z.ler_tabela(&t).unwrap_or_else(|e| panic!("{e}"));
            arquivos += 1;
            registros += lida.quantidade();
        }
    }
    eprintln!(
        "{} ZIPs, {arquivos} arquivos de tabela, {registros} registros lidos",
        zips.len()
    );
}
