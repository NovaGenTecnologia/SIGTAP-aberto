//! Território: leitores das respostas oficiais do IBGE e do DEMAS (Ministério da Saúde).
//!
//! Estudo de 30/09/2026: IBGE `localidades/municipios?view=nivelado` = 5.571 municípios, 16
//! campos (micro e mesorregião ausentes em 1 município); DEMAS
//! `macrorregiao-e-regiao-de-saude/municipio` = 5.570 municípios, 11 campos, códigos como texto,
//! município com 6 dígitos. Os leitores são estritos: campo faltando ou de outro tipo = a fonte
//! mudou, e nada é gravado.

use serde::{Deserialize, Serialize};

/// Município como o IBGE publica (visão nivelada), com todos os campos.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MunicipioIbge {
    #[serde(rename = "municipio-id")]
    pub municipio_id: i64,
    #[serde(rename = "municipio-nome")]
    pub municipio_nome: String,
    #[serde(rename = "microrregiao-id")]
    pub microrregiao_id: Option<i64>,
    #[serde(rename = "microrregiao-nome")]
    pub microrregiao_nome: Option<String>,
    #[serde(rename = "mesorregiao-id")]
    pub mesorregiao_id: Option<i64>,
    #[serde(rename = "mesorregiao-nome")]
    pub mesorregiao_nome: Option<String>,
    #[serde(rename = "regiao-imediata-id")]
    pub regiao_imediata_id: i64,
    #[serde(rename = "regiao-imediata-nome")]
    pub regiao_imediata_nome: String,
    #[serde(rename = "regiao-intermediaria-id")]
    pub regiao_intermediaria_id: i64,
    #[serde(rename = "regiao-intermediaria-nome")]
    pub regiao_intermediaria_nome: String,
    #[serde(rename = "UF-id")]
    pub uf_id: i64,
    #[serde(rename = "UF-sigla")]
    pub uf_sigla: String,
    #[serde(rename = "UF-nome")]
    pub uf_nome: String,
    #[serde(rename = "regiao-id")]
    pub regiao_id: i64,
    #[serde(rename = "regiao-sigla")]
    pub regiao_sigla: String,
    #[serde(rename = "regiao-nome")]
    pub regiao_nome: String,
}

/// Município como o DEMAS publica (regiões de saúde e população), com todos os campos.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MunicipioSaude {
    pub codigo_regiao_pais: String,
    pub regiao_pais: String,
    pub codigo_uf: String,
    pub uf: String,
    pub codigo_macrorregiao_saude: String,
    pub macrorregiao_saude: String,
    pub codigo_regiao_saude: String,
    pub regiao_saude: String,
    pub codigo_municipio: String,
    pub municipio: String,
    pub populacao_estimada_ibge_2022: i64,
}

/// Erro de leitura de fonte de território.
#[derive(Debug)]
pub struct ErroTerritorio(pub String);

impl std::fmt::Display for ErroTerritorio {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}. A fonte pode ter mudado de formato; nada foi gravado e o território anterior continua valendo",
            self.0
        )
    }
}

impl std::error::Error for ErroTerritorio {}

/// Lê a resposta do IBGE (lista JSON). Confere código de 7 dígitos e ausência de repetição.
pub fn ler_ibge(json: &[u8]) -> Result<Vec<MunicipioIbge>, ErroTerritorio> {
    let v: Vec<MunicipioIbge> = serde_json::from_slice(json)
        .map_err(|e| ErroTerritorio(format!("resposta do IBGE fora do formato esperado ({e})")))?;
    let mut vistos = std::collections::BTreeSet::new();
    for m in &v {
        if !(1_000_000..10_000_000).contains(&m.municipio_id) {
            return Err(ErroTerritorio(format!(
                "IBGE: código de município com tamanho inesperado: {}",
                m.municipio_id
            )));
        }
        if !vistos.insert(m.municipio_id) {
            return Err(ErroTerritorio(format!(
                "IBGE: município repetido: {}",
                m.municipio_id
            )));
        }
    }
    if v.is_empty() {
        return Err(ErroTerritorio("IBGE: lista de municípios vazia".into()));
    }
    Ok(v)
}

/// Lê os itens do DEMAS (já juntados das páginas). Confere código de 6 dígitos.
pub fn ler_demas(itens: &[serde_json::Value]) -> Result<Vec<MunicipioSaude>, ErroTerritorio> {
    let mut v = Vec::with_capacity(itens.len());
    let mut vistos = std::collections::BTreeSet::new();
    for (i, x) in itens.iter().enumerate() {
        let m: MunicipioSaude = serde_json::from_value(x.clone()).map_err(|e| {
            ErroTerritorio(format!("DEMAS: item {i} fora do formato esperado ({e})"))
        })?;
        if m.codigo_municipio.len() != 6 || !m.codigo_municipio.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(ErroTerritorio(format!(
                "DEMAS: código de município inesperado: {}",
                m.codigo_municipio
            )));
        }
        if !vistos.insert(m.codigo_municipio.clone()) {
            return Err(ErroTerritorio(format!(
                "DEMAS: município repetido: {}",
                m.codigo_municipio
            )));
        }
        v.push(m);
    }
    if v.is_empty() {
        return Err(ErroTerritorio("DEMAS: lista de municípios vazia".into()));
    }
    Ok(v)
}

#[cfg(test)]
mod testes {
    use super::*;

    const IBGE: &str = r#"[{"municipio-id":5002704,"municipio-nome":"Campo Grande","microrregiao-id":null,"microrregiao-nome":null,"mesorregiao-id":5002,"mesorregiao-nome":"Centro Norte de Mato Grosso do Sul","regiao-imediata-id":500001,"regiao-imediata-nome":"Campo Grande","regiao-intermediaria-id":5001,"regiao-intermediaria-nome":"Campo Grande","UF-id":50,"UF-sigla":"MS","UF-nome":"Mato Grosso do Sul","regiao-id":5,"regiao-sigla":"CO","regiao-nome":"Centro-Oeste"}]"#;

    #[test]
    fn ibge_estrito() {
        let v = ler_ibge(IBGE.as_bytes()).unwrap();
        assert_eq!(v[0].municipio_id, 5002704);
        assert_eq!(v[0].microrregiao_id, None);
        let sem_campo = IBGE.replace(r#""UF-nome":"Mato Grosso do Sul","#, "");
        assert!(ler_ibge(sem_campo.as_bytes()).is_err());
        let campo_novo = IBGE.replace(r#""regiao-id":5"#, r#""regiao-id":5,"novo":1"#);
        assert!(ler_ibge(campo_novo.as_bytes()).is_err());
        let rep = format!("[{0},{0}]", &IBGE[1..IBGE.len() - 1]);
        assert!(ler_ibge(rep.as_bytes()).unwrap_err().0.contains("repetido"));
    }

    #[test]
    fn demas_estrito() {
        let item = serde_json::json!({"codigo_regiao_pais":"5","regiao_pais":"Centro-Oeste","codigo_uf":"50","uf":"Mato Grosso do Sul","codigo_macrorregiao_saude":"5001","macrorregiao_saude":"CONE SUL","codigo_regiao_saude":"50002","regiao_saude":"CENTRO SUL","codigo_municipio":"500270","municipio":"MS - CAMPO GRANDE","populacao_estimada_ibge_2022":898100});
        let v = ler_demas(std::slice::from_ref(&item)).unwrap();
        assert_eq!(v[0].populacao_estimada_ibge_2022, 898100);
        let mut ruim = item.clone();
        ruim["codigo_municipio"] = serde_json::json!("5002704");
        assert!(ler_demas(&[ruim]).is_err());
        let mut ruim = item.clone();
        ruim["populacao_estimada_ibge_2022"] = serde_json::json!("898100");
        assert!(ler_demas(&[ruim]).is_err());
    }
}
