import type { Painel } from "../../api/tipos";
import { useUnidades } from "../../dados/consultas";
import { useAptidaoResumo, useUnidade } from "../../dados/unidade";
import { ir } from "../../shell/rotas";
import { inteiro } from "../../util/formatos";
import { citamENaoProduzem } from "../unidade/cadastro/citam";
import { AREAS, ROTULO_DA_AREA, contarPorArea, type Area } from "./areas";

type Dados = Extract<Painel, { disponivel: true }>;

const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

const DESCRICAO: Record<Area, string> = {
  cadastro: "Habilitações, serviços, leitos e profissionais",
  aptidao: "Risco, oportunidade e o que está em ordem",
  producao: "SIA, SIH, rejeições e série mensal",
};

function selo(n: number) {
  return n === 0
    ? <span className="painel__selo painel__selo--neutro">Sem pendências</span>
    : <span className="painel__selo painel__selo--atencao">{plural(n, "pendência", "pendências")}</span>;
}

/** Os três cartões das áreas da unidade: o resumo de cada uma e quantas pendências ela tem. Sem dado, a descrição fixa; nunca "0" no lugar de "sem dado". */
export function AreasDaUnidade({ painel, competencia }: { painel: Dados; competencia?: string }) {
  const unidades = useUnidades();
  const minha = unidades.data?.minha ?? null;
  const ufCarregada = !!minha && !!unidades.data?.ufs.some((u) => u.uf === minha.uf && !u.erro);
  const cadastro = useUnidade(competencia, minha ? { uf: minha.uf, cnes: minha.cnes } : undefined, ufCarregada);
  const aptidao = useAptidaoResumo(competencia, minha ? `${minha.uf}:${minha.cnes}` : "", ufCarregada);
  const contagem = contarPorArea(painel.pendencias);

  const habilitacoes = cadastro.data?.habilitacoes.length ?? null;
  const citam = citamENaoProduzem(aptidao.data)?.length ?? null;
  const resumo = aptidao.data?.resumo ?? null;
  const taxa = painel.rejeicoes.por_100_aih;
  const mediana = painel.pares?.taxa_mediana_dos_pares ?? null;

  const linha: Record<Area, string> = {
    cadastro: habilitacoes === null
      ? DESCRICAO.cadastro
      : [plural(habilitacoes, "habilitação", "habilitações"), citam ? `${inteiro(citam)} ${citam === 1 ? "cita e não produz" : "citam e não produzem"}` : null].filter(Boolean).join(" · "),
    aptidao: resumo === null
      ? DESCRICAO.aptidao
      : [resumo.risco ? `${inteiro(resumo.risco.procedimentos)} em risco` : null, plural(resumo.oportunidade.procedimentos, "oportunidade", "oportunidades")].filter(Boolean).join(" · "),
    producao: taxa === null
      ? DESCRICAO.producao
      : `Rejeições ${decimal.format(taxa)} por 100 AIH${mediana !== null && taxa > mediana ? ", acima dos pares" : ""}`,
  };

  return (
    <div className="areas">
      {AREAS.map((a) => (
        <a key={a} className="area" href={`#/painel/${a}`} onClick={(e) => { e.preventDefault(); ir("painel", a); }}>
          <span className="area__topo"><span className="area__titulo">{ROTULO_DA_AREA[a]}</span><span className="area__seta" aria-hidden="true">›</span></span>
          <span className="area__resumo">{linha[a]}</span>
          {selo(contagem[a])}
        </a>
      ))}
    </div>
  );
}
