//! Banco de produção do SUS de uma UF (`dados\producao\<UF>.db`): SIA (PA) e SIH (RD, ER).
//!
//! Só entram **totais** por estabelecimento, competência e procedimento (ou motivo de rejeição).
//! A linha do arquivo, que carrega dado de paciente (CNS do profissional, nascimento, CEP, número da
//! AIH), é somada e descartada: nenhum campo pessoal é lido nem gravado. Cada arquivo carregado
//! fica registrado em `sa_arquivo`, e recarregar o mesmo arquivo substitui os totais dele.

use rusqlite::{Connection, OptionalExtension, params};
use sa_sources::dbf::Dbf;
use sa_sources::producao::{Manifesto, Tipo};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;

/// Versão do esquema de `producao\<UF>.db`. A 3 acrescentou `prod_dim` (totais por valor de campo categórico e
/// somas de valor, ver o manifesto); um banco da 2 migra sem perder nada e os arquivos antigos ficam sem
/// essas dimensões até serem carregados de novo. A 2 acrescentou financiamento (parte da chave) e as medidas
/// opcionais (apresentado, incremento, dias); um banco da versão 1 é migrado ao abrir, sem perder
/// nada, e as linhas antigas ficam com as colunas novas vazias (NULL).
pub const VERSAO_ESQUEMA: &str = "3";

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS sa_info(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_arquivo(
    arquivo TEXT PRIMARY KEY, tipo TEXT NOT NULL, uf TEXT NOT NULL, sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL, registros_lidos INTEGER NOT NULL, linhas_gravadas INTEGER NOT NULL,
    confirmado INTEGER NOT NULL, carregado_em TEXT NOT NULL, competencias TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sa_privacidade(
    tipo TEXT NOT NULL, campo TEXT NOT NULL, regra TEXT NOT NULL, PRIMARY KEY(tipo, campo));
CREATE TABLE IF NOT EXISTS prod_amb(
    arq TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL,
    fin TEXT NOT NULL DEFAULT '', qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    qtd_pro INTEGER, valor_pro_cent INTEGER, valor_inc_cent INTEGER,
    PRIMARY KEY(arq, cnes, comp, proc, fin));
CREATE INDEX IF NOT EXISTS i_prod_amb_proc ON prod_amb(proc, comp);
CREATE INDEX IF NOT EXISTS i_prod_amb_cnes ON prod_amb(cnes, comp);
CREATE TABLE IF NOT EXISTS prod_hosp(
    arq TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL,
    fin TEXT NOT NULL DEFAULT '', aih INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    dias INTEGER, dias_uti INTEGER,
    PRIMARY KEY(arq, cnes, comp, proc, fin));
CREATE INDEX IF NOT EXISTS i_prod_hosp_proc ON prod_hosp(proc, comp);
CREATE INDEX IF NOT EXISTS i_prod_hosp_cnes ON prod_hosp(cnes, comp);
CREATE TABLE IF NOT EXISTS prod_dim(
    arq TEXT NOT NULL, tipo TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL,
    dim TEXT NOT NULL, cod TEXT NOT NULL, qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    qtd_pro INTEGER, valor_pro_cent INTEGER,
    PRIMARY KEY(arq, cnes, comp, dim, cod)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS i_prod_dim_cnes ON prod_dim(cnes, dim, comp);
CREATE TABLE IF NOT EXISTS prod_uf_dim(
    arq TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL, dim TEXT NOT NULL, cod TEXT NOT NULL,
    qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    PRIMARY KEY(arq, comp, proc, dim, cod)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS prod_ato(
    arq TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL,
    fin TEXT NOT NULL DEFAULT '', qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    PRIMARY KEY(arq, cnes, comp, proc, fin)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS i_prod_ato_cnes ON prod_ato(cnes, comp);
CREATE TABLE IF NOT EXISTS rej_hosp(
    arq TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL, motivo TEXT NOT NULL,
    qtd INTEGER NOT NULL, PRIMARY KEY(arq, cnes, comp, motivo));
CREATE INDEX IF NOT EXISTS i_rej_hosp_cnes ON rej_hosp(cnes, comp);
CREATE TABLE IF NOT EXISTS aux_codigo(
    tabela TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT NOT NULL, arquivo TEXT NOT NULL,
    PRIMARY KEY(tabela, codigo)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS aux_vigencia(
    tabela TEXT NOT NULL, codigo TEXT NOT NULL, inicio TEXT NOT NULL, fim TEXT NOT NULL, descricao TEXT NOT NULL,
    arquivo TEXT NOT NULL, PRIMARY KEY(tabela, codigo, inicio)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS moterro(
    codigo TEXT PRIMARY KEY, descricao TEXT NOT NULL, arquivo TEXT NOT NULL);
";

/// Totais da UF **derivados** de `prod_amb` e `prod_hosp` (origem `A` = SIA, `H` = SIH), para as telas
/// responderem em milissegundos mesmo em UF grande. Não guardam nada que as tabelas de totais não
/// tenham; são refeitos sozinhos quando uma carga ou remoção os invalida (`totais_ok` em `sa_info`).
/// `uf_produtor_mes` tem, por procedimento e estabelecimento, uma máscara com um bit por mês
/// (ver [`bit_da_competencia`]): contar quem produziu numa janela vira um `AND` de bits.
const ESQUEMA_TOTAIS: &str = "
CREATE TABLE IF NOT EXISTS uf_proc_mes(
    origem TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL, estab INTEGER NOT NULL,
    qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL, qtd_pro INTEGER, valor_pro_cent INTEGER,
    PRIMARY KEY(origem, comp, proc)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uf_cobertura(
    origem TEXT NOT NULL, comp TEXT NOT NULL, estab INTEGER NOT NULL, PRIMARY KEY(origem, comp)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uf_produtor_mes(
    origem TEXT NOT NULL, proc TEXT NOT NULL, cnes TEXT NOT NULL, meses INTEGER NOT NULL,
    PRIMARY KEY(origem, proc, cnes)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uf_dim_mes(
    comp TEXT NOT NULL, tipo TEXT NOT NULL, dim TEXT NOT NULL, cod TEXT NOT NULL,
    qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL, PRIMARY KEY(comp, tipo, dim, cod)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uf_estab_mes(
    origem TEXT NOT NULL, comp TEXT NOT NULL, cnes TEXT NOT NULL, qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    PRIMARY KEY(origem, comp, cnes)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uf_dias_proc(
    comp TEXT NOT NULL, proc TEXT NOT NULL, aih INTEGER NOT NULL, dias INTEGER NOT NULL,
    PRIMARY KEY(comp, proc)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uf_ato_mes(
    comp TEXT NOT NULL, fin TEXT NOT NULL, opm INTEGER NOT NULL, valor_cent INTEGER NOT NULL,
    PRIMARY KEY(comp, fin, opm)) WITHOUT ROWID;
";

/// Versão dos totais derivados (guardada em `totais_ok`): subir quando uma tabela derivada nova precisa ser preenchida
/// em bancos que já tinham os totais antigos.
const VERSAO_TOTAIS: &str = "3";

/// Meses corridos (ano × 12 + mês) de uma competência `AAAAMM`.
fn mes_corrido(comp: &str) -> Option<i64> {
    if comp.len() != 6 {
        return None;
    }
    let (a, m): (i64, i64) = (comp.get(..4)?.parse().ok()?, comp.get(4..6)?.parse().ok()?);
    (1..=12).contains(&m).then_some(a * 12 + m)
}

/// Bit do mês na máscara de `uf_produtor_mes`: meses corridos módulo 62 (cabe em 64 bits com sinal).
/// Uma janela de 12 meses nunca repete bit.
pub fn bit_da_competencia(comp: &str) -> Option<u32> {
    u32::try_from(mes_corrido(comp)? % 62).ok()
}

/// Máscara de uma janela de competências (para comparar com `uf_produtor_mes.meses`).
pub fn mascara_da_janela(comps: &[String]) -> Option<i64> {
    comps
        .iter()
        .try_fold(0i64, |m, c| Some(m | (1i64 << bit_da_competencia(c)?)))
}

/// Erro do módulo de produção.
#[derive(Debug)]
pub enum ErroProducao {
    Sql(rusqlite::Error),
    /// O arquivo não é o que deveria (falta campo, valor que não é número...).
    Arquivo(String),
    Inconsistencia(String),
}

impl fmt::Display for ErroProducao {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroProducao::Sql(e) => write!(
                f,
                "falha no banco de produção ({e}). Apague a pasta dados\\producao e baixe de novo"
            ),
            ErroProducao::Arquivo(m) => write!(
                f,
                "arquivo de produção recusado: {m}. Baixe de novo da fonte oficial (FTP do DATASUS)"
            ),
            ErroProducao::Inconsistencia(m) => write!(f, "produção: {m}"),
        }
    }
}

impl std::error::Error for ErroProducao {}

impl From<rusqlite::Error> for ErroProducao {
    fn from(e: rusqlite::Error) -> Self {
        ErroProducao::Sql(e)
    }
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
    pub competencias: Vec<String>,
    /// O que merece atenção no arquivo (por exemplo, competência dos registros diferente da do nome).
    pub avisos: Vec<String>,
    pub lidos: usize,
    /// Linhas de total gravadas (estabelecimento × competência × procedimento ou motivo).
    pub gravadas: usize,
    /// Campos pessoais que o arquivo tem e que não foram lidos nem gravados.
    pub pessoais_descartados: Vec<String>,
}

/// Um arquivo carregado.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ArquivoCarregado {
    pub arquivo: String,
    pub tipo: String,
    pub uf: String,
    pub bytes: u64,
    pub registros_lidos: u64,
    pub linhas_gravadas: u64,
    pub confirmado: bool,
    pub carregado_em: String,
    /// Competências (AAAAMM) que os **registros** do arquivo trazem, não a do nome.
    pub competencias: Vec<String>,
}

/// Totais de um estabelecimento, competência, procedimento (ou motivo) e financiamento.
#[derive(Debug, Default, Clone, Copy)]
struct Totais {
    qtd: i64,
    cent: i64,
    qtd_pro: Option<i64>,
    valor_pro: Option<i64>,
    valor_inc: Option<i64>,
    dias: Option<i64>,
    dias_uti: Option<i64>,
}

/// Soma de medida opcional: `None` (o arquivo não tem o campo) continua `None`.
fn soma_opc(acumulado: Option<i64>, novo: Option<i64>) -> Option<i64> {
    novo.map(|n| acumulado.unwrap_or(0) + n)
}

/// Banco de produção de uma UF.
pub struct BancoProducao {
    conn: Connection,
}

/// Valor decimal em texto (`12.34`, `12,3`, vazio) para centavos. `None` se não for número.
pub fn centavos(texto: &str) -> Option<i64> {
    let t = texto.trim();
    if t.is_empty() {
        return Some(0);
    }
    let (neg, t) = t.strip_prefix('-').map_or((false, t), |r| (true, r));
    let (inteiro, frac) = t.split_once(['.', ',']).unwrap_or((t, ""));
    if inteiro.is_empty() && frac.is_empty() {
        return None;
    }
    if !inteiro.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut f = frac.chars().take(2).collect::<String>();
    while f.len() < 2 {
        f.push('0');
    }
    let v = inteiro.parse::<i64>().unwrap_or(0) * 100 + f.parse::<i64>().ok()?;
    Some(if neg { -v } else { v })
}

fn competencia_do_registro(partes: &[String]) -> Option<String> {
    match partes {
        [c] => (c.len() == 6 && c.bytes().all(|b| b.is_ascii_digit())).then(|| c.clone()),
        [a, m] => {
            let mes: u32 = m.parse().ok()?;
            (a.len() == 4 && a.bytes().all(|b| b.is_ascii_digit()) && (1..=12).contains(&mes))
                .then(|| format!("{a}{mes:02}"))
        }
        _ => None,
    }
}

/// Competência que o nome do arquivo indica: `PAMS2607a.dbc` → `202607`.
fn competencia_do_nome(arquivo: &str) -> Option<String> {
    let b = arquivo.as_bytes();
    (b.len() >= 8 && b[4..8].iter().all(u8::is_ascii_digit))
        .then(|| format!("20{}", &arquivo[4..8]))
}

fn cnes_do_registro(t: &str) -> Option<String> {
    (!t.is_empty() && t.len() <= 7 && t.bytes().all(|b| b.is_ascii_digit()))
        .then(|| format!("{t:0>7}"))
}

/// Esquema 1 → 2: as tabelas de totais ganham colunas e a chave passa a ter o financiamento. As linhas
/// antigas ficam com financiamento vazio e as medidas novas NULL (a tela pede para baixar de novo).
fn migrar_de_1(conn: &Connection) -> Result<(), ErroProducao> {
    conn.execute_batch(
        "BEGIN;
         ALTER TABLE prod_amb RENAME TO prod_amb_v1;
         ALTER TABLE prod_hosp RENAME TO prod_hosp_v1;
         DROP INDEX IF EXISTS i_prod_amb_proc; DROP INDEX IF EXISTS i_prod_amb_cnes;
         DROP INDEX IF EXISTS i_prod_hosp_proc; DROP INDEX IF EXISTS i_prod_hosp_cnes;",
    )?;
    conn.execute_batch(ESQUEMA)?;
    conn.execute_batch(
        "INSERT INTO prod_amb(arq, cnes, comp, proc, fin, qtd, valor_cent)
             SELECT arq, cnes, comp, proc, '', qtd, valor_cent FROM prod_amb_v1;
         INSERT INTO prod_hosp(arq, cnes, comp, proc, fin, aih, valor_cent)
             SELECT arq, cnes, comp, proc, '', aih, valor_cent FROM prod_hosp_v1;
         DROP TABLE prod_amb_v1; DROP TABLE prod_hosp_v1;
         UPDATE sa_info SET valor = '2' WHERE chave = 'versao_esquema';
         COMMIT;",
    )?;
    Ok(())
}

/// Esquema 2 → 3: só acrescenta `prod_dim` (vazia). Os arquivos já somados ficam sem as dimensões novas.
fn migrar_de_2(conn: &Connection) -> Result<(), ErroProducao> {
    conn.execute_batch(ESQUEMA)?;
    conn.execute(
        "UPDATE sa_info SET valor = '3' WHERE chave = 'versao_esquema'",
        [],
    )?;
    Ok(())
}

impl BancoProducao {
    /// Abre (ou cria) o banco.
    pub fn abrir(caminho: &Path) -> Result<Self, ErroProducao> {
        Self::preparar(Connection::open(caminho)?)
    }

    /// Banco em memória (testes).
    pub fn em_memoria() -> Result<Self, ErroProducao> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(conn: Connection) -> Result<Self, ErroProducao> {
        conn.execute_batch("PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000;")?;
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
        match v.as_deref() {
            None | Some(VERSAO_ESQUEMA) => {}
            Some("1") => {
                migrar_de_1(&conn)?;
                migrar_de_2(&conn)?;
            }
            Some("2") => migrar_de_2(&conn)?,
            Some(x) => {
                return Err(ErroProducao::Inconsistencia(format!(
                    "esquema versão {x}, este programa usa a {VERSAO_ESQUEMA}"
                )));
            }
        }
        conn.execute_batch(ESQUEMA)?;
        conn.execute_batch(ESQUEMA_TOTAIS)?;
        if v.is_none() {
            conn.execute(
                "INSERT INTO sa_info VALUES('versao_esquema', ?1)",
                [VERSAO_ESQUEMA],
            )?;
        }
        let banco = Self { conn };
        banco.garantir_totais()?;
        Ok(banco)
    }

    /// Refaz os totais da UF se uma carga, remoção ou migração os invalidou. Barato quando já valem.
    pub fn garantir_totais(&self) -> Result<(), ErroProducao> {
        let ok: bool = self.conn.query_row(
            "SELECT count(*) > 0 FROM sa_info WHERE chave = 'totais_ok' AND valor = ?1",
            [VERSAO_TOTAIS],
            |r| r.get(0),
        )?;
        if ok {
            return Ok(());
        }
        self.refazer_totais()
    }

    /// Recalcula `uf_proc_mes`, `uf_cobertura` e `uf_produtor_mes` das tabelas de totais.
    pub fn refazer_totais(&self) -> Result<(), ErroProducao> {
        let bit =
            "(cast(substr(comp, 1, 4) as integer) * 12 + cast(substr(comp, 5, 2) as integer)) % 62";
        self.conn.execute_batch(&format!(
            "BEGIN;
             DELETE FROM uf_proc_mes; DELETE FROM uf_cobertura; DELETE FROM uf_produtor_mes;
             DELETE FROM uf_dim_mes; DELETE FROM uf_ato_mes; DELETE FROM uf_estab_mes; DELETE FROM uf_dias_proc;
             INSERT INTO uf_estab_mes SELECT 'A', comp, cnes, sum(qtd), sum(valor_cent) FROM prod_amb GROUP BY comp, cnes;
             INSERT INTO uf_estab_mes SELECT 'H', comp, cnes, sum(aih), sum(valor_cent) FROM prod_hosp GROUP BY comp, cnes;
             INSERT INTO uf_dias_proc
                 SELECT comp, proc, sum(aih), sum(dias) FROM prod_hosp WHERE dias IS NOT NULL GROUP BY comp, proc;
             DELETE FROM sa_info WHERE chave IN ('totais_ok', 'mascara_ok');
             INSERT INTO uf_dim_mes
                 SELECT comp, tipo, dim, cod, sum(qtd), sum(valor_cent) FROM prod_dim GROUP BY comp, tipo, dim, cod;
             INSERT INTO uf_ato_mes
                 SELECT comp, fin, proc LIKE '07%', sum(valor_cent) FROM prod_ato GROUP BY comp, fin, proc LIKE '07%';
             INSERT INTO uf_proc_mes
                 SELECT 'A', comp, proc, count(DISTINCT cnes), sum(qtd), sum(valor_cent), sum(qtd_pro), sum(valor_pro_cent)
                 FROM prod_amb GROUP BY comp, proc;
             INSERT INTO uf_proc_mes
                 SELECT 'H', comp, proc, count(DISTINCT cnes), sum(aih), sum(valor_cent), NULL, NULL
                 FROM prod_hosp GROUP BY comp, proc;
             INSERT INTO uf_cobertura SELECT 'A', comp, count(DISTINCT cnes) FROM prod_amb GROUP BY comp;
             INSERT INTO uf_cobertura SELECT 'H', comp, count(DISTINCT cnes) FROM prod_hosp GROUP BY comp;
             INSERT INTO uf_produtor_mes
                 SELECT 'A', proc, cnes, sum(m) FROM
                     (SELECT proc, cnes, 1 << ({bit}) AS m FROM prod_amb GROUP BY proc, cnes, {bit})
                 GROUP BY proc, cnes;
             INSERT INTO uf_produtor_mes
                 SELECT 'H', proc, cnes, sum(m) FROM
                     (SELECT proc, cnes, 1 << ({bit}) AS m FROM prod_hosp GROUP BY proc, cnes, {bit})
                 GROUP BY proc, cnes;
             INSERT INTO sa_info VALUES('totais_ok', '{VERSAO_TOTAIS}');
             COMMIT;"
        ))?;
        // A máscara só vale se o período carregado cabe em 62 meses (senão, dois meses dividem um bit).
        let (a, b): (Option<String>, Option<String>) =
            self.conn
                .query_row("SELECT min(comp), max(comp) FROM uf_cobertura", [], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?;
        let cabe = match (a, b) {
            (Some(a), Some(b)) => match (mes_corrido(&a), mes_corrido(&b)) {
                (Some(x), Some(y)) => y - x < 62,
                _ => false,
            },
            _ => true,
        };
        if cabe {
            self.conn
                .execute("INSERT INTO sa_info VALUES('mascara_ok', '1')", [])?;
        }
        Ok(())
    }

    /// Os totais da UF e a máscara de produtores valem para a janela de consulta?
    pub fn mascara_vale(&self) -> Result<bool, ErroProducao> {
        self.garantir_totais()?;
        Ok(self.conn.query_row(
            "SELECT count(*) > 0 FROM sa_info WHERE chave = 'mascara_ok'",
            [],
            |r| r.get(0),
        )?)
    }

    /// Invalida os totais da UF (a próxima consulta os refaz).
    fn invalidar_totais(tx: &rusqlite::Transaction<'_>) -> Result<(), ErroProducao> {
        tx.execute(
            "DELETE FROM sa_info WHERE chave IN ('totais_ok', 'mascara_ok')",
            [],
        )?;
        Ok(())
    }

    /// A conexão, para consultas.
    pub fn conexao(&self) -> &Connection {
        &self.conn
    }

    /// Carrega um arquivo de produção (já descomprimido para DBF), substituindo os totais do
    /// mesmo arquivo. Tudo ou nada. Só os campos do manifesto são lidos.
    pub fn carregar(
        &mut self,
        manifesto: &Manifesto,
        tipo: &str,
        origem: &Origem<'_>,
        dbf: &[u8],
    ) -> Result<Carga, ErroProducao> {
        let t: &Tipo = manifesto.tipo(tipo).ok_or_else(|| {
            ErroProducao::Arquivo(format!("tipo \"{tipo}\" não está no manifesto"))
        })?;
        let d = Dbf::abrir(dbf)
            .map_err(|e| ErroProducao::Arquivo(format!("{}: {e}", origem.arquivo)))?;
        let cab = &d.cabecalho;
        let falta: Vec<&str> = t
            .campos_lidos()
            .into_iter()
            .filter(|c| cab.indice(c).is_none())
            .collect();
        if !falta.is_empty() {
            let tem: Vec<&str> = cab.campos.iter().map(|c| c.nome.as_str()).collect();
            return Err(ErroProducao::Arquivo(format!(
                "{}: faltam os campos {} que {} deveria ter. Campos do arquivo: {}. Se o DATASUS mudou os nomes, atualize manifestos/producao.toml",
                origem.arquivo,
                falta.join(", "),
                t.nome,
                tem.join(", ")
            )));
        }
        let ix = |n: &str| cab.indice(n).expect("conferido acima");
        let i_cnes = ix(&t.cnes);
        let i_comp: Vec<usize> = t.competencia.iter().map(|c| ix(c)).collect();
        let i_proc = t.procedimento.as_deref().map(ix);
        let i_qtd = t.quantidade.as_deref().map(ix);
        let i_val = t.valor.as_deref().map(ix);
        let i_mot = t.motivo.as_deref().map(ix);
        // Opcionais: só valem se o arquivo os tem.
        let op = |n: &Option<String>| n.as_deref().and_then(|c| cab.indice(c));
        let i_fin = op(&t.financiamento);
        let i_qpro = op(&t.quantidade_apresentada);
        let i_vpro = op(&t.valor_apresentado);
        let i_vinc = op(&t.valor_incremento);
        let i_dias = op(&t.dias);
        let i_uti = op(&t.dias_uti);
        let i_uf: Vec<(&str, usize)> = t
            .dimensoes_uf
            .iter()
            .filter_map(|n| cab.indice(n).map(|i| (n.as_str(), i)))
            .collect();
        let i_dims: Vec<(&str, usize)> = t
            .dimensoes
            .iter()
            .filter_map(|n| cab.indice(n).map(|i| (n.as_str(), i)))
            .collect();
        let i_somas: Vec<(&str, usize)> = t
            .somas
            .iter()
            .filter_map(|n| cab.indice(n).map(|i| (n.as_str(), i)))
            .collect();
        let pessoais: Vec<String> = t
            .pessoais
            .iter()
            .filter(|p| cab.indice(p).is_some())
            .cloned()
            .collect();

        // (cnes, competência, procedimento ou motivo, financiamento) -> totais
        let mut soma: BTreeMap<(String, String, String, String), Totais> = BTreeMap::new();
        // (cnes, competência, campo, valor do campo) -> (quantidade, centavos)
        // ... -> (quantidade, centavos, quantidade apresentada, centavos apresentados): o apresentado só
        // existe no SIA e só vale se o arquivo tem o campo (NULL, não zero).
        // (competência, procedimento, campo, valor do campo) -> (quantidade, centavos), da UF inteira
        let mut uf_dim: BTreeMap<(String, String, String, String), (i64, i64)> = BTreeMap::new();
        type Dimensao = (i64, i64, Option<i64>, Option<i64>);
        let mut dim: BTreeMap<(String, String, String, String), Dimensao> = BTreeMap::new();
        let mut lidos = 0usize;
        for r in d.registros() {
            lidos += 1;
            let n = lidos;
            let ruim = |o: &str| {
                ErroProducao::Arquivo(format!(
                    "{}: registro {n} com {o} que não é válido",
                    origem.arquivo
                ))
            };
            let cnes = cnes_do_registro(&r.texto(i_cnes)).ok_or_else(|| ruim("CNES"))?;
            let partes: Vec<String> = i_comp.iter().map(|&i| r.texto(i)).collect();
            let comp = competencia_do_registro(&partes).ok_or_else(|| ruim("competência"))?;
            let chave = match (i_proc, i_mot) {
                (Some(i), _) => r.texto(i),
                (None, Some(i)) => r.texto(i),
                (None, None) => unreachable!("o manifesto exige procedimento ou motivo"),
            };
            if chave.is_empty() {
                return Err(ruim("procedimento ou motivo vazio"));
            }
            let qtd = match i_qtd {
                Some(i) => {
                    let q = r.texto(i);
                    if q.is_empty() {
                        0
                    } else {
                        q.parse::<i64>().map_err(|_| ruim("quantidade"))?
                    }
                }
                None => 1,
            };
            let valor = match i_val {
                Some(i) => centavos(&r.texto(i)).ok_or_else(|| ruim("valor"))?,
                None => 0,
            };
            let fin = match i_fin {
                Some(i) if i_mot.is_none() => r.texto(i),
                _ => String::new(),
            };
            let inteiro = |i: Option<usize>, o: &str| -> Result<Option<i64>, ErroProducao> {
                match i {
                    None => Ok(None),
                    Some(i) => {
                        let q = r.texto(i);
                        if q.is_empty() {
                            Ok(Some(0))
                        } else {
                            q.parse::<i64>().map(Some).map_err(|_| ruim(o))
                        }
                    }
                }
            };
            let dinheiro = |i: Option<usize>, o: &str| -> Result<Option<i64>, ErroProducao> {
                match i {
                    None => Ok(None),
                    Some(i) => centavos(&r.texto(i)).map(Some).ok_or_else(|| ruim(o)),
                }
            };
            let qpro = inteiro(i_qpro, "quantidade apresentada")?;
            let vpro = dinheiro(i_vpro, "valor apresentado")?;
            for (nome, i) in &i_dims {
                let e = dim
                    .entry((cnes.clone(), comp.clone(), (*nome).to_string(), r.texto(*i)))
                    .or_default();
                e.0 += qtd;
                e.1 += valor;
                e.2 = soma_opc(e.2, qpro);
                e.3 = soma_opc(e.3, vpro);
            }
            for (nome, i) in &i_uf {
                let e = uf_dim
                    .entry((
                        comp.clone(),
                        chave.clone(),
                        (*nome).to_string(),
                        r.texto(*i),
                    ))
                    .or_default();
                e.0 += qtd;
                e.1 += valor;
            }
            for (nome, i) in &i_somas {
                let v = centavos(&r.texto(*i)).ok_or_else(|| ruim(nome))?;
                dim.entry((
                    cnes.clone(),
                    comp.clone(),
                    (*nome).to_string(),
                    String::new(),
                ))
                .or_default()
                .1 += v;
            }
            let e = soma.entry((cnes, comp, chave, fin)).or_default();
            e.qtd += qtd;
            e.cent += valor;
            e.qtd_pro = soma_opc(e.qtd_pro, qpro);
            e.valor_pro = soma_opc(e.valor_pro, vpro);
            e.valor_inc = soma_opc(e.valor_inc, dinheiro(i_vinc, "valor de incremento")?);
            e.dias = soma_opc(e.dias, inteiro(i_dias, "dias de permanência")?);
            e.dias_uti = soma_opc(e.dias_uti, inteiro(i_uti, "dias de UTI")?);
        }
        let competencias: BTreeSet<String> = soma.keys().map(|k| k.1.clone()).collect();
        let mut avisos = Vec::new();
        if let Some(esperada) = competencia_do_nome(origem.arquivo)
            && competencias.iter().any(|c| *c != esperada)
        {
            avisos.push(format!(
                "{}: o nome indica {esperada}, mas os registros são de {}",
                origem.arquivo,
                competencias.iter().cloned().collect::<Vec<_>>().join(", ")
            ));
        }

        let tx = self.conn.transaction()?;
        Self::invalidar_totais(&tx)?;
        for tab in [
            "prod_amb",
            "prod_hosp",
            "prod_ato",
            "rej_hosp",
            "prod_dim",
            "prod_uf_dim",
        ] {
            tx.execute(
                &format!("DELETE FROM {tab} WHERE arq = ?1"),
                [origem.arquivo],
            )?;
        }
        {
            let mut ins =
                tx.prepare("INSERT INTO prod_uf_dim VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)")?;
            for ((comp, proc, campo, cod), (q, v)) in &uf_dim {
                ins.execute(params![origem.arquivo, comp, proc, campo, cod, q, v])?;
            }
        }
        {
            let mut ins =
                tx.prepare("INSERT INTO prod_dim VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")?;
            for ((cnes, comp, campo, cod), (q, v, qp, vp)) in &dim {
                ins.execute(params![
                    origem.arquivo,
                    t.codigo,
                    cnes,
                    comp,
                    campo,
                    cod,
                    q,
                    v,
                    qp,
                    vp
                ])?;
            }
        }
        {
            let sql = match (t.codigo.as_str(), i_mot.is_some()) {
                (_, true) => "INSERT INTO rej_hosp VALUES(?1, ?2, ?3, ?4, ?5)",
                ("SP", _) => {
                    "INSERT INTO prod_ato(arq, cnes, comp, proc, fin, qtd, valor_cent)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)"
                }
                ("PA", _) => {
                    "INSERT INTO prod_amb(arq, cnes, comp, proc, fin, qtd, valor_cent, qtd_pro, valor_pro_cent, valor_inc_cent)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
                }
                _ => {
                    "INSERT INTO prod_hosp(arq, cnes, comp, proc, fin, aih, valor_cent, dias, dias_uti)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
                }
            };
            let mut ins = tx.prepare(sql)?;
            for ((cnes, comp, chave, fin), e) in &soma {
                if i_mot.is_some() {
                    ins.execute(params![origem.arquivo, cnes, comp, chave, e.qtd])?;
                } else if t.codigo == "SP" {
                    ins.execute(params![
                        origem.arquivo,
                        cnes,
                        comp,
                        chave,
                        fin,
                        e.qtd,
                        e.cent
                    ])?;
                } else if t.codigo == "PA" {
                    ins.execute(params![
                        origem.arquivo,
                        cnes,
                        comp,
                        chave,
                        fin,
                        e.qtd,
                        e.cent,
                        e.qtd_pro,
                        e.valor_pro,
                        e.valor_inc
                    ])?;
                } else {
                    ins.execute(params![
                        origem.arquivo,
                        cnes,
                        comp,
                        chave,
                        fin,
                        e.qtd,
                        e.cent,
                        e.dias,
                        e.dias_uti
                    ])?;
                }
            }
        }
        for p in &pessoais {
            tx.execute(
                "INSERT OR REPLACE INTO sa_privacidade VALUES(?1, ?2, 'não lido e não gravado')",
                params![t.codigo, p],
            )?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO sa_arquivo VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), ?9)",
            params![
                origem.arquivo,
                t.codigo,
                origem.uf,
                origem.sha256,
                i64::try_from(origem.bytes).unwrap_or(i64::MAX),
                i64::try_from(lidos).unwrap_or(i64::MAX),
                i64::try_from(soma.len()).unwrap_or(i64::MAX),
                t.confirmado,
                competencias.iter().cloned().collect::<Vec<_>>().join(",")
            ],
        )?;
        tx.commit()?;
        Ok(Carga {
            tipo: t.codigo.clone(),
            competencias: competencias.into_iter().collect(),
            avisos,
            lidos,
            gravadas: soma.len(),
            pessoais_descartados: pessoais,
        })
    }

    /// Grava a tabela de motivos de rejeição (código, descrição), substituindo a anterior.
    pub fn gravar_moterro(
        &mut self,
        motivos: &[(String, String)],
        arquivo: &str,
    ) -> Result<(), ErroProducao> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM moterro", [])?;
        {
            let mut ins = tx.prepare("INSERT OR REPLACE INTO moterro VALUES(?1, ?2, ?3)")?;
            for (c, d) in motivos {
                ins.execute(params![c, d, arquivo])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Grava uma tabela auxiliar de códigos (`CODOCO`, `INDICA`, `DOCORIG`), substituindo a anterior.
    pub fn gravar_auxiliar(
        &mut self,
        tabela: &str,
        codigos: &[(String, String)],
        arquivo: &str,
    ) -> Result<(), ErroProducao> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM aux_codigo WHERE tabela = ?1", [tabela])?;
        {
            let mut ins = tx.prepare("INSERT OR REPLACE INTO aux_codigo VALUES(?1, ?2, ?3, ?4)")?;
            for (c, d) in codigos {
                ins.execute(params![tabela, c, d, arquivo])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Grava as vigências das críticas (`erroebloqueio.xlsx`), substituindo as anteriores.
    pub fn gravar_vigencias(
        &mut self,
        v: &[sa_sources::producao::Vigencia],
        arquivo: &str,
    ) -> Result<(), ErroProducao> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM aux_vigencia", [])?;
        {
            let mut ins =
                tx.prepare("INSERT OR REPLACE INTO aux_vigencia VALUES(?1, ?2, ?3, ?4, ?5, ?6)")?;
            for x in v {
                ins.execute(params![
                    x.tabela,
                    x.codigo,
                    x.inicio,
                    x.fim,
                    x.descricao,
                    arquivo
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Descrição de um código de tabela auxiliar (por exemplo `INDICA`, `5`).
    pub fn descricao_auxiliar(
        &self,
        tabela: &str,
        codigo: &str,
    ) -> Result<Option<String>, ErroProducao> {
        Ok(self
            .conn
            .query_row(
                "SELECT descricao FROM aux_codigo WHERE tabela = ?1 AND codigo = ?2",
                [tabela, codigo],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// Remove os totais de um arquivo.
    pub fn remover_arquivo(&mut self, arquivo: &str) -> Result<(), ErroProducao> {
        let tx = self.conn.transaction()?;
        Self::invalidar_totais(&tx)?;
        for tab in [
            "prod_amb",
            "prod_hosp",
            "prod_ato",
            "rej_hosp",
            "prod_dim",
            "prod_uf_dim",
        ] {
            tx.execute(&format!("DELETE FROM {tab} WHERE arq = ?1"), [arquivo])?;
        }
        tx.execute("DELETE FROM sa_arquivo WHERE arquivo = ?1", [arquivo])?;
        tx.commit()?;
        Ok(())
    }

    /// Arquivos de SIA ou SIH carregados antes do esquema 3 (sem totais por campo categórico).
    pub fn arquivos_sem_dimensoes(&self) -> Result<Vec<String>, ErroProducao> {
        let mut s = self.conn.prepare(
            "SELECT arquivo FROM sa_arquivo WHERE tipo IN ('PA', 'RD', 'SP')
               AND arquivo NOT IN (SELECT DISTINCT arq FROM prod_dim) ORDER BY arquivo",
        )?;
        Ok(s.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?)
    }

    /// Os arquivos carregados.
    pub fn arquivos(&self) -> Result<Vec<ArquivoCarregado>, ErroProducao> {
        let mut s = self.conn.prepare(
            "SELECT arquivo, tipo, uf, bytes, registros_lidos, linhas_gravadas, confirmado, carregado_em, competencias
             FROM sa_arquivo ORDER BY arquivo",
        )?;
        let v = s
            .query_map([], |r| {
                Ok(ArquivoCarregado {
                    arquivo: r.get(0)?,
                    tipo: r.get(1)?,
                    uf: r.get(2)?,
                    bytes: r.get::<_, i64>(3)?.unsigned_abs(),
                    registros_lidos: r.get::<_, i64>(4)?.unsigned_abs(),
                    linhas_gravadas: r.get::<_, i64>(5)?.unsigned_abs(),
                    confirmado: r.get(6)?,
                    carregado_em: r.get(7)?,
                    competencias: r
                        .get::<_, String>(8)?
                        .split(',')
                        .filter(|c| !c.is_empty())
                        .map(String::from)
                        .collect(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    }
}

/// DBF sintético para testes (aqui e nos crates que usam o banco).
pub mod sintetico {
    /// Monta um DBF com campos de texto `(nome, tamanho)` e linhas de valores.
    pub fn dbf(campos: &[(&str, u8)], linhas: &[Vec<String>]) -> Vec<u8> {
        let tam_reg: usize = 1 + campos.iter().map(|c| usize::from(c.1)).sum::<usize>();
        let tam_cab = 32 + 32 * campos.len() + 1;
        let mut b = vec![0u8; 32];
        b[0] = 3;
        b[4..8].copy_from_slice(&u32::try_from(linhas.len()).unwrap().to_le_bytes());
        b[8..10].copy_from_slice(&u16::try_from(tam_cab).unwrap().to_le_bytes());
        b[10..12].copy_from_slice(&u16::try_from(tam_reg).unwrap().to_le_bytes());
        for (nome, tam) in campos {
            let mut d = [0u8; 32];
            d[..nome.len()].copy_from_slice(nome.as_bytes());
            d[11] = b'C';
            d[16] = *tam;
            b.extend_from_slice(&d);
        }
        b.push(0x0D);
        for linha in linhas {
            b.push(b' ');
            for (valor, (_, tam)) in linha.iter().zip(campos) {
                let mut c = vec![b' '; usize::from(*tam)];
                let v = sa_sources::latin1::codificar(valor).expect("fixture em ISO-8859-1");
                c[..v.len()].copy_from_slice(&v);
                b.extend_from_slice(&c);
            }
        }
        b.push(0x1A);
        b
    }
}

#[cfg(test)]
mod testes {
    use super::sintetico::dbf;
    use super::*;

    fn origem(arquivo: &str) -> Origem<'_> {
        Origem {
            uf: "MS",
            arquivo,
            sha256: "00",
            bytes: 1,
        }
    }

    const CAMPOS_PA: [(&str, u8); 7] = [
        ("PA_CODUNI", 7),
        ("PA_MVM", 6),
        ("PA_PROC_ID", 10),
        ("PA_QTDAPR", 8),
        ("PA_VALAPR", 12),
        ("PA_CNSMED", 15),
        ("PA_IDADE", 3),
    ];

    fn l(v: &[&str]) -> Vec<String> {
        v.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn mascara_da_janela_marca_um_bit_por_mes_sem_repetir_em_12_meses() {
        let janela: Vec<String> = (1..=12).map(|m| format!("2025{m:02}")).collect();
        let m = mascara_da_janela(&janela).unwrap();
        assert_eq!(m.count_ones(), 12);
        assert_eq!(mascara_da_janela(&["202613".to_string()]), None);
        assert_eq!(bit_da_competencia("2026"), None);
    }

    #[test]
    fn totais_da_uf_acompanham_cargas_e_remocoes() {
        let m = Manifesto::carregar();
        let mut b = BancoProducao::em_memoria().unwrap();
        let linha = |u: &str, c: &str, p: &str, q: &str, v: &str| {
            l(&[u, c, p, q, v, "898000000000001", "34"])
        };
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2606a.dbc"),
            &dbf(
                &CAMPOS_PA,
                &[
                    linha("2000001", "202606", "0301010072", "10", "37.36"),
                    linha("2000002", "202606", "0301010072", "5", "18.68"),
                ],
            ),
        )
        .unwrap();
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2607a.dbc"),
            &dbf(
                &CAMPOS_PA,
                &[linha("2000001", "202607", "0301010072", "1", "3.73")],
            ),
        )
        .unwrap();
        b.garantir_totais().unwrap();
        let c = b.conexao();
        let (estab, qtd, val): (i64, i64, i64) = c
            .query_row(
                "SELECT estab, qtd, valor_cent FROM uf_proc_mes WHERE origem='A' AND comp='202606' AND proc='0301010072'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((estab, qtd, val), (2, 15, 5604));
        let cob: i64 = c
            .query_row(
                "SELECT estab FROM uf_cobertura WHERE origem='A' AND comp='202607'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cob, 1);
        // A máscara de julho pega 1 estabelecimento, a de junho pega 2, as duas juntas pegam 2.
        let conta = |comps: &[&str]| -> i64 {
            let v: Vec<String> = comps.iter().map(ToString::to_string).collect();
            let mask = mascara_da_janela(&v).unwrap();
            c.query_row(
                "SELECT count(*) FROM uf_produtor_mes WHERE origem='A' AND meses & ?1 <> 0",
                [mask],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(conta(&["202607"]), 1);
        assert_eq!(conta(&["202606"]), 2);
        assert_eq!(conta(&["202606", "202607"]), 2);
        assert!(b.mascara_vale().unwrap());
        // Remover um arquivo invalida; garantir_totais refaz sem o mês removido.
        b.remover_arquivo("PAMS2607a.dbc").unwrap();
        let valido: bool = b
            .conexao()
            .query_row(
                "SELECT count(*) > 0 FROM sa_info WHERE chave='totais_ok'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!valido, "remover deve invalidar os totais");
        b.garantir_totais().unwrap();
        let n: i64 = b
            .conexao()
            .query_row(
                "SELECT count(*) FROM uf_cobertura WHERE origem='A'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn dimensoes_e_somas_do_esquema_3_sao_guardadas_por_valor_do_campo() {
        let m = Manifesto::carregar();
        let campos = [
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
            ("PA_INDICA", 1),
            ("PA_CODOCO", 4),
            ("PA_DOCORIG", 1),
            ("PA_VL_CL", 12),
            ("PA_CNSMED", 15),
        ];
        let linha = |q: &str, v: &str, ind: &str, oco: &str, vcl: &str| {
            l(&[
                "2000001",
                "202607",
                "0301010072",
                q,
                v,
                ind,
                oco,
                "C",
                vcl,
                "898000000000001",
            ])
        };
        let mut b = BancoProducao::em_memoria().unwrap();
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2607a.dbc"),
            &dbf(
                &campos,
                &[
                    linha("10", "100.00", "5", "", "40.00"),
                    linha("4", "0.00", "0", "0024", "0.00"),
                    linha("2", "20.00", "5", "", "8.00"),
                ],
            ),
        )
        .unwrap();
        let c = b.conexao();
        let q = |campo: &str, cod: &str| -> (i64, i64) {
            c.query_row(
                "SELECT qtd, valor_cent FROM prod_dim WHERE dim = ?1 AND cod = ?2",
                [campo, cod],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(q("PA_INDICA", "5"), (12, 12000));
        assert_eq!(q("PA_INDICA", "0"), (4, 0));
        assert_eq!(q("PA_CODOCO", "0024"), (4, 0));
        assert_eq!(q("PA_DOCORIG", "C"), (16, 12000));
        assert_eq!(q("PA_VL_CL", ""), (0, 4800));
        // Campo do manifesto que o arquivo não tem simplesmente não aparece (não vira zero).
        let n: i64 = c
            .query_row(
                "SELECT count(*) FROM prod_dim WHERE dim = 'PA_FLQT'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
        assert!(b.arquivos_sem_dimensoes().unwrap().is_empty());
        // Recarregar o mesmo arquivo substitui; remover apaga as dimensões junto.
        b.remover_arquivo("PAMS2607a.dbc").unwrap();
        let n: i64 = b
            .conexao()
            .query_row("SELECT count(*) FROM prod_dim", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn atos_do_sih_somam_por_tipo_de_valor_sem_misturar_com_as_aih() {
        let m = Manifesto::carregar();
        let campos = [
            ("SP_CNES", 7),
            ("SP_AA", 4),
            ("SP_MM", 2),
            ("SP_NAIH", 13),
            ("SP_ATOPROF", 10),
            ("SP_QTD_ATO", 4),
            ("SP_VALATO", 14),
            ("IN_TP_VAL", 1),
            ("SP_CO_FAEC", 6),
            ("SP_PF_CBO", 6),
        ];
        let ato = |p: &str, q: &str, v: &str, tp: &str| {
            l(&[
                "2000001",
                "2026",
                "07",
                "5000000000001",
                p,
                q,
                v,
                tp,
                "",
                "225125",
            ])
        };
        let mut b = BancoProducao::em_memoria().unwrap();
        let c = b
            .carregar(
                &m,
                "SP",
                &origem("SPMS2607.dbc"),
                &dbf(
                    &campos,
                    &[
                        ato("0407040064", "1", "800.00", "1"),
                        ato("0407040064", "1", "200.00", "2"),
                        ato("0408060123", "2", "50.00", "1"),
                    ],
                ),
            )
            .unwrap();
        assert_eq!(c.gravadas, 3);
        assert!(c.pessoais_descartados.contains(&"SP_NAIH".to_string()));
        let conn = b.conexao();
        let (q, v): (i64, i64) = conn
            .query_row(
                "SELECT sum(qtd), sum(valor_cent) FROM prod_ato WHERE fin = '1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((q, v), (3, 85000));
        let outras: i64 = conn
            .query_row(
                "SELECT (SELECT count(*) FROM prod_hosp) + (SELECT count(*) FROM prod_amb)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            outras, 0,
            "os atos não entram nas tabelas de AIH nem de SIA"
        );
        b.remover_arquivo("SPMS2607.dbc").unwrap();
        let n: i64 = b
            .conexao()
            .query_row("SELECT count(*) FROM prod_ato", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn arquivo_sem_campos_categoricos_fica_na_lista_de_sem_dimensoes() {
        let m = Manifesto::carregar();
        let mut b = BancoProducao::em_memoria().unwrap();
        b.carregar(
            &m,
            "PA",
            &origem("PAMS2606a.dbc"),
            &dbf(
                &CAMPOS_PA,
                &[l(&[
                    "2000001",
                    "202606",
                    "0301010072",
                    "1",
                    "3.73",
                    "898000000000001",
                    "34",
                ])],
            ),
        )
        .unwrap();
        // Um arquivo do SIA sem nenhum campo categórico não gera dimensão: fica na lista "sem dimensões".
        assert_eq!(b.arquivos_sem_dimensoes().unwrap(), ["PAMS2606a.dbc"]);
    }

    #[test]
    fn tabelas_auxiliares_gravam_substituem_e_respondem() {
        let mut b = BancoProducao::em_memoria().unwrap();
        let c = |a: &str, d: &str| (a.to_string(), d.to_string());
        b.gravar_auxiliar(
            "INDICA",
            &[c("5", "Aprovado totalmente"), c("0", "Não aprovado")],
            "TAB_SIA.zip",
        )
        .unwrap();
        assert_eq!(
            b.descricao_auxiliar("INDICA", "5").unwrap().as_deref(),
            Some("Aprovado totalmente")
        );
        assert_eq!(b.descricao_auxiliar("INDICA", "9").unwrap(), None);
        b.gravar_auxiliar("INDICA", &[c("5", "Aprovado")], "TAB_SIA.zip")
            .unwrap();
        assert_eq!(
            b.descricao_auxiliar("INDICA", "0").unwrap(),
            None,
            "a tabela nova substitui a anterior"
        );
        let v = sa_sources::producao::Vigencia {
            tabela: "0027".into(),
            codigo: "0001".into(),
            inicio: "200701".into(),
            fim: "999999".into(),
            descricao: "DUPLICIDADE".into(),
        };
        b.gravar_vigencias(&[v], "TAB_SIH.zip").unwrap();
        let fim: String = b
            .conexao()
            .query_row(
                "SELECT fim FROM aux_vigencia WHERE tabela='0027' AND codigo='0001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fim, "999999");
    }

    #[test]
    fn centavos_le_decimais_com_ponto_ou_virgula() {
        assert_eq!(centavos("12.34"), Some(1234));
        assert_eq!(centavos("12,3"), Some(1230));
        assert_eq!(centavos(" 7 "), Some(700));
        assert_eq!(centavos(""), Some(0));
        assert_eq!(centavos("-5.5"), Some(-550));
        assert_eq!(centavos("1.2.3"), None);
        assert_eq!(centavos("abc"), None);
    }

    #[test]
    fn soma_pa_por_estabelecimento_competencia_e_procedimento() {
        let arq = dbf(
            &CAMPOS_PA,
            &[
                l(&[
                    "2000001",
                    "202607",
                    "0301010072",
                    "10",
                    "37.36",
                    "898000000000001",
                    "34",
                ]),
                l(&[
                    "2000001",
                    "202607",
                    "0301010072",
                    "5",
                    "18.68",
                    "898000000000002",
                    "61",
                ]),
                l(&[
                    "2000001",
                    "202607",
                    "0202010503",
                    "3",
                    "9.45",
                    "898000000000001",
                    "34",
                ]),
                l(&["2000002", "202607", "0301010072", "1", "3.736", "", ""]),
            ],
        );
        let m = Manifesto::carregar();
        let mut b = BancoProducao::em_memoria().unwrap();
        let c = b
            .carregar(&m, "PA", &origem("PAMS2607a.dbc"), &arq)
            .unwrap();
        assert_eq!(c.lidos, 4);
        assert_eq!(c.gravadas, 3);
        assert_eq!(c.competencias, ["202607"]);
        assert_eq!(c.pessoais_descartados, ["PA_CNSMED", "PA_IDADE"]);
        let q = |cnes: &str, proc: &str| -> (i64, i64) {
            b.conexao()
                .query_row(
                    "SELECT qtd, valor_cent FROM prod_amb WHERE cnes=?1 AND proc=?2",
                    [cnes, proc],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap()
        };
        assert_eq!(q("2000001", "0301010072"), (15, 5604));
        assert_eq!(q("2000001", "0202010503"), (3, 945));
        assert_eq!(q("2000002", "0301010072"), (1, 373));
    }

    #[test]
    fn nenhum_dado_pessoal_chega_ao_banco() {
        let arq = dbf(
            &CAMPOS_PA,
            &[l(&[
                "2000001",
                "202607",
                "0301010072",
                "1",
                "1.00",
                "898000099999999",
                "47",
            ])],
        );
        let dir = std::env::temp_dir().join(format!("sa_prod_priv_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let caminho = dir.join("MS.db");
        let _ = std::fs::remove_file(&caminho);
        {
            let mut b = BancoProducao::abrir(&caminho).unwrap();
            b.carregar(&Manifesto::carregar(), "PA", &origem("PAMS2607a.dbc"), &arq)
                .unwrap();
            let colunas: Vec<String> = b
                .conexao()
                .prepare("SELECT m.name || '.' || p.name FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table'")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            for proibida in ["PA_CNSMED", "PA_IDADE", "N_AIH", "NASC", "CEP"] {
                assert!(
                    !colunas.iter().any(|c| c.to_uppercase().contains(proibida)),
                    "coluna pessoal {proibida} no banco"
                );
            }
        }
        let bytes = std::fs::read(&caminho).unwrap();
        let tem = |agulha: &[u8]| bytes.windows(agulha.len()).any(|w| w == agulha);
        assert!(
            !tem(b"898000099999999"),
            "CNS do profissional no arquivo do banco"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn competencia_dos_registros_vale_e_diferenca_do_nome_vira_aviso() {
        let m = Manifesto::carregar();
        let mut b = BancoProducao::em_memoria().unwrap();
        // Nome diz 2607, mas o arquivo tem junho e julho.
        let misto = dbf(
            &CAMPOS_PA[..5],
            &[
                l(&["2000001", "202606", "0301010072", "1", "1.00"]),
                l(&["2000001", "202607", "0301010072", "2", "1.00"]),
            ],
        );
        let c = b
            .carregar(&m, "PA", &origem("PAMS2607a.dbc"), &misto)
            .unwrap();
        assert_eq!(c.competencias, ["202606", "202607"]);
        assert_eq!(c.avisos.len(), 1);
        assert!(
            c.avisos[0].contains("nome indica 202607") && c.avisos[0].contains("202606, 202607"),
            "{:?}",
            c.avisos
        );
        let a = &b.arquivos().unwrap()[0];
        assert_eq!(
            a.competencias,
            ["202606", "202607"],
            "a situação usa a dos registros"
        );
        // Arquivo coerente com o nome: sem aviso.
        let ok = dbf(
            &CAMPOS_PA[..5],
            &[l(&["2000001", "202608", "0301010072", "1", "1.00"])],
        );
        let c = b.carregar(&m, "PA", &origem("PAMS2608a.dbc"), &ok).unwrap();
        assert!(c.avisos.is_empty());
    }

    #[test]
    fn campo_ausente_e_recusado_com_orientacao() {
        let arq = dbf(&[("PA_CODUNI", 7), ("OUTRO", 4)], &[l(&["2000001", "x"])]);
        let mut b = BancoProducao::em_memoria().unwrap();
        let e = b
            .carregar(&Manifesto::carregar(), "PA", &origem("PAMS2607a.dbc"), &arq)
            .unwrap_err()
            .to_string();
        assert!(e.contains("PA_MVM") && e.contains("PA_VALAPR"), "{e}");
        assert!(e.contains("Campos do arquivo: PA_CODUNI, OUTRO"), "{e}");
        assert!(e.contains("manifestos/producao.toml"), "{e}");
        // nada foi gravado
        assert!(b.arquivos().unwrap().is_empty());
    }

    #[test]
    fn valor_invalido_recusa_o_arquivo_inteiro_sem_gravar() {
        let arq = dbf(
            &CAMPOS_PA,
            &[
                l(&["2000001", "202607", "0301010072", "1", "1.00", "", ""]),
                l(&["2000001", "202607", "0301010072", "x1", "1.00", "", ""]),
            ],
        );
        let mut b = BancoProducao::em_memoria().unwrap();
        let e = b
            .carregar(&Manifesto::carregar(), "PA", &origem("PAMS2607a.dbc"), &arq)
            .unwrap_err()
            .to_string();
        assert!(e.contains("registro 2") && e.contains("quantidade"), "{e}");
        let n: i64 = b
            .conexao()
            .query_row("SELECT count(*) FROM prod_amb", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn recarregar_o_mesmo_arquivo_substitui_e_partes_diferentes_somam() {
        let m = Manifesto::carregar();
        let mut b = BancoProducao::em_memoria().unwrap();
        let a = dbf(
            &CAMPOS_PA,
            &[l(&[
                "2000001",
                "202607",
                "0301010072",
                "10",
                "1.00",
                "",
                "",
            ])],
        );
        let a2 = dbf(
            &CAMPOS_PA,
            &[l(&["2000001", "202607", "0301010072", "4", "1.00", "", ""])],
        );
        let parte_b = dbf(
            &CAMPOS_PA,
            &[l(&["2000001", "202607", "0301010072", "6", "1.00", "", ""])],
        );
        b.carregar(&m, "PA", &origem("PAMS2607a.dbc"), &a).unwrap();
        b.carregar(&m, "PA", &origem("PAMS2607a.dbc"), &a2).unwrap();
        b.carregar(&m, "PA", &origem("PAMS2607b.dbc"), &parte_b)
            .unwrap();
        let soma: i64 = b
            .conexao()
            .query_row("SELECT sum(qtd) FROM prod_amb", [], |r| r.get(0))
            .unwrap();
        assert_eq!(soma, 10, "4 (a, recarregada) + 6 (b)");
        assert_eq!(b.arquivos().unwrap().len(), 2);
        b.remover_arquivo("PAMS2607b.dbc").unwrap();
        let soma: i64 = b
            .conexao()
            .query_row("SELECT sum(qtd) FROM prod_amb", [], |r| r.get(0))
            .unwrap();
        assert_eq!(soma, 4);
    }

    #[test]
    fn rd_conta_uma_aih_por_registro_e_nao_grava_o_numero_da_aih() {
        let campos = [
            ("CNES", 7),
            ("ANO_CMPT", 4),
            ("MES_CMPT", 2),
            ("PROC_REA", 10),
            ("VAL_TOT", 12),
            ("N_AIH", 13),
            ("NASC", 8),
        ];
        let arq = dbf(
            &campos,
            &[
                l(&[
                    "2000001",
                    "2026",
                    "7",
                    "0407040064",
                    "1500.50",
                    "5026000000011",
                    "19800101",
                ]),
                l(&[
                    "2000001",
                    "2026",
                    "07",
                    "0407040064",
                    "1500.50",
                    "5026000000012",
                    "19900202",
                ]),
                l(&[
                    "2000001",
                    "2026",
                    "07",
                    "0303010010",
                    "400",
                    "5026000000013",
                    "20000303",
                ]),
            ],
        );
        let mut b = BancoProducao::em_memoria().unwrap();
        let c = b
            .carregar(&Manifesto::carregar(), "RD", &origem("RDMS2607.dbc"), &arq)
            .unwrap();
        assert_eq!(c.competencias, ["202607"]);
        assert_eq!(c.pessoais_descartados, ["N_AIH", "NASC"]);
        let (aih, cent): (i64, i64) = b
            .conexao()
            .query_row(
                "SELECT aih, valor_cent FROM prod_hosp WHERE proc='0407040064'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((aih, cent), (2, 300_100));
    }

    /// O cabeçalho do ER como o arquivo real de MS (08/2025 a 07/2026) o traz, na ordem do arquivo.
    #[test]
    fn er_com_o_cabecalho_real_agrega_por_estabelecimento_e_motivo_sem_dado_de_paciente() {
        let campos = [
            ("SEQUENCIA", 8),
            ("REMESSA", 8),
            ("CNES", 7),
            ("AIH", 13),
            ("ANO", 4),
            ("MES", 2),
            ("DT_INTER", 8),
            ("DT_SAIDA", 8),
            ("MUN_MOV", 6),
            ("UF_ZI", 6),
            ("MUN_RES", 6),
            ("UF_RES", 2),
            ("CO_ERRO", 3),
        ];
        let linha = |cnes: &str, aih: &str, mes: &str, erro: &str| {
            l(&[
                "1", "2607", cnes, aih, "2026", mes, "20260701", "20260705", "500270", "500270",
                "500060", "MS", erro,
            ])
        };
        let arq = dbf(
            &campos,
            &[
                linha("2000001", "5026000000011", "07", "023"),
                linha("2000001", "5026000000012", "07", "023"),
                linha("2000001", "5026000000013", "06", "023"),
                linha("2000001", "5026000000014", "07", "101"),
            ],
        );
        let mut b = BancoProducao::em_memoria().unwrap();
        let c = b
            .carregar(&Manifesto::carregar(), "ER", &origem("ERMS2607.dbc"), &arq)
            .unwrap();
        assert_eq!(c.competencias, ["202606", "202607"]);
        assert_eq!(
            c.pessoais_descartados,
            ["AIH", "DT_INTER", "DT_SAIDA", "MUN_RES", "UF_RES"]
        );
        let q = |motivo: &str| -> i64 {
            b.conexao()
                .query_row(
                    "SELECT sum(qtd) FROM rej_hosp WHERE cnes='2000001' AND motivo=?1",
                    [motivo],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert_eq!((q("023"), q("101")), (3, 1));
        // O número da AIH e as datas não chegam ao banco.
        let colunas: Vec<String> = b
            .conexao()
            .prepare("SELECT name FROM pragma_table_info('rej_hosp')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(colunas, ["arq", "cnes", "comp", "motivo", "qtd"]);
    }

    #[test]
    fn versao_de_esquema_mais_nova_recusa_sem_alterar() {
        let dir = std::env::temp_dir().join(format!("sa_prod_ver_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let caminho = dir.join("MS.db");
        let _ = std::fs::remove_file(&caminho);
        drop(BancoProducao::abrir(&caminho).unwrap());
        Connection::open(&caminho)
            .unwrap()
            .execute(
                "UPDATE sa_info SET valor='99' WHERE chave='versao_esquema'",
                [],
            )
            .unwrap();
        assert!(BancoProducao::abrir(&caminho).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn campos_opcionais_do_pa_sao_somados_e_o_financiamento_separa_linhas() {
        let campos = [
            ("PA_CODUNI", 7),
            ("PA_MVM", 6),
            ("PA_PROC_ID", 10),
            ("PA_QTDAPR", 8),
            ("PA_VALAPR", 12),
            ("PA_TPFIN", 2),
            ("PA_QTDPRO", 8),
            ("PA_VALPRO", 12),
            ("PA_VL_INC", 12),
            ("PA_CNSMED", 15),
        ];
        let arq = dbf(
            &campos,
            &[
                l(&[
                    "2000001",
                    "202607",
                    "0301010072",
                    "10",
                    "10.00",
                    "06",
                    "12",
                    "12.00",
                    "0",
                    "898000000000001",
                ]),
                l(&[
                    "2000001",
                    "202607",
                    "0301010072",
                    "5",
                    "5.00",
                    "06",
                    "5",
                    "5.00",
                    "1.50",
                    "898000000000002",
                ]),
                l(&[
                    "2000001",
                    "202607",
                    "0301010072",
                    "2",
                    "2.00",
                    "04",
                    "2",
                    "2.00",
                    "0",
                    "898000000000003",
                ]),
            ],
        );
        let mut b = BancoProducao::em_memoria().unwrap();
        let m = Manifesto::carregar();
        let c = b
            .carregar(&m, "PA", &origem("PAMS2607a.dbc"), &arq)
            .unwrap();
        assert_eq!(
            c.gravadas, 2,
            "MAC (06) e FAEC (04) ficam em linhas separadas"
        );
        let linha = |fin: &str| -> (i64, i64, i64, i64, i64) {
            b.conexao()
                .query_row(
                    "SELECT qtd, valor_cent, qtd_pro, valor_pro_cent, valor_inc_cent FROM prod_amb WHERE fin = ?1",
                    [fin],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap()
        };
        assert_eq!(linha("06"), (15, 1500, 17, 1700, 150));
        assert_eq!(linha("04"), (2, 200, 2, 200, 0));
        let bytes = b
            .conexao()
            .query_row(
                "SELECT count(*) FROM prod_amb WHERE arq LIKE '%898%'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(bytes, 0);
    }

    #[test]
    fn arquivo_sem_os_campos_opcionais_grava_null_e_nao_zero() {
        // O mesmo PA dos outros testes, sem PA_TPFIN, PA_QTDPRO, PA_VALPRO e PA_VL_INC.
        let arq = dbf(
            &CAMPOS_PA,
            &[l(&[
                "2000001",
                "202607",
                "0301010072",
                "10",
                "37.36",
                "x",
                "34",
            ])],
        );
        let mut b = BancoProducao::em_memoria().unwrap();
        b.carregar(&Manifesto::carregar(), "PA", &origem("PAMS2607a.dbc"), &arq)
            .unwrap();
        let (fin, qpro, vpro, vinc): (String, Option<i64>, Option<i64>, Option<i64>) = b
            .conexao()
            .query_row(
                "SELECT fin, qtd_pro, valor_pro_cent, valor_inc_cent FROM prod_amb",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((fin.as_str(), qpro, vpro, vinc), ("", None, None, None));
    }

    #[test]
    fn rd_soma_dias_de_permanencia_e_uti() {
        let campos = [
            ("CNES", 7),
            ("ANO_CMPT", 4),
            ("MES_CMPT", 2),
            ("PROC_REA", 10),
            ("VAL_TOT", 12),
            ("FINANC", 2),
            ("DIAS_PERM", 5),
            ("UTI_MES_TO", 3),
            ("N_AIH", 13),
        ];
        let arq = dbf(
            &campos,
            &[
                l(&[
                    "2000001",
                    "2026",
                    "07",
                    "0407040064",
                    "100.00",
                    "06",
                    "4",
                    "0",
                    "5026000000011",
                ]),
                l(&[
                    "2000001",
                    "2026",
                    "07",
                    "0407040064",
                    "50.00",
                    "06",
                    "10",
                    "3",
                    "5026000000012",
                ]),
            ],
        );
        let mut b = BancoProducao::em_memoria().unwrap();
        b.carregar(&Manifesto::carregar(), "RD", &origem("RDMS2607.dbc"), &arq)
            .unwrap();
        let v: (i64, i64, i64, i64) = b
            .conexao()
            .query_row(
                "SELECT aih, valor_cent, dias, dias_uti FROM prod_hosp WHERE fin = '06'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(v, (2, 15000, 14, 3));
    }

    #[test]
    fn banco_da_versao_1_migra_sem_perder_nada_e_fica_com_null() {
        let dir = std::env::temp_dir().join(format!("sa_prod_mig_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let caminho = dir.join("MS.db");
        let _ = std::fs::remove_file(&caminho);
        {
            // Banco como o programa antigo o criava.
            let c = Connection::open(&caminho).unwrap();
            c.execute_batch(
                "CREATE TABLE sa_info(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
                 INSERT INTO sa_info VALUES('versao_esquema','1');
                 CREATE TABLE sa_arquivo(arquivo TEXT PRIMARY KEY, tipo TEXT NOT NULL, uf TEXT NOT NULL, sha256 TEXT NOT NULL,
                    bytes INTEGER NOT NULL, registros_lidos INTEGER NOT NULL, linhas_gravadas INTEGER NOT NULL,
                    confirmado INTEGER NOT NULL, carregado_em TEXT NOT NULL, competencias TEXT NOT NULL);
                 CREATE TABLE prod_amb(arq TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL,
                    qtd INTEGER NOT NULL, valor_cent INTEGER NOT NULL, PRIMARY KEY(arq, cnes, comp, proc));
                 CREATE INDEX i_prod_amb_proc ON prod_amb(proc, comp);
                 CREATE TABLE prod_hosp(arq TEXT NOT NULL, cnes TEXT NOT NULL, comp TEXT NOT NULL, proc TEXT NOT NULL,
                    aih INTEGER NOT NULL, valor_cent INTEGER NOT NULL, PRIMARY KEY(arq, cnes, comp, proc));
                 INSERT INTO prod_amb VALUES('PAMS2606a.dbc','2000001','202606','0301010072',7,700);
                 INSERT INTO prod_hosp VALUES('RDMS2606.dbc','2000001','202606','0407040064',3,9000);",
            )
            .unwrap();
        }
        let b = BancoProducao::abrir(&caminho).unwrap();
        let v: String = b
            .conexao()
            .query_row(
                "SELECT valor FROM sa_info WHERE chave='versao_esquema'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, VERSAO_ESQUEMA);
        let (qtd, cent, fin, qpro): (i64, i64, String, Option<i64>) = b
            .conexao()
            .query_row(
                "SELECT qtd, valor_cent, fin, qtd_pro FROM prod_amb",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((qtd, cent, fin.as_str(), qpro), (7, 700, "", None));
        let aih: i64 = b
            .conexao()
            .query_row("SELECT aih FROM prod_hosp", [], |r| r.get(0))
            .unwrap();
        assert_eq!(aih, 3);
        // Abrir de novo não migra outra vez nem falha.
        drop(b);
        BancoProducao::abrir(&caminho).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
