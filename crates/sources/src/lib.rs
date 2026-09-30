//! Leitores de fontes oficiais.
//!
//! Fronteira: transformar bytes de uma fonte (ZIP do SIGTAP com `*_layout.txt`,
//! TXT de largura fixa, DBC, DBF, JSON, CSV, XLSX) em registros, com o esquema lido
//! da própria fonte. Não grava banco. Limites de memória e de descompressão obrigatórios.
//! Conteúdo a partir da Fase 1.
