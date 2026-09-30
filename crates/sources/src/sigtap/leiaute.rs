//! Leiaute de uma tabela do SIGTAP, lido do `<tabela>_layout.txt` do próprio ZIP.
//!
//! Formato oficial: cabeçalho `Coluna,Tamanho,Inicio,Fim,Tipo` e uma linha por coluna. O nome
//! da coluna é lido da direita para a esquerda (as quatro últimas partes são tamanho, início,
//! fim e tipo), porque em 201412–201503 um nome veio como expressão SQL com vírgulas.

use sa_core::{Ident, safe_ident};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::OnceLock;

use crate::latin1;

/// Tipo de coluna declarado no leiaute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Tipo {
    Varchar2,
    Char,
    Number,
    Date,
}

impl Tipo {
    fn de_texto(t: &str) -> Option<Self> {
        match t {
            "VARCHAR2" => Some(Tipo::Varchar2),
            "CHAR" => Some(Tipo::Char),
            "NUMBER" => Some(Tipo::Number),
            "DATE" => Some(Tipo::Date),
            _ => None,
        }
    }

    pub fn como_str(self) -> &'static str {
        match self {
            Tipo::Varchar2 => "VARCHAR2",
            Tipo::Char => "CHAR",
            Tipo::Number => "NUMBER",
            Tipo::Date => "DATE",
        }
    }

    /// Converte o nome guardado no banco de volta ao tipo.
    pub fn de_nome(t: &str) -> Option<Self> {
        Self::de_texto(t)
    }
}

/// Uma coluna do leiaute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coluna {
    /// Nome normalizado e validado (minúsculas).
    pub nome: Ident,
    /// Nome exatamente como veio no arquivo (para registro e reconstrução do leiaute).
    pub nome_origem: String,
    pub tamanho: usize,
    /// Posição inicial, contando de 1, como no arquivo oficial.
    pub inicio: usize,
    pub fim: usize,
    pub tipo: Tipo,
}

impl Coluna {
    /// Fatia do registro que corresponde à coluna.
    pub fn campo<'a>(&self, registro: &'a [u8]) -> &'a [u8] {
        &registro[self.inicio - 1..self.fim]
    }
}

/// Leiaute completo de uma tabela.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Leiaute {
    pub tabela: Ident,
    pub colunas: Vec<Coluna>,
    /// Largura do registro, sem o CRLF.
    pub largura: usize,
}

/// Erro de leiaute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErroLeiaute {
    pub arquivo: String,
    pub linha: usize,
    pub motivo: String,
}

impl fmt::Display for ErroLeiaute {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "leiaute {} inválido na linha {}: {}. O formato do DATASUS pode ter mudado; não é seguro carregar este ZIP sem revisar o leiaute",
            self.arquivo, self.linha, self.motivo
        )
    }
}

impl std::error::Error for ErroLeiaute {}

#[derive(Deserialize)]
struct Manifesto {
    colunas_normalizadas: BTreeMap<String, Normalizacao>,
}

#[derive(Deserialize)]
struct Normalizacao {
    nome: String,
    #[allow(dead_code)]
    visto_em: String,
    #[allow(dead_code)]
    observacao: String,
}

fn manifesto() -> &'static Manifesto {
    static M: OnceLock<Manifesto> = OnceLock::new();
    M.get_or_init(|| {
        toml::from_str(include_str!("../../manifestos/sigtap.toml"))
            .expect("manifestos/sigtap.toml inválido: erro de programação, corrija o manifesto")
    })
}

const CABECALHO: &str = "Coluna,Tamanho,Inicio,Fim,Tipo";

/// Interpreta um `<tabela>_layout.txt`.
pub fn ler_leiaute(tabela: &str, nome_arquivo: &str, bytes: &[u8]) -> Result<Leiaute, ErroLeiaute> {
    let erro = |linha: usize, motivo: String| ErroLeiaute {
        arquivo: nome_arquivo.to_string(),
        linha,
        motivo,
    };
    let tabela = safe_ident(tabela).map_err(|e| erro(0, e.to_string()))?;
    let texto = latin1::decodificar(bytes);
    let mut linhas = texto.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l));
    let cab = linhas.next().unwrap_or_default();
    if cab != CABECALHO {
        return Err(erro(
            1,
            format!("cabeçalho \"{cab}\" diferente de \"{CABECALHO}\""),
        ));
    }
    let mut colunas = Vec::new();
    let mut esperado_inicio = 1usize;
    for (i, l) in linhas.enumerate() {
        let n = i + 2;
        if l.trim().is_empty() {
            continue;
        }
        let partes: Vec<&str> = l.rsplitn(5, ',').collect();
        if partes.len() != 5 {
            return Err(erro(
                n,
                format!("esperadas 5 partes, vieram {}", partes.len()),
            ));
        }
        let (tipo_t, fim_t, ini_t, tam_t, nome_origem) =
            (partes[0], partes[1], partes[2], partes[3], partes[4]);
        let num = |t: &str, campo: &str| {
            t.trim()
                .parse::<usize>()
                .map_err(|_| erro(n, format!("{campo} \"{t}\" não é número")))
        };
        let (tamanho, inicio, fim) = (
            num(tam_t, "tamanho")?,
            num(ini_t, "início")?,
            num(fim_t, "fim")?,
        );
        let tipo = Tipo::de_texto(tipo_t.trim()).ok_or_else(|| {
            erro(
                n,
                format!("tipo \"{tipo_t}\" desconhecido (esperado VARCHAR2, CHAR, NUMBER ou DATE)"),
            )
        })?;
        if tamanho == 0 || fim + 1 != inicio + tamanho {
            return Err(erro(
                n,
                format!("tamanho {tamanho} não bate com início {inicio} e fim {fim}"),
            ));
        }
        if inicio != esperado_inicio {
            return Err(erro(
                n,
                format!(
                    "coluna começa em {inicio}, esperado {esperado_inicio} (leiaute não contíguo)"
                ),
            ));
        }
        esperado_inicio = fim + 1;
        let nome_efetivo = manifesto()
            .colunas_normalizadas
            .get(nome_origem)
            .map(|m| m.nome.as_str())
            .unwrap_or(nome_origem);
        let nome = safe_ident(nome_efetivo).map_err(|e| erro(n, e.to_string()))?;
        if colunas.iter().any(|c: &Coluna| c.nome == nome) {
            return Err(erro(n, format!("coluna {nome_efetivo} repetida")));
        }
        colunas.push(Coluna {
            nome,
            nome_origem: nome_origem.to_string(),
            tamanho,
            inicio,
            fim,
            tipo,
        });
    }
    if colunas.is_empty() {
        return Err(erro(2, "nenhuma coluna".into()));
    }
    Ok(Leiaute {
        tabela,
        largura: esperado_inicio - 1,
        colunas,
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    const REAL: &[u8] = b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nCO_PROCEDIMENTO,10,1,10,VARCHAR2\r\nCO_TIPO_LEITO,2,11,12,VARCHAR2\r\nDT_COMPETENCIA,6,13,18,DATE\r\n";

    #[test]
    fn le_leiaute_real() {
        let l = ler_leiaute(
            "rl_procedimento_leito",
            "rl_procedimento_leito_layout.txt",
            REAL,
        )
        .unwrap();
        assert_eq!(l.largura, 18);
        assert_eq!(l.colunas.len(), 3);
        assert_eq!(l.colunas[2].nome.como_str(), "dt_competencia");
        assert_eq!(l.colunas[2].tipo, Tipo::Date);
        assert_eq!(l.colunas[1].campo(b"0301010072AB202609"), b"AB");
    }

    #[test]
    fn normaliza_expressao_sql_do_manifesto() {
        let b = b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nCO_REGRA_CONDICIONADA,4,1,4,VARCHAR2\r\nNO_REGRA_CONDICIONADA,150,5,154,VARCHAR2\r\nREPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL),4000,155,4154,VARCHAR2\r\n";
        let l = ler_leiaute("tb_regra_condicionada", "x", b).unwrap();
        assert_eq!(l.colunas[2].nome.como_str(), "ds_regra_condicionada");
        assert_eq!(
            l.colunas[2].nome_origem,
            "REPLACE(DS_REGRA_CONDICIONADA,CHR(10),NULL)"
        );
        assert_eq!(l.largura, 4154);
    }

    #[test]
    fn recusa_leiaute_nao_contiguo_ou_estranho() {
        let casos: &[&[u8]] = &[
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nA,2,1,2,CHAR\r\nB,2,4,5,CHAR\r\n",
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nA,3,1,2,CHAR\r\n",
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nA,2,1,2,BLOB\r\n",
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nx\"; DROP TABLE t,2,1,2,CHAR\r\n",
            b"Col,Tam\r\nA,2,1,2,CHAR\r\n",
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\n",
            b"Coluna,Tamanho,Inicio,Fim,Tipo\r\nA,2,1,2,CHAR\r\nA,2,3,4,CHAR\r\n",
        ];
        for c in casos {
            let e = ler_leiaute("t", "t_layout.txt", c).unwrap_err();
            assert!(e.to_string().contains("não é seguro carregar"), "{e}");
        }
    }
}
