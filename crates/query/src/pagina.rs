//! Busca paginada: filtros, opções de filtro com contagem e uma página de `TAMANHO_DA_PAGINA`
//! procedimentos, calculadas sobre o catálogo em memória (sem consulta SQL por item).

use crate::busca::{Achados, Busca, ItemApoio, ItemProcedimento};
use crate::catalogo::{Catalogo, LinhaDoCatalogo};
use crate::{Consulta, ErroConsulta};
use sa_core::Competencia;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Procedimentos por página.
pub const TAMANHO_DA_PAGINA: usize = 100;

/// Filtros da busca; cada lista vazia não restringe.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Filtros {
    /// `"procedimento"` ou o nome da tabela de apoio (`tb_cid`...).
    pub tipo: Vec<String>,
    /// `tp_complexidade`.
    pub complexidade: Vec<String>,
    /// Nome do instrumento de registro.
    pub instrumento: Vec<String>,
    /// Grupo (2 primeiros dígitos do código).
    pub grupo: Vec<String>,
    /// Forma de organização (6 primeiros dígitos).
    pub forma: Vec<String>,
    /// Só estes códigos (favoritos); `None` = sem restrição.
    pub codigos: Option<Vec<String>>,
}

/// Uma opção de filtro e quantos resultados ela traz.
#[derive(Debug, Clone, Serialize)]
pub struct Faceta {
    pub valor: String,
    pub rotulo: Option<String>,
    pub n: usize,
}

/// Opções de filtro com contagem "disjuntiva": cada grupo conta os resultados que passam em
/// todos os outros filtros, ignorando a seleção do próprio grupo.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Facetas {
    pub tipo: Vec<Faceta>,
    pub complexidade: Vec<Faceta>,
    pub instrumento: Vec<Faceta>,
    pub grupo: Vec<Faceta>,
    pub forma: Vec<Faceta>,
}

/// Uma página da busca, com as opções de filtro.
#[derive(Debug, Clone, Serialize)]
pub struct BuscaPaginada {
    pub consulta: String,
    pub competencia: String,
    pub modo: &'static str,
    /// Procedimentos achados, sem filtro.
    pub total: usize,
    /// Procedimentos que passam nos filtros.
    pub total_filtrado: usize,
    /// Página atual (a partir de 1) e quantidade de páginas (pelo menos 1).
    pub pagina: usize,
    pub paginas: usize,
    pub procedimentos: Vec<ItemProcedimento>,
    pub apoio: Vec<ItemApoio>,
    pub facetas: Facetas,
}

/// O procedimento passa nos filtros de atributo (todos, ou todos menos o grupo `sem`)?
fn passa(l: &LinhaDoCatalogo, f: &Filtros, sem: &str, favoritos: Option<&BTreeSet<&str>>) -> bool {
    let em = |lista: &[String], v: &str| lista.is_empty() || lista.iter().any(|x| x == v);
    (sem == "complexidade" || em(&f.complexidade, &l.tp_complexidade))
        && (sem == "instrumento"
            || f.instrumento.is_empty()
            || l.instrumentos.iter().any(|i| f.instrumento.contains(i)))
        && (sem == "grupo" || em(&f.grupo, &l.codigo[..2]))
        && (sem == "forma" || em(&f.forma, &l.forma))
        && favoritos.is_none_or(|c| c.contains(l.codigo.as_str()))
}

/// Itens de apoio das tabelas escolhidas em `tipo` (todos, se `tipo` não restringe).
fn apoio_do_tipo(a: &Achados, f: &Filtros) -> Vec<ItemApoio> {
    a.apoio()
        .iter()
        .filter(|i| f.tipo.is_empty() || f.tipo.contains(&i.tabela))
        .cloned()
        .collect()
}

type Passam = Vec<(LinhaDoCatalogo, bool)>;

impl Consulta {
    /// Uma página (`TAMANHO_DA_PAGINA`) da busca, com filtros e a contagem das opções de filtro.
    /// `pagina` começa em 1 e é ajustada ao intervalo existente.
    pub fn buscar_pagina(
        &self,
        comp: Competencia,
        entrada: &str,
        f: &Filtros,
        pagina: usize,
    ) -> Result<BuscaPaginada, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let (a, cat, passam) = self.filtrar(seq, entrada, f)?;
        let facetas = facetas(&a, &cat, f);
        let total_filtrado = passam.len();
        let paginas = total_filtrado.div_ceil(TAMANHO_DA_PAGINA).max(1);
        let pagina = pagina.clamp(1, paginas);
        let procedimentos = passam
            .iter()
            .skip((pagina - 1) * TAMANHO_DA_PAGINA)
            .take(TAMANHO_DA_PAGINA)
            .map(|(l, na_descricao)| l.item(*na_descricao))
            .collect();
        Ok(BuscaPaginada {
            consulta: entrada.trim().to_string(),
            competencia: comp.to_string(),
            modo: a.modo(),
            total: a.procedimentos(),
            total_filtrado,
            pagina,
            paginas,
            procedimentos,
            apoio: apoio_do_tipo(&a, f),
            facetas,
        })
    }

    /// Todos os procedimentos que passam nos filtros (para exportar a lista inteira).
    pub fn buscar_filtrado_todos(
        &self,
        comp: Competencia,
        entrada: &str,
        f: &Filtros,
    ) -> Result<Busca, ErroConsulta> {
        let seq = self.exigir(comp)?;
        let (a, _, passam) = self.filtrar(seq, entrada, f)?;
        Ok(Busca {
            consulta: entrada.trim().to_string(),
            competencia: comp.to_string(),
            modo: a.modo(),
            total_procedimentos: passam.len(),
            procedimentos: passam
                .iter()
                .map(|(l, na_descricao)| l.item(*na_descricao))
                .collect(),
            apoio: apoio_do_tipo(&a, f),
        })
    }

    /// Os achados com o catálogo, já filtrados (na ordem da busca). Se `tipo` não inclui
    /// procedimentos, a lista sai vazia.
    fn filtrar(
        &self,
        seq: i64,
        entrada: &str,
        f: &Filtros,
    ) -> Result<(Arc<Achados>, Arc<Catalogo>, Passam), ErroConsulta> {
        let a = self.achados(seq, entrada)?;
        let cat = self.catalogo(seq)?;
        let quer_procedimentos = f.tipo.is_empty() || f.tipo.iter().any(|t| t == "procedimento");
        let favoritos = favoritos(f);
        let passam = if quer_procedimentos {
            a.codigos()
                .iter()
                .filter_map(|(c, nd)| cat.linha(c).map(|l| (l, *nd)))
                .filter(|(l, _)| passa(l, f, "", favoritos.as_ref()))
                .map(|(l, nd)| (l.clone(), nd))
                .collect()
        } else {
            Vec::new()
        };
        Ok((a, cat, passam))
    }
}

fn favoritos(f: &Filtros) -> Option<BTreeSet<&str>> {
    f.codigos
        .as_ref()
        .map(|c| c.iter().map(String::as_str).collect())
}

/// As opções de filtro. As contagens de procedimento ignoram `tipo` (assim se vê o que há ao
/// voltar a incluí-los).
fn facetas(a: &Achados, cat: &Catalogo, f: &Filtros) -> Facetas {
    let favoritos = favoritos(f);
    let linhas: Vec<&LinhaDoCatalogo> = a
        .codigos()
        .iter()
        .filter_map(|(c, _)| cat.linha(c))
        .collect();
    let contar = |sem: &str, chaves: &dyn Fn(&LinhaDoCatalogo) -> Vec<String>| {
        let mut n: BTreeMap<String, usize> = BTreeMap::new();
        for l in linhas
            .iter()
            .filter(|l| passa(l, f, sem, favoritos.as_ref()))
        {
            for k in chaves(l) {
                *n.entry(k).or_default() += 1;
            }
        }
        n
    };
    let montar = |n: BTreeMap<String, usize>, rotulo: &dyn Fn(&str) -> Option<String>| {
        n.into_iter()
            .map(|(valor, n)| Faceta {
                rotulo: rotulo(&valor),
                valor,
                n,
            })
            .collect::<Vec<_>>()
    };
    let nomes_de_complexidade: BTreeMap<&str, &str> = linhas
        .iter()
        .filter_map(|l| {
            l.complexidade
                .as_deref()
                .map(|c| (l.tp_complexidade.as_str(), c))
        })
        .collect();
    let complexidade = montar(
        contar("complexidade", &|l| vec![l.tp_complexidade.clone()]),
        &|v| nomes_de_complexidade.get(v).map(|s| s.to_string()),
    );
    let mut instrumento = montar(contar("instrumento", &|l| l.instrumentos.clone()), &|_| {
        None
    });
    // Instrumentos: os mais frequentes primeiro.
    instrumento.sort_by(|a, b| b.n.cmp(&a.n).then_with(|| a.valor.cmp(&b.valor)));
    let grupo = montar(
        contar("grupo", &|l| vec![l.codigo[..2].to_string()]),
        &|v| cat.grupos.get(v).cloned(),
    );
    let forma = montar(contar("forma", &|l| vec![l.forma.clone()]), &|v| {
        cat.formas.get(v).cloned()
    });
    let mut tipo = vec![Faceta {
        valor: "procedimento".into(),
        rotulo: Some("Procedimentos".into()),
        n: linhas
            .iter()
            .filter(|l| passa(l, f, "", favoritos.as_ref()))
            .count(),
    }];
    let mut por_tabela: BTreeMap<&str, usize> = BTreeMap::new();
    for i in a.apoio() {
        *por_tabela.entry(i.tabela.as_str()).or_default() += 1;
    }
    tipo.extend(por_tabela.into_iter().map(|(t, n)| Faceta {
        valor: t.to_string(),
        rotulo: None,
        n,
    }));
    Facetas {
        tipo,
        complexidade,
        instrumento,
        grupo,
        forma,
    }
}
