//! Verificação de integridade dos bancos SQLite e quarentena de bancos danificados.
//!
//! A verificação abre o arquivo só para leitura: não cria nem altera nada. Um banco danificado
//! nunca é apagado: vai para uma pasta de quarentena, para o usuário ou o projeto examinarem.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Resultado da verificação de um banco.
#[derive(Debug, Clone, Serialize)]
pub struct Verificacao {
    /// O banco passou na verificação.
    pub ok: bool,
    /// O arquivo está danificado (não abre como SQLite ou a verificação achou erro).
    /// `false` com `ok = false` significa que a verificação não pôde rodar (ex.: arquivo em uso).
    pub danificado: bool,
    /// O que a verificação encontrou, em português; no máximo 10 linhas.
    pub mensagens: Vec<String>,
}

/// Erro do SQLite que indica arquivo danificado ou que não é um banco.
pub fn erro_de_corrupcao(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase)
    )
}

/// Verifica o banco. `completo` roda `integrity_check` (confere também índices e conteúdo);
/// senão roda `quick_check`, mais rápido (cerca de 1 s para 100 MB).
pub fn verificar(caminho: &Path, completo: bool) -> Verificacao {
    let conn = match Connection::open_with_flags(
        caminho,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(e) => return falha(&e, "abrir o arquivo"),
    };
    let _ = conn.busy_timeout(std::time::Duration::from_secs(30));
    let pragma = if completo {
        "PRAGMA integrity_check(10)"
    } else {
        "PRAGMA quick_check(10)"
    };
    let linhas: Result<Vec<String>, rusqlite::Error> = (|| {
        let mut st = conn.prepare(pragma)?;
        st.query_map([], |r| r.get::<_, String>(0))?.collect()
    })();
    match linhas {
        Ok(l) if l.len() == 1 && l[0] == "ok" => Verificacao {
            ok: true,
            danificado: false,
            mensagens: vec![],
        },
        Ok(l) => Verificacao {
            ok: false,
            danificado: true,
            mensagens: l.into_iter().take(10).collect(),
        },
        Err(e) => falha(&e, "verificar o conteúdo"),
    }
}

fn falha(e: &rusqlite::Error, etapa: &str) -> Verificacao {
    let danificado = erro_de_corrupcao(e);
    Verificacao {
        ok: false,
        danificado,
        mensagens: vec![if danificado {
            format!("o arquivo está danificado ou não é um banco SQLite (ao {etapa}: {e})")
        } else {
            format!(
                "não foi possível {etapa} ({e}). Feche outros programas que usem o arquivo e tente de novo"
            )
        }],
    }
}

/// Como a versão do esquema gravada num banco se compara com a que este programa usa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Compatibilidade {
    /// O banco não diz a versão (vazio ou sem `sa_info`): o programa grava a dele ao abrir.
    SemVersao,
    /// Mesma versão: usa como está.
    Igual,
    /// Gravado por uma versão anterior do programa: precisa ser refeito a partir dos arquivos oficiais.
    Anterior(String),
    /// Gravado por uma versão mais nova do programa: não mexer; o usuário deve atualizar o programa.
    MaisNova(String),
}

/// Lê `sa_info.versao_esquema` sem alterar o arquivo. `Ok(None)` se o banco não tem essa informação.
pub fn versao_esquema(caminho: &Path) -> Result<Option<String>, String> {
    let conn = Connection::open_with_flags(caminho, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("não foi possível abrir {} ({e})", caminho.display()))?;
    let tem: bool = conn
        .query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'sa_info'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("não foi possível ler {} ({e})", caminho.display()))?;
    if !tem {
        return Ok(None);
    }
    conn.query_row(
        "SELECT valor FROM sa_info WHERE chave = 'versao_esquema'",
        [],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("não foi possível ler {} ({e})", caminho.display()))
}

/// Compara a versão gravada com a atual (números inteiros; texto que não é número conta como anterior).
pub fn compatibilidade(gravada: Option<&str>, atual: &str) -> Compatibilidade {
    let Some(g) = gravada else {
        return Compatibilidade::SemVersao;
    };
    if g == atual {
        return Compatibilidade::Igual;
    }
    match (g.trim().parse::<u32>(), atual.trim().parse::<u32>()) {
        (Ok(a), Ok(b)) if a > b => Compatibilidade::MaisNova(g.to_string()),
        _ => Compatibilidade::Anterior(g.to_string()),
    }
}

/// Move o banco (e os arquivos auxiliares `-wal`, `-shm`, `-journal`) para uma pasta nova
/// `<dados>/banco_com_problema_N`, junto de um `LEIAME.txt` com o motivo. Devolve a pasta.
/// Nada é apagado.
pub fn por_em_quarentena(
    caminho: &Path,
    pasta_dados: &Path,
    motivo: &str,
) -> Result<PathBuf, String> {
    guardar_em_pasta(
        caminho,
        pasta_dados,
        "banco_com_problema",
        &format!(
            "Este banco foi guardado aqui pelo SIGTAP Aberto e não está mais em uso.\r\nMotivo: {motivo}\r\n\
             O programa refez o banco a partir dos arquivos oficiais. Se o problema se repetir, \
             envie esta pasta ao projeto (ela não contém dados de paciente) ou apague-a para liberar espaço.\r\n"
        ),
    )
}

/// Move o banco (e `-wal`, `-shm`, `-journal`) para uma pasta nova `<dados>/<prefixo>_N`, com um
/// `LEIAME.txt`. Devolve a pasta. Nada é apagado.
pub fn guardar_em_pasta(
    caminho: &Path,
    pasta_dados: &Path,
    prefixo: &str,
    leiame: &str,
) -> Result<PathBuf, String> {
    let mut n = 1;
    let destino = loop {
        let d = pasta_dados.join(format!("{prefixo}_{n}"));
        if !d.exists() {
            break d;
        }
        n += 1;
    };
    std::fs::create_dir_all(&destino)
        .map_err(|e| format!("não foi possível criar {} ({e})", destino.display()))?;
    let nome = caminho
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or("caminho de banco inválido")?;
    for sufixo in ["", "-wal", "-shm", "-journal"] {
        let origem = PathBuf::from(format!("{}{sufixo}", caminho.display()));
        if origem.exists() {
            let alvo = destino.join(format!("{nome}{sufixo}"));
            std::fs::rename(&origem, &alvo).map_err(|e| {
                format!(
                    "não foi possível mover {} para {} ({e}). Feche o programa, mova o arquivo à mão e abra de novo",
                    origem.display(),
                    alvo.display()
                )
            })?;
        }
    }
    let _ = std::fs::write(destino.join("LEIAME.txt"), leiame);
    Ok(destino)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn compara_versoes_do_esquema() {
        assert_eq!(compatibilidade(None, "2"), Compatibilidade::SemVersao);
        assert_eq!(compatibilidade(Some("2"), "2"), Compatibilidade::Igual);
        assert_eq!(
            compatibilidade(Some("1"), "2"),
            Compatibilidade::Anterior("1".into())
        );
        assert_eq!(
            compatibilidade(Some("3"), "2"),
            Compatibilidade::MaisNova("3".into())
        );
        assert_eq!(
            compatibilidade(Some("x"), "2"),
            Compatibilidade::Anterior("x".into())
        );
    }

    #[test]
    fn le_a_versao_sem_alterar_o_banco() {
        let d = pasta("versao");
        let vazio = d.join("vazio.db");
        Connection::open(&vazio)
            .unwrap()
            .execute_batch("CREATE TABLE t(x)")
            .unwrap();
        assert_eq!(versao_esquema(&vazio).unwrap(), None);
        let com = d.join("com.db");
        Connection::open(&com)
            .unwrap()
            .execute_batch("CREATE TABLE sa_info(chave TEXT PRIMARY KEY, valor TEXT); INSERT INTO sa_info VALUES('versao_esquema','7')")
            .unwrap();
        let antes = std::fs::read(&com).unwrap();
        assert_eq!(versao_esquema(&com).unwrap().as_deref(), Some("7"));
        assert_eq!(std::fs::read(&com).unwrap(), antes);
        let _ = std::fs::remove_dir_all(&d);
    }

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("sa_saude_{nome}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn banco_com_dados(p: &Path) {
        let mut c = Connection::open(p).unwrap();
        c.execute_batch("CREATE TABLE t(id INTEGER PRIMARY KEY, x TEXT); CREATE INDEX i ON t(x);")
            .unwrap();
        let c = c.transaction().unwrap();
        for i in 0..20000 {
            c.execute(
                "INSERT INTO t(x) VALUES (?1)",
                [format!("linha {i} {}", "z".repeat(60))],
            )
            .unwrap();
        }
        c.commit().unwrap();
    }

    #[test]
    fn banco_sao_passa_nas_duas_verificacoes() {
        let d = pasta("sao");
        let p = d.join("a.db");
        banco_com_dados(&p);
        assert!(verificar(&p, false).ok);
        assert!(verificar(&p, true).ok);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn arquivo_que_nao_e_banco_e_danificado() {
        let d = pasta("lixo");
        let p = d.join("a.db");
        std::fs::write(&p, vec![0x41u8; 8192]).unwrap();
        let v = verificar(&p, false);
        assert!(!v.ok && v.danificado, "{v:?}");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn paginas_do_meio_estragadas_sao_achadas_e_vao_para_quarentena() {
        let d = pasta("meio");
        let p = d.join("a.db");
        banco_com_dados(&p);
        let mut b = std::fs::read(&p).unwrap();
        assert!(b.len() > 200_000);
        // Estraga um trecho do meio (páginas de dados e de índice), mantendo o cabeçalho.
        for x in &mut b[100_000..130_000] {
            *x = 0xFF;
        }
        std::fs::write(&p, &b).unwrap();
        let v = verificar(&p, true);
        assert!(!v.ok && v.danificado, "{v:?}");
        assert!(!v.mensagens.is_empty());
        let q = por_em_quarentena(&p, &d, "teste").unwrap();
        assert!(!p.exists());
        assert!(q.join("a.db").exists() && q.join("LEIAME.txt").exists());
        // Segunda quarentena usa outra pasta e não sobrescreve a primeira.
        banco_com_dados(&p);
        let q2 = por_em_quarentena(&p, &d, "teste").unwrap();
        assert_ne!(q, q2);
        assert!(q.join("a.db").exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn arquivo_inexistente_nao_e_tratado_como_danificado() {
        let d = pasta("falta");
        let v = verificar(&d.join("nao_existe.db"), false);
        assert!(!v.ok && !v.danificado, "{v:?}");
        let _ = std::fs::remove_dir_all(d);
    }
}
