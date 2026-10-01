//! Módulo de território (`territorio.db`, obrigatório): UF, municípios (IBGE) e regiões de
//! saúde, macrorregiões e população (DEMAS), com a proveniência de cada fonte.
//!
//! As duas fontes ficam em tabelas separadas, com todos os campos, sem misturar: a junção é
//! feita na consulta pelo código de 6 dígitos (o código IBGE de 7 dígitos tem o dígito
//! verificador no fim; conferido nos dados reais: os 5.570 códigos do DEMAS existem no IBGE).
//! O que uma fonte tem e a outra não aparece no resumo, nunca é escondido.

use rusqlite::{Connection, OptionalExtension, params};
use sa_sources::territorio::{MunicipioIbge, MunicipioSaude};
use serde::Serialize;
use std::fmt;
use std::path::Path;

/// Versão do esquema de `territorio.db`. Mude ao alterar tabelas: bancos antigos são refeitos dos JSONs guardados.
pub const VERSAO_ESQUEMA: &str = "1";

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS sa_info(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_fonte(
    fonte TEXT PRIMARY KEY, url TEXT NOT NULL, obtido_em TEXT NOT NULL, sha256 TEXT NOT NULL,
    itens INTEGER NOT NULL, gravado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ibge_municipio(
    municipio_id INTEGER PRIMARY KEY, municipio_nome TEXT NOT NULL,
    microrregiao_id INTEGER, microrregiao_nome TEXT, mesorregiao_id INTEGER, mesorregiao_nome TEXT,
    regiao_imediata_id INTEGER NOT NULL, regiao_imediata_nome TEXT NOT NULL,
    regiao_intermediaria_id INTEGER NOT NULL, regiao_intermediaria_nome TEXT NOT NULL,
    uf_id INTEGER NOT NULL, uf_sigla TEXT NOT NULL, uf_nome TEXT NOT NULL,
    regiao_id INTEGER NOT NULL, regiao_sigla TEXT NOT NULL, regiao_nome TEXT NOT NULL,
    codigo6 INTEGER NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS demas_municipio(
    codigo_municipio TEXT PRIMARY KEY, municipio TEXT NOT NULL,
    codigo_regiao_pais TEXT NOT NULL, regiao_pais TEXT NOT NULL,
    codigo_uf TEXT NOT NULL, uf TEXT NOT NULL,
    codigo_macrorregiao_saude TEXT NOT NULL, macrorregiao_saude TEXT NOT NULL,
    codigo_regiao_saude TEXT NOT NULL, regiao_saude TEXT NOT NULL,
    populacao_estimada_ibge_2022 INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS demas_regiao ON demas_municipio(codigo_regiao_saude);
CREATE VIEW IF NOT EXISTS municipio AS
    SELECT i.*, d.codigo_municipio AS saude_codigo, d.codigo_regiao_saude, d.regiao_saude,
           d.codigo_macrorregiao_saude, d.macrorregiao_saude, d.populacao_estimada_ibge_2022
    FROM ibge_municipio i LEFT JOIN demas_municipio d ON CAST(d.codigo_municipio AS INTEGER) = i.codigo6;
";

/// Erro do banco de território.
#[derive(Debug)]
pub enum ErroTerritorio {
    Sql(rusqlite::Error),
    Inconsistencia(String),
}

impl fmt::Display for ErroTerritorio {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroTerritorio::Sql(e) => write!(
                f,
                "falha no banco de território ({e}). Apague dados\\territorio.db e atualize o território em Módulos e dados"
            ),
            ErroTerritorio::Inconsistencia(m) => write!(f, "território: {m}"),
        }
    }
}

impl std::error::Error for ErroTerritorio {}

impl From<rusqlite::Error> for ErroTerritorio {
    fn from(e: rusqlite::Error) -> Self {
        ErroTerritorio::Sql(e)
    }
}

/// De onde veio cada fonte.
#[derive(Debug, Clone, Serialize)]
pub struct Origem {
    pub url: String,
    /// Data e hora em que a fonte foi obtida (texto ISO, do relógio do computador).
    pub obtido_em: String,
    pub sha256: String,
}

/// Proveniência de uma fonte gravada.
#[derive(Debug, Clone, Serialize)]
pub struct FonteGravada {
    /// `ibge` ou `demas`.
    pub fonte: String,
    pub origem: Origem,
    pub itens: i64,
}

/// Resumo do território gravado.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResumoTerritorio {
    pub municipios_ibge: i64,
    pub municipios_saude: i64,
    pub ufs: i64,
    pub regioes_saude: i64,
    pub macrorregioes_saude: i64,
    /// Municípios do IBGE sem região de saúde na fonte do DEMAS (código de 7 dígitos).
    pub sem_regiao_saude: Vec<i64>,
    /// Códigos do DEMAS que não existem no IBGE.
    pub sem_ibge: Vec<String>,
    /// Municípios em que a UF das duas fontes não bate (código de 7 dígitos).
    pub uf_divergente: Vec<i64>,
}

/// Banco do módulo de território.
pub struct BancoTerritorio {
    conn: Connection,
}

impl BancoTerritorio {
    /// Abre (ou cria) o banco.
    pub fn abrir(caminho: &Path) -> Result<Self, ErroTerritorio> {
        Self::preparar(Connection::open(caminho)?)
    }

    /// Banco em memória (testes).
    pub fn em_memoria() -> Result<Self, ErroTerritorio> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(conn: Connection) -> Result<Self, ErroTerritorio> {
        // Confere a versão antes de criar tabelas: banco de outra versão do programa não é alterado.
        let tem_info: bool = conn.query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type='table' AND name='sa_info'",
            [],
            |r| r.get(0),
        )?;
        let v: Option<String> = if tem_info {
            conn.query_row(
                "SELECT valor FROM sa_info WHERE chave = 'versao_esquema'",
                [],
                |r| r.get(0),
            )
            .optional()?
        } else {
            None
        };
        if let Some(x) = v.as_deref()
            && x != VERSAO_ESQUEMA
        {
            return Err(ErroTerritorio::Inconsistencia(format!(
                "esquema versão {x}, este programa usa a {VERSAO_ESQUEMA}"
            )));
        }
        conn.execute_batch(ESQUEMA)?;
        if v.is_none() {
            conn.execute(
                "INSERT INTO sa_info VALUES('versao_esquema', ?1)",
                [VERSAO_ESQUEMA],
            )?;
        }
        Ok(Self { conn })
    }

    /// Substitui todo o território pelas fontes dadas (numa transação: ou grava tudo, ou nada).
    pub fn gravar(
        &mut self,
        ibge: &[MunicipioIbge],
        demas: &[MunicipioSaude],
        origem_ibge: &Origem,
        origem_demas: &Origem,
    ) -> Result<ResumoTerritorio, ErroTerritorio> {
        let tx = self.conn.transaction()?;
        tx.execute_batch(
            "DELETE FROM ibge_municipio; DELETE FROM demas_municipio; DELETE FROM sa_fonte;",
        )?;
        {
            let mut st = tx.prepare(
                "INSERT INTO ibge_municipio VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )?;
            for m in ibge {
                st.execute(params![
                    m.municipio_id,
                    m.municipio_nome,
                    m.microrregiao_id,
                    m.microrregiao_nome,
                    m.mesorregiao_id,
                    m.mesorregiao_nome,
                    m.regiao_imediata_id,
                    m.regiao_imediata_nome,
                    m.regiao_intermediaria_id,
                    m.regiao_intermediaria_nome,
                    m.uf_id,
                    m.uf_sigla,
                    m.uf_nome,
                    m.regiao_id,
                    m.regiao_sigla,
                    m.regiao_nome,
                    m.municipio_id / 10
                ])?;
            }
            let mut st = tx.prepare(
                "INSERT INTO demas_municipio VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            for m in demas {
                st.execute(params![
                    m.codigo_municipio,
                    m.municipio,
                    m.codigo_regiao_pais,
                    m.regiao_pais,
                    m.codigo_uf,
                    m.uf,
                    m.codigo_macrorregiao_saude,
                    m.macrorregiao_saude,
                    m.codigo_regiao_saude,
                    m.regiao_saude,
                    m.populacao_estimada_ibge_2022
                ])?;
            }
            let mut st =
                tx.prepare("INSERT INTO sa_fonte VALUES(?1, ?2, ?3, ?4, ?5, datetime('now'))")?;
            st.execute(params![
                "ibge",
                origem_ibge.url,
                origem_ibge.obtido_em,
                origem_ibge.sha256,
                ibge.len() as i64
            ])?;
            st.execute(params![
                "demas",
                origem_demas.url,
                origem_demas.obtido_em,
                origem_demas.sha256,
                demas.len() as i64
            ])?;
        }
        tx.commit()?;
        self.resumo()
    }

    /// Contagens e diferenças entre as fontes.
    pub fn resumo(&self) -> Result<ResumoTerritorio, ErroTerritorio> {
        let n = |sql: &str| -> Result<i64, ErroTerritorio> {
            Ok(self.conn.query_row(sql, [], |r| r.get(0))?)
        };
        let lista_i = |sql: &str| -> Result<Vec<i64>, ErroTerritorio> {
            let mut st = self.conn.prepare(sql)?;
            let v = st
                .query_map([], |r| r.get(0))?
                .collect::<Result<Vec<i64>, _>>()?;
            Ok(v)
        };
        let mut st = self.conn.prepare(
            "SELECT codigo_municipio FROM demas_municipio d WHERE NOT EXISTS
             (SELECT 1 FROM ibge_municipio i WHERE i.codigo6 = CAST(d.codigo_municipio AS INTEGER)) ORDER BY 1",
        )?;
        let sem_ibge = st
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ResumoTerritorio {
            municipios_ibge: n("SELECT count(*) FROM ibge_municipio")?,
            municipios_saude: n("SELECT count(*) FROM demas_municipio")?,
            ufs: n("SELECT count(DISTINCT uf_id) FROM ibge_municipio")?,
            regioes_saude: n("SELECT count(DISTINCT codigo_regiao_saude) FROM demas_municipio")?,
            macrorregioes_saude: n(
                "SELECT count(DISTINCT codigo_macrorregiao_saude) FROM demas_municipio",
            )?,
            sem_regiao_saude: lista_i(
                "SELECT municipio_id FROM municipio WHERE saude_codigo IS NULL ORDER BY 1",
            )?,
            sem_ibge,
            uf_divergente: lista_i(
                "SELECT i.municipio_id FROM ibge_municipio i JOIN demas_municipio d
                 ON CAST(d.codigo_municipio AS INTEGER) = i.codigo6 WHERE CAST(d.codigo_uf AS INTEGER) <> i.uf_id ORDER BY 1",
            )?,
        })
    }

    /// Proveniência gravada de cada fonte.
    pub fn fontes(&self) -> Result<Vec<FonteGravada>, ErroTerritorio> {
        let mut st = self
            .conn
            .prepare("SELECT fonte, url, obtido_em, sha256, itens FROM sa_fonte ORDER BY fonte")?;
        let v = st
            .query_map([], |r| {
                Ok(FonteGravada {
                    fonte: r.get(0)?,
                    origem: Origem {
                        url: r.get(1)?,
                        obtido_em: r.get(2)?,
                        sha256: r.get(3)?,
                    },
                    itens: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// Acesso à conexão (consultas e testes).
    pub fn conexao(&self) -> &Connection {
        &self.conn
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn ibge(id: i64, uf: i64) -> MunicipioIbge {
        MunicipioIbge {
            municipio_id: id,
            municipio_nome: format!("M{id}"),
            microrregiao_id: None,
            microrregiao_nome: None,
            mesorregiao_id: Some(1),
            mesorregiao_nome: Some("x".into()),
            regiao_imediata_id: 1,
            regiao_imediata_nome: "x".into(),
            regiao_intermediaria_id: 1,
            regiao_intermediaria_nome: "x".into(),
            uf_id: uf,
            uf_sigla: "XX".into(),
            uf_nome: "X".into(),
            regiao_id: 5,
            regiao_sigla: "CO".into(),
            regiao_nome: "Centro-Oeste".into(),
        }
    }

    fn demas(cod: &str, uf: &str, reg: &str) -> MunicipioSaude {
        MunicipioSaude {
            codigo_regiao_pais: "5".into(),
            regiao_pais: "Centro-Oeste".into(),
            codigo_uf: uf.into(),
            uf: "X".into(),
            codigo_macrorregiao_saude: "9901".into(),
            macrorregiao_saude: "MACRO".into(),
            codigo_regiao_saude: reg.into(),
            regiao_saude: "REG".into(),
            codigo_municipio: cod.into(),
            municipio: "X - M".into(),
            populacao_estimada_ibge_2022: 10,
        }
    }

    #[test]
    fn grava_e_aponta_diferencas_entre_fontes() {
        let mut b = BancoTerritorio::em_memoria().unwrap();
        let o = Origem {
            url: "u".into(),
            obtido_em: "2026-09-30T00:00:00".into(),
            sha256: "0".into(),
        };
        let r = b
            .gravar(
                &[ibge(1111111, 11), ibge(2222222, 22), ibge(3333333, 33)],
                &[
                    demas("111111", "11", "1"),
                    demas("222222", "99", "2"),
                    demas("444444", "44", "2"),
                ],
                &o,
                &o,
            )
            .unwrap();
        assert_eq!(r.municipios_ibge, 3);
        assert_eq!(r.municipios_saude, 3);
        assert_eq!(r.regioes_saude, 2);
        assert_eq!(r.sem_regiao_saude, [3333333]);
        assert_eq!(r.sem_ibge, ["444444"]);
        assert_eq!(r.uf_divergente, [2222222]);
        // Regravar substitui tudo.
        let r = b
            .gravar(&[ibge(1111111, 11)], &[demas("111111", "11", "1")], &o, &o)
            .unwrap();
        assert_eq!((r.municipios_ibge, r.municipios_saude), (1, 1));
        assert_eq!(b.fontes().unwrap().len(), 2);
    }
}
