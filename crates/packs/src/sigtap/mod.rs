//! Módulo de dados SIGTAP: um banco SQLite com todas as competências carregadas, em
//! intervalos de vigência.
//!
//! Modelo (decidido na abertura da Fase 1, `docs/fases/fase-1.md`):
//! - para cada tabela de origem `T` há `T` (conteúdos distintos: todas as colunas menos
//!   `DT_COMPETENCIA`, mais a multiplicidade `sa_qtd`, identificados por `sa_hash`) e
//!   `T__vig` (intervalos `vig_ini`..`vig_fim`, em sequência de meses, em que o conteúdo
//!   existe);
//! - intervalos são máximos: dois intervalos de um mesmo conteúdo nunca se tocam em
//!   competências carregadas vizinhas;
//! - `DT_COMPETENCIA` é derivada da competência e conferida na carga;
//! - leiaute de cada competência guardado em `sa_leiaute`; presença e contagem em `sa_tabela`;
//! - ordem física dos registros guardada em `sa_ordem` só quando o arquivo oficial não está em
//!   ordem de bytes (1.342 dos 8.442 arquivos), para a reconstrução ser idêntica byte a byte.

pub mod valor;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sa_core::{Competencia, Ident, safe_ident};
use sa_sources::sigtap::{Coluna, ErroSigtap, Leiaute, Tipo, ZipSigtap};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::path::Path;
pub use valor::Valor;

/// Versão do esquema do banco. Mudou o esquema, muda o número.
pub const VERSAO_ESQUEMA: &str = "1";

const COL_DT: &str = "dt_competencia";

/// Erro do módulo SIGTAP.
#[derive(Debug)]
pub enum ErroBanco {
    Sqlite(rusqlite::Error),
    Fonte(ErroSigtap),
    Arquivo(String),
    Campo {
        arquivo: String,
        registro: usize,
        motivo: String,
    },
    Inconsistencia(String),
    NaoCarregada(Competencia),
}

impl fmt::Display for ErroBanco {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroBanco::Sqlite(e) => write!(
                f,
                "erro no banco de dados ({e}). Se persistir, apague sigtap.db: ele é reconstruído a partir dos ZIPs guardados"
            ),
            ErroBanco::Fonte(e) => e.fmt(f),
            ErroBanco::Arquivo(e) => write!(f, "{e}"),
            ErroBanco::Campo {
                arquivo,
                registro,
                motivo,
            } => write!(
                f,
                "{arquivo}, registro {registro}: {motivo}. O arquivo foge da regra de preenchimento do SIGTAP; a carga foi interrompida para não gravar dado errado"
            ),
            ErroBanco::Inconsistencia(e) => write!(
                f,
                "inconsistência no banco: {e}. Apague sigtap.db e carregue os ZIPs de novo"
            ),
            ErroBanco::NaoCarregada(c) => write!(
                f,
                "a competência {c} não está carregada. Carregue o ZIP dela (TabelaUnificada_{c}_v….zip) e tente de novo"
            ),
        }
    }
}

impl std::error::Error for ErroBanco {}

impl From<rusqlite::Error> for ErroBanco {
    fn from(e: rusqlite::Error) -> Self {
        ErroBanco::Sqlite(e)
    }
}

impl From<ErroSigtap> for ErroBanco {
    fn from(e: ErroSigtap) -> Self {
        ErroBanco::Fonte(e)
    }
}

/// Resultado da carga de uma competência.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumoCarga {
    pub competencia: Competencia,
    pub tabelas: usize,
    pub registros: usize,
    pub substituiu: bool,
}

/// Competência carregada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompetenciaCarregada {
    pub competencia: Competencia,
    pub arquivo: String,
    pub versao: Option<String>,
    pub sha256: String,
}

type Hash = [u8; 32];

/// Conteúdo distinto: hash, valores das colunas guardadas e multiplicidade.
type Conteudo = (Hash, Vec<(Ident, Valor)>, i64);

/// Banco do módulo SIGTAP.
pub struct BancoSigtap {
    conn: Connection,
    /// Cache hash → sa_id por tabela (só durante a vida do objeto).
    cache: HashMap<String, HashMap<Hash, i64>>,
}

const ESQUEMA_META: &str = "
CREATE TABLE IF NOT EXISTS sa_info(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_competencia(
    seq INTEGER PRIMARY KEY, aaaamm TEXT NOT NULL UNIQUE, arquivo TEXT NOT NULL,
    versao TEXT, sha256 TEXT NOT NULL, carregado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_tabela(
    seq INTEGER NOT NULL, tabela TEXT NOT NULL, registros INTEGER NOT NULL,
    ordenado INTEGER NOT NULL, PRIMARY KEY(seq, tabela));
CREATE TABLE IF NOT EXISTS sa_leiaute(
    seq INTEGER NOT NULL, tabela TEXT NOT NULL, ordem INTEGER NOT NULL, coluna TEXT NOT NULL,
    coluna_origem TEXT NOT NULL, tamanho INTEGER NOT NULL, inicio INTEGER NOT NULL,
    fim INTEGER NOT NULL, tipo TEXT NOT NULL, PRIMARY KEY(seq, tabela, ordem));
CREATE TABLE IF NOT EXISTS sa_ordem(
    seq INTEGER NOT NULL, tabela TEXT NOT NULL, ids BLOB NOT NULL, PRIMARY KEY(seq, tabela));
";

/// Conteúdo de uma tabela numa competência, já interpretado.
struct TabelaInterpretada {
    leiaute: Leiaute,
    /// Conteúdos distintos: hash → (valores das colunas guardadas, multiplicidade).
    conteudos: Vec<Conteudo>,
    /// Ordem dos registros no arquivo, como índice em `conteudos`.
    ordem: Vec<usize>,
    ordenado: bool,
    registros: usize,
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn hash_conteudo(valores: &[(Ident, Valor)], qtd: i64) -> Hash {
    let mut ordenados: Vec<&(Ident, Valor)> = valores.iter().collect();
    ordenados.sort_by(|a, b| a.0.cmp(&b.0));
    let mut h = Sha256::new();
    h.update(qtd.to_le_bytes());
    for (nome, v) in ordenados {
        h.update(nome.como_str().as_bytes());
        h.update([0u8]);
        match v {
            Valor::Inteiro(n) => {
                h.update(b"I");
                h.update(n.to_le_bytes());
            }
            Valor::Texto(s) => {
                h.update(b"T");
                h.update(s.as_bytes());
            }
        }
        h.update([0xFFu8]);
    }
    h.finalize().into()
}

fn interpretar(
    competencia: Competencia,
    arquivo: &str,
    leiaute: Leiaute,
    registros: Vec<&[u8]>,
) -> Result<TabelaInterpretada, ErroBanco> {
    let comp_txt = competencia.to_string();
    // Agrupa registros idênticos (multiplicidade), preservando a ordem do arquivo.
    let mut indice: HashMap<&[u8], usize> = HashMap::new();
    let mut distintos: Vec<(&[u8], i64)> = Vec::new();
    let mut ordem = Vec::with_capacity(registros.len());
    for r in &registros {
        let i = *indice.entry(r).or_insert_with(|| {
            distintos.push((r, 0));
            distintos.len() - 1
        });
        distintos[i].1 += 1;
        ordem.push(i);
    }
    let ordenado = registros.windows(2).all(|w| w[0] <= w[1]);
    let mut conteudos = Vec::with_capacity(distintos.len());
    for (n, (reg, qtd)) in distintos.iter().enumerate() {
        let mut valores = Vec::with_capacity(leiaute.colunas.len());
        for c in &leiaute.colunas {
            let v = valor::ler(c, c.campo(reg)).map_err(|e| ErroBanco::Campo {
                arquivo: arquivo.to_string(),
                registro: n + 1,
                motivo: e.to_string(),
            })?;
            if c.nome.como_str() == COL_DT {
                if v != Valor::Texto(comp_txt.clone()) {
                    return Err(ErroBanco::Campo {
                        arquivo: arquivo.to_string(),
                        registro: n + 1,
                        motivo: format!(
                            "DT_COMPETENCIA {v:?} diferente da competência do arquivo ({comp_txt})"
                        ),
                    });
                }
                continue;
            }
            valores.push((c.nome.clone(), v));
        }
        let h = hash_conteudo(&valores, *qtd);
        conteudos.push((h, valores, *qtd));
    }
    Ok(TabelaInterpretada {
        leiaute,
        conteudos,
        ordem,
        ordenado,
        registros: registros.len(),
    })
}

fn codificar_ids(ids: &[i64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(ids.len() * 3);
    for &id in ids {
        let mut v = id as u64;
        loop {
            let b = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                break;
            }
            out.push(b | 0x80);
        }
    }
    out
}

fn decodificar_ids(b: &[u8]) -> Vec<i64> {
    let mut out = Vec::new();
    let (mut v, mut desloc) = (0u64, 0u32);
    for &x in b {
        v |= u64::from(x & 0x7F) << desloc;
        if x & 0x80 == 0 {
            out.push(v as i64);
            v = 0;
            desloc = 0;
        } else {
            desloc += 7;
        }
    }
    out
}

fn tabela_vig(t: &Ident) -> Result<Ident, ErroBanco> {
    safe_ident(&format!("{}__vig", t.como_str()))
        .map_err(|e| ErroBanco::Inconsistencia(e.to_string()))
}

fn valor_sql(v: &Valor) -> rusqlite::types::Value {
    match v {
        Valor::Inteiro(n) => rusqlite::types::Value::Integer(*n),
        Valor::Texto(s) => rusqlite::types::Value::Text(s.clone()),
    }
}

impl BancoSigtap {
    /// Abre (ou cria) o banco no caminho dado.
    pub fn abrir(caminho: &Path) -> Result<Self, ErroBanco> {
        let conn = Connection::open(caminho)?;
        Self::preparar(conn)
    }

    /// Banco em memória (testes).
    pub fn em_memoria() -> Result<Self, ErroBanco> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(conn: Connection) -> Result<Self, ErroBanco> {
        // busy_timeout: o aplicativo consulta numa conexão enquanto outra carrega competências.
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000;",
        )?;
        conn.execute_batch(ESQUEMA_META)?;
        let versao: Option<String> = conn
            .query_row(
                "SELECT valor FROM sa_info WHERE chave='versao_esquema'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        match versao {
            None => {
                conn.execute(
                    "INSERT INTO sa_info(chave, valor) VALUES('versao_esquema', ?1)",
                    [VERSAO_ESQUEMA],
                )?;
            }
            Some(v) if v == VERSAO_ESQUEMA => {}
            Some(v) => {
                return Err(ErroBanco::Inconsistencia(format!(
                    "esquema versão {v}, este programa usa a {VERSAO_ESQUEMA}"
                )));
            }
        }
        Ok(Self {
            conn,
            cache: HashMap::new(),
        })
    }

    /// Competências carregadas, em ordem.
    pub fn competencias(&self) -> Result<Vec<CompetenciaCarregada>, ErroBanco> {
        let mut st = self
            .conn
            .prepare("SELECT seq, arquivo, versao, sha256 FROM sa_competencia ORDER BY seq")?;
        let v = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        v.into_iter()
            .map(|(seq, arquivo, versao, sha256)| {
                let competencia = Competencia::de_seq(seq)
                    .map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
                Ok(CompetenciaCarregada {
                    competencia,
                    arquivo,
                    versao,
                    sha256,
                })
            })
            .collect()
    }

    fn seqs_carregadas(tx: &Transaction<'_>) -> Result<Vec<i64>, ErroBanco> {
        let mut st = tx.prepare("SELECT seq FROM sa_competencia ORDER BY seq")?;
        let v = st
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<i64>, _>>()?;
        Ok(v)
    }

    fn tabelas_conhecidas(tx: &Transaction<'_>) -> Result<BTreeSet<String>, ErroBanco> {
        let mut st = tx.prepare("SELECT DISTINCT tabela FROM sa_tabela")?;
        let v = st
            .query_map([], |r| r.get(0))?
            .collect::<Result<BTreeSet<String>, _>>()?;
        Ok(v)
    }

    /// Carrega um ZIP oficial. Se a competência já estiver carregada, substitui
    /// (republicação); se for anterior a outras, reconstrói a cadeia (retroativo).
    pub fn carregar_zip(&mut self, caminho: &Path) -> Result<ResumoCarga, ErroBanco> {
        let bytes = std::fs::read(caminho).map_err(|e| {
            ErroBanco::Arquivo(format!(
                "não foi possível ler {} ({e}). Confira se o arquivo existe e não está aberto em outro programa",
                caminho.display()
            ))
        })?;
        let sha = sha256_hex(&bytes);
        drop(bytes);
        let mut zip = ZipSigtap::abrir(caminho)?;
        let comp = zip.nome.competencia;
        let mut lidas = Vec::new();
        for t in zip.tabelas() {
            let tabela = zip.ler_tabela(&t)?;
            let nome_arquivo = format!("{}/{t}.txt", zip.arquivo);
            let leiaute = tabela.leiaute.clone();
            if leiaute.tabela.como_str().starts_with("sa_") {
                return Err(ErroBanco::Inconsistencia(format!(
                    "tabela de origem com nome reservado: {t}"
                )));
            }
            let interpretada =
                interpretar(comp, &nome_arquivo, leiaute, tabela.registros().collect())?;
            lidas.push(interpretada);
        }
        let arquivo = zip.arquivo.clone();
        let versao = zip.nome.versao.clone();
        self.gravar_competencia(comp, &arquivo, versao.as_deref(), &sha, lidas)
    }

    fn gravar_competencia(
        &mut self,
        comp: Competencia,
        arquivo: &str,
        versao: Option<&str>,
        sha: &str,
        lidas: Vec<TabelaInterpretada>,
    ) -> Result<ResumoCarga, ErroBanco> {
        let s = comp.seq();
        let tx = self.conn.transaction()?;
        let mut carregadas = Self::seqs_carregadas(&tx)?;
        let substituiu = carregadas.contains(&s);
        if substituiu {
            Self::remover_em(&tx, &mut self.cache, s, &carregadas)?;
            carregadas.retain(|&x| x != s);
        }
        let prev = carregadas.iter().copied().filter(|&x| x < s).max();
        let next = carregadas.iter().copied().filter(|&x| x > s).min();
        let mut novas = carregadas.clone();
        novas.push(s);
        novas.sort_unstable();

        let mut todas: BTreeSet<String> = Self::tabelas_conhecidas(&tx)?;
        let mut registros_total = 0;
        let mut presentes_por_tabela: BTreeMap<String, Vec<i64>> = BTreeMap::new();
        for t in &lidas {
            let nome = t.leiaute.tabela.como_str().to_string();
            todas.insert(nome.clone());
            Self::garantir_tabela(&tx, &t.leiaute)?;
            let ids = Self::gravar_conteudos(&tx, &mut self.cache, t)?;
            // Metadados da competência.
            tx.execute(
                "INSERT INTO sa_tabela(seq, tabela, registros, ordenado) VALUES(?1, ?2, ?3, ?4)",
                params![s, nome, t.registros as i64, t.ordenado],
            )?;
            for (i, c) in t.leiaute.colunas.iter().enumerate() {
                tx.execute(
                    "INSERT INTO sa_leiaute(seq, tabela, ordem, coluna, coluna_origem, tamanho, inicio, fim, tipo)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        s,
                        nome,
                        i as i64,
                        c.nome.como_str(),
                        c.nome_origem,
                        c.tamanho as i64,
                        c.inicio as i64,
                        c.fim as i64,
                        c.tipo.como_str()
                    ],
                )?;
            }
            if !t.ordenado {
                let ordem: Vec<i64> = t.ordem.iter().map(|&i| ids[i]).collect();
                tx.execute(
                    "INSERT INTO sa_ordem(seq, tabela, ids) VALUES(?1, ?2, ?3)",
                    params![s, nome, codificar_ids(&ordem)],
                )?;
            }
            registros_total += t.registros;
            let mut unicos = ids.clone();
            unicos.sort_unstable();
            unicos.dedup();
            presentes_por_tabela.insert(nome, unicos);
        }
        tx.execute(
            "INSERT INTO sa_competencia(seq, aaaamm, arquivo, versao, sha256, carregado_em)
             VALUES(?1, ?2, ?3, ?4, ?5, datetime('now'))",
            params![s, comp.to_string(), arquivo, versao, sha],
        )?;
        // Intervalos de vigência.
        for nome in &todas {
            let t = safe_ident(nome).map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
            let presentes = presentes_por_tabela.get(nome).cloned().unwrap_or_default();
            if next.is_none() {
                Self::anexar(&tx, &t, s, prev, &presentes)?;
            } else {
                Self::recalcular(&tx, &t, s, prev, next, &novas, Some(&presentes))?;
            }
        }
        tx.commit()?;
        Ok(ResumoCarga {
            competencia: comp,
            tabelas: lidas.len(),
            registros: registros_total,
            substituiu,
        })
    }

    fn garantir_tabela(tx: &Transaction<'_>, l: &Leiaute) -> Result<(), ErroBanco> {
        let t = &l.tabela;
        let v = tabela_vig(t)?;
        let idx1 = safe_ident(&format!("{}__i1", v.como_str()))
            .map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
        let idx2 = safe_ident(&format!("{}__i2", v.como_str()))
            .map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
        let idx3 = safe_ident(&format!("{}__i3", v.como_str()))
            .map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
        tx.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {t}(sa_id INTEGER PRIMARY KEY, sa_hash BLOB NOT NULL UNIQUE, sa_qtd INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS {v}(sa_id INTEGER NOT NULL REFERENCES {t}(sa_id), vig_ini INTEGER NOT NULL, vig_fim INTEGER NOT NULL);
             CREATE INDEX IF NOT EXISTS {idx1} ON {v}(sa_id, vig_fim);
             CREATE INDEX IF NOT EXISTS {idx2} ON {v}(vig_fim);
             CREATE INDEX IF NOT EXISTS {idx3} ON {v}(vig_ini);"
        ))?;
        let existentes: BTreeSet<String> = {
            let mut st = tx.prepare(&format!(
                "SELECT name FROM pragma_table_info('{}')",
                t.como_str()
            ))?;
            st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        for c in &l.colunas {
            if c.nome.como_str() == COL_DT || existentes.contains(c.nome.como_str()) {
                continue;
            }
            // Sem tipo declarado: o SQLite guarda inteiro como inteiro e texto como texto.
            tx.execute_batch(&format!("ALTER TABLE {t} ADD COLUMN {}", c.nome))?;
        }
        Ok(())
    }

    /// Grava conteúdos novos e devolve o sa_id de cada conteúdo (na ordem de `t.conteudos`).
    fn gravar_conteudos(
        tx: &Transaction<'_>,
        cache: &mut HashMap<String, HashMap<Hash, i64>>,
        t: &TabelaInterpretada,
    ) -> Result<Vec<i64>, ErroBanco> {
        let nome = t.leiaute.tabela.como_str().to_string();
        let tab = &t.leiaute.tabela;
        if !cache.contains_key(&nome) {
            let mut st = tx.prepare(&format!("SELECT sa_hash, sa_id FROM {tab}"))?;
            let mapa = st
                .query_map([], |r| Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, i64>(1)?)))?
                .map(|x| {
                    x.map(|(h, id)| {
                        let mut a = [0u8; 32];
                        a.copy_from_slice(&h);
                        (a, id)
                    })
                })
                .collect::<Result<HashMap<_, _>, _>>()?;
            cache.insert(nome.clone(), mapa);
        }
        let mapa = cache.get_mut(&nome).expect("cache recém-preenchido");
        let colunas: Vec<&Coluna> = t
            .leiaute
            .colunas
            .iter()
            .filter(|c| c.nome.como_str() != COL_DT)
            .collect();
        let lista_cols: String = colunas.iter().map(|c| format!(", {}", c.nome)).collect();
        let marcadores: String = (0..colunas.len())
            .map(|i| format!(", ?{}", i + 3))
            .collect();
        let mut ins = tx.prepare(&format!(
            "INSERT INTO {tab}(sa_hash, sa_qtd{lista_cols}) VALUES(?1, ?2{marcadores})"
        ))?;
        let mut ids = Vec::with_capacity(t.conteudos.len());
        for (h, valores, qtd) in &t.conteudos {
            if let Some(&id) = mapa.get(h) {
                ids.push(id);
                continue;
            }
            let mut p: Vec<rusqlite::types::Value> = Vec::with_capacity(valores.len() + 2);
            p.push(rusqlite::types::Value::Blob(h.to_vec()));
            p.push(rusqlite::types::Value::Integer(*qtd));
            p.extend(valores.iter().map(|(_, v)| valor_sql(v)));
            ins.execute(rusqlite::params_from_iter(p))?;
            let id = tx.last_insert_rowid();
            mapa.insert(*h, id);
            ids.push(id);
        }
        Ok(ids)
    }

    /// Caminho rápido: competência nova depois de todas as carregadas.
    fn anexar(
        tx: &Transaction<'_>,
        t: &Ident,
        s: i64,
        prev: Option<i64>,
        presentes: &[i64],
    ) -> Result<(), ErroBanco> {
        let v = tabela_vig(t)?;
        tx.execute_batch("CREATE TEMP TABLE IF NOT EXISTS sa_p(sa_id INTEGER PRIMARY KEY); DELETE FROM temp.sa_p;")?;
        {
            let mut ins = tx.prepare("INSERT INTO temp.sa_p(sa_id) VALUES(?1)")?;
            for id in presentes {
                ins.execute([id])?;
            }
        }
        if let Some(p) = prev {
            tx.execute(
                &format!("UPDATE {v} SET vig_fim = ?1 WHERE vig_fim = ?2 AND sa_id IN (SELECT sa_id FROM temp.sa_p)"),
                params![s, p],
            )?;
        }
        tx.execute(
            &format!(
                "INSERT INTO {v}(sa_id, vig_ini, vig_fim) SELECT sa_id, ?1, ?1 FROM temp.sa_p
                 WHERE sa_id NOT IN (SELECT sa_id FROM {v} WHERE vig_fim = ?1)"
            ),
            params![s],
        )?;
        Ok(())
    }

    /// Caminho geral: recalcula os intervalos que encostam em `s` (retroativo, republicação,
    /// remoção). `presentes` = `Some(ids)` ao adicionar `s`; `None` ao remover `s`.
    /// `carregadas` = competências carregadas depois da operação.
    fn recalcular(
        tx: &Transaction<'_>,
        t: &Ident,
        s: i64,
        prev: Option<i64>,
        next: Option<i64>,
        carregadas: &[i64],
        presentes: Option<&[i64]>,
    ) -> Result<(), ErroBanco> {
        let v = tabela_vig(t)?;
        let lo = prev.unwrap_or(s);
        let hi = next.unwrap_or(s);
        // Intervalos que tocam [lo, hi]: só eles podem mudar (os demais são máximos e não encostam).
        let mut afetados: BTreeMap<i64, Vec<(i64, i64)>> = BTreeMap::new();
        {
            let mut st = tx.prepare(&format!(
                "SELECT sa_id, vig_ini, vig_fim FROM {v} WHERE vig_fim >= ?1 AND vig_ini <= ?2"
            ))?;
            let linhas = st.query_map(params![lo, hi], |r| {
                Ok((r.get::<_, i64>(0)?, r.get(1)?, r.get(2)?))
            })?;
            for l in linhas {
                let (id, a, b) = l?;
                afetados.entry(id).or_default().push((a, b));
            }
        }
        let presentes_set: BTreeSet<i64> = presentes
            .map(|p| p.iter().copied().collect())
            .unwrap_or_default();
        for id in &presentes_set {
            afetados.entry(*id).or_default();
        }
        let mut apagar = tx.prepare(&format!(
            "DELETE FROM {v} WHERE sa_id = ?1 AND vig_fim >= ?2 AND vig_ini <= ?3"
        ))?;
        let mut inserir = tx.prepare(&format!(
            "INSERT INTO {v}(sa_id, vig_ini, vig_fim) VALUES(?1, ?2, ?3)"
        ))?;
        for (id, intervalos) in &afetados {
            let de = intervalos.iter().map(|x| x.0).min().unwrap_or(s).min(s);
            let ate = intervalos.iter().map(|x| x.1).max().unwrap_or(s).max(s);
            let presente = |x: i64| -> bool {
                if x == s {
                    presentes_set.contains(id)
                } else {
                    intervalos.iter().any(|&(a, b)| a <= x && x <= b)
                }
            };
            apagar.execute(params![id, lo, hi])?;
            let mut inicio: Option<i64> = None;
            let mut ultimo = 0i64;
            for &x in carregadas.iter().filter(|&&x| x >= de && x <= ate) {
                if presente(x) {
                    if inicio.is_none() {
                        inicio = Some(x);
                    }
                    ultimo = x;
                } else if let Some(i) = inicio.take() {
                    inserir.execute(params![id, i, ultimo])?;
                }
            }
            if let Some(i) = inicio {
                inserir.execute(params![id, i, ultimo])?;
            }
        }
        Ok(())
    }

    /// Remove uma competência do banco (e os conteúdos que ficarem sem vigência).
    pub fn remover(&mut self, comp: Competencia) -> Result<(), ErroBanco> {
        let tx = self.conn.transaction()?;
        let carregadas = Self::seqs_carregadas(&tx)?;
        if !carregadas.contains(&comp.seq()) {
            return Err(ErroBanco::NaoCarregada(comp));
        }
        Self::remover_em(&tx, &mut self.cache, comp.seq(), &carregadas)?;
        tx.commit()?;
        Ok(())
    }

    fn remover_em(
        tx: &Transaction<'_>,
        cache: &mut HashMap<String, HashMap<Hash, i64>>,
        s: i64,
        carregadas: &[i64],
    ) -> Result<(), ErroBanco> {
        let restantes: Vec<i64> = carregadas.iter().copied().filter(|&x| x != s).collect();
        let prev = restantes.iter().copied().filter(|&x| x < s).max();
        let next = restantes.iter().copied().filter(|&x| x > s).min();
        for nome in Self::tabelas_conhecidas(tx)? {
            let t = safe_ident(&nome).map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
            Self::recalcular(tx, &t, s, prev, next, &restantes, None)?;
            let v = tabela_vig(&t)?;
            let apagados = tx.execute(
                &format!("DELETE FROM {t} WHERE sa_id NOT IN (SELECT sa_id FROM {v})"),
                [],
            )?;
            if apagados > 0 {
                cache.remove(&nome);
            }
        }
        for sql in [
            "DELETE FROM sa_tabela WHERE seq = ?1",
            "DELETE FROM sa_leiaute WHERE seq = ?1",
            "DELETE FROM sa_ordem WHERE seq = ?1",
            "DELETE FROM sa_competencia WHERE seq = ?1",
        ] {
            tx.execute(sql, [s])?;
        }
        Ok(())
    }

    fn exigir_carregada(&self, comp: Competencia) -> Result<(), ErroBanco> {
        let existe: Option<i64> = self
            .conn
            .query_row(
                "SELECT seq FROM sa_competencia WHERE seq = ?1",
                [comp.seq()],
                |r| r.get(0),
            )
            .optional()?;
        existe.map(|_| ()).ok_or(ErroBanco::NaoCarregada(comp))
    }

    /// Tabelas presentes numa competência.
    pub fn tabelas(&self, comp: Competencia) -> Result<Vec<String>, ErroBanco> {
        self.exigir_carregada(comp)?;
        let mut st = self
            .conn
            .prepare("SELECT tabela FROM sa_tabela WHERE seq = ?1 ORDER BY tabela")?;
        let v = st
            .query_map([comp.seq()], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(v)
    }

    /// Leiaute de uma tabela numa competência.
    pub fn leiaute(&self, comp: Competencia, tabela: &str) -> Result<Option<Leiaute>, ErroBanco> {
        self.exigir_carregada(comp)?;
        let t = safe_ident(tabela).map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
        let mut st = self.conn.prepare(
            "SELECT coluna, coluna_origem, tamanho, inicio, fim, tipo FROM sa_leiaute
             WHERE seq = ?1 AND tabela = ?2 ORDER BY ordem",
        )?;
        let linhas = st
            .query_map(params![comp.seq(), t.como_str()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if linhas.is_empty() {
            return Ok(None);
        }
        let mut colunas = Vec::with_capacity(linhas.len());
        for (nome, origem, tam, ini, fim, tipo) in linhas {
            colunas.push(Coluna {
                nome: safe_ident(&nome).map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?,
                nome_origem: origem,
                tamanho: tam as usize,
                inicio: ini as usize,
                fim: fim as usize,
                tipo: Tipo::de_nome(&tipo)
                    .ok_or_else(|| ErroBanco::Inconsistencia(format!("tipo {tipo}")))?,
            });
        }
        let largura = colunas.last().map_or(0, |c| c.fim);
        Ok(Some(Leiaute {
            tabela: t,
            colunas,
            largura,
        }))
    }

    /// Reconstrói o `<tabela>_layout.txt` de uma competência.
    pub fn exportar_leiaute(
        &self,
        comp: Competencia,
        tabela: &str,
    ) -> Result<Option<Vec<u8>>, ErroBanco> {
        let Some(l) = self.leiaute(comp, tabela)? else {
            return Ok(None);
        };
        let mut out = b"Coluna,Tamanho,Inicio,Fim,Tipo\r\n".to_vec();
        for c in &l.colunas {
            let linha = format!(
                "{},{},{},{},{}\r\n",
                c.nome_origem,
                c.tamanho,
                c.inicio,
                c.fim,
                c.tipo.como_str()
            );
            out.extend(sa_sources::latin1::codificar(&linha).ok_or_else(|| {
                ErroBanco::Inconsistencia("nome de coluna fora do ISO-8859-1".into())
            })?);
        }
        Ok(Some(out))
    }

    /// Reconstrói o `<tabela>.txt` de uma competência, byte a byte como o original.
    pub fn exportar_tabela(
        &self,
        comp: Competencia,
        tabela: &str,
    ) -> Result<Option<Vec<u8>>, ErroBanco> {
        let Some(l) = self.leiaute(comp, tabela)? else {
            return Ok(None);
        };
        let s = comp.seq();
        let (registros, ordenado): (i64, bool) = self.conn.query_row(
            "SELECT registros, ordenado FROM sa_tabela WHERE seq = ?1 AND tabela = ?2",
            params![s, l.tabela.como_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let t = &l.tabela;
        let v = tabela_vig(t)?;
        let guardadas: Vec<&Coluna> = l
            .colunas
            .iter()
            .filter(|c| c.nome.como_str() != COL_DT)
            .collect();
        let lista: String = guardadas
            .iter()
            .map(|c| format!(", c.{}", c.nome))
            .collect();
        let mut st = self.conn.prepare(&format!(
            "SELECT c.sa_id, c.sa_qtd{lista} FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1"
        ))?;
        let comp_txt = Valor::Texto(comp.to_string());
        let mut por_id: HashMap<i64, (Vec<u8>, i64)> = HashMap::new();
        let mut linhas = st.query(params![s])?;
        while let Some(r) = linhas.next()? {
            let id: i64 = r.get(0)?;
            let qtd: i64 = r.get(1)?;
            let mut reg = Vec::with_capacity(l.largura);
            let mut k = 2;
            for c in &l.colunas {
                let valor = if c.nome.como_str() == COL_DT {
                    comp_txt.clone()
                } else {
                    let x: rusqlite::types::Value = r.get(k)?;
                    k += 1;
                    match x {
                        rusqlite::types::Value::Integer(n) => Valor::Inteiro(n),
                        rusqlite::types::Value::Text(s) => Valor::Texto(s),
                        outro => {
                            return Err(ErroBanco::Inconsistencia(format!(
                                "{t}.{}: valor {outro:?} na competência {comp}",
                                c.nome
                            )));
                        }
                    }
                };
                valor::escrever(c, &valor, &mut reg)
                    .map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
            }
            por_id.insert(id, (reg, qtd));
        }
        let mut saida = Vec::with_capacity((l.largura + 2) * registros as usize);
        if ordenado {
            let mut todos: Vec<&[u8]> = Vec::with_capacity(registros as usize);
            for (reg, qtd) in por_id.values() {
                for _ in 0..*qtd {
                    todos.push(reg);
                }
            }
            todos.sort_unstable();
            for r in todos {
                saida.extend_from_slice(r);
                saida.extend_from_slice(b"\r\n");
            }
        } else {
            let ids: Vec<u8> = self.conn.query_row(
                "SELECT ids FROM sa_ordem WHERE seq = ?1 AND tabela = ?2",
                params![s, t.como_str()],
                |r| r.get(0),
            )?;
            for id in decodificar_ids(&ids) {
                let (reg, _) = por_id.get(&id).ok_or_else(|| {
                    ErroBanco::Inconsistencia(format!(
                        "{t}: ordem cita conteúdo {id} fora da vigência"
                    ))
                })?;
                saida.extend_from_slice(reg);
                saida.extend_from_slice(b"\r\n");
            }
        }
        let gerados = saida.len() / (l.largura + 2);
        if gerados as i64 != registros {
            return Err(ErroBanco::Inconsistencia(format!(
                "{t} em {comp}: {gerados} registros reconstruídos, {registros} esperados"
            )));
        }
        Ok(Some(saida))
    }

    /// Resumo lógico do banco (SHA-256), independente da numeração interna e da ordem de
    /// carga: dois bancos com o mesmo conteúdo têm o mesmo resumo.
    pub fn resumo_logico(&self) -> Result<String, ErroBanco> {
        let mut h = Sha256::new();
        {
            let mut st = self.conn.prepare(
                "SELECT seq, aaaamm, arquivo, versao, sha256 FROM sa_competencia ORDER BY seq",
            )?;
            let mut r = st.query([])?;
            while let Some(x) = r.next()? {
                h.update(format!(
                    "C|{}|{}|{}|{:?}|{}\n",
                    x.get::<_, i64>(0)?,
                    x.get::<_, String>(1)?,
                    x.get::<_, String>(2)?,
                    x.get::<_, Option<String>>(3)?,
                    x.get::<_, String>(4)?
                ));
            }
        }
        for sql in [
            "SELECT seq || '|' || tabela || '|' || registros || '|' || ordenado FROM sa_tabela ORDER BY seq, tabela",
            "SELECT seq || '|' || tabela || '|' || ordem || '|' || coluna || '|' || coluna_origem || '|' || tamanho || '|' || inicio || '|' || fim || '|' || tipo FROM sa_leiaute ORDER BY seq, tabela, ordem",
        ] {
            let mut st = self.conn.prepare(sql)?;
            let mut r = st.query([])?;
            while let Some(x) = r.next()? {
                h.update(x.get::<_, String>(0)?);
                h.update(b"\n");
            }
        }
        let tabelas: Vec<String> = {
            let mut st = self
                .conn
                .prepare("SELECT DISTINCT tabela FROM sa_tabela ORDER BY tabela")?;
            st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        for nome in tabelas {
            let t = safe_ident(&nome).map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
            let v = tabela_vig(&t)?;
            let mut hash_de: HashMap<i64, Vec<u8>> = HashMap::new();
            let mut st = self.conn.prepare(&format!(
                "SELECT c.sa_id, c.sa_hash, v.vig_ini, v.vig_fim FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
                 ORDER BY c.sa_hash, v.vig_ini"
            ))?;
            let mut r = st.query([])?;
            h.update(format!("T|{nome}\n"));
            while let Some(x) = r.next()? {
                let id: i64 = x.get(0)?;
                let hs: Vec<u8> = x.get(1)?;
                h.update(&hs);
                h.update(format!(
                    "|{}|{}\n",
                    x.get::<_, i64>(2)?,
                    x.get::<_, i64>(3)?
                ));
                hash_de.insert(id, hs);
            }
            let mut st = self
                .conn
                .prepare("SELECT seq, ids FROM sa_ordem WHERE tabela = ?1 ORDER BY seq")?;
            let mut r = st.query([&nome])?;
            while let Some(x) = r.next()? {
                h.update(format!("O|{}\n", x.get::<_, i64>(0)?));
                for id in decodificar_ids(&x.get::<_, Vec<u8>>(1)?) {
                    h.update(hash_de.get(&id).map(|v| v.as_slice()).unwrap_or(b"?"));
                }
            }
        }
        Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
    }

    /// Contagens: (conteúdos distintos, intervalos) somando todas as tabelas.
    pub fn contagens(&self) -> Result<(i64, i64), ErroBanco> {
        let tabelas: Vec<String> = {
            let mut st = self.conn.prepare("SELECT DISTINCT tabela FROM sa_tabela")?;
            st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        let (mut c, mut i) = (0, 0);
        for nome in tabelas {
            let t = safe_ident(&nome).map_err(|e| ErroBanco::Inconsistencia(e.to_string()))?;
            let v = tabela_vig(&t)?;
            c += self
                .conn
                .query_row(&format!("SELECT count(*) FROM {t}"), [], |r| {
                    r.get::<_, i64>(0)
                })?;
            i += self
                .conn
                .query_row(&format!("SELECT count(*) FROM {v}"), [], |r| {
                    r.get::<_, i64>(0)
                })?;
        }
        Ok((c, i))
    }

    /// Acesso à conexão (consultas das fases seguintes e testes).
    pub fn conexao(&self) -> &Connection {
        &self.conn
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn ids_em_varint_ida_e_volta() {
        let ids = vec![1, 127, 128, 300, 16384, 1 << 40, 5, 5];
        assert_eq!(decodificar_ids(&codificar_ids(&ids)), ids);
    }

    #[test]
    fn hash_nao_depende_da_ordem_das_colunas() {
        let a = safe_ident("a").unwrap();
        let b = safe_ident("b").unwrap();
        let x = vec![
            (a.clone(), Valor::Inteiro(1)),
            (b.clone(), Valor::Texto("x".into())),
        ];
        let y = vec![(b, Valor::Texto("x".into())), (a, Valor::Inteiro(1))];
        assert_eq!(hash_conteudo(&x, 1), hash_conteudo(&y, 1));
        assert_ne!(hash_conteudo(&x, 1), hash_conteudo(&x, 2));
    }
}
