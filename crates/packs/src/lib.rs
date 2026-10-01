//! Módulos de dados por escopo.
//!
//! Fronteira: um arquivo SQLite por módulo e escopo (Brasil, região, UF, região de saúde,
//! município), criação, atualização e remoção independentes, união por `ATTACH`.
//! Fase 1: módulo SIGTAP (`sigtap`). Fase 2: território (`territorio`).

pub mod sigtap;
pub mod territorio;
