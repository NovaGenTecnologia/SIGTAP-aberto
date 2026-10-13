//! Agenda das tarefas longas: uma vaga por fonte (SIGTAP, CNES, produção) e uma fila dentro de cada
//! fonte. Fontes diferentes rodam ao mesmo tempo; na mesma fonte, uma tarefa por vez, em ordem.
//! Não depende do Tauri: o aplicativo liga `ao_fim` aos eventos.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fonte {
    Sigtap,
    Cnes,
    Producao,
}

const FONTES: [Fonte; 3] = [Fonte::Sigtap, Fonte::Cnes, Fonte::Producao];

/// Tarefas que esperam na fila de uma fonte. Acima disso o pedido é recusado: uma fila sem limite
/// só acumula trabalho que ninguém vai esperar e deixa o cancelamento lento.
pub const MAX_FILA: usize = 50;

impl Fonte {
    pub fn nome(self) -> &'static str {
        match self {
            Fonte::Sigtap => "SIGTAP",
            Fonte::Cnes => "CNES",
            Fonte::Producao => "Produção",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quando {
    #[default]
    Agora,
    Depois,
}

/// O que a tarefa recebe ao rodar.
pub struct Contexto {
    pub fonte: Fonte,
    pub tarefa: u64,
    pub cancelar: Arc<AtomicBool>,
}

pub type Trabalho = Box<dyn FnOnce(&Contexto) -> Result<String, String> + Send + 'static>;

/// Fim de uma tarefa (evento `tarefa_fim`).
#[derive(Debug, Clone, Serialize)]
pub struct Fim {
    pub fonte: Fonte,
    pub tarefa: u64,
    pub ok: bool,
    pub cancelada: bool,
    pub mensagem: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Recibo {
    pub tarefa: u64,
    /// 0 = já está rodando; 1 em diante = lugar na fila.
    pub posicao: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct InfoTarefa {
    pub fonte: Fonte,
    pub tarefa: u64,
    pub rotulo: String,
    pub na_fila: bool,
}

struct Corrente {
    id: u64,
    rotulo: String,
    cancelar: Arc<AtomicBool>,
}

struct Pendente {
    id: u64,
    rotulo: String,
    trabalho: Trabalho,
}

#[derive(Default)]
struct Vaga {
    corrente: Option<Corrente>,
    fila: VecDeque<Pendente>,
}

type AoFim = Arc<dyn Fn(Fim) + Send + Sync>;

pub struct Agenda {
    vagas: Mutex<HashMap<Fonte, Vaga>>,
    proximo: AtomicU64,
    ao_fim: AoFim,
}

impl Agenda {
    pub fn nova(ao_fim: AoFim) -> Arc<Self> {
        Arc::new(Self {
            vagas: Mutex::new(HashMap::new()),
            proximo: AtomicU64::new(1),
            ao_fim,
        })
    }

    fn vagas(&self) -> std::sync::MutexGuard<'_, HashMap<Fonte, Vaga>> {
        self.vagas.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn enviar(
        self: &Arc<Self>,
        fonte: Fonte,
        rotulo: &str,
        quando: Quando,
        trabalho: Trabalho,
    ) -> Result<Recibo, String> {
        let id = self.proximo.fetch_add(1, Ordering::SeqCst);
        let mut g = self.vagas();
        let vaga = g.entry(fonte).or_default();
        if vaga.corrente.is_none() {
            let ctx = Contexto {
                fonte,
                tarefa: id,
                cancelar: Arc::new(AtomicBool::new(false)),
            };
            vaga.corrente = Some(Corrente {
                id,
                rotulo: rotulo.to_string(),
                cancelar: ctx.cancelar.clone(),
            });
            drop(g);
            self.disparar(ctx, trabalho);
            return Ok(Recibo {
                tarefa: id,
                posicao: 0,
            });
        }
        if quando == Quando::Agora {
            return Err(format!(
                "Já há uma tarefa de {} em andamento.",
                fonte.nome()
            ));
        }
        if vaga.fila.len() >= MAX_FILA {
            return Err(format!(
                "A fila de {} está cheia ({MAX_FILA} tarefas). Espere terminar ou cancele.",
                fonte.nome()
            ));
        }
        vaga.fila.push_back(Pendente {
            id,
            rotulo: rotulo.to_string(),
            trabalho,
        });
        Ok(Recibo {
            tarefa: id,
            posicao: vaga.fila.len(),
        })
    }

    fn disparar(self: &Arc<Self>, ctx: Contexto, trabalho: Trabalho) {
        let agenda = self.clone();
        std::thread::spawn(move || {
            let r = catch_unwind(AssertUnwindSafe(|| trabalho(&ctx)))
                .unwrap_or_else(|_| Err("falha interna na tarefa".to_string()));
            let cancelada = ctx.cancelar.load(Ordering::SeqCst);
            let fim = match r {
                Ok(m) => Fim {
                    fonte: ctx.fonte,
                    tarefa: ctx.tarefa,
                    ok: true,
                    cancelada: false,
                    mensagem: m,
                },
                Err(e) => Fim {
                    fonte: ctx.fonte,
                    tarefa: ctx.tarefa,
                    ok: false,
                    cancelada,
                    mensagem: e,
                },
            };
            // A próxima da fila ocupa a vaga antes do aviso: quem consulta `ocupada` nunca vê uma
            // fonte "livre" entre duas tarefas encadeadas.
            let proxima = {
                let mut g = agenda.vagas();
                let vaga = g.entry(ctx.fonte).or_default();
                vaga.corrente = None;
                vaga.fila.pop_front().map(|p| {
                    let c = Contexto {
                        fonte: ctx.fonte,
                        tarefa: p.id,
                        cancelar: Arc::new(AtomicBool::new(false)),
                    };
                    vaga.corrente = Some(Corrente {
                        id: p.id,
                        rotulo: p.rotulo,
                        cancelar: c.cancelar.clone(),
                    });
                    (c, p.trabalho)
                })
            };
            (agenda.ao_fim)(fim);
            if let Some((c, t)) = proxima {
                agenda.disparar(c, t);
            }
        });
    }

    /// Cancela a tarefa em andamento da fonte e descarta a fila dela.
    pub fn cancelar(&self, fonte: Fonte) {
        let descartadas: Vec<Pendente> = {
            let mut g = self.vagas();
            let Some(vaga) = g.get_mut(&fonte) else {
                return;
            };
            if let Some(c) = &vaga.corrente {
                c.cancelar.store(true, Ordering::SeqCst);
            }
            vaga.fila.drain(..).collect()
        };
        for p in descartadas {
            (self.ao_fim)(Fim {
                fonte,
                tarefa: p.id,
                ok: false,
                cancelada: true,
                mensagem: "Cancelado.".into(),
            });
        }
    }

    pub fn cancelar_tudo(&self) {
        for f in FONTES {
            self.cancelar(f);
        }
    }

    pub fn ocupada(&self, fonte: Fonte) -> bool {
        self.vagas()
            .get(&fonte)
            .is_some_and(|v| v.corrente.is_some() || !v.fila.is_empty())
    }

    pub fn alguma(&self) -> bool {
        FONTES.into_iter().any(|f| self.ocupada(f))
    }

    pub fn lista(&self) -> Vec<InfoTarefa> {
        let g = self.vagas();
        let mut v = Vec::new();
        for f in FONTES {
            let Some(vaga) = g.get(&f) else { continue };
            if let Some(c) = &vaga.corrente {
                v.push(InfoTarefa {
                    fonte: f,
                    tarefa: c.id,
                    rotulo: c.rotulo.clone(),
                    na_fila: false,
                });
            }
            for p in &vaga.fila {
                v.push(InfoTarefa {
                    fonte: f,
                    tarefa: p.id,
                    rotulo: p.rotulo.clone(),
                    na_fila: true,
                });
            }
        }
        v
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::time::Duration;

    fn agenda() -> (Arc<Agenda>, Receiver<Fim>) {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        (
            Agenda::nova(Arc::new(move |f| {
                let _ = tx.lock().unwrap().send(f);
            })),
            rx,
        )
    }

    /// Trabalho que só termina quando recebe um sinal (ou é cancelado).
    fn preso() -> (Trabalho, Sender<()>) {
        let (tx, rx) = channel::<()>();
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

    const ESPERA: Duration = Duration::from_secs(5);

    #[test]
    fn fontes_diferentes_rodam_ao_mesmo_tempo() {
        let (a, rx) = agenda();
        let (t1, s1) = preso();
        let (t2, s2) = preso();
        assert_eq!(
            a.enviar(Fonte::Sigtap, "SIGTAP", Quando::Agora, t1)
                .unwrap()
                .posicao,
            0
        );
        assert_eq!(
            a.enviar(Fonte::Cnes, "CNES", Quando::Agora, t2)
                .unwrap()
                .posicao,
            0
        );
        assert!(a.ocupada(Fonte::Sigtap) && a.ocupada(Fonte::Cnes) && !a.ocupada(Fonte::Producao));
        s1.send(()).unwrap();
        s2.send(()).unwrap();
        let fins = [
            rx.recv_timeout(ESPERA).unwrap(),
            rx.recv_timeout(ESPERA).unwrap(),
        ];
        assert!(fins.iter().all(|f| f.ok));
        assert!(!a.alguma());
    }

    #[test]
    fn mesma_fonte_agora_com_vaga_ocupada_e_recusada() {
        let (a, _rx) = agenda();
        let (t1, _s1) = preso();
        let (t2, _s2) = preso();
        a.enviar(Fonte::Cnes, "A", Quando::Agora, t1).unwrap();
        let e = a.enviar(Fonte::Cnes, "B", Quando::Agora, t2).unwrap_err();
        assert_eq!(e, "Já há uma tarefa de CNES em andamento.");
        a.cancelar_tudo();
    }

    #[test]
    fn mesma_fonte_depois_entra_na_fila_e_roda_em_ordem() {
        let (a, rx) = agenda();
        let ordem = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let (t1, s1) = preso();
        a.enviar(Fonte::Sigtap, "1", Quando::Agora, t1).unwrap();
        let o = ordem.clone();
        let r2 = a
            .enviar(
                Fonte::Sigtap,
                "2",
                Quando::Depois,
                Box::new(move |_| {
                    o.lock().unwrap().push("2");
                    Ok("2".into())
                }),
            )
            .unwrap();
        let o = ordem.clone();
        let r3 = a
            .enviar(
                Fonte::Sigtap,
                "3",
                Quando::Depois,
                Box::new(move |_| {
                    o.lock().unwrap().push("3");
                    Ok("3".into())
                }),
            )
            .unwrap();
        assert_eq!((r2.posicao, r3.posicao), (1, 2));
        assert_eq!(a.lista().iter().filter(|i| i.na_fila).count(), 2);
        s1.send(()).unwrap();
        let fins: Vec<Fim> = (0..3).map(|_| rx.recv_timeout(ESPERA).unwrap()).collect();
        assert_eq!(
            fins.iter().map(|f| f.mensagem.as_str()).collect::<Vec<_>>(),
            ["feito", "2", "3"]
        );
        assert_eq!(*ordem.lock().unwrap(), ["2", "3"]);
    }

    #[test]
    fn fila_cheia_recusa_e_cancelar_continua_rapido() {
        let (a, rx) = agenda();
        let (t, _s) = preso();
        a.enviar(Fonte::Sigtap, "0", Quando::Agora, t).unwrap();
        for _ in 0..MAX_FILA {
            a.enviar(
                Fonte::Sigtap,
                "x",
                Quando::Depois,
                Box::new(|_| Ok("".into())),
            )
            .unwrap();
        }
        let e = a
            .enviar(
                Fonte::Sigtap,
                "x",
                Quando::Depois,
                Box::new(|_| Ok("".into())),
            )
            .unwrap_err();
        assert!(e.contains("fila de SIGTAP está cheia"), "{e}");
        let ini = std::time::Instant::now();
        a.cancelar(Fonte::Sigtap);
        for _ in 0..=MAX_FILA {
            assert!(rx.recv_timeout(ESPERA).unwrap().cancelada);
        }
        assert!(ini.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn depois_com_a_vaga_livre_roda_na_hora() {
        let (a, rx) = agenda();
        let r = a
            .enviar(
                Fonte::Producao,
                "P",
                Quando::Depois,
                Box::new(|_| Ok("ok".into())),
            )
            .unwrap();
        assert_eq!(r.posicao, 0);
        assert!(rx.recv_timeout(ESPERA).unwrap().ok);
    }

    #[test]
    fn cancelar_a_fonte_para_a_corrente_e_limpa_so_a_fila_dela() {
        let (a, rx) = agenda();
        let (c1, _s) = preso();
        let (o1, so) = preso();
        a.enviar(Fonte::Cnes, "c1", Quando::Agora, c1).unwrap();
        a.enviar(
            Fonte::Cnes,
            "c2",
            Quando::Depois,
            Box::new(|_| Ok("nunca".into())),
        )
        .unwrap();
        a.enviar(Fonte::Sigtap, "s1", Quando::Agora, o1).unwrap();
        a.cancelar(Fonte::Cnes);
        let mut cnes = [
            rx.recv_timeout(ESPERA).unwrap(),
            rx.recv_timeout(ESPERA).unwrap(),
        ];
        cnes.sort_by_key(|f| f.tarefa);
        assert!(
            cnes.iter()
                .all(|f| f.fonte == Fonte::Cnes && f.cancelada && !f.ok)
        );
        assert!(a.ocupada(Fonte::Sigtap) && !a.ocupada(Fonte::Cnes));
        so.send(()).unwrap();
        assert!(rx.recv_timeout(ESPERA).unwrap().ok);
    }

    #[test]
    fn erro_e_panico_liberam_a_vaga_e_seguem_a_fila() {
        let (a, rx) = agenda();
        let (t, s) = preso();
        a.enviar(Fonte::Producao, "p1", Quando::Agora, t).unwrap();
        a.enviar(
            Fonte::Producao,
            "p2",
            Quando::Depois,
            Box::new(|_| panic!("quebrou")),
        )
        .unwrap();
        a.enviar(
            Fonte::Producao,
            "p3",
            Quando::Depois,
            Box::new(|_| Ok("p3".into())),
        )
        .unwrap();
        s.send(()).unwrap();
        let f: Vec<Fim> = (0..3).map(|_| rx.recv_timeout(ESPERA).unwrap()).collect();
        assert!(f[0].ok);
        assert!(!f[1].ok && f[1].mensagem.starts_with("falha interna"));
        assert!(f[2].ok && f[2].mensagem == "p3");
        assert!(!a.alguma());
    }

    #[test]
    fn varias_fontes_terminando_juntas_nao_perdem_fim() {
        let (a, rx) = agenda();
        for f in FONTES {
            a.enviar(f, "x", Quando::Agora, Box::new(|_| Ok("ok".into())))
                .unwrap();
        }
        let mut vistas = std::collections::HashSet::new();
        for _ in 0..3 {
            vistas.insert(rx.recv_timeout(ESPERA).unwrap().fonte);
        }
        assert_eq!(vistas.len(), 3);
    }
}
