//! Atualização do próprio programa pelos lançamentos (Releases) do GitHub.
//!
//! Fluxo: consultar o último lançamento → comparar com a versão em uso → (a pedido do
//! usuário) baixar o ZIP, conferir o SHA-256 publicado junto, extrair o `.exe` e trocá-lo
//! no lugar do atual. O Windows permite renomear um executável em uso, então o `.exe` atual
//! vira `<nome>.antigo.exe` e o novo ocupa o nome original; o programa então abre o novo.
//! O `.antigo.exe` é apagado na abertura seguinte. Tudo fica na pasta do programa.
//!
//! Limite que o usuário deve conhecer: o SHA-256 vem do mesmo lançamento do ZIP. Ele prova
//! que o arquivo chegou inteiro, não que o lançamento é legítimo (o executável não é
//! assinado digitalmente).

use crate::http::{ErroHttp, Http};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

/// Tamanho máximo aceito para o ZIP e para o executável extraído.
const LIMITE_ZIP: u64 = 150 * 1024 * 1024;
const LIMITE_EXE: u64 = 300 * 1024 * 1024;

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Versão `X.Y.Z` (sem sufixo de pré-lançamento).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Versao(pub u32, pub u32, pub u32);

impl Versao {
    /// Aceita `1.2.3` e `v1.2.3`. Pré-lançamentos (`1.2.3-beta`) são recusados: o programa
    /// não se atualiza para eles.
    pub fn de_texto(t: &str) -> Option<Self> {
        let t = t.trim().trim_start_matches(['v', 'V']);
        let mut it = t.split('.');
        let v = Versao(
            it.next()?.parse().ok()?,
            it.next()?.parse().ok()?,
            it.next()?.parse().ok()?,
        );
        it.next().is_none().then_some(v)
    }
}

impl std::fmt::Display for Versao {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

/// Lançamento publicado.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Lancamento {
    pub versao: String,
    /// Texto do lançamento (notas), como publicado.
    pub notas: String,
    /// Página do lançamento no GitHub.
    pub pagina: String,
    pub zip_nome: String,
    pub zip_url: String,
    pub zip_tamanho: u64,
    /// Endereço do arquivo com o SHA-256 (`<zip>.sha256` ou `SHA256SUMS.txt`).
    pub soma_url: String,
}

/// Erro do atualizador, com orientação.
#[derive(Debug)]
pub enum ErroAtualizacao {
    Http(ErroHttp),
    Formato(String),
    Seguranca(String),
    Arquivo(String),
}

impl std::fmt::Display for ErroAtualizacao {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroAtualizacao::Http(e) => write!(f, "{e}"),
            ErroAtualizacao::Formato(m) | ErroAtualizacao::Arquivo(m) => write!(f, "{m}"),
            ErroAtualizacao::Seguranca(m) => write!(f, "{m}. Nada foi trocado"),
        }
    }
}

impl From<ErroHttp> for ErroAtualizacao {
    fn from(e: ErroHttp) -> Self {
        ErroAtualizacao::Http(e)
    }
}

/// Só endereços do GitHub, por HTTPS, entram no download.
fn url_do_github(url: &str, repo: &str) -> bool {
    url.starts_with(&format!("https://github.com/{repo}/releases/download/"))
}

/// Final do nome do pacote desta compilação no lançamento (`SIGTAP-Aberto-vX.Y.Z<sufixo>`).
/// Cada arquitetura baixa o seu: um .exe ARM64 não troca por um x64, nem o contrário.
pub const SUFIXO_PACOTE: &str = if cfg!(target_arch = "aarch64") {
    "-windows-arm64.zip"
} else if cfg!(target_arch = "x86") {
    "-windows-x86.zip"
} else {
    "-windows-x64.zip"
};

/// Lê a resposta de `releases/latest`. `Ok(None)`: rascunho, pré-lançamento ou sem o pacote
/// desta arquitetura ([`SUFIXO_PACOTE`]).
pub fn interpretar(json: &[u8], repo: &str) -> Result<Option<Lancamento>, ErroAtualizacao> {
    interpretar_para(json, repo, SUFIXO_PACOTE)
}

/// Como [`interpretar`], escolhendo o pacote cujo nome termina em `sufixo`.
pub fn interpretar_para(
    json: &[u8],
    repo: &str,
    sufixo: &str,
) -> Result<Option<Lancamento>, ErroAtualizacao> {
    let v: serde_json::Value = serde_json::from_slice(json)
        .map_err(|e| ErroAtualizacao::Formato(format!("a resposta do GitHub não é JSON ({e})")))?;
    let texto =
        |x: &serde_json::Value, k: &str| x.get(k).and_then(|y| y.as_str()).map(String::from);
    if v.get("draft").and_then(|x| x.as_bool()) == Some(true)
        || v.get("prerelease").and_then(|x| x.as_bool()) == Some(true)
    {
        return Ok(None);
    }
    let tag = texto(&v, "tag_name")
        .ok_or_else(|| ErroAtualizacao::Formato("o lançamento não tem 'tag_name'".into()))?;
    let Some(versao) = Versao::de_texto(&tag) else {
        return Ok(None);
    };
    let assets = v
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    let acha = |pred: &dyn Fn(&str) -> bool| {
        assets.iter().find_map(|a| {
            let nome = texto(a, "name")?;
            pred(&nome).then(|| {
                (
                    nome,
                    texto(a, "browser_download_url").unwrap_or_default(),
                    a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
                )
            })
        })
    };
    let Some((zip_nome, zip_url, zip_tamanho)) = acha(&|n| n.to_lowercase().ends_with(sufixo))
    else {
        return Ok(None);
    };
    let soma =
        acha(&|n| n == format!("{zip_nome}.sha256")).or_else(|| acha(&|n| n == "SHA256SUMS.txt"));
    let Some((_, soma_url, _)) = soma else {
        return Ok(None);
    };
    for u in [&zip_url, &soma_url] {
        if !url_do_github(u, repo) {
            return Err(ErroAtualizacao::Seguranca(format!(
                "o lançamento aponta para um endereço fora de github.com/{repo} ({u})"
            )));
        }
    }
    Ok(Some(Lancamento {
        versao: versao.to_string(),
        notas: texto(&v, "body").unwrap_or_default(),
        pagina: texto(&v, "html_url").unwrap_or_default(),
        zip_nome,
        zip_url,
        zip_tamanho,
        soma_url,
    }))
}

/// Consulta o último lançamento. `Ok(None)`: nenhum lançamento utilizável (inclui repositório
/// privado ou ainda sem lançamentos, que o GitHub responde com 404).
pub fn consultar(repo: &str, cancelar: &AtomicBool) -> Result<Option<Lancamento>, ErroAtualizacao> {
    let http = Http::novo(crate::cortesia::Cortesia::default()).com_limite(8 * 1024 * 1024);
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    match http.obter(&url, cancelar, &mut |_| {}) {
        Ok(corpo) => interpretar(&corpo, repo),
        Err(ErroHttp::Status { codigo: 404, .. }) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// `true` se `nova` é maior que `atual`.
pub fn e_mais_nova(atual: &str, nova: &str) -> bool {
    match (Versao::de_texto(atual), Versao::de_texto(nova)) {
        (Some(a), Some(n)) => n.cmp(&a) == Ordering::Greater,
        _ => false,
    }
}

/// SHA-256 esperado, de um texto `sha256sum` (`<hex>  <nome>`) ou só do hash.
pub fn hash_esperado(texto: &str, zip_nome: &str) -> Option<String> {
    let hex = |t: &str| {
        (t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit())).then(|| t.to_lowercase())
    };
    let linhas: Vec<&str> = texto
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if linhas.len() == 1
        && let Some(h) = linhas[0].split_whitespace().next().and_then(hex)
        && linhas[0]
            .split_whitespace()
            .nth(1)
            .is_none_or(|n| n.trim_start_matches('*') == zip_nome)
    {
        return Some(h);
    }
    linhas.iter().find_map(|l| {
        let mut p = l.split_whitespace();
        let h = hex(p.next()?)?;
        (p.next()?.trim_start_matches('*') == zip_nome).then_some(h)
    })
}

/// Confere o ZIP contra o hash e extrai o executável para `destino`. Devolve o caminho.
pub fn preparar_de_bytes(
    zip: &[u8],
    zip_nome: &str,
    soma_texto: &str,
    destino: &Path,
) -> Result<PathBuf, ErroAtualizacao> {
    let esperado = hash_esperado(soma_texto, zip_nome).ok_or_else(|| {
        ErroAtualizacao::Seguranca(format!(
            "não achei o SHA-256 de {zip_nome} no arquivo de somas"
        ))
    })?;
    let obtido = hex(zip);
    if obtido != esperado {
        return Err(ErroAtualizacao::Seguranca(format!(
            "o SHA-256 de {zip_nome} não confere com o publicado (arquivo corrompido ou adulterado)"
        )));
    }
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(zip))
        .map_err(|e| ErroAtualizacao::Formato(format!("o ZIP da atualização não abre ({e})")))?;
    let mut candidatos = Vec::new();
    for i in 0..z.len() {
        let e = z
            .by_index(i)
            .map_err(|e| ErroAtualizacao::Formato(e.to_string()))?;
        let nome = e.name().to_string();
        if !e.is_dir() && nome.to_lowercase().ends_with(".exe") {
            candidatos.push((i, nome, e.size()));
        }
    }
    let (i, nome, tamanho) = match candidatos.len() {
        0 => {
            return Err(ErroAtualizacao::Formato(
                "o ZIP da atualização não contém nenhum .exe".into(),
            ));
        }
        1 => candidatos.remove(0),
        _ => candidatos
            .into_iter()
            .find(|(_, n, _)| n.to_lowercase().ends_with("sigtap-aberto.exe"))
            .ok_or_else(|| {
                ErroAtualizacao::Formato(
                    "o ZIP tem mais de um .exe e nenhum se chama sigtap-aberto.exe".into(),
                )
            })?,
    };
    if tamanho > LIMITE_EXE {
        return Err(ErroAtualizacao::Seguranca(format!(
            "{nome} declara {tamanho} bytes, acima do limite"
        )));
    }
    let mut dados = Vec::new();
    z.by_index(i)
        .map_err(|e| ErroAtualizacao::Formato(e.to_string()))?
        .take(LIMITE_EXE + 1)
        .read_to_end(&mut dados)
        .map_err(|e| ErroAtualizacao::Formato(format!("falha ao extrair {nome} ({e})")))?;
    if dados.len() as u64 > LIMITE_EXE || dados.len() < 2 || &dados[..2] != b"MZ" {
        return Err(ErroAtualizacao::Seguranca(format!(
            "{nome} não é um executável do Windows"
        )));
    }
    std::fs::create_dir_all(destino).map_err(|e| {
        ErroAtualizacao::Arquivo(format!(
            "não foi possível criar {} ({e})",
            destino.display()
        ))
    })?;
    let alvo = destino.join("novo.exe");
    std::fs::write(&alvo, &dados).map_err(|e| {
        ErroAtualizacao::Arquivo(format!("não foi possível gravar {} ({e})", alvo.display()))
    })?;
    Ok(alvo)
}

/// Baixa o ZIP e o hash do lançamento e prepara o executável novo em `destino`.
pub fn baixar_e_preparar(
    l: &Lancamento,
    repo: &str,
    destino: &Path,
    cancelar: &AtomicBool,
) -> Result<PathBuf, ErroAtualizacao> {
    for u in [&l.zip_url, &l.soma_url] {
        if !url_do_github(u, repo) {
            return Err(ErroAtualizacao::Seguranca(format!(
                "endereço fora de github.com/{repo}: {u}"
            )));
        }
    }
    let http = Http::novo(crate::cortesia::Cortesia::default()).com_limite(LIMITE_ZIP);
    let soma = http.obter(&l.soma_url, cancelar, &mut |_| {})?;
    let zip = http.obter(&l.zip_url, cancelar, &mut |_| {})?;
    preparar_de_bytes(&zip, &l.zip_nome, &String::from_utf8_lossy(&soma), destino)
}

/// Caminho do executável antigo para um executável atual: `x.exe` → `x.antigo.exe`.
pub fn caminho_antigo(atual: &Path) -> PathBuf {
    let stem = atual
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    atual.with_file_name(format!("{stem}.antigo.exe"))
}

/// Troca o executável: o atual vira `.antigo.exe` e o novo ocupa o nome do atual. Se algo
/// falhar no meio, o atual volta ao lugar.
pub fn trocar(atual: &Path, novo: &Path) -> Result<PathBuf, ErroAtualizacao> {
    let antigo = caminho_antigo(atual);
    let _ = std::fs::remove_file(&antigo);
    std::fs::rename(atual, &antigo).map_err(|e| {
        ErroAtualizacao::Arquivo(format!(
            "não foi possível separar o programa atual ({e}). Feche outros programas que o estejam usando; se ele estiver numa pasta protegida (como Arquivos de Programas), copie-o para uma pasta sua"
        ))
    })?;
    if let Err(e) = std::fs::rename(novo, atual).or_else(|_| std::fs::copy(novo, atual).map(|_| ()))
    {
        let _ = std::fs::remove_file(atual);
        let _ = std::fs::rename(&antigo, atual);
        return Err(ErroAtualizacao::Arquivo(format!(
            "não foi possível pôr a versão nova no lugar ({e}); a versão atual foi mantida"
        )));
    }
    let _ = std::fs::remove_file(novo);
    Ok(antigo)
}

/// Apaga restos de uma atualização anterior (`.antigo.exe` e a pasta de preparo).
pub fn limpar_restos(atual: &Path, pasta_dados: &Path) {
    let _ = std::fs::remove_file(caminho_antigo(atual));
    let _ = std::fs::remove_dir_all(pasta_dados.join("atualizacao"));
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::io::Write;

    const REPO: &str = "dono/sigtap-aberto";

    fn zip_com(arquivos: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            for (n, c) in arquivos {
                z.start_file(*n, zip::write::SimpleFileOptions::default())
                    .unwrap();
                z.write_all(c).unwrap();
            }
            z.finish().unwrap();
        }
        buf
    }

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("sa_atu_{nome}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn json(tag: &str, extra: &str) -> String {
        let base = format!("https://github.com/{REPO}/releases/download/{tag}");
        format!(
            r#"{{"tag_name":"{tag}","html_url":"https://github.com/{REPO}/releases/tag/{tag}","body":"Notas","draft":false,"prerelease":false,{extra}
            "assets":[{{"name":"SIGTAP-Aberto-{tag}-windows-x64.zip","browser_download_url":"{base}/SIGTAP-Aberto-{tag}-windows-x64.zip","size":123}},
                      {{"name":"SIGTAP-Aberto-{tag}-windows-x64.zip.sha256","browser_download_url":"{base}/SIGTAP-Aberto-{tag}-windows-x64.zip.sha256","size":90}}]}}"#
        )
    }

    #[test]
    fn versoes() {
        assert_eq!(Versao::de_texto("v1.2.3"), Some(Versao(1, 2, 3)));
        assert_eq!(Versao::de_texto("0.0.1"), Some(Versao(0, 0, 1)));
        assert_eq!(Versao::de_texto("1.2"), None);
        assert_eq!(Versao::de_texto("1.2.3-beta"), None);
        assert!(e_mais_nova("0.0.9", "0.0.10"));
        assert!(e_mais_nova("0.9.0", "v1.0.0"));
        assert!(!e_mais_nova("1.0.0", "1.0.0"));
        assert!(!e_mais_nova("1.0.1", "1.0.0"));
        assert!(!e_mais_nova("1.0.0", "lixo"));
    }

    #[test]
    fn interpreta_lancamento_e_recusa_o_que_nao_serve() {
        let l = interpretar(json("v0.2.0", "").as_bytes(), REPO)
            .unwrap()
            .unwrap();
        assert_eq!(l.versao, "0.2.0");
        assert_eq!(l.zip_nome, "SIGTAP-Aberto-v0.2.0-windows-x64.zip");
        assert!(l.soma_url.ends_with(".zip.sha256"));
        // Rascunho e pré-lançamento: ignorados.
        let rascunho = json("v0.2.0", "").replace(r#""draft":false"#, r#""draft":true"#);
        assert!(interpretar(rascunho.as_bytes(), REPO).unwrap().is_none());
        let pre = json("v0.2.0", "").replace(r#""prerelease":false"#, r#""prerelease":true"#);
        assert!(interpretar(pre.as_bytes(), REPO).unwrap().is_none());
        // Sem ZIP de Windows.
        let sem = r#"{"tag_name":"v0.3.0","assets":[]}"#;
        assert!(interpretar(sem.as_bytes(), REPO).unwrap().is_none());
        // Endereço fora do repositório: erro de segurança.
        let ruim = json("v0.2.0", "").replace(&format!("github.com/{REPO}"), "exemplo.com/x");
        assert!(matches!(
            interpretar(ruim.as_bytes(), REPO),
            Err(ErroAtualizacao::Seguranca(_))
        ));
        assert!(interpretar(b"nao e json", REPO).is_err());
    }

    #[test]
    fn cada_arquitetura_escolhe_o_seu_pacote() {
        let tag = "v0.2.0";
        let base = format!("https://github.com/{REPO}/releases/download/{tag}");
        let ativo = |arq: &str| {
            format!(
                r#"{{"name":"SIGTAP-Aberto-{tag}-windows-{arq}.zip","browser_download_url":"{base}/SIGTAP-Aberto-{tag}-windows-{arq}.zip","size":1}},
                   {{"name":"SIGTAP-Aberto-{tag}-windows-{arq}.zip.sha256","browser_download_url":"{base}/SIGTAP-Aberto-{tag}-windows-{arq}.zip.sha256","size":1}}"#
            )
        };
        let j = format!(
            r#"{{"tag_name":"{tag}","html_url":"x","body":"","draft":false,"prerelease":false,"assets":[{},{}]}}"#,
            ativo("x64"),
            ativo("arm64")
        );
        for arq in ["x64", "arm64"] {
            let l = interpretar_para(j.as_bytes(), REPO, &format!("-windows-{arq}.zip"))
                .unwrap()
                .unwrap();
            assert_eq!(l.zip_nome, format!("SIGTAP-Aberto-{tag}-windows-{arq}.zip"));
            assert!(l.soma_url.ends_with(&format!("-windows-{arq}.zip.sha256")));
        }
        // Lançamento sem o pacote desta arquitetura: não oferece atualização.
        let so_x64 = json(tag, "");
        assert!(
            interpretar_para(so_x64.as_bytes(), REPO, "-windows-arm64.zip")
                .unwrap()
                .is_none()
        );
        assert!(SUFIXO_PACOTE.starts_with("-windows-") && SUFIXO_PACOTE.ends_with(".zip"));
    }

    #[test]
    fn hash_nos_dois_formatos() {
        let h = "a".repeat(64);
        assert_eq!(
            hash_esperado(&format!("{h}  x.zip\n"), "x.zip"),
            Some(h.clone())
        );
        assert_eq!(hash_esperado(&format!("{h}\n"), "x.zip"), Some(h.clone()));
        assert_eq!(
            hash_esperado(&format!("{h} *x.zip"), "x.zip"),
            Some(h.clone())
        );
        let varias = format!("{}  outro.zip\n{h}  x.zip\n", "b".repeat(64));
        assert_eq!(hash_esperado(&varias, "x.zip"), Some(h.clone()));
        assert_eq!(hash_esperado(&format!("{h}  outro.zip"), "x.zip"), None);
        assert_eq!(hash_esperado("curto  x.zip", "x.zip"), None);
    }

    #[test]
    fn prepara_extrai_e_confere_o_hash() {
        let exe = [b"MZ".as_slice(), &[7u8; 5000]].concat();
        let zip = zip_com(&[
            ("LEIAME.txt", b"oi"),
            ("SIGTAP Aberto/sigtap-aberto.exe", &exe),
        ]);
        let h = hex(&zip);
        let d = pasta("prep");
        let alvo = preparar_de_bytes(&zip, "p.zip", &format!("{h}  p.zip"), &d).unwrap();
        assert_eq!(std::fs::read(&alvo).unwrap(), exe);
        // Hash errado: nada é gravado.
        let d2 = pasta("prep2");
        let e = preparar_de_bytes(&zip, "p.zip", &format!("{}  p.zip", "0".repeat(64)), &d2)
            .unwrap_err();
        assert!(matches!(e, ErroAtualizacao::Seguranca(_)), "{e}");
        assert!(!d2.join("novo.exe").exists());
        // Executável sem cabeçalho de Windows.
        let ruim = zip_com(&[("a.exe", b"nao e exe")]);
        let hr = hex(&ruim);
        assert!(preparar_de_bytes(&ruim, "r.zip", &format!("{hr}  r.zip"), &d2).is_err());
        // ZIP sem .exe.
        let vazio = zip_com(&[("a.txt", b"x")]);
        let hv = hex(&vazio);
        assert!(preparar_de_bytes(&vazio, "v.zip", &format!("{hv}  v.zip"), &d2).is_err());
        let _ = (std::fs::remove_dir_all(d), std::fs::remove_dir_all(d2));
    }

    #[test]
    fn troca_o_executavel_e_desfaz_se_falhar() {
        let d = pasta("troca");
        let atual = d.join("sigtap-aberto.exe");
        let novo = d.join("novo.exe");
        std::fs::write(&atual, b"MZ-velho").unwrap();
        std::fs::write(&novo, b"MZ-novo").unwrap();
        let antigo = trocar(&atual, &novo).unwrap();
        assert_eq!(std::fs::read(&atual).unwrap(), b"MZ-novo");
        assert_eq!(std::fs::read(&antigo).unwrap(), b"MZ-velho");
        assert_eq!(antigo.file_name().unwrap(), "sigtap-aberto.antigo.exe");
        // Falha: o "novo" não existe; o atual volta ao lugar.
        let e = trocar(&atual, &d.join("nao_existe.exe"));
        assert!(e.is_err());
        assert_eq!(std::fs::read(&atual).unwrap(), b"MZ-novo");
        limpar_restos(&atual, &d);
        assert!(!antigo.exists());
        let _ = std::fs::remove_dir_all(d);
    }
}
