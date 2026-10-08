import { useState } from "react";
import { exportar } from "../../api/comandos";
import type { Planilha } from "../../api/tipos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Botao } from "../../componentes/base/Botao";

// O comando devolve "Arquivo gravado: <caminho> (12 KB)"; a tela mostra só o nome do arquivo.
const nomeDoArquivo = (resposta: string) => {
  const caminho = /^Arquivo gravado: (.*?)(?: \(\d+ KB\))?$/.exec(resposta)?.[1] ?? resposta;
  return caminho.split(/[\\/]/).pop() ?? caminho;
};

/** Exporta a planilha montada na hora do clique (com todas as linhas; pode buscar o que falta). Desistir do "Salvar como" não é erro. */
export function Exportar({ montar, nome, rotulo = "Exportar", mensagemOk }: {
  montar: () => Planilha | Promise<Planilha>; nome: string; rotulo?: string; mensagemOk: (planilha: Planilha) => string;
}) {
  const { avisar } = useAvisos();
  const [ocupado, setOcupado] = useState(false);
  const [ok, setOk] = useState<{ texto: string; arquivo: string } | null>(null);
  const salvar = async () => {
    if (ocupado) return;
    setOcupado(true);
    setOk(null);
    try {
      const planilha = await montar();
      const caminho = await exportar(planilha, nome);
      if (caminho) setOk({ texto: mensagemOk(planilha), arquivo: nomeDoArquivo(caminho) });
    } catch (e) {
      avisar(`Não foi possível exportar. ${e instanceof Error ? e.message : String(e)}`, "erro");
    } finally {
      setOcupado(false);
    }
  };
  return (
    <>
      <Botao onPress={() => void salvar()}>{ocupado ? "Exportando…" : rotulo}</Botao>
      <p role="status" className="exportar__ok">{ok && <><span>{ok.texto}</span><span className="exportar__arquivo">{ok.arquivo}</span></>}</p>
    </>
  );
}
