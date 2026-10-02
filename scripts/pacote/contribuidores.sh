#!/usr/bin/env bash
# Grava crates/app/ui/contribuidores.js com os 10 maiores contribuidores do repositório no
# momento do lançamento. Usa GH_TOKEN e GITHUB_REPOSITORY; se a consulta falhar, mantém o arquivo.
set -u
destino="crates/app/ui/contribuidores.js"
repo="${GITHUB_REPOSITORY:?}"
versao="${GITHUB_REF_NAME:-}"
json=$(gh api "repos/${repo}/contributors?per_page=10" \
  --jq '[.[] | select(.type=="User") | {login: .login, contribuicoes: .contributions}]') || {
  echo "aviso: não consegui consultar os contribuidores; mantendo ${destino}"; exit 0; }
{
  echo '// Gerado no lançamento por scripts/pacote/contribuidores.sh (Top 10 do GitHub no momento da versão).'
  echo '"use strict";'
  echo "const CONTRIBUIDORES = { versao: \"${versao}\", geradoEm: \"$(date -u +%Y-%m-%d)\", lista: ${json} };"
} > "$destino"
cat "$destino"
