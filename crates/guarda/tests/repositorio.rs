//! Roda a guarda sobre todos os arquivos que o git versionaria neste repositório
//! (rastreados e novos não ignorados).

use std::io::Read;
use std::path::PathBuf;
use std::process::Command;

#[test]
fn nenhum_dado_no_repositorio() {
    let raiz = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let saida = Command::new("git")
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .current_dir(&raiz)
        .output()
        .expect("git não encontrado: instale o Git (https://git-scm.com) e rode de novo");
    assert!(
        saida.status.success(),
        "git ls-files falhou: rode dentro do repositório sigtap-aberto"
    );

    let mut problemas = Vec::new();
    for nome in saida.stdout.split(|b| *b == 0).filter(|n| !n.is_empty()) {
        let relativo = PathBuf::from(String::from_utf8_lossy(nome).into_owned());
        let caminho = raiz.join(&relativo);
        let Ok(meta) = std::fs::metadata(&caminho) else {
            continue;
        }; // removido e não commitado
        let mut inicio = [0u8; 16];
        let lidos = std::fs::File::open(&caminho)
            .and_then(|mut f| f.read(&mut inicio))
            .unwrap_or(0);
        if let Some(m) = sa_guarda::examinar(&relativo, meta.len(), &inicio[..lidos]) {
            problemas.push(format!("{}: {m}", relativo.display()));
        }
    }
    assert!(
        problemas.is_empty(),
        "Arquivos que não podem entrar no repositório:\n{}",
        problemas.join("\n")
    );
}
