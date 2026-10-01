//! Descompressão PKWARE DCL "implode" (a compressão dos arquivos `.dbc` do DATASUS).
//!
//! Escrito do zero a partir da descrição pública do formato (a especificação usada foi a do
//! `blast.c`, de Mark Adler, distribuído com o zlib, lido como especificação e não copiado).
//! O formato:
//!
//! - byte 0: `0` = literais sem código (8 bits), `1` = literais com código de Huffman;
//! - byte 1: 4, 5 ou 6 = quantos bits baixos da distância vêm sem código (janela de 1, 2 ou 4 KiB);
//! - depois, bits lidos do menos para o mais significativo: `0` + literal, ou `1` + comprimento +
//!   distância. Comprimento 519 encerra.
//!
//! Os códigos de Huffman são canônicos, definidos pelas listas de comprimentos abaixo, e chegam
//! com os bits invertidos. A saída é limitada pelo chamador: um arquivo de origem não confiável
//! não consegue pedir mais memória do que o limite.

use std::fmt;

/// Erro de descompressão. A mensagem é para o registro; quem chama diz ao usuário o que fazer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroDcl {
    /// Os dois primeiros bytes não são de um fluxo DCL.
    Cabecalho(String),
    /// O fluxo acabou antes do código de fim.
    Truncado,
    /// Distância aponta para antes do início da saída, ou código inválido.
    Corrompido(String),
    /// A saída passaria do limite dado.
    Limite(usize),
}

impl fmt::Display for ErroDcl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroDcl::Cabecalho(m) => write!(f, "cabeçalho de compressão inválido ({m})"),
            ErroDcl::Truncado => write!(f, "os dados comprimidos terminam antes do fim"),
            ErroDcl::Corrompido(m) => write!(f, "dados comprimidos corrompidos ({m})"),
            ErroDcl::Limite(n) => write!(f, "o conteúdo passaria do limite de {n} bytes"),
        }
    }
}

impl std::error::Error for ErroDcl {}

/// Comprimentos dos códigos, em pares compactos: 4 bits altos = repetições - 1, 4 baixos = bits.
const LITERAIS: [u8; 98] = [
    11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55,
    8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8,
    25, 11, 8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44,
    253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173,
];
const COMPRIMENTOS: [u8; 6] = [2, 35, 36, 53, 38, 23];
const DISTANCIAS: [u8; 7] = [2, 20, 53, 230, 247, 151, 248];
/// Base e bits extras de cada símbolo de comprimento.
const BASE: [u16; 16] = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const EXTRA: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const FIM: usize = 519;
const MAX_BITS: usize = 13;

/// Código de Huffman canônico: quantos códigos há de cada comprimento e os símbolos em ordem.
struct Huffman {
    contagem: [u16; MAX_BITS + 1],
    simbolos: Vec<u16>,
}

impl Huffman {
    fn de_compacto(compacto: &[u8]) -> Self {
        let mut bits: Vec<u8> = Vec::new();
        for &par in compacto {
            for _ in 0..=(par >> 4) {
                bits.push(par & 15);
            }
        }
        let mut contagem = [0u16; MAX_BITS + 1];
        for &b in &bits {
            contagem[usize::from(b)] += 1;
        }
        let mut inicio = [0u16; MAX_BITS + 2];
        for i in 1..=MAX_BITS {
            inicio[i + 1] = inicio[i] + contagem[i];
        }
        let mut simbolos = vec![0u16; bits.len()];
        for (simbolo, &b) in bits.iter().enumerate() {
            if b != 0 {
                let pos = &mut inicio[usize::from(b)];
                simbolos[usize::from(*pos)] = u16::try_from(simbolo).unwrap_or(u16::MAX);
                *pos += 1;
            }
        }
        Self { contagem, simbolos }
    }
}

struct Leitor<'a> {
    dados: &'a [u8],
    pos: usize,
    acumulado: u32,
    disponiveis: u32,
}

impl Leitor<'_> {
    fn bits(&mut self, n: u32) -> Result<u32, ErroDcl> {
        while self.disponiveis < n {
            let b = *self.dados.get(self.pos).ok_or(ErroDcl::Truncado)?;
            self.pos += 1;
            self.acumulado |= u32::from(b) << self.disponiveis;
            self.disponiveis += 8;
        }
        let v = self.acumulado & ((1u32 << n) - 1);
        self.acumulado >>= n;
        self.disponiveis -= n;
        Ok(v)
    }

    fn simbolo(&mut self, h: &Huffman) -> Result<usize, ErroDcl> {
        let (mut codigo, mut primeiro, mut indice) = (0i32, 0i32, 0i32);
        for tamanho in 1..=MAX_BITS {
            // Os bits do código chegam invertidos.
            codigo |= i32::try_from(self.bits(1)? ^ 1).unwrap_or(0);
            let n = i32::from(h.contagem[tamanho]);
            if codigo < primeiro + n {
                let i = usize::try_from(indice + (codigo - primeiro))
                    .map_err(|_| ErroDcl::Corrompido("código negativo".into()))?;
                return h
                    .simbolos
                    .get(i)
                    .map(|&s| usize::from(s))
                    .ok_or_else(|| ErroDcl::Corrompido("símbolo fora da tabela".into()));
            }
            indice += n;
            primeiro = (primeiro + n) << 1;
            codigo <<= 1;
        }
        Err(ErroDcl::Corrompido("código de Huffman inexistente".into()))
    }
}

/// Descomprime `dados` inteiro. `limite` é o máximo de bytes de saída aceito.
pub fn descomprimir(dados: &[u8], limite: usize) -> Result<Vec<u8>, ErroDcl> {
    let mut saida = Vec::new();
    descomprimir_em(dados, limite, &mut saida)?;
    Ok(saida)
}

/// Como [`descomprimir`], acrescentando ao fim de `saida` (as distâncias só alcançam o que
/// esta chamada escreveu).
pub fn descomprimir_em(dados: &[u8], limite: usize, saida: &mut Vec<u8>) -> Result<(), ErroDcl> {
    let inicio = saida.len();
    let com_codigo = match dados.first() {
        Some(0) => false,
        Some(1) => true,
        Some(x) => return Err(ErroDcl::Cabecalho(format!("tipo de literal {x}"))),
        None => return Err(ErroDcl::Truncado),
    };
    let janela = match dados.get(1) {
        Some(&d @ 4..=6) => u32::from(d),
        Some(x) => return Err(ErroDcl::Cabecalho(format!("janela {x}"))),
        None => return Err(ErroDcl::Truncado),
    };
    let literais = Huffman::de_compacto(&LITERAIS);
    let comprimentos = Huffman::de_compacto(&COMPRIMENTOS);
    let distancias = Huffman::de_compacto(&DISTANCIAS);
    let mut l = Leitor {
        dados,
        pos: 2,
        acumulado: 0,
        disponiveis: 0,
    };
    loop {
        if l.bits(1)? == 1 {
            let s = l.simbolo(&comprimentos)?;
            let extra = l.bits(u32::from(EXTRA[s]))?;
            let tamanho = usize::from(BASE[s]) + usize::try_from(extra).unwrap_or(0);
            if tamanho == FIM {
                return Ok(());
            }
            let baixos = if tamanho == 2 { 2 } else { janela };
            let alto = l.simbolo(&distancias)?;
            let distancia = (alto << baixos) + usize::try_from(l.bits(baixos)?).unwrap_or(0) + 1;
            let escrito = saida.len() - inicio;
            if distancia > escrito {
                return Err(ErroDcl::Corrompido(format!(
                    "distância {distancia} maior que os {escrito} bytes já escritos"
                )));
            }
            if escrito + tamanho > limite {
                return Err(ErroDcl::Limite(limite));
            }
            let de = saida.len() - distancia;
            for i in 0..tamanho {
                let b = saida[de + i];
                saida.push(b);
            }
        } else {
            let b = if com_codigo {
                u8::try_from(l.simbolo(&literais)?)
                    .map_err(|_| ErroDcl::Corrompido("literal fora de um byte".into()))?
            } else {
                u8::try_from(l.bits(8)?).unwrap_or(0)
            };
            if saida.len() - inicio >= limite {
                return Err(ErroDcl::Limite(limite));
            }
            saida.push(b);
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    /// Exemplo da própria especificação pública do formato: 15 bytes que viram "AIAIAIAIAIAIA".
    const EXEMPLO: [u8; 15] = [
        0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    #[test]
    fn exemplo_da_especificacao() {
        assert_eq!(descomprimir(&EXEMPLO[..8], 100).unwrap(), b"AIAIAIAIAIAIA");
    }

    #[test]
    fn recusa_cabecalho_truncamento_e_limite() {
        assert!(matches!(
            descomprimir(&[2, 4, 0], 10),
            Err(ErroDcl::Cabecalho(_))
        ));
        assert!(matches!(
            descomprimir(&[0, 7, 0], 10),
            Err(ErroDcl::Cabecalho(_))
        ));
        assert_eq!(descomprimir(&[], 10), Err(ErroDcl::Truncado));
        assert_eq!(descomprimir(&EXEMPLO[..5], 100), Err(ErroDcl::Truncado));
        assert_eq!(descomprimir(&EXEMPLO[..8], 12), Err(ErroDcl::Limite(12)));
    }

    #[test]
    fn distancia_antes_do_inicio_e_erro() {
        // Bit 1 (par), comprimento 3 (código "101" invertido), distância grande: nada foi escrito.
        let r = descomprimir(&[0x00, 0x04, 0xff, 0xff, 0xff, 0xff], 100);
        assert!(
            matches!(r, Err(ErroDcl::Corrompido(_)) | Err(ErroDcl::Truncado)),
            "{r:?}"
        );
    }

    #[test]
    fn tabelas_de_codigos_tem_o_tamanho_do_formato() {
        assert_eq!(Huffman::de_compacto(&LITERAIS).simbolos.len(), 256);
        assert_eq!(Huffman::de_compacto(&COMPRIMENTOS).simbolos.len(), 16);
        assert_eq!(Huffman::de_compacto(&DISTANCIAS).simbolos.len(), 64);
    }

    /// Fluxo com literais codificados (byte 0 = 1), gerado por um compressor independente
    /// (pacote Python `dclimplode`, modo ASCII, janela de 1 KiB): os 256 bytes em ordem crescente,
    /// um texto repetido e os 256 em ordem decrescente. Exercita a tabela inteira de literais,
    /// que os arquivos do DATASUS (literais sem código) não usam.
    const COM_CODIGO: &[&str] = &[
        "01042009fc811ff0053ec01b78014fe0019718b8033722e00a5c803370028ec001d8033b600b6c8035b002248125b000",
        "e6c00c987a50c20126a000c620874d48000b6c7c291e4c5c090e3616260c0c74e8d0801148a08105e2c0508c2a12ba28",
        "50a108400c4c3e328f8b04a21c360b110cc8a083062290401854600011e83b4c06dda6512916082198644327814c5315",
        "19023c787020054110007a4017e800128038200688022280302004080202003fc007f0023c0037c00570021c003bc006",
        "b0022c0033c00430020c003d4007d00234003540055002140039400690022400314004100204003e8007e00238003680",
        "0560026da00534810650076a4015a80065a0041481029007724016c80069200524810410076240148800612004048100",
        "e0077c8017f0006ec00538010760076c8015b00066c004180103a007748016d00018801a4007d000544005a000c80012",
        "a004100104001e800314002c0003400372400648012800128000c0013000140001800120001000600ba0b2c4485eccb4",
        "354587e643650700004000080006400050000c0007200048000a900232400e400330002ca000e0007800014004940012",
        "800ca0002a00154003d00135800168002da003f48001300226c00c58002b6003ec800370022ec00d78002fe003fc4000",
        "080221200c4480281003e24002480229200d64802c9003f24001280225a00c54802a5003ea400368022da00d60025800",
        "368003e00278003e4000100244003140029002640039400150025400354003d00274003dc00030024c0033c002b0026c",
        "003bc00170025c0037c003f0027c003f2000080242803020028802628038200174802ed0030110042938f0f0106445d5",
        "4046d20db289004216854ab3e90ca603f4210203504118128880063a643010596c0e88227179c87c30414c00052a8a2b",
        "14a18a81218883850612c0081a74740c189858d838125c9878527cb0611110c206393006053081034a0f4c8119300716",
        "c012900456c01ad8005b6007ec810370044ec019b8005722e006dc89e1020fe009bc8037f001bec00ff88364c03f",
    ];

    #[test]
    fn literais_codificados_cobrem_os_256_bytes() {
        let hex: String = COM_CODIGO.concat();
        let dados: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        assert_eq!(dados[0], 1);
        let mut esperado: Vec<u8> = (0..=255u8).collect();
        esperado.extend_from_slice(&b"SIGTAP Aberto: ".repeat(4));
        esperado.extend((0..=255u8).rev());
        assert_eq!(descomprimir(&dados, 10_000).unwrap(), esperado);
    }
}
