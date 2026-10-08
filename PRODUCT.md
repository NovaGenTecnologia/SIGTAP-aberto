# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Faturista de unidade de saúde: quem fecha a produção ambulatorial (SIA) e hospitalar (SIH) de um estabelecimento (CNES), confere rejeições e glosas e precisa saber o que pode faturar e por que algo não foi pago. Trabalha em Windows, em repartição pública ou unidade de saúde, com a tabela SIGTAP, o cadastro CNES e os arquivos de produção do DATASUS.

Outros públicos (gestor ou auditor municipal/estadual, consultor) não foram confirmados como centrais; o painel de comparação com pares serve a quem compara unidades, mas a decisão de desenho parte do faturista.

## Product Purpose

Programa aberto e gratuito que reúne a Tabela SIGTAP, o cadastro do CNES e a produção real do SIA/SIH num painel do faturista: o que a unidade produziu, o que foi aprovado ou rejeitado, quanto ficou de fora (teto, regra, vigência) e como isso se compara à UF e a unidades parecidas. Sucesso: o faturista entende, sem auditar arquivo por arquivo, onde está perdendo faturamento e o que corrigir.

## Positioning

Aberto e gratuito, com código e regras públicos, e cruza SIGTAP × CNES × produção num só lugar. Um concorrente fechado não poderia afirmar a mesma transparência sobre como cada número é calculado.

## Operating Context

App desktop para Windows (Tauri/WebView, interface em HTML/CSS/JS em `crates/app/ui`), com dados locais: banco SIGTAP, banco de produção por UF (`producao\<UF>.db`) e arquivos baixados dos servidores públicos do DATASUS. Funciona sobre meses completos de produção; exporta para Excel.

## Capabilities and Constraints

- Tabela SIGTAP, cadastro CNES da unidade, produção SIA/SIH por UF, painel do faturista (perfil financeiro, composição da AIH, serviços executados × cadastrados, reapresentação, permanência, rejeições, comparação com pares, série de até 60 meses).
- Privacidade por desenho: nunca dado de paciente nem arquivo oficial do CNES com CPF (`ST`, `CADGER`, `PF`) no repositório, log ou relatório; só agregados por estabelecimento. Decisões do cliente pendentes sobre apagar também `HB`/`SR`/`LT`/`EQ`.
- Não é auditoria: números apontam onde olhar; a conferência é no prontuário e nos arquivos oficiais.
- Respeito aos servidores do DATASUS (cortesia de download, limite de 500 MB por vez).
- Terminologia do SUS mantida (SIA, SIH, AIH, APAC, CNES, competência, teto físico/financeiro).
- Em aberto: significado de `ATIVIDAD` (ensino) e de `PA_VL_CRD`; piso de privacidade para CBO/CID.

## Brand Commitments

Nome "SIGTAP Aberto". Código e regras públicas (CONTRIBUTING e `docs/`). Interface em português do Brasil.

## Evidence on Hand

Produção real de MS 07/2026 e SP em `dados_dev\` (fora do repositório, de unidade real do cliente: não publicar). Medidas e limites em `docs/fases/fase-4-5.md`. Não há depoimentos, clientes públicos ou métricas de adoção para citar.

## Product Principles

1. Cada número mostra de onde vem e o que não prova: sem afirmar além do dado.
2. Privacidade antes de conveniência: agregar na carga, nunca guardar o pessoal.
3. Tarefa antes de ornamento: o faturista vai do alerta à causa em poucos passos.
4. Aberto de verdade: regras e fontes documentadas, sem dependência de fornecedor.
5. Honestidade sobre limites: o que não foi provado fica dito.

## Accessibility & Inclusion

Uso por teclado e leitura clara em telas de repartição pública; alvo WCAG AA (contraste, foco visível, rótulos), texto em português simples.
