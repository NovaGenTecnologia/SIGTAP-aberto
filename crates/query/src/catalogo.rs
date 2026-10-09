//! Catálogo dos procedimentos vigentes numa competência, em memória: a busca filtra, conta e
//! pagina sobre ele sem uma consulta SQL por procedimento.

use crate::busca::ItemProcedimento;
use crate::util::{self, ident, ident_vig, mascarar, texto};
use crate::{Consulta, ErroConsulta};
use rusqlite::types::Value;
use sa_sources::sigtap::dominios::Descricao;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Um procedimento vigente com tudo o que a lista da busca mostra.
#[derive(Debug, Clone)]
pub struct LinhaDoCatalogo {
    pub codigo: String,
    pub nome: String,
    pub tp_complexidade: String,
    pub complexidade: Option<String>,
    pub valor_total_centavos: i64,
    pub instrumentos: Vec<String>,
    /// Forma de organização (6 dígitos) e seu nome.
    pub forma: String,
    pub forma_nome: Option<String>,
}

impl LinhaDoCatalogo {
    pub fn item(&self, na_descricao: bool) -> ItemProcedimento {
        ItemProcedimento {
            codigo: self.codigo.clone(),
            codigo_mascarado: mascarar(&self.codigo),
            nome: self.nome.clone(),
            tp_complexidade: self.tp_complexidade.clone(),
            complexidade: self.complexidade.clone(),
            valor_total_centavos: self.valor_total_centavos,
            instrumentos: self.instrumentos.clone(),
            forma: self.forma.clone(),
            forma_nome: self.forma_nome.clone(),
            na_descricao,
        }
    }
}

/// Procedimentos vigentes (em ordem de código) e os nomes de grupos e formas da competência.
#[derive(Debug, Default)]
pub struct Catalogo {
    pub linhas: Vec<LinhaDoCatalogo>,
    /// Grupo (2 dígitos) → nome.
    pub grupos: BTreeMap<String, String>,
    /// Forma (6 dígitos) → nome.
    pub formas: BTreeMap<String, String>,
}

impl Catalogo {
    pub fn linha(&self, codigo: &str) -> Option<&LinhaDoCatalogo> {
        self.linhas
            .binary_search_by(|l| l.codigo.as_str().cmp(codigo))
            .ok()
            .map(|i| &self.linhas[i])
    }
}

impl Consulta {
    /// O catálogo da competência: montado uma vez e guardado (some quando o índice é refeito).
    pub(crate) fn catalogo(&self, seq: i64) -> Result<Arc<Catalogo>, ErroConsulta> {
        if let Some(c) = self.catalogos.lock().expect("catálogos").get(&seq) {
            return Ok(Arc::clone(c));
        }
        let novo = Arc::new(self.montar_catalogo(seq)?);
        self.catalogos
            .lock()
            .expect("catálogos")
            .insert(seq, Arc::clone(&novo));
        Ok(novo)
    }

    fn montar_catalogo(&self, seq: i64) -> Result<Catalogo, ErroConsulta> {
        let t = ident("tb_procedimento")?;
        let v = ident_vig("tb_procedimento")?;
        let mut st = self.conn().prepare(&format!(
            "SELECT c.co_procedimento, c.no_procedimento, c.tp_complexidade, c.vl_sh, c.vl_sa, c.vl_sp
             FROM {t} c JOIN {v} v ON v.sa_id = c.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 ORDER BY c.co_procedimento"
        ))?;
        let num = |x: &Value| if let Value::Integer(n) = x { *n } else { 0 };
        let mut linhas: Vec<LinhaDoCatalogo> = Vec::new();
        let mut r = st.query([seq])?;
        while let Some(x) = r.next()? {
            let codigo = texto(&x.get::<_, Value>(0)?);
            // Um procedimento por código (a primeira linha vigente, como `item_procedimento`).
            if linhas.last().is_some_and(|l| l.codigo == codigo) || codigo.len() != 10 {
                continue;
            }
            let tp = texto(&x.get::<_, Value>(2)?);
            let complexidade =
                match self
                    .dominios
                    .descrever("tb_procedimento", "tp_complexidade", &tp)
                {
                    Some(Descricao::Oficial(s)) => Some(s.to_string()),
                    _ => None,
                };
            linhas.push(LinhaDoCatalogo {
                forma: codigo[..6].to_string(),
                forma_nome: None,
                nome: texto(&x.get::<_, Value>(1)?),
                tp_complexidade: tp,
                complexidade,
                valor_total_centavos: num(&x.get::<_, Value>(3)?)
                    + num(&x.get::<_, Value>(4)?)
                    + num(&x.get::<_, Value>(5)?),
                instrumentos: Vec::new(),
                codigo,
            });
        }
        drop(r);
        drop(st);

        // Instrumentos de registro, na ordem do código de registro (como `item_procedimento`).
        let mut st = self.conn().prepare(
            "SELECT c.co_procedimento, n.no_registro FROM rl_procedimento_registro c
             JOIN rl_procedimento_registro__vig v ON v.sa_id = c.sa_id
             JOIN tb_registro n ON n.co_registro = c.co_registro
             JOIN tb_registro__vig w ON w.sa_id = n.sa_id
             WHERE v.vig_ini <= ?1 AND v.vig_fim >= ?1 AND w.vig_ini <= ?1 AND w.vig_fim >= ?1
             ORDER BY c.co_procedimento, c.co_registro",
        )?;
        let mut por_codigo: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut r = st.query([seq])?;
        while let Some(x) = r.next()? {
            let (cod, nome): (String, String) = (x.get(0)?, x.get(1)?);
            let lista = por_codigo.entry(cod).or_default();
            if !lista.contains(&nome) {
                lista.push(nome);
            }
        }
        drop(r);
        drop(st);
        for l in &mut linhas {
            if let Some(i) = por_codigo.remove(&l.codigo) {
                l.instrumentos = i;
            }
        }

        // Nomes de grupos e formas: um código de cada forma basta para ler a cadeia.
        let presentes: BTreeSet<String> = util::tabelas(self.conn(), seq)?.into_iter().collect();
        let mut grupos = BTreeMap::new();
        let mut formas = BTreeMap::new();
        for forma in linhas
            .iter()
            .map(|l| l.forma.clone())
            .collect::<BTreeSet<_>>()
        {
            for n in self.estrutura(seq, &presentes, &forma)? {
                if let Some(nome) = n.nome {
                    match n.nivel {
                        "grupo" => {
                            grupos.entry(n.codigo).or_insert(nome);
                        }
                        "forma" => {
                            formas.insert(n.codigo, nome);
                        }
                        _ => {}
                    }
                }
            }
        }
        for l in &mut linhas {
            l.forma_nome = formas.get(&l.forma).cloned();
        }
        Ok(Catalogo {
            linhas,
            grupos,
            formas,
        })
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use sa_core::Competencia;
    use std::path::PathBuf;

    /// Banco de teste (cópia do banco completo, como nos testes de integração); sem a variável, o teste não roda.
    fn banco() -> Option<PathBuf> {
        std::env::var("SA_SIGTAP_BANCO_CONSULTA")
            .ok()
            .map(PathBuf::from)
    }

    #[test]
    fn catalogo_bate_com_item_procedimento() {
        let Some(p) = banco() else { return };
        let q = Consulta::abrir(&p).unwrap();
        let seq = Competencia::de_texto("202609").unwrap().seq();
        let cat = q.catalogo(seq).unwrap();
        assert!(
            cat.linhas.len() > 1000,
            "catálogo com {} linhas",
            cat.linhas.len()
        );
        assert!(cat.linhas.windows(2).all(|w| w[0].codigo < w[1].codigo));
        for l in cat.linhas.iter().step_by(37) {
            let i = q.item_procedimento(seq, &l.codigo).unwrap().unwrap();
            assert_eq!(l.nome, i.nome, "{}", l.codigo);
            assert_eq!(
                l.valor_total_centavos, i.valor_total_centavos,
                "{}",
                l.codigo
            );
            assert_eq!(l.instrumentos, i.instrumentos, "{}", l.codigo);
            assert_eq!(l.complexidade, i.complexidade, "{}", l.codigo);
            assert_eq!(l.tp_complexidade, i.tp_complexidade, "{}", l.codigo);
            assert_eq!(l.forma, i.forma, "{}", l.codigo);
            assert_eq!(l.forma_nome, i.forma_nome, "{}", l.codigo);
        }
        assert!(cat.grupos.contains_key("03"));
        assert!(cat.linha("0301010072").is_some());
    }

    #[test]
    #[ignore = "mede o tempo; rode com --ignored --nocapture"]
    fn catalogo_tempo() {
        let Some(p) = banco() else { return };
        let q = Consulta::abrir(&p).unwrap();
        let seq = Competencia::de_texto("202609").unwrap().seq();
        let t = std::time::Instant::now();
        q.catalogo(seq).unwrap();
        let frio = t.elapsed();
        let t = std::time::Instant::now();
        q.catalogo(seq).unwrap();
        eprintln!("PROVA catálogo: frio {frio:?}, quente {:?}", t.elapsed());
    }
}
