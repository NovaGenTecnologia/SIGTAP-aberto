//! Aplicativo desktop do SIGTAP Aberto.
//!
//! Portátil: tudo o que o programa grava fica na pasta do executável. A pasta de dados do
//! WebView2 (cache, cookies, armazenamento) é `dados_webview\` ao lado do `.exe`; sem isso
//! o WebView2 gravaria em `%LOCALAPPDATA%`. Os dados ficam em `dados\`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servico;
mod unidade;

use sa_core::Competencia;
use sa_download::atualizador;
use servico::{Emissor, FimTarefa, Pastas, PedidoDownload, Servico};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindowBuilder};

type Estado<'a> = State<'a, Arc<Servico>>;

fn json<T: serde::Serialize>(v: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(v).map_err(|e| format!("falha ao montar a resposta ({e})"))
}

#[tauri::command]
async fn situacao(s: Estado<'_>) -> Result<serde_json::Value, String> {
    s.situacao()
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
fn recriar_banco(app: AppHandle, s: Estado<'_>, forcar: Option<bool>) -> Result<(), String> {
    let s = s.inner().clone();
    let forcar = forcar.unwrap_or(true);
    em_segundo_plano(app, s, move |sv, emissor, ao_dados| {
        sv.recriar(emissor, ao_dados, forcar)
    })
}

/// Há dados novos no servidor oficial? (não baixa nada)
#[tauri::command]
async fn verificar_dados(s: Estado<'_>) -> Result<serde_json::Value, String> {
    let s = s.inner().clone();
    tauri::async_runtime::spawn_blocking(move || s.verificar_dados())
        .await
        .map_err(|e| format!("falha interna na verificação ({e})"))?
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
#[tauri::command]
fn atualizar_programa(app: AppHandle, s: Estado<'_>) -> Result<(), String> {
    if !atualizador::TROCA_AUTOMATICA {
        return Err("neste sistema o programa ainda não se troca sozinho: baixe a versão nova na página do lançamento (botão Ver a versão nova).".into());
    }
    let s = s.inner().clone();
    if s.ocupado.swap(true, Ordering::SeqCst) {
        return Err(
            "há uma tarefa em andamento. Espere terminar ou cancele, e atualize depois.".into(),
        );
    }
    s.cancelar.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let avisar = |msg: &str, frac: f64| {
            let _ = app.emit(
                "progresso",
                servico::Progresso {
                    resumo: "Atualizando o programa".into(),
                    mensagem: msg.into(),
                    fracao: frac,
                    indeterminado: false,
                },
            );
        };
        let r = (|| -> Result<String, String> {
            let exe = std::env::current_exe()
                .map_err(|e| format!("não foi possível localizar o executável ({e})"))?;
            avisar("Consultando a versão mais recente", 0.05);
            let l = atualizador::consultar(sa_core::REPOSITORIO, &s.cancelar)
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
                &s.pastas.dados.join("atualizacao"),
                &s.cancelar,
            )
            .map_err(|e| e.to_string())?;
            avisar("Trocando o programa", 0.9);
            atualizador::trocar(&exe, &novo).map_err(|e| e.to_string())?;
            std::process::Command::new(&exe)
                .arg("--apos-atualizacao")
                .spawn()
                .map_err(|e| format!("a versão {} foi instalada, mas não abriu sozinha ({e}). Abra o programa de novo", l.versao))?;
            Ok(l.versao)
        })();
        match r {
            Ok(_) => app.exit(0),
            Err(e) => {
                s.ocupado.store(false, Ordering::SeqCst);
                let _ = app.emit(
                    "tarefa_fim",
                    FimTarefa {
                        ok: false,
                        cancelada: false,
                        mensagem: e,
                    },
                );
            }
        }
    });
    Ok(())
}

/// Roda uma tarefa longa em segundo plano, uma por vez, com eventos `progresso`,
/// `dados_atualizados` (dados novos no meio da tarefa) e `tarefa_fim`.
fn em_segundo_plano(
    app: AppHandle,
    s: Arc<Servico>,
    tarefa: impl FnOnce(&Servico, &Emissor, &(dyn Fn(bool) + Sync)) -> Result<String, String>
    + Send
    + 'static,
) -> Result<(), String> {
    if s.ocupado.swap(true, Ordering::SeqCst) {
        return Err("já existe uma tarefa em andamento. Espere terminar ou cancele.".into());
    }
    s.cancelar.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let a = app.clone();
        let emissor: Emissor = Arc::new(move |p| {
            let _ = a.emit("progresso", p);
        });
        let (a, s2) = (app.clone(), s.clone());
        let ao_dados = move |reabrir: bool| {
            if reabrir && let Err(e) = s2.reabrir() {
                eprintln!("Aviso: {e}");
            }
            let _ = a.emit("dados_atualizados", ());
        };
        let r = tarefa(&s, &emissor, &ao_dados);
        let reaberto = s.reabrir();
        let cancelada = s.cancelar.load(Ordering::SeqCst);
        let fim = match (r, reaberto) {
            (Ok(m), Ok(())) => FimTarefa {
                ok: true,
                cancelada: false,
                mensagem: m,
            },
            (Err(e), _) | (Ok(_), Err(e)) => FimTarefa {
                ok: false,
                cancelada,
                mensagem: e,
            },
        };
        s.ocupado.store(false, Ordering::SeqCst);
        let _ = app.emit("tarefa_fim", fim);
    });
    Ok(())
}

#[tauri::command]
fn baixar(app: AppHandle, s: Estado<'_>, pedido: PedidoDownload) -> Result<(), String> {
    let s = s.inner().clone();
    em_segundo_plano(app, s, move |sv, emissor, ao_dados| {
        servico::executar_download(&sv.pastas, &pedido, &sv.cancelar, emissor, ao_dados)
    })
}

#[tauri::command]
fn importar(app: AppHandle, s: Estado<'_>, pasta: String) -> Result<(), String> {
    let s = s.inner().clone();
    em_segundo_plano(app, s, move |sv, emissor, _| {
        servico::importar(&sv.pastas, &PathBuf::from(pasta), &sv.cancelar, emissor)
    })
}

#[tauri::command]
fn cancelar(s: Estado<'_>) {
    s.cancelar.store(true, Ordering::SeqCst);
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
    s.apagar_zips()
}

// ---- Fase 3: CNES, minha unidade, favoritos, anotações e exportação ----

/// Situação do módulo CNES: UFs carregadas, competência de cada uma e a unidade escolhida.
#[tauri::command]
async fn cnes_situacao(s: Estado<'_>) -> Result<serde_json::Value, String> {
    Ok(unidade::situacao(&unidade::local(&s.pastas)))
}

#[tauri::command]
fn cnes_baixar(app: AppHandle, s: Estado<'_>, pedido: unidade::PedidoCnes) -> Result<(), String> {
    let s = s.inner().clone();
    em_segundo_plano(app, s, move |sv, emissor, _| {
        unidade::baixar_cnes(
            &unidade::local(&sv.pastas),
            &pedido,
            &sv.cancelar,
            &unidade::repassar(emissor),
        )
    })
}

#[tauri::command]
fn cnes_importar(app: AppHandle, s: Estado<'_>, pasta: String, uf: String) -> Result<(), String> {
    let s = s.inner().clone();
    em_segundo_plano(app, s, move |sv, emissor, _| {
        unidade::importar_cnes(
            &unidade::local(&sv.pastas),
            &PathBuf::from(pasta),
            &uf,
            &unidade::repassar(emissor),
        )
    })
}

/// Competências do CNES que o servidor oficial tem para a UF.
#[tauri::command]
async fn cnes_competencias(uf: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || unidade::competencias_no_servidor(&uf))
        .await
        .map_err(|e| format!("falha interna ao listar o servidor ({e})"))?
}

#[tauri::command]
async fn cnes_apagar(s: Estado<'_>, uf: String) -> Result<String, String> {
    if s.ocupado.load(Ordering::SeqCst) {
        return Err("há uma tarefa em andamento. Espere terminar ou cancele.".into());
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
    if s.ocupado.load(Ordering::SeqCst) {
        return Err(
            "há uma tarefa em andamento. Espere terminar e escolha a unidade de novo.".into(),
        );
    }
    unidade::definir_minha(&unidade::local(&s.pastas), &uf, &cnes)
}

#[tauri::command]
async fn unidade_limpar(s: Estado<'_>) -> Result<(), String> {
    unidade::limpar_minha(&unidade::local(&s.pastas))
}

#[tauri::command]
async fn unidade_ver(
    s: Estado<'_>,
    competencia: Option<String>,
) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| {
        let c = s.competencia(q, competencia.as_deref())?;
        unidade::unidade(&unidade::local(&s.pastas), q, c)
    })
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
            cnes_buscar,
            unidade_definir,
            unidade_limpar,
            unidade_ver,
            aptidao,
            rede,
            marcar_favorito,
            anotar,
            marcado,
            marcados,
            exportar
        ])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "principal", WebviewUrl::App("index.html".into()))
                .title(format!("SIGTAP Aberto {}", sa_core::VERSAO))
                .inner_size(1360.0, 860.0)
                .min_inner_size(1024.0, 640.0)
                .data_directory(dados_webview.clone())
                .build()?;
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
            format!("{repo}/\"\n"),
        ] {
            assert!(!url_permitida(&ruim), "{ruim:?}");
        }
    }
}
