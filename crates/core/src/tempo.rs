//! Data e hora em texto, sem dependência externa (registro de proveniência).

use std::time::{SystemTime, UNIX_EPOCH};

/// Dias desde 1970-01-01 → (ano, mês, dia), calendário gregoriano proléptico
/// (algoritmo "days_from_civil" inverso de H. Hinnant).
fn civil(dias: i64) -> (i64, u32, u32) {
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `AAAA-MM-DDThh:mm:ssZ` (UTC) de um instante.
pub fn iso_utc(t: SystemTime) -> String {
    let s = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (a, m, d) = civil(s.div_euclid(86_400));
    let r = s.rem_euclid(86_400);
    format!(
        "{a:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        r / 3600,
        (r % 3600) / 60,
        r % 60
    )
}

/// Agora, em UTC.
pub fn agora_iso_utc() -> String {
    iso_utc(SystemTime::now())
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::time::Duration;

    #[test]
    fn datas_conhecidas() {
        assert_eq!(iso_utc(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(
            iso_utc(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29T00:00:00Z"
        );
        assert_eq!(
            iso_utc(UNIX_EPOCH + Duration::from_secs(1_790_726_400 + 3661)),
            "2026-09-30T01:01:01Z"
        );
    }
}
