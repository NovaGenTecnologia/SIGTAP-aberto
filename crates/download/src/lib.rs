//! Download das fontes oficiais.
//!
//! Fronteira: cortesia com os servidores (uma conexão por servidor, um arquivo por vez,
//! pausa, novas tentativas com espera crescente), retomada, verificação do arquivo e modo
//! manual (o usuário coloca os arquivos numa pasta).

pub mod atualizador;
pub mod cnes;
pub mod cortesia;
pub mod ftp;
pub mod http;
#[cfg(feature = "servidor-falso")]
pub mod servidor_falso;
pub mod sigtap;
pub mod territorio;
