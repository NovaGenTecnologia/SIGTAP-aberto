import { useState } from "react";
import { Abas } from "../componentes/base/Abas";
import { Arvore } from "../componentes/base/Arvore";
import { Botao } from "../componentes/base/Botao";
import { CaixaCombinada } from "../componentes/base/CaixaCombinada";
import { CaixaMarcacao } from "../componentes/base/CaixaMarcacao";
import { CampoBusca } from "../componentes/base/CampoBusca";
import { CampoTexto } from "../componentes/base/CampoTexto";
import { Dica } from "../componentes/base/Dica";
import { Etiquetas } from "../componentes/base/Etiquetas";
import { GrupoOpcoes } from "../componentes/base/GrupoOpcoes";
import { Interruptor } from "../componentes/base/Interruptor";
import { Ligacao } from "../componentes/base/Ligacao";
import { Menu } from "../componentes/base/Menu";
import { Progresso } from "../componentes/base/Progresso";
import { Selecao } from "../componentes/base/Selecao";
import { TabelaDeDados, type Coluna } from "../componentes/base/TabelaDeDados";
import { AvisoDeLimite } from "../componentes/dominio/AvisoDeLimite";
import { BlocoDeDados } from "../componentes/dominio/BlocoDeDados";
import { CartaoDePendencia } from "../componentes/dominio/CartaoDePendencia";
import { CarregandoComEspera, EstadoErro, EstadoVazio } from "../componentes/dominio/Estados";
import { FaixaDeCompetencia } from "../componentes/dominio/FaixaDeCompetencia";
import { NumeroComOrigem } from "../componentes/dominio/NumeroComOrigem";
import { SerieMensal } from "../componentes/dominio/SerieMensal";
import { SeloDeConfianca, type Confianca } from "../componentes/dominio/SeloDeConfianca";
import { reais } from "../util/formatos";

interface Linha { id: string; codigo: string; nome: string; valor: number }
const MUITAS: Linha[] = Array.from({ length: 10000 }, (_, i) => ({
  id: String(i), codigo: String(301010000 + i).padStart(10, "0"), nome: `Procedimento de teste ${i}`, valor: (i % 997) * 100,
}));
const COLUNAS: Coluna<Linha>[] = [
  { id: "codigo", rotulo: "Código", ordenavel: true, celula: (l) => <span className="num">{l.codigo}</span> },
  { id: "nome", rotulo: "Nome", celula: (l) => l.nome },
  { id: "valor", rotulo: "Valor", numerica: true, celula: (l) => reais(l.valor) },
];
const ESTADOS: Confianca[] = ["confirmada", "nao-confirmada", "estimativa", "prova-indireta", "informativo"];
const UFS = [{ id: "MS", rotulo: "Mato Grosso do Sul" }, { id: "SP", rotulo: "São Paulo" }];

export function Galeria() {
  const [comp, setComp] = useState("202609");
  return (
    <div className="galeria" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Galeria de componentes</h1>

      <BlocoDeDados titulo="Botões">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Botao variante="primario">Primário</Botao><Botao>Secundário</Botao><Botao variante="discreto">Discreto</Botao>
          <Botao variante="perigo">Perigo</Botao><Botao isDisabled>Desativado</Botao><Botao carregando>Carregando</Botao>
          <Ligacao href="#/galeria">Ligação</Ligacao>
          <Dica texto="Dica de teste"><Botao>Com dica</Botao></Dica>
        </div>
      </BlocoDeDados>

      <BlocoDeDados titulo="Campos">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <CampoTexto rotulo="CNES" descricao="7 dígitos" />
          <CampoTexto rotulo="CNES com erro" erro="Informe 7 dígitos" isInvalid defaultValue="12" />
          <CampoTexto rotulo="Desativado" isDisabled defaultValue="valor" />
          <CampoBusca rotulo="Buscar procedimento" placeholder="Código ou nome" />
          <Selecao rotulo="UF" itens={UFS} />
          <CaixaCombinada rotulo="Unidade federativa" itens={UFS} />
          <CaixaMarcacao>Só meses completos</CaixaMarcacao>
          <Interruptor>Só o que me afeta</Interruptor>
          <GrupoOpcoes rotulo="Escopo" defaultValue="uf" opcoes={[{ valor: "uf", rotulo: "UF" }, { valor: "mun", rotulo: "Município" }]} />
          <Etiquetas rotulo="Filtros" selectionMode="multiple" itens={[{ id: "a", rotulo: "SIA" }, { id: "b", rotulo: "SIH" }]} />
          <Progresso rotulo="Download determinado" valor={40} />
          <Progresso rotulo="Download indeterminado" />
        </div>
      </BlocoDeDados>

      <BlocoDeDados titulo="Navegação">
        <Abas rotulo="Exemplo" abas={[{ id: "a", rotulo: "Resumo", conteudo: "Painel A" }, { id: "b", rotulo: "Histórico", conteudo: "Painel B" }]} />
        <Menu rotulo="Unidades" itens={[{ id: "1", rotulo: "Hospital A" }]} aoEscolher={() => {}}>Menu</Menu>
        <Arvore rotulo="Grupos" itens={[{ id: "03", rotulo: "Procedimentos clínicos", filhos: [{ id: "0301", rotulo: "Consultas" }] }]} />
        <FaixaDeCompetencia competencias={[{ competencia: "202608", rotulo: "08/2026" }, { competencia: "202609", rotulo: "09/2026" }]} selecionada={comp} aoSelecionar={setComp} />
      </BlocoDeDados>

      <BlocoDeDados titulo="Selos de confiança">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{ESTADOS.map((e) => <SeloDeConfianca key={e} estado={e} />)}</div>
      </BlocoDeDados>

      <BlocoDeDados titulo="Números, pendência e limite">
        <NumeroComOrigem rotulo="Taxa de rejeição" valor="5,5 por 100 AIH" origem={{ fonte: "SIH (ER × RD)", competencia: "07/2026", limites: ["Só meses completos"] }} />
        <CartaoDePendencia titulo="Apresentado acima do aprovado" valorCentavos={137292663} gravidade="media"
          passos={[{ rotulo: "Alerta" }, { rotulo: "Procedimento", detalhe: "Ressonância magnética" }, { rotulo: "Regra", detalhe: "Teto financeiro" }, { rotulo: "Fonte e competência", detalhe: "SIA 07/2026" }]}
          acao={{ rotulo: "Ver procedimentos", aoAcionar: () => {} }} />
        <AvisoDeLimite>Mês incompleto: fora da conta.</AvisoDeLimite>
        <SerieMensal rotulo="Valor aprovado por mês" formatar={reais}
          pontos={[{ competencia: "202604", valor: 90, completo: true }, { competencia: "202605", valor: 100, completo: true }, { competencia: "202606", valor: 95, completo: true }, { competencia: "202607", valor: 40, completo: false }]} />
      </BlocoDeDados>

      <BlocoDeDados titulo="Estados">
        <EstadoVazio titulo="Nenhuma unidade escolhida" descricao="Escolha a sua unidade." acao={{ rotulo: "Escolher unidade", aoAcionar: () => {} }} />
        <EstadoErro mensagem="Não foi possível ler os dados." aoTentar={() => {}} />
        <CarregandoComEspera rotulo="Carregando a ficha" />
      </BlocoDeDados>

      <BlocoDeDados titulo="Tabela com 10 mil linhas">
        <TabelaDeDados rotulo="Procedimentos de teste" colunas={COLUNAS} linhas={MUITAS} altura={320} />
      </BlocoDeDados>

      <p className="num" data-testid="amostra-tabular">
        <span id="t1">1111111111</span> <span id="t2">8888888888</span>
      </p>
    </div>
  );
}
