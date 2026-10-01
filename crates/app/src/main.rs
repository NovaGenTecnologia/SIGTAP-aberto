//! Aplicativo desktop do SIGTAP Aberto.
//!
//! Portátil: tudo o que o programa grava fica na pasta do executável. A pasta de dados do
//! WebView2 (cache, cookies, armazenamento) é `dados_webview\` ao lado do `.exe`; sem isso
//! o WebView2 gravaria em `%LOCALAPPDATA%`. Os dados ficam em `dados\`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod servico;

use sa_core::Competencia;
use servico::{FimTarefa, Pastas, PedidoDownload, Progresso, Servico};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindowBuilder};

type Estado<'a> = State<'a, Arc<Servico>>;

fn json<T: serde::Serialize>(v: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(v).map_err(|e| format!("falha ao montar a resposta ({e})"))
}

#[tauri::command]
fn situacao(s: Estado<'_>) -> Result<serde_json::Value, String> {
    s.situacao()
}

#[tauri::command]
fn arvore(
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
fn buscar(
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
fn ficha(
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
fn historico(s: Estado<'_>, codigo: String) -> Result<serde_json::Value, String> {
    s.com_consulta(|q| json(q.historico(&codigo).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn mudou(
    s: Estado<'_>,
    de: Option<String>,
    para: Option<String>,
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
        json(
            q.o_que_mudou(de, para, sa_query::mudancas::LIMITE_ITENS)
                .map_err(|e| e.to_string())?,
        )
    })
}

#[tauri::command]
fn ligados(
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

/// Roda uma tarefa longa em segundo plano, uma por vez, com eventos `progresso` e `tarefa_fim`.
fn em_segundo_plano(
    app: AppHandle,
    s: Arc<Servico>,
    tarefa: impl FnOnce(&Servico, &mut dyn FnMut(Progresso)) -> Result<String, String> + Send + 'static,
) -> Result<(), String> {
    if s.ocupado.swap(true, Ordering::SeqCst) {
        return Err("já existe uma tarefa em andamento. Espere terminar ou cancele.".into());
    }
    s.cancelar.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let mut enviar = |p: Progresso| {
            let _ = app.emit("progresso", p);
        };
        let r = tarefa(&s, &mut enviar);
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
    em_segundo_plano(app, s, move |sv, enviar| {
        servico::executar_download(&sv.pastas, &pedido, &sv.cancelar, enviar)
    })
}

#[tauri::command]
fn importar(app: AppHandle, s: Estado<'_>, pasta: String) -> Result<(), String> {
    let s = s.inner().clone();
    em_segundo_plano(app, s, move |sv, enviar| {
        servico::importar(&sv.pastas, &PathBuf::from(pasta), &sv.cancelar, enviar)
    })
}

#[tauri::command]
fn cancelar(s: Estado<'_>) {
    s.cancelar.store(true, Ordering::SeqCst);
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
        .manage(servico)
        .invoke_handler(tauri::generate_handler![
            situacao, arvore, buscar, ficha, historico, mudou, ligados, baixar, importar, cancelar
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
