# Como contribuir

Obrigado por querer ajudar. O SIGTAP Aberto é mantido por poucas pessoas e feito para quem fatura no SUS; quanto mais gente de faturamento, de TI hospitalar e de desenvolvimento olhando para ele, melhor fica. Este guia existe para que a sua contribuição entre rápido e sem retrabalho.

Não precisa saber programar para ajudar. Achar um dado diferente do site oficial, uma mensagem confusa ou um passo que travou na hora de baixar já é uma contribuição valiosa.

## Antes de tudo: dado de paciente nunca

**Não cole, anexe nem descreva dado de paciente em issue, pull request, captura de tela, log ou teste.** Isso vale para CPF, CNS, nome, data de nascimento, número de AIH/APAC e qualquer linha de um arquivo de BPA, APAC, AIH ou TISS real. Se precisar mostrar a estrutura de um arquivo, diga o tamanho do registro, as posições e as contagens, nunca os valores. Se algo assim for publicado por engano, apague e avise um mantenedor na hora.

## Relatar um problema

Procure primeiro se já existe uma [issue](../../issues) igual. Se não existir, abra uma e conte:

1. **O que você fazia** e **o que esperava ver**.
2. **O que aconteceu**, com a mensagem exata, se houver.
3. **A versão** do programa (botão **Sobre**, no rodapé) e a do Windows.
4. **A competência** e o **código do procedimento**, se for dado errado ou faltando. Diga também onde você conferiu: site do SIGTAP, ZIP oficial ou outro.

O botão **Sugerir ou relatar**, no rodapé do programa, já abre a issue com a versão e o sistema preenchidos.

Um problema que dá para reproduzir se resolve em minutos; um que não dá, em dias. Quanto mais exato o passo a passo, mais rápido.

## Sugerir uma melhoria

Abra uma issue antes de escrever código. Explique **qual problema do seu dia a dia** a melhoria resolve, e não só a solução imaginada. O que cabe no projeto está no [plano por fases](docs/fases/); o que está fora do escopo (prontuário, agendamento, transmissão ao DATASUS ou à ANS) não entra, por melhor que seja a ideia.

## Enviar código

Funciona assim: fork, uma branch por assunto, pull request pequeno. Mudança grande demais é difícil de revisar; prefira vários pedidos curtos a um enorme. Refatoração ampla que ninguém pediu será recusada.

Todo pull request:

- explica o **porquê** da mudança, não só o quê;
- traz teste, ou diz por que não dá para testar;
- diz **onde foi testado** (Windows ou Linux) e **o que não foi testado**;
- passa por `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` e `cargo test --workspace`;
- vem com mensagem de commit em português, no imperativo, curta na primeira linha ("Corrige a busca por CID com ponto"), e o porquê no corpo, se não for óbvio.

### Regras do projeto

Estas não têm exceção:

1. **Nenhum dado no repositório.** Nada de ZIP do SIGTAP, `.dbc`, `.dbf`, planilhas, PDFs oficiais ou bancos. O teste `crates/guarda` reprova o que parecer dado.
2. **Nenhum dado de paciente, nunca.** Testes usam arquivos sintéticos.
3. **Layout vem de fonte oficial** e entra como dado (manifesto), com a referência do documento e da página. Nada de posição de campo fixa espalhada no código.
4. **Toda função de ingestão, consulta ou regra tem teste**, contra dados reais (rodado localmente) ou sintéticos (versionados). Uma regra de validação nasce **"não confirmada"** e só muda com prova: arquivo rejeitado real mais o retorno oficial.
5. **Nunca diga que está pronto sem rodar.** Registre o que foi testado e o que não foi.
6. **Português do Brasil** em interface, mensagens, logs e documentação. Mensagem de erro sempre diz o que fazer.
7. **Segurança.** Identificador SQL que vem de dado passa por `safe_ident`; nunca concatene texto de dado em SQL; limite a memória ao abrir ZIPs e arquivos de origem não confiável.
8. **Dependência nova só com licença compatível com AGPL-3.0** (`cargo deny check licenses`). Prefira não adicionar dependência.
9. **Portátil.** O programa não grava nada fora da pasta dele.

### Preparar o ambiente

Os requisitos e os comandos de compilação estão no [README](README.md#compilar-e-testar). Em resumo:

```sh
cargo test --workspace
cargo build --release -p sa-app
```

No Windows, `scripts\windows\testar.bat` e `compilar.bat` fazem o mesmo e gravam um `.log`. Para rodar os testes com dados reais, aponte `SA_ZIPS_HISTORICO` e `SA_SIGTAP_BANCO_CONSULTA` para os arquivos oficiais que você baixou. Sem eles, esses testes terminam sem rodar e **não provam nada**.

Mexeu na interface? Rode a ponte de desenvolvimento (`scripts/dev/ponte_ui.py`), que serve a tela no navegador com dados simulados, e confira também em janela estreita (1024 px).

## Uso de IA

Pode usar ferramentas de IA, inclusive este projeto é desenvolvido com apoio delas. A regra é a mesma para qualquer código: **quem envia responde por ele.** Leia, entenda e teste o que a ferramenta gerou antes de abrir o pull request, e responda às revisões com as suas próprias palavras. Pull request que parece enviado sem ter sido lido será fechado.

## Acordo de contribuição (CLA)

> **Proposta, pendente de revisão jurídica.** Até o texto definitivo, contribuições de código de pessoas de fora não são aceitas. Issues, relatos e sugestões já são bem-vindos.

Para que o projeto possa, no futuro, ajustar a licença (por exemplo, para uma versão mais nova da AGPL) sem precisar localizar cada autor, cada contribuidor externo assinará um acordo que:

- mantém com o contribuidor os direitos autorais da contribuição;
- concede ao projeto licença ampla, perpétua e irrevogável para usar, modificar e relicenciar a contribuição, desde que o código continue disponível como software livre;
- declara que o contribuidor tem o direito de conceder essa licença.

O texto final e a forma de assinatura (por exemplo, um robô de CLA no GitHub) serão definidos antes da primeira contribuição externa.

## Convivência

Trate as pessoas com respeito e paciência. Muita gente aqui é do faturamento, não da programação, e ninguém precisa saber tudo. Crítica ao código é bem-vinda; crítica à pessoa, não. Quem desrespeitar os outros repetidamente deixa de participar do projeto.

## Licença

Ao contribuir, você concorda que o seu código será distribuído sob a [AGPL-3.0](LICENSE), a mesma licença do projeto.
