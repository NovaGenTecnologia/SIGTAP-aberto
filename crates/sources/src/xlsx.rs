//! Leitor mínimo de planilha XLSX: a primeira planilha (`xl/worksheets/sheet1.xml`) como linhas de
//! texto. Serve para tabelas auxiliares oficiais pequenas (por exemplo `erroebloqueio.xlsx`, do
//! `TAB_SIH.zip`). Texto em linha (`inlineStr`) ou em `sharedStrings`; números e outros tipos vêm
//! como o texto de `<v>`. Fórmulas, estilos e outras planilhas são ignorados. Limites de memória
//! obrigatórios: a planilha é dado externo.

use std::io::Read;

/// Tamanho máximo lido de cada parte do XLSX.
const MAX_PARTE: u64 = 32 * 1024 * 1024;

fn ler_parte(
    z: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>,
    nome: &str,
) -> Result<Option<String>, String> {
    let Ok(f) = z.by_name(nome) else {
        return Ok(None);
    };
    let mut s = String::new();
    f.take(MAX_PARTE + 1)
        .read_to_string(&mut s)
        .map_err(|e| format!("{nome}: {e}"))?;
    if s.len() as u64 > MAX_PARTE {
        return Err(format!("{nome}: maior que o limite"));
    }
    Ok(Some(s))
}

fn desescapar(t: &str) -> String {
    let t = referencias_numericas(t);
    t.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Troca `&#193;` e `&#xC1;` pelo caractere (o DATASUS escreve os acentos assim). Referência que não é um
/// caractere válido fica como veio.
fn referencias_numericas(t: &str) -> String {
    let mut saida = String::with_capacity(t.len());
    let mut resto = t;
    while let Some(i) = resto.find("&#") {
        saida.push_str(&resto[..i]);
        let depois = &resto[i + 2..];
        let ate = depois.find(';').filter(|&k| k > 0 && k <= 8);
        let c = ate.and_then(|k| {
            let n = &depois[..k];
            let v = match n.strip_prefix(['x', 'X']) {
                Some(h) => u32::from_str_radix(h, 16).ok(),
                None => n.parse::<u32>().ok(),
            };
            v.and_then(char::from_u32).map(|c| (c, k))
        });
        match c {
            Some((c, k)) => {
                saida.push(c);
                resto = &depois[k + 1..];
            }
            None => {
                saida.push_str("&#");
                resto = depois;
            }
        }
    }
    saida.push_str(resto);
    saida
}

/// Textos dos `<t>...</t>` de um trecho de XML, juntos.
fn textos(trecho: &str) -> String {
    let mut s = String::new();
    let mut resto = trecho;
    while let Some(i) = resto.find("<t") {
        let depois = &resto[i + 2..];
        // `<t>` ou `<t xml:space=...>`, não `<tr`, `<tc`...
        if !(depois.starts_with('>') || depois.starts_with(' ') || depois.starts_with('/')) {
            resto = depois;
            continue;
        }
        let Some(fim_tag) = depois.find('>') else {
            break;
        };
        if depois[..fim_tag].ends_with('/') {
            resto = &depois[fim_tag..];
            continue;
        }
        let corpo = &depois[fim_tag + 1..];
        let Some(fim) = corpo.find("</t>") else {
            break;
        };
        s.push_str(&desescapar(&corpo[..fim]));
        resto = &corpo[fim + 4..];
    }
    s
}

/// Índice de coluna (A = 0) de uma referência de célula como `C12`.
fn coluna(referencia: &str) -> usize {
    let mut n = 0usize;
    for b in referencia.bytes().take_while(u8::is_ascii_alphabetic) {
        n = n * 26 + usize::from(b.to_ascii_uppercase() - b'A' + 1);
    }
    n.saturating_sub(1)
}

/// Valor de um atributo (`t="s"`) numa tag de abertura.
fn atributo<'a>(tag: &'a str, nome: &str) -> Option<&'a str> {
    let chave = format!("{nome}=\"");
    let i = tag.find(&chave)? + chave.len();
    let f = tag[i..].find('"')?;
    Some(&tag[i..i + f])
}

/// A primeira planilha como linhas de texto (células vazias viram texto vazio; linhas mantêm o
/// alinhamento das colunas). Sem espaços aparados: quem usa decide.
pub fn primeira_planilha(bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("não é um XLSX: {e}"))?;
    let compartilhadas: Vec<String> = match ler_parte(&mut z, "xl/sharedStrings.xml")? {
        Some(x) => x.split("<si").skip(1).map(textos).collect(),
        None => Vec::new(),
    };
    let folha = ler_parte(&mut z, "xl/worksheets/sheet1.xml")?
        .ok_or("o XLSX não traz xl/worksheets/sheet1.xml")?;
    let mut linhas = Vec::new();
    for linha in folha.split("<row").skip(1) {
        let linha = linha.split("</row>").next().unwrap_or("");
        let mut celulas: Vec<String> = Vec::new();
        for c in linha.split("<c ").skip(1) {
            let Some(fim_tag) = c.find('>') else { continue };
            let (tag, corpo) = (&c[..fim_tag], &c[fim_tag + 1..]);
            let corpo = corpo.split("</c>").next().unwrap_or("");
            let col = atributo(tag, "r").map_or(celulas.len(), coluna);
            let valor = match atributo(tag, "t") {
                Some("inlineStr") => textos(corpo),
                Some("s") => {
                    let i: usize = textos(&corpo.replace("<v>", "<t>").replace("</v>", "</t>"))
                        .trim()
                        .parse()
                        .unwrap_or(usize::MAX);
                    compartilhadas.get(i).cloned().unwrap_or_default()
                }
                _ => textos(&corpo.replace("<v>", "<t>").replace("</v>", "</t>")),
            };
            if celulas.len() <= col {
                celulas.resize(col + 1, String::new());
            }
            celulas[col] = valor;
        }
        linhas.push(celulas);
    }
    Ok(linhas)
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::io::Write;

    fn xlsx(compartilhadas: Option<&str>, folha: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let o = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            if let Some(s) = compartilhadas {
                z.start_file("xl/sharedStrings.xml", o).unwrap();
                z.write_all(s.as_bytes()).unwrap();
            }
            z.start_file("xl/worksheets/sheet1.xml", o).unwrap();
            z.write_all(folha.as_bytes()).unwrap();
            z.finish().unwrap();
        }
        buf
    }

    #[test]
    fn le_texto_em_linha_com_espacos_e_entidades() {
        let folha = r#"<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>CO_TAB</t></is></c><c r="B1" t="inlineStr"><is><t>DS</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>0024</t></is></c><c r="B2" t="inlineStr"><is><t xml:space="preserve">A &amp; B  </t></is></c></row>
</sheetData></worksheet>"#;
        let l = primeira_planilha(&xlsx(None, folha)).unwrap();
        assert_eq!(l[0], ["CO_TAB", "DS"]);
        assert_eq!(l[1], ["0024", "A & B  "]);
    }

    #[test]
    fn referencias_numericas_viram_acentos_e_as_invalidas_ficam() {
        assert_eq!(
            desescapar("PRONTU&#193;RIO &#xC9; &amp; &#233;"),
            "PRONTUÁRIO É & é"
        );
        assert_eq!(
            desescapar("A &# B &#99999999999; C &#;"),
            "A &# B &#99999999999; C &#;"
        );
    }

    #[test]
    fn le_textos_compartilhados_numeros_e_celulas_puladas() {
        let ss = r#"<sst><si><t>alfa</t></si><si><r><t>be</t></r><r><t>ta</t></r></si></sst>"#;
        let folha = r#"<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row>
<row r="2"><c r="B2" t="s"><v>1</v></c></row>
</sheetData></worksheet>"#;
        let l = primeira_planilha(&xlsx(Some(ss), folha)).unwrap();
        assert_eq!(l[0], ["alfa", "", "42"]);
        assert_eq!(l[1], ["", "beta"]);
    }

    #[test]
    fn arquivo_que_nao_e_xlsx_e_recusado() {
        assert!(primeira_planilha(b"isto nao e zip").is_err());
        assert!(
            primeira_planilha(&xlsx(None, "<worksheet/>"))
                .unwrap()
                .is_empty()
        );
    }
}
