//! Aplicativo desktop do SIGTAP Aberto.
//!
//! Portátil: tudo o que o programa grava fica na pasta do executável. A pasta de dados do
//! WebView2 (cache, cookies, armazenamento) é `dados_webview\` ao lado do `.exe`; sem isso
//! o WebView2 gravaria em `%LOCALAPPDATA%`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

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

    let resultado = tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "principal", WebviewUrl::App("index.html".into()))
                .title(format!("SIGTAP Aberto {}", sa_core::VERSAO))
                .inner_size(1100.0, 720.0)
                .min_inner_size(800.0, 560.0)
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
