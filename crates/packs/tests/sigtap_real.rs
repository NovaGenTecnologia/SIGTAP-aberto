//! Provas com os ZIPs reais do SIGTAP (dados fora do repositório).
//!
//! Roda só com `SA_SIGTAP_ZIPS=<pasta com TabelaUnificada_*.zip>`; use `--release`.
//! `SA_SIGTAP_BANCO=<arquivo>` guarda o banco da carga completa (senão fica na pasta
//! temporária). Os testes imprimem as medidas usadas no fechamento da fase.

use sa_packs::sigtap::BancoSigtap;
use sa_sources::sigtap::ZipSigtap;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

fn zips() -> Option<Vec<PathBuf>> {
    let pasta = std::env::var("SA_SIGTAP_ZIPS").ok()?;
    let mut v: Vec<PathBuf> = std::fs::read_dir(&pasta)
        .expect("pasta de SA_SIGTAP_ZIPS não encontrada")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("TabelaUnificada_"))
        })
        .collect();
    v.sort();
    Some(v)
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

fn temp(nome: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("sa-real-{nome}-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&p);
    p
}

/// Confere todas as tabelas e leiautes de um ZIP contra o banco. Devolve (arquivos, bytes).
fn conferir_zip(b: &BancoSigtap, zip: &Path) -> (usize, usize) {
    let mut z = ZipSigtap::abrir(zip).unwrap();
    let comp = z.nome.competencia;
    let tabelas = z.tabelas();
    let mut no_banco = b.tabelas(comp).unwrap();
    no_banco.sort();
    let mut esperadas: Vec<String> = tabelas.iter().map(|t| t.to_ascii_lowercase()).collect();
    esperadas.sort();
    assert_eq!(no_banco, esperadas, "tabelas de {comp}");
    let (mut n, mut bytes) = (0, 0);
    for t in &tabelas {
        let lida = z.ler_tabela(t).unwrap();
        let rec = b
            .exportar_tabela(comp, &t.to_ascii_lowercase())
            .unwrap()
            .unwrap();
        assert!(
            sha(&rec) == sha(&lida.dados),
            "{t} em {comp}: reconstrução difere do original"
        );
        n += 1;
        bytes += rec.len();
    }
    (n, bytes)
}

#[test]
fn carga_completa_e_reconstrucao_exata() {
    let Some(zips) = zips() else {
        eprintln!("SA_SIGTAP_ZIPS não definida: prova com dados reais não executada");
        return;
    };
    let caminho = std::env::var("SA_SIGTAP_BANCO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| temp("completo"));
    let _ = std::fs::remove_file(&caminho);
    let mut b = BancoSigtap::abrir(&caminho).unwrap();
    let t0 = Instant::now();
    let mut registros = 0;
    for p in &zips {
        registros += b.carregar_zip(p).unwrap().registros;
    }
    let carga = t0.elapsed();
    let t1 = Instant::now();
    let (mut arquivos, mut bytes, mut leiautes) = (0, 0, 0);
    for p in &zips {
        let (n, by) = conferir_zip(&b, p);
        arquivos += n;
        bytes += by;
        // Leiautes reconstruídos idênticos aos originais.
        let mut z = sa_sources::zip_seguro::ZipSeguro::abrir(p, Default::default()).unwrap();
        let comp = sa_sources::sigtap::interpretar_nome(&p.file_name().unwrap().to_string_lossy())
            .unwrap()
            .competencia;
        for nome in z.nomes().to_vec() {
            if let Some(t) = nome.strip_suffix("_layout.txt") {
                let orig = z.ler(&nome).unwrap();
                let rec = b
                    .exportar_leiaute(comp, &t.to_ascii_lowercase())
                    .unwrap()
                    .unwrap();
                assert!(rec == orig, "{nome} em {comp}: leiaute reconstruído difere");
                leiautes += 1;
            }
        }
    }
    let conferencia = t1.elapsed();
    let (conteudos, intervalos) = b.contagens().unwrap();
    let tamanho = std::fs::metadata(&caminho).map(|m| m.len()).unwrap_or(0);
    let resumo = b.resumo_logico().unwrap();
    eprintln!(
        "PROVA carga completa: {} competências, {registros} registros em {:.1} s; banco {:.1} MB; \
         {conteudos} conteúdos, {intervalos} intervalos",
        zips.len(),
        carga.as_secs_f64(),
        tamanho as f64 / 1e6
    );
    eprintln!(
        "PROVA reconstrução: {arquivos} arquivos de tabela ({:.1} MB) e {leiautes} leiautes idênticos byte a byte, em {:.1} s",
        bytes as f64 / 1e6,
        conferencia.as_secs_f64()
    );
    eprintln!("PROVA resumo lógico do banco completo: {resumo}");
    std::fs::write(caminho.with_extension("resumo"), &resumo).unwrap();
}

#[test]
fn retroativo_e_incremental_dao_o_mesmo_banco() {
    let Some(zips) = zips() else { return };
    let n = zips.len();
    assert!(n >= 4, "precisa de pelo menos 4 ZIPs");
    // A: carga em ordem.
    let mut a = BancoSigtap::abrir(&temp("ordem")).unwrap();
    for p in &zips {
        a.carregar_zip(p).unwrap();
    }
    let ra = a.resumo_logico().unwrap();
    // B: incremental = tudo menos a última, depois a última.
    // C: retroativo = tudo menos uma do meio e a primeira, depois as duas fora de ordem.
    let meio = n / 2;
    let mut c = BancoSigtap::abrir(&temp("retro")).unwrap();
    for (i, p) in zips.iter().enumerate() {
        if i != meio && i != 0 {
            c.carregar_zip(p).unwrap();
        }
    }
    let t = Instant::now();
    c.carregar_zip(&zips[meio]).unwrap();
    let t_meio = t.elapsed();
    let t = Instant::now();
    c.carregar_zip(&zips[0]).unwrap();
    let t_primeira = t.elapsed();
    let rc = c.resumo_logico().unwrap();
    eprintln!(
        "PROVA retroativo: {} (meio, {:.1} s) e {} (primeira, {:.1} s) carregadas por último",
        zips[meio].file_name().unwrap().to_string_lossy(),
        t_meio.as_secs_f64(),
        zips[0].file_name().unwrap().to_string_lossy(),
        t_primeira.as_secs_f64()
    );
    assert_eq!(rc, ra, "retroativo difere da carga em ordem");
    // Remover a do meio e recarregar também volta ao mesmo banco.
    c.remover(
        sa_sources::sigtap::interpretar_nome(&zips[meio].file_name().unwrap().to_string_lossy())
            .unwrap()
            .competencia,
    )
    .unwrap();
    c.carregar_zip(&zips[meio]).unwrap();
    assert_eq!(
        c.resumo_logico().unwrap(),
        ra,
        "remover e recarregar difere"
    );
    eprintln!(
        "PROVA incremental/retroativo/remoção: resumo lógico igual ao da carga em ordem ({ra})"
    );
}

#[test]
fn republicacao_derivada_de_zip_real() {
    let Some(zips) = zips() else { return };
    let ultimo = zips.last().unwrap().clone();
    let mut b = BancoSigtap::abrir(&temp("repub")).unwrap();
    for p in &zips[zips.len() - 3..] {
        b.carregar_zip(p).unwrap();
    }
    let original = b.resumo_logico().unwrap();
    let penultimo = &zips[zips.len() - 2];
    // Deriva uma "republicação" do penúltimo: tira o primeiro registro de cada tabela não vazia.
    let nome = penultimo
        .file_name()
        .unwrap()
        .to_string_lossy()
        .replace("_v", "_v9");
    let nome = nome.split("_v9").next().unwrap().to_string() + "_v9912312359.zip";
    let dir = std::env::temp_dir().join(format!("sa-real-repub-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let novo = dir.join(&nome);
    let mut z = sa_sources::zip_seguro::ZipSeguro::abrir(penultimo, Default::default()).unwrap();
    let mut w = zip::ZipWriter::new(std::fs::File::create(&novo).unwrap());
    let mut sz = ZipSigtap::abrir(penultimo).unwrap();
    for n in z.nomes().to_vec() {
        let mut conteudo = z.ler(&n).unwrap();
        if let Some(t) = n
            .strip_suffix(".txt")
            .filter(|t| !t.ends_with("_layout") && sz.tabelas().contains(&t.to_string()))
        {
            let l = sz.ler_tabela(t).unwrap();
            let passo = l.leiaute.largura + 2;
            if conteudo.len() >= passo {
                conteudo.drain(..passo);
            }
        }
        w.start_file(&n, zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(&conteudo).unwrap();
    }
    w.finish().unwrap();
    let r = b.carregar_zip(&novo).unwrap();
    assert!(r.substituiu);
    let (arquivos, _) = conferir_zip(&b, &novo);
    conferir_zip(&b, &ultimo);
    conferir_zip(&b, &zips[zips.len() - 3]);
    b.carregar_zip(penultimo).unwrap();
    assert_eq!(b.resumo_logico().unwrap(), original);
    eprintln!(
        "PROVA republicação: {} com o 1º registro de cada tabela removido; {arquivos} tabelas conferidas; vizinhas intactas; recarga do original volta ao banco anterior",
        nome
    );
}

/// E11: cada chave natural do manifesto é única em todas as competências do banco completo.
/// Usa o banco de `SA_SIGTAP_BANCO` (gerado por `carga_completa_e_reconstrucao_exata`).
#[test]
fn chaves_naturais_unicas() {
    let Ok(caminho) = std::env::var("SA_SIGTAP_BANCO_PRONTO") else {
        eprintln!("SA_SIGTAP_BANCO_PRONTO não definida: conferência de chaves não executada");
        return;
    };
    let b = BancoSigtap::abrir(Path::new(&caminho)).unwrap();
    let con = b.conexao();
    let comps = b.competencias().unwrap();
    let (mut conferidas, mut sem_chave) = (0, 0);
    for (tabela, chave) in sa_sources::sigtap::chaves_naturais() {
        if chave.is_empty() {
            sem_chave += 1;
            continue;
        }
        let t = sa_core::safe_ident(&tabela).unwrap();
        let v = sa_core::safe_ident(&format!("{tabela}__vig")).unwrap();
        let cols: Vec<String> = chave
            .iter()
            .map(|c| sa_core::safe_ident(c).unwrap().to_string())
            .collect();
        let lista = cols
            .iter()
            .map(|c| format!("c.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT count(*) FROM (SELECT {lista}, sum(c.sa_qtd) AS n FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 GROUP BY {lista} HAVING n > 1)"
        );
        for c in &comps {
            let presente: i64 = con
                .query_row(
                    "SELECT count(*) FROM sa_tabela WHERE seq = ?1 AND tabela = ?2",
                    rusqlite::params![c.competencia.seq(), tabela],
                    |r| r.get(0),
                )
                .unwrap();
            if presente == 0 {
                continue;
            }
            let repetidas: i64 = con
                .query_row(&sql, [c.competencia.seq()], |r| r.get(0))
                .unwrap();
            assert_eq!(
                repetidas, 0,
                "{tabela}: chave {chave:?} repetida em {}",
                c.competencia
            );
            conferidas += 1;
        }
    }
    eprintln!(
        "PROVA chaves naturais: {conferidas} pares (tabela, competência) sem repetição; {sem_chave} tabela(s) sem chave natural"
    );
}

/// E01 (Fase 2): todo código presente no banco completo, nas colunas com domínio no manifesto,
/// tem descrição oficial ou está listado como "sem descrição na fonte".
#[test]
fn dominios_cobrem_o_banco() {
    let Ok(caminho) = std::env::var("SA_SIGTAP_BANCO_PRONTO") else {
        eprintln!("SA_SIGTAP_BANCO_PRONTO não definida: conferência de domínios não executada");
        return;
    };
    let b = BancoSigtap::abrir(Path::new(&caminho)).unwrap();
    let con = b.conexao();
    let d = sa_sources::sigtap::dominios::Dominios::carregar();
    let (mut oficiais, mut sem) = (0, Vec::new());
    for tc in d
        .colunas_com_dominio()
        .map(String::from)
        .collect::<Vec<_>>()
    {
        let (tabela, coluna) = tc.split_once('.').unwrap();
        let t = sa_core::safe_ident(tabela).unwrap();
        let c = sa_core::safe_ident(coluna).unwrap();
        let sql = format!("SELECT DISTINCT {c} FROM {t} WHERE {c} IS NOT NULL");
        let mut st = con.prepare(&sql).unwrap();
        let valores: Vec<String> = st
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for v in valores {
            match d.descrever(tabela, coluna, &v).unwrap() {
                sa_sources::sigtap::dominios::Descricao::Oficial(_) => oficiais += 1,
                sa_sources::sigtap::dominios::Descricao::SemDescricao(_) => {
                    sem.push(format!("{tc}={v}"))
                }
                sa_sources::sigtap::dominios::Descricao::Desconhecido => {
                    panic!("{tc}: código '{v}' sem descrição e fora da lista sem_descricao")
                }
            }
        }
    }
    eprintln!(
        "PROVA domínios: {oficiais} códigos com descrição oficial; sem descrição na fonte: {}",
        sem.join(", ")
    );
}
