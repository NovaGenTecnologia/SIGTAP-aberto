//! Linha de comando do SIGTAP Aberto.
//!
//! Portátil: por padrão tudo fica em `dados\` ao lado do executável (banco em
//! `dados\sigtap.db`, ZIPs em `dados\zips\`). Use `--banco` e `--zips` para outro lugar.

use sa_core::Competencia;
use sa_download::cortesia::{Cortesia, Evento};
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
  territorio [--origem PASTA]     baixa (ou importa de PASTA) municípios do IBGE e regiões de
                                  saúde do Ministério da Saúde e grava dados\\territorio.db
  ficha <código> [--competencia AAAAMM]
                                  ficha completa do procedimento, em JSON
  buscar <texto> [--competencia AAAAMM]
                                  busca por código, nome, CID, CBO, habilitação..., em JSON
  arvore [nó] [--competencia AAAAMM]
  arvore-cid [letra|categoria] [--competencia AAAAMM]
  ligados <tabela> <código> [--competencia AAAAMM]   (ex.: ligados tb_cid T742)
                                  grupos, ou filhos do nó (2, 4 ou 6 dígitos), em JSON
  historico <código>              linha do tempo do procedimento, em JSON
  mudou [TABELA] [--de AAAAMM] [--competencia AAAAMM] [--desde N]
                                  o que mudou da competência anterior (ou de --de), em JSON;
                                  com TABELA, só ela, a partir do item N (padrão 0)
  cnes-competencias <UF>          competências do CNES no FTP oficial para a UF
  cnes-baixar <UF> [--competencia AAAAMM]
                                  baixa o CNES da UF (estabelecimentos, habilitações, serviços,
                                  leitos, equipamentos; profissionais só da unidade escolhida)
  cnes-importar <UF> --origem PASTA
                                  carrega arquivos do CNES baixados por conta própria
  cnes-situacao                   UFs carregadas e a unidade escolhida, em JSON
  cnes-buscar <UF> <texto>        procura estabelecimentos por nome ou número do CNES
  cnes-apagar <UF>                apaga o CNES da UF (banco e arquivos guardados)
  unidade-definir <UF> <CNES>     escolhe a sua unidade
  unidade-limpar                  esquece a unidade escolhida
  unidade [--competencia AAAAMM]  a sua unidade completa, em JSON
  aptidao <código>                a sua unidade está apta ao procedimento? (regra não confirmada)
  rede <código> [--escopo municipio|regiao|uf]
                                  quem faz o procedimento na rede
  favorito <código> sim|nao       marca ou desmarca um procedimento favorito
  anotar <código> [texto]         grava a anotação do procedimento (sem texto, apaga)
  marcados                        favoritos e anotações, em JSON
  exportar --saida ARQ.xlsx|.csv  grava a planilha recebida em JSON pela entrada padrão
  ajuda                           mostra esta ajuda

Opções:
  --banco ARQUIVO   banco SQLite (padrão: dados\\sigtap.db ao lado do programa)
  --zips PASTA      pasta dos ZIPs (padrão: dados\\zips ao lado do programa)
  --dados PASTA     pasta de dados para CNES, unidade e favoritos (padrão: a pasta do banco)
";

struct Opcoes {
    banco: PathBuf,
    zips: PathBuf,
    competencia: Option<Competencia>,
    saida: Option<PathBuf>,
    origem: Option<PathBuf>,
    ultima: bool,
    todas: bool,
    de: Option<Competencia>,
    desde: Option<usize>,
    livres: Vec<PathBuf>,
    dados: Option<PathBuf>,
    escopo: String,
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
        de: None,
        desde: None,
        livres: Vec::new(),
        dados: None,
        escopo: "municipio".into(),
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
            "--desde" => {
                o.desde = Some(
                    valor(i, "--desde")?
                        .parse()
                        .map_err(|_| "--desde espera um número".to_string())?,
                );
                i += 1;
            }
            "--de" => {
                o.de = Some(Competencia::de_texto(&valor(i, "--de")?).map_err(|e| e.to_string())?);
                i += 1;
            }
            "--dados" => {
                o.dados = Some(PathBuf::from(valor(i, "--dados")?));
                i += 1;
            }
            "--escopo" => {
                o.escopo = valor(i, "--escopo")?;
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

/// Território: download com cortesia (ou importação manual) e gravação do módulo.
fn cmd_territorio(o: &Opcoes) -> Result<(), String> {
    use sa_download::territorio as ter;
    let base = o.banco.parent().map(Path::to_path_buf).unwrap_or_default();
    let pasta = base.join("territorio");
    match &o.origem {
        None => {
            println!(
                "Baixando municípios (IBGE) e regiões de saúde (Ministério da Saúde), uma página por vez..."
            );
            let http = sa_download::http::Http::novo(Cortesia::default());
            let cancelar = AtomicBool::new(false);
            ter::baixar(&http, &pasta, &cancelar, &mut |e| match e {
                Evento::NovaTentativa {
                    arquivo,
                    tentativa,
                    espera_s,
                    motivo,
                } => println!(
                    "  falha em {arquivo} ({motivo}); tentativa {tentativa} em {espera_s} s"
                ),
                Evento::Progresso { arquivo, feito, .. } => println!("  {arquivo}: {feito} itens"),
                _ => {}
            })
            .map_err(|e| e.to_string())?;
        }
        Some(origem) => {
            std::fs::create_dir_all(&pasta)
                .map_err(|e| format!("não foi possível criar {} ({e})", pasta.display()))?;
            ter::ler_pasta(origem).map_err(|e| e.to_string())?;
            for nome in [ter::ARQ_IBGE, ter::ARQ_DEMAS, ter::ARQ_ORIGEM] {
                let de = origem.join(nome);
                if de.exists() {
                    std::fs::copy(&de, pasta.join(nome))
                        .map_err(|e| format!("não foi possível copiar {} ({e})", de.display()))?;
                } else if nome == ter::ARQ_ORIGEM {
                    let _ = std::fs::remove_file(pasta.join(nome));
                }
            }
        }
    }
    let t = ter::ler_pasta(&pasta).map_err(|e| e.to_string())?;
    let conv = |x: &ter::OrigemArquivo| sa_packs::territorio::Origem {
        url: x.url.clone(),
        obtido_em: x.obtido_em.clone(),
        sha256: x.sha256.clone(),
    };
    let mut b = sa_packs::territorio::BancoTerritorio::abrir(&base.join("territorio.db"))
        .map_err(|e| e.to_string())?;
    let r = b
        .gravar(
            &t.ibge,
            &t.demas,
            &conv(&t.origem_ibge),
            &conv(&t.origem_demas),
        )
        .map_err(|e| e.to_string())?;
    println!(
        "Território gravado: {} municípios (IBGE), {} com região de saúde (Ministério da Saúde), {} UFs, {} regiões de saúde, {} macrorregiões.",
        r.municipios_ibge, r.municipios_saude, r.ufs, r.regioes_saude, r.macrorregioes_saude
    );
    if !r.sem_regiao_saude.is_empty() {
        println!("Sem região de saúde na fonte: {:?}", r.sem_regiao_saude);
    }
    if !r.sem_ibge.is_empty() {
        println!("No Ministério da Saúde e não no IBGE: {:?}", r.sem_ibge);
    }
    if !r.uf_divergente.is_empty() {
        println!("UF diferente entre as fontes: {:?}", r.uf_divergente);
    }
    println!(
        "Origem: IBGE {} ({}); Ministério da Saúde {} ({})",
        t.origem_ibge.url, t.origem_ibge.obtido_em, t.origem_demas.url, t.origem_demas.obtido_em
    );
    Ok(())
}

/// Consultas em JSON (mesmas funções usadas pela interface).
fn cmd_consulta(cmd: &str, o: &Opcoes) -> Result<(), String> {
    if !o.banco.exists() {
        return Err(format!(
            "banco não encontrado em {}. Carregue ZIPs com: sigtap-aberto-cli carregar <pasta>",
            o.banco.display()
        ));
    }
    let q = sa_query::Consulta::abrir(&o.banco).map_err(|e| e.to_string())?;
    let comp = match o.competencia {
        Some(c) => c,
        None => q.mais_recente().map_err(|e| e.to_string())?,
    };
    let livre = o
        .livres
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(" ");
    let exigir = |oque: &str| -> Result<(), String> {
        if livre.is_empty() {
            Err(format!("informe {oque}. Veja: sigtap-aberto-cli ajuda"))
        } else {
            Ok(())
        }
    };
    let json = match cmd {
        "ficha" => {
            exigir("o código do procedimento")?;
            match q.ficha(comp, &livre).map_err(|e| e.to_string())? {
                Some(f) => serde_json::to_string_pretty(&f),
                None => {
                    return Err(format!(
                        "o procedimento {livre} não existe na competência {comp}. Veja o histórico com: sigtap-aberto-cli historico {livre}"
                    ));
                }
            }
        }
        "buscar" => {
            exigir("o texto da busca")?;
            serde_json::to_string_pretty(&q.buscar(comp, &livre).map_err(|e| e.to_string())?)
        }
        "arvore" => {
            let pai = if livre.is_empty() { None } else { Some(livre.as_str()) };
            serde_json::to_string_pretty(&q.arvore(comp, pai).map_err(|e| e.to_string())?)
        }
        "ligados" => {
            // ligados <tabela> <código> (ex.: ligados tb_cid T742)
            let partes: Vec<&str> = livre.split_whitespace().collect();
            if partes.len() < 2 {
                return Err("informe a tabela e o código. Ex.: ligados tb_cid T742".into());
            }
            serde_json::to_string_pretty(
                &q.procedimentos_ligados(comp, partes[0], &partes[1..])
                    .map_err(|e| e.to_string())?,
            )
        }
        "arvore-cid" => {
            let pai = if livre.is_empty() { None } else { Some(livre.as_str()) };
            serde_json::to_string_pretty(&q.arvore_cid(comp, pai).map_err(|e| e.to_string())?)
        }
        "historico" => {
            exigir("o código do procedimento")?;
            serde_json::to_string_pretty(&q.historico(&livre).map_err(|e| e.to_string())?)
        }
        _ => {
            let de = match o.de {
                Some(d) => d,
                None => {
                    let cs = q.competencias().map_err(|e| e.to_string())?;
                    let pos = cs
                        .iter()
                        .position(|c| c.competencia == comp.to_string())
                        .ok_or_else(|| format!("competência {comp} não carregada"))?;
                    if pos == 0 {
                        return Err(format!("não há competência carregada antes de {comp}; use --de"));
                    }
                    Competencia::de_texto(&cs[pos - 1].competencia).map_err(|e| e.to_string())?
                }
            };
            if livre.is_empty() {
                serde_json::to_string_pretty(
                    &q.o_que_mudou(de, comp, sa_query::mudancas::LIMITE_ITENS)
                        .map_err(|e| e.to_string())?,
                )
            } else {
                serde_json::to_string_pretty(
                    &q.o_que_mudou_tabela(
                        de,
                        comp,
                        &livre,
                        o.desde.unwrap_or(0),
                        sa_query::mudancas::LIMITE_ITENS,
                    )
                    .map_err(|e| e.to_string())?,
                )
            }
        }
    }
    .map_err(|e| format!("falha ao gerar JSON ({e})"))?;
    println!("{json}");
    Ok(())
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
    let feitos = dl::baixar(
        &plano,
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

/// CNES, minha unidade, favoritos e exportação (as mesmas funções usadas pela interface).
fn cmd_unidade(cmd: &str, o: &Opcoes) -> Result<(), String> {
    use sa_unidade as un;
    let dados = match &o.dados {
        Some(d) => d.clone(),
        None => o.banco.parent().map(Path::to_path_buf).unwrap_or_default(),
    };
    let p = un::Pastas { dados };
    let livres: Vec<String> = o
        .livres
        .iter()
        .map(|x| x.to_string_lossy().into_owned())
        .collect();
    let arg = |i: usize, oque: &str| -> Result<&str, String> {
        livres
            .get(i)
            .map(String::as_str)
            .ok_or_else(|| format!("informe {oque}. Veja: sigtap-aberto-cli ajuda"))
    };
    let progresso = |x: un::Progresso| eprintln!("[{:>3.0}%] {}", x.fracao * 100.0, x.mensagem);
    let mostrar = |v: serde_json::Value| -> Result<(), String> {
        println!(
            "{}",
            serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?
        );
        Ok(())
    };
    let sigtap = || -> Result<(sa_query::Consulta, Competencia), String> {
        let q = sa_query::Consulta::abrir(&o.banco).map_err(|e| e.to_string())?;
        let c = match o.competencia {
            Some(c) => c,
            None => q.mais_recente().map_err(|e| e.to_string())?,
        };
        Ok((q, c))
    };
    match cmd {
        "cnes-competencias" => mostrar(un::competencias_no_servidor(arg(0, "a UF")?)?),
        "cnes-baixar" => {
            let pedido = un::PedidoCnes {
                uf: arg(0, "a UF")?.to_string(),
                competencia: o.competencia.map(|c| c.to_string()).unwrap_or_default(),
            };
            println!(
                "{}",
                un::baixar_cnes(&p, &pedido, &AtomicBool::new(false), &progresso)?
            );
            Ok(())
        }
        "cnes-importar" => {
            let origem = o.origem.as_ref().ok_or("informe --origem PASTA")?;
            println!(
                "{}",
                un::importar_cnes(&p, origem, arg(0, "a UF")?, &progresso)?
            );
            Ok(())
        }
        "cnes-situacao" => mostrar(un::situacao(&p)),
        "cnes-buscar" => mostrar(un::buscar_estabelecimentos(
            &p,
            arg(0, "a UF")?,
            &livres[1..].join(" "),
        )?),
        "cnes-apagar" => {
            println!("{}", un::apagar_uf(&p, arg(0, "a UF")?)?);
            Ok(())
        }
        "unidade-definir" => mostrar(un::definir_minha(
            &p,
            arg(0, "a UF")?,
            arg(1, "o número do CNES")?,
        )?),
        "unidade-limpar" => un::limpar_minha(&p),
        "unidade" => {
            let (q, c) = sigtap()?;
            mostrar(un::unidade(&p, &q, c)?)
        }
        "aptidao" => {
            let (q, c) = sigtap()?;
            mostrar(un::aptidao(&p, &q, c, arg(0, "o código do procedimento")?)?)
        }
        "rede" => {
            let (q, c) = sigtap()?;
            mostrar(un::rede(
                &p,
                &q,
                c,
                arg(0, "o código do procedimento")?,
                &o.escopo,
            )?)
        }
        "favorito" => {
            let codigo = arg(0, "o código do procedimento")?;
            let u = un::usuario(&p)?;
            u.favoritar("procedimento", codigo, arg(1, "sim ou nao")? == "sim")
                .map_err(|e| e.to_string())?;
            mostrar(
                serde_json::to_value(
                    u.marcado("procedimento", codigo)
                        .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?,
            )
        }
        "anotar" => {
            let codigo = arg(0, "o código do procedimento")?;
            let u = un::usuario(&p)?;
            u.anotar("procedimento", codigo, &livres[1..].join(" "))
                .map_err(|e| e.to_string())?;
            mostrar(
                serde_json::to_value(
                    u.marcado("procedimento", codigo)
                        .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?,
            )
        }
        "marcado" => {
            let u = un::usuario(&p)?;
            mostrar(
                serde_json::to_value(
                    u.marcado("procedimento", arg(0, "o código do procedimento")?)
                        .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?,
            )
        }
        "marcados" => {
            let itens = un::usuario(&p)?
                .marcados("procedimento")
                .map_err(|e| e.to_string())?;
            let (q, c) = sigtap()?;
            mostrar(un::marcados_com_nome(&q, c, &itens)?)
        }
        _ => {
            let saida = o
                .saida
                .as_ref()
                .ok_or("informe --saida ARQUIVO.xlsx ou .csv")?;
            let planilha: sa_query::exportar::Planilha =
                serde_json::from_reader(std::io::stdin().lock())
                    .map_err(|e| format!("a planilha recebida não é válida ({e})"))?;
            planilha.validar()?;
            println!("{}", un::exportar(saida, &planilha, 0)?);
            Ok(())
        }
    }
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
        "territorio" => cmd_territorio(&o),
        "ficha" | "buscar" | "arvore" | "arvore-cid" | "ligados" | "historico" | "mudou" => {
            cmd_consulta(cmd.as_str(), &o)
        }
        "cnes-competencias" | "cnes-baixar" | "cnes-importar" | "cnes-situacao" | "cnes-buscar"
        | "cnes-apagar" | "unidade-definir" | "unidade-limpar" | "unidade" | "aptidao" | "rede"
        | "favorito" | "anotar" | "marcado" | "marcados" | "exportar" => {
            cmd_unidade(cmd.as_str(), &o)
        }
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
