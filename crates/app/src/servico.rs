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
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

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

/// Progresso de uma tarefa (evento `progresso`): uma barra só para o conjunto de ações.
#[derive(Debug, Clone, Serialize)]
pub struct Progresso {
    /// Situação geral, por exemplo "Fazendo download 15 de 234 · carregadas 12 de 234".
    pub resumo: String,
    /// O que está acontecendo agora (arquivo, competência, nova tentativa).
    pub mensagem: String,
    /// Fração do conjunto já feita, de 0 a 1; nunca diminui durante a tarefa.
    pub fracao: f64,
    /// Ainda não se sabe o tamanho do trabalho (consultando o servidor).
    pub indeterminado: bool,
}

/// Publica o progresso para a interface (de qualquer thread).
pub type Emissor = Arc<dyn Fn(Progresso) + Send + Sync>;

/// Aviso de dados novos no meio de uma tarefa; `true` pede para reabrir a consulta.
pub type AoDados<'a> = &'a (dyn Fn(bool) + Sync);

/// Fim de uma tarefa (evento `tarefa_fim`).
#[derive(Debug, Clone, Serialize)]
pub struct FimTarefa {
    pub ok: bool,
    pub cancelada: bool,
    pub mensagem: String,
}

/// O que baixar na primeira execução, em "Procurar atualizações" ou num download parcial.
#[derive(Debug, Clone, Deserialize)]
pub struct PedidoDownload {
    /// `nenhum`, `vigente`, `6`, `12`, `24` (últimas N competências do servidor) ou `tudo`.
    pub sigtap: String,
    pub territorio: bool,
    /// Apagar cada ZIP depois de carregado (nunca o da competência mais recente).
    #[serde(default)]
    pub apagar_zips: bool,
}

impl PedidoDownload {
    /// Quantas competências (das mais recentes) entram; `None` = nenhuma.
    fn competencias(&self) -> Result<Option<usize>, String> {
        Ok(match self.sigtap.as_str() {
            "nenhum" | "" => None,
            "vigente" => Some(1),
            "tudo" => Some(usize::MAX),
            n => Some(
                n.parse::<usize>()
                    .ok()
                    .filter(|n| *n > 0)
                    .ok_or_else(|| format!("escopo de download desconhecido: {n}"))?,
            ),
        })
    }
}

fn texto_comp(c: Competencia) -> String {
    c.to_string()
}

/// Estado do aplicativo.
pub struct Servico {
    pub pastas: Pastas,
    consulta: Mutex<Option<Consulta>>,
    /// Última listagem do servidor do SIGTAP (para mostrar tamanhos dos downloads parciais).
    servidor: Mutex<Option<Vec<dl::Disponivel>>>,
    pub cancelar: Arc<AtomicBool>,
    pub ocupado: Arc<AtomicBool>,
}

impl Servico {
    pub fn novo(pastas: Pastas) -> Self {
        Self {
            pastas,
            consulta: Mutex::new(None),
            servidor: Mutex::new(None),
            cancelar: Arc::new(AtomicBool::new(false)),
            ocupado: Arc::new(AtomicBool::new(false)),
        }
    }

    /// (Re)abre a consulta a partir do banco, se existir e tiver competência. A nova consulta
    /// é preparada fora da trava, para a interface continuar respondendo enquanto isso.
    pub fn reabrir(&self) -> Result<(), String> {
        let p = self.pastas.sigtap_db();
        let nova = if p.exists() {
            let q = Consulta::abrir(&p).map_err(|e| e.to_string())?;
            q.mais_recente().is_ok().then_some(q)
        } else {
            None
        };
        let mut g = self
            .consulta
            .lock()
            .map_err(|_| "estado interno travado".to_string())?;
        *g = nova;
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
        Ok(serde_json::json!({
            "primeira_execucao": competencias.is_empty() || territorio.is_none(),
            "competencias": competencias,
            "territorio": territorio,
            "zips": self.zips_guardados()?,
            "pasta_dados": self.pastas.dados.display().to_string(),
            "ocupado": self.ocupado.load(Ordering::Relaxed),
        }))
    }

    /// Competências do servidor oficial, com o que já está guardado e carregado, para a
    /// interface mostrar quanto cada escopo de download baixa. A listagem fica guardada
    /// durante a sessão; `de_novo` consulta o servidor outra vez.
    pub fn ofertas(&self, de_novo: bool) -> Result<serde_json::Value, String> {
        let disp = {
            let cache = self
                .servidor
                .lock()
                .map_err(|_| "estado interno travado".to_string())?
                .clone();
            match cache {
                Some(d) if !de_novo => d,
                _ => {
                    let d = dl::listar_servidor(&Cortesia::default()).map_err(|e| {
                        format!(
                            "não foi possível listar {}{} ({e})",
                            dl::SERVIDOR,
                            dl::PASTA
                        )
                    })?;
                    *self
                        .servidor
                        .lock()
                        .map_err(|_| "estado interno travado".to_string())? = Some(d.clone());
                    d
                }
            }
        };
        let locais = dl::locais(&self.pastas.zips());
        let ja = carregadas(&self.pastas)?;
        let itens: Vec<serde_json::Value> = disp
            .iter()
            .map(|d| {
                let guardado = locais
                    .get(&d.competencia)
                    .is_some_and(|(v, _)| *v >= d.versao);
                serde_json::json!({
                    "competencia": texto_comp(d.competencia),
                    "tamanho": d.tamanho,
                    "guardado": guardado,
                    "carregado": ja.get(&d.competencia) == Some(&d.versao),
                })
            })
            .collect();
        Ok(
            serde_json::json!({ "servidor": format!("{}{}", dl::SERVIDOR, dl::PASTA), "competencias": itens }),
        )
    }

    /// ZIPs guardados e quanto se libera apagando os que já estão no banco (nunca o da
    /// competência mais recente carregada).
    pub fn zips_guardados(&self) -> Result<serde_json::Value, String> {
        let (todos, apagaveis, manter) = zips_apagaveis(&self.pastas)?;
        let soma = |v: &[(Competencia, PathBuf, u64)]| v.iter().map(|x| x.2).sum::<u64>();
        Ok(serde_json::json!({
            "arquivos": todos.len(),
            "bytes": soma(&todos),
            "apagaveis": apagaveis.len(),
            "bytes_apagaveis": soma(&apagaveis),
            "mantida": manter.map(texto_comp),
        }))
    }

    /// Apaga os ZIPs já carregados no banco, menos o da competência mais recente.
    pub fn apagar_zips(&self) -> Result<String, String> {
        if self.ocupado.load(Ordering::SeqCst) {
            return Err("há uma tarefa em andamento. Espere terminar para apagar os ZIPs.".into());
        }
        let (_, apagaveis, manter) = zips_apagaveis(&self.pastas)?;
        let (mut n, mut bytes, mut falhas) = (0usize, 0u64, Vec::new());
        for (c, p, t) in &apagaveis {
            match std::fs::remove_file(p) {
                Ok(()) => {
                    n += 1;
                    bytes += t;
                }
                Err(e) => falhas.push(format!("{c}: {e}")),
            }
        }
        let mut m = format!("{n} ZIP(s) apagados, {} liberados", mb(bytes));
        if let Some(c) = manter {
            m.push_str(&format!("; o da competência {} foi mantido", mes_ano(c)));
        }
        if !falhas.is_empty() {
            m.push_str(&format!(". Não foi possível apagar: {}", falhas.join("; ")));
        }
        Ok(m)
    }
}

/// Competências já no banco (com a versão do ZIP carregado). Não cria o banco.
fn carregadas(pastas: &Pastas) -> Result<BTreeMap<Competencia, Option<String>>, String> {
    if !pastas.sigtap_db().exists() {
        return Ok(BTreeMap::new());
    }
    let b = BancoSigtap::abrir(&pastas.sigtap_db()).map_err(|e| e.to_string())?;
    Ok(b.competencias()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| (c.competencia, c.versao))
        .collect())
}

/// ZIP guardado: competência, caminho, tamanho.
type Guardado = (Competencia, PathBuf, u64);

/// (todos os ZIPs, os apagáveis, a competência mantida).
type Selecao = (Vec<Guardado>, Vec<Guardado>, Option<Competencia>);

/// Apagável = a mesma versão já está no banco e não é a competência mais recente carregada.
fn zips_apagaveis(pastas: &Pastas) -> Result<Selecao, String> {
    let ja = carregadas(pastas)?;
    let manter = ja.keys().next_back().copied();
    let mut todos = Vec::new();
    let mut apagaveis = Vec::new();
    for (c, (v, p)) in dl::locais(&pastas.zips()) {
        let t = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
        if Some(c) != manter && ja.get(&c) == Some(&v) {
            apagaveis.push((c, p.clone(), t));
        }
        todos.push((c, p, t));
    }
    Ok((todos, apagaveis, manter))
}

/// "09/2026".
fn mes_ano(c: Competencia) -> String {
    format!("{:02}/{}", c.mes(), c.ano())
}

/// Tamanho em MB com vírgula decimal.
fn mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1e6).replace('.', ",")
}

// ---------- progresso de uma tarefa com várias ações ----------

/// Contagem de tudo o que a tarefa faz; a barra é a soma das ações.
#[derive(Default)]
struct Painel {
    baixar: u64,
    baixados: u64,
    /// Fração do arquivo em download.
    parcial: f64,
    carregar: u64,
    carregados: u64,
    territorio: u64,
    territorio_feito: u64,
    maior: f64,
    mensagem: String,
    indeterminado: bool,
}

impl Painel {
    fn progresso(&mut self) -> Progresso {
        let total = (self.baixar + self.carregar + self.territorio) as f64;
        let feito = self.baixados as f64
            + self.parcial.clamp(0.0, 1.0)
            + self.carregados as f64
            + self.territorio_feito as f64;
        if total > 0.0 {
            self.maior = self.maior.max((feito / total).clamp(0.0, 1.0));
        }
        let mut partes = Vec::new();
        if self.baixar > 0 {
            partes.push(if self.baixados < self.baixar {
                format!("Fazendo download {} de {}", self.baixados + 1, self.baixar)
            } else {
                format!("Download concluído ({} de {})", self.baixados, self.baixar)
            });
        }
        if self.carregar > 0 {
            partes.push(format!(
                "carregadas no banco {} de {}",
                self.carregados, self.carregar
            ));
        }
        if self.territorio > 0 {
            partes.push(
                if self.territorio_feito >= self.territorio {
                    "território pronto"
                } else {
                    "território pendente"
                }
                .into(),
            );
        }
        let mut resumo = partes.join("; ");
        if let Some(c) = resumo.get(..1) {
            resumo = c.to_uppercase() + &resumo[1..];
        }
        Progresso {
            resumo,
            mensagem: self.mensagem.clone(),
            fracao: self.maior,
            indeterminado: self.indeterminado,
        }
    }
}

struct Acompanhamento {
    painel: Mutex<Painel>,
    emissor: Emissor,
}

impl Acompanhamento {
    fn novo(emissor: Emissor) -> Self {
        Self {
            painel: Mutex::new(Painel::default()),
            emissor,
        }
    }

    fn mudar(&self, f: impl FnOnce(&mut Painel)) {
        let p = match self.painel.lock() {
            Ok(mut g) => {
                f(&mut g);
                g.progresso()
            }
            Err(_) => return,
        };
        (self.emissor)(p);
    }
}

/// Detalhe de um evento de download.
fn detalhe(e: &Evento) -> Option<(String, Option<f64>)> {
    let fr = |f: u64, t: u64| (t > 0).then(|| f as f64 / t as f64);
    Some(match e {
        Evento::Iniciando {
            arquivo,
            total,
            retomando_de,
        } => (
            if *retomando_de > 0 {
                format!("{arquivo}: retomando de onde parou")
            } else {
                format!("{arquivo}: iniciando")
            },
            fr(*retomando_de, *total),
        ),
        Evento::Progresso {
            arquivo,
            feito,
            total,
        } => (
            if *total > 0 {
                format!("{arquivo}: {} de {}", mb(*feito), mb(*total))
            } else {
                format!("{arquivo}: {} recebidos", mb(*feito))
            },
            fr(*feito, *total),
        ),
        Evento::NovaTentativa {
            arquivo,
            tentativa,
            espera_s,
            motivo,
        } => (
            format!("{arquivo}: falhou ({motivo}); nova tentativa ({tentativa}) em {espera_s} s"),
            None,
        ),
        Evento::Concluido { .. } => return None,
    })
}

const MSG_CANCELADA: &str = "cancelado; o que já foi baixado fica guardado e as competências já carregadas continuam no banco";

/// Download e carga em duas linhas de trabalho: uma só baixa (um arquivo por vez, da
/// competência mais recente para a mais antiga) e a outra só carrega no banco cada ZIP que
/// chega. O território é baixado logo depois da competência mais recente.
pub fn executar_download(
    pastas: &Pastas,
    pedido: &PedidoDownload,
    cancelar: &AtomicBool,
    emissor: &Emissor,
    ao_dados: AoDados<'_>,
) -> Result<String, String> {
    executar_download_de(
        &Fonte::oficial(),
        pastas,
        pedido,
        cancelar,
        emissor,
        ao_dados,
    )
}

/// Servidor do SIGTAP (o oficial; nos testes, um servidor local).
struct Fonte {
    servidor: String,
    pasta: String,
    cortesia: Cortesia,
}

impl Fonte {
    fn oficial() -> Self {
        Self {
            servidor: dl::SERVIDOR.into(),
            pasta: dl::PASTA.into(),
            cortesia: Cortesia::default(),
        }
    }
}

fn executar_download_de(
    fonte: &Fonte,
    pastas: &Pastas,
    pedido: &PedidoDownload,
    cancelar: &AtomicBool,
    emissor: &Emissor,
    ao_dados: AoDados<'_>,
) -> Result<String, String> {
    std::fs::create_dir_all(&pastas.dados)
        .map_err(|e| format!("não foi possível criar {} ({e})", pastas.dados.display()))?;
    let cortesia = &fonte.cortesia;
    let ac = Acompanhamento::novo(emissor.clone());
    let quantas = pedido.competencias()?;
    ac.mudar(|p| {
        p.territorio = if pedido.territorio { 2 } else { 0 };
        p.indeterminado = quantas.is_some();
        p.mensagem = if quantas.is_some() {
            format!("Consultando {}{}", fonte.servidor, fonte.pasta)
        } else {
            "Preparando".into()
        };
    });
    let ja = carregadas(pastas)?;
    let mut plano: Vec<dl::Disponivel> = Vec::new();
    let mut fila: Vec<(Competencia, PathBuf)> = Vec::new();
    let mut manter = ja.keys().next_back().copied();
    if let Some(n) = quantas {
        let disp = dl::listar_de(&fonte.servidor, &fonte.pasta, cortesia).map_err(|e| {
            format!(
                "não foi possível listar {}{} ({e}). Se a rede bloqueia FTP, use Importar de uma pasta.",
                fonte.servidor, fonte.pasta
            )
        })?;
        let Some(corte) = disp
            .get(disp.len().saturating_sub(n))
            .map(|d| d.competencia)
        else {
            return Err(format!(
                "o servidor {} não listou nenhum ZIP do SIGTAP",
                fonte.servidor
            ));
        };
        plano = dl::planejar(&disp, &pastas.zips(), |c| c >= corte);
        plano.reverse();
        let no_plano: BTreeSet<Competencia> = plano.iter().map(|d| d.competencia).collect();
        // Já guardados mas ainda não carregados: entram na fila de carga de imediato.
        fila = dl::locais(&pastas.zips())
            .into_iter()
            .rev()
            .filter(|(c, (v, _))| *c >= corte && !no_plano.contains(c) && ja.get(c) != Some(v))
            .map(|(c, (_, p))| (c, p))
            .collect();
        manter = manter.max(disp.last().map(|d| d.competencia));
    }
    ac.mudar(|p| {
        p.indeterminado = false;
        p.baixar = plano.len() as u64;
        p.carregar = (plano.len() + fila.len()) as u64;
        p.mensagem = if plano.is_empty() && fila.is_empty() && quantas.is_some() {
            "A tabela já está em dia".into()
        } else {
            String::new()
        };
    });

    let parar = AtomicBool::new(false);
    let fim = AtomicBool::new(false);
    let (tx, rx) = mpsc::channel::<(Competencia, PathBuf)>();
    for x in fila {
        let _ = tx.send(x);
    }
    let banco_vazio = ja.is_empty();
    let (r_baixa, r_carga) = std::thread::scope(|sc| {
        // Repassa o cancelamento do usuário às duas linhas de trabalho.
        sc.spawn(|| {
            while !fim.load(Ordering::Relaxed) {
                if cancelar.load(Ordering::Relaxed) {
                    parar.store(true, Ordering::Relaxed);
                }
                std::thread::sleep(Duration::from_millis(150));
            }
        });
        let carga = sc.spawn(|| {
            carregador(
                pastas,
                rx,
                &parar,
                &ac,
                pedido.apagar_zips.then_some(manter).flatten(),
                banco_vazio,
                ao_dados,
            )
        });
        let r_baixa = baixador(
            fonte,
            pastas,
            &plano,
            pedido.territorio,
            tx,
            &parar,
            &ac,
            ao_dados,
        );
        let r_carga = carga
            .join()
            .unwrap_or_else(|_| Err("a carga no banco parou de forma inesperada".into()));
        fim.store(true, Ordering::Relaxed);
        (r_baixa, r_carga)
    });

    let cancelado = cancelar.load(Ordering::Relaxed);
    let mut erros = Vec::new();
    let mut feitos = Vec::new();
    match r_baixa {
        Ok((n, ter)) => {
            if n > 0 {
                feitos.push(format!("{n} competência(s) baixada(s)"));
            }
            match ter {
                Some(Ok(())) => feitos.push("território atualizado".into()),
                Some(Err(e)) => erros.push(format!("território: {e}")),
                None => {}
            }
        }
        Err(e) if !cancelado => erros.push(e),
        Err(_) => {}
    }
    match r_carga {
        Ok((n, liberados)) => {
            if n > 0 {
                feitos.push(format!("{n} carregada(s) no banco"));
            }
            if liberados > 0 {
                feitos.push(format!("{} liberados apagando ZIPs", mb(liberados)));
            }
        }
        Err(e) if !cancelado => erros.push(e),
        Err(_) => {}
    }
    if cancelado {
        let mut m = MSG_CANCELADA.to_string();
        if !feitos.is_empty() {
            m = format!("{m} ({})", feitos.join(", "));
        }
        return Err(m);
    }
    if !erros.is_empty() {
        let mut m = erros.join("; ");
        if !feitos.is_empty() {
            m.push_str(&format!(". Feito antes do erro: {}", feitos.join(", ")));
        }
        return Err(m);
    }
    Ok(if feitos.is_empty() {
        match manter {
            Some(c) => format!(
                "Tudo em dia: a competência {} é a mais recente.",
                mes_ano(c)
            ),
            None => "Nada a fazer.".into(),
        }
    } else {
        format!("Concluído: {}.", feitos.join(", "))
    })
}

/// Linha de download: SIGTAP (a mais recente primeiro), território, resto do SIGTAP.
/// Cada ZIP validado vai para a fila de carga. Devolve (ZIPs baixados, resultado do território).
#[allow(clippy::too_many_arguments)]
fn baixador(
    fonte: &Fonte,
    pastas: &Pastas,
    plano: &[dl::Disponivel],
    territorio: bool,
    tx: mpsc::Sender<(Competencia, PathBuf)>,
    parar: &AtomicBool,
    ac: &Acompanhamento,
    ao_dados: AoDados<'_>,
) -> Result<(usize, Option<Result<(), String>>), String> {
    let comp_de: BTreeMap<&str, Competencia> = plano
        .iter()
        .map(|d| (d.nome.as_str(), d.competencia))
        .collect();
    let mut n = 0usize;
    let mut baixar = |lista: &[dl::Disponivel]| -> Result<(), String> {
        if lista.is_empty() {
            return Ok(());
        }
        let destino = pastas.zips();
        dl::baixar_de(
            &fonte.servidor,
            &fonte.pasta,
            lista,
            &destino,
            &fonte.cortesia,
            parar,
            |e| {
                if let Evento::Concluido { arquivo } = &e {
                    n += 1;
                    ac.mudar(|p| {
                        p.baixados += 1;
                        p.parcial = 0.0;
                    });
                    if let Some(c) = comp_de.get(arquivo.as_str()) {
                        let _ = tx.send((*c, pastas.zips().join(arquivo)));
                    }
                } else if let Some((m, fr)) = detalhe(&e) {
                    ac.mudar(|p| {
                        p.mensagem = m;
                        if let Some(f) = fr {
                            p.parcial = f;
                        }
                    });
                }
            },
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    };
    let (primeiro, resto) = plano.split_at(plano.len().min(1));
    baixar(primeiro)?;
    let ter = territorio.then(|| {
        let r = baixar_territorio(pastas, parar, ac, &fonte.cortesia);
        if r.is_ok() {
            ao_dados(false);
        }
        r
    });
    if parar.load(Ordering::Relaxed) {
        return Err(MSG_CANCELADA.into());
    }
    baixar(resto)?;
    Ok((n, ter))
}

fn baixar_territorio(
    pastas: &Pastas,
    parar: &AtomicBool,
    ac: &Acompanhamento,
    cortesia: &Cortesia,
) -> Result<(), String> {
    let http = Http::novo(cortesia.clone());
    ter::baixar(&http, &pastas.territorio(), parar, &mut |e| {
        if let Some((m, _)) = detalhe(&e) {
            ac.mudar(|p| p.mensagem = format!("Território: {m}"));
        }
    })
    .map_err(|e| e.to_string())?;
    ac.mudar(|p| {
        p.territorio_feito = 1;
        p.mensagem = "Território: gravando no banco".into();
    });
    gravar_territorio(&pastas.territorio(), &pastas.territorio_db())?;
    ac.mudar(|p| p.territorio_feito = 2);
    Ok(())
}

/// Linha de carga: carrega cada ZIP que chega na fila. Devolve (carregadas, bytes liberados).
fn carregador(
    pastas: &Pastas,
    rx: mpsc::Receiver<(Competencia, PathBuf)>,
    parar: &AtomicBool,
    ac: &Acompanhamento,
    apagar_menos: Option<Competencia>,
    banco_vazio: bool,
    ao_dados: AoDados<'_>,
) -> Result<(usize, u64), String> {
    let mut b = BancoSigtap::abrir(&pastas.sigtap_db()).map_err(|e| e.to_string())?;
    let (mut n, mut liberados) = (0usize, 0u64);
    for (c, p) in rx {
        if parar.load(Ordering::Relaxed) {
            return Err(MSG_CANCELADA.into());
        }
        ac.mudar(|x| x.mensagem = format!("Carregando a competência {} no banco", mes_ano(c)));
        if let Err(e) = b.carregar_zip(&p) {
            parar.store(true, Ordering::Relaxed);
            return Err(format!(
                "falha ao carregar a competência {} ({e}). O ZIP continua em dados\\zips; tente de novo ou apague-o para baixá-lo outra vez",
                mes_ano(c)
            ));
        }
        n += 1;
        ac.mudar(|x| x.carregados += 1);
        if n == 1 && banco_vazio {
            // Primeira competência no banco: a consulta já pode ser usada.
            ao_dados(true);
        }
        if let Some(manter) = apagar_menos
            && c != manter
        {
            let t = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&p).is_ok() {
                liberados += t;
            }
        }
    }
    Ok((n, liberados))
}

/// Carrega no banco os ZIPs guardados que ainda não estão nele (ou que têm versão nova),
/// da competência mais recente para a mais antiga.
fn carregar_zips(
    pastas: &Pastas,
    cancelar: &AtomicBool,
    ac: &Acompanhamento,
) -> Result<usize, String> {
    let ja = carregadas(pastas)?;
    let pendentes: Vec<(Competencia, PathBuf)> = dl::locais(&pastas.zips())
        .into_iter()
        .rev()
        .filter(|(c, (v, _))| ja.get(c) != Some(v))
        .map(|(c, (_, p))| (c, p))
        .collect();
    ac.mudar(|p| p.carregar += pendentes.len() as u64);
    let mut b = BancoSigtap::abrir(&pastas.sigtap_db()).map_err(|e| e.to_string())?;
    for (c, p) in &pendentes {
        if cancelar.load(Ordering::Relaxed) {
            return Err(MSG_CANCELADA.into());
        }
        ac.mudar(|x| x.mensagem = format!("Carregando a competência {} no banco", mes_ano(*c)));
        b.carregar_zip(p)
            .map_err(|e| format!("falha ao carregar a competência {} ({e})", mes_ano(*c)))?;
        ac.mudar(|x| x.carregados += 1);
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
    emissor: &Emissor,
) -> Result<String, String> {
    let ac = Acompanhamento::novo(emissor.clone());
    ac.mudar(|p| {
        p.indeterminado = true;
        p.mensagem = format!("Conferindo os arquivos de {}", origem.display());
    });
    let (ok, recusados) = dl::importar_pasta(origem, &pastas.zips()).map_err(|e| e.to_string())?;
    ac.mudar(|p| p.indeterminado = false);
    let mut partes = Vec::new();
    if !ok.is_empty() {
        let n = carregar_zips(pastas, cancelar, &ac)?;
        partes.push(format!(
            "{} ZIP(s) do SIGTAP importados, {n} competência(s) carregadas",
            ok.len()
        ));
    }
    let preparo = pastas.dados.join("territorio_importacao");
    let _ = std::fs::remove_dir_all(&preparo);
    if let Some(paginas) = ter::preparar_importacao(origem, &preparo).map_err(|e| e.to_string())? {
        ac.mudar(|p| {
            p.territorio = 1;
            p.mensagem = "Território: conferindo e gravando".into();
        });
        let r = (|| -> Result<(), String> {
            ter::ler_pasta(&preparo).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(pastas.territorio()).map_err(|e| e.to_string())?;
            for nome in [ter::ARQ_IBGE, ter::ARQ_DEMAS] {
                std::fs::copy(preparo.join(nome), pastas.territorio().join(nome))
                    .map_err(|e| format!("não foi possível copiar {nome} ({e})"))?;
            }
            let _ = std::fs::remove_file(pastas.territorio().join(ter::ARQ_ORIGEM));
            gravar_territorio(&pastas.territorio(), &pastas.territorio_db())
        })();
        let _ = std::fs::remove_dir_all(&preparo);
        r?;
        ac.mudar(|p| p.territorio_feito = 1);
        partes.push(if paginas > 1 {
            format!("território importado ({paginas} páginas do DEMAS juntadas)")
        } else {
            "território importado".into()
        });
    }
    for (nome, motivo) in &recusados {
        partes.push(format!("{nome} recusado: {motivo}"));
    }
    if partes.is_empty() {
        return Err(format!(
            "nada para importar em {}. Coloque ali arquivos TabelaUnificada_AAAAMM_*.zip ou {} com {} (ou as páginas demas*.json)",
            origem.display(),
            ter::ARQ_IBGE,
            ter::ARQ_DEMAS
        ));
    }
    Ok(partes.join("; "))
}

#[cfg(test)]
mod testes {
    //! Linhas de download e carga contra um FTP local que serve ZIPs reais do SIGTAP
    //! (`SA_ZIPS_HISTORICO` = pasta com os ZIPs oficiais; sem ela, o teste não roda).

    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn zips_reais(n: usize) -> Option<Vec<(Competencia, PathBuf)>> {
        let pasta = PathBuf::from(std::env::var("SA_ZIPS_HISTORICO").ok()?);
        let v: Vec<_> = dl::locais(&pasta)
            .into_iter()
            .map(|(c, (_, p))| (c, p))
            .collect();
        Some(v[v.len().saturating_sub(n)..].to_vec())
    }

    fn fonte(zips: &[(Competencia, PathBuf)]) -> Fonte {
        let arquivos = zips
            .iter()
            .map(|(_, p)| {
                (
                    p.file_name().unwrap().to_string_lossy().into_owned(),
                    p.clone(),
                )
            })
            .collect();
        let porta = sa_download::servidor_falso::iniciar(arquivos);
        Fonte {
            servidor: "127.0.0.1".into(),
            pasta: "/pub".into(),
            cortesia: Cortesia {
                pausa_entre_arquivos: Duration::from_millis(10),
                espera_inicial: Duration::from_millis(10),
                porta,
                ..Cortesia::default()
            },
        }
    }

    fn pastas(nome: &str) -> Pastas {
        let d = std::env::temp_dir().join(format!("sa-app-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        Pastas { dados: d }
    }

    type Registro = Arc<Mutex<Vec<Progresso>>>;

    fn emissor() -> (Emissor, Registro) {
        let r: Registro = Arc::default();
        let r2 = r.clone();
        (Arc::new(move |p| r2.lock().unwrap().push(p)), r)
    }

    #[test]
    fn baixa_e_carrega_em_paralelo_da_mais_recente_e_apaga_zips() {
        let Some(zips) = zips_reais(4) else { return };
        let f = fonte(&zips);
        let ps = pastas("pipeline");
        let (em, reg) = emissor();
        let avisos = AtomicUsize::new(0);
        let pedido = PedidoDownload {
            sigtap: "3".into(),
            territorio: false,
            apagar_zips: true,
        };
        let m = executar_download_de(&f, &ps, &pedido, &AtomicBool::new(false), &em, &|r| {
            assert!(r);
            avisos.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        eprintln!("PROVA pipeline: {m}");
        // Banco vazio: um aviso para reabrir a consulta assim que a primeira competência entrou.
        assert_eq!(avisos.load(Ordering::SeqCst), 1);
        let ja = carregadas(&ps).unwrap();
        let esperadas: Vec<Competencia> = zips[1..].iter().map(|z| z.0).collect();
        assert_eq!(ja.keys().copied().collect::<Vec<_>>(), esperadas);
        // Só o ZIP da competência mais recente fica guardado.
        let guardados: Vec<Competencia> = dl::locais(&ps.zips()).into_keys().collect();
        assert_eq!(guardados, [zips[3].0]);
        let reg = reg.lock().unwrap();
        // A barra nunca volta e termina cheia.
        assert!(reg.windows(2).all(|w| w[1].fracao >= w[0].fracao));
        assert!((reg.last().unwrap().fracao - 1.0).abs() < 1e-9);
        // Texto geral com a contagem do conjunto.
        assert!(
            reg.iter()
                .any(|p| p.resumo.starts_with("Fazendo download 1 de 3"))
        );
        assert!(
            reg.iter()
                .any(|p| p.resumo.contains("carregadas no banco 3 de 3"))
        );
        // Da mais recente para a mais antiga.
        let ordem: Vec<&str> = reg
            .iter()
            .filter_map(|p| p.mensagem.strip_prefix("Carregando a competência "))
            .collect();
        let mut vistas = ordem.clone();
        vistas.dedup();
        let txt = |c: Competencia| format!("{} no banco", mes_ano(c));
        assert_eq!(
            vistas,
            [txt(zips[3].0), txt(zips[2].0), txt(zips[1].0)]
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
        );
        drop(reg);

        // O banco montado de trás para frente é igual ao montado em ordem.
        let mut em_ordem = BancoSigtap::em_memoria().unwrap();
        for (_, p) in &zips[1..] {
            em_ordem.carregar_zip(p).unwrap();
        }
        let b = BancoSigtap::abrir(&ps.sigtap_db()).unwrap();
        assert_eq!(
            b.resumo_logico().unwrap(),
            em_ordem.resumo_logico().unwrap()
        );

        // De novo: nada a baixar.
        let pedido = PedidoDownload {
            sigtap: "vigente".into(),
            territorio: false,
            apagar_zips: false,
        };
        let m =
            executar_download_de(&f, &ps, &pedido, &AtomicBool::new(false), &em, &|_| {}).unwrap();
        assert!(m.starts_with("Tudo em dia"), "{m}");

        // Mais uma competência, a mais antiga: carga retroativa; o banco continua igual ao
        // montado em ordem.
        let pedido = PedidoDownload {
            sigtap: "tudo".into(),
            territorio: false,
            apagar_zips: false,
        };
        executar_download_de(&f, &ps, &pedido, &AtomicBool::new(false), &em, &|_| {}).unwrap();
        let mut em_ordem = BancoSigtap::em_memoria().unwrap();
        for (_, p) in &zips {
            em_ordem.carregar_zip(p).unwrap();
        }
        assert_eq!(
            b.resumo_logico().unwrap(),
            em_ordem.resumo_logico().unwrap()
        );

        // Escolha de apagar depois: libera tudo menos a mais recente.
        let s = Servico::novo(ps.clone());
        let info = s.zips_guardados().unwrap();
        assert_eq!(info["mantida"], zips[3].0.to_string());
        assert_eq!(info["apagaveis"], 3);
        eprintln!("PROVA apagar: {}", s.apagar_zips().unwrap());
        let guardados: Vec<Competencia> = dl::locais(&ps.zips()).into_keys().collect();
        assert_eq!(guardados, [zips[3].0]);
        let _ = std::fs::remove_dir_all(&ps.dados);
    }

    #[test]
    fn cancelar_para_as_duas_linhas() {
        let Some(zips) = zips_reais(3) else { return };
        let f = fonte(&zips);
        let ps = pastas("cancelar");
        let cancelar = Arc::new(AtomicBool::new(false));
        let c2 = cancelar.clone();
        // Cancela assim que o primeiro download termina.
        let em: Emissor = Arc::new(move |p: Progresso| {
            if p.resumo.starts_with("Fazendo download 2") {
                c2.store(true, Ordering::SeqCst);
            }
        });
        let pedido = PedidoDownload {
            sigtap: "tudo".into(),
            territorio: false,
            apagar_zips: false,
        };
        let e = executar_download_de(&f, &ps, &pedido, &cancelar, &em, &|_| {}).unwrap_err();
        assert!(e.starts_with("cancelado"), "{e}");
        // O que já foi baixado fica; nada de arquivo pela metade com nome final.
        for (_, (_, p)) in dl::locais(&ps.zips()) {
            dl::validar_zip(&p, &p.file_name().unwrap().to_string_lossy()).unwrap();
        }
        assert!(carregadas(&ps).unwrap().len() < 3);
        let _ = std::fs::remove_dir_all(&ps.dados);
    }
}
