//! Domínios, sentinelas e unidades das colunas codificadas do SIGTAP que não têm tabela
//! própria (manifesto `manifestos/sigtap_dominios.toml`, copiado do `Lay-out.xls` oficial).
//!
//! Regra: o programa nunca inventa nome para código. Um código descrito na fonte vira
//! [`Descricao::Oficial`]; um código observado nos dados mas não descrito na fonte vira
//! [`Descricao::SemDescricao`] com a nota do manifesto; qualquer outro vira
//! [`Descricao::Desconhecido`] (e o teste com o banco completo falha).

use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifesto {
    origem: String,
    dominio: Vec<DominioBruto>,
    sentinela: Vec<SentinelaBruta>,
    unidade: Vec<UnidadeBruta>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DominioBruto {
    colunas: Vec<String>,
    valores: BTreeMap<String, String>,
    #[serde(default)]
    sem_descricao: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SentinelaBruta {
    colunas: Vec<String>,
    valor: i64,
    significado: String,
    #[serde(default)]
    inferido: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UnidadeBruta {
    colunas: Vec<String>,
    unidade: String,
    fonte: String,
}

/// Como exibir um código.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Descricao<'a> {
    /// Texto da fonte oficial.
    Oficial(&'a str),
    /// Código presente nos dados que a fonte não descreve; a nota diz onde aparece.
    SemDescricao(&'a str),
    /// A coluna tem domínio no manifesto, mas o código nunca foi visto: tratar como alerta.
    Desconhecido,
}

/// Unidade de uma coluna numérica.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unidade {
    /// Valor em centavos (duas casas decimais implícitas).
    Centavos,
    /// Percentual com duas casas decimais implícitas (2000 = 20,00%).
    CentesimosDePercentual,
    /// Idade em meses.
    Meses,
}

/// Valor especial de uma coluna numérica.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sentinela {
    pub valor: i64,
    pub significado: String,
    /// `true` quando o significado é inferido (a fonte oficial não documenta a coluna).
    pub inferido: bool,
}

/// Valores descritos e códigos sem descrição de uma coluna.
type ParDominio = (BTreeMap<String, String>, BTreeMap<String, String>);

/// Domínios carregados do manifesto. Chaves de coluna no formato `tabela.coluna`, minúsculas.
#[derive(Debug)]
pub struct Dominios {
    pub origem: String,
    dominios: BTreeMap<String, ParDominio>,
    sentinelas: BTreeMap<String, Sentinela>,
    unidades: BTreeMap<String, (Unidade, String)>,
}

fn chave(tabela: &str, coluna: &str) -> String {
    format!(
        "{}.{}",
        tabela.to_ascii_lowercase(),
        coluna.to_ascii_lowercase()
    )
}

impl Dominios {
    /// Carrega o manifesto embutido no programa.
    pub fn carregar() -> Dominios {
        Self::de_texto(include_str!("../../manifestos/sigtap_dominios.toml")).expect(
            "manifestos/sigtap_dominios.toml inválido: erro de programação, corrija o manifesto",
        )
    }

    /// Lê um manifesto (usado pelo carregador e pelos testes).
    pub fn de_texto(texto: &str) -> Result<Dominios, String> {
        let m: Manifesto = toml::from_str(texto).map_err(|e| e.to_string())?;
        let validar = |c: &str| -> Result<(), String> {
            let (t, col) = c
                .split_once('.')
                .ok_or_else(|| format!("coluna '{c}' sem o formato tabela.coluna"))?;
            sa_core::safe_ident(t).map_err(|e| e.to_string())?;
            sa_core::safe_ident(col).map_err(|e| e.to_string())?;
            if c != c.to_ascii_lowercase() {
                return Err(format!("coluna '{c}' deve estar em minúsculas"));
            }
            Ok(())
        };
        let mut d = Dominios {
            origem: m.origem,
            dominios: BTreeMap::new(),
            sentinelas: BTreeMap::new(),
            unidades: BTreeMap::new(),
        };
        for x in m.dominio {
            if let Some(k) = x.sem_descricao.keys().find(|k| x.valores.contains_key(*k)) {
                return Err(format!("código '{k}' está em valores e em sem_descricao"));
            }
            for c in x.colunas {
                validar(&c)?;
                let par = (x.valores.clone(), x.sem_descricao.clone());
                if d.dominios.insert(c.clone(), par).is_some() {
                    return Err(format!("coluna '{c}' repetida em [[dominio]]"));
                }
            }
        }
        for x in m.sentinela {
            for c in x.colunas {
                validar(&c)?;
                let s = Sentinela {
                    valor: x.valor,
                    significado: x.significado.clone(),
                    inferido: x.inferido,
                };
                if d.sentinelas.insert(c.clone(), s).is_some() {
                    return Err(format!("coluna '{c}' repetida em [[sentinela]]"));
                }
            }
        }
        for x in m.unidade {
            let u = match x.unidade.as_str() {
                "centavos" => Unidade::Centavos,
                "centesimos_de_percentual" => Unidade::CentesimosDePercentual,
                "meses" => Unidade::Meses,
                outra => return Err(format!("unidade desconhecida '{outra}'")),
            };
            for c in x.colunas {
                validar(&c)?;
                if d.unidades.insert(c.clone(), (u, x.fonte.clone())).is_some() {
                    return Err(format!("coluna '{c}' repetida em [[unidade]]"));
                }
            }
        }
        Ok(d)
    }

    /// Colunas com domínio, no formato `tabela.coluna`.
    pub fn colunas_com_dominio(&self) -> impl Iterator<Item = &str> {
        self.dominios.keys().map(String::as_str)
    }

    /// Descrição de um código; `None` se a coluna não tem domínio no manifesto.
    pub fn descrever(&self, tabela: &str, coluna: &str, codigo: &str) -> Option<Descricao<'_>> {
        let (valores, sem) = self.dominios.get(&chave(tabela, coluna))?;
        Some(if let Some(v) = valores.get(codigo) {
            Descricao::Oficial(v)
        } else if let Some(n) = sem.get(codigo) {
            Descricao::SemDescricao(n)
        } else {
            Descricao::Desconhecido
        })
    }

    /// Sentinela da coluna, se houver.
    pub fn sentinela(&self, tabela: &str, coluna: &str) -> Option<&Sentinela> {
        self.sentinelas.get(&chave(tabela, coluna))
    }

    /// Unidade da coluna, se houver.
    pub fn unidade(&self, tabela: &str, coluna: &str) -> Option<Unidade> {
        self.unidades.get(&chave(tabela, coluna)).map(|u| u.0)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn manifesto_embutido_e_valido() {
        let d = Dominios::carregar();
        assert_eq!(
            d.descrever("tb_procedimento", "tp_complexidade", "3"),
            Some(Descricao::Oficial("Alta Complexidade"))
        );
        assert_eq!(
            d.descrever("TB_PROCEDIMENTO", "TP_SEXO", "I"),
            Some(Descricao::Oficial("Indiferente/Ambos"))
        );
        assert!(matches!(
            d.descrever("rl_procedimento_compativel", "tp_compatibilidade", "5"),
            Some(Descricao::SemDescricao(_))
        ));
        assert_eq!(
            d.descrever("tb_procedimento", "tp_complexidade", "7"),
            Some(Descricao::Desconhecido)
        );
        assert_eq!(
            d.descrever("tb_procedimento", "co_financiamento", "06"),
            None
        );
        let s = d.sentinela("tb_procedimento", "vl_idade_maxima").unwrap();
        assert_eq!((s.valor, s.inferido), (9999, false));
        assert!(
            d.sentinela("tb_procedimento", "qt_tempo_permanencia")
                .unwrap()
                .inferido
        );
        assert_eq!(
            d.unidade("tb_procedimento", "vl_sp"),
            Some(Unidade::Centavos)
        );
        assert_eq!(
            d.unidade("tb_procedimento", "vl_idade_minima"),
            Some(Unidade::Meses)
        );
        assert_eq!(d.colunas_com_dominio().count(), 10);
    }

    #[test]
    fn manifesto_com_erro_e_recusado() {
        let base = "origem = \"x\"\nsentinela = []\nunidade = []\n";
        let rep = format!(
            "{base}[[dominio]]\ncolunas = [\"t.c\"]\nvalores = {{ \"1\" = \"a\" }}\nsem_descricao = {{ \"1\" = \"b\" }}\n"
        );
        assert!(
            Dominios::de_texto(&rep)
                .unwrap_err()
                .contains("sem_descricao")
        );
        let mai = format!("{base}[[dominio]]\ncolunas = [\"T.c\"]\nvalores = {{}}\n");
        assert!(Dominios::de_texto(&mai).is_err());
        let sem_ponto = format!("{base}[[dominio]]\ncolunas = [\"tc\"]\nvalores = {{}}\n");
        assert!(
            Dominios::de_texto(&sem_ponto)
                .unwrap_err()
                .contains("tabela.coluna")
        );
        let campo = format!("{base}[[dominio]]\ncolunas = [\"t.c\"]\nvalores = {{}}\nextra = 1\n");
        assert!(Dominios::de_texto(&campo).is_err());
    }
}
