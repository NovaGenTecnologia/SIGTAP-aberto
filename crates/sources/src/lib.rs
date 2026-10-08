//! Leitores de fontes oficiais.
//!
//! Fronteira: transformar bytes de uma fonte (ZIP do SIGTAP com `*_layout.txt`, e nas fases
//! seguintes DBC, DBF, JSON, CSV, XLSX) em registros, com o esquema lido da própria fonte. Não
//! grava banco. Limites de memória e de descompressão obrigatórios.

pub mod cnes;
pub mod dbc;
pub mod dbf;
pub mod dcl;
pub mod latin1;
pub mod producao;
pub mod sigtap;
pub mod territorio;
pub mod xlsx;
pub mod zip_parcial;
pub mod zip_seguro;
