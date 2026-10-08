//! Aplicativo desktop do SIGTAP Aberto.
//!
//! Portátil: tudo o que o programa grava fica na pasta do executável. A pasta de dados do
//! WebView2 (cache, cookies, armazenamento) é `dados_webview\` ao lado do `.exe`; sem isso
//! o WebView2 gravaria em `%LOCALAPPDATA%`. Os dados ficam em `dados\`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servico;
mod tarefas;
mod unidade;

use sa_core::Competencia;
use sa_download::atualizador;
use servico::{Emissor, Pastas, PedidoDownload, Servico};
use std::path::PathBuf;
use std::sync::Arc;
use tarefas::{Contexto, Fonte, Quando, Recibo};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
    window::Color,
};

type Estado<'a> = State<'a, Arc<Servico>>;

fn json<T: serde::Serialize>(v: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(v).map_err(|e| format!("falha ao montar a resposta ({e})"))
}

#[tauri::command]
async fn situacao(s: Estado<'_>) -> Result<serde_json::Value, String> {
    let s = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.situacao())
        .await
        .map_err(|e| format!("falha interna ao ler a situação ({e})"))?
}

#[tauri::command]
async fn arvore(
    s: Estado<'_>,
    competencia: Option<String>,
    pai: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        json(q.arvore(c, pai.as_deref()).map_err(|e| e.to_string())?)
    })
}

#[tauri::command]
async fn buscar(
    s: Estado<'_>,
    competencia: Option<String>,
    texto: String,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        json(q.buscar(c, &texto).map_err(|e| e.to_string())?)
    })
}

/// A busca com todos os procedimentos encontrados, para exportar a lista inteira.
#[tauri::command]
async fn buscar_todos(
    s: Estado<'_>,
    competencia: Option<String>,
    texto: String,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        json(q.buscar_todos(c, &texto).map_err(|e| e.to_string())?)
    })
}

#[tauri::command]
async fn ficha(
    s: Estado<'_>,
    competencia: Option<String>,
    codigo: String,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        json(q.ficha(c, &codigo).map_err(|e| e.to_string())?)
    })
}

#[tauri::command]
async fn historico(s: Estado<'_>, codigo: String) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| json(q.historico(&codigo).map_err(|e| e.to_string())?))
}

#[tauri::command]
async fn mudou(
    s: Estado<'_>,
    de: Option<String>,
    para: Option<String>,
    tabela: Option<String>,
    desde: Option<usize>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let para = s.competencia(q, para.as_deref())?;
        let de = match de.filter(|d| !d.is_empty()) {
            Some(d) => Competencia::de_texto(&d).map_err(|e| e.to_string())?,
            None => {
                let cs = q.competencias().map_err(|e| e.to_string())?;
                let pos = cs
                    .iter()
                    .position(|c| c.competencia == para.to_string())
                    .ok_or_else(|| format!("competência {para} não carregada"))?;
                if pos == 0 {
                    return Err(format!(
                        "não há competência carregada antes de {para}. Baixe o histórico em Módulos e dados para comparar."
                    ));
                }
                Competencia::de_texto(&cs[pos - 1].competencia).map_err(|e| e.to_string())?
            }
        };
        match tabela {
            // "Ver mais" de uma tabela.
            Some(t) => json(
                q.o_que_mudou_tabela(de, para, &t, desde.unwrap_or(0), sa_query::mudancas::LIMITE_ITENS)
                    .map_err(|e| e.to_string())?,
            ),
            None => json(
                q.o_que_mudou(de, para, sa_query::mudancas::LIMITE_ITENS)
                    .map_err(|e| e.to_string())?,
            ),
        }
    })
}

#[tauri::command]
async fn ligados(
    s: Estado<'_>,
    competencia: Option<String>,
    tabela: String,
    codigo: Vec<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        let cod: Vec<&str> = codigo.iter().map(String::as_str).collect();
        json(
            q.procedimentos_ligados(c, &tabela, &cod)
                .map_err(|e| e.to_string())?,
        )
    })
}

#[tauri::command]
async fn arvore_cid(
    s: Estado<'_>,
    competencia: Option<String>,
    pai: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        json(q.arvore_cid(c, pai.as_deref()).map_err(|e| e.to_string())?)
    })
}

/// Confere a integridade dos bancos (rápida ou completa).
#[tauri::command]
async fn verificar_bancos(s: Estado<'_>, completo: bool) -> Result<serde_json::Value, String> {
    let s = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.verificar_bancos(completo))
        .await
        .map_err(|e| format!("falha interna na verificação ({e})"))
}

/// Refaz os bancos a partir dos ZIPs e arquivos guardados.
#[tauri::command]
fn recriar_banco(app: AppHandle, s: Estado<'_>, forcar: Option<bool>) -> Result<Recibo, String> {
    let s = s.inner().clone();
    let forcar = forcar.unwrap_or(true);
    em_segundo_plano(
        app,
        s,
        Fonte::Sigtap,
        "SIGTAP",
        None,
        move |sv, ctx, emissor, ao_dados| sv.recriar_com(&ctx.cancelar, emissor, ao_dados, forcar),
    )
}

/// Há dados novos no servidor oficial? (não baixa nada)
#[tauri::command]
async fn verificar_dados(s: Estado<'_>) -> Result<serde_json::Value, String> {
    let s = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.verificar_dados())
        .await
        .map_err(|e| format!("falha interna na verificação ({e})"))?
}

/// Perfil de usuário do GitHub (`https://github.com/<login>`), usado na lista de contribuidores.
fn perfil_github(u: &str) -> bool {
    // Regra do GitHub: letras e números, hífens só no meio e nunca dois seguidos.
    u.strip_prefix("https://github.com/").is_some_and(|l| {
        !l.is_empty()
            && l.len() <= 39
            && !l.starts_with('-')
            && !l.ends_with('-')
            && !l.contains("--")
            && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

/// Endereços que o programa abre no navegador: o site do SIGTAP e o repositório do projeto
/// (feedback, lançamentos, apoio). A interface não abre endereço qualquer.
fn url_permitida(u: &str) -> bool {
    let limpo = !u
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '"' || c == '<' || c == '>');
    let repo = format!("https://github.com/{}", sa_core::REPOSITORIO);
    limpo
        && u.len() <= 7000
        && (u == sa_core::SITE_SIGTAP
            || u.starts_with("http://sigtap.datasus.gov.br/")
            || u == repo
            || u.starts_with(&format!("{repo}/"))
            || u.starts_with(&format!("{repo}?"))
            || u.starts_with("https://github.com/sponsors/")
            || perfil_github(u)
            || u == "https://cnes.datasus.gov.br/"
            || u.starts_with("https://cnes.datasus.gov.br/")
            || u == "https://novagentecnologia.com.br"
            || u.starts_with("https://novagentecnologia.com.br/")
            || u.starts_with("mailto:"))
}

#[tauri::command]
fn abrir_site(url: String) -> Result<(), String> {
    if !url_permitida(&url) {
        return Err("endereço não permitido".into());
    }
    #[cfg(windows)]
    let r = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| {
        format!(
            "não foi possível abrir o navegador ({e}). Copie o endereço e cole no navegador: {url}"
        )
    })
}

/// Versão, repositório e dados do computador para o "Sobre" e o feedback. Nada de paciente.
#[tauri::command]
fn info_programa() -> serde_json::Value {
    #[cfg(windows)]
    let windows = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .creation_flags(0x0800_0000)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    #[cfg(not(windows))]
    let windows: Option<String> = None;
    serde_json::json!({
        "versao": sa_core::VERSAO,
        "repositorio": sa_core::REPOSITORIO,
        "site_sigtap": sa_core::SITE_SIGTAP,
        "so": std::env::consts::OS,
        "arquitetura": std::env::consts::ARCH,
        "windows": windows,
        "webview2": tauri::webview_version().ok(),
    })
}

/// Consulta o último lançamento do programa no GitHub.
#[tauri::command]
async fn consultar_atualizacao() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sem_cancelar = std::sync::atomic::AtomicBool::new(false);
        let l = atualizador::consultar(sa_core::REPOSITORIO, &sem_cancelar)
            .map_err(|e| e.to_string())?;
        let nova = l.filter(|l| atualizador::e_mais_nova(sa_core::VERSAO, &l.versao));
        Ok(serde_json::json!({
            "atual": sa_core::VERSAO,
            "nova": nova,
            "automatica": atualizador::TROCA_AUTOMATICA,
        }))
    })
    .await
    .map_err(|e| format!("falha interna na consulta ({e})"))?
}

/// Baixa a versão nova, confere o SHA-256, troca o executável e reabre o programa.
/// Exclusiva: não começa com nenhum download em andamento.
#[tauri::command]
fn atualizar_programa(app: AppHandle, s: Estado<'_>) -> Result<Recibo, String> {
    if !atualizador::TROCA_AUTOMATICA {
        return Err("neste sistema o programa ainda não se troca sozinho: baixe a versão nova na página do lançamento (botão Ver a versão nova).".into());
    }
    let s = s.inner().clone();
    if s.ocupado() {
        return Err(
            "há uma tarefa em andamento. Espere terminar ou cancele, e atualize depois.".into(),
        );
    }
    let app2 = app.clone();
    em_segundo_plano(
        app,
        s,
        Fonte::Sigtap,
        "Atualização do programa",
        None,
        move |sv, ctx, _, _| {
            let avisar = |msg: &str, frac: f64| {
                let _ = app2.emit(
                    "progresso",
                    servico::ProgressoDeTarefa {
                        fonte: ctx.fonte,
                        tarefa: ctx.tarefa,
                        rotulo: "Atualização do programa".into(),
                        fase: servico::Fase::Baixando,
                        progresso: servico::Progresso {
                            resumo: "Atualizando o programa".into(),
                            mensagem: msg.into(),
                            fracao: frac,
                            indeterminado: false,
                        },
                    },
                );
            };
            let exe = std::env::current_exe()
                .map_err(|e| format!("não foi possível localizar o executável ({e})"))?;
            avisar("Consultando a versão mais recente", 0.05);
            let l = atualizador::consultar(sa_core::REPOSITORIO, &ctx.cancelar)
                .map_err(|e| e.to_string())?
                .filter(|l| atualizador::e_mais_nova(sa_core::VERSAO, &l.versao))
                .ok_or("não há versão nova para instalar")?;
            avisar(
                &format!("Baixando a versão {} e conferindo o SHA-256", l.versao),
                0.2,
            );
            let novo = atualizador::baixar_e_preparar(
                &l,
                sa_core::REPOSITORIO,
                &sv.pastas.dados.join("atualizacao"),
                &ctx.cancelar,
            )
            .map_err(|e| e.to_string())?;
            avisar("Trocando o programa", 0.9);
            atualizador::trocar(&exe, &novo).map_err(|e| e.to_string())?;
            std::process::Command::new(&exe)
            .arg("--apos-atualizacao")
            .spawn()
            .map_err(|e| format!("a versão {} foi instalada, mas não abriu sozinha ({e}). Abra o programa de novo", l.versao))?;
            app2.exit(0);
            Ok(l.versao)
        },
    )
}

/// Roda uma tarefa longa em segundo plano na vaga da `fonte`: uma por vez em cada fonte (as
/// seguintes, com `quando = "depois"`, esperam na fila), e fontes diferentes andam juntas.
/// Eventos: `progresso` (com fonte e tarefa), `dados_atualizados` e `tarefa_fim` (pela Agenda).
fn em_segundo_plano(
    app: AppHandle,
    s: Arc<Servico>,
    fonte: Fonte,
    rotulo: &str,
    quando: Option<Quando>,
    tarefa: impl FnOnce(&Servico, &Contexto, &Emissor, &(dyn Fn(bool) + Sync)) -> Result<String, String>
    + Send
    + 'static,
) -> Result<Recibo, String> {
    s.exigir_sem_bloqueio()?;
    let (sv, nome) = (s.clone(), rotulo.to_string());
    let trabalho: tarefas::Trabalho = Box::new(move |ctx| {
        let (a, r, id) = (app.clone(), nome.clone(), ctx.tarefa);
        let emissor: Emissor = Arc::new(move |p| {
            let _ = a.emit(
                "progresso",
                servico::ProgressoDeTarefa {
                    fonte,
                    tarefa: id,
                    rotulo: r.clone(),
                    fase: servico::fase_da_mensagem(&p.mensagem),
                    progresso: p,
                },
            );
        });
        let (a, s2) = (app.clone(), sv.clone());
        let ao_dados = move |reabrir: bool| {
            if reabrir
                && fonte == Fonte::Sigtap
                && let Err(e) = s2.reabrir()
            {
                eprintln!("Aviso: {e}");
            }
            let _ = a.emit("dados_atualizados", ());
        };
        let r = tarefa(&sv, ctx, &emissor, &ao_dados);
        // A consulta do SIGTAP só é reaberta depois de tarefas do SIGTAP.
        let reaberto = if fonte == Fonte::Sigtap {
            sv.reabrir()
        } else {
            Ok(())
        };
        match (r, reaberto) {
            (Ok(m), Ok(())) => Ok(m),
            (Err(e), _) | (Ok(_), Err(e)) => Err(e),
        }
    });
    s.agenda
        .enviar(fonte, rotulo, quando.unwrap_or_default(), trabalho)
}

#[tauri::command]
fn baixar(
    app: AppHandle,
    s: Estado<'_>,
    pedido: PedidoDownload,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    em_segundo_plano(
        app,
        s,
        Fonte::Sigtap,
        "SIGTAP",
        quando,
        move |sv, ctx, emissor, ao_dados| {
            // Um só interruptor para todas as fontes: sem "Manter arquivos baixados", o ZIP sai depois de carregado.
            let mut pedido = pedido.clone();
            pedido.apagar_zips = !unidade::producao::manter_brutos(&unidade::local(&sv.pastas));
            servico::executar_download(&sv.pastas, &pedido, &ctx.cancelar, emissor, ao_dados)
        },
    )
}

#[tauri::command]
fn importar(
    app: AppHandle,
    s: Estado<'_>,
    pasta: String,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    em_segundo_plano(
        app,
        s,
        Fonte::Sigtap,
        "SIGTAP",
        quando,
        move |sv, ctx, emissor, _| {
            let apagar = !unidade::producao::manter_brutos(&unidade::local(&sv.pastas));
            servico::importar(
                &sv.pastas,
                &PathBuf::from(pasta),
                &ctx.cancelar,
                emissor,
                apagar,
            )
        },
    )
}

/// Cancela a fonte pedida (a tarefa em andamento e a fila dela) ou, sem fonte, todas.
#[tauri::command]
fn cancelar(s: Estado<'_>, fonte: Option<Fonte>) {
    match fonte {
        Some(f) => s.agenda.cancelar(f),
        None => s.agenda.cancelar_tudo(),
    }
}

/// Fechar a janela com download em andamento pede confirmação à interface.
pub(crate) fn deve_pedir_confirmacao(agenda: &tarefas::Agenda) -> bool {
    agenda.alguma()
}

/// Confirmação do usuário: cancela o que está em andamento e fecha o programa.
#[tauri::command]
fn fechar_programa(app: AppHandle, s: Estado<'_>) {
    s.agenda.cancelar_tudo();
    app.exit(0);
}

/// Competências do servidor, para os tamanhos dos downloads parciais.
#[tauri::command]
async fn ofertas(s: Estado<'_>, de_novo: Option<bool>) -> Result<serde_json::Value, String> {
    let s = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.ofertas(de_novo.unwrap_or(false)))
        .await
        .map_err(|e| format!("falha interna ao listar o servidor ({e})"))?
}

#[tauri::command]
async fn apagar_zips(s: Estado<'_>) -> Result<String, String> {
    let s = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.apagar_zips())
        .await
        .map_err(|e| format!("falha interna ao apagar os ZIPs ({e})"))?
}

// ---- Fase 3: CNES, minha unidade, favoritos, anotações e exportação ----

/// Situação do módulo CNES: UFs carregadas, competência de cada uma e a unidade escolhida.
#[tauri::command]
async fn cnes_situacao(s: Estado<'_>) -> Result<serde_json::Value, String> {
    Ok(unidade::situacao(&unidade::local(&s.pastas)))
}

#[tauri::command]
fn cnes_baixar(
    app: AppHandle,
    s: Estado<'_>,
    pedido: unidade::PedidoCnes,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    let rotulo = format!("CNES de {}", pedido.uf);
    em_segundo_plano(
        app,
        s,
        Fonte::Cnes,
        &rotulo,
        quando,
        move |sv, ctx, emissor, _| {
            unidade::baixar_cnes(
                &unidade::local(&sv.pastas),
                &pedido,
                &ctx.cancelar,
                &unidade::repassar(emissor),
            )
        },
    )
}

#[tauri::command]
fn cnes_importar(
    app: AppHandle,
    s: Estado<'_>,
    pasta: String,
    uf: String,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    let rotulo = format!("CNES de {uf}");
    em_segundo_plano(
        app,
        s,
        Fonte::Cnes,
        &rotulo,
        quando,
        move |sv, _, emissor, _| {
            unidade::importar_cnes(
                &unidade::local(&sv.pastas),
                &PathBuf::from(pasta),
                &uf,
                &unidade::repassar(emissor),
            )
        },
    )
}

/// Competências do CNES que o servidor oficial tem para a UF.
#[tauri::command]
async fn cnes_competencias(uf: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || unidade::competencias_no_servidor(&uf))
        .await
        .map_err(|e| format!("falha interna ao listar o servidor ({e})"))?
}

/// Há CNES mais novo no servidor para as UFs carregadas?
#[tauri::command]
async fn cnes_verificar(s: Estado<'_>) -> Result<serde_json::Value, String> {
    let p = unidade::local(&s.pastas);
    tauri::async_runtime::spawn_blocking(move || unidade::verificar_cnes(&p))
        .await
        .map_err(|e| format!("falha interna ao consultar o servidor ({e})"))
}

#[tauri::command]
async fn cnes_apagar(s: Estado<'_>, uf: String) -> Result<String, String> {
    if s.agenda.ocupada(Fonte::Cnes) {
        return Err("há um download do CNES em andamento. Espere terminar ou cancele.".into());
    }
    unidade::apagar_uf(&unidade::local(&s.pastas), &uf)
}

#[tauri::command]
async fn cnes_buscar(
    s: Estado<'_>,
    uf: String,
    texto: String,
) -> Result<serde_json::Value, String> {
    unidade::buscar_estabelecimentos(&unidade::local(&s.pastas), &uf, &texto)
}

#[tauri::command]
async fn unidade_definir(
    s: Estado<'_>,
    uf: String,
    cnes: String,
) -> Result<serde_json::Value, String> {
    unidade::definir_minha(&unidade::local(&s.pastas), &uf, &cnes)
}

#[tauri::command]
async fn unidade_limpar(s: Estado<'_>) -> Result<(), String> {
    unidade::limpar_minha(&unidade::local(&s.pastas))
}

/// Tira uma unidade da lista de troca rápida.
#[tauri::command]
async fn unidade_remover(s: Estado<'_>, uf: String, cnes: String) -> Result<(), String> {
    unidade::remover_unidade(&unidade::local(&s.pastas), &uf, &cnes)
}

/// Cadastra um terceiro contratado da unidade `uf`/`cnes`.
#[tauri::command]
async fn terceiro_adicionar(
    s: Estado<'_>,
    uf: String,
    cnes: String,
    terceiro_uf: String,
    terceiro_cnes: String,
) -> Result<serde_json::Value, String> {
    unidade::adicionar_terceiro(
        &unidade::local(&s.pastas),
        &uf,
        &cnes,
        &terceiro_uf,
        &terceiro_cnes,
    )
}

#[tauri::command]
async fn terceiro_remover(
    s: Estado<'_>,
    uf: String,
    cnes: String,
    terceiro_uf: String,
    terceiro_cnes: String,
) -> Result<(), String> {
    unidade::remover_terceiro(
        &unidade::local(&s.pastas),
        &uf,
        &cnes,
        &terceiro_uf,
        &terceiro_cnes,
    )
}

/// Uma unidade completa: a indicada (UF e CNES) ou, sem indicação, a ativa.
#[tauri::command]
async fn unidade_ver(
    s: Estado<'_>,
    competencia: Option<String>,
    uf: Option<String>,
    cnes: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        let alvo = uf.as_deref().zip(cnes.as_deref());
        unidade::unidade(&unidade::local(&s.pastas), q, c, alvo)
    })
}

/// Marcador de habilitação da unidade ativa para uma lista de procedimentos.
#[tauri::command]
async fn marcadores(
    s: Estado<'_>,
    competencia: Option<String>,
    codigos: Vec<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::marcadores(&unidade::local(&s.pastas), q, c, &codigos)
    })
}

/// Procedimentos que uma unidade pode cobrar pelo cadastro.
#[tauri::command]
async fn unidade_procedimentos(
    s: Estado<'_>,
    competencia: Option<String>,
    uf: String,
    cnes: String,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::procedimentos_da_unidade(&unidade::local(&s.pastas), q, c, &uf, &cnes)
    })
}

/// Estabelecimentos por nome ou número, em todas as UFs carregadas (busca da barra).
#[tauri::command]
async fn unidades_buscar(s: Estado<'_>, texto: String) -> Result<serde_json::Value, String> {
    Ok(unidade::buscar_unidades(
        &unidade::local(&s.pastas),
        &texto,
        8,
    ))
}

/// "Minha unidade está apta?" para um procedimento. `null` sem unidade escolhida.
#[tauri::command]
async fn aptidao(
    s: Estado<'_>,
    competencia: Option<String>,
    codigo: String,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::aptidao(&unidade::local(&s.pastas), q, c, &codigo)
    })
}

/// "Quem faz na rede": município, região de saúde e UF da unidade escolhida.
#[tauri::command]
async fn rede(
    s: Estado<'_>,
    competencia: Option<String>,
    codigo: String,
    escopo: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::rede(
            &unidade::local(&s.pastas),
            q,
            c,
            &codigo,
            escopo.as_deref().unwrap_or("municipio"),
        )
    })
}

// ---- Fase 4: produção do SUS (SIA, SIH) e rejeições ----

/// Situação do módulo de produção: UFs carregadas e os arquivos somados.
#[tauri::command]
async fn producao_situacao(s: Estado<'_>) -> Result<serde_json::Value, String> {
    Ok(unidade::producao::situacao_producao(&unidade::local(
        &s.pastas,
    )))
}

/// O que seria baixado (arquivos e tamanho), para o usuário confirmar antes.
#[tauri::command]
async fn producao_plano(uf: String, meses: Option<usize>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unidade::producao::plano_producao(&uf, meses.unwrap_or(0))
    })
    .await
    .map_err(|e| format!("falha interna ao consultar o servidor ({e})"))?
}

#[tauri::command]
fn producao_baixar(
    app: AppHandle,
    s: Estado<'_>,
    pedido: unidade::producao::PedidoProducao,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    em_segundo_plano(
        app,
        s,
        Fonte::Producao,
        "Produção",
        quando,
        move |sv, ctx, emissor, _| {
            unidade::producao::baixar_producao(
                &unidade::local(&sv.pastas),
                &pedido,
                &ctx.cancelar,
                &unidade::repassar(emissor),
            )
        },
    )
}

#[tauri::command]
fn producao_importar(
    app: AppHandle,
    s: Estado<'_>,
    pasta: String,
    uf: String,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    em_segundo_plano(
        app,
        s,
        Fonte::Producao,
        "Produção",
        quando,
        move |sv, _, emissor, _| {
            unidade::producao::importar_producao(
                &unidade::local(&sv.pastas),
                &PathBuf::from(pasta),
                &uf,
                &unidade::repassar(emissor),
            )
        },
    )
}

#[tauri::command]
async fn producao_apagar(s: Estado<'_>, uf: String) -> Result<String, String> {
    if s.agenda.ocupada(Fonte::Producao) {
        return Err("há um download da produção em andamento. Espere terminar ou cancele.".into());
    }
    unidade::producao::apagar_producao(&unidade::local(&s.pastas), &uf)
}

/// A chave "guardar os arquivos baixados" (padrão: desligada).
#[tauri::command]
async fn manter_brutos_obter(s: Estado<'_>) -> Result<bool, String> {
    Ok(unidade::producao::manter_brutos(&unidade::local(&s.pastas)))
}

#[tauri::command]
async fn manter_brutos_definir(s: Estado<'_>, ligada: bool) -> Result<bool, String> {
    let p = unidade::local(&s.pastas);
    unidade::producao::definir_manter_brutos(&p, ligada)?;
    Ok(unidade::producao::manter_brutos(&p))
}

/// Refaz a produção da UF dos arquivos guardados, sem baixar nada.
#[tauri::command]
fn producao_reconstruir(
    app: AppHandle,
    s: Estado<'_>,
    uf: String,
    quando: Option<Quando>,
) -> Result<Recibo, String> {
    let s = s.inner().clone();
    em_segundo_plano(
        app,
        s,
        Fonte::Producao,
        "Produção",
        quando,
        move |sv, _, emissor, _| {
            unidade::producao::reconstruir_producao(
                &unidade::local(&sv.pastas),
                &uf,
                &unidade::repassar(emissor),
            )
        },
    )
}

#[tauri::command]
async fn producao_apagar_guardados(s: Estado<'_>, uf: String) -> Result<String, String> {
    if s.agenda.ocupada(Fonte::Producao) {
        return Err("há um download da produção em andamento. Espere terminar ou cancele.".into());
    }
    unidade::producao::apagar_guardados(&unidade::local(&s.pastas), &uf)
}

/// Quem produziu o procedimento na UF da unidade escolhida (ou na `uf` pedida).
#[tauri::command]
async fn producao_procedimento(
    s: Estado<'_>,
    competencia: Option<String>,
    codigo: String,
    uf: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::producao::producao_do_procedimento(
            &unidade::local(&s.pastas),
            q,
            c,
            &codigo,
            uf.as_deref(),
        )
    })
}

/// O que a unidade produziu e o que o SIH rejeitou nela.
#[tauri::command]
async fn producao_unidade(
    s: Estado<'_>,
    competencia: Option<String>,
    uf: Option<String>,
    cnes: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        let alvo = uf.as_deref().zip(cnes.as_deref());
        unidade::producao::producao_da_unidade(&unidade::local(&s.pastas), q, c, alvo)
    })
}

/// Rejeições, tendência, curva ABC, apresentado x aprovado, financiamento, leitos e pares da unidade.
#[tauri::command]
async fn faturamento_unidade(
    s: Estado<'_>,
    competencia: Option<String>,
    uf: Option<String>,
    cnes: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        let alvo = uf.as_deref().zip(cnes.as_deref());
        unidade::faturamento::faturamento_da_unidade(&unidade::local(&s.pastas), q, c, alvo)
    })
}

/// Procedimentos da unidade diante da aptidão e da produção, e habilitações com a produção delas.
#[tauri::command]
async fn faturamento_procedimentos(
    s: Estado<'_>,
    competencia: Option<String>,
    uf: Option<String>,
    cnes: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        let alvo = uf.as_deref().zip(cnes.as_deref());
        unidade::faturamento::procedimentos_com_producao(&unidade::local(&s.pastas), q, c, alvo)
    })
}

/// Um procedimento na UF: série mensal, tendência, concentração, financiamento, mudanças de valor.
#[tauri::command]
async fn faturamento_procedimento(
    s: Estado<'_>,
    competencia: Option<String>,
    codigo: String,
    uf: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::faturamento::faturamento_do_procedimento(
            &unidade::local(&s.pastas),
            q,
            c,
            &codigo,
            uf.as_deref(),
        )
    })
}

/// Impacto financeiro estimado das mudanças da tabela na produção.
#[tauri::command]
async fn faturamento_impacto(
    s: Estado<'_>,
    de: Option<String>,
    para: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let para = s.competencia(q, para.as_deref())?;
        let de = match de.filter(|d| !d.is_empty()) {
            Some(d) => Some(Competencia::de_texto(&d).map_err(|e| e.to_string())?),
            None => None,
        };
        unidade::faturamento::impacto_das_mudancas(&unidade::local(&s.pastas), q, de, para, None)
    })
}

/// Painel do faturista da unidade ativa (tela de início).
#[tauri::command]
async fn faturamento_painel(
    s: Estado<'_>,
    competencia: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::faturamento::painel_do_faturista(&unidade::local(&s.pastas), q, c)
    })
}

#[tauri::command]
async fn marcar_favorito(
    s: Estado<'_>,
    tipo: String,
    codigo: String,
    favorito: bool,
) -> Result<serde_json::Value, String> {
    let u = unidade::usuario(&unidade::local(&s.pastas))?;
    u.favoritar(&tipo, &codigo, favorito)
        .map_err(|e| e.to_string())?;
    json(u.marcado(&tipo, &codigo).map_err(|e| e.to_string())?)
}

#[tauri::command]
async fn anotar(
    s: Estado<'_>,
    tipo: String,
    codigo: String,
    texto: String,
) -> Result<serde_json::Value, String> {
    let u = unidade::usuario(&unidade::local(&s.pastas))?;
    u.anotar(&tipo, &codigo, &texto)
        .map_err(|e| e.to_string())?;
    json(u.marcado(&tipo, &codigo).map_err(|e| e.to_string())?)
}

#[tauri::command]
async fn marcado(s: Estado<'_>, tipo: String, codigo: String) -> Result<serde_json::Value, String> {
    json(
        unidade::usuario(&unidade::local(&s.pastas))?
            .marcado(&tipo, &codigo)
            .map_err(|e| e.to_string())?,
    )
}

/// Favoritos e anotações do tipo, com o nome de cada procedimento na competência pedida.
#[tauri::command]
async fn marcados(
    s: Estado<'_>,
    tipo: String,
    competencia: Option<String>,
) -> Result<serde_json::Value, String> {
    let itens = unidade::usuario(&unidade::local(&s.pastas))?
        .marcados(&tipo)
        .map_err(|e| e.to_string())?;
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::marcados_com_nome(q, c, &itens)
    })
}

/// Exporta uma planilha montada pela interface. Abre a janela "Salvar como"; a extensão
/// escolhida (.xlsx ou .csv) decide o formato. Devolve `null` se o usuário desistir.
#[tauri::command]
async fn exportar(
    app: AppHandle,
    planilha: sa_query::exportar::Planilha,
    nome: String,
    aba: Option<usize>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    planilha.validar()?;
    let limpo: String = nome
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "-_ .".contains(c) {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let Some(destino) = app
        .dialog()
        .file()
        .set_title("Exportar")
        .set_file_name(format!("{limpo}.xlsx"))
        .add_filter("Planilha do Excel (.xlsx)", &["xlsx"])
        .add_filter("Texto separado por ponto e vírgula (.csv)", &["csv"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    unidade::exportar(&destino, &planilha, aba.unwrap_or(0)).map(Some)
}

/// Janela do Windows para escolher a pasta de importação.
#[tauri::command]
async fn escolher_pasta(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Escolha a pasta com os arquivos para importar")
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.display().to_string())
}

/// Pasta onde o programa guarda tudo o que grava: ao lado do executável (Windows), do arquivo
/// `.AppImage` (Linux) ou do `SIGTAP Aberto.app` (macOS). Nada vai para pastas do sistema.
fn pasta_do_programa() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Não foi possível localizar o executável ({e}). Copie o programa para uma pasta sua e abra de novo."))?;
    // Só o Linux tem AppImage; em outro sistema a variável é ignorada.
    let appimage = if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
    } else {
        None
    };
    pasta_para(&exe, appimage.as_deref())
}

/// Regra da pasta de dados, separada para testar em qualquer sistema.
fn pasta_para(
    exe: &std::path::Path,
    appimage: Option<&std::path::Path>,
) -> Result<PathBuf, String> {
    const MOVER: &str = "Arraste a pasta do SIGTAP Aberto para um lugar seu (por exemplo, Documentos) e abra o programa de lá.";
    // Linux, AppImage: o executável roda de uma montagem só de leitura; vale a pasta do .AppImage.
    if let Some(a) = appimage {
        return a
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("Não foi possível identificar a pasta do AppImage. {MOVER}"));
    }
    let texto = exe.to_string_lossy();
    // macOS: aberto direto do download, o sistema copia o app para uma pasta temporária só de leitura.
    if texto.contains("/AppTranslocation/") {
        return Err(format!(
            "O macOS abriu o programa numa pasta temporária, onde ele não consegue gravar. {MOVER}"
        ));
    }
    // macOS: .../SIGTAP Aberto.app/Contents/MacOS/<exe> -> pasta que contém o .app.
    let pais: Vec<&std::path::Path> = exe.ancestors().collect();
    if pais.len() > 3
        && pais[1].file_name().is_some_and(|n| n == "MacOS")
        && pais[2].file_name().is_some_and(|n| n == "Contents")
        && pais[3].extension().is_some_and(|e| e == "app")
    {
        return pais[3]
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| format!("Não foi possível identificar a pasta do programa. {MOVER}"));
    }
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Não foi possível identificar a pasta do executável. Copie o programa para uma pasta sua e abra de novo.".to_string())
}

/// Mostra um erro de abertura antes da janela existir (no macOS e no Linux não há console).
fn avisar_e_sair(msg: &str) -> ! {
    eprintln!("{msg}");
    #[cfg(target_os = "macos")]
    {
        let texto = msg.replace('\\', "\\\\").replace('"', "\\\"");
        let _ = std::process::Command::new("osascript")
            .args([
                "-e",
                &format!("display alert \"SIGTAP Aberto\" message \"{texto}\" as critical"),
            ])
            .status();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("zenity")
            .args(["--error", "--title=SIGTAP Aberto", &format!("--text={msg}")])
            .status();
    }
    std::process::exit(1);
}

fn main() {
    let pasta = match pasta_do_programa() {
        Ok(p) => p,
        Err(msg) => avisar_e_sair(&msg),
    };
    // Depois de uma atualização, o programa novo espera o antigo fechar e apaga os restos.
    if std::env::args().any(|a| a == "--apos-atualizacao") {
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }
    if let Ok(exe) = std::env::current_exe() {
        atualizador::limpar_restos(&exe, &pasta.join("dados"));
    }
    let dados_webview = pasta.join("dados_webview");
    let servico = Arc::new(Servico::new_ou_sair(Pastas {
        dados: pasta.join("dados"),
    }));

    let para_eventos = servico.clone();
    let resultado = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(servico)
        .invoke_handler(tauri::generate_handler![
            situacao,
            arvore,
            arvore_cid,
            verificar_bancos,
            recriar_banco,
            verificar_dados,
            abrir_site,
            info_programa,
            consultar_atualizacao,
            atualizar_programa,
            buscar,
            buscar_todos,
            ficha,
            historico,
            mudou,
            ligados,
            baixar,
            importar,
            cancelar,
            ofertas,
            apagar_zips,
            escolher_pasta,
            cnes_situacao,
            cnes_baixar,
            cnes_importar,
            cnes_competencias,
            cnes_apagar,
            cnes_verificar,
            cnes_buscar,
            unidade_definir,
            unidade_limpar,
            unidade_ver,
            unidade_remover,
            marcadores,
            terceiro_adicionar,
            terceiro_remover,
            unidade_procedimentos,
            unidades_buscar,
            aptidao,
            rede,
            producao_situacao,
            producao_plano,
            producao_baixar,
            producao_importar,
            producao_apagar,
            manter_brutos_obter,
            manter_brutos_definir,
            producao_reconstruir,
            producao_apagar_guardados,
            producao_procedimento,
            producao_unidade,
            faturamento_unidade,
            faturamento_procedimentos,
            faturamento_procedimento,
            faturamento_impacto,
            faturamento_painel,
            marcar_favorito,
            anotar,
            marcado,
            marcados,
            exportar,
            fechar_programa
        ])
        .on_window_event(|janela, evento| {
            if let WindowEvent::CloseRequested { api, .. } = evento {
                let servico = janela.state::<Arc<Servico>>();
                if deve_pedir_confirmacao(&servico.agenda) {
                    api.prevent_close();
                    let _ = janela.emit("pedido_de_fechar", ());
                }
            }
        })
        .setup(move |app| {
            let h = app.handle().clone();
            para_eventos.ligar_eventos(move |f| {
                let _ = h.emit("tarefa_fim", f);
            });
            let janela = WebviewWindowBuilder::new(app, "principal", WebviewUrl::App("index.html".into()))
                .title(format!("SIGTAP Aberto {}", sa_core::VERSAO))
                .inner_size(1360.0, 860.0)
                .min_inner_size(1024.0, 640.0)
                // Mesma cor de fundo da página: sem o flash preto do WebView2 antes do primeiro quadro.
                .background_color(Color(242, 244, 247, 255))
                .data_directory(dados_webview.clone());
            #[cfg(all(windows, feature = "depuracao-remota"))]
            let janela = match std::env::var("SA_DEPURACAO_PORTA").ok().and_then(|p| p.parse::<u16>().ok()) {
                // Só em compilação de desenvolvimento: o WebView2 recente ignora a variável de ambiente do
                // próprio WebView2, então a porta vai pelo mesmo canal dos argumentos que o Tauri já usa.
                Some(porta) => janela.additional_browser_args(&format!(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --remote-debugging-port={porta}"
                )),
                None => janela,
            };
            janela.build()?;
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = resultado {
        eprintln!(
            "O SIGTAP Aberto não conseguiu abrir a janela: {e}. \
             Verifique se o Microsoft Edge WebView2 Runtime está instalado \
             (https://developer.microsoft.com/microsoft-edge/webview2/) e tente de novo."
        );
        std::process::exit(1);
    }
}

impl Servico {
    /// Cria o serviço e abre o banco, se houver. Um banco ilegível não impede a janela: a
    /// interface mostra o erro em Módulos e dados.
    fn new_ou_sair(pastas: Pastas) -> Self {
        let s = Servico::novo(pastas);
        s.iniciar();
        s
    }
}

#[cfg(test)]
mod testes {
    use super::{pasta_para, url_permitida};
    use std::path::{Path, PathBuf};

    #[test]
    fn pasta_de_dados_em_cada_sistema() {
        // Windows (e qualquer executável solto): a pasta do executável.
        assert_eq!(
            pasta_para(Path::new("/d/SIGTAP Aberto/sigtap-aberto.exe"), None).unwrap(),
            PathBuf::from("/d/SIGTAP Aberto")
        );
        // Linux, AppImage: a pasta do .AppImage, não a montagem temporária.
        assert_eq!(
            pasta_para(
                Path::new("/tmp/.mount_SIGTAPx/usr/bin/sigtap-aberto"),
                Some(Path::new(
                    "/home/ana/SIGTAP/SIGTAP-Aberto-linux-x64.AppImage"
                ))
            )
            .unwrap(),
            PathBuf::from("/home/ana/SIGTAP")
        );
        // macOS: a pasta que contém o .app.
        assert_eq!(
            pasta_para(
                Path::new("/Users/ana/Documents/SIGTAP Aberto/SIGTAP Aberto.app/Contents/MacOS/sigtap-aberto"),
                None
            )
            .unwrap(),
            PathBuf::from("/Users/ana/Documents/SIGTAP Aberto")
        );
        // macOS aberto direto do download (App Translocation): recusa com orientação.
        let e = pasta_para(
            Path::new("/private/var/folders/x/AppTranslocation/ABC/d/SIGTAP Aberto.app/Contents/MacOS/sigtap-aberto"),
            None,
        )
        .unwrap_err();
        assert!(e.contains("Arraste"), "{e}");
    }

    #[test]
    fn so_abre_enderecos_do_projeto_e_do_sigtap() {
        let repo = format!("https://github.com/{}", sa_core::REPOSITORIO);
        for ok in [
            sa_core::SITE_SIGTAP.to_string(),
            format!("{repo}/issues/new?title=a%20b&body=c%0Ad&labels=bug"),
            repo.clone(),
            "https://github.com/sponsors/alguem".to_string(),
            "https://github.com/alguem-1".to_string(),
            "https://cnes.datasus.gov.br/".to_string(),
            "https://novagentecnologia.com.br".to_string(),
            "mailto:contato@exemplo.com.br?subject=Oi%20mundo".to_string(),
        ] {
            assert!(url_permitida(&ok), "{ok}");
        }
        for ruim in [
            "https://exemplo.com/".to_string(),
            "file:///C:/Windows/System32/calc.exe".to_string(),
            "javascript:alert(1)".to_string(),
            format!("{repo}x/outro"),
            format!("{repo}/issues/new?title=a b"),
            "https://github.com/outro/repo".to_string(),
            "https://github.com/-x".to_string(),
            "https://github.com/x-".to_string(),
            "https://github.com/a--b".to_string(),
            format!("{repo}/\"\n"),
        ] {
            assert!(!url_permitida(&ruim), "{ruim:?}");
        }
    }
}
