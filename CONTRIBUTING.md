# Como contribuir

Obrigado pelo interesse. Antes de enviar uma contribuição, leia as regras abaixo.

## Regras do projeto

1. **Nenhum dado no repositório.** Nada de ZIP do SIGTAP, `.dbc`, `.dbf`, planilhas, PDFs
   oficiais ou bancos. O teste `crates/guarda` reprova o que parecer dado.
2. **Nenhum dado de paciente, nunca.** Remessas de BPA, APAC, AIH ou XML TISS reais não entram
   em código, teste, issue, log ou captura de tela. Testes usam arquivos sintéticos.
3. **Leiaute vem de fonte oficial** e entra como dado (manifesto), com a referência do documento
   e da página. Nada de posição de campo fixa no código.
4. **Toda função de ingestão, consulta ou regra tem teste** contra dados reais (rodado
   localmente) ou sintéticos (versionados).
5. **Português do Brasil** em interface, mensagens, logs e documentação. Mensagem de erro sempre
   diz o que fazer.
6. Dependências novas só com licença compatível com AGPL-3.0 (`cargo deny check licenses`).

## Acordo de contribuição (CLA)

> **Proposta, pendente de revisão jurídica.** Até o texto definitivo, contribuições externas não
> são aceitas.

Para que o projeto possa, no futuro, ajustar a licença (por exemplo, para uma versão mais nova
da AGPL) sem precisar localizar cada autor, cada contribuidor externo assinará um acordo que:

- mantém com o contribuidor os direitos autorais da contribuição;
- concede ao projeto licença ampla, perpétua e irrevogável para usar, modificar e relicenciar a
  contribuição, desde que o código continue disponível como software livre;
- declara que o contribuidor tem o direito de conceder essa licença.

O texto final e a forma de assinatura (por exemplo, um robô de CLA no GitHub) serão definidos
antes da primeira contribuição externa.
