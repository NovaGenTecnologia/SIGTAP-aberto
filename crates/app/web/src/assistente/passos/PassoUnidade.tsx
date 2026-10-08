import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ListBox, ListBoxItem, type Key } from "react-aria-components";
import { cnesBaixar, cnesBuscar, unidadeDefinir } from "../../api/comandos";
import { useAvisos } from "../../componentes/base/Avisos";
import { Botao } from "../../componentes/base/Botao";
import { CampoBusca } from "../../componentes/base/CampoBusca";
import { EstadoErro } from "../../componentes/dominio/Estados";
import { useDebounce } from "../../shell/useDebounce";

const PAUSA_DA_DIGITACAO_MS = 250;

export function PassoUnidade({ uf, aoPular }: { uf: string; aoPular: () => void }) {
  const cliente = useQueryClient();
  const { avisar } = useAvisos();
  const [texto, setTexto] = useState("");
  const [marcada, setMarcada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const termo = useDebounce(texto.trim(), PAUSA_DA_DIGITACAO_MS);
  const busca = useQuery({ queryKey: ["cnes_buscar", uf, termo], queryFn: () => cnesBuscar(uf, termo), enabled: termo.length >= 2 });

  async function escolher(cnes: string) {
    if (gravando) return;
    setGravando(true); setErro(null);
    try {
      await unidadeDefinir(uf, cnes);
      // Os profissionais da unidade entram na fila do CNES, atrás do que ainda estiver baixando.
      cnesBaixar(uf, { fase: "pessoas", quando: "depois" }).catch((e) => avisar(e instanceof Error ? e.message : String(e), "erro"));
      await cliente.invalidateQueries(); // a unidade muda o que o programa inteiro mostra
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setGravando(false); }
  }

  const itens = busca.data ?? [];
  return (
    <div className="passo">
      <CampoBusca rotulo="Buscar unidade" value={texto} onChange={(v) => { setTexto(v); setMarcada(null); }} />
      {busca.isError && <EstadoErro mensagem="Não foi possível buscar agora." aoTentar={() => void busca.refetch()} />}
      {erro && <EstadoErro mensagem={erro} aoTentar={() => marcada && void escolher(marcada)} />}
      {termo.length >= 2 && !busca.isError && !busca.isPending && itens.length === 0 && <p className="passo__vazio">Nenhuma unidade encontrada.</p>}
      {itens.length > 0 && (
        <ListBox
          aria-label="Unidades encontradas" className="unidades" selectionMode="single" selectionBehavior="replace"
          selectedKeys={marcada ? [marcada] : []}
          onSelectionChange={(k) => { const [primeira] = k === "all" ? [] : [...k]; setMarcada(primeira ? String(primeira) : null); }}
          onAction={(k: Key) => void escolher(String(k))}
        >
          {itens.map((e) => (
            <ListBoxItem key={e.cnes} id={e.cnes} textValue={e.nome} className="unidade">
              <span className="unidade__nome">{e.nome}</span>
              <span className="unidade__detalhe">
                {e.municipio_nome && <>{e.municipio_nome} · </>}CNES <span className="num">{e.cnes}</span>{e.tipo_nome && <> · {e.tipo_nome}</>}
              </span>
            </ListBoxItem>
          ))}
        </ListBox>
      )}
      <div className="passo__acoes">
        <Botao variante="primario" isDisabled={!marcada || gravando} carregando={gravando} onPress={() => marcada && void escolher(marcada)}>Escolher esta unidade</Botao>
        <Botao onPress={aoPular}>Pular</Botao>
      </div>
    </div>
  );
}
