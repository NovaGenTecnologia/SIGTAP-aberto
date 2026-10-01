//! Serviço do aplicativo: estado compartilhado, consultas e tarefas longas (download e carga)
//! em segundo plano, com eventos de progresso para a interface.
//!
//! Pastas (todas ao lado do executável): `dados\sigtap.db`, `dados\zips\`,
//! `dados\territorio\`, `dados\territorio.db`.

use sa_core::Competencia;
use sa_download::cortesia::{Cortesia, Evento};
use sa_download::http::Http;
use sa_download::sigtap as dl;
use sa_download::territorio as ter;
use sa_packs::sigtap::BancoSigtap;
use sa_packs::territorio::{BancoTerritorio, Origem};
use sa_query::Consulta;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Pastas do programa.
#[derive(Debug, Clone)]
pub struct Pastas {
    pub dados: PathBuf,
}

impl Pastas {
    pub fn sigtap_db(&self) -> PathBuf {
        self.dados.join("sigtap.db")
    }
    pub fn zips(&self) -> PathBuf {
        self.dados.join("zips")
    }
    pub fn territorio(&self) -> PathBuf {
        self.dados.join("territorio")
    }
    pub fn territorio_db(&self) -> PathBuf {
        self.dados.join("territorio.db")
    }
}

/// Mensagem de progresso enviada à interface (evento `progresso`).
#[derive(Debug, Clone, Serialize)]
pub struct Progresso {
    /// `sigtap`, `territorio` ou `historico`.
    pub etapa: String,
    pub mensagem: String,
    pub feito: u64,
    pub total: u64,
}

/// Fim de uma tarefa (evento `tarefa_fim`).
#[derive(Debug, Clone, Serialize)]
pub struct FimTarefa {
    pub ok: bool,
    pub cancelada: bool,
    pub mensagem: String,
}

/// O que baixar na primeira execução ou em "Procurar atualizações".
#[derive(Debug, Clone, Deserialize)]
pub struct PedidoDownload {
    pub sigtap_vigente: bool,
    pub territorio: bool,
    pub historico: bool,
}

/// Estado do aplicativo.
pub struct Servico {
    pub pastas: Pastas,
    consulta: Mutex<Option<Consulta>>,
    pub cancelar: Arc<AtomicBool>,
    pub ocupado: Arc<AtomicBool>,
}

fn texto_comp(c: Competencia) -> String {
    c.to_string()
}

impl Servico {
    pub fn novo(pastas: Pastas) -> Self {
        Self {
            pastas,
            consulta: Mutex::new(None),
            cancelar: Arc::new(AtomicBool::new(false)),
            ocupado: Arc::new(AtomicBool::new(false)),
        }
    }

    /// (Re)abre a consulta a partir do banco, se existir e tiver competência.
    pub fn reabrir(&self) -> Result<(), String> {
        let mut g = self
            .consulta
            .lock()
            .map_err(|_| "estado interno travado".to_string())?;
        *g = None;
        let p = self.pastas.sigtap_db();
        if p.exists() {
            let q = Consulta::abrir(&p).map_err(|e| e.to_string())?;
            if q.mais_recente().is_ok() {
                *g = Some(q);
            }
        }
        Ok(())
    }

    /// Executa uma função com a consulta aberta.
    pub fn com_consulta<T>(
        &self,
        f: impl FnOnce(&Consulta) -> Result<T, String>,
    ) -> Result<T, String> {
        let g = self
            .consulta
            .lock()
            .map_err(|_| "estado interno travado".to_string())?;
        match g.as_ref() {
            Some(q) => f(q),
            None => Err(
                "nenhuma competência do SIGTAP carregada. Baixe a tabela vigente ou importe os ZIPs em Módulos e dados."
                    .into(),
            ),
        }
    }

    /// Competência pedida pela interface, ou a mais recente.
    pub fn competencia(&self, q: &Consulta, texto: Option<&str>) -> Result<Competencia, String> {
        match texto {
            Some(t) if !t.is_empty() => Competencia::de_texto(t).map_err(|e| e.to_string()),
            _ => q.mais_recente().map_err(|e| e.to_string()),
        }
    }

    /// Situação geral para a tela inicial e "Módulos e dados".
    pub fn situacao(&self) -> Result<serde_json::Value, String> {
        let competencias = self
            .com_consulta(|q| q.competencias().map_err(|e| e.to_string()))
            .unwrap_or_default();
        let territorio = if self.pastas.territorio_db().exists() {
            let b =
                BancoTerritorio::abrir(&self.pastas.territorio_db()).map_err(|e| e.to_string())?;
            let r = b.resumo().map_err(|e| e.to_string())?;
            if r.municipios_ibge > 0 {
                Some(
                    serde_json::json!({ "resumo": r, "fontes": b.fontes().map_err(|e| e.to_string())? }),
                )
            } else {
                None
            }
        } else {
            None
        };
        let zips = dl::locais(&self.pastas.zips()).len();
        Ok(serde_json::json!({
            "primeira_execucao": competencias.is_empty() || territorio.is_none(),
            "competencias": competencias,
            "territorio": territorio,
            "zips_guardados": zips,
            "pasta_dados": self.pastas.dados.display().to_string(),
            "ocupado": self.ocupado.load(Ordering::Relaxed),
        }))
    }
}

/// Converte eventos de download em progresso para a interface.
fn traduzir(etapa: &str, e: Evento) -> Option<Progresso> {
    let p = |mensagem: String, feito, total| Progresso {
        etapa: etapa.into(),
        mensagem,
        feito,
        total,
    };
    Some(match e {
        Evento::Iniciando {
            arquivo,
            total,
            retomando_de,
        } => p(
            if retomando_de > 0 {
                format!("{arquivo}: retomando de onde parou")
            } else {
                format!("{arquivo}: iniciando")
            },
            retomando_de,
            total,
        ),
        Evento::Progresso {
            arquivo,
            feito,
            total,
        } => p(arquivo, feito, total),
        Evento::NovaTentativa {
            arquivo,
            tentativa,
            espera_s,
            motivo,
        } => p(
            format!("{arquivo}: falhou ({motivo}); nova tentativa ({tentativa}) em {espera_s} s"),
            0,
            0,
        ),
        Evento::Concluido { arquivo } => p(format!("{arquivo}: concluído e conferido"), 1, 1),
    })
}

/// Tarefa de download e carga. Roda em segundo plano; `enviar` publica o progresso.
pub fn executar_download(
    pastas: &Pastas,
    pedido: &PedidoDownload,
    cancelar: &AtomicBool,
    enviar: &mut dyn FnMut(Progresso),
) -> Result<String, String> {
    let cortesia = Cortesia::default();
    let mut feito = Vec::new();
    std::fs::create_dir_all(&pastas.dados)
        .map_err(|e| format!("não foi possível criar {} ({e})", pastas.dados.display()))?;
    if pedido.sigtap_vigente || pedido.historico {
        enviar(Progresso {
            etapa: "sigtap".into(),
            mensagem: format!("Consultando {}{}", dl::SERVIDOR, dl::PASTA),
            feito: 0,
            total: 0,
        });
        let disp = dl::listar_servidor(&cortesia).map_err(|e| e.to_string())?;
        let ultima = disp.last().map(|d| d.competencia);
        let plano = dl::planejar(&disp, &pastas.zips(), |c| {
            pedido.historico || Some(c) == ultima
        });
        let etapa = if pedido.historico {
            "historico"
        } else {
            "sigtap"
        };
        dl::baixar(&plano, &pastas.zips(), &cortesia, cancelar, |e| {
            if let Some(p) = traduzir(etapa, e) {
                enviar(p)
            }
        })
        .map_err(|e| e.to_string())?;
        carregar_zips(pastas, pedido.historico, ultima, cancelar, enviar)?;
        feito.push(if pedido.historico {
            "histórico da tabela"
        } else {
            "tabela de procedimentos"
        });
    }
    if pedido.territorio {
        let http = Http::novo(cortesia.clone());
        ter::baixar(&http, &pastas.territorio(), cancelar, &mut |e| {
            if let Some(p) = traduzir("territorio", e) {
                enviar(p)
            }
        })
        .map_err(|e| e.to_string())?;
        gravar_territorio(&pastas.territorio(), &pastas.territorio_db())?;
        feito.push("território");
    }
    Ok(format!("Concluído: {}.", feito.join(", ")))
}

/// Carrega no banco os ZIPs guardados que ainda não estão nele (ou que têm versão nova).
pub fn carregar_zips(
    pastas: &Pastas,
    todos: bool,
    so: Option<Competencia>,
    cancelar: &AtomicBool,
    enviar: &mut dyn FnMut(Progresso),
) -> Result<usize, String> {
    let mut b = BancoSigtap::abrir(&pastas.sigtap_db()).map_err(|e| e.to_string())?;
    let ja: std::collections::BTreeMap<String, Option<String>> = b
        .competencias()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| (texto_comp(c.competencia), c.versao))
        .collect();
    let locais = dl::locais(&pastas.zips());
    let pendentes: Vec<(Competencia, PathBuf)> = locais
        .into_iter()
        .filter(|(c, _)| todos || Some(*c) == so || so.is_none())
        .filter(|(c, (v, _))| ja.get(&texto_comp(*c)) != Some(v))
        .map(|(c, (_, p))| (c, p))
        .collect();
    let n = pendentes.len() as u64;
    for (i, (c, p)) in pendentes.iter().enumerate() {
        if cancelar.load(Ordering::Relaxed) {
            return Err("carga cancelada; as competências já carregadas continuam no banco".into());
        }
        enviar(Progresso {
            etapa: "carga".into(),
            mensagem: format!("Carregando a competência {c} no banco"),
            feito: i as u64,
            total: n,
        });
        b.carregar_zip(p).map_err(|e| e.to_string())?;
    }
    Ok(pendentes.len())
}

/// Lê a pasta do território e grava o banco.
pub fn gravar_territorio(pasta: &Path, banco: &Path) -> Result<(), String> {
    let t = ter::ler_pasta(pasta).map_err(|e| e.to_string())?;
    let conv = |x: &ter::OrigemArquivo| Origem {
        url: x.url.clone(),
        obtido_em: x.obtido_em.clone(),
        sha256: x.sha256.clone(),
    };
    let mut b = BancoTerritorio::abrir(banco).map_err(|e| e.to_string())?;
    b.gravar(
        &t.ibge,
        &t.demas,
        &conv(&t.origem_ibge),
        &conv(&t.origem_demas),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Importação manual: ZIPs do SIGTAP e/ou arquivos do território de uma pasta escolhida.
pub fn importar(
    pastas: &Pastas,
    origem: &Path,
    cancelar: &AtomicBool,
    enviar: &mut dyn FnMut(Progresso),
) -> Result<String, String> {
    let (ok, recusados) = dl::importar_pasta(origem, &pastas.zips()).map_err(|e| e.to_string())?;
    let mut partes = Vec::new();
    if !ok.is_empty() {
        let n = carregar_zips(pastas, true, None, cancelar, enviar)?;
        partes.push(format!(
            "{} ZIP(s) do SIGTAP importados, {n} competência(s) carregadas",
            ok.len()
        ));
    }
    if origem.join(ter::ARQ_IBGE).exists() && origem.join(ter::ARQ_DEMAS).exists() {
        ter::ler_pasta(origem).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(pastas.territorio()).map_err(|e| e.to_string())?;
        for nome in [ter::ARQ_IBGE, ter::ARQ_DEMAS] {
            std::fs::copy(origem.join(nome), pastas.territorio().join(nome))
                .map_err(|e| format!("não foi possível copiar {nome} ({e})"))?;
        }
        let _ = std::fs::remove_file(pastas.territorio().join(ter::ARQ_ORIGEM));
        gravar_territorio(&pastas.territorio(), &pastas.territorio_db())?;
        partes.push("território importado".into());
    }
    for (nome, motivo) in &recusados {
        partes.push(format!("{nome} recusado: {motivo}"));
    }
    if partes.is_empty() {
        return Err(format!(
            "nada para importar em {}. Coloque ali arquivos TabelaUnificada_AAAAMM_*.zip ou {} e {}",
            origem.display(),
            ter::ARQ_IBGE,
            ter::ARQ_DEMAS
        ));
    }
    Ok(partes.join("; "))
}
