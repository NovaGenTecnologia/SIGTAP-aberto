//! Dados do próprio usuário (`dados\usuario.db`): favoritos, anotações e preferências.
//!
//! É o único banco que não vem de fonte oficial e não pode ser refeito: nenhuma rotina de
//! "refazer o banco" toca nele. Tudo local; nada aqui sai da máquina.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::fmt;
use std::path::Path;

/// Versão do esquema de `usuario.db`.
pub const VERSAO_ESQUEMA: &str = "1";
/// Tamanho máximo de uma anotação, em caracteres.
pub const MAX_ANOTACAO: usize = 4000;

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS sa_info(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorito(
    tipo TEXT NOT NULL, codigo TEXT NOT NULL, criado_em TEXT NOT NULL, PRIMARY KEY(tipo, codigo));
CREATE TABLE IF NOT EXISTS anotacao(
    tipo TEXT NOT NULL, codigo TEXT NOT NULL, texto TEXT NOT NULL, alterado_em TEXT NOT NULL,
    PRIMARY KEY(tipo, codigo));
CREATE TABLE IF NOT EXISTS config(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
";

/// Erro do banco do usuário.
#[derive(Debug)]
pub enum ErroUsuario {
    Sql(rusqlite::Error),
    /// O arquivo não é um banco válido ou está danificado.
    Danificado,
    Entrada(String),
    Versao(String),
}

impl fmt::Display for ErroUsuario {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroUsuario::Sql(e) => write!(
                f,
                "não foi possível gravar seus favoritos e anotações ({e}). Verifique se a pasta do programa não é só leitura e se há espaço em disco"
            ),
            ErroUsuario::Danificado => write!(
                f,
                "o arquivo dos favoritos e anotações (dados\\usuario.db) está danificado. Abra Módulos e dados, use Verificar o banco e, antes de apagá-lo, guarde uma cópia do arquivo"
            ),
            ErroUsuario::Entrada(m) => write!(f, "{m}"),
            ErroUsuario::Versao(v) => write!(
                f,
                "seus favoritos e anotações foram gravados por uma versão mais nova do programa (esquema {v}). Atualize o programa; nada foi alterado"
            ),
        }
    }
}

impl std::error::Error for ErroUsuario {}

impl From<rusqlite::Error> for ErroUsuario {
    fn from(e: rusqlite::Error) -> Self {
        if crate::saude::erro_de_corrupcao(&e) {
            ErroUsuario::Danificado
        } else {
            ErroUsuario::Sql(e)
        }
    }
}

/// Item marcado, com a anotação quando existe.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Marcado {
    pub tipo: String,
    pub codigo: String,
    pub favorito: bool,
    pub favorito_desde: Option<String>,
    pub anotacao: Option<String>,
    pub anotacao_de: Option<String>,
}

/// Banco do usuário.
pub struct BancoUsuario {
    conn: Connection,
}

/// Quantas marcações (favoritos mais anotações) o banco do usuário aceita.
const MAX_MARCACOES: i64 = 5000;

fn validar(tipo: &str, codigo: &str) -> Result<(), ErroUsuario> {
    let alfanum = |t: &str| t.bytes().all(|b| b.is_ascii_alphanumeric());
    let ok = match tipo {
        "procedimento" => codigo.len() == 10 && codigo.bytes().all(|b| b.is_ascii_digit()),
        "cid" => (3..=5).contains(&codigo.len()) && alfanum(codigo),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(ErroUsuario::Entrada(
            "código inválido para favorito ou anotação".into(),
        ))
    }
}

impl BancoUsuario {
    pub fn abrir(caminho: &Path) -> Result<Self, ErroUsuario> {
        Self::preparar(Connection::open(caminho)?)
    }

    pub fn em_memoria() -> Result<Self, ErroUsuario> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(conn: Connection) -> Result<Self, ErroUsuario> {
        conn.execute_batch("PRAGMA busy_timeout=10000;")?;
        let tem_info: bool = conn.query_row(
            "SELECT count(*) > 0 FROM sqlite_master WHERE type='table' AND name='sa_info'",
            [],
            |r| r.get(0),
        )?;
        let v: Option<String> = if tem_info {
            conn.query_row(
                "SELECT valor FROM sa_info WHERE chave = 'versao_esquema'",
                [],
                |r| r.get(0),
            )
            .optional()?
        } else {
            None
        };
        // Dados do usuário nunca são descartados: versão diferente só bloqueia, sem alterar.
        if let Some(x) = v.as_deref()
            && x != VERSAO_ESQUEMA
        {
            return Err(ErroUsuario::Versao(x.to_string()));
        }
        conn.execute_batch(ESQUEMA)?;
        if v.is_none() {
            conn.execute(
                "INSERT INTO sa_info VALUES('versao_esquema', ?1)",
                [VERSAO_ESQUEMA],
            )?;
        }
        Ok(Self { conn })
    }

    fn exigir_espaco(&self) -> Result<(), ErroUsuario> {
        let n: i64 = self.conn.query_row(
            "SELECT (SELECT count(*) FROM favorito) + (SELECT count(*) FROM anotacao)",
            [],
            |r| r.get(0),
        )?;
        if n >= MAX_MARCACOES {
            return Err(ErroUsuario::Entrada(format!(
                "limite de {MAX_MARCACOES} favoritos e anotações. Remova alguns antes de marcar outros"
            )));
        }
        Ok(())
    }

    /// Marca ou desmarca um favorito. Devolve o estado final.
    pub fn favoritar(&self, tipo: &str, codigo: &str, favorito: bool) -> Result<bool, ErroUsuario> {
        validar(tipo, codigo)?;
        if favorito {
            self.exigir_espaco()?;
            self.conn.execute(
                "INSERT OR IGNORE INTO favorito VALUES(?1, ?2, datetime('now', 'localtime'))",
                params![tipo, codigo],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM favorito WHERE tipo = ?1 AND codigo = ?2",
                params![tipo, codigo],
            )?;
        }
        Ok(favorito)
    }

    /// Grava a anotação; texto vazio apaga.
    pub fn anotar(&self, tipo: &str, codigo: &str, texto: &str) -> Result<(), ErroUsuario> {
        validar(tipo, codigo)?;
        let texto = texto.trim();
        if texto.chars().count() > MAX_ANOTACAO {
            return Err(ErroUsuario::Entrada(format!(
                "a anotação passa de {MAX_ANOTACAO} caracteres. Encurte o texto"
            )));
        }
        if texto.is_empty() {
            self.conn.execute(
                "DELETE FROM anotacao WHERE tipo = ?1 AND codigo = ?2",
                params![tipo, codigo],
            )?;
        } else {
            if self.marcado(tipo, codigo)?.anotacao.is_none() {
                self.exigir_espaco()?;
            }
            self.conn.execute(
                "INSERT INTO anotacao VALUES(?1, ?2, ?3, datetime('now', 'localtime')) \
                 ON CONFLICT(tipo, codigo) DO UPDATE SET texto = excluded.texto, alterado_em = excluded.alterado_em",
                params![tipo, codigo, texto],
            )?;
        }
        Ok(())
    }

    /// Favorito e anotação de um item.
    pub fn marcado(&self, tipo: &str, codigo: &str) -> Result<Marcado, ErroUsuario> {
        validar(tipo, codigo)?;
        let fav: Option<String> = self
            .conn
            .query_row(
                "SELECT criado_em FROM favorito WHERE tipo = ?1 AND codigo = ?2",
                params![tipo, codigo],
                |r| r.get(0),
            )
            .optional()?;
        let nota: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT texto, alterado_em FROM anotacao WHERE tipo = ?1 AND codigo = ?2",
                params![tipo, codigo],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(Marcado {
            tipo: tipo.into(),
            codigo: codigo.into(),
            favorito: fav.is_some(),
            favorito_desde: fav,
            anotacao: nota.as_ref().map(|n| n.0.clone()),
            anotacao_de: nota.map(|n| n.1),
        })
    }

    /// Tudo o que o usuário marcou de um tipo (favoritos e anotações), por código.
    pub fn marcados(&self, tipo: &str) -> Result<Vec<Marcado>, ErroUsuario> {
        let mut st = self.conn.prepare(
            "SELECT codigo FROM favorito WHERE tipo = ?1 UNION SELECT codigo FROM anotacao WHERE tipo = ?1 ORDER BY 1 LIMIT ?2",
        )?;
        // Mesmo teto da gravação: um arquivo com milhões de linhas (forjado ou de outra origem) não vira resposta gigante.
        let codigos: Vec<String> = st
            .query_map(params![tipo, MAX_MARCACOES], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        codigos.iter().map(|c| self.marcado(tipo, c)).collect()
    }

    /// Preferência gravada.
    pub fn config(&self, chave: &str) -> Result<Option<String>, ErroUsuario> {
        Ok(self
            .conn
            .query_row("SELECT valor FROM config WHERE chave = ?1", [chave], |r| {
                r.get(0)
            })
            .optional()?)
    }

    /// Grava (ou, com `None`, apaga) uma preferência.
    pub fn gravar_config(&self, chave: &str, valor: Option<&str>) -> Result<(), ErroUsuario> {
        match valor {
            Some(v) => self.conn.execute(
                "INSERT INTO config VALUES(?1, ?2) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
                params![chave, v],
            )?,
            None => self.conn.execute("DELETE FROM config WHERE chave = ?1", [chave])?,
        };
        Ok(())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn favoritos_anotacoes_e_preferencias() {
        let b = BancoUsuario::em_memoria().unwrap();
        assert!(!b.marcado("procedimento", "0301010072").unwrap().favorito);
        b.favoritar("procedimento", "0301010072", true).unwrap();
        b.favoritar("procedimento", "0301010072", true).unwrap(); // repetir não duplica
        b.anotar(
            "procedimento",
            "0406010579",
            "  Exige habilitação 0802.\nConferir CNES.  ",
        )
        .unwrap();
        b.anotar("cid", "T742", "nota de CID").unwrap();
        let m = b.marcados("procedimento").unwrap();
        assert_eq!(m.len(), 2);
        assert!(m[0].favorito && m[0].anotacao.is_none());
        assert_eq!(
            m[1].anotacao.as_deref(),
            Some("Exige habilitação 0802.\nConferir CNES.")
        );
        assert!(!m[1].favorito);
        // Editar substitui; texto vazio apaga; desfavoritar apaga.
        b.anotar("procedimento", "0406010579", "nova").unwrap();
        assert_eq!(
            b.marcado("procedimento", "0406010579")
                .unwrap()
                .anotacao
                .as_deref(),
            Some("nova")
        );
        b.anotar("procedimento", "0406010579", "   ").unwrap();
        b.favoritar("procedimento", "0301010072", false).unwrap();
        assert!(b.marcados("procedimento").unwrap().is_empty());
        assert_eq!(b.marcados("cid").unwrap().len(), 1);
        // Preferências.
        assert_eq!(b.config("minha_unidade").unwrap(), None);
        b.gravar_config("minha_unidade", Some("MS:0000001"))
            .unwrap();
        b.gravar_config("minha_unidade", Some("MS:0000002"))
            .unwrap();
        assert_eq!(
            b.config("minha_unidade").unwrap().as_deref(),
            Some("MS:0000002")
        );
        b.gravar_config("minha_unidade", None).unwrap();
        assert_eq!(b.config("minha_unidade").unwrap(), None);
    }

    #[test]
    fn recusa_codigo_estranho_e_texto_longo() {
        let b = BancoUsuario::em_memoria().unwrap();
        assert!(
            b.favoritar("procedimento", "03'; DROP TABLE favorito;--", true)
                .is_err()
        );
        assert!(b.favoritar("", "1", true).is_err());
        assert!(
            b.anotar("procedimento", "0301010072", &"a".repeat(MAX_ANOTACAO + 1))
                .is_err()
        );
        assert!(
            b.anotar("procedimento", "0301010072", &"ç".repeat(MAX_ANOTACAO))
                .is_ok()
        );
    }

    #[test]
    fn versao_mais_nova_bloqueia_sem_alterar() {
        let d = std::env::temp_dir().join(format!("sa_usuario_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&d);
        {
            let b = BancoUsuario::abrir(&d).unwrap();
            b.favoritar("procedimento", "0301010072", true).unwrap();
        }
        Connection::open(&d)
            .unwrap()
            .execute("UPDATE sa_info SET valor = '9'", [])
            .unwrap();
        let antes = std::fs::read(&d).unwrap();
        assert!(matches!(
            BancoUsuario::abrir(&d),
            Err(ErroUsuario::Versao(_))
        ));
        assert_eq!(std::fs::read(&d).unwrap(), antes);
        let _ = std::fs::remove_file(&d);
    }

    #[test]
    fn arquivo_que_nao_e_banco_vira_aviso_de_arquivo_danificado() {
        let d = std::env::temp_dir().join(format!("sa_usuario_lixo_{}.db", std::process::id()));
        std::fs::write(&d, vec![b'x'; 4096]).unwrap();
        let e = BancoUsuario::abrir(&d).err().expect("deveria recusar");
        let _ = std::fs::remove_file(&d);
        assert!(matches!(e, ErroUsuario::Danificado), "{e}");
        let m = e.to_string();
        assert!(m.contains("danificado") && !m.contains("só leitura"), "{m}");
    }

    #[test]
    fn marcados_le_no_maximo_o_teto_de_gravacao() {
        let b = BancoUsuario::em_memoria().unwrap();
        b.conn.execute_batch("BEGIN").unwrap();
        for i in 0..(MAX_MARCACOES + 300) {
            b.conn
                .execute(
                    "INSERT INTO favorito VALUES('procedimento', ?1, 'x')",
                    params![format!("{i:010}")],
                )
                .unwrap();
        }
        b.conn.execute_batch("COMMIT").unwrap();
        assert_eq!(
            b.marcados("procedimento").unwrap().len(),
            MAX_MARCACOES as usize
        );
    }

    #[test]
    fn so_aceita_tipos_conhecidos_e_codigos_no_formato() {
        let b = BancoUsuario::em_memoria().unwrap();
        assert!(b.favoritar("zzz", "0301010072", true).is_err());
        assert!(b.favoritar("procedimento", "9", true).is_err());
        assert!(b.favoritar("procedimento", "03010100a2", true).is_err());
        assert!(b.favoritar("cid", "ab", true).is_err());
        assert!(b.favoritar("procedimento", "0301010072", true).is_ok());
        assert!(b.favoritar("cid", "T742", true).is_ok());
    }

    #[test]
    fn limita_a_quantidade_de_marcacoes() {
        let b = BancoUsuario::em_memoria().unwrap();
        for i in 0..MAX_MARCACOES {
            b.conn
                .execute(
                    "INSERT INTO favorito VALUES('procedimento', ?1, 'x')",
                    params![format!("{i:010}")],
                )
                .unwrap();
        }
        assert!(b.favoritar("procedimento", "9999999999", true).is_err());
        assert!(b.anotar("procedimento", "9999999998", "nota").is_err());
        assert!(b.favoritar("procedimento", "0000000001", false).is_ok());
        assert!(b.favoritar("procedimento", "9999999999", true).is_ok());
    }
}
