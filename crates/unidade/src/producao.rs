//! Produção do SUS (SIA e SIH) para o aplicativo: baixar, somar por estabelecimento e, por padrão,
//! **apagar o arquivo bruto**. Os arquivos `PA`, `RD` e `ER` trazem dado de paciente (CNS do
//! profissional, nascimento, CEP, número da AIH): o banco guarda só totais e o arquivo oficial não
//! fica em disco depois da carga, nem quando a carga falha.
//!
//! **Chave "guardar os arquivos baixados"** (`manter_arquivos_brutos`, no banco do usuário; padrão
//! desligada): ligada pelo usuário, os brutos ficam em `dados\producao\arquivos\<UF>` para o
//! banco ser refeito sem baixar de novo (mudança de esquema, banco apagado). Os arquivos continuam
//! só na máquina do usuário; a tela avisa que têm dado de paciente. Em desenvolvimento,
//! `SA_MANTER_ARQUIVOS_PRODUCAO=1` tem o mesmo efeito.

use crate::{Emissor, Pastas, emitir, exigir_uf};
use sa_core::Competencia;
use sa_download::cnes::Fonte;
use sa_download::cortesia::Evento;
use sa_download::producao as dl;
use sa_packs::cnes::sha256_hex;
use sa_packs::producao::{BancoProducao, Origem as OrigemArquivo};
use sa_query::Consulta;
use sa_query::producao::{ConsultaProducao, Origem};
use sa_sources::dbc;
use sa_sources::producao::Manifesto;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

/// Variável de ambiente só para desenvolvimento: mantém os arquivos brutos depois da carga.
pub const MANTER_ARQUIVOS_PRODUCAO: &str = "SA_MANTER_ARQUIVOS_PRODUCAO";

/// Chave do usuário (tabela `config` do `usuario.db`): "1" guarda os arquivos brutos baixados.
pub const CONFIG_MANTER_BRUTOS: &str = "manter_arquivos_brutos";

/// A chave "guardar os arquivos baixados" está ligada? Padrão: não. Ler não cria o banco do usuário.
pub fn manter_brutos(p: &Pastas) -> bool {
    if std::env::var_os(MANTER_ARQUIVOS_PRODUCAO).is_some() {
        return true;
    }
    if !crate::banco_usuario(p).exists() {
        return false;
    }
    crate::usuario(p)
        .ok()
        .and_then(|u| u.config(CONFIG_MANTER_BRUTOS).ok().flatten())
        .is_some_and(|v| v == "1")
}

/// Liga ou desliga a chave. Desligar **não apaga** o que já está guardado (use "Apagar os arquivos
/// guardados" na tela); só impede guardar os próximos.
pub fn definir_manter_brutos(p: &Pastas, ligada: bool) -> Result<(), String> {
    crate::usuario(p)?
        .gravar_config(CONFIG_MANTER_BRUTOS, Some(if ligada { "1" } else { "0" }))
        .map_err(|e| e.to_string())
}

/// Acima disto o programa pede confirmação antes de baixar (regra do projeto: avisar > 500 MB).
pub const LIMITE_SEM_CONFIRMAR: u64 = 500 * 1024 * 1024;

/// Quantos meses baixar quando o usuário não escolhe.
pub const MESES_PADRAO: usize = 3;

pub fn pasta_producao(p: &Pastas) -> PathBuf {
    p.dados.join("producao")
}
pub fn banco_producao(p: &Pastas, uf: &str) -> PathBuf {
    pasta_producao(p).join(format!("{uf}.db"))
}
/// Pasta de passagem dos arquivos oficiais: fica vazia depois da carga.
pub fn arquivos_producao(p: &Pastas, uf: &str) -> PathBuf {
    pasta_producao(p).join("arquivos").join(uf)
}

/// O que baixar.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PedidoProducao {
    pub uf: String,
    /// Quantos meses, contando do mais recente que o servidor tem para a UF.
    #[serde(default)]
    pub meses: usize,
    /// O usuário viu o tamanho e confirmou um download acima de 500 MB.
    #[serde(default)]
    pub confirmado: bool,
}

/// Um arquivo do plano de download.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ItemDoPlano {
    pub tipo: String,
    pub competencia: String,
    pub arquivo: String,
    pub bytes: u64,
}

/// O que seria baixado, com o tamanho total.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct Plano {
    pub uf: String,
    pub itens: Vec<ItemDoPlano>,
    pub total_bytes: u64,
    pub precisa_confirmar: bool,
}

/// Monta o plano: para cada tipo, as `meses` competências mais recentes que o servidor tem.
pub fn planejar(fonte: &Fonte, uf: &str, meses: usize) -> Result<Plano, String> {
    exigir_uf(uf)?;
    let meses = if meses == 0 { MESES_PADRAO } else { meses };
    let mut itens = Vec::new();
    for tipo in dl::TIPOS {
        let todas = dl::disponiveis(fonte, tipo, uf).map_err(|e| e.to_string())?;
        let desde = todas.len().saturating_sub(meses);
        for (c, partes) in &todas[desde..] {
            for (arquivo, bytes) in partes {
                itens.push(ItemDoPlano {
                    tipo: tipo.into(),
                    competencia: c.to_string(),
                    arquivo: arquivo.clone(),
                    bytes: *bytes,
                });
            }
        }
    }
    if itens.is_empty() {
        return Err(format!(
            "o servidor do DATASUS não tem arquivos de produção de {uf}. Tente mais tarde"
        ));
    }
    let total_bytes: u64 = itens.iter().map(|i| i.bytes).sum();
    Ok(Plano {
        uf: uf.into(),
        itens,
        total_bytes,
        precisa_confirmar: total_bytes > LIMITE_SEM_CONFIRMAR,
    })
}

/// Download grande só com o usuário ciente do tamanho.
fn confirmacao(total: u64, confirmado: bool, limite: u64) -> Result<(), String> {
    if total > limite && !confirmado {
        return Err(format!(
            "o download tem {} MB (acima de {} MB). Confirme em Módulos e dados ou peça menos meses",
            total / (1024 * 1024),
            limite / (1024 * 1024)
        ));
    }
    Ok(())
}

/// Baixa a produção de uma UF do servidor oficial e carrega.
pub fn baixar_producao(
    p: &Pastas,
    pedido: &PedidoProducao,
    cancelar: &AtomicBool,
    emissor: Emissor<'_>,
) -> Result<String, String> {
    baixar_producao_de(&Fonte::oficial(), p, pedido, cancelar, emissor)
}

pub fn baixar_producao_de(
    fonte: &Fonte,
    p: &Pastas,
    pedido: &PedidoProducao,
    cancelar: &AtomicBool,
    emissor: Emissor<'_>,
) -> Result<String, String> {
    let uf = pedido.uf.as_str();
    exigir_uf(uf)?;
    let resumo = format!("Baixando a produção de {uf}");
    emitir(
        emissor,
        &resumo,
        "Consultando o servidor do DATASUS",
        0.0,
        true,
    );
    let plano = planejar(fonte, uf, pedido.meses)?;
    confirmacao(plano.total_bytes, pedido.confirmado, LIMITE_SEM_CONFIRMAR)?;
    let destino = arquivos_producao(p, uf);
    // Com a chave ligada, o que já está guardado (mesmo nome e tamanho) não é baixado de novo.
    let faltam = itens_faltantes(&plano.itens, &destino);
    let etapas = (faltam.len() + plano.itens.len()).max(1) as f64;
    let feitos = std::sync::atomic::AtomicUsize::new(0);
    let progresso = |e: Evento| {
        use std::sync::atomic::Ordering::SeqCst;
        let n = feitos.load(SeqCst) as f64;
        let (msg, parte) = match &e {
            Evento::Iniciando { arquivo, total, .. } => {
                (format!("Baixando {arquivo} ({} KB)", total / 1024), 0.0)
            }
            Evento::Progresso {
                arquivo,
                feito,
                total,
            } => (
                format!("Baixando {arquivo}"),
                if *total > 0 {
                    *feito as f64 / *total as f64
                } else {
                    0.0
                },
            ),
            Evento::NovaTentativa {
                arquivo,
                tentativa,
                espera_s,
                motivo,
            } => (
                format!(
                    "{arquivo}: nova tentativa ({tentativa}) em {espera_s} s. Motivo: {motivo}"
                ),
                0.0,
            ),
            Evento::Concluido { arquivo } => {
                feitos.fetch_add(1, SeqCst);
                (format!("{arquivo} baixado"), 1.0)
            }
        };
        emitir(emissor, &resumo, &msg, (n + parte) / etapas, false);
    };
    // Só o que o plano pede, sem listar o servidor de novo.
    let itens: Vec<dl::ItemRemoto> = faltam
        .iter()
        .map(|i| dl::ItemRemoto {
            tipo: i.tipo.clone(),
            nome: i.arquivo.clone(),
            bytes: i.bytes,
        })
        .collect();
    if !itens.is_empty()
        && let Err(e) = dl::baixar_itens(fonte, &itens, &destino, cancelar, &progresso)
    {
        // O que já veio tem dado de paciente: não fica para trás (a não ser com a chave ligada;
        // o `.parcial` de um download interrompido sai de qualquer jeito).
        limpar_sobras(p, &destino);
        return Err(e.to_string());
    }
    emitir(
        emissor,
        &resumo,
        "Somando por estabelecimento",
        (etapas - 1.0) / etapas,
        false,
    );
    let mut msg = carregar_producao(p, uf, &|t| {
        emitir(emissor, &resumo, t, (etapas - 1.0) / etapas, false)
    })?;
    // As descrições dos motivos só fazem falta se há arquivo de rejeição no plano.
    if plano.itens.iter().any(|i| i.tipo == "ER") {
        msg.push_str(&motivos_do_servidor(fonte, p, uf, cancelar, &mut |_| {}));
    }
    msg.push_str(&auxiliares_do_servidor(fonte, p, uf, cancelar));
    Ok(msg)
}

/// Depois de uma falha no download: sem a chave, apaga tudo; com a chave, só os `.parcial`.
fn limpar_sobras(p: &Pastas, pasta: &Path) {
    if manter_brutos(p) {
        if let Ok(dir) = std::fs::read_dir(pasta) {
            for e in dir.flatten() {
                if e.file_name().to_string_lossy().ends_with(".parcial") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        return;
    }
    limpar_arquivos_sempre(pasta);
}

/// Dos itens do plano, os que ainda não estão guardados na pasta com o mesmo tamanho.
pub fn itens_faltantes(itens: &[ItemDoPlano], pasta: &Path) -> Vec<ItemDoPlano> {
    itens
        .iter()
        .filter(|i| !std::fs::metadata(pasta.join(&i.arquivo)).is_ok_and(|m| m.len() == i.bytes))
        .cloned()
        .collect()
}

/// Apaga tudo o que há na pasta de passagem (arquivos completos e `.parcial`).
fn limpar_arquivos_sempre(pasta: &Path) {
    if let Ok(dir) = std::fs::read_dir(pasta) {
        for e in dir.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Carrega os `.dbc` que estão na pasta de passagem e **apaga cada um logo depois**, com sucesso
/// ou não (a não ser com `SA_MANTER_ARQUIVOS_PRODUCAO`).
pub fn carregar_producao(p: &Pastas, uf: &str, avisar: &dyn Fn(&str)) -> Result<String, String> {
    carregar_de(p, uf, manter_brutos(p), avisar)
}

/// Refaz o banco de produção da UF **dos arquivos guardados, sem baixar nada** (mudança de esquema,
/// banco apagado, manifesto novo). Nunca apaga os brutos. As descrições dos motivos de rejeição
/// voltam do `MOTERRO.dbf` guardado junto, se houver.
pub fn reconstruir_producao(p: &Pastas, uf: &str, emissor: Emissor<'_>) -> Result<String, String> {
    exigir_uf(uf)?;
    let pasta = arquivos_producao(p, uf);
    if dl::locais(&pasta, uf).is_empty() {
        return Err(format!(
            "não há arquivos de produção de {uf} guardados em {}. Ligue \"Guardar os arquivos baixados\" em Módulos e dados e baixe de novo: da próxima vez eles ficam",
            pasta.display()
        ));
    }
    let resumo = format!("Refazendo a produção de {uf} dos arquivos guardados");
    emitir(emissor, &resumo, "Somando os arquivos guardados", 0.1, true);
    let mut msg = carregar_de(p, uf, true, &|t| emitir(emissor, &resumo, t, 0.5, false))?;
    msg.push_str(&auxiliares_guardados(p, uf));
    if let Some(Ok(dbf)) = moterro_da_pasta(&pasta) {
        match gravar_moterro(p, uf, &dbf, "guardado") {
            Ok(n) => msg.push_str(&format!(
                " Motivos de rejeição: {n} descrições oficiais carregadas."
            )),
            Err(e) => msg.push_str(&format!(
                " A tabela de motivos guardada foi recusada ({e})."
            )),
        }
    }
    Ok(msg)
}

/// Quantos arquivos e bytes de produção estão guardados para a UF.
pub fn guardados(p: &Pastas, uf: &str) -> (usize, u64) {
    dl::locais(&arquivos_producao(p, uf), uf)
        .values()
        .map(|(_, _, c)| std::fs::metadata(c).map_or(0, |m| m.len()))
        .fold((0, 0), |(n, b), t| (n + 1, b + t))
}

/// Apaga os arquivos guardados da UF (o banco de totais fica).
pub fn apagar_guardados(p: &Pastas, uf: &str) -> Result<String, String> {
    exigir_uf(uf)?;
    let (n, b) = guardados(p, uf);
    limpar_arquivos_sempre(&arquivos_producao(p, uf));
    Ok(format!(
        "{n} arquivo(s) guardados de {uf} apagados ({} MB liberados).",
        b / (1024 * 1024)
    ))
}

fn carregar_de(
    p: &Pastas,
    uf: &str,
    manter: bool,
    avisar: &dyn Fn(&str),
) -> Result<String, String> {
    carregar_com(p, uf, manter, avisar, &Manifesto::carregar())
}

fn carregar_com(
    p: &Pastas,
    uf: &str,
    manter: bool,
    avisar: &dyn Fn(&str),
    m: &Manifesto,
) -> Result<String, String> {
    exigir_uf(uf)?;
    let pasta = arquivos_producao(p, uf);
    let locais = dl::locais(&pasta, uf);
    if locais.is_empty() {
        return Err(format!(
            "não há arquivos de produção de {uf} para carregar em {}",
            pasta.display()
        ));
    }
    std::fs::create_dir_all(pasta_producao(p)).map_err(|e| {
        format!(
            "não foi possível criar {} ({e})",
            pasta_producao(p).display()
        )
    })?;
    let mut banco = BancoProducao::abrir(&banco_producao(p, uf)).map_err(|e| e.to_string())?;
    let (mut linhas, mut arquivos) = (0usize, 0usize);
    let mut erros: Vec<(String, String)> = Vec::new();
    let mut avisos: Vec<String> = Vec::new();
    for (nome, (tipo, _, caminho)) in &locais {
        avisar(&format!("Somando {nome}"));
        let r = std::fs::read(caminho)
            .map_err(|e| format!("{nome}: {e}"))
            .and_then(|bruto| {
                let dbf = dbc::para_dbf(&bruto, dbc::LIMITE_PADRAO)
                    .map_err(|e| format!("{nome}: {e}"))?;
                banco
                    .carregar(
                        m,
                        tipo,
                        &OrigemArquivo {
                            uf,
                            arquivo: nome,
                            sha256: &sha256_hex(&bruto),
                            bytes: bruto.len() as u64,
                        },
                        &dbf,
                    )
                    .map_err(|e| e.to_string())
            });
        // O arquivo oficial tem dado de paciente: sai de disco, deu certo ou não.
        if !manter {
            let _ = std::fs::remove_file(caminho);
        }
        match r {
            Ok(c) => {
                linhas += c.gravadas;
                arquivos += 1;
                avisos.extend(c.avisos);
            }
            Err(e) => erros.push((nome.clone(), e)),
        }
    }
    // Sobras (um download interrompido deixa `.parcial`) também têm dado de paciente.
    if !manter {
        limpar_arquivos_sempre(&pasta);
    }
    if arquivos > 0 {
        // Os totais da UF (para as telas abrirem rápido) são refeitos uma vez, no fim da carga.
        avisar("Calculando os totais da UF");
        banco.garantir_totais().map_err(|e| e.to_string())?;
    }
    if arquivos == 0 {
        return Err(format!(
            "nenhum arquivo de produção de {uf} foi carregado: {}. Os arquivos oficiais foram apagados; baixe de novo",
            resumir_erros(&erros)
        ));
    }
    let mut msg = format!(
        "Produção de {uf} carregada: {arquivos} arquivo(s), {linhas} totais por estabelecimento e procedimento."
    );
    if !erros.is_empty() {
        msg.push_str(&format!(
            " {} arquivo(s) recusado(s): {}.",
            erros.len(),
            resumir_erros(&erros)
        ));
    }
    if !avisos.is_empty() {
        msg.push_str(&format!(" Atenção: {}.", avisos.join("; ")));
    }
    let mut sem_conferir: Vec<String> = banco
        .arquivos()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|a| !a.confirmado)
        .map(|a| a.tipo)
        .collect();
    sem_conferir.sort();
    sem_conferir.dedup();
    if !sem_conferir.is_empty() {
        msg.push_str(&format!(
            " Atenção: os nomes dos campos de {} ainda não foram conferidos com um arquivo oficial real; confira os totais no TabNet antes de confiar.",
            sem_conferir.join(", ")
        ));
    }
    Ok(msg)
}

/// Grava a tabela de motivos de rejeição (DBF do MOTERRO) no banco de produção da UF.
fn gravar_moterro(p: &Pastas, uf: &str, dbf: &[u8], arquivo: &str) -> Result<usize, String> {
    let m = Manifesto::carregar()
        .moterro
        .ok_or("o manifesto de produção não diz onde está o MOTERRO")?;
    let motivos = m.motivos(dbf)?;
    if motivos.is_empty() {
        return Err("a tabela de motivos veio vazia".into());
    }
    let mut banco = BancoProducao::abrir(&banco_producao(p, uf)).map_err(|e| e.to_string())?;
    banco
        .gravar_moterro(&motivos, arquivo)
        .map_err(|e| e.to_string())?;
    Ok(motivos.len())
}

/// Baixa só a tabela de motivos do `TAB_SIH.zip` e grava. Texto para a mensagem final; falha não
/// derruba a carga (a tela mostra o código do motivo sem descrição).
fn motivos_do_servidor(
    fonte: &Fonte,
    p: &Pastas,
    uf: &str,
    cancelar: &AtomicBool,
    progresso: &mut impl FnMut(Evento),
) -> String {
    let Some(m) = Manifesto::carregar().moterro else {
        return String::new();
    };
    match dl::baixar_moterro(fonte, &m, cancelar, &mut *progresso)
        .map_err(|e| e.to_string())
        .and_then(|dbf| {
            // A tabela de motivos não tem dado de paciente: com a chave ligada, fica guardada para
            // reconstruir o banco sem rede.
            if manter_brutos(p) {
                let pasta = arquivos_producao(p, uf);
                let _ = std::fs::create_dir_all(&pasta);
                let _ = std::fs::write(pasta.join("MOTERRO.dbf"), &dbf);
            }
            gravar_moterro(p, uf, &dbf, "TAB_SIH.zip")
        }) {
        Ok(n) => format!(" Motivos de rejeição: {n} descrições oficiais carregadas."),
        Err(e) => format!(
            " Não consegui carregar a tabela de motivos de rejeição ({e}); a tela mostra só o código do motivo. Tente de novo mais tarde."
        ),
    }
}

/// Nome com que uma tabela auxiliar fica guardada (junto dos brutos, só com a chave ligada).
fn arquivo_auxiliar(p: &Pastas, uf: &str, entrada: &str) -> PathBuf {
    arquivos_producao(p, uf).join(format!("aux_{entrada}"))
}

/// Lê uma tabela auxiliar e a grava no banco da UF. Devolve quantos itens entraram.
fn gravar_auxiliar_bytes(
    p: &Pastas,
    uf: &str,
    a: &sa_sources::producao::Auxiliar,
    bytes: &[u8],
) -> Result<usize, String> {
    use sa_sources::producao::ConteudoAuxiliar;
    let conteudo = a.ler(bytes)?;
    let mut banco = BancoProducao::abrir(&banco_producao(p, uf)).map_err(|e| e.to_string())?;
    let zip = a.zip.rsplit('/').next().unwrap_or(&a.zip);
    match conteudo {
        ConteudoAuxiliar::Codigos(c) => {
            banco
                .gravar_auxiliar(&a.tabela, &c, zip)
                .map_err(|e| e.to_string())?;
            Ok(c.len())
        }
        ConteudoAuxiliar::Vigencias(v) => {
            banco.gravar_vigencias(&v, zip).map_err(|e| e.to_string())?;
            Ok(v.len())
        }
    }
}

/// Baixa dos ZIPs do FTP só as tabelas auxiliares (CODOCO, INDICA, DOCORIG, vigência das críticas) e
/// grava. Texto para a mensagem final; falha não derruba a carga (a tela mostra o código sem descrição).
fn auxiliares_do_servidor(fonte: &Fonte, p: &Pastas, uf: &str, cancelar: &AtomicBool) -> String {
    let m = Manifesto::carregar();
    let mut por_zip: std::collections::BTreeMap<&str, Vec<&sa_sources::producao::Auxiliar>> =
        std::collections::BTreeMap::new();
    for a in &m.auxiliar {
        por_zip.entry(a.zip.as_str()).or_default().push(a);
    }
    let (mut itens, mut falhas) = (0usize, Vec::new());
    for (zip, auxs) in por_zip {
        let nomes: Vec<String> = auxs.iter().map(|a| a.entrada.clone()).collect();
        let baixadas = match dl::entradas_de_zip_remoto(fonte, zip, &nomes, cancelar, |_| {}) {
            Ok(b) => b,
            Err(e) => {
                falhas.push(e.to_string());
                continue;
            }
        };
        for a in auxs {
            let Some(bytes) = baixadas.get(&a.entrada) else {
                falhas.push(format!("{} não está em {zip}", a.entrada));
                continue;
            };
            if manter_brutos(p) {
                let _ = std::fs::create_dir_all(arquivos_producao(p, uf));
                let _ = std::fs::write(arquivo_auxiliar(p, uf, &a.entrada), bytes);
            }
            match gravar_auxiliar_bytes(p, uf, a, bytes) {
                Ok(n) => itens += n,
                Err(e) => falhas.push(format!("{}: {e}", a.entrada)),
            }
        }
    }
    let mut msg = format!(" Tabelas auxiliares: {itens} descrições oficiais carregadas.");
    if !falhas.is_empty() {
        msg.push_str(&format!(
            " Algumas tabelas auxiliares não vieram ({}); a tela mostra só o código. Tente de novo mais tarde.",
            falhas.join("; ")
        ));
    }
    msg
}

/// Recarrega as tabelas auxiliares guardadas (reconstruir sem rede). Vazio se não há nenhuma.
fn auxiliares_guardados(p: &Pastas, uf: &str) -> String {
    let m = Manifesto::carregar();
    let mut itens = 0usize;
    let mut achou = false;
    for a in &m.auxiliar {
        let Ok(bytes) = std::fs::read(arquivo_auxiliar(p, uf, &a.entrada)) else {
            continue;
        };
        achou = true;
        if let Ok(n) = gravar_auxiliar_bytes(p, uf, a, &bytes) {
            itens += n;
        }
    }
    if achou {
        format!(" Tabelas auxiliares: {itens} descrições oficiais carregadas.")
    } else {
        String::new()
    }
}

/// `TAB_SIH.zip` ou `MOTERRO.dbf` soltos numa pasta (importação manual).
fn moterro_da_pasta(origem: &Path) -> Option<Result<Vec<u8>, String>> {
    let m = Manifesto::carregar().moterro?;
    for e in std::fs::read_dir(origem).ok()?.flatten() {
        let nome = e.file_name().to_string_lossy().to_ascii_lowercase();
        if nome == "moterro.dbf" {
            return Some(std::fs::read(e.path()).map_err(|x| x.to_string()));
        }
        if nome == "tab_sih.zip" {
            return Some(
                std::fs::read(e.path())
                    .map_err(|x| x.to_string())
                    .and_then(|z| dl::moterro_de_zip(&z, &m)),
            );
        }
    }
    None
}

/// Junta recusas iguais (o mesmo defeito em vários meses) numa frase só, em vez de repeti-la por arquivo.
fn resumir_erros(erros: &[(String, String)]) -> String {
    let mut grupos: Vec<(String, Vec<&str>)> = Vec::new();
    for (nome, msg) in erros {
        let chave = msg.replace(nome.as_str(), "{arquivo}");
        match grupos.iter_mut().find(|g| g.0 == chave) {
            Some(g) => g.1.push(nome),
            None => grupos.push((chave, vec![nome])),
        }
    }
    grupos
        .into_iter()
        .map(|(chave, nomes)| {
            if nomes.len() == 1 {
                chave.replace("{arquivo}", nomes[0])
            } else {
                format!(
                    "{} arquivos ({} a {}): {}",
                    nomes.len(),
                    nomes[0],
                    nomes[nomes.len() - 1],
                    chave.replace("{arquivo}", "cada um")
                )
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Importação manual: `.dbc` de produção que o usuário baixou por conta própria. A cópia que o
/// programa faz é apagada depois da carga; a pasta do usuário não é tocada.
pub fn importar_producao(
    p: &Pastas,
    origem: &Path,
    uf: &str,
    emissor: Emissor<'_>,
) -> Result<String, String> {
    exigir_uf(uf)?;
    let resumo = format!("Importando a produção de {uf}");
    emitir(
        emissor,
        &resumo,
        "Conferindo os arquivos da pasta",
        0.1,
        false,
    );
    let r = dl::importar_pasta(origem, &arquivos_producao(p, uf), uf).map_err(|e| e.to_string())?;
    let moterro = moterro_da_pasta(origem);
    if r.dbc.is_empty() {
        // Só a tabela de motivos na pasta: carrega ela (o banco de produção precisa existir).
        if let Some(Ok(dbf)) = &moterro
            && banco_producao(p, uf).exists()
        {
            let n = gravar_moterro(p, uf, dbf, "importado")?;
            return Ok(format!(
                "Motivos de rejeição de {uf}: {n} descrições oficiais carregadas."
            ));
        }
        let recusas = if r.recusados.is_empty() {
            String::new()
        } else {
            format!(
                " Recusados: {}.",
                r.recusados
                    .iter()
                    .map(|(n, m)| format!("{n} ({m})"))
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        };
        return Err(format!(
            "não achei arquivos de produção de {uf} em {}. Esperados: PA{uf}AAMMx.dbc (SIA), RD{uf}AAMM.dbc e ER{uf}AAMM.dbc (SIH).{recusas}",
            origem.display()
        ));
    }
    let mut msg = carregar_producao(p, uf, &|t| emitir(emissor, &resumo, t, 0.6, false))?;
    match moterro {
        Some(Ok(dbf)) => match gravar_moterro(p, uf, &dbf, "importado") {
            Ok(n) => msg.push_str(&format!(
                " Motivos de rejeição: {n} descrições oficiais carregadas."
            )),
            Err(e) => msg.push_str(&format!(
                " A tabela de motivos da pasta foi recusada ({e})."
            )),
        },
        Some(Err(e)) => msg.push_str(&format!(
            " A tabela de motivos da pasta foi recusada ({e})."
        )),
        None => {}
    }
    Ok(msg)
}

/// UFs com banco de produção.
pub fn ufs_com_producao(p: &Pastas) -> Vec<String> {
    sa_download::cnes::UFS
        .iter()
        .filter(|uf| banco_producao(p, uf).exists())
        .map(|uf| uf.to_string())
        .collect()
}

/// Situação para "Módulos e dados": por UF, os arquivos carregados.
pub fn situacao_producao(p: &Pastas) -> serde_json::Value {
    let ufs: Vec<serde_json::Value> = ufs_com_producao(p)
        .iter()
        .map(|uf| {
            match BancoProducao::abrir(&banco_producao(p, uf)).and_then(|b| b.arquivos()) {
                Ok(arqs) => serde_json::json!({
                    "uf": uf,
                    "arquivos": arqs,
                    "guardados": { "arquivos": guardados(p, uf).0, "bytes": guardados(p, uf).1 },
                    "defasagem": defasagem_da_uf(p, uf),
                    "bytes_banco": std::fs::metadata(banco_producao(p, uf)).map(|m| m.len()).unwrap_or(0),
                }),
                Err(e) => serde_json::json!({"uf": uf, "erro": e.to_string()}),
            }
        })
        .collect();
    serde_json::json!({ "ufs": ufs, "manter_brutos": manter_brutos(p) })
}

/// Até quando a produção de uma UF vai (últimos meses completos de cada sistema) e quais meses foram
/// baixados antes dos campos do esquema 2 (para a tela oferecer baixar de novo).
fn defasagem_da_uf(p: &Pastas, uf: &str) -> serde_json::Value {
    let Ok(q) = ConsultaProducao::abrir(&banco_producao(p, uf)) else {
        return serde_json::Value::Null;
    };
    let ultima = |o: Origem| -> Option<String> {
        q.cobertura(o)
            .ok()
            .and_then(|c| sa_query::faturamento::janela(&c, 1).pop())
    };
    let incompleto = |o: Origem| -> Option<String> {
        q.cobertura(o).ok().and_then(|c| {
            c.last()
                .filter(|m| !m.completo)
                .map(|m| m.competencia.clone())
        })
    };
    serde_json::json!({
        "sia_ate": ultima(Origem::Ambulatorial),
        "sih_ate": ultima(Origem::Hospitalar),
        "sia_incompleto": incompleto(Origem::Ambulatorial),
        "sih_incompleto": incompleto(Origem::Hospitalar),
        "sem_campos_novos": q.sem_campos_novos().unwrap_or_default(),
    })
}

/// Apaga a produção de uma UF (banco e qualquer arquivo de passagem). Pode ser baixada de novo.
pub fn apagar_producao(p: &Pastas, uf: &str) -> Result<String, String> {
    exigir_uf(uf)?;
    let db = banco_producao(p, uf);
    if db.exists() {
        std::fs::remove_file(&db).map_err(|e| {
            format!(
                "não foi possível apagar {} ({e}). Feche outros programas que usem a pasta e tente de novo",
                db.display()
            )
        })?;
    }
    let arqs = arquivos_producao(p, uf);
    if arqs.exists() {
        std::fs::remove_dir_all(&arqs).map_err(|e| {
            format!(
                "o banco foi apagado, mas não os arquivos em {} ({e})",
                arqs.display()
            )
        })?;
    }
    Ok(format!(
        "Produção de {uf} apagada. Para usar de novo, baixe em Módulos e dados."
    ))
}

/// Abre as consultas de produção de uma UF; erro com orientação se ela não foi baixada.
pub fn consulta_producao(p: &Pastas, uf: &str) -> Result<ConsultaProducao, String> {
    exigir_uf(uf)?;
    if !banco_producao(p, uf).exists() {
        return Err(format!(
            "a produção de {uf} não está carregada. Baixe em Módulos e dados"
        ));
    }
    ConsultaProducao::abrir(&banco_producao(p, uf)).map_err(|e| e.to_string())
}

/// O que seria baixado (tamanho incluído), para a tela pedir confirmação.
pub fn plano_producao(uf: &str, meses: usize) -> Result<serde_json::Value, String> {
    let plano = planejar(&Fonte::oficial(), uf, meses)?;
    serde_json::to_value(plano).map_err(|e| e.to_string())
}

fn uf_do_pedido(p: &Pastas, uf: Option<&str>) -> Result<String, String> {
    match uf {
        Some(u) => {
            exigir_uf(u)?;
            Ok(u.to_string())
        }
        None => crate::minha(p).map(|(u, _)| u).ok_or_else(|| {
            "nenhuma unidade escolhida. Escolha a sua unidade em Minha unidade".to_string()
        }),
    }
}

const AVISO_PRODUCAO: &str = "Produção apresentada e aprovada no SIA e AIH aprovadas no SIH, somadas nas competências carregadas. Quem produziu um procedimento não prova que a unidade possa cobrá-lo hoje.";

/// Quem produziu um procedimento na UF (a da unidade escolhida, se `uf` não vem), com o nome do
/// estabelecimento (CNES carregado) e o confronto com a regra de aptidão.
pub fn producao_do_procedimento(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    procedimento: &str,
    uf: Option<&str>,
) -> Result<serde_json::Value, String> {
    let uf = uf_do_pedido(p, uf)?;
    let Ok(q) = consulta_producao(p, &uf) else {
        return Ok(serde_json::json!({
            "disponivel": false,
            "uf": uf,
            "mensagem": format!("A produção de {uf} não está carregada. Baixe em Módulos e dados para ver quem produz."),
        }));
    };
    let cnes_db = crate::consulta_cnes(p, &uf).ok();
    let nome = |cnes: &str| -> serde_json::Value {
        let e = cnes_db
            .as_ref()
            .and_then(|c| c.buscar(cnes, 1).ok())
            .and_then(|v| v.into_iter().find(|e| e.cnes == cnes));
        match e {
            Some(e) => {
                serde_json::json!({ "nome": e.nome, "municipio": e.municipio, "municipio_nome": crate::nome_municipio(p, &e.municipio), "tipo_nome": e.tipo_nome })
            }
            None => serde_json::json!({ "nome": null }),
        }
    };
    let minha = crate::minha(p).filter(|(u, _)| *u == uf).map(|(_, c)| c);
    let mut saida = serde_json::json!({ "disponivel": true, "uf": uf, "aviso": AVISO_PRODUCAO });
    for origem in [Origem::Ambulatorial, Origem::Hospitalar] {
        let r = q
            .produtores(origem, procedimento, 15)
            .map_err(|e| e.to_string())?;
        let lista: Vec<serde_json::Value> = r
            .lista
            .iter()
            .map(|x| {
                let mut v = serde_json::to_value(x).unwrap_or_default();
                v["estabelecimento"] = nome(&x.cnes);
                v["minha"] = serde_json::json!(minha.as_deref() == Some(x.cnes.as_str()));
                v
            })
            .collect();
        let mut v = serde_json::to_value(&r).map_err(|e| e.to_string())?;
        v["lista"] = serde_json::json!(lista);
        saida[origem.sistema()] = v;
    }
    if let Some(c) = &minha {
        let u = q.da_unidade(c, 5000).map_err(|e| e.to_string())?;
        let cod = sa_query::ficha::normalizar_codigo(procedimento).map_err(|e| e.to_string())?;
        let qtd = |v: &[sa_query::producao::ProcedimentoProduzido]| {
            v.iter()
                .find(|x| x.procedimento == cod)
                .map_or(0, |x| x.quantidade)
        };
        saida["minha"] = serde_json::json!({
            "cnes": c,
            "sia": qtd(&u.ambulatorial),
            "sih": qtd(&u.hospitalar),
        });
    }
    let resumo = q.resumo().map_err(|e| e.to_string())?;
    saida["competencias_sia"] = serde_json::json!(resumo.competencias_sia);
    saida["competencias_sih"] = serde_json::json!(resumo.competencias_sih);
    saida["campos_confirmados"] = serde_json::json!(resumo.campos_confirmados);
    if let Some(c) = &cnes_db {
        let produtores = q.quem_produziu(procedimento).map_err(|e| e.to_string())?;
        saida["confronto"] = serde_json::to_value(
            c.confronto_producao(sig, comp, procedimento, &produtores)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        saida["peso_exigencias"] = serde_json::to_value(
            c.peso_das_exigencias(sig, comp, procedimento, &produtores)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(saida)
}

/// O que a unidade (a `alvo` ou a ativa) produziu e o que o SIH rejeitou nela, com o nome do
/// procedimento na competência do SIGTAP.
pub fn producao_da_unidade(
    p: &Pastas,
    sig: &Consulta,
    comp: Competencia,
    alvo: Option<(&str, &str)>,
) -> Result<serde_json::Value, String> {
    let (uf, cnes) = match alvo {
        Some((u, c)) => {
            exigir_uf(u)?;
            (u.to_string(), c.to_string())
        }
        None => crate::minha(p).ok_or_else(|| {
            "nenhuma unidade escolhida. Escolha a sua unidade em Minha unidade".to_string()
        })?,
    };
    let Ok(q) = consulta_producao(p, &uf) else {
        return Ok(serde_json::json!({
            "disponivel": false,
            "uf": uf,
            "mensagem": format!("A produção de {uf} não está carregada. Baixe em Módulos e dados para ver o que a unidade produziu e o que foi rejeitado."),
        }));
    };
    let u = q.da_unidade(&cnes, 200).map_err(|e| e.to_string())?;
    let com_nome = |v: &[sa_query::producao::ProcedimentoProduzido]| -> Vec<serde_json::Value> {
        v.iter()
            .map(|x| {
                let mut j = serde_json::to_value(x).unwrap_or_default();
                j["nome"] =
                    serde_json::json!(sig.nome_procedimento(comp, &x.procedimento).ok().flatten());
                j
            })
            .collect()
    };
    let resumo = q.resumo().map_err(|e| e.to_string())?;
    let mut v = serde_json::to_value(&u).map_err(|e| e.to_string())?;
    v["disponivel"] = serde_json::json!(true);
    v["uf"] = serde_json::json!(uf);
    v["aviso"] = serde_json::json!(AVISO_PRODUCAO);
    v["ambulatorial"] = serde_json::json!(com_nome(&u.ambulatorial));
    v["hospitalar"] = serde_json::json!(com_nome(&u.hospitalar));
    v["campos_confirmados"] = serde_json::json!(resumo.campos_confirmados);
    v["tem_rejeicoes"] = serde_json::json!(!resumo.competencias_rejeicao.is_empty());
    Ok(v)
}

#[cfg(test)]
mod testes {
    use super::*;
    use sa_packs::producao::sintetico;
    use sa_sources::dbc::de_dbf_sintetico;
    use std::collections::BTreeMap;

    fn pastas(nome: &str) -> Pastas {
        let d = std::env::temp_dir().join(format!("sa_un_prod_{nome}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        Pastas { dados: d }
    }

    fn l(v: &[&str]) -> Vec<String> {
        v.iter().map(ToString::to_string).collect()
    }

    fn dbc_pa(qtd: &str, cns: &str) -> Vec<u8> {
        de_dbf_sintetico(&sintetico::dbf(
            &[
                ("PA_CODUNI", 7),
                ("PA_MVM", 6),
                ("PA_PROC_ID", 10),
                ("PA_QTDAPR", 8),
                ("PA_VALAPR", 12),
                ("PA_CNSMED", 15),
            ],
            &[l(&["2000001", "202607", "0301010072", qtd, "1.00", cns])],
        ))
    }

    fn dbc_rd() -> Vec<u8> {
        de_dbf_sintetico(&sintetico::dbf(
            &[
                ("CNES", 7),
                ("ANO_CMPT", 4),
                ("MES_CMPT", 2),
                ("PROC_REA", 10),
                ("VAL_TOT", 12),
                ("N_AIH", 13),
            ],
            &[l(&[
                "2000001",
                "2026",
                "07",
                "0407040064",
                "100.00",
                "5026000000011",
            ])],
        ))
    }

    fn soma_amb(p: &Pastas, uf: &str) -> i64 {
        BancoProducao::abrir(&banco_producao(p, uf))
            .unwrap()
            .conexao()
            .query_row("SELECT coalesce(sum(qtd),0) FROM prod_amb", [], |r| {
                r.get(0)
            })
            .unwrap()
    }

    fn arquivos_que_sobram(p: &Pastas, uf: &str) -> Vec<String> {
        std::fs::read_dir(arquivos_producao(p, uf))
            .map(|d| {
                d.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn depois_da_carga_nao_resta_arquivo_oficial_em_disco() {
        let p = pastas("priv");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "898000000000001")).unwrap();
        std::fs::write(pasta.join("RDMS2607.dbc"), dbc_rd()).unwrap();
        let msg = carregar_de(&p, "MS", false, &|_| {}).unwrap();
        assert!(msg.contains("2 arquivo(s)"), "{msg}");
        assert!(
            !msg.contains("ainda não foram conferidos"),
            "PA e RD têm os nomes vistos em arquivo real: {msg}"
        );
        assert_eq!(arquivos_que_sobram(&p, "MS"), Vec::<String>::new());
        assert_eq!(soma_amb(&p, "MS"), 7);
        // O CNS do profissional não está em lugar nenhum do banco.
        let bytes = std::fs::read(banco_producao(&p, "MS")).unwrap();
        assert!(!bytes.windows(15).any(|w| w == b"898000000000001"));
    }

    #[test]
    fn recusas_iguais_viram_uma_frase_e_er_avisa_que_nao_foi_conferido() {
        let p = pastas("agrupa");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        let sem_campos = de_dbf_sintetico(&sintetico::dbf(&[("OUTRO", 4)], &[l(&["x"])]));
        for mes in ["2605", "2606", "2607"] {
            std::fs::write(pasta.join(format!("RDMS{mes}.dbc")), &sem_campos).unwrap();
        }
        let msg = carregar_de(&p, "MS", false, &|_| {}).unwrap();
        assert!(
            msg.contains("3 arquivo(s) recusado(s): 3 arquivos (RDMS2605.dbc a RDMS2607.dbc)"),
            "{msg}"
        );
        assert_eq!(
            msg.matches("faltam os campos").count(),
            1,
            "a mesma frase não se repete: {msg}"
        );
        // Um ER carregado (nomes ainda não vistos funcionando) pede conferência.
        let er = de_dbf_sintetico(&sintetico::dbf(
            &[("CNES", 7), ("ANO", 4), ("MES", 2), ("CO_ERRO", 3)],
            &[l(&["2000001", "2026", "07", "023"])],
        ));
        std::fs::write(pasta.join("ERMS2607.dbc"), er).unwrap();
        let msg = carregar_de(&p, "MS", false, &|_| {}).unwrap();
        assert!(
            !msg.contains("ainda não foram conferidos"),
            "ER tem os nomes vistos em arquivo real: {msg}"
        );
        // Com um manifesto em que o ER não foi conferido, a mensagem pede conferência.
        let mut m = Manifesto::carregar();
        m.tipos
            .iter_mut()
            .find(|t| t.codigo == "ER")
            .unwrap()
            .confirmado = false;
        let er = de_dbf_sintetico(&sintetico::dbf(
            &[("CNES", 7), ("ANO", 4), ("MES", 2), ("CO_ERRO", 3)],
            &[l(&["2000001", "2026", "07", "023"])],
        ));
        std::fs::write(pasta.join("ERMS2607.dbc"), er).unwrap();
        let msg = carregar_com(&p, "MS", false, &|_| {}, &m).unwrap();
        assert!(
            msg.contains("nomes dos campos de ER ainda não foram conferidos"),
            "{msg}"
        );
    }

    #[test]
    fn com_a_variavel_de_desenvolvimento_os_arquivos_ficam() {
        let p = pastas("manter");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        carregar_de(&p, "MS", true, &|_| {}).unwrap();
        assert_eq!(arquivos_que_sobram(&p, "MS"), ["PAMS2607a.dbc"]);
    }

    #[test]
    fn arquivo_recusado_tambem_e_apagado_e_a_mensagem_orienta() {
        let p = pastas("recusa");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        let sem_campos = de_dbf_sintetico(&sintetico::dbf(&[("OUTRO", 4)], &[l(&["x"])]));
        std::fs::write(pasta.join("PAMS2607a.dbc"), sem_campos).unwrap();
        let e = carregar_de(&p, "MS", false, &|_| {}).unwrap_err();
        assert!(e.contains("baixe de novo") && e.contains("PA_MVM"), "{e}");
        assert!(arquivos_que_sobram(&p, "MS").is_empty());
    }

    #[test]
    fn um_arquivo_bom_e_um_ruim_carregam_o_bom_e_avisam() {
        let p = pastas("misto");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        let sem_campos = de_dbf_sintetico(&sintetico::dbf(&[("OUTRO", 4)], &[l(&["x"])]));
        std::fs::write(pasta.join("RDMS2607.dbc"), sem_campos).unwrap();
        let msg = carregar_de(&p, "MS", false, &|_| {}).unwrap();
        assert!(msg.contains("1 arquivo(s) recusado(s)"), "{msg}");
        assert_eq!(soma_amb(&p, "MS"), 7);
    }

    #[test]
    fn importacao_manual_nao_toca_na_pasta_do_usuario_e_nao_deixa_copia() {
        let p = pastas("imp");
        let orig = std::env::temp_dir().join(format!("sa_un_prod_orig_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&orig);
        std::fs::create_dir_all(&orig).unwrap();
        std::fs::write(orig.join("PAMS2607a.dbc"), dbc_pa("9", "")).unwrap();
        let msg = importar_producao(&p, &orig, "MS", &|_| {}).unwrap();
        assert!(msg.contains("1 arquivo(s)"), "{msg}");
        assert!(
            orig.join("PAMS2607a.dbc").exists(),
            "o original do usuário fica"
        );
        assert!(arquivos_que_sobram(&p, "MS").is_empty());
        assert_eq!(soma_amb(&p, "MS"), 9);
        let e = importar_producao(
            &p,
            &std::env::temp_dir().join("nao_existe_sa"),
            "MS",
            &|_| {},
        )
        .unwrap_err();
        assert!(e.contains("Esperados: PAMS"), "{e}");
    }

    #[test]
    fn apagar_uma_uf_nao_mexe_na_outra() {
        let p = pastas("apagar");
        for uf in ["MS", "MT"] {
            let pasta = arquivos_producao(&p, uf);
            std::fs::create_dir_all(&pasta).unwrap();
            std::fs::write(pasta.join(format!("PA{uf}2607a.dbc")), dbc_pa("1", "")).unwrap();
            carregar_de(&p, uf, false, &|_| {}).unwrap();
        }
        assert_eq!(ufs_com_producao(&p), ["MS", "MT"]);
        apagar_producao(&p, "MS").unwrap();
        assert_eq!(ufs_com_producao(&p), ["MT"]);
        assert_eq!(soma_amb(&p, "MT"), 1);
    }

    #[test]
    fn download_acima_de_500_mb_pede_confirmacao() {
        let mb = 1024 * 1024;
        assert!(confirmacao(500 * mb, false, LIMITE_SEM_CONFIRMAR).is_ok());
        let e = confirmacao(600 * mb, false, LIMITE_SEM_CONFIRMAR).unwrap_err();
        assert!(e.contains("600 MB") && e.contains("500 MB"), "{e}");
        assert!(confirmacao(600 * mb, true, LIMITE_SEM_CONFIRMAR).is_ok());
    }

    #[test]
    fn baixar_planeja_e_carrega_so_os_meses_pedidos() {
        use sa_download::cortesia::Cortesia;
        use sa_download::servidor_falso;
        use std::sync::atomic::Ordering;
        use std::time::Duration;
        let srv = std::env::temp_dir().join(format!("sa_un_prod_srv_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&srv);
        std::fs::create_dir_all(&srv).unwrap();
        let mut m = BTreeMap::new();
        for (n, qtd) in [
            ("PAMS2605a.dbc", "1"),
            ("PAMS2606a.dbc", "2"),
            ("PAMS2607a.dbc", "4"),
        ] {
            std::fs::write(srv.join(n), dbc_pa(qtd, "")).unwrap();
            m.insert(n.to_string(), srv.join(n));
        }
        std::fs::write(srv.join("RDMS2607.dbc"), dbc_rd()).unwrap();
        m.insert("RDMS2607.dbc".to_string(), srv.join("RDMS2607.dbc"));
        let srv_falso = servidor_falso::iniciar_instavel(m, 0);
        let (porta, conexoes) = (srv_falso.porta, srv_falso.conexoes.clone());
        let fonte = Fonte {
            servidor: "127.0.0.1".into(),
            pasta_dados: "/dados".into(),
            tab_cnes: "/x".into(),
            cortesia: Cortesia {
                pausa_entre_arquivos: Duration::from_millis(5),
                espera_inicial: Duration::from_millis(5),
                porta,
                ..Cortesia::default()
            },
        };
        let plano = planejar(&fonte, "MS", 2).unwrap();
        let pa: Vec<&str> = plano
            .itens
            .iter()
            .filter(|i| i.tipo == "PA")
            .map(|i| i.competencia.as_str())
            .collect();
        assert_eq!(pa, ["202606", "202607"]);
        assert!(!plano.precisa_confirmar);

        let p = pastas("baixar");
        let pedido = PedidoProducao {
            uf: "MS".into(),
            meses: 2,
            confirmado: false,
        };
        let msg =
            baixar_producao_de(&fonte, &p, &pedido, &AtomicBool::new(false), &|_| {}).unwrap();
        assert!(msg.contains("3 arquivo(s)"), "{msg}");
        assert_eq!(soma_amb(&p, "MS"), 6, "só junho (2) e julho (4)");
        assert!(arquivos_que_sobram(&p, "MS").is_empty());
        // Cortesia: o plano lista o servidor uma vez por tipo (4: PA, RD, ER e SP) e o download não lista
        // de novo; medido: 9 conexões (4 listagens + 3 arquivos + 2); listar de novo a cada competência daria 12.
        let usadas = conexoes.load(Ordering::SeqCst);
        // As tabelas auxiliares (2 ZIPs que o servidor falso não tem) acrescentam tentativas repetidas.
        assert!(usadas <= 24, "{usadas} conexões de controle");
    }

    #[test]
    fn baixar_com_er_traz_tambem_os_motivos_oficiais_e_a_tela_os_mostra() {
        use sa_download::cortesia::Cortesia;
        use sa_download::servidor_falso;
        use std::io::Write;
        use std::time::Duration;
        let srv =
            std::env::temp_dir().join(format!("sa_un_prod_srv_moterro_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&srv);
        std::fs::create_dir_all(&srv).unwrap();
        let er = de_dbf_sintetico(&sintetico::dbf(
            &[("CNES", 7), ("ANO", 4), ("MES", 2), ("CO_ERRO", 6)],
            &[
                l(&["2000001", "2026", "07", "020069"]),
                l(&["2000001", "2026", "07", "020069"]),
                l(&["2000001", "2026", "07", "060225"]),
            ],
        ));
        std::fs::write(srv.join("ERMS2607.dbc"), er).unwrap();
        // TAB_SIH.zip com bastante coisa em volta: só a tabela de motivos deve ser lida.
        let moterro = sintetico::dbf(
            &[("CD_MOT_ERR", 6), ("DS_MOT_ERR", 60)],
            &[
                l(&["0001", "DUPLICIDADE"]),
                l(&["020069", "AIH BLOQUEADA PARA AUDITORIA NO PRONTUÁRIO"]),
            ],
        );
        let mut zip_bytes = Vec::new();
        {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_bytes));
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("Motivo_de_Erro.DEF", o).unwrap();
            z.write_all(&vec![b';'; 50_000]).unwrap();
            z.start_file("DBF/MOTERRO.dbf", o).unwrap();
            z.write_all(&moterro).unwrap();
            z.finish().unwrap();
        }
        std::fs::write(srv.join("TAB_SIH.zip"), &zip_bytes).unwrap();
        let mut m = BTreeMap::new();
        for n in ["ERMS2607.dbc", "TAB_SIH.zip"] {
            m.insert(n.to_string(), srv.join(n));
        }
        let porta = servidor_falso::iniciar(m);
        let fonte = Fonte {
            servidor: "127.0.0.1".into(),
            pasta_dados: "/dados".into(),
            tab_cnes: "/x".into(),
            cortesia: Cortesia {
                pausa_entre_arquivos: Duration::from_millis(5),
                espera_inicial: Duration::from_millis(5),
                porta,
                ..Cortesia::default()
            },
        };
        let p = pastas("moterro");
        let pedido = PedidoProducao {
            uf: "MS".into(),
            meses: 1,
            confirmado: false,
        };
        let msg =
            baixar_producao_de(&fonte, &p, &pedido, &AtomicBool::new(false), &|_| {}).unwrap();
        assert!(
            msg.contains("Motivos de rejeição: 2 descrições oficiais carregadas"),
            "{msg}"
        );
        let q = ConsultaProducao::abrir(&banco_producao(&p, "MS")).unwrap();
        let u = q.da_unidade("2000001", 10).unwrap();
        assert_eq!(u.rejeicoes[0].motivo, "020069");
        assert_eq!(u.rejeicoes[0].quantidade, 2);
        assert_eq!(
            u.rejeicoes[0].descricao.as_deref(),
            Some("AIH BLOQUEADA PARA AUDITORIA NO PRONTUÁRIO")
        );
        assert_eq!(
            u.rejeicoes[1].descricao, None,
            "motivo que a tabela não traz fica só com o código"
        );
        // Sem a chave, nada fica guardado (nem a tabela de motivos).
        assert!(arquivos_que_sobram(&p, "MS").is_empty());
        // Com a chave, o ER e a tabela de motivos ficam guardados; reconstruir refaz tudo sem rede.
        definir_manter_brutos(&p, true).unwrap();
        baixar_producao_de(&fonte, &p, &pedido, &AtomicBool::new(false), &|_| {}).unwrap();
        let mut guardados_agora = arquivos_que_sobram(&p, "MS");
        guardados_agora.sort();
        assert_eq!(guardados_agora, ["ERMS2607.dbc", "MOTERRO.dbf"]);
        drop(q);
        std::fs::remove_file(banco_producao(&p, "MS")).unwrap();
        let msg = reconstruir_producao(&p, "MS", &|_| {}).unwrap();
        assert!(msg.contains("2 descrições oficiais"), "{msg}");
        let q = ConsultaProducao::abrir(&banco_producao(&p, "MS")).unwrap();
        let u = q.da_unidade("2000001", 10).unwrap();
        assert_eq!(
            u.rejeicoes[0].descricao.as_deref(),
            Some("AIH BLOQUEADA PARA AUDITORIA NO PRONTUÁRIO")
        );
        definir_manter_brutos(&p, false).unwrap();
        // Importação manual da tabela dentro do ZIP.
        let pasta_usuario =
            std::env::temp_dir().join(format!("sa_un_prod_moterro_imp_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pasta_usuario);
        std::fs::create_dir_all(&pasta_usuario).unwrap();
        std::fs::write(pasta_usuario.join("TAB_SIH.zip"), &zip_bytes).unwrap();
        let msg = importar_producao(&p, &pasta_usuario, "MS", &|_| {}).unwrap();
        assert!(msg.contains("2 descrições oficiais"), "{msg}");
    }

    #[test]
    fn sobras_de_download_interrompido_tambem_sao_apagadas() {
        let p = pastas("parcial");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        std::fs::write(
            pasta.join("PAMS2608a.dbc.parcial"),
            b"metade de um arquivo com paciente",
        )
        .unwrap();
        std::fs::write(pasta.join("qualquer.tmp"), b"x").unwrap();
        carregar_de(&p, "MS", false, &|_| {}).unwrap();
        assert_eq!(arquivos_que_sobram(&p, "MS"), Vec::<String>::new());
        // Com a variável de desenvolvimento, nada é apagado.
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        std::fs::write(pasta.join("PAMS2608a.dbc.parcial"), b"x").unwrap();
        carregar_de(&p, "MS", true, &|_| {}).unwrap();
        assert_eq!(arquivos_que_sobram(&p, "MS").len(), 2);
    }

    #[test]
    fn competencia_diferente_da_do_nome_aparece_na_mensagem() {
        let p = pastas("aviso");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        // Registros de 202607 num arquivo chamado 2606.
        std::fs::write(pasta.join("PAMS2606a.dbc"), dbc_pa("7", "")).unwrap();
        let msg = carregar_de(&p, "MS", false, &|_| {}).unwrap();
        assert!(
            msg.contains("o nome indica 202606, mas os registros são de 202607"),
            "{msg}"
        );
    }
    // ---- Chave "guardar os arquivos baixados" (Fase 4.5, K) ----

    /// Garante que a variável de desenvolvimento não interfira nos testes da chave.
    fn sem_variavel_de_desenvolvimento() {
        assert!(
            std::env::var_os(MANTER_ARQUIVOS_PRODUCAO).is_none(),
            "os testes da chave pressupõem {MANTER_ARQUIVOS_PRODUCAO} desligada"
        );
    }

    #[test]
    fn a_chave_de_guardar_brutos_comeca_desligada_e_persiste() {
        sem_variavel_de_desenvolvimento();
        let p = pastas("chave");
        assert!(!manter_brutos(&p), "padrão: desligada (privacidade)");
        assert!(
            !banco_usuario_existe(&p),
            "ler a chave não cria o banco do usuário"
        );
        definir_manter_brutos(&p, true).unwrap();
        assert!(manter_brutos(&p));
        definir_manter_brutos(&p, false).unwrap();
        assert!(!manter_brutos(&p));
    }

    fn banco_usuario_existe(p: &Pastas) -> bool {
        crate::banco_usuario(p).exists()
    }

    #[test]
    fn com_a_chave_ligada_a_carga_guarda_os_arquivos_e_sem_ela_apaga() {
        sem_variavel_de_desenvolvimento();
        let p = pastas("guarda");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        // Desligada: apaga, como sempre.
        carregar_producao(&p, "MS", &|_| {}).unwrap();
        assert!(arquivos_que_sobram(&p, "MS").is_empty());
        // Ligada: guarda.
        definir_manter_brutos(&p, true).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        carregar_producao(&p, "MS", &|_| {}).unwrap();
        assert_eq!(arquivos_que_sobram(&p, "MS"), ["PAMS2607a.dbc"]);
    }

    #[test]
    fn reconstruir_refaz_o_banco_dos_arquivos_guardados_sem_rede() {
        sem_variavel_de_desenvolvimento();
        let p = pastas("reconstroi");
        definir_manter_brutos(&p, true).unwrap();
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        std::fs::write(pasta.join("PAMS2607a.dbc"), dbc_pa("7", "")).unwrap();
        std::fs::write(pasta.join("RDMS2607.dbc"), dbc_rd()).unwrap();
        carregar_producao(&p, "MS", &|_| {}).unwrap();
        assert_eq!(soma_amb(&p, "MS"), 7);
        // O banco some (ou mudou de esquema): os brutos refazem tudo.
        std::fs::remove_file(banco_producao(&p, "MS")).unwrap();
        let msg = reconstruir_producao(&p, "MS", &|_| {}).unwrap();
        assert!(msg.contains("2 arquivo(s)"), "{msg}");
        assert_eq!(soma_amb(&p, "MS"), 7);
        assert_eq!(
            arquivos_que_sobram(&p, "MS").len(),
            2,
            "reconstruir nunca apaga os brutos"
        );
        // Mesmo com a chave desligada depois, reconstruir não apaga o que já está guardado.
        definir_manter_brutos(&p, false).unwrap();
        reconstruir_producao(&p, "MS", &|_| {}).unwrap();
        assert_eq!(arquivos_que_sobram(&p, "MS").len(), 2);
    }

    #[test]
    fn reconstruir_sem_arquivos_guardados_orienta() {
        sem_variavel_de_desenvolvimento();
        let p = pastas("reconstroi_vazio");
        let e = reconstruir_producao(&p, "MS", &|_| {}).unwrap_err();
        assert!(
            e.contains("não há arquivos de produção de MS guardados")
                && e.contains("Guardar os arquivos baixados"),
            "{e}"
        );
    }

    #[test]
    fn o_download_pula_o_que_ja_esta_guardado_com_o_mesmo_tamanho() {
        let p = pastas("faltantes");
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        let bruto = dbc_pa("7", "");
        std::fs::write(pasta.join("PAMS2607a.dbc"), &bruto).unwrap();
        let item = |nome: &str, bytes: u64| ItemDoPlano {
            tipo: "PA".into(),
            competencia: "202607".into(),
            arquivo: nome.into(),
            bytes,
        };
        let plano = vec![
            item("PAMS2607a.dbc", bruto.len() as u64), // guardado, mesmo tamanho
            item("PAMS2607b.dbc", 10),                 // não está
            item("PAMS2607a.dbc", bruto.len() as u64 + 1), // outro tamanho: baixa de novo
        ];
        let f = itens_faltantes(&plano, &pasta);
        let nomes: Vec<(&str, u64)> = f.iter().map(|i| (i.arquivo.as_str(), i.bytes)).collect();
        assert_eq!(
            nomes,
            [
                ("PAMS2607b.dbc", 10),
                ("PAMS2607a.dbc", bruto.len() as u64 + 1)
            ]
        );
    }

    #[test]
    fn a_situacao_diz_se_a_chave_esta_ligada_e_quanto_ha_guardado() {
        sem_variavel_de_desenvolvimento();
        let p = pastas("situacao_guardado");
        definir_manter_brutos(&p, true).unwrap();
        let pasta = arquivos_producao(&p, "MS");
        std::fs::create_dir_all(&pasta).unwrap();
        let bruto = dbc_pa("7", "");
        std::fs::write(pasta.join("PAMS2607a.dbc"), &bruto).unwrap();
        carregar_producao(&p, "MS", &|_| {}).unwrap();
        let s = situacao_producao(&p);
        assert_eq!(s["manter_brutos"], true);
        let uf = &s["ufs"][0];
        assert_eq!(uf["guardados"]["arquivos"], 1);
        assert_eq!(uf["guardados"]["bytes"], bruto.len() as u64);
    }
}
