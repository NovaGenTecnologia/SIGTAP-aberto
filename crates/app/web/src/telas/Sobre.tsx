import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { abrirSite, consultarAtualizacao, infoPrograma } from "../api/comandos";
import { useAvisos } from "../componentes/base/Avisos";
import { Botao } from "../componentes/base/Botao";
import { Dialogo } from "../componentes/base/Dialogo";
import qr from "../assets/pix-qr.svg";
import { PIX_CHAVE, PIX_COPIA_E_COLA } from "../util/apoio";
import "./sobre.css";

const PROMESSAS = [
  ["Gratuito e aberto", "Licença AGPL-3.0: o código é público e pode ser auditado."],
  ["Fica no seu computador", "Sem cadastro, conta nem telemetria."],
  ["Dados oficiais", "Tabela do DATASUS e territórios do IBGE."],
  ["Não oficial", "Sem vínculo com o Ministério da Saúde, o DATASUS ou a ANS. Confira no SIGTAP oficial antes de faturar."],
] as const;

export function Sobre({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const info = useQuery({ queryKey: ["info_programa"], queryFn: infoPrograma, enabled: aberto });
  const { avisar } = useAvisos();
  const [resultado, setResultado] = useState<string | null>(null);
  const [procurando, setProcurando] = useState(false);
  const repo = info.data?.repositorio ? `https://github.com/${info.data.repositorio}` : null;

  const abrir = (url: string) => abrirSite(url).catch((e) => avisar(e instanceof Error ? e.message : String(e), "erro"));
  const copiar = (texto: string, o_que: string) =>
    navigator.clipboard.writeText(texto).then(() => avisar(`${o_que} copiado.`, "ok"), () => avisar("Não foi possível copiar.", "erro"));

  async function procurar() {
    setProcurando(true);
    try {
      const r = await consultarAtualizacao();
      setResultado(r.nova ? `Há uma versão nova: ${r.nova.versao}.` : "Você já está na versão mais recente.");
    } catch (e) { setResultado(`Não foi possível procurar: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setProcurando(false); }
  }

  return (
    <Dialogo titulo="Sobre" aberto={aberto} aoFechar={aoFechar}>
      <div className="sobre">
        <p className="sobre__versao"><strong>SIGTAP Aberto</strong>{info.data?.versao ? ` ${info.data.versao}` : ""}</p>
        <p>Obrigado por usar. Projeto feito e mantido pela NovaGen Tecnologia e seus contribuidores.</p>
        <p>Este programa existe para ajudar quem fatura no SUS: consultar a Tabela de Procedimentos com o histórico de cada competência, conferir as regras de cobrança e evitar glosas.</p>
        <dl className="sobre__promessas">
          {PROMESSAS.map(([t, d]) => (<div key={t}><dt>{t}</dt><dd>{d}</dd></div>))}
        </dl>
        <div className="sobre__acoes">
          <Botao isDisabled={!repo} onPress={() => repo && void abrir(repo)}>Código-fonte no GitHub</Botao>
          <Botao isDisabled={!repo} onPress={() => repo && void abrir(`${repo}/issues/new`)}>Sugerir ou relatar</Botao>
          <Botao carregando={procurando} onPress={() => void procurar()}>Procurar atualizações</Botao>
        </div>
        <p role="status" className="sobre__resultado">{resultado}</p>
        <section className="sobre__apoio" aria-labelledby="sobre-apoio">
          <h3 id="sobre-apoio">Apoie o projeto</h3>
          <p>Se o programa ajuda no seu trabalho, contribua pelo Pix com o valor que quiser: aponte a câmera do app do banco.</p>
          <div className="sobre__pix">
            <img src={qr} alt="QR Code do Pix para apoiar o projeto" width="120" height="120" />
            <div>
              <code>{PIX_CHAVE}</code>
              <div className="sobre__acoes">
                <Botao onPress={() => void copiar(PIX_CHAVE, "Chave Pix")}>Copiar chave</Botao>
                <Botao onPress={() => void copiar(PIX_COPIA_E_COLA, "Pix copia e cola")}>Copiar Pix copia e cola</Botao>
              </div>
            </div>
          </div>
          <p className="sobre__nota">Voluntário: não gera recibo nem libera recurso extra. O programa é completo sem isso.</p>
        </section>
      </div>
    </Dialogo>
  );
}
