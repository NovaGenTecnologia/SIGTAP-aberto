//! Consultas.
//!
//! Fronteira: toda pergunta que a interface, a linha de comando ou uma biblioteca faz
//! aos módulos, com resposta serializável em JSON. Nenhuma tela faz SQL próprio.
//!
//! Regras (documento-mestre e `docs/fases/fase-2.md`):
//! - toda consulta é feita numa competência **carregada** (os intervalos atravessam meses não
//!   carregados, então consultar um mês ausente daria resposta falsa);
//! - nada de nome inventado: códigos viram nomes pelas tabelas do próprio ZIP (manifesto de
//!   referências) ou pelo `Lay-out.xls` (manifesto de domínios);
//! - identificadores SQL só por `safe_ident`; valores sempre por parâmetro.

pub mod arvore;
pub mod busca;
pub mod cid;
pub mod ficha;
pub mod historico;
pub mod mudancas;
pub mod preparo;
mod util;

use sa_core::Competencia;
use sa_packs::sigtap::{BancoSigtap, ErroBanco};
use sa_sources::sigtap::dominios::Dominios;
use sa_sources::sigtap::referencias::{Referencia, referencias};
use serde::Serialize;
use std::fmt;
use std::path::Path;

pub use util::mascarar;

/// Erro de consulta, com orientação.
#[derive(Debug)]
pub enum ErroConsulta {
    Banco(ErroBanco),
    Sql(rusqlite::Error),
    /// A competência pedida não está carregada.
    NaoCarregada(Competencia),
    /// O banco não tem nenhuma competência.
    BancoVazio,
    /// Texto de entrada inválido (código, competência).
    Entrada(String),
}

impl fmt::Display for ErroConsulta {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroConsulta::Banco(e) => write!(f, "{e}"),
            ErroConsulta::Sql(e) => write!(
                f,
                "falha ao consultar o banco do SIGTAP ({e}). Se persistir, refaça o banco a partir dos ZIPs em Módulos e dados."
            ),
            ErroConsulta::NaoCarregada(c) => write!(
                f,
                "a competência {c} não está carregada. Escolha outra competência ou baixe esta em Módulos e dados."
            ),
            ErroConsulta::BancoVazio => write!(
                f,
                "nenhuma competência do SIGTAP carregada. Baixe a tabela vigente ou importe os ZIPs em Módulos e dados."
            ),
            ErroConsulta::Entrada(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for ErroConsulta {}

impl From<rusqlite::Error> for ErroConsulta {
    fn from(e: rusqlite::Error) -> Self {
        ErroConsulta::Sql(e)
    }
}

impl From<ErroBanco> for ErroConsulta {
    fn from(e: ErroBanco) -> Self {
        ErroConsulta::Banco(e)
    }
}

/// Competência carregada, como a interface mostra.
#[derive(Debug, Clone, Serialize)]
pub struct CompetenciaInfo {
    /// `AAAAMM`.
    pub competencia: String,
    /// `MM/AAAA`.
    pub rotulo: String,
    pub arquivo: String,
    /// Carimbo `AAMMDDhhmm` do nome do ZIP, quando existe.
    pub versao: Option<String>,
    /// Data e hora de publicação lidas do carimbo (`DD/MM/AAAA hh:mm`).
    pub publicado_em: Option<String>,
    pub sha256: String,
}

/// Ponto de entrada das consultas sobre o banco do SIGTAP.
pub struct Consulta {
    banco: BancoSigtap,
    dominios: Dominios,
    refs: Vec<Referencia>,
    /// Sequências das competências carregadas, em ordem.
    seqs: Vec<i64>,
}

impl Consulta {
    /// Abre o banco e prepara índices e busca (idempotente; refaz a busca se os dados mudaram).
    pub fn abrir(caminho: &Path) -> Result<Self, ErroConsulta> {
        Self::de_banco(BancoSigtap::abrir(caminho)?)
    }

    /// Usa um banco já aberto (testes e aplicativo após uma carga).
    pub fn de_banco(banco: BancoSigtap) -> Result<Self, ErroConsulta> {
        let refs = referencias();
        preparo::preparar(banco.conexao(), &refs)?;
        let seqs = banco
            .competencias()?
            .iter()
            .map(|c| c.competencia.seq())
            .collect();
        Ok(Self {
            banco,
            dominios: Dominios::carregar(),
            refs,
            seqs,
        })
    }

    /// Devolve o banco (para carregar mais competências); chame `de_banco` de novo depois.
    pub fn banco(self) -> BancoSigtap {
        self.banco
    }

    pub(crate) fn conn(&self) -> &rusqlite::Connection {
        self.banco.conexao()
    }

    /// Competências carregadas, da mais antiga para a mais recente.
    pub fn competencias(&self) -> Result<Vec<CompetenciaInfo>, ErroConsulta> {
        Ok(self
            .banco
            .competencias()?
            .into_iter()
            .map(|c| CompetenciaInfo {
                competencia: c.competencia.to_string(),
                rotulo: util::rotulo(c.competencia),
                publicado_em: c.versao.as_deref().and_then(util::data_da_versao),
                arquivo: c.arquivo,
                versao: c.versao,
                sha256: c.sha256,
            })
            .collect())
    }

    /// A competência mais recente carregada (padrão da interface).
    pub fn mais_recente(&self) -> Result<Competencia, ErroConsulta> {
        let s = *self.seqs.last().ok_or(ErroConsulta::BancoVazio)?;
        Competencia::de_seq(s).map_err(|e| ErroConsulta::Entrada(e.to_string()))
    }

    pub(crate) fn exigir(&self, comp: Competencia) -> Result<i64, ErroConsulta> {
        let s = comp.seq();
        if self.seqs.binary_search(&s).is_ok() {
            Ok(s)
        } else if self.seqs.is_empty() {
            Err(ErroConsulta::BancoVazio)
        } else {
            Err(ErroConsulta::NaoCarregada(comp))
        }
    }

    pub(crate) fn seqs(&self) -> &[i64] {
        &self.seqs
    }
}
