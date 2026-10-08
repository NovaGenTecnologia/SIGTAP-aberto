//! Exportação de tabelas para CSV e XLSX, sem dependência nova: o XLSX é um ZIP com XML
//! simples (uma planilha por aba, cabeçalho em negrito, textos como texto).
//!
//! Códigos (procedimento, CID, CNES) chegam como texto e saem como texto: o zero à esquerda
//! não se perde. No CSV, o separador é `;` e o arquivo começa com a marca UTF-8, que é como o
//! Excel em português abre acentos e colunas sem assistente; célula de texto que começa por
//! `=`, `+`, `-` ou `@` ganha um apóstrofo, para não virar fórmula.

use serde::Deserialize;
use std::fmt::Write as _;
use std::io::Write as _;

pub const MAX_ABAS: usize = 30;
pub const MAX_LINHAS: usize = 300_000;
pub const MAX_COLUNAS: usize = 300;
/// Limite de caracteres de uma célula no Excel.
pub const MAX_CELULA: usize = 32_767;

/// Uma aba: nome, cabeçalho e linhas. Cada célula é texto, número, booleano ou vazio.
#[derive(Debug, Clone, Deserialize)]
pub struct Aba {
    pub nome: String,
    pub colunas: Vec<String>,
    pub linhas: Vec<Vec<serde_json::Value>>,
}

/// Uma planilha a exportar.
#[derive(Debug, Clone, Deserialize)]
pub struct Planilha {
    pub titulo: String,
    pub abas: Vec<Aba>,
}

enum Celula {
    Vazia,
    Numero(String),
    Texto(String),
}

fn celula(v: &serde_json::Value) -> Celula {
    match v {
        serde_json::Value::Null => Celula::Vazia,
        serde_json::Value::Bool(b) => Celula::Texto(if *b { "Sim" } else { "Não" }.into()),
        serde_json::Value::Number(n) => Celula::Numero(n.to_string()),
        serde_json::Value::String(s) if s.is_empty() => Celula::Vazia,
        serde_json::Value::String(s) => Celula::Texto(s.clone()),
        outro => Celula::Texto(outro.to_string()),
    }
}

impl Planilha {
    /// Confere os limites antes de gerar qualquer coisa.
    pub fn validar(&self) -> Result<(), String> {
        if self.abas.is_empty() || self.abas.len() > MAX_ABAS {
            return Err(format!("a exportação precisa de 1 a {MAX_ABAS} abas"));
        }
        for a in &self.abas {
            if a.colunas.is_empty() || a.colunas.len() > MAX_COLUNAS {
                return Err(format!(
                    "a aba \"{}\" precisa de 1 a {MAX_COLUNAS} colunas",
                    a.nome
                ));
            }
            if a.linhas.len() > MAX_LINHAS {
                return Err(format!(
                    "a aba \"{}\" tem {} linhas; o máximo é {MAX_LINHAS}. Filtre a lista antes de exportar",
                    a.nome,
                    a.linhas.len()
                ));
            }
            if a.linhas.iter().any(|l| l.len() > a.colunas.len()) {
                return Err(format!(
                    "a aba \"{}\" tem linha com mais células que colunas",
                    a.nome
                ));
            }
        }
        Ok(())
    }

    /// CSV de uma aba (`;`, UTF-8 com marca, CRLF).
    pub fn csv(&self, aba: usize) -> Result<Vec<u8>, String> {
        self.validar()?;
        let a = self.abas.get(aba).ok_or("aba inexistente")?;
        let campo = |t: &str, texto: bool| -> String {
            let mut t = t.chars().take(MAX_CELULA).collect::<String>();
            if texto && t.starts_with(['=', '+', '-', '@']) {
                t.insert(0, '\'');
            }
            if t.contains([';', '"', '\n', '\r']) {
                format!("\"{}\"", t.replace('"', "\"\""))
            } else {
                t
            }
        };
        let mut s = String::from("\u{feff}");
        s.push_str(
            &a.colunas
                .iter()
                .map(|c| campo(c, true))
                .collect::<Vec<_>>()
                .join(";"),
        );
        s.push_str("\r\n");
        for l in &a.linhas {
            let cs: Vec<String> = (0..a.colunas.len())
                .map(|i| match l.get(i).map(celula) {
                    Some(Celula::Texto(t)) => campo(&t, true),
                    // Número com vírgula decimal, como o Excel em português lê.
                    Some(Celula::Numero(n)) => campo(&n.replace('.', ","), false),
                    _ => String::new(),
                })
                .collect();
            s.push_str(&cs.join(";"));
            s.push_str("\r\n");
        }
        Ok(s.into_bytes())
    }

    /// XLSX com todas as abas.
    pub fn xlsx(&self) -> Result<Vec<u8>, String> {
        self.validar()?;
        let nomes = nomes_de_abas(&self.abas);
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let o = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            let mut por = |nome: &str, conteudo: &str| -> Result<(), String> {
                z.start_file(nome, o).map_err(|e| e.to_string())?;
                z.write_all(conteudo.as_bytes()).map_err(|e| e.to_string())
            };
            let mut tipos = String::from(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#,
            );
            let mut livro = String::from(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>"#,
            );
            let mut rels = String::from(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
            );
            for (i, nome) in nomes.iter().enumerate() {
                let n = i + 1;
                let _ = write!(
                    tipos,
                    r#"<Override PartName="/xl/worksheets/sheet{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
                );
                let _ = write!(
                    livro,
                    r#"<sheet name="{}" sheetId="{n}" r:id="rId{n}"/>"#,
                    xml(nome)
                );
                let _ = write!(
                    rels,
                    r#"<Relationship Id="rId{n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{n}.xml"/>"#
                );
            }
            tipos.push_str("</Types>");
            livro.push_str("</sheets></workbook>");
            let _ = write!(
                rels,
                r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#,
                nomes.len() + 1
            );
            por("[Content_Types].xml", &tipos)?;
            por(
                "_rels/.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            )?;
            por("xl/workbook.xml", &livro)?;
            por("xl/_rels/workbook.xml.rels", &rels)?;
            por(
                "xl/styles.xml",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#,
            )?;
            for (i, a) in self.abas.iter().enumerate() {
                let mut s = String::with_capacity(64 + a.linhas.len() * a.colunas.len() * 24);
                s.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>"#);
                for (c, nome) in a.colunas.iter().enumerate() {
                    // Largura pela maior célula das primeiras linhas, entre 8 e 60.
                    let maior = a
                        .linhas
                        .iter()
                        .take(200)
                        .filter_map(|l| l.get(c))
                        .map(|v| match celula(v) {
                            Celula::Texto(t) | Celula::Numero(t) => t.chars().count(),
                            Celula::Vazia => 0,
                        })
                        .max()
                        .unwrap_or(0)
                        .max(nome.chars().count());
                    let _ = write!(
                        s,
                        r#"<col min="{0}" max="{0}" width="{1}" customWidth="1"/>"#,
                        c + 1,
                        (maior + 2).clamp(8, 60)
                    );
                }
                s.push_str("</cols><sheetData><row r=\"1\">");
                for (c, nome) in a.colunas.iter().enumerate() {
                    let _ = write!(
                        s,
                        r#"<c r="{}1" s="1" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,
                        coluna(c),
                        xml(nome)
                    );
                }
                s.push_str("</row>");
                for (l, linha) in a.linhas.iter().enumerate() {
                    let _ = write!(s, r#"<row r="{}">"#, l + 2);
                    for (c, v) in linha.iter().enumerate() {
                        match celula(v) {
                            Celula::Vazia => {}
                            Celula::Numero(n) => {
                                let _ =
                                    write!(s, r#"<c r="{}{}"><v>{n}</v></c>"#, coluna(c), l + 2);
                            }
                            Celula::Texto(t) => {
                                let t: String = t.chars().take(MAX_CELULA).collect();
                                let _ = write!(
                                    s,
                                    r#"<c r="{}{}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,
                                    coluna(c),
                                    l + 2,
                                    xml(&t)
                                );
                            }
                        }
                    }
                    s.push_str("</row>");
                }
                s.push_str("</sheetData></worksheet>");
                por(&format!("xl/worksheets/sheet{}.xml", i + 1), &s)?;
            }
            z.finish().map_err(|e| e.to_string())?;
        }
        Ok(buf)
    }
}

/// Letra(s) da coluna: 0 = A, 25 = Z, 26 = AA.
fn coluna(mut i: usize) -> String {
    let mut s = Vec::new();
    loop {
        s.push(b'A' + (i % 26) as u8);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

/// Escapa texto para XML e tira caracteres de controle que o XML 1.0 não aceita.
fn xml(t: &str) -> String {
    let mut s = String::with_capacity(t.len());
    for c in t.chars() {
        match c {
            '&' => s.push_str("&amp;"),
            '<' => s.push_str("&lt;"),
            '>' => s.push_str("&gt;"),
            '"' => s.push_str("&quot;"),
            '\n' | '\t' => s.push(c),
            c if (c as u32) < 0x20 || c == '\u{fffe}' || c == '\u{ffff}' => {}
            c => s.push(c),
        }
    }
    s
}

/// Nomes de aba válidos e únicos (até 31 caracteres, sem `[]:*?/\`).
fn nomes_de_abas(abas: &[Aba]) -> Vec<String> {
    let mut usados: Vec<String> = Vec::new();
    for (i, a) in abas.iter().enumerate() {
        let limpo: String = a
            .nome
            .chars()
            .map(|c| {
                if "[]:*?/\\'".contains(c) || (c as u32) < 0x20 {
                    ' '
                } else {
                    c
                }
            })
            .collect::<String>()
            .trim()
            .chars()
            .take(31)
            .collect();
        let mut nome = if limpo.is_empty() {
            format!("Planilha {}", i + 1)
        } else {
            limpo
        };
        let mut n = 2;
        while usados.iter().any(|u| u.eq_ignore_ascii_case(&nome)) {
            let sufixo = format!(" ({n})");
            nome = format!(
                "{}{sufixo}",
                nome.chars().take(31 - sufixo.len()).collect::<String>()
            );
            n += 1;
        }
        usados.push(nome);
    }
    usados
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;
    use std::io::Read;

    fn exemplo() -> Planilha {
        serde_json::from_value(json!({
            "titulo": "Teste",
            "abas": [
                {"nome": "Procedimentos", "colunas": ["Código", "Nome", "Valor (R$)", "Exige habilitação"],
                 "linhas": [
                    ["0301010072", "CONSULTA MÉDICA; \"ATENÇÃO\" <especializada> & cia", 10.5, true],
                    ["0406010579", "=SOMA(A1:A2)", null, false],
                    ["0000000001", "linha\ncom quebra", 0, null]
                 ]},
                {"nome": "CIDs: a/b [x]", "colunas": ["CID"], "linhas": [["T742"]]},
                {"nome": "cids  a b  x", "colunas": ["CID"], "linhas": []}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn csv_com_ponto_e_virgula_aspas_e_sem_formula() {
        let csv = String::from_utf8(exemplo().csv(0).unwrap()).unwrap();
        let l: Vec<&str> = csv.split("\r\n").collect();
        assert!(l[0].starts_with("\u{feff}Código;Nome;Valor (R$);Exige habilitação"));
        assert_eq!(
            l[1],
            "0301010072;\"CONSULTA MÉDICA; \"\"ATENÇÃO\"\" <especializada> & cia\";10,5;Sim"
        );
        assert_eq!(l[2], "0406010579;'=SOMA(A1:A2);;Não");
        assert!(csv.contains("0000000001;\"linha\ncom quebra\";0;\r\n"));
    }

    #[test]
    fn xlsx_e_um_zip_com_as_abas_e_os_codigos_como_texto() {
        let b = exemplo().xlsx().unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(b)).unwrap();
        let mut ler = |n: &str| {
            let mut s = String::new();
            z.by_name(n).unwrap().read_to_string(&mut s).unwrap();
            s
        };
        let livro = ler("xl/workbook.xml");
        assert!(livro.contains(r#"<sheet name="Procedimentos" sheetId="1""#));
        assert!(livro.contains(r#"name="CIDs  a b  x""#), "{livro}");
        assert!(livro.contains(r#"name="cids  a b  x (2)""#), "{livro}");
        let f = ler("xl/worksheets/sheet1.xml");
        assert!(f.contains(
            r#"<c r="A2" t="inlineStr"><is><t xml:space="preserve">0301010072</t></is></c>"#
        ));
        assert!(f.contains("&lt;especializada&gt; &amp; cia"));
        assert!(f.contains(r#"<c r="C2"><v>10.5</v></c>"#));
        assert!(
            f.contains(r#"<c r="D2" t="inlineStr"><is><t xml:space="preserve">Sim</t></is></c>"#)
        );
        assert!(!f.contains(r#"r="C3""#), "célula vazia não é escrita");
        assert!(ler("[Content_Types].xml").contains("sheet3.xml"));
    }

    /// A planilha que a tela de produção monta (`producao.js`): código como texto, quantidade
    /// inteira, valor decimal (centavos / 100, como o JavaScript os serializa) e texto vazio.
    #[test]
    fn planilha_de_producao_exporta_em_xlsx_e_csv() {
        let p: Planilha = serde_json::from_value(json!({
            "titulo": "Produção de 02.01.01.018-6 em MS, 06/2026 a 07/2026",
            "abas": [
                {"nome": "SIA", "colunas": ["CNES", "Estabelecimento", "Município (código)", "Aprovados", "Valor (R$)", "Meses"],
                 "linhas": [["4068823", "HOSPITAL", "500270", 235, 705, 2], ["2000002", "", "", 1, 0.07, 1]]},
                {"nome": "Rejeições", "colunas": ["Motivo", "Descrição", "AIH", "Meses"],
                 "linhas": [["023", "", 5, 1]]}
            ]
        }))
        .unwrap();
        p.validar().unwrap();
        let csv = String::from_utf8(p.csv(0).unwrap()).unwrap();
        let l: Vec<&str> = csv.split("\r\n").collect();
        assert_eq!(l[1], "4068823;HOSPITAL;500270;235;705;2");
        assert_eq!(l[2], "2000002;;;1;0,07;1");
        let b = p.xlsx().unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(b)).unwrap();
        let mut f = String::new();
        z.by_name("xl/worksheets/sheet1.xml")
            .unwrap()
            .read_to_string(&mut f)
            .unwrap();
        assert!(f.contains(r#"<c r="D2"><v>235</v></c>"#), "{f}");
        assert!(f.contains(r#"<c r="E3"><v>0.07</v></c>"#), "{f}");
        assert!(
            f.contains(r#"<t xml:space="preserve">4068823</t>"#),
            "o CNES fica como texto"
        );
        let mut r = String::new();
        z.by_name("xl/worksheets/sheet2.xml")
            .unwrap()
            .read_to_string(&mut r)
            .unwrap();
        assert!(
            r.contains(r#"<t xml:space="preserve">023</t>"#),
            "o motivo \"023\" fica como texto, sem perder o zero"
        );
    }

    #[test]
    fn letras_de_coluna_e_limites() {
        assert_eq!(
            [
                coluna(0),
                coluna(25),
                coluna(26),
                coluna(27),
                coluna(701),
                coluna(702)
            ],
            ["A", "Z", "AA", "AB", "ZZ", "AAA"]
        );
        let mut p = exemplo();
        p.abas[0]
            .linhas
            .push(vec![json!(1), json!(2), json!(3), json!(4), json!(5)]);
        assert!(p.xlsx().is_err());
        p.abas.clear();
        assert!(p.csv(0).is_err());
        assert_eq!(xml("a\u{1}b\u{0}c"), "abc");
    }
}
