//! CNES de disseminação: manifesto (o que carregar, privacidade, decodificadores, leitos) e
//! leitor das tabelas de conversão `.cnv` do TabWin.
//!
//! O esquema de cada arquivo vem do próprio `.dbc` ([`crate::dbf`]); o manifesto só diz quais
//! campos são chave, quais índices criar e o que não pode ser gravado.

use serde::Deserialize;
use std::collections::BTreeMap;

/// Um tipo de arquivo do CNES (ST, HB, SR, LT, EQ, PF).
#[derive(Debug, Clone, Deserialize)]
pub struct Tipo {
    pub codigo: String,
    pub nome: String,
    pub chave: Vec<String>,
    pub indices: Vec<Vec<String>>,
    #[serde(default)]
    pub so_cnes_escolhidos: bool,
}

/// Regra de privacidade: campos que não são gravados (sempre, ou quando outro campo tem um valor).
#[derive(Debug, Clone, Deserialize)]
pub struct Privacidade {
    pub tipos: Vec<String>,
    pub campos: Vec<String>,
    #[serde(default)]
    pub sempre: bool,
    pub quando_campo: Option<String>,
    pub quando_valor: Option<String>,
    pub motivo: String,
}

/// Campo (ou par de campos) decodificado por um arquivo `.cnv`.
#[derive(Debug, Clone, Deserialize)]
pub struct Decodificador {
    pub campos: Vec<String>,
    pub arquivo: String,
    pub fonte: String,
    /// Primeira competência (AAAAMM) em que a tabela vale; sem valor = desde sempre.
    pub desde: Option<String>,
}

impl Decodificador {
    /// A tabela vale para essa competência (AAAAMM)?
    pub fn vale_em(&self, competencia: &str) -> bool {
        self.desde.as_deref().is_none_or(|d| competencia >= d)
    }

    /// Nome do campo no banco: os campos juntos por `+`.
    pub fn chave(&self) -> String {
        self.campos.join("+")
    }
}

/// Correspondência (não confirmada) entre tipo de leito do SIGTAP e leito do CNES.
#[derive(Debug, Clone, Deserialize)]
pub struct Leito {
    pub sigtap: String,
    #[serde(default)]
    pub tp_leito: Vec<String>,
    #[serde(default)]
    pub codleito: Vec<String>,
    pub base: String,
}

/// O manifesto inteiro.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifesto {
    pub origem: String,
    #[serde(rename = "tipo")]
    pub tipos: Vec<Tipo>,
    #[serde(rename = "privacidade")]
    pub privacidade: Vec<Privacidade>,
    #[serde(rename = "decodificador")]
    pub decodificadores: Vec<Decodificador>,
    #[serde(rename = "leito")]
    pub leitos: Vec<Leito>,
}

impl Manifesto {
    /// O manifesto embutido no programa.
    pub fn carregar() -> Self {
        Self::de_texto(include_str!("../manifestos/cnes.toml"))
            .expect("manifesto cnes.toml embutido tem de ser válido (há teste)")
    }

    /// Lê e valida um manifesto.
    pub fn de_texto(texto: &str) -> Result<Self, String> {
        let m: Self =
            toml::from_str(texto).map_err(|e| format!("manifesto do CNES inválido: {e}"))?;
        for t in &m.tipos {
            if t.codigo.len() != 2 || !t.codigo.bytes().all(|b| b.is_ascii_uppercase()) {
                return Err(format!(
                    "tipo \"{}\": o código tem de ser duas letras",
                    t.codigo
                ));
            }
            if !t.chave.iter().any(|c| c == "CNES") {
                return Err(format!("tipo {}: a chave tem de incluir CNES", t.codigo));
            }
        }
        for p in &m.privacidade {
            if p.sempre == (p.quando_campo.is_some() || p.quando_valor.is_some())
                || p.quando_campo.is_some() != p.quando_valor.is_some()
            {
                return Err(format!(
                    "privacidade de {:?}: use `sempre = true` ou o par quando_campo/quando_valor",
                    p.campos
                ));
            }
        }
        for d in &m.decodificadores {
            if d.campos.is_empty() || d.campos.len() > 2 {
                return Err(format!("decodificador {}: um ou dois campos", d.arquivo));
            }
        }
        for l in &m.leitos {
            if l.tp_leito.is_empty() == l.codleito.is_empty() {
                return Err(format!("leito {}: informe tp_leito ou codleito", l.sigtap));
            }
        }
        Ok(m)
    }

    /// O tipo com esse código (maiúsculas e minúsculas indiferentes).
    pub fn tipo(&self, codigo: &str) -> Option<&Tipo> {
        self.tipos
            .iter()
            .find(|t| t.codigo.eq_ignore_ascii_case(codigo))
    }

    /// As regras de privacidade que valem para um tipo ("ST"... ou "CAD").
    pub fn privacidade_de(&self, tipo: &str) -> Vec<&Privacidade> {
        self.privacidade
            .iter()
            .filter(|p| p.tipos.iter().any(|t| t.eq_ignore_ascii_case(tipo)))
            .collect()
    }
}

/// Lê uma tabela `.cnv` do TabWin: código -> descrição.
///
/// Formato (medido nos arquivos de TAB_CNES.zip): a primeira linha é o cabeçalho; nas demais, um
/// ou dois números de ordem, a descrição e, no fim, os códigos separados por vírgula. Faixas
/// (`1000-1999`) e códigos "curinga" (começados por `-`) são ignorados: servem só para agrupar
/// no TabWin. O texto já vem decodificado (ISO-8859-1).
pub fn ler_cnv(texto: &str) -> BTreeMap<String, String> {
    let mut mapa = BTreeMap::new();
    for linha in texto.lines().skip(1) {
        let linha = linha.trim_end();
        if linha.trim().is_empty() || linha.trim_start().starts_with(';') {
            continue;
        }
        let Some(corte) = linha.rfind(|c: char| c.is_whitespace()) else {
            continue;
        };
        let (antes, codigos) = (linha[..corte].trim(), linha[corte..].trim());
        // Tira os números de ordem do começo (um ou dois).
        let mut resto = antes;
        for _ in 0..2 {
            let t = resto.trim_start();
            let fim = t.find(|c: char| !c.is_ascii_digit()).unwrap_or(t.len());
            if fim == 0 || !t[fim..].starts_with(char::is_whitespace) {
                break;
            }
            resto = &t[fim..];
        }
        let descricao = resto.trim();
        if descricao.is_empty() {
            continue;
        }
        for codigo in codigos.split(',').map(str::trim).filter(|c| !c.is_empty()) {
            if codigo.starts_with('-') || codigo.contains('-') {
                continue;
            }
            mapa.entry(codigo.to_string())
                .or_insert_with(|| descricao.to_string());
        }
    }
    mapa
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn manifesto_embutido_e_valido() {
        let m = Manifesto::carregar();
        let codigos: Vec<&str> = m.tipos.iter().map(|t| t.codigo.as_str()).collect();
        assert_eq!(codigos, ["ST", "HB", "SR", "LT", "EQ", "PF"]);
        assert!(m.tipo("pf").unwrap().so_cnes_escolhidos);
        assert!(!m.tipo("ST").unwrap().so_cnes_escolhidos);
        // O que a fase promete: nenhum CPF de pessoa física, nenhum identificador de profissional.
        let pf = m.privacidade_de("PF");
        assert!(
            pf.iter()
                .any(|p| p.sempre && p.campos.contains(&"CPF_PROF".to_string()))
        );
        assert!(
            m.privacidade_de("ST")
                .iter()
                .any(|p| p.campos.contains(&"CPF_CNPJ".to_string()))
        );
        assert_eq!(m.leitos.len(), 14);
    }

    #[test]
    fn manifesto_com_erro_e_recusado() {
        let base = include_str!("../manifestos/cnes.toml");
        assert!(Manifesto::de_texto(&base.replace("codigo = \"ST\"", "codigo = \"S1\"")).is_err());
        assert!(Manifesto::de_texto(&base.replace("sempre = true", "sempre = false")).is_err());
        assert!(Manifesto::de_texto("origem = 1").is_err());
    }

    #[test]
    fn le_cnv_com_um_ou_dois_numeros_de_ordem_e_listas() {
        let simples = "5 1 L\n      5  NÃO INFORMADO                 -Z\n      1  DUPLA                         D\n      4  SEM GESTÃO                    Z,S\n";
        let m = ler_cnv(simples);
        assert_eq!(m.get("D").map(String::as_str), Some("DUPLA"));
        assert_eq!(m.get("S").map(String::as_str), Some("SEM GESTÃO"));
        assert_eq!(m.get("Z").map(String::as_str), Some("SEM GESTÃO"));
        assert!(!m.contains_key("-Z"));
        let dupla = "N 90 4\n       01  1. Administração Pública          1000-1999,\n   01  02  101-5 Órgão Público Federal       1015\n";
        let m = ler_cnv(dupla);
        assert_eq!(
            m.get("1015").map(String::as_str),
            Some("101-5 Órgão Público Federal")
        );
        assert_eq!(m.len(), 1);
    }
}
