//! Referências entre tabelas do SIGTAP (manifesto `manifestos/sigtap_referencias.toml`):
//! qual tabela dá o nome de cada código.

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifesto {
    referencia: Vec<Referencia>,
}

/// Uma referência: as colunas de `de` apontam para a `chave` de `tabela`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Referencia {
    pub tabela: String,
    pub chave: Vec<String>,
    pub nomes: Vec<String>,
    pub de: Vec<Vec<String>>,
}

/// Todas as referências, validadas (identificadores seguros, grupos do tamanho da chave).
pub fn referencias() -> Vec<Referencia> {
    de_texto(include_str!("../../manifestos/sigtap_referencias.toml")).expect(
        "manifestos/sigtap_referencias.toml inválido: erro de programação, corrija o manifesto",
    )
}

/// Lê e valida um manifesto de referências.
pub fn de_texto(texto: &str) -> Result<Vec<Referencia>, String> {
    let m: Manifesto = toml::from_str(texto).map_err(|e| e.to_string())?;
    for r in &m.referencia {
        let ids = std::iter::once(&r.tabela)
            .chain(&r.chave)
            .chain(&r.nomes)
            .chain(r.de.iter().flatten());
        for i in ids {
            sa_core::safe_ident(i).map_err(|e| format!("{}: {e}", r.tabela))?;
            if *i != i.to_ascii_lowercase() {
                return Err(format!("{}: '{i}' deve estar em minúsculas", r.tabela));
            }
        }
        if r.chave.is_empty() || r.nomes.is_empty() || r.de.is_empty() {
            return Err(format!(
                "{}: chave, nomes e de não podem ser vazios",
                r.tabela
            ));
        }
        if let Some(g) = r.de.iter().find(|g| g.len() != r.chave.len()) {
            return Err(format!(
                "{}: grupo {g:?} tem tamanho diferente da chave {:?}",
                r.tabela, r.chave
            ));
        }
    }
    Ok(m.referencia)
}

/// Referências cuja origem é exatamente este grupo de colunas (ex.: `["co_cid"]`).
pub fn para_colunas<'a>(refs: &'a [Referencia], colunas: &[&str]) -> Vec<&'a Referencia> {
    refs.iter()
        .filter(|r| {
            r.de.iter()
                .any(|g| g.iter().map(String::as_str).eq(colunas.iter().copied()))
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn manifesto_embutido_e_valido() {
        let r = referencias();
        assert_eq!(r.len(), 23);
        let p = para_colunas(&r, &["co_procedimento_compativel"]);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].tabela, "tb_procedimento");
        assert_eq!(
            para_colunas(&r, &["co_servico", "co_classificacao"])[0].tabela,
            "tb_servico_classificacao"
        );
        assert_eq!(para_colunas(&r, &["co_detalhe"]).len(), 2);
    }

    #[test]
    fn grupo_de_tamanho_errado_e_recusado() {
        let t = "[[referencia]]\ntabela = \"tb_x\"\nchave = [\"a\", \"b\"]\nnomes = [\"n\"]\nde = [[\"a\"]]\n";
        assert!(de_texto(t).unwrap_err().contains("tamanho"));
        let t =
            "[[referencia]]\ntabela = \"tb_x\"\nchave = [\"a\"]\nnomes = [\"n\"]\nde = [[\"A\"]]\n";
        assert!(de_texto(t).unwrap_err().contains("minúsculas"));
    }
}
