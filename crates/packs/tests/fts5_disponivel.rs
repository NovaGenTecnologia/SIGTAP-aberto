//! O SQLite empacotado precisa ter FTS5 (busca por nome, Fase 2).
#[test]
fn sqlite_empacotado_tem_fts5() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE VIRTUAL TABLE t USING fts5(nome, tokenize='unicode61 remove_diacritics 2'); INSERT INTO t VALUES('CONSULTA MÉDICA EM ATENÇÃO ESPECIALIZADA');").unwrap();
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM t WHERE t MATCH 'atencao medica'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
}
