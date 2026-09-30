//! Linha de comando do SIGTAP Aberto.
//!
//! Portátil: por padrão tudo fica em `dados\` ao lado do executável (banco em
//! `dados\sigtap.db`, ZIPs em `dados\zips\`). Use `--banco` e `--zips` para outro lugar.

use sa_core::Competencia;
use sa_download::cortesia::{Cortesia, Evento, Pedido, baixar_lista};
use sa_download::sigtap as dl;
use sa_packs::sigtap::BancoSigtap;
use sa_sources::sigtap::ZipSigtap;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

const AJUDA: &str = "\
SIGTAP Aberto — linha de comando

Uso: sigtap-aberto-cli <comando> [opções]

Comandos:
  competencias                    lista as competências carregadas no banco
  carregar <zip ou pasta>...      carrega ZIPs oficiais (TabelaUnificada_*.zip)
  remover --competencia AAAAMM    tira uma competência do banco
  reconstruir --competencia AAAAMM --saida PASTA
                                  grava os .txt e _layout.txt da competência, como no ZIP oficial
  conferir <pasta de zips>        reconstrói cada competência e compara com os ZIPs, byte a byte
  listar-ftp                      lista os ZIPs disponíveis no FTP oficial do DATASUS
  baixar [--ultima | --competencia AAAAMM | --todas]
                                  baixa do FTP oficial para a pasta de ZIPs, com cortesia
  importar --origem PASTA         copia ZIPs válidos de uma pasta (rede sem FTP)
  ajuda                           mostra esta ajuda

Opções:
  --banco ARQUIVO   banco SQLite (padrão: dados\\sigtap.db ao lado do programa)
  --zips PASTA      pasta dos ZIPs (padrão: dados\\zips ao lado do programa)
";

struct Opcoes {
    banco: PathBuf,
    zips: PathBuf,
    competencia: Option<Competencia>,
    saida: Option<PathBuf>,
    origem: Option<PathBuf>,
    ultima: bool,
    todas: bool,
    livres: Vec<PathBuf>,
}

fn pasta_do_programa() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn ler_opcoes(args: &[String]) -> Result<Opcoes, String> {
    let base = pasta_do_programa().join("dados");
    let mut o = Opcoes {
        banco: base.join("sigtap.db"),
        zips: base.join("zips"),
        competencia: None,
        saida: None,
        origem: None,
        ultima: false,
        todas: false,
        livres: Vec::new(),
    };
    let mut i = 0;
    let valor = |i: usize, nome: &str| -> Result<String, String> {
        args.get(i + 1)
            .cloned()
            .ok_or_else(|| format!("a opção {nome} precisa de um valor"))
    };
    while i < args.len() {
        match args[i].as_str() {
            "--banco" => {
                o.banco = PathBuf::from(valor(i, "--banco")?);
                i += 1;
            }
            "--zips" => {
                o.zips = PathBuf::from(valor(i, "--zips")?);
                i += 1;
            }
            "--saida" => {
                o.saida = Some(PathBuf::from(valor(i, "--saida")?));
                i += 1;
            }
            "--origem" => {
                o.origem = Some(PathBuf::from(valor(i, "--origem")?));
                i += 1;
            }
            "--competencia" => {
                o.competencia = Some(
                    Competencia::de_texto(&valor(i, "--competencia")?)
                        .map_err(|e| e.to_string())?,
                );
                i += 1;
            }
            "--ultima" => o.ultima = true,
            "--todas" => o.todas = true,
            x if x.starts_with("--") => {
                return Err(format!(
                    "opção desconhecida {x}. Veja: sigtap-aberto-cli ajuda"
                ));
            }
            x => o.livres.push(PathBuf::from(x)),
        }
        i += 1;
    }
    Ok(o)
}

fn abrir_banco(o: &Opcoes) -> Result<BancoSigtap, String> {
    if let Some(p) = o.banco.parent() {
        std::fs::create_dir_all(p)
            .map_err(|e| format!("não foi possível criar {} ({e})", p.display()))?;
    }
    BancoSigtap::abrir(&o.banco).map_err(|e| e.to_string())
}

fn zips_em(caminhos: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut v = Vec::new();
    for c in caminhos {
        if c.is_dir() {
            let rd = std::fs::read_dir(c)
                .map_err(|e| format!("não foi possível ler {} ({e})", c.display()))?;
            for e in rd.flatten() {
                let p = e.path();
                if p.file_name().is_some_and(|n| {
                    sa_sources::sigtap::interpretar_nome(&n.to_string_lossy()).is_some()
                }) {
                    v.push(p);
                }
            }
        } else {
            v.push(c.clone());
        }
    }
    v.sort();
    if v.is_empty() {
        return Err(
            "nenhum ZIP TabelaUnificada_*.zip encontrado. Indique arquivos ou uma pasta".into(),
        );
    }
    Ok(v)
}

fn cmd_competencias(o: &Opcoes) -> Result<(), String> {
    let b = abrir_banco(o)?;
    let cs = b.competencias().map_err(|e| e.to_string())?;
    if cs.is_empty() {
        println!("Nenhuma competência carregada em {}.", o.banco.display());
    }
    for c in &cs {
        println!(
            "{}  {}  sha256 {}",
            c.competencia,
            c.arquivo,
            &c.sha256[..16]
        );
    }
    let (conteudos, intervalos) = b.contagens().map_err(|e| e.to_string())?;
    println!(
        "{} competências; {conteudos} conteúdos distintos; {intervalos} intervalos de vigência",
        cs.len()
    );
    Ok(())
}

fn cmd_carregar(o: &Opcoes) -> Result<(), String> {
    let zips = zips_em(&o.livres)?;
    let mut b = abrir_banco(o)?;
    let t0 = Instant::now();
    for (i, z) in zips.iter().enumerate() {
        let t = Instant::now();
        let r = b.carregar_zip(z).map_err(|e| e.to_string())?;
        println!(
            "[{}/{}] {} carregada: {} tabelas, {} registros{} ({:.1} s)",
            i + 1,
            zips.len(),
            r.competencia,
            r.tabelas,
            r.registros,
            if r.substituiu {
                ", substituiu a anterior"
            } else {
                ""
            },
            t.elapsed().as_secs_f64()
        );
    }
    println!(
        "Carga concluída em {:.1} s. Banco: {}",
        t0.elapsed().as_secs_f64(),
        o.banco.display()
    );
    Ok(())
}

fn cmd_remover(o: &Opcoes) -> Result<(), String> {
    let c = o.competencia.ok_or("informe --competencia AAAAMM")?;
    abrir_banco(o)?.remover(c).map_err(|e| e.to_string())?;
    println!("Competência {c} removida.");
    Ok(())
}

fn cmd_reconstruir(o: &Opcoes) -> Result<(), String> {
    let c = o.competencia.ok_or("informe --competencia AAAAMM")?;
    let saida = o.saida.clone().ok_or("informe --saida PASTA")?;
    std::fs::create_dir_all(&saida)
        .map_err(|e| format!("não foi possível criar {} ({e})", saida.display()))?;
    let b = abrir_banco(o)?;
    let tabelas = b.tabelas(c).map_err(|e| e.to_string())?;
    for t in &tabelas {
        let dados = b
            .exportar_tabela(c, t)
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let leiaute = b
            .exportar_leiaute(c, t)
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        std::fs::write(saida.join(format!("{t}.txt")), dados).map_err(|e| e.to_string())?;
        std::fs::write(saida.join(format!("{t}_layout.txt")), leiaute)
            .map_err(|e| e.to_string())?;
    }
    println!(
        "{} tabelas da competência {c} gravadas em {}",
        tabelas.len(),
        saida.display()
    );
    Ok(())
}

fn cmd_conferir(o: &Opcoes) -> Result<(), String> {
    let zips = zips_em(&o.livres)?;
    let b = abrir_banco(o)?;
    let (mut ok, mut dif, mut bytes) = (0usize, 0usize, 0usize);
    let t0 = Instant::now();
    for z in &zips {
        let mut zip = ZipSigtap::abrir(z).map_err(|e| e.to_string())?;
        let c = zip.nome.competencia;
        for t in zip.tabelas() {
            let original = zip.ler_tabela(&t).map_err(|e| e.to_string())?;
            let rec = b
                .exportar_tabela(c, &t.to_ascii_lowercase())
                .map_err(|e| e.to_string())?;
            let igual = rec
                .as_ref()
                .is_some_and(|r| Sha256::digest(r) == Sha256::digest(&original.dados));
            if igual {
                ok += 1;
                bytes += original.dados.len();
            } else {
                dif += 1;
                println!("DIFERENTE: {t} em {c}");
            }
        }
    }
    println!(
        "Conferência: {ok} arquivos idênticos byte a byte ({:.1} MB), {dif} diferentes, {} ZIPs, {:.1} s",
        bytes as f64 / 1e6,
        zips.len(),
        t0.elapsed().as_secs_f64()
    );
    if dif > 0 {
        Err(format!("{dif} arquivos diferentes"))
    } else {
        Ok(())
    }
}

fn cmd_listar_ftp() -> Result<(), String> {
    let d = dl::listar_servidor(&Cortesia::default()).map_err(|e| e.to_string())?;
    for x in &d {
        println!("{}  {}  {} bytes", x.competencia, x.nome, x.tamanho);
    }
    println!(
        "{} competências no FTP oficial ({}{})",
        d.len(),
        dl::SERVIDOR,
        dl::PASTA
    );
    Ok(())
}

fn cmd_baixar(o: &Opcoes) -> Result<(), String> {
    let cortesia = Cortesia::default();
    let disp = dl::listar_servidor(&cortesia).map_err(|e| e.to_string())?;
    let ultima = disp.last().map(|d| d.competencia);
    let alvo = o.competencia;
    let plano = dl::planejar(&disp, &o.zips, |c| {
        if o.todas {
            true
        } else if let Some(a) = alvo {
            c == a
        } else {
            Some(c) == ultima
        }
    });
    if plano.is_empty() {
        println!(
            "Nada a baixar: a pasta {} já tem a versão mais nova do que foi pedido.",
            o.zips.display()
        );
        return Ok(());
    }
    let total: u64 = plano.iter().map(|d| d.tamanho).sum();
    if total > 500 * 1024 * 1024 {
        return Err(format!(
            "o pedido soma {:.0} MB, acima do limite de aviso (500 MB). Baixe por partes com --competencia",
            total as f64 / 1e6
        ));
    }
    println!(
        "Baixando {} arquivo(s), {:.1} MB, de {}{} (um por vez, pausa de 2 s)",
        plano.len(),
        total as f64 / 1e6,
        dl::SERVIDOR,
        dl::PASTA
    );
    let pedidos: Vec<Pedido> = plano
        .iter()
        .map(|d| Pedido {
            pasta_remota: dl::PASTA.into(),
            nome: d.nome.clone(),
            tamanho: d.tamanho,
        })
        .collect();
    let nomes: std::collections::HashMap<PathBuf, String> = pedidos
        .iter()
        .map(|p| (o.zips.join(format!("{}.parcial", p.nome)), p.nome.clone()))
        .collect();
    let feitos = baixar_lista(
        dl::SERVIDOR,
        &pedidos,
        &o.zips,
        &cortesia,
        &AtomicBool::new(false),
        |e| match e {
            Evento::Iniciando {
                arquivo,
                total,
                retomando_de,
            } if retomando_de > 0 => {
                println!("  {arquivo}: retomando em {retomando_de} de {total} bytes")
            }
            Evento::Iniciando { arquivo, total, .. } => println!("  {arquivo}: {total} bytes"),
            Evento::NovaTentativa {
                arquivo,
                tentativa,
                espera_s,
                motivo,
            } => {
                println!("  {arquivo}: falhou ({motivo}); tentativa {tentativa} em {espera_s} s")
            }
            Evento::Concluido { arquivo } => println!("  {arquivo}: concluído e verificado"),
            Evento::Progresso { .. } => {}
        },
        |p| dl::validar_zip(p, nomes.get(p).map(String::as_str).unwrap_or_default()),
    )
    .map_err(|e| e.to_string())?;
    println!("{} arquivo(s) em {}", feitos.len(), o.zips.display());
    Ok(())
}

fn cmd_importar(o: &Opcoes) -> Result<(), String> {
    let origem = o.origem.clone().ok_or("informe --origem PASTA")?;
    let (ok, recusados) = dl::importar_pasta(&origem, &o.zips).map_err(|e| e.to_string())?;
    for (n, e) in &recusados {
        println!("RECUSADO: {n}: {e}");
    }
    println!(
        "{} ZIP(s) importado(s) para {}; {} recusado(s)",
        ok.len(),
        o.zips.display(),
        recusados.len()
    );
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().cloned() else {
        print!("{AJUDA}");
        return ExitCode::SUCCESS;
    };
    let r = ler_opcoes(&args[1..]).and_then(|o| match cmd.as_str() {
        "competencias" => cmd_competencias(&o),
        "carregar" => cmd_carregar(&o),
        "remover" => cmd_remover(&o),
        "reconstruir" => cmd_reconstruir(&o),
        "conferir" => cmd_conferir(&o),
        "listar-ftp" => cmd_listar_ftp(),
        "baixar" => cmd_baixar(&o),
        "importar" => cmd_importar(&o),
        "ajuda" | "--help" | "-h" => {
            print!("{AJUDA}");
            Ok(())
        }
        outro => Err(format!(
            "comando desconhecido \"{outro}\". Veja: sigtap-aberto-cli ajuda"
        )),
    });
    match r {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("ERRO: {e}");
            ExitCode::FAILURE
        }
    }
}
