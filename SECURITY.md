# Política de segurança

O SIGTAP Aberto roda no computador de quem usa e lida com arquivos de faturamento que podem conter dado de paciente. Por isso, levamos a sério qualquer falha que exponha esse dado ou que permita a um terceiro executar algo na máquina do usuário.

## Versões com correção de segurança

Corrigimos a **última versão publicada** (ver [Releases](../../releases)). Versões anteriores não recebem correção: atualize pelo próprio programa ou baixe a versão mais nova.

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o relato privado do GitHub:

1. Abra a aba **Security** do repositório.
2. Clique em **Report a vulnerability**.
3. Descreva o que encontrou.

O relato fica visível só para os mantenedores até a correção sair.

Inclua, se puder:

- a versão do programa e o sistema (Windows, Linux ou macOS);
- o que você fez, o que esperava e o que aconteceu;
- como reproduzir, de preferência com um arquivo **sintético** (inventado) e não um arquivo real.

**Nunca envie dado de paciente** (nome, CPF, CNS, número de AIH ou APAC, trechos de BPA, APAC, AIH ou TISS reais). Para mostrar a estrutura de um arquivo, descreva o tamanho do registro, as posições e as contagens.

## O que consideramos falha de segurança

- Qualquer caminho pelo qual dado de paciente, de profissional ou do usuário saia do computador, ou seja gravado em log, banco ou arquivo exportado onde não deveria.
- Execução de código, escrita ou leitura de arquivos fora da pasta do programa a partir de um arquivo de entrada (ZIP, DBC, DBF, TXT, XLSX) preparado por terceiro.
- Falha na conferência do SHA-256 ou na troca do executável pelo atualizador do programa.
- A interface abrir endereços ou comandos que não deveria (a lista de endereços permitidos fica em `crates/app/src/main.rs`).
- Injeção de SQL ou de HTML a partir de texto vindo dos dados.
- Dependência com vulnerabilidade conhecida que afete o programa.

## O que não é falha de segurança

- Dado diferente do SIGTAP, do CNES ou de outra fonte oficial. Isso é um defeito comum: abra uma issue com o código do procedimento e a competência.
- O executável ainda **não tem assinatura digital**, e o Windows e o macOS avisam por isso. Está documentado nas notas de cada versão.
- Defeitos que exigem acesso físico ou administrador à máquina do usuário.

## O que você pode esperar de nós

- Confirmamos o recebimento do relato em até **5 dias úteis**.
- Avisamos quando a falha for confirmada e qual versão traz a correção.
- Damos o crédito a quem relatou, se quiser, nas notas da versão.
- Pedimos que a falha só seja divulgada depois que a correção estiver publicada.

O projeto é mantido por poucas pessoas, então os prazos acima são um compromisso de boa-fé, não um contrato.
