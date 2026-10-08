//! Serviço do aplicativo: estado compartilhado, consultas e tarefas longas (download e carga)
//! em segundo plano, com eventos de progresso para a interface.
//!
//! Pastas (todas ao lado do executável): `dados\sigtap.db`, `dados\zips\`,
//! `dados\territorio\`, `dados\territorio.db`.

use crate::tarefas::{Agenda, Fim, Fonte};

/// Quem recebe o fim de cada tarefa; preenchido quando a janela existe.
type Ligacao = Arc<OnceLock<Box<dyn Fn(Fim) + Send + Sync>>>;
use sa_core::Competencia;
use sa_download::cortesia::{Cortesia, Evento};
use sa_download::http::Http;
use sa_download::sigtap as dl;
use sa_download::territorio as ter;
use sa_packs::saude;
use sa_packs::sigtap::BancoSigtap;
use sa_packs::territorio::{BancoTerritorio, Origem};
use sa_query::Consulta;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, mpsc};
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

/// O que a tarefa está fazendo agora: baixar da rede ou gravar no banco (a carga é o que pesa na interface).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Fase {
    Baixando,
    Carregando,
    Verificando,
}

/// A fase sai do texto da mensagem, num ponto só.
pub fn fase_da_mensagem(m: &str) -> Fase {
    if m.starts_with("Carregando") || m.starts_with("Gravando") {
        Fase::Carregando
    } else if m.starts_with("Verificando") {
        Fase::Verificando
    } else {
        Fase::Baixando
    }
}

/// Evento `progresso`: o andamento, com a fonte e a tarefa a que pertence.
#[derive(Debug, Clone, Serialize)]
pub struct ProgressoDeTarefa {
    pub fonte: Fonte,
    pub tarefa: u64,
    pub rotulo: String,
    pub fase: Fase,
    #[serde(flatten)]
    pub progresso: Progresso,
}

/// Publica o progresso para a interface (de qualquer thread).
pub type Emissor = Arc<dyn Fn(Progresso) + Send + Sync>;

/// Aviso de dados novos no meio de uma tarefa; `true` pede para reabrir a consulta.
pub type AoDados<'a> = &'a (dyn Fn(bool) + Sync);

/// O que baixar na primeira execução, em "Procurar atualizações" ou num download parcial.
#[derive(Debug, Clone, Deserialize)]
pub struct PedidoDownload {
    /// `nenhum`, `vigente`, `6`, `12`, `24` (últimas N competências do servidor) ou `tudo`.
    pub sigtap: String,
    pub territorio: bool,
    /// Apagar cada ZIP depois de carregado. Não vem da interface: o comando `baixar` preenche com o
    /// contrário da opção "Manter arquivos baixados" (padrão: apagar).
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
    /// Data de gravação do banco do SIGTAP quando a consulta foi aberta: mudou por fora (CLI, outra janela) = reabrir.
    carimbo: Mutex<Option<std::time::SystemTime>>,
    /// Última listagem do servidor do SIGTAP (para mostrar tamanhos dos downloads parciais).
    servidor: Mutex<Option<Vec<dl::Disponivel>>>,
    /// Vagas e filas das tarefas longas, uma vaga por fonte (SIGTAP, CNES, produção).
    pub agenda: Arc<Agenda>,
    /// Ligação com os eventos da interface, feita quando a janela existe.
    ligacao: Ligacao,
    /// Banco danificado ou de versão anterior achado na abertura (já guardado à parte), à espera de refazer.
    recuperacao: Mutex<Option<serde_json::Value>>,
    /// Dados gravados por uma versão mais nova do programa: nada é aberto nem alterado.
    bloqueio: Mutex<Option<String>>,
    /// Última `situacao` calculada (com a geração em que foi calculada) e o cadeado que faz as
    /// chamadas simultâneas esperarem um só cálculo em vez de repeti-lo.
    cache_situacao: Mutex<Option<(std::time::Instant, u64, serde_json::Value)>>,
    calculo_situacao: Mutex<()>,
    /// Sobe a cada mudança conhecida nos dados; invalida a `situacao` guardada.
    geracao: std::sync::atomic::AtomicU64,
}

/// Quanto tempo uma `situacao` guardada vale (mudança feita por fora do programa aparece em até isso).
const VALIDADE_SITUACAO: std::time::Duration = std::time::Duration::from_millis(300);

impl Servico {
    pub fn novo(pastas: Pastas) -> Self {
        let ligacao: Ligacao = Arc::new(OnceLock::new());
        let para_agenda = ligacao.clone();
        let agenda = Agenda::nova(Arc::new(move |f| {
            if let Some(cb) = para_agenda.get() {
                cb(f);
            }
        }));
        Self {
            pastas,
            consulta: Mutex::new(None),
            carimbo: Mutex::new(None),
            servidor: Mutex::new(None),
            agenda,
            ligacao,
            recuperacao: Mutex::new(None),
            bloqueio: Mutex::new(None),
            cache_situacao: Mutex::new(None),
            calculo_situacao: Mutex::new(()),
            geracao: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Liga o fim das tarefas aos eventos da interface (uma vez, ao criar a janela).
    pub fn ligar_eventos(&self, ao_fim: impl Fn(Fim) + Send + Sync + 'static) {
        let _ = self.ligacao.set(Box::new(ao_fim));
    }

    /// Há alguma tarefa longa em andamento ou na fila?
    pub fn ocupado(&self) -> bool {
        self.agenda.alguma()
    }

    /// Abertura do programa: confere os bancos (verificação rápida) e, se algum estiver
    /// danificado, guarda-o em quarentena para o programa abrir e refazê-lo. Depois abre a consulta.
    pub fn iniciar(&self) {
        let mut achados: Vec<String> = Vec::new();
        let mut pastas_q: Vec<String> = Vec::new();
        let mut motivos: Vec<&str> = Vec::new();
        let antes = carregadas(&self.pastas).ok();
        // 1. Versão do esquema: dados de versão anterior são guardados à parte e refeitos dos
        //    arquivos oficiais guardados; dados de versão mais nova bloqueiam (nada é alterado).
        let mut bloqueios: Vec<String> = Vec::new();
        for (nome, caminho, atual) in [
            (
                "tabela de procedimentos",
                self.pastas.sigtap_db(),
                sa_packs::sigtap::VERSAO_ESQUEMA,
            ),
            (
                "território",
                self.pastas.territorio_db(),
                sa_packs::territorio::VERSAO_ESQUEMA,
            ),
        ] {
            if !caminho.exists() {
                continue;
            }
            let Ok(gravada) = saude::versao_esquema(&caminho) else {
                continue; // não abre: a verificação de integridade, abaixo, decide.
            };
            match saude::compatibilidade(gravada.as_deref(), atual) {
                saude::Compatibilidade::Anterior(v) => {
                    let leiame = format!(
                        "Este banco foi gravado por uma versão anterior do SIGTAP Aberto (esquema {v}; \
                         a versão atual usa o {atual}) e não está mais em uso.\r\n\
                         O programa refez o banco a partir dos arquivos oficiais guardados em dados\\zips \
                         e dados\\territorio. Pode apagar esta pasta para liberar espaço.\r\n"
                    );
                    match saude::guardar_em_pasta(
                        &caminho,
                        &self.pastas.dados,
                        "versao_anterior",
                        &leiame,
                    ) {
                        Ok(q) => {
                            achados.push(nome.to_string());
                            pastas_q.push(q.display().to_string());
                            motivos.push("versao_anterior");
                        }
                        Err(e) => eprintln!("Aviso: {e}"),
                    }
                }
                saude::Compatibilidade::MaisNova(v) => {
                    bloqueios.push(format!("{nome} (esquema {v}; este programa usa o {atual})"))
                }
                _ => {}
            }
        }
        // Favoritos e anotações nunca são refeitos nem guardados à parte: só bloqueiam se forem de versão mais nova.
        let usuario = crate::unidade::banco_usuario(&crate::unidade::local(&self.pastas));
        if usuario.exists()
            && let Ok(g) = saude::versao_esquema(&usuario)
            && let saude::Compatibilidade::MaisNova(v) =
                saude::compatibilidade(g.as_deref(), sa_packs::usuario::VERSAO_ESQUEMA)
        {
            bloqueios.push(format!(
                "favoritos e anotações (esquema {v}; este programa usa o {})",
                sa_packs::usuario::VERSAO_ESQUEMA
            ));
        }
        if !bloqueios.is_empty() {
            let msg = format!(
                "Os dados em {} foram gravados por uma versão mais nova do SIGTAP Aberto: {}. \
                 Use a versão mais nova do programa (Sobre, Procurar atualizações, ou baixe do GitHub). \
                 Nada foi alterado.",
                self.pastas.dados.display(),
                bloqueios.join("; ")
            );
            if let Ok(mut g) = self.bloqueio.lock() {
                *g = Some(msg);
            }
            return;
        }
        // 2. Integridade.
        let antes_integridade = achados.len();
        for (nome, caminho) in [
            ("tabela de procedimentos", self.pastas.sigtap_db()),
            ("território", self.pastas.territorio_db()),
        ] {
            if caminho.exists() {
                self.conferir_ou_guardar(nome, &caminho, false, &mut achados, &mut pastas_q);
            }
        }
        if let Err(e) = self.reabrir() {
            eprintln!("Aviso: {e}");
            // A abertura falhou: confere a fundo antes de decidir.
            let p = self.pastas.sigtap_db();
            if p.exists() {
                self.conferir_ou_guardar(
                    "tabela de procedimentos",
                    &p,
                    true,
                    &mut achados,
                    &mut pastas_q,
                );
            }
        }
        motivos.extend(std::iter::repeat_n(
            "danificado",
            achados.len() - antes_integridade,
        ));
        if !achados.is_empty() {
            let zips = dl::locais(&self.pastas.zips()).len();
            let territorio_json = self.pastas.territorio().join(ter::ARQ_IBGE).exists();
            if let Ok(mut g) = self.recuperacao.lock() {
                *g = Some(serde_json::json!({
                    "bancos": achados,
                    "motivos": motivos,
                    "pastas": pastas_q,
                    "zips": zips,
                    "territorio_local": territorio_json,
                    "competencias_antes": antes.map(|m| m.keys().map(|c| texto_comp(*c)).collect::<Vec<_>>()),
                }));
            }
        }
    }

    fn conferir_ou_guardar(
        &self,
        nome: &str,
        caminho: &Path,
        completo: bool,
        achados: &mut Vec<String>,
        pastas_q: &mut Vec<String>,
    ) {
        let v = saude::verificar(caminho, completo);
        if !v.danificado {
            return;
        }
        // Solta a consulta aberta sobre o arquivo antes de movê-lo.
        if let Ok(mut g) = self.consulta.lock() {
            *g = None;
        }
        let motivo = format!(
            "{nome}: {}",
            v.mensagens.first().cloned().unwrap_or_default()
        );
        match saude::por_em_quarentena(caminho, &self.pastas.dados, &motivo) {
            Ok(q) => {
                achados.push(nome.to_string());
                pastas_q.push(q.display().to_string());
            }
            Err(e) => eprintln!("Aviso: {e}"),
        }
    }

    /// Verificação pedida pelo usuário em "Módulos e dados".
    pub fn verificar_bancos(&self, completo: bool) -> serde_json::Value {
        let local = crate::unidade::local(&self.pastas);
        let mut bancos = vec![
            (
                "Tabela de procedimentos".to_string(),
                self.pastas.sigtap_db(),
                "",
            ),
            ("Território".to_string(), self.pastas.territorio_db(), ""),
        ];
        for uf in crate::unidade::ufs_carregadas(&local) {
            let caminho = crate::unidade::banco_cnes(&local, &uf);
            bancos.push((
                format!("CNES de {uf}"),
                caminho,
                "Em CNES por UF, use \"atualizar\" nessa UF para baixar e refazer.",
            ));
        }
        let usuario = crate::unidade::banco_usuario(&local);
        if usuario.exists() {
            bancos.push((
                "Favoritos, anotações e unidade escolhida".to_string(),
                usuario,
                "Este arquivo só existe neste computador e não pode ser refeito: guarde uma cópia de dados\\usuario.db antes de apagar.",
            ));
        }
        let itens: Vec<serde_json::Value> = bancos
            .into_iter()
            .map(|(nome, p, conserto)| {
                let existe = p.exists();
                let bytes = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                let v = existe.then(|| saude::verificar(&p, completo));
                serde_json::json!({
                    "nome": nome,
                    "arquivo": p.file_name().map(|n| n.to_string_lossy().into_owned()),
                    "existe": existe,
                    "bytes": bytes,
                    "ok": v.as_ref().is_some_and(|v| v.ok),
                    "danificado": v.as_ref().is_some_and(|v| v.danificado),
                    "mensagens": v.map(|v| v.mensagens).unwrap_or_default(),
                    "conserto": conserto,
                })
            })
            .collect();
        serde_json::json!({ "completo": completo, "itens": itens })
    }

    /// Refaz os bancos a partir do que está guardado em `dados`: o banco da tabela, dos ZIPs;
    /// o território, dos JSON baixados antes. O banco atual vai para uma pasta de segurança
    /// (nunca é apagado).
    ///
    /// `forcar = true` (pedido do usuário): guarda e refaz mesmo bancos que parecem íntegros.
    /// `forcar = false` (recuperação automática): só refaz o que está faltando, porque o banco
    /// danificado já foi guardado na abertura e os íntegros não devem ser tocados.
    #[cfg(test)]
    pub fn recriar(
        &self,
        emissor: &Emissor,
        ao_dados: AoDados<'_>,
        forcar: bool,
    ) -> Result<String, String> {
        self.recriar_com(&AtomicBool::new(false), emissor, ao_dados, forcar)
    }

    /// Como `recriar`, parando quando `cancelar` for ligado.
    pub fn recriar_com(
        &self,
        cancelar: &AtomicBool,
        emissor: &Emissor,
        ao_dados: AoDados<'_>,
        forcar: bool,
    ) -> Result<String, String> {
        let ac = Acompanhamento::novo(emissor.clone());
        ac.mudar(|p| {
            p.indeterminado = true;
            p.mensagem = "Guardando o banco atual numa pasta de segurança".into();
        });
        let antes: BTreeSet<Competencia> = carregadas(&self.pastas)
            .map(|m| m.keys().copied().collect())
            .unwrap_or_default();
        if let Ok(mut g) = self.consulta.lock() {
            *g = None;
        }
        let mut guardados = Vec::new();
        // Sem ZIP guardado não há de onde refazer: o banco que existe não pode ser trocado por um vazio.
        let tem_zips = !dl::locais(&self.pastas.zips()).is_empty();
        let json_territorio = self.pastas.territorio().join(ter::ARQ_IBGE).exists()
            && self.pastas.territorio().join(ter::ARQ_DEMAS).exists();
        if forcar && !tem_zips && !json_territorio && self.pastas.sigtap_db().exists() {
            return Err("não há ZIPs guardados para refazer o banco. Os dados atuais foram mantidos; baixe a tabela em Baixar do DATASUS se precisar refazer.".into());
        }
        if forcar && tem_zips && self.pastas.sigtap_db().exists() {
            let q = saude::por_em_quarentena(
                &self.pastas.sigtap_db(),
                &self.pastas.dados,
                "refeito a pedido do usuário",
            )?;
            guardados.push(q.display().to_string());
        }
        let json_ok = self.pastas.territorio().join(ter::ARQ_IBGE).exists()
            && self.pastas.territorio().join(ter::ARQ_DEMAS).exists();
        // Sem ZIPs não há o que refazer do SIGTAP: o território só é trocado se estiver danificado,
        // para chamadas repetidas não encherem `dados` de cópias de um banco saudável.
        let refazer_territorio =
            tem_zips || saude::verificar(&self.pastas.territorio_db(), false).danificado;
        if forcar && json_ok && refazer_territorio && self.pastas.territorio_db().exists() {
            let q = saude::por_em_quarentena(
                &self.pastas.territorio_db(),
                &self.pastas.dados,
                "refeito a pedido do usuário",
            )?;
            guardados.push(q.display().to_string());
        }
        *self
            .recuperacao
            .lock()
            .map_err(|_| "estado interno travado".to_string())? = None;
        ac.mudar(|p| p.indeterminado = false);
        let mut partes = Vec::new();
        let n = carregar_zips(&self.pastas, cancelar, &ac, false)?;
        if tem_zips {
            partes.push(format!(
                "{n} competência(s) do SIGTAP refeitas a partir dos ZIPs guardados"
            ));
        } else {
            partes.push("sem ZIPs guardados: o banco do SIGTAP não foi mexido".into());
        }
        if json_ok && !self.pastas.territorio_db().exists() {
            ac.mudar(|p| {
                p.territorio = 1;
                p.mensagem = "Território: refazendo o banco".into();
            });
            gravar_territorio(&self.pastas.territorio(), &self.pastas.territorio_db())?;
            ac.mudar(|p| p.territorio_feito = 1);
            partes.push("território refeito".into());
        }
        ao_dados(true);
        let agora: BTreeSet<Competencia> = carregadas(&self.pastas)
            .map(|m| m.keys().copied().collect())
            .unwrap_or_default();
        let faltam: Vec<String> = antes.difference(&agora).map(|c| mes_ano(*c)).collect();
        if tem_zips && !faltam.is_empty() {
            let mostra: Vec<&str> = faltam.iter().take(8).map(String::as_str).collect();
            partes.push(format!(
                "faltam {} competência(s) que estavam no banco e não têm ZIP guardado ({}{}). Baixe-as em Baixar do DATASUS",
                faltam.len(),
                mostra.join(", "),
                if faltam.len() > 8 { ", …" } else { "" }
            ));
        }
        if n == 0 && !self.pastas.sigtap_db().exists() {
            partes.push("não há ZIPs guardados: baixe a tabela em Baixar do DATASUS".into());
        }
        if !guardados.is_empty() {
            partes.push(format!(
                "o banco anterior ficou em {}",
                guardados.join(" e ")
            ));
        }
        Ok(partes.join("; "))
    }

    /// Há competência nova no servidor ou republicação de uma já carregada? Consulta a lista
    /// do servidor (um único pedido) e compara com o banco. Não baixa nada.
    pub fn verificar_dados(&self) -> Result<serde_json::Value, String> {
        self.verificar_dados_de(&ServidorSigtap::oficial())
    }

    fn verificar_dados_de(&self, fonte: &ServidorSigtap) -> Result<serde_json::Value, String> {
        let disp = dl::listar_de(&fonte.servidor, &fonte.pasta, &fonte.cortesia).map_err(|e| {
            format!(
                "não foi possível consultar {}{} ({e})",
                fonte.servidor, fonte.pasta
            )
        })?;
        let mut g = self
            .servidor
            .lock()
            .map_err(|_| "estado interno travado".to_string())?;
        *g = Some(disp.clone());
        drop(g);
        let ja = carregadas(&self.pastas)?;
        let ultima = ja.keys().next_back().copied();
        let mut novos = Vec::new();
        let mut menor: Option<Competencia> = None;
        for d in &disp {
            let motivo = match ja.get(&d.competencia) {
                None if ultima.is_some_and(|u| d.competencia > u) => Some("nova"),
                Some(v) if d.versao > *v => Some("republicada"),
                _ => None,
            };
            if let Some(m) = motivo {
                menor = Some(menor.map_or(d.competencia, |x| x.min(d.competencia)));
                novos.push(serde_json::json!({
                    "competencia": texto_comp(d.competencia),
                    "motivo": m,
                    "tamanho": d.tamanho,
                }));
            }
        }
        // Para baixar só o que falta: as N competências mais recentes do servidor que
        // chegam até a mais antiga com novidade.
        let escopo = menor.map(|m| disp.iter().filter(|d| d.competencia >= m).count());
        Ok(serde_json::json!({
            "novos": novos,
            "escopo": escopo.map(|n| n.to_string()),
            "bytes": novos.iter().map(|x| x["tamanho"].as_u64().unwrap_or(0)).sum::<u64>(),
        }))
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
        let carimbo = self.carimbo_do_banco();
        let mut g = self
            .consulta
            .lock()
            .map_err(|_| "estado interno travado".to_string())?;
        *g = nova;
        if let Ok(mut c) = self.carimbo.lock() {
            *c = carimbo;
        }
        self.invalidar_situacao();
        Ok(())
    }

    /// Última gravação do banco do SIGTAP (arquivo e diário WAL).
    fn carimbo_do_banco(&self) -> Option<std::time::SystemTime> {
        let db = self.pastas.sigtap_db();
        let mut wal = db.clone().into_os_string();
        wal.push("-wal");
        [db, std::path::PathBuf::from(wal)]
            .iter()
            .filter_map(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
            .max()
    }

    /// O banco foi alterado por outro processo desde a última abertura? Durante uma tarefa do
    /// próprio programa não confere (ele mesmo reabre ao terminar).
    fn banco_mudou_por_fora(&self) -> bool {
        if self.ocupado() {
            return false;
        }
        let agora = self.carimbo_do_banco();
        self.carimbo.lock().map(|c| *c != agora).unwrap_or(false)
    }

    /// Executa uma função com a consulta aberta.
    pub fn com_consulta<T>(
        &self,
        f: impl FnOnce(&Consulta) -> Result<T, String>,
    ) -> Result<T, String> {
        if self.banco_mudou_por_fora() {
            let _ = self.reabrir();
        }
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

    /// Dados de versão mais nova do programa: nenhuma tarefa pode mexer neles.
    pub fn exigir_sem_bloqueio(&self) -> Result<(), String> {
        match self.bloqueio.lock().ok().and_then(|g| g.clone()) {
            Some(b) => Err(b),
            None => Ok(()),
        }
    }

    fn invalidar_situacao(&self) {
        self.geracao
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }

    /// Situação geral para a tela inicial e "Módulos e dados". O cálculo abre bancos e lista
    /// pastas, então fica guardado por instantes e é refeito a cada mudança conhecida; as
    /// tarefas e o "ocupado" são sempre lidos na hora.
    pub fn situacao(&self) -> Result<serde_json::Value, String> {
        use std::sync::atomic::Ordering::SeqCst;
        let guardada = || {
            let c = self.cache_situacao.lock().ok()?;
            let (t, g, v) = c.as_ref()?;
            (t.elapsed() < VALIDADE_SITUACAO && *g == self.geracao.load(SeqCst)).then(|| v.clone())
        };
        let mut v = match guardada() {
            Some(v) => v,
            None => {
                let _um_por_vez = self
                    .calculo_situacao
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                match guardada() {
                    Some(v) => v,
                    None => {
                        let geracao = self.geracao.load(SeqCst);
                        let v = self.situacao_calculada()?;
                        if let Ok(mut c) = self.cache_situacao.lock() {
                            *c = Some((std::time::Instant::now(), geracao, v.clone()));
                        }
                        v
                    }
                }
            }
        };
        v["ocupado"] = serde_json::json!(self.ocupado());
        v["tarefas"] = serde_json::json!(self.agenda.lista());
        Ok(v)
    }

    fn situacao_calculada(&self) -> Result<serde_json::Value, String> {
        let bloqueio = self.bloqueio.lock().ok().and_then(|g| g.clone());
        if let Some(b) = bloqueio {
            // Dados de versão mais nova: não abre nenhum banco e nunca oferece a carga inicial.
            return Ok(serde_json::json!({
                "primeira_execucao": false,
                "bloqueio": b,
                "competencias": [],
                "territorio": null,
                "zips": { "arquivos": 0, "bytes": 0, "apagaveis": 0, "bytes_apagaveis": 0, "mantida": null },
                "pasta_dados": self.pastas.dados.display().to_string(),
                "ocupado": self.ocupado(),
                "tarefas": self.agenda.lista(),
                "recuperacao": null,
            }));
        }
        let competencias = self
            .com_consulta(|q| q.competencias().map_err(|e| e.to_string()))
            .unwrap_or_default();
        let territorio = if self.pastas.territorio_db().exists() {
            let b = BancoTerritorio::abrir(&self.pastas.territorio_db());
            let r = b.as_ref().ok().and_then(|b| b.resumo().ok());
            let (Some(b), Some(r)) = (b.ok(), r) else {
                return Err(format!(
                    "não foi possível ler {}. Use Verificar o banco em Módulos e dados",
                    self.pastas.territorio_db().display()
                ));
            };
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
            "bloqueio": null,
            "competencias": competencias,
            "territorio": territorio,
            "zips": self.zips_guardados()?,
            "pasta_dados": self.pastas.dados.display().to_string(),
            "ocupado": self.ocupado(),
            "tarefas": self.agenda.lista(),
            "recuperacao": self.recuperacao.lock().ok().and_then(|g| g.clone()),
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
        self.exigir_sem_bloqueio()?;
        if self.agenda.ocupada(Fonte::Sigtap) {
            return Err(
                "há uma tarefa do SIGTAP em andamento. Espere terminar para apagar os ZIPs.".into(),
            );
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
        self.invalidar_situacao();
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
        &ServidorSigtap::oficial(),
        pastas,
        pedido,
        cancelar,
        emissor,
        ao_dados,
    )
}

/// Servidor do SIGTAP (o oficial; nos testes, um servidor local).
struct ServidorSigtap {
    servidor: String,
    pasta: String,
    cortesia: Cortesia,
}

impl ServidorSigtap {
    fn oficial() -> Self {
        Self {
            servidor: dl::SERVIDOR.into(),
            pasta: dl::PASTA.into(),
            cortesia: Cortesia::default(),
        }
    }
}

fn executar_download_de(
    fonte: &ServidorSigtap,
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
        // Já no banco na versão do servidor (ou mais nova): não baixa de novo, mesmo sem o ZIP guardado.
        plano.retain(|d| ja.get(&d.competencia).is_none_or(|v| *v < d.versao));
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
                pedido.apagar_zips,
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
    fonte: &ServidorSigtap,
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
    apagar: bool,
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
        if apagar {
            let t = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&p).is_ok() {
                liberados += t;
            }
        }
    }
    Ok((n, liberados))
}

/// Carrega no banco os ZIPs guardados que ainda não estão nele (ou que têm versão nova),
/// da competência mais recente para a mais antiga. Com `apagar`, cada ZIP sai da pasta depois de carregado.
fn carregar_zips(
    pastas: &Pastas,
    cancelar: &AtomicBool,
    ac: &Acompanhamento,
    apagar: bool,
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
        if apagar {
            let _ = std::fs::remove_file(p);
        }
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
/// Com `apagar` (sem "Manter arquivos baixados"), os ZIPs copiados para `dados\zips` saem depois de carregados.
pub fn importar(
    pastas: &Pastas,
    origem: &Path,
    cancelar: &AtomicBool,
    emissor: &Emissor,
    apagar: bool,
) -> Result<String, String> {
    if !origem.is_dir() {
        return Err(format!(
            "a pasta {} não existe ou não está acessível",
            origem.display()
        ));
    }
    let ac = Acompanhamento::novo(emissor.clone());
    ac.mudar(|p| {
        p.indeterminado = true;
        p.mensagem = format!("Conferindo os arquivos de {}", origem.display());
    });
    let (ok, recusados) = dl::importar_pasta(origem, &pastas.zips()).map_err(|e| e.to_string())?;
    ac.mudar(|p| p.indeterminado = false);
    let mut partes = Vec::new();
    if !ok.is_empty() {
        let n = carregar_zips(pastas, cancelar, &ac, apagar)?;
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

    fn fonte(zips: &[(Competencia, PathBuf)]) -> ServidorSigtap {
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
        ServidorSigtap {
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
        // Com apagar ligado, nenhum ZIP fica guardado depois de carregado.
        let guardados: Vec<Competencia> = dl::locais(&ps.zips()).into_keys().collect();
        assert!(guardados.is_empty(), "{guardados:?}");
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
        // Só a competência baixada agora (a mais antiga) está guardada: as outras já estavam no banco
        // e não foram baixadas de novo.
        assert_eq!(info["apagaveis"], 1);
        eprintln!("PROVA apagar: {}", s.apagar_zips().unwrap());
        let guardados: Vec<Competencia> = dl::locais(&ps.zips()).into_keys().collect();
        assert!(guardados.is_empty(), "{guardados:?}");
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

    /// JSONs do território já baixados (opcional): `SA_TERRITORIO_JSON` = pasta com ibge/demas.
    fn territorio_json() -> Option<PathBuf> {
        let p = PathBuf::from(std::env::var("SA_TERRITORIO_JSON").ok()?);
        p.join(ter::ARQ_IBGE).exists().then_some(p)
    }

    fn mudar_versao(db: &Path, v: &str) {
        rusqlite::Connection::open(db)
            .unwrap()
            .execute(
                "UPDATE sa_info SET valor = ?1 WHERE chave = 'versao_esquema'",
                [v],
            )
            .unwrap();
    }

    #[test]
    fn versao_do_banco_decide_entre_usar_refazer_ou_bloquear() {
        let Some(zips) = zips_reais(2) else { return };
        let p = pastas("versao");
        std::fs::create_dir_all(p.zips()).unwrap();
        for (_, z) in &zips {
            std::fs::copy(z, p.zips().join(z.file_name().unwrap())).unwrap();
        }
        let ter_json = territorio_json();
        if let Some(t) = &ter_json {
            std::fs::create_dir_all(p.territorio()).unwrap();
            for nome in [ter::ARQ_IBGE, ter::ARQ_DEMAS, ter::ARQ_ORIGEM] {
                if t.join(nome).exists() {
                    std::fs::copy(t.join(nome), p.territorio().join(nome)).unwrap();
                }
            }
            gravar_territorio(&p.territorio(), &p.territorio_db()).unwrap();
        }
        let (em, _) = emissor();
        Servico::novo(p.clone())
            .recriar(&em, &|_| {}, true)
            .unwrap();

        // 1. Mesma versão: abrir de novo (como depois de compilar outro .exe) usa os dados como estão.
        for _ in 0..2 {
            let sv = Servico::novo(p.clone());
            sv.iniciar();
            let s = sv.situacao().unwrap();
            assert!(s["recuperacao"].is_null() && s["bloqueio"].is_null(), "{s}");
            assert_eq!(s["competencias"].as_array().unwrap().len(), 2);
            if ter_json.is_some() {
                assert_eq!(
                    s["primeira_execucao"], false,
                    "com dados compatíveis não há carga inicial"
                );
            }
        }

        // 2. Versão anterior: guarda à parte e refaz dos ZIPs, sem carga inicial nem download.
        mudar_versao(&p.sigtap_db(), "0");
        let sv = Servico::novo(p.clone());
        sv.iniciar();
        let rec = sv.situacao().unwrap()["recuperacao"].clone();
        assert_eq!(rec["bancos"][0], "tabela de procedimentos", "{rec}");
        assert_eq!(rec["motivos"][0], "versao_anterior", "{rec}");
        assert_eq!(rec["zips"], 2);
        let guardado = p.dados.join("versao_anterior_1");
        assert!(guardado.join("sigtap.db").exists() && guardado.join("LEIAME.txt").exists());
        assert!(!p.sigtap_db().exists());
        sv.recriar(&em, &|_| {}, false).unwrap();
        sv.reabrir().unwrap();
        let s = sv.situacao().unwrap();
        assert_eq!(s["competencias"].as_array().unwrap().len(), 2);
        assert_eq!(
            saude::versao_esquema(&p.sigtap_db()).unwrap().as_deref(),
            Some(sa_packs::sigtap::VERSAO_ESQUEMA)
        );
        drop(sv);

        // 3. Versão mais nova: bloqueia, não oferece carga inicial e não altera um byte.
        mudar_versao(&p.sigtap_db(), "99");
        let antes = std::fs::read(p.sigtap_db()).unwrap();
        let sv = Servico::novo(p.clone());
        sv.iniciar();
        let s = sv.situacao().unwrap();
        assert_eq!(s["primeira_execucao"], false);
        assert!(
            s["bloqueio"].as_str().unwrap().contains("versão mais nova"),
            "{s}"
        );
        assert!(BancoSigtap::abrir(&p.sigtap_db()).is_err());
        drop(sv);
        assert_eq!(
            std::fs::read(p.sigtap_db()).unwrap(),
            antes,
            "o banco mais novo foi alterado"
        );
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn dados_de_versao_mais_nova_recusam_tarefas_e_apagar_zips() {
        let p = pastas("bloqueio-recusa");
        let sv = Servico::novo(p.clone());
        assert!(sv.exigir_sem_bloqueio().is_ok());
        *sv.bloqueio.lock().unwrap() = Some("dados de versão mais nova".into());
        assert_eq!(
            sv.exigir_sem_bloqueio().unwrap_err(),
            "dados de versão mais nova"
        );
        assert!(sv.apagar_zips().unwrap_err().contains("versão mais nova"));
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn favoritos_de_versao_mais_nova_bloqueiam_na_abertura() {
        let p = pastas("bloqueio-usuario");
        std::fs::create_dir_all(&p.dados).unwrap();
        let caminho = crate::unidade::banco_usuario(&crate::unidade::local(&p));
        drop(sa_packs::usuario::BancoUsuario::abrir(&caminho).unwrap());
        rusqlite::Connection::open(&caminho)
            .unwrap()
            .execute("UPDATE sa_info SET valor = '9'", [])
            .unwrap();
        let sv = Servico::novo(p.clone());
        sv.iniciar();
        let s = sv.situacao().unwrap();
        assert!(
            s["bloqueio"]
                .as_str()
                .unwrap()
                .contains("favoritos e anotações"),
            "{s}"
        );
        assert!(sv.exigir_sem_bloqueio().is_err());
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn situacao_guardada_ainda_mostra_tarefas_na_hora() {
        let p = pastas("situacao-guardada");
        let sv = Servico::novo(p.clone());
        assert_eq!(sv.situacao().unwrap()["ocupado"], false);
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        sv.agenda
            .enviar(
                Fonte::Cnes,
                "CNES",
                crate::tarefas::Quando::Agora,
                Box::new(move |_| {
                    let _ = rx.recv_timeout(std::time::Duration::from_secs(5));
                    Ok("ok".into())
                }),
            )
            .unwrap();
        // Dentro da validade da situação guardada, mas "ocupado" e "tarefas" vêm do agora.
        let s = sv.situacao().unwrap();
        assert_eq!(s["ocupado"], true, "{s}");
        assert_eq!(s["tarefas"].as_array().unwrap().len(), 1, "{s}");
        let _ = tx.send(());
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn banco_danificado_vai_para_quarentena_e_e_refeito_dos_zips() {
        let Some(zips) = zips_reais(3) else { return };
        let p = pastas("saude");
        std::fs::create_dir_all(p.zips()).unwrap();
        for (_, z) in &zips {
            std::fs::copy(z, p.zips().join(z.file_name().unwrap())).unwrap();
        }
        let (em, _) = emissor();
        // Banco inicial: refeito dos ZIPs guardados (não há banco ainda).
        let sv = Servico::novo(p.clone());
        let msg = sv.recriar(&em, &|_| {}, true).unwrap();
        assert!(msg.contains("3 competência(s)"), "{msg}");
        sv.iniciar();
        let antes = sv
            .com_consulta(|q| q.competencias().map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(antes.len(), 3);
        assert!(sv.situacao().unwrap()["recuperacao"].is_null());
        assert!(
            sv.verificar_bancos(true)["itens"][0]["ok"]
                .as_bool()
                .unwrap()
        );
        drop(sv);

        // Estraga 64 páginas inteiras no meio do arquivo.
        let db = p.sigtap_db();
        let mut b = std::fs::read(&db).unwrap();
        let ini = (b.len() / 2 / 4096) * 4096;
        for x in &mut b[ini..ini + 64 * 4096] {
            *x = 0xFF;
        }
        std::fs::write(&db, &b).unwrap();

        // Abertura seguinte: acha, guarda em quarentena e avisa; o programa abre sem banco.
        let sv = Servico::novo(p.clone());
        sv.iniciar();
        let rec = sv.situacao().unwrap()["recuperacao"].clone();
        assert!(!rec.is_null(), "o banco estragado devia ser achado");
        assert_eq!(rec["bancos"][0], "tabela de procedimentos");
        assert_eq!(rec["zips"], 3);
        assert!(!db.exists());
        assert!(
            p.dados
                .join("banco_com_problema_1")
                .join("sigtap.db")
                .exists()
        );
        assert!(
            p.dados
                .join("banco_com_problema_1")
                .join("LEIAME.txt")
                .exists()
        );
        assert!(sv.com_consulta(|_| Ok(())).is_err());

        // Refazer (caminho automático): volta com as mesmas 3 competências e o aviso some.
        sv.recriar(&em, &|_| {}, false).unwrap();
        sv.reabrir().unwrap();
        let depois = sv
            .com_consulta(|q| q.competencias().map_err(|e| e.to_string()))
            .unwrap();
        assert_eq!(
            depois
                .iter()
                .map(|c| (&c.competencia, &c.sha256))
                .collect::<Vec<_>>(),
            antes
                .iter()
                .map(|c| (&c.competencia, &c.sha256))
                .collect::<Vec<_>>()
        );
        assert!(sv.situacao().unwrap()["recuperacao"].is_null());
        assert!(
            sv.verificar_bancos(true)["itens"][0]["ok"]
                .as_bool()
                .unwrap()
        );
        eprintln!(
            "PROVA saúde: banco com 64 páginas estragadas achado na abertura, guardado em quarentena e refeito de 3 ZIPs reais com as mesmas competências e SHA-256"
        );
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn consulta_acompanha_mudanca_feita_por_outro_processo() {
        let Some(zips) = zips_reais(2) else { return };
        let p = pastas("mudou-por-fora");
        std::fs::create_dir_all(p.zips()).unwrap();
        for (_, z) in &zips {
            std::fs::copy(z, p.zips().join(z.file_name().unwrap())).unwrap();
        }
        let (em, _) = emissor();
        let sv = Servico::novo(p.clone());
        sv.recriar(&em, &|_| {}, true).unwrap();
        sv.reabrir().unwrap();
        let n = |sv: &Servico| {
            sv.com_consulta(|q| Ok(q.competencias().unwrap().len()))
                .unwrap()
        };
        assert_eq!(n(&sv), 2);
        // Outro processo (a CLI) tira uma competência do banco.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let mut b = BancoSigtap::abrir(&p.sigtap_db()).unwrap();
        b.remover(zips[1].0).unwrap();
        drop(b);
        assert_eq!(n(&sv), 1);
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn recriar_sem_zips_guardados_nao_troca_o_banco() {
        let p = pastas("recriar-sem-zips");
        std::fs::create_dir_all(p.zips()).unwrap();
        std::fs::write(p.sigtap_db(), b"banco do usuario").unwrap();
        let (em, _) = emissor();
        let sv = Servico::novo(p.clone());
        let erro = sv.recriar(&em, &|_| {}, true).unwrap_err();
        assert!(erro.contains("não há ZIPs guardados"), "{erro}");
        assert_eq!(std::fs::read(p.sigtap_db()).unwrap(), b"banco do usuario");
        assert!(!p.dados.join("banco_com_problema_1").exists());
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn recriar_avisa_quais_competencias_nao_tem_zip() {
        let Some(zips) = zips_reais(3) else { return };
        let p = pastas("faltam");
        std::fs::create_dir_all(p.zips()).unwrap();
        let (em, _) = emissor();
        // Banco com 3 competências, mas só 1 ZIP guardado.
        for (_, z) in &zips {
            std::fs::copy(z, p.zips().join(z.file_name().unwrap())).unwrap();
        }
        let sv = Servico::novo(p.clone());
        sv.recriar(&em, &|_| {}, true).unwrap();
        for (_, z) in &zips[..2] {
            std::fs::remove_file(p.zips().join(z.file_name().unwrap())).unwrap();
        }
        let msg = sv.recriar(&em, &|_| {}, true).unwrap();
        assert!(
            msg.contains("1 competência(s)") && msg.contains("faltam 2 competência(s)"),
            "{msg}"
        );
        assert!(msg.contains("banco_com_problema_1"), "{msg}");
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    #[test]
    fn avisa_competencia_nova_e_republicacao_sem_baixar_nada() {
        let Some(zips) = zips_reais(4) else { return };
        let p = pastas("avisos");
        std::fs::create_dir_all(p.zips()).unwrap();
        let (em, _) = emissor();
        // O banco tem as 3 mais antigas; o servidor tem as 4.
        for (_, z) in &zips[..3] {
            std::fs::copy(z, p.zips().join(z.file_name().unwrap())).unwrap();
        }
        let sv = Servico::novo(p.clone());
        sv.recriar(&em, &|_| {}, true).unwrap();
        let guardados_antes = dl::locais(&p.zips()).len();
        let f = fonte(&zips);
        let r = sv.verificar_dados_de(&f).unwrap();
        let novos = r["novos"].as_array().unwrap();
        assert_eq!(novos.len(), 1, "{r}");
        assert_eq!(novos[0]["motivo"], "nova");
        assert_eq!(novos[0]["competencia"], zips[3].0.to_string());
        assert_eq!(r["escopo"], "1");
        assert_eq!(
            dl::locais(&p.zips()).len(),
            guardados_antes,
            "não pode baixar nada"
        );

        // Republicação: o servidor passa a ter uma versão mais nova da 2ª competência.
        let (c2, z2) = &zips[1];
        let nome = z2.file_name().unwrap().to_string_lossy().into_owned();
        let versao = nome
            .rsplit("_v")
            .next()
            .unwrap()
            .trim_end_matches(".zip")
            .to_string();
        let nova = format!("{:010}", versao.parse::<u64>().unwrap() + 1);
        let nome_novo = nome.replace(&versao, &nova);
        let pasta_f = p.dados.join("falso");
        std::fs::create_dir_all(&pasta_f).unwrap();
        std::fs::copy(z2, pasta_f.join(&nome_novo)).unwrap();
        let mut com_rep = zips.clone();
        com_rep.push((*c2, pasta_f.join(&nome_novo)));
        let r = sv.verificar_dados_de(&fonte(&com_rep)).unwrap();
        let motivos: Vec<(String, String)> = r["novos"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| {
                (
                    x["competencia"].as_str().unwrap().into(),
                    x["motivo"].as_str().unwrap().into(),
                )
            })
            .collect();
        assert!(
            motivos.contains(&(c2.to_string(), "republicada".into())),
            "{motivos:?}"
        );
        assert!(
            motivos.contains(&(zips[3].0.to_string(), "nova".into())),
            "{motivos:?}"
        );
        // O escopo cobre da mais antiga com novidade até a mais recente do servidor.
        assert_eq!(r["escopo"], "3", "{r}");

        // Tudo em dia: nada a avisar.
        std::fs::copy(&zips[3].1, p.zips().join(zips[3].1.file_name().unwrap())).unwrap();
        sv.recriar(&em, &|_| {}, true).unwrap();
        let r = sv.verificar_dados_de(&fonte(&zips)).unwrap();
        assert!(r["novos"].as_array().unwrap().is_empty(), "{r}");
        assert!(r["escopo"].is_null());
        let _ = std::fs::remove_dir_all(&p.dados);
    }

    /// Trabalho que só termina quando recebe um sinal.
    fn presa() -> (crate::tarefas::Trabalho, std::sync::mpsc::Sender<()>) {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        (
            Box::new(move |c| {
                loop {
                    if c.cancelar.load(Ordering::SeqCst) {
                        return Err("cancelado".into());
                    }
                    if rx.recv_timeout(Duration::from_millis(5)).is_ok() {
                        return Ok("feito".into());
                    }
                }
            }),
            tx,
        )
    }

    #[test]
    fn so_pede_confirmacao_ao_fechar_com_tarefa_em_andamento() {
        let sv = Servico::novo(pastas("fechar-com-tarefa"));
        assert!(!crate::deve_pedir_confirmacao(&sv.agenda));
        let (trabalho, solta) = presa();
        sv.agenda
            .enviar(
                Fonte::Producao,
                "Produção",
                crate::tarefas::Quando::Agora,
                trabalho,
            )
            .unwrap();
        assert!(crate::deve_pedir_confirmacao(&sv.agenda));
        sv.agenda.cancelar_tudo();
        drop(solta);
    }

    #[test]
    fn fase_vem_da_mensagem() {
        for (m, f) in [
            ("Baixando STMS2608.dbc", Fase::Baixando),
            (
                "Carregando Estabelecimentos (STMS2608.dbc)",
                Fase::Carregando,
            ),
            ("Carregando no banco", Fase::Carregando),
            ("Carregando os nomes dos estabelecimentos", Fase::Carregando),
            ("Consultando o servidor do DATASUS", Fase::Baixando),
            ("Verificando os bancos", Fase::Verificando),
        ] {
            assert_eq!(fase_da_mensagem(m), f, "{m}");
        }
    }

    #[test]
    fn situacao_lista_as_tarefas_e_ocupado_e_alguma() {
        let sv = Servico::novo(pastas("situacao-tarefas"));
        assert_eq!(sv.situacao().unwrap()["ocupado"], false);
        assert_eq!(sv.situacao().unwrap()["tarefas"], serde_json::json!([]));
        let (t, s) = presa();
        sv.agenda
            .enviar(Fonte::Cnes, "CNES de MS", crate::tarefas::Quando::Agora, t)
            .unwrap();
        let j = sv.situacao().unwrap();
        assert_eq!(j["ocupado"], true);
        assert_eq!(j["tarefas"][0]["fonte"], "cnes");
        assert_eq!(j["tarefas"][0]["rotulo"], "CNES de MS");
        s.send(()).unwrap();
    }

    #[test]
    fn importar_de_pasta_apaga_os_zips_copiados_so_sem_manter() {
        let Some(zips) = zips_reais(2) else { return };
        for (apagar, nome) in [(true, "importar_apaga"), (false, "importar_mantem")] {
            let origem = pastas(&format!("{nome}_origem")).dados.join("entrada");
            let _ = std::fs::remove_dir_all(&origem);
            std::fs::create_dir_all(&origem).unwrap();
            for (_, z) in &zips {
                std::fs::copy(z, origem.join(z.file_name().unwrap())).unwrap();
            }
            let ps = pastas(nome);
            let (em, _) = emissor();
            importar(&ps, &origem, &AtomicBool::new(false), &em, apagar).unwrap();
            assert_eq!(carregadas(&ps).unwrap().len(), zips.len());
            // A pasta do usuário não é tocada; só a cópia em dados\zips depende da chave.
            assert_eq!(std::fs::read_dir(&origem).unwrap().count(), zips.len());
            let guardados = dl::locais(&ps.zips()).len();
            assert_eq!(
                guardados,
                if apagar { 0 } else { zips.len() },
                "apagar={apagar}"
            );
        }
    }

    #[test]
    fn apagar_zips_so_recusa_com_o_sigtap_ocupado() {
        let sv = Servico::novo(pastas("apagar-zips-fonte"));
        let (t, s) = presa();
        sv.agenda
            .enviar(Fonte::Cnes, "CNES", crate::tarefas::Quando::Agora, t)
            .unwrap();
        // O CNES ocupado não impede apagar os ZIPs do SIGTAP.
        if let Err(e) = sv.apagar_zips() {
            assert!(!e.contains("em andamento"), "{e}");
        }
        s.send(()).unwrap();
        let (t, s) = presa();
        sv.agenda
            .enviar(Fonte::Sigtap, "SIGTAP", crate::tarefas::Quando::Agora, t)
            .unwrap();
        assert!(
            sv.apagar_zips()
                .unwrap_err()
                .contains("tarefa do SIGTAP em andamento")
        );
        s.send(()).unwrap();
    }
}
