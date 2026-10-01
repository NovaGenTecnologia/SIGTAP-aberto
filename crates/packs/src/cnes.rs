//! Módulo CNES (opcional, por UF): `dados\cnes\<UF>.db`, um SQLite por UF, aberto com `ATTACH`
//! ao lado do banco do SIGTAP para os cruzamentos.
//!
//! Cada tipo de arquivo de disseminação (ST, HB, SR, LT, EQ, PF) vira uma tabela `cnes_<tipo>`
//! com **todos** os campos do arquivo, na ordem e com os nomes do próprio `.dbc` (esquema lido do
//! arquivo; o leiaute mudou em 2016 e depois de 2020). O banco guarda uma competência por tipo:
//! carregar outra substitui a anterior, numa transação.
//!
//! Privacidade por construção ([`sa_sources::cnes::Manifesto`]): CPF de titular pessoa física e
//! identificadores de profissional nunca são gravados; profissionais (PF) só entram para os CNES
//! que o usuário escolheu. O que foi descartado fica contado em `sa_privacidade`.

use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use sa_core::ident::{Ident, safe_ident};
use sa_sources::cnes::Manifesto;
use sa_sources::dbf::Dbf;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::path::Path;

/// Versão do esquema de `cnes\<UF>.db`. Mude ao alterar tabelas: o banco antigo é refeito dos
/// arquivos guardados.
pub const VERSAO_ESQUEMA: &str = "1";

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS sa_info(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_arquivo(
    tipo TEXT PRIMARY KEY, uf TEXT NOT NULL, competencia TEXT NOT NULL, arquivo TEXT NOT NULL,
    sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, registros_lidos INTEGER NOT NULL,
    registros_gravados INTEGER NOT NULL, cabecalho_padrao INTEGER NOT NULL, carregado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_campo(
    tipo TEXT NOT NULL, ordem INTEGER NOT NULL, nome TEXT NOT NULL, tipo_dbf TEXT NOT NULL,
    tamanho INTEGER NOT NULL, decimais INTEGER NOT NULL, gravado INTEGER NOT NULL,
    PRIMARY KEY(tipo, ordem));
CREATE TABLE IF NOT EXISTS sa_privacidade(
    tipo TEXT NOT NULL, campo TEXT NOT NULL, regra TEXT NOT NULL, motivo TEXT NOT NULL,
    registros INTEGER NOT NULL, PRIMARY KEY(tipo, campo));
CREATE TABLE IF NOT EXISTS cnes_decod(
    campo TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT NOT NULL, arquivo TEXT NOT NULL,
    PRIMARY KEY(campo, codigo));
";

/// Erro do módulo CNES.
#[derive(Debug)]
pub enum ErroCnes {
    Sql(rusqlite::Error),
    /// O arquivo não é o que deveria (falta campo-chave, competência misturada...).
    Arquivo(String),
    Inconsistencia(String),
}

impl fmt::Display for ErroCnes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroCnes::Sql(e) => write!(
                f,
                "falha no banco do CNES ({e}). Use Verificar o banco em Módulos e dados; se continuar, apague a pasta dados\\cnes e baixe o CNES de novo"
            ),
            ErroCnes::Arquivo(m) => write!(
                f,
                "arquivo do CNES recusado: {m}. Baixe de novo da fonte oficial (FTP do DATASUS)"
            ),
            ErroCnes::Inconsistencia(m) => write!(f, "CNES: {m}"),
        }
    }
}

impl std::error::Error for ErroCnes {}

impl From<rusqlite::Error> for ErroCnes {
    fn from(e: rusqlite::Error) -> Self {
        ErroCnes::Sql(e)
    }
}

/// O que entra na carga. `None` = sem filtro.
#[derive(Debug, Default, Clone, Copy)]
pub struct Filtro<'a> {
    /// Códigos de município (6 dígitos, como em `CODUFMUN`).
    pub municipios: Option<&'a HashSet<String>>,
    /// Códigos CNES (7 dígitos). Obrigatório para os tipos marcados `so_cnes_escolhidos`.
    pub cnes: Option<&'a HashSet<String>>,
}

/// De onde veio o arquivo carregado.
#[derive(Debug, Clone, Copy)]
pub struct Origem<'a> {
    pub uf: &'a str,
    pub arquivo: &'a str,
    pub sha256: &'a str,
    pub bytes: u64,
}

/// Resultado de uma carga.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Carga {
    pub tipo: String,
    pub competencia: String,
    pub lidos: usize,
    pub gravados: usize,
    /// Campo -> em quantos registros o valor foi apagado (ou "todos", para campo não gravado).
    pub privacidade: BTreeMap<String, usize>,
}

/// Um arquivo carregado, como `sa_arquivo` o registra.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ArquivoCarregado {
    pub tipo: String,
    pub uf: String,
    pub competencia: String,
    pub arquivo: String,
    pub sha256: String,
    pub bytes: u64,
    pub registros_lidos: u64,
    pub registros_gravados: u64,
    pub cabecalho_padrao: bool,
    pub carregado_em: String,
}

/// Banco do CNES de uma UF.
pub struct BancoCnes {
    conn: Connection,
}

/// Nome da tabela de um tipo (`cnes_st`...). O tipo já foi validado pelo manifesto.
pub fn tabela(tipo: &str) -> Result<Ident, ErroCnes> {
    safe_ident(&format!("cnes_{}", tipo.to_ascii_lowercase()))
        .map_err(|e| ErroCnes::Arquivo(e.to_string()))
}

impl BancoCnes {
    /// Abre (ou cria) o banco.
    pub fn abrir(caminho: &Path) -> Result<Self, ErroCnes> {
        Self::preparar(Connection::open(caminho)?)
    }

    /// Banco em memória (testes).
    pub fn em_memoria() -> Result<Self, ErroCnes> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(conn: Connection) -> Result<Self, ErroCnes> {
        conn.execute_batch("PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000;")?;
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
            return Err(ErroCnes::Inconsistencia(format!(
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

    /// A conexão, para consultas e `ATTACH`.
    pub fn conexao(&self) -> &Connection {
        &self.conn
    }

    /// Carrega um arquivo de disseminação (já descomprimido para DBF), substituindo o anterior
    /// do mesmo tipo. Tudo ou nada.
    pub fn carregar(
        &mut self,
        manifesto: &Manifesto,
        tipo: &str,
        origem: &Origem<'_>,
        dbf: &[u8],
        filtro: &Filtro<'_>,
    ) -> Result<Carga, ErroCnes> {
        let t = manifesto
            .tipo(tipo)
            .ok_or_else(|| ErroCnes::Arquivo(format!("tipo \"{tipo}\" não está no manifesto")))?;
        if t.so_cnes_escolhidos && filtro.cnes.is_none() {
            return Err(ErroCnes::Inconsistencia(format!(
                "{} só pode ser carregado para os estabelecimentos escolhidos (escolha a sua unidade antes)",
                t.nome
            )));
        }
        let d =
            Dbf::abrir(dbf).map_err(|e| ErroCnes::Arquivo(format!("{}: {e}", origem.arquivo)))?;
        let cab = &d.cabecalho;
        for c in &t.chave {
            if cab.indice(c).is_none() {
                return Err(ErroCnes::Arquivo(format!(
                    "{}: falta o campo {c}, que {} sempre tem",
                    origem.arquivo, t.nome
                )));
            }
        }
        let regras = manifesto.privacidade_de(&t.codigo);
        // Campos nunca gravados, e campos apagados conforme outro campo.
        let nunca: HashSet<String> = regras
            .iter()
            .filter(|r| r.sempre)
            .flat_map(|r| r.campos.iter().map(|c| c.to_ascii_uppercase()))
            .collect();
        struct Condicional {
            alvo: usize,
            quando: usize,
            valor: String,
            campo: String,
        }
        let mut condicionais = Vec::new();
        for r in regras.iter().filter(|r| !r.sempre) {
            let (Some(qc), Some(qv)) = (&r.quando_campo, &r.quando_valor) else {
                continue;
            };
            let Some(quando) = cab.indice(qc) else {
                continue;
            };
            for c in &r.campos {
                if let Some(alvo) = cab.indice(c) {
                    condicionais.push(Condicional {
                        alvo,
                        quando,
                        valor: qv.clone(),
                        campo: c.to_ascii_uppercase(),
                    });
                }
            }
        }
        let gravados: Vec<usize> = (0..cab.campos.len())
            .filter(|&i| !nunca.contains(&cab.campos[i].nome.to_ascii_uppercase()))
            .collect();
        let colunas: Vec<Ident> = gravados
            .iter()
            .map(|&i| safe_ident(&cab.campos[i].nome).map_err(|e| ErroCnes::Arquivo(e.to_string())))
            .collect::<Result<_, _>>()?;
        let tab = tabela(&t.codigo)?;
        let i_cnes = cab.indice("CNES").unwrap_or(0);
        let i_mun = cab.indice("CODUFMUN");
        let i_comp = cab.indice("COMPETEN");

        let tx = self.conn.transaction()?;
        tx.execute_batch(&format!("DROP TABLE IF EXISTS {tab}"))?;
        let defs: Vec<String> = gravados
            .iter()
            .zip(&colunas)
            .map(|(&i, col)| {
                let sql = if cab.campos[i].tipo == 'N' && cab.campos[i].decimais == 0 {
                    "INTEGER"
                } else {
                    "TEXT"
                };
                format!("{col} {sql}")
            })
            .collect();
        tx.execute_batch(&format!("CREATE TABLE {tab}({})", defs.join(", ")))?;
        let marcas = vec!["?"; colunas.len()].join(", ");
        let (mut lidos, mut n_gravados) = (0usize, 0usize);
        let mut competencias: BTreeMap<String, usize> = BTreeMap::new();
        let mut privacidade: BTreeMap<String, usize> = BTreeMap::new();
        {
            let mut ins = tx.prepare(&format!("INSERT INTO {tab} VALUES({marcas})"))?;
            for r in d.registros() {
                lidos += 1;
                if let Some(cn) = filtro.cnes
                    && !cn.contains(&r.texto(i_cnes))
                {
                    continue;
                }
                if let (Some(ms), Some(i)) = (filtro.municipios, i_mun)
                    && !ms.contains(&r.texto(i))
                {
                    continue;
                }
                if let Some(i) = i_comp {
                    *competencias.entry(r.texto(i)).or_default() += 1;
                }
                let apagar: Vec<&Condicional> = condicionais
                    .iter()
                    .filter(|c| r.texto(c.quando) == c.valor)
                    .collect();
                let valores: Vec<Value> = gravados
                    .iter()
                    .map(|&i| {
                        let mut texto = r.texto(i);
                        if let Some(c) = apagar.iter().find(|c| c.alvo == i) {
                            if !texto.is_empty() {
                                *privacidade.entry(c.campo.clone()).or_default() += 1;
                            }
                            texto.clear();
                        }
                        let campo = &cab.campos[i];
                        if campo.tipo == 'N' && campo.decimais == 0 {
                            match texto.parse::<i64>() {
                                Ok(n) => Value::Integer(n),
                                Err(_) if texto.is_empty() => Value::Null,
                                Err(_) => Value::Text(texto),
                            }
                        } else {
                            Value::Text(texto)
                        }
                    })
                    .collect();
                ins.execute(params_from_iter(valores))?;
                n_gravados += 1;
            }
        }
        if competencias.len() > 1 {
            return Err(ErroCnes::Arquivo(format!(
                "{} traz mais de uma competência ({})",
                origem.arquivo,
                competencias.keys().cloned().collect::<Vec<_>>().join(", ")
            )));
        }
        let competencia = competencias.keys().next().cloned().unwrap_or_default();
        for (n, campos) in t.indices.iter().enumerate() {
            let cols: Vec<String> = campos
                .iter()
                .filter(|c| cab.indice(c).is_some())
                .filter_map(|c| safe_ident(c).ok())
                .map(|c| c.to_string())
                .collect();
            if cols.len() == campos.len() {
                let nome = safe_ident(&format!("{}_i{n}", tab.como_str()))
                    .map_err(|e| ErroCnes::Arquivo(e.to_string()))?;
                tx.execute_batch(&format!(
                    "CREATE INDEX {nome} ON {tab}({})",
                    cols.join(", ")
                ))?;
            }
        }
        tx.execute("DELETE FROM sa_campo WHERE tipo = ?1", [&t.codigo])?;
        tx.execute("DELETE FROM sa_privacidade WHERE tipo = ?1", [&t.codigo])?;
        for (ordem, c) in cab.campos.iter().enumerate() {
            tx.execute(
                "INSERT INTO sa_campo VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    t.codigo,
                    i64::try_from(ordem).unwrap_or(0),
                    c.nome,
                    c.tipo.to_string(),
                    i64::try_from(c.tamanho).unwrap_or(0),
                    i64::from(c.decimais),
                    !nunca.contains(&c.nome.to_ascii_uppercase())
                ],
            )?;
        }
        for r in &regras {
            for campo in &r.campos {
                if cab.indice(campo).is_none() {
                    continue;
                }
                let chave = campo.to_ascii_uppercase();
                let (regra, n) = if r.sempre {
                    privacidade.insert(chave.clone(), n_gravados);
                    ("campo não gravado".to_string(), n_gravados)
                } else {
                    (
                        format!(
                            "apagado quando {} = {}",
                            r.quando_campo.as_deref().unwrap_or(""),
                            r.quando_valor.as_deref().unwrap_or("")
                        ),
                        privacidade.get(&chave).copied().unwrap_or(0),
                    )
                };
                tx.execute(
                    "INSERT OR REPLACE INTO sa_privacidade VALUES(?1, ?2, ?3, ?4, ?5)",
                    params![
                        t.codigo,
                        chave,
                        regra,
                        r.motivo,
                        i64::try_from(n).unwrap_or(0)
                    ],
                )?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO sa_arquivo VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))",
            params![
                t.codigo,
                origem.uf,
                competencia,
                origem.arquivo,
                origem.sha256,
                i64::try_from(origem.bytes).unwrap_or(0),
                i64::try_from(lidos).unwrap_or(0),
                i64::try_from(n_gravados).unwrap_or(0),
                cab.terminador_padrao
            ],
        )?;
        tx.commit()?;
        Ok(Carga {
            tipo: t.codigo.clone(),
            competencia,
            lidos,
            gravados: n_gravados,
            privacidade,
        })
    }

    /// Carrega o cadastro de nomes (`CADGER<UF>.dbf`, de TAB_CNES.zip) só para os CNES que já
    /// estão em `cnes_st`. Precisa do ST carregado antes: é ele que diz quem é pessoa física.
    pub fn carregar_cadastro(
        &mut self,
        manifesto: &Manifesto,
        origem: &Origem<'_>,
        dbf: &[u8],
    ) -> Result<Carga, ErroCnes> {
        let d =
            Dbf::abrir(dbf).map_err(|e| ErroCnes::Arquivo(format!("{}: {e}", origem.arquivo)))?;
        let cab = &d.cabecalho;
        let i_cnes = cab
            .indice("CNES")
            .ok_or_else(|| ErroCnes::Arquivo(format!("{}: falta o campo CNES", origem.arquivo)))?;
        if cab.indice("FANTASIA").is_none() {
            return Err(ErroCnes::Arquivo(format!(
                "{}: falta o campo FANTASIA",
                origem.arquivo
            )));
        }
        if !self.tem_tabela("cnes_st")? {
            return Err(ErroCnes::Inconsistencia(
                "carregue os estabelecimentos (ST) antes do cadastro de nomes".into(),
            ));
        }
        // CNES em uso e, deles, os de pessoa física (valor do manifesto, campo PF_PJ do ST).
        let regras = manifesto.privacidade_de("CAD");
        let mut em_uso: HashSet<String> = HashSet::new();
        let mut pessoa_fisica: HashSet<String> = HashSet::new();
        {
            let valor_pf = regras
                .iter()
                .find_map(|r| r.quando_valor.clone())
                .unwrap_or_default();
            let mut st = self.conn.prepare("SELECT cnes, pf_pj FROM cnes_st")?;
            let linhas =
                st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for l in linhas {
                let (c, p) = l?;
                if p == valor_pf {
                    pessoa_fisica.insert(c.clone());
                }
                em_uso.insert(c);
            }
        }
        let apagaveis: HashSet<usize> = regras
            .iter()
            .flat_map(|r| r.campos.iter())
            .filter_map(|c| cab.indice(c))
            .collect();
        let colunas: Vec<Ident> = cab
            .campos
            .iter()
            .map(|c| safe_ident(&c.nome).map_err(|e| ErroCnes::Arquivo(e.to_string())))
            .collect::<Result<_, _>>()?;
        let tx = self.conn.transaction()?;
        tx.execute_batch("DROP TABLE IF EXISTS cnes_cad")?;
        let defs: Vec<String> = colunas.iter().map(|c| format!("{c} TEXT")).collect();
        tx.execute_batch(&format!("CREATE TABLE cnes_cad({})", defs.join(", ")))?;
        let marcas = vec!["?"; colunas.len()].join(", ");
        let (mut lidos, mut gravados) = (0usize, 0usize);
        let mut privacidade: BTreeMap<String, usize> = BTreeMap::new();
        {
            let mut ins = tx.prepare(&format!("INSERT INTO cnes_cad VALUES({marcas})"))?;
            for r in d.registros() {
                lidos += 1;
                let cnes = r.texto(i_cnes);
                if !em_uso.contains(&cnes) {
                    continue;
                }
                let pf = pessoa_fisica.contains(&cnes);
                let valores: Vec<String> = (0..cab.campos.len())
                    .map(|i| {
                        let t = r.texto(i);
                        if pf && apagaveis.contains(&i) {
                            if !t.is_empty() {
                                *privacidade
                                    .entry(cab.campos[i].nome.to_ascii_uppercase())
                                    .or_default() += 1;
                            }
                            String::new()
                        } else {
                            t
                        }
                    })
                    .collect();
                ins.execute(params_from_iter(valores))?;
                gravados += 1;
            }
        }
        tx.execute_batch("CREATE UNIQUE INDEX cnes_cad_i0 ON cnes_cad(cnes)")?;
        tx.execute("DELETE FROM sa_privacidade WHERE tipo = 'CAD'", [])?;
        for r in &regras {
            for campo in r.campos.iter().filter(|c| cab.indice(c).is_some()) {
                let chave = campo.to_ascii_uppercase();
                tx.execute(
                    "INSERT OR REPLACE INTO sa_privacidade VALUES('CAD', ?1, ?2, ?3, ?4)",
                    params![
                        chave,
                        "apagado quando o estabelecimento é pessoa física",
                        r.motivo,
                        i64::try_from(privacidade.get(&chave).copied().unwrap_or(0)).unwrap_or(0)
                    ],
                )?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO sa_arquivo VALUES('CAD', ?1, '', ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            params![
                origem.uf,
                origem.arquivo,
                origem.sha256,
                i64::try_from(origem.bytes).unwrap_or(0),
                i64::try_from(lidos).unwrap_or(0),
                i64::try_from(gravados).unwrap_or(0),
                cab.terminador_padrao
            ],
        )?;
        tx.commit()?;
        Ok(Carga {
            tipo: "CAD".into(),
            competencia: String::new(),
            lidos,
            gravados,
            privacidade,
        })
    }

    /// Grava uma tabela de decodificação (código -> descrição) para um campo.
    pub fn gravar_decodificador(
        &mut self,
        campo: &str,
        arquivo: &str,
        mapa: &BTreeMap<String, String>,
    ) -> Result<usize, ErroCnes> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM cnes_decod WHERE campo = ?1", [campo])?;
        {
            let mut ins = tx.prepare("INSERT INTO cnes_decod VALUES(?1, ?2, ?3, ?4)")?;
            for (codigo, descricao) in mapa {
                ins.execute(params![campo, codigo, descricao, arquivo])?;
            }
        }
        tx.commit()?;
        Ok(mapa.len())
    }

    /// Os arquivos carregados, por tipo.
    pub fn arquivos(&self) -> Result<Vec<ArquivoCarregado>, ErroCnes> {
        let mut st = self.conn.prepare(
            "SELECT tipo, uf, competencia, arquivo, sha256, bytes, registros_lidos, registros_gravados,
                    cabecalho_padrao, carregado_em FROM sa_arquivo ORDER BY tipo",
        )?;
        let v = st
            .query_map([], |r| {
                Ok(ArquivoCarregado {
                    tipo: r.get(0)?,
                    uf: r.get(1)?,
                    competencia: r.get(2)?,
                    arquivo: r.get(3)?,
                    sha256: r.get(4)?,
                    bytes: r.get::<_, i64>(5)?.unsigned_abs(),
                    registros_lidos: r.get::<_, i64>(6)?.unsigned_abs(),
                    registros_gravados: r.get::<_, i64>(7)?.unsigned_abs(),
                    cabecalho_padrao: r.get(8)?,
                    carregado_em: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// Existe a tabela? (Um tipo ainda não carregado não tem tabela.)
    pub fn tem_tabela(&self, nome: &str) -> Result<bool, ErroCnes> {
        Ok(self.conn.query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [nome],
            |r| r.get(0),
        )?)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    /// DBF sintético mínimo (mesmo formato do leitor de `sa-sources`).
    fn dbf(campos: &[(&str, char, u8)], linhas: &[&[&str]]) -> Vec<u8> {
        let tam_reg: usize = 1 + campos.iter().map(|c| usize::from(c.2)).sum::<usize>();
        let tam_cab = 32 + 32 * campos.len() + 1;
        let mut b = vec![0u8; 32];
        b[0] = 3;
        b[4..8].copy_from_slice(&u32::try_from(linhas.len()).unwrap().to_le_bytes());
        b[8..10].copy_from_slice(&u16::try_from(tam_cab).unwrap().to_le_bytes());
        b[10..12].copy_from_slice(&u16::try_from(tam_reg).unwrap().to_le_bytes());
        for (nome, tipo, tam) in campos {
            let mut d = [0u8; 32];
            d[..nome.len()].copy_from_slice(nome.as_bytes());
            d[11] = *tipo as u8;
            d[16] = *tam;
            b.extend_from_slice(&d);
        }
        b.push(0x0D);
        for linha in linhas {
            b.push(b' ');
            for (valor, (_, _, tam)) in linha.iter().zip(campos) {
                let mut c = vec![b' '; usize::from(*tam)];
                c[..valor.len()].copy_from_slice(valor.as_bytes());
                b.extend_from_slice(&c);
            }
        }
        b.push(0x1A);
        b
    }

    fn origem(arquivo: &str) -> Origem<'_> {
        Origem {
            uf: "MS",
            arquivo,
            sha256: "0",
            bytes: 1,
        }
    }

    const ST: &[(&str, char, u8)] = &[
        ("CNES", 'C', 7),
        ("CODUFMUN", 'C', 6),
        ("CPF_CNPJ", 'C', 14),
        ("PF_PJ", 'C', 1),
        ("C_CORREN", 'C', 6),
        ("QTLEITP1", 'N', 4),
        ("COMPETEN", 'C', 6),
    ];

    #[test]
    fn carrega_todos_os_campos_e_apaga_cpf_e_conta_de_pessoa_fisica() {
        let m = Manifesto::carregar();
        let mut b = BancoCnes::em_memoria().unwrap();
        let st = dbf(
            ST,
            &[
                &[
                    "0000001",
                    "500270",
                    "00000000000191",
                    "3",
                    "12345",
                    "  12",
                    "202608",
                ],
                &[
                    "0000002",
                    "500270",
                    "00011122233344",
                    "1",
                    "99999",
                    "",
                    "202608",
                ],
                &[
                    "0000003",
                    "500630",
                    "00055566677788",
                    "1",
                    "",
                    "   0",
                    "202608",
                ],
            ],
        );
        let c = b
            .carregar(&m, "ST", &origem("STMS2608.dbc"), &st, &Filtro::default())
            .unwrap();
        assert_eq!(
            (c.lidos, c.gravados, c.competencia.as_str()),
            (3, 3, "202608")
        );
        assert_eq!(c.privacidade.get("CPF_CNPJ"), Some(&2));
        assert_eq!(c.privacidade.get("C_CORREN"), Some(&1));
        let con = b.conexao();
        // Pessoa jurídica fica como veio; pessoa física sem CPF e sem conta.
        let pj: (String, String, i64) = con
            .query_row(
                "SELECT cpf_cnpj, c_corren, qtleitp1 FROM cnes_st WHERE cnes='0000001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(pj, ("00000000000191".into(), "12345".into(), 12));
        let n: i64 = con
            .query_row(
                "SELECT count(*) FROM cnes_st WHERE pf_pj = '1' AND (cpf_cnpj <> '' OR c_corren <> '')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
        // Número vazio vira nulo, não zero.
        let nulo: Option<i64> = con
            .query_row(
                "SELECT qtleitp1 FROM cnes_st WHERE cnes='0000002'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(nulo, None);
        let a = b.arquivos().unwrap();
        assert_eq!((a[0].tipo.as_str(), a[0].registros_gravados), ("ST", 3));
        // Recarregar substitui (não soma).
        b.carregar(&m, "ST", &origem("STMS2608.dbc"), &st, &Filtro::default())
            .unwrap();
        let total: i64 = b
            .conexao()
            .query_row("SELECT count(*) FROM cnes_st", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 3);
    }

    #[test]
    fn filtro_de_municipio_e_recusas() {
        let m = Manifesto::carregar();
        let mut b = BancoCnes::em_memoria().unwrap();
        let st = dbf(
            ST,
            &[
                &["0000001", "500270", "", "3", "", "", "202608"],
                &["0000003", "500630", "", "3", "", "", "202608"],
            ],
        );
        let ms: HashSet<String> = ["500630".to_string()].into();
        let f = Filtro {
            municipios: Some(&ms),
            cnes: None,
        };
        let c = b.carregar(&m, "ST", &origem("ST.dbc"), &st, &f).unwrap();
        assert_eq!((c.lidos, c.gravados), (2, 1));
        // Falta campo-chave.
        let ruim = dbf(&[("CNES", 'C', 7)], &[&["0000001"]]);
        assert!(matches!(
            b.carregar(&m, "ST", &origem("x.dbc"), &ruim, &Filtro::default()),
            Err(ErroCnes::Arquivo(_))
        ));
        // Duas competências no mesmo arquivo: recusa e mantém o que havia.
        let misto = dbf(
            ST,
            &[
                &["0000001", "500270", "", "3", "", "", "202608"],
                &["0000002", "500270", "", "3", "", "", "202607"],
            ],
        );
        assert!(
            b.carregar(&m, "ST", &origem("x.dbc"), &misto, &Filtro::default())
                .is_err()
        );
        let total: i64 = b
            .conexao()
            .query_row("SELECT count(*) FROM cnes_st", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn profissionais_so_dos_cnes_escolhidos_e_sem_identificadores() {
        let m = Manifesto::carregar();
        let mut b = BancoCnes::em_memoria().unwrap();
        let campos: &[(&str, char, u8)] = &[
            ("CNES", 'C', 7),
            ("CODUFMUN", 'C', 6),
            ("PF_PJ", 'C', 1),
            ("CPF_CNPJ", 'C', 14),
            ("CPF_PROF", 'C', 11),
            ("CBO", 'C', 6),
            ("NOMEPROF", 'C', 12),
            ("CNS_PROF", 'C', 15),
            ("COMPETEN", 'C', 6),
        ];
        let pf = dbf(
            campos,
            &[
                &[
                    "0000001",
                    "500270",
                    "3",
                    "00000000000191",
                    "11111111111",
                    "225125",
                    "PESSOA A",
                    "700000000000001",
                    "202608",
                ],
                &[
                    "0000009",
                    "500270",
                    "3",
                    "00000000000272",
                    "22222222222",
                    "223505",
                    "PESSOA B",
                    "700000000000002",
                    "202608",
                ],
            ],
        );
        // Sem escolher CNES: recusa.
        assert!(matches!(
            b.carregar(&m, "PF", &origem("PF.dbc"), &pf, &Filtro::default()),
            Err(ErroCnes::Inconsistencia(_))
        ));
        let meus: HashSet<String> = ["0000001".to_string()].into();
        let c = b
            .carregar(
                &m,
                "PF",
                &origem("PF.dbc"),
                &pf,
                &Filtro {
                    municipios: None,
                    cnes: Some(&meus),
                },
            )
            .unwrap();
        assert_eq!((c.lidos, c.gravados), (2, 1));
        let colunas: Vec<String> = b
            .conexao()
            .prepare("SELECT name FROM pragma_table_info('cnes_pf')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(
            !colunas.contains(&"cpf_prof".to_string())
                && !colunas.contains(&"cns_prof".to_string())
        );
        assert!(colunas.contains(&"nomeprof".to_string()) && colunas.contains(&"cbo".to_string()));
        let outros: i64 = b
            .conexao()
            .query_row(
                "SELECT count(*) FROM cnes_pf WHERE cnes <> '0000001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(outros, 0);
        let reg: i64 = b
            .conexao()
            .query_row(
                "SELECT registros FROM sa_privacidade WHERE tipo='PF' AND campo='CPF_PROF'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(reg, 1);
    }

    #[test]
    fn cadastro_so_dos_cnes_em_uso_e_sem_dados_do_titular_pessoa_fisica() {
        let m = Manifesto::carregar();
        let mut b = BancoCnes::em_memoria().unwrap();
        let cad = dbf(
            &[
                ("CNES", 'C', 7),
                ("CPF_CNPJ", 'C', 14),
                ("FANTASIA", 'C', 12),
                ("RAZ_SOCI", 'C', 12),
                ("TELEFONE", 'C', 10),
            ],
            &[
                &[
                    "0000001",
                    "00000000000191",
                    "HOSPITAL A",
                    "ASSOCIACAO A",
                    "6733330000",
                ],
                &[
                    "0000002",
                    "00011122233344",
                    "CONSULTORIO",
                    "FULANO",
                    "6799990000",
                ],
                &["0000008", "00000000000999", "FECHADO", "X", ""],
            ],
        );
        // Antes do ST: recusa.
        assert!(
            b.carregar_cadastro(&m, &origem("CADGERMS.dbf"), &cad)
                .is_err()
        );
        let st = dbf(
            ST,
            &[
                &["0000001", "500270", "00000000000191", "3", "", "", "202608"],
                &["0000002", "500270", "00011122233344", "1", "", "", "202608"],
            ],
        );
        b.carregar(&m, "ST", &origem("ST.dbc"), &st, &Filtro::default())
            .unwrap();
        let c = b
            .carregar_cadastro(&m, &origem("CADGERMS.dbf"), &cad)
            .unwrap();
        assert_eq!((c.lidos, c.gravados), (3, 2));
        let pf: (String, String, String, String) = b
            .conexao()
            .query_row(
                "SELECT fantasia, cpf_cnpj, raz_soci, telefone FROM cnes_cad WHERE cnes='0000002'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            pf,
            (
                "CONSULTORIO".into(),
                String::new(),
                String::new(),
                String::new()
            )
        );
        let pj: String = b
            .conexao()
            .query_row(
                "SELECT raz_soci FROM cnes_cad WHERE cnes='0000001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pj, "ASSOCIACAO A");
    }

    #[test]
    fn banco_de_outra_versao_nao_e_alterado() {
        let d = std::env::temp_dir().join(format!("sa_cnes_v_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&d);
        drop(BancoCnes::abrir(&d).unwrap());
        Connection::open(&d)
            .unwrap()
            .execute(
                "UPDATE sa_info SET valor = '99' WHERE chave = 'versao_esquema'",
                [],
            )
            .unwrap();
        let antes = std::fs::read(&d).unwrap();
        assert!(BancoCnes::abrir(&d).is_err());
        assert_eq!(std::fs::read(&d).unwrap(), antes);
        let _ = std::fs::remove_file(&d);
    }
}
