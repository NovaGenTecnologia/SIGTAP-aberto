//! Liga o módulo da unidade (`sa-unidade`) ao serviço do aplicativo.

pub use sa_unidade::*;

/// As pastas do aplicativo, como o módulo da unidade as vê.
pub fn local(p: &crate::servico::Pastas) -> Pastas {
    Pastas {
        dados: p.dados.clone(),
    }
}

/// Repassa o andamento para a barra de progresso do aplicativo.
pub fn repassar(emissor: &crate::servico::Emissor) -> impl Fn(Progresso) + Sync + '_ {
    move |x| {
        emissor(crate::servico::Progresso {
            resumo: x.resumo,
            mensagem: x.mensagem,
            fracao: x.fracao,
            indeterminado: x.indeterminado,
        })
    }
}
