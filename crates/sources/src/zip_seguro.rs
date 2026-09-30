//! Abertura de ZIP de origem não confiável, com limites.
//!
//! Limites padrão medidos nos 225 ZIPs reais do SIGTAP (30/09/2026): até 87 entradas, maior
//! arquivo 17,4 MB, maior razão de compressão 55,9. Os limites deixam folga ampla e barram
//! zip-bomba e nomes de caminho perigosos.

use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Limites aplicados a um ZIP.
#[derive(Debug, Clone, Copy)]
pub struct Limites {
    pub max_entradas: usize,
    pub max_bytes_entrada: u64,
    pub max_bytes_total: u64,
    pub max_razao: u64,
}

impl Default for Limites {
    fn default() -> Self {
        Self {
            max_entradas: 1_000,
            max_bytes_entrada: 256 * 1024 * 1024,
            max_bytes_total: 1024 * 1024 * 1024,
            max_razao: 1_000,
        }
    }
}

/// Erro ao abrir ou ler um ZIP.
#[derive(Debug)]
pub enum ErroZip {
    Abrir(PathBuf, String),
    Limite(PathBuf, String),
    NomePerigoso(PathBuf, String),
    Ler(PathBuf, String, String),
    Ausente(PathBuf, String),
}

impl fmt::Display for ErroZip {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroZip::Abrir(p, e) => write!(
                f,
                "não foi possível abrir {} como ZIP ({e}). O arquivo pode estar incompleto: apague-o e baixe de novo da fonte oficial",
                p.display()
            ),
            ErroZip::Limite(p, e) => write!(
                f,
                "{} foi recusado por segurança: {e}. Um ZIP oficial não passa desses limites; baixe de novo da fonte oficial",
                p.display()
            ),
            ErroZip::NomePerigoso(p, n) => write!(
                f,
                "{} contém um nome de arquivo perigoso (\"{n}\") e foi recusado. Baixe de novo da fonte oficial",
                p.display()
            ),
            ErroZip::Ler(p, n, e) => write!(
                f,
                "falha ao ler \"{n}\" dentro de {} ({e}). O arquivo pode estar corrompido: baixe de novo da fonte oficial",
                p.display()
            ),
            ErroZip::Ausente(p, n) => write!(
                f,
                "\"{n}\" não existe dentro de {}. Confira se é o ZIP certo da fonte oficial",
                p.display()
            ),
        }
    }
}

impl std::error::Error for ErroZip {}

/// ZIP aberto e já conferido contra os limites.
pub struct ZipSeguro {
    caminho: PathBuf,
    arquivo: zip::ZipArchive<File>,
    nomes: Vec<String>,
    limites: Limites,
}

fn nome_perigoso(n: &str) -> bool {
    n.is_empty()
        || n.starts_with('/')
        || n.starts_with('\\')
        || n.contains("..")
        || n.contains(':')
        || n.chars().any(|c| c.is_control())
}

impl ZipSeguro {
    pub fn abrir(caminho: &Path, limites: Limites) -> Result<Self, ErroZip> {
        let p = caminho.to_path_buf();
        let f = File::open(caminho).map_err(|e| ErroZip::Abrir(p.clone(), e.to_string()))?;
        let mut arquivo =
            zip::ZipArchive::new(f).map_err(|e| ErroZip::Abrir(p.clone(), e.to_string()))?;
        if arquivo.len() > limites.max_entradas {
            return Err(ErroZip::Limite(
                p,
                format!(
                    "{} entradas (limite {})",
                    arquivo.len(),
                    limites.max_entradas
                ),
            ));
        }
        let mut total: u64 = 0;
        let mut nomes = Vec::with_capacity(arquivo.len());
        for i in 0..arquivo.len() {
            let e = arquivo
                .by_index_raw(i)
                .map_err(|e| ErroZip::Abrir(p.clone(), e.to_string()))?;
            let nome = e.name().to_string();
            if nome_perigoso(&nome) {
                return Err(ErroZip::NomePerigoso(p, nome));
            }
            let (tam, comp) = (e.size(), e.compressed_size());
            if tam > limites.max_bytes_entrada {
                return Err(ErroZip::Limite(
                    p,
                    format!("\"{nome}\" tem {tam} bytes descomprimido"),
                ));
            }
            if comp > 0 && tam / comp > limites.max_razao {
                return Err(ErroZip::Limite(
                    p,
                    format!(
                        "\"{nome}\" tem razão de compressão {} (limite {})",
                        tam / comp,
                        limites.max_razao
                    ),
                ));
            }
            total = total.saturating_add(tam);
            nomes.push(nome);
        }
        if total > limites.max_bytes_total {
            return Err(ErroZip::Limite(
                p,
                format!("{total} bytes descomprimidos no total"),
            ));
        }
        Ok(Self {
            caminho: p,
            arquivo,
            nomes,
            limites,
        })
    }

    pub fn caminho(&self) -> &Path {
        &self.caminho
    }

    pub fn nomes(&self) -> &[String] {
        &self.nomes
    }

    pub fn contem(&self, nome: &str) -> bool {
        self.nomes.iter().any(|n| n == nome)
    }

    /// Lê uma entrada inteira, sem passar do limite mesmo que o cabeçalho minta o tamanho.
    pub fn ler(&mut self, nome: &str) -> Result<Vec<u8>, ErroZip> {
        let p = self.caminho.clone();
        let idx = self
            .arquivo
            .index_for_name(nome)
            .ok_or_else(|| ErroZip::Ausente(p.clone(), nome.to_string()))?;
        let e = self
            .arquivo
            .by_index(idx)
            .map_err(|e| ErroZip::Ler(p.clone(), nome.to_string(), e.to_string()))?;
        let max = self.limites.max_bytes_entrada;
        let mut buf = Vec::with_capacity(usize::try_from(e.size().min(max)).unwrap_or(0));
        e.take(max + 1)
            .read_to_end(&mut buf)
            .map_err(|er| ErroZip::Ler(p.clone(), nome.to_string(), er.to_string()))?;
        if buf.len() as u64 > max {
            return Err(ErroZip::Limite(
                p,
                format!("\"{nome}\" passa de {max} bytes ao descomprimir"),
            ));
        }
        Ok(buf)
    }
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// Cria um ZIP sintético com as entradas dadas.
    pub fn criar_zip(dir: &Path, nome: &str, entradas: &[(&str, &[u8])]) -> PathBuf {
        let p = dir.join(nome);
        let mut w = zip::ZipWriter::new(File::create(&p).unwrap());
        for (n, c) in entradas {
            w.start_file(*n, SimpleFileOptions::default()).unwrap();
            w.write_all(c).unwrap();
        }
        w.finish().unwrap();
        p
    }

    pub fn dir_temp(rotulo: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sa-teste-{rotulo}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn le_entrada_normal() {
        let d = dir_temp("zip-normal");
        let p = criar_zip(&d, "a.zip", &[("x.txt", b"conteudo")]);
        let mut z = ZipSeguro::abrir(&p, Limites::default()).unwrap();
        assert!(z.contem("x.txt"));
        assert_eq!(z.ler("x.txt").unwrap(), b"conteudo");
        assert!(matches!(z.ler("y.txt"), Err(ErroZip::Ausente(..))));
    }

    #[test]
    fn recusa_zip_bomba() {
        let d = dir_temp("zip-bomba");
        let zeros = vec![b' '; 5 * 1024 * 1024];
        let p = criar_zip(&d, "bomba.zip", &[("t.txt", &zeros)]);
        let lim = Limites {
            max_razao: 100,
            ..Limites::default()
        };
        let e = ZipSeguro::abrir(&p, lim).err().expect("deveria recusar");
        assert!(e.to_string().contains("razão de compressão"), "{e}");
        let lim = Limites {
            max_bytes_entrada: 1024,
            ..Limites::default()
        };
        assert!(matches!(
            ZipSeguro::abrir(&p, lim),
            Err(ErroZip::Limite(..))
        ));
    }

    #[test]
    fn recusa_caminho_perigoso() {
        let d = dir_temp("zip-caminho");
        for n in ["../fora.txt", "/abs.txt", "C:\\x.txt", "a/../../b.txt"] {
            let p = criar_zip(&d, "p.zip", &[(n, b"x")]);
            assert!(
                matches!(
                    ZipSeguro::abrir(&p, Limites::default()),
                    Err(ErroZip::NomePerigoso(..))
                ),
                "{n}"
            );
        }
    }

    #[test]
    fn recusa_arquivo_que_nao_e_zip() {
        let d = dir_temp("zip-invalido");
        let p = d.join("nao.zip");
        std::fs::write(&p, b"isto nao e zip").unwrap();
        let e = ZipSeguro::abrir(&p, Limites::default()).err().unwrap();
        assert!(e.to_string().contains("baixe de novo"), "{e}");
    }
}
