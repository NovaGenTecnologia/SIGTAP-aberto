//! Produção do SUS (SIA e SIH): manifesto dos arquivos `PA`, `RD` e `ER`.
//!
//! O esquema de cada arquivo vem do próprio `.dbc` ([`crate::dbf`]); o manifesto só diz quais campos
//! são somados e quais campos pessoais existem e nunca são gravados. Os nomes ainda não foram
//! conferidos com arquivo real (`confirmado = false`): ver `manifestos/producao.toml`.

use serde::Deserialize;

/// Um tipo de arquivo de produção.
#[derive(Debug, Clone, Deserialize)]
pub struct Tipo {
    pub codigo: String,
    pub nome: String,
    /// Pasta no FTP (`ftp.datasus.gov.br`).
    pub pasta: String,
    /// Os nomes de campo foram conferidos com um arquivo real?
    pub confirmado: bool,
    pub cnes: String,
    /// Um campo AAAAMM, ou dois (ano e mês).
    pub competencia: Vec<String>,
    pub procedimento: Option<String>,
    pub quantidade: Option<String>,
    #[serde(default)]
    pub contar_registros: bool,
    pub valor: Option<String>,
    pub motivo: Option<String>,
    /// Campos **opcionais** (esquema 2 do banco): se o arquivo os tem, a carga soma; se não, a coluna
    /// fica vazia (NULL) e a tela diz que falta. Nenhum é pessoal.
    /// Financiamento (`PA_TPFIN`, `FINANC`): parte da chave dos totais.
    pub financiamento: Option<String>,
    /// SIA: quantidade apresentada (antes da crítica).
    pub quantidade_apresentada: Option<String>,
    /// SIA: valor apresentado.
    pub valor_apresentado: Option<String>,
    /// SIA: valor de incremento dentro do valor aprovado.
    pub valor_incremento: Option<String>,
    /// SIH: dias de permanência.
    pub dias: Option<String>,
    /// SIH: dias de UTI.
    pub dias_uti: Option<String>,
    /// Esquema 3: campos **categóricos** (indicador, código de ocorrência, instrumento de registro...)
    /// cujo total (quantidade e valor) é guardado por estabelecimento, competência e valor do campo.
    /// Opcionais como os acima; nenhum é pessoal.
    #[serde(default)]
    pub dimensoes: Vec<String>,
    /// Esquema 3: campos de **valor** cuja soma é guardada por estabelecimento e competência
    /// (composição do valor: SH, SP, federal, gestor, UTI).
    #[serde(default)]
    pub somas: Vec<String>,
    /// Esquema 3: campos categóricos cujo total é guardado **por procedimento, para a UF inteira** (`prod_uf_dim`,
    /// sem o estabelecimento): instrumento de registro (`PA_DOCORIG`, para achar procedimento produzido em
    /// instrumento que o SIGTAP não lista) e regra contratual (`PA_REGCT`, para a parte da produção de um
    /// procedimento que sai de unidade sem geração de crédito).
    #[serde(default)]
    pub dimensoes_uf: Vec<String>,
    /// Campos pessoais do arquivo: presentes, nunca gravados.
    pub pessoais: Vec<String>,
}

impl Tipo {
    /// Campos que o arquivo precisa ter (os que a carga lê).
    pub fn campos_lidos(&self) -> Vec<&str> {
        let mut v: Vec<&str> = vec![self.cnes.as_str()];
        v.extend(self.competencia.iter().map(String::as_str));
        for c in [
            &self.procedimento,
            &self.quantidade,
            &self.valor,
            &self.motivo,
        ]
        .into_iter()
        .flatten()
        {
            v.push(c.as_str());
        }
        v
    }
}

impl Tipo {
    /// Campos opcionais que o manifesto declara (a carga os usa se o arquivo os tiver).
    pub fn campos_opcionais(&self) -> Vec<&str> {
        [
            &self.financiamento,
            &self.quantidade_apresentada,
            &self.valor_apresentado,
            &self.valor_incremento,
            &self.dias,
            &self.dias_uti,
        ]
        .into_iter()
        .flatten()
        .map(String::as_str)
        .chain(self.dimensoes.iter().map(String::as_str))
        .chain(self.dimensoes_uf.iter().map(String::as_str))
        .chain(self.somas.iter().map(String::as_str))
        .collect()
    }
}

/// Onde está a tabela de motivos de rejeição (MOTERRO) e como ler.
#[derive(Debug, Clone, Deserialize)]
pub struct Moterro {
    /// Caminho do `TAB_SIH.zip` no FTP.
    pub zip: String,
    /// Nome da entrada dentro do ZIP (sem pasta, em minúsculas).
    pub entrada: String,
    pub codigo: String,
    pub descricao: String,
}

impl Moterro {
    /// Lê (código, descrição) do DBF da tabela. Código e descrição sem espaços nas pontas.
    pub fn motivos(&self, dbf: &[u8]) -> Result<Vec<(String, String)>, String> {
        let d = crate::dbf::Dbf::abrir(dbf).map_err(|e| format!("MOTERRO: {e}"))?;
        let (Some(ic), Some(id)) = (
            d.cabecalho.indice(&self.codigo),
            d.cabecalho.indice(&self.descricao),
        ) else {
            let tem: Vec<&str> = d.cabecalho.campos.iter().map(|c| c.nome.as_str()).collect();
            return Err(format!(
                "MOTERRO: faltam os campos {} e {}. Campos do arquivo: {}. Atualize [moterro] em manifestos/producao.toml",
                self.codigo,
                self.descricao,
                tem.join(", ")
            ));
        };
        Ok(d.registros()
            .map(|r| (r.texto(ic), r.texto(id)))
            .filter(|(c, _)| !c.is_empty())
            .collect())
    }
}

/// Tabela auxiliar oficial (descrição de código, ou vigência de crítica) que mora dentro de um ZIP
/// do FTP e é lida por faixa de bytes, como o MOTERRO. Nenhuma tem dado de paciente.
#[derive(Debug, Clone, Deserialize)]
pub struct Auxiliar {
    /// Nome da tabela no banco (`CODOCO`, `INDICA`, `DOCORIG`, `ERRO_VIGENCIA`).
    pub tabela: String,
    /// Caminho do ZIP no FTP.
    pub zip: String,
    /// Nome da entrada dentro do ZIP (sem pasta, em minúsculas).
    pub entrada: String,
    /// `cnv` (TabWin), `cnv_arvore` (TabWin em árvore: vale a folha) ou `xlsx` (CO_TAB, CO_ITEM, início, fim, descrição).
    pub formato: String,
}

/// Vigência de uma crítica (`erroebloqueio.xlsx`): tabela 0024 = bloqueio, 0027 = rejeição.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vigencia {
    pub tabela: String,
    pub codigo: String,
    /// `AAAAMM`.
    pub inicio: String,
    /// `AAAAMM`; `999999` = sem fim.
    pub fim: String,
    pub descricao: String,
}

/// O que uma tabela auxiliar trouxe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConteudoAuxiliar {
    /// Código -> descrição.
    Codigos(Vec<(String, String)>),
    Vigencias(Vec<Vigencia>),
}

impl Auxiliar {
    /// Lê os bytes da entrada conforme o formato do manifesto.
    pub fn ler(&self, bytes: &[u8]) -> Result<ConteudoAuxiliar, String> {
        match self.formato.as_str() {
            "cnv" | "cnv_arvore" => {
                let texto = crate::latin1::decodificar(bytes);
                let mapa = if self.formato == "cnv" {
                    crate::cnes::ler_cnv(&texto)
                } else {
                    crate::cnes::ler_cnv_folhas(&texto)
                };
                if mapa.is_empty() {
                    return Err(format!("{}: a tabela veio vazia", self.entrada));
                }
                Ok(ConteudoAuxiliar::Codigos(mapa.into_iter().collect()))
            }
            "xlsx" => {
                let linhas = crate::xlsx::primeira_planilha(bytes)?;
                let cab: Vec<String> = linhas
                    .first()
                    .map(|l| l.iter().map(|c| c.trim().to_ascii_uppercase()).collect())
                    .unwrap_or_default();
                let col = |n: &str| {
                    cab.iter().position(|c| c == n).ok_or_else(|| {
                        format!(
                            "{}: falta a coluna {n}. Colunas do arquivo: {}",
                            self.entrada,
                            cab.join(", ")
                        )
                    })
                };
                let (t, c, i, f, d) = (
                    col("CO_TAB")?,
                    col("CO_ITEM")?,
                    col("DT_CMPT_INI")?,
                    col("DT_CMPT_FIM")?,
                    col("DS_DESCRICAO")?,
                );
                let v: Vec<Vigencia> = linhas
                    .iter()
                    .skip(1)
                    .filter_map(|l| {
                        let g =
                            |k: usize| l.get(k).map(|x| x.trim().to_string()).unwrap_or_default();
                        let v = Vigencia {
                            tabela: g(t),
                            codigo: g(c),
                            inicio: g(i),
                            fim: g(f),
                            descricao: g(d),
                        };
                        (!v.tabela.is_empty() && !v.codigo.is_empty()).then_some(v)
                    })
                    .collect();
                if v.is_empty() {
                    return Err(format!("{}: a planilha veio sem linhas", self.entrada));
                }
                Ok(ConteudoAuxiliar::Vigencias(v))
            }
            outro => Err(format!("formato \"{outro}\" desconhecido")),
        }
    }
}

/// Instrumento de registro da produção (`PA_DOCORIG`) e o código de `tb_registro` do SIGTAP que lhe corresponde.
#[derive(Debug, Clone, Deserialize)]
pub struct InstrumentoRegistro {
    pub docorig: String,
    pub registro: String,
}

/// O manifesto inteiro.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifesto {
    pub origem: String,
    #[serde(rename = "tipo")]
    pub tipos: Vec<Tipo>,
    pub moterro: Option<Moterro>,
    #[serde(default)]
    pub auxiliar: Vec<Auxiliar>,
    #[serde(default)]
    pub instrumento: Vec<InstrumentoRegistro>,
}

fn nome_de_campo_ok(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 10
        && n.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

impl Manifesto {
    /// O manifesto embutido no programa.
    pub fn carregar() -> Self {
        Self::de_texto(include_str!("../manifestos/producao.toml"))
            .expect("manifesto producao.toml embutido tem de ser válido (há teste)")
    }

    /// Lê e valida um manifesto.
    pub fn de_texto(texto: &str) -> Result<Self, String> {
        let m: Self =
            toml::from_str(texto).map_err(|e| format!("manifesto de produção inválido: {e}"))?;
        for a in &m.auxiliar {
            if !["cnv", "cnv_arvore", "xlsx"].contains(&a.formato.as_str()) {
                return Err(format!(
                    "auxiliar {}: formato \"{}\" desconhecido (cnv, cnv_arvore ou xlsx)",
                    a.tabela, a.formato
                ));
            }
            if a.entrada != a.entrada.to_ascii_lowercase() {
                return Err(format!(
                    "auxiliar {}: o nome da entrada tem de estar em minúsculas",
                    a.tabela
                ));
            }
        }
        for t in &m.tipos {
            let id = &t.codigo;
            if t.codigo.len() != 2 || !t.codigo.bytes().all(|b| b.is_ascii_uppercase()) {
                return Err(format!("tipo \"{id}\": o código tem de ser duas letras"));
            }
            if !(1..=2).contains(&t.competencia.len()) {
                return Err(format!("tipo {id}: a competência usa um ou dois campos"));
            }
            if t.quantidade.is_some() == t.contar_registros {
                return Err(format!(
                    "tipo {id}: use `quantidade` (campo) ou `contar_registros = true`, não os dois nem nenhum"
                ));
            }
            if t.motivo.is_none() && t.procedimento.is_none() {
                return Err(format!("tipo {id}: precisa de procedimento ou motivo"));
            }
            let mut lidos = t.campos_lidos();
            lidos.extend(t.campos_opcionais());
            for c in lidos.iter().chain(
                t.pessoais
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
                    .iter(),
            ) {
                if !nome_de_campo_ok(c) {
                    return Err(format!(
                        "tipo {id}: nome de campo \"{c}\" fora do padrão (maiúsculas, dígitos e _, até 10)"
                    ));
                }
            }
            if let Some(c) = t.pessoais.iter().find(|p| lidos.contains(&p.as_str())) {
                return Err(format!(
                    "tipo {id}: o campo pessoal {c} não pode ser lido pela carga"
                ));
            }
        }
        Ok(m)
    }

    pub fn tipo(&self, codigo: &str) -> Option<&Tipo> {
        self.tipos.iter().find(|t| t.codigo == codigo)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn manifesto_embutido_e_valido() {
        let m = Manifesto::carregar();
        let codigos: Vec<&str> = m.tipos.iter().map(|t| t.codigo.as_str()).collect();
        assert_eq!(codigos, ["PA", "RD", "ER", "SP"]);
        // Nomes vistos em arquivos reais de MS (08/2025 a 07/2026).
        assert!(m.tipos.iter().all(|t| t.confirmado));
        let er = m.tipo("ER").unwrap();
        assert_eq!(
            (er.motivo.as_deref(), er.competencia.as_slice()),
            (Some("CO_ERRO"), &["ANO".to_string(), "MES".to_string()][..])
        );
        assert!(er.pessoais.iter().all(|p| ["AIH", "DT_INTER", "DT_SAIDA", "MUN_RES", "UF_RES"].contains(&p.as_str())));
        assert!(
            m.tipo("PA")
                .unwrap()
                .pessoais
                .contains(&"PA_CNSMED".to_string())
        );
        assert!(
            m.tipo("RD")
                .unwrap()
                .pessoais
                .contains(&"N_AIH".to_string())
        );
    }

    #[test]
    fn moterro_le_codigo_e_descricao_do_dbf() {
        let m = Manifesto::carregar().moterro.expect("moterro no manifesto");
        let dbf = crate::dbf::testes::montar(
            &[("CD_MOT_ERR", 'C', 6), ("DS_MOT_ERR", 'C', 40)],
            &[
                &["0001", "DUPLICIDADE"],
                &["020069", "AIH BLOQUEADA PARA AUDITORIA"],
                &["", "sem código"],
            ],
            0x0D,
        );
        assert_eq!(
            m.motivos(&dbf).unwrap(),
            [
                ("0001".to_string(), "DUPLICIDADE".to_string()),
                (
                    "020069".to_string(),
                    "AIH BLOQUEADA PARA AUDITORIA".to_string()
                )
            ]
        );
        let outro = crate::dbf::testes::montar(&[("X", 'C', 2)], &[&["a"]], 0x0D);
        let e = m.motivos(&outro).unwrap_err();
        assert!(
            e.contains("CD_MOT_ERR") && e.contains("Campos do arquivo: X"),
            "{e}"
        );
    }

    #[test]
    fn campos_pessoais_nunca_sao_lidos() {
        let m = Manifesto::carregar();
        for t in &m.tipos {
            let lidos = t.campos_lidos();
            assert!(t.pessoais.iter().all(|p| !lidos.contains(&p.as_str())));
        }
    }

    fn base(extra: &str) -> String {
        format!(
            "origem = \"x\"\n[[tipo]]\ncodigo = \"PA\"\nnome = \"n\"\npasta = \"/p\"\nconfirmado = false\ncnes = \"CNES\"\ncompetencia = [\"MVM\"]\nprocedimento = \"PROC\"\npessoais = []\n{extra}"
        )
    }

    #[test]
    fn campos_opcionais_do_manifesto_nao_sao_pessoais() {
        let m = Manifesto::carregar();
        let pa = m.tipo("PA").unwrap();
        assert_eq!(pa.financiamento.as_deref(), Some("PA_TPFIN"));
        assert_eq!(pa.quantidade_apresentada.as_deref(), Some("PA_QTDPRO"));
        assert_eq!(pa.valor_apresentado.as_deref(), Some("PA_VALPRO"));
        assert_eq!(pa.valor_incremento.as_deref(), Some("PA_VL_INC"));
        let rd = m.tipo("RD").unwrap();
        assert_eq!(rd.dias.as_deref(), Some("DIAS_PERM"));
        assert_eq!(rd.dias_uti.as_deref(), Some("UTI_MES_TO"));
        for t in &m.tipos {
            assert!(
                t.pessoais
                    .iter()
                    .all(|p| !t.campos_opcionais().contains(&p.as_str()))
            );
        }
        let t = base(
            "quantidade = \"Q\"
dias = \"X\"",
        )
        .replace("pessoais = []", "pessoais = [\"X\"]");
        assert!(
            Manifesto::de_texto(&t).is_err(),
            "campo pessoal como opcional"
        );
    }

    #[test]
    fn recusa_manifestos_incoerentes() {
        // sem quantidade e sem contar_registros
        assert!(Manifesto::de_texto(&base("")).is_err());
        // os dois
        assert!(Manifesto::de_texto(&base("quantidade = \"Q\"\ncontar_registros = true")).is_err());
        // coerente
        assert!(Manifesto::de_texto(&base("quantidade = \"Q\"")).is_ok());
        // nome de campo fora do padrão
        assert!(Manifesto::de_texto(&base("quantidade = \"q; DROP\"")).is_err());
        // campo pessoal lido
        let t = base("quantidade = \"Q\"").replace("pessoais = []", "pessoais = [\"CNES\"]");
        assert!(Manifesto::de_texto(&t).is_err());
    }
}
