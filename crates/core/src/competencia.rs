//! Competência (mês de referência AAAAMM) e sua posição numa sequência contínua de meses.
//!
//! A sequência é o número absoluto de meses (`ano * 12 + mes - 1`): não depende de nenhuma
//! competência inicial "conhecida". Intervalos de vigência usam essa sequência.

use std::fmt;

/// Mês de referência (AAAAMM).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Competencia {
    ano: u16,
    mes: u8,
}

/// Erro ao interpretar uma competência.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompetenciaInvalida(pub String);

impl fmt::Display for CompetenciaInvalida {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "competência inválida \"{}\": use o formato AAAAMM, com mês de 01 a 12 (ex.: 202609)",
            self.0
        )
    }
}

impl std::error::Error for CompetenciaInvalida {}

impl Competencia {
    /// Cria a partir de ano e mês. O ano aceito vai de 1900 a 2999.
    pub fn nova(ano: u16, mes: u8) -> Result<Self, CompetenciaInvalida> {
        if !(1900..=2999).contains(&ano) || !(1..=12).contains(&mes) {
            return Err(CompetenciaInvalida(format!("{ano:04}{mes:02}")));
        }
        Ok(Self { ano, mes })
    }

    /// Interpreta `AAAAMM` (exatamente 6 dígitos).
    pub fn de_texto(texto: &str) -> Result<Self, CompetenciaInvalida> {
        let erro = || CompetenciaInvalida(texto.to_string());
        if texto.len() != 6 || !texto.bytes().all(|b| b.is_ascii_digit()) {
            return Err(erro());
        }
        let ano: u16 = texto[..4].parse().map_err(|_| erro())?;
        let mes: u8 = texto[4..].parse().map_err(|_| erro())?;
        Self::nova(ano, mes).map_err(|_| erro())
    }

    /// Posição na sequência contínua de meses.
    pub fn seq(self) -> i64 {
        i64::from(self.ano) * 12 + i64::from(self.mes) - 1
    }

    /// Competência de uma posição da sequência.
    pub fn de_seq(seq: i64) -> Result<Self, CompetenciaInvalida> {
        let erro = || CompetenciaInvalida(format!("sequência {seq}"));
        if seq < 0 {
            return Err(erro());
        }
        let ano = u16::try_from(seq / 12).map_err(|_| erro())?;
        let mes = u8::try_from(seq % 12 + 1).map_err(|_| erro())?;
        Self::nova(ano, mes).map_err(|_| erro())
    }

    pub fn ano(self) -> u16 {
        self.ano
    }

    pub fn mes(self) -> u8 {
        self.mes
    }

    /// Mês seguinte.
    pub fn seguinte(self) -> Result<Self, CompetenciaInvalida> {
        Self::de_seq(self.seq() + 1)
    }
}

impl fmt::Display for Competencia {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}{:02}", self.ano, self.mes)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn texto_e_sequencia_vao_e_voltam() {
        for t in ["200801", "200812", "200901", "202609", "199912", "210001"] {
            let c = Competencia::de_texto(t).unwrap();
            assert_eq!(c.to_string(), t);
            assert_eq!(Competencia::de_seq(c.seq()).unwrap(), c);
        }
    }

    #[test]
    fn sequencia_e_continua_na_virada_do_ano() {
        let dez = Competencia::de_texto("200812").unwrap();
        let jan = Competencia::de_texto("200901").unwrap();
        assert_eq!(jan.seq() - dez.seq(), 1);
        assert_eq!(dez.seguinte().unwrap(), jan);
        let a = Competencia::de_texto("200801").unwrap();
        let b = Competencia::de_texto("202609").unwrap();
        assert_eq!(b.seq() - a.seq() + 1, 225); // 225 competências de 200801 a 202609
    }

    #[test]
    fn recusa_invalidas_com_mensagem_que_orienta() {
        for t in [
            "20260", "2026091", "202613", "202600", "2026-9", "abcdef", "", "180001",
        ] {
            let e = Competencia::de_texto(t).unwrap_err();
            assert!(e.to_string().contains("AAAAMM"), "{e}");
        }
        assert!(Competencia::de_seq(-1).is_err());
    }

    #[test]
    fn ordena_por_tempo() {
        let mut v: Vec<_> = ["202601", "200801", "201512"]
            .iter()
            .map(|t| Competencia::de_texto(t).unwrap())
            .collect();
        v.sort();
        assert_eq!(
            v.iter().map(|c| c.to_string()).collect::<Vec<_>>(),
            ["200801", "201512", "202601"]
        );
    }
}
