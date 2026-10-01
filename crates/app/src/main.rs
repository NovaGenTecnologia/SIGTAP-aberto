//! Aplicativo desktop do SIGTAP Aberto.
//!
//! Portátil: tudo o que o programa grava fica na pasta do executável. A pasta de dados do
//! WebView2 (cache, cookies, armazenamento) é `dados_webview\` ao lado do `.exe`; sem isso
//! o WebView2 gravaria em `%LOCALAPPDATA%`. Os dados ficam em `dados\`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servico;

use sa_core::Competencia;
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

/// Pasta onde o executável está. Tudo o que o programa grava fica abaixo dela.
fn pasta_do_programa() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Não foi possível localizar o executável ({e}). Copie o programa para uma pasta sua e abra de novo."))?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Não foi possível identificar a pasta do executável. Copie o programa para uma pasta sua e abra de novo.".to_string())
}

fn main() {
    let pasta = match pasta_do_programa() {
        Ok(p) => p,
        Err(msg) => {
            eprintln!("{msg}");
            std::process::exit(1);
        }
    };
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
            escolher_pasta
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
        if let Err(e) = s.reabrir() {
            eprintln!("Aviso: {e}");
        }
        s
    }
}
