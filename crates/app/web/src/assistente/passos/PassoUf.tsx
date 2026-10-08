import { useState } from "react";
import { Botao } from "../../componentes/base/Botao";
import { Selecao } from "../../componentes/base/Selecao";
import { UFS } from "../../util/ufs";

export function PassoUf({ aoEscolher }: { aoEscolher: (uf: string) => void }) {
  const [uf, setUf] = useState("SP");
  return (
    <div className="passo">
      <Selecao rotulo="Estado" itens={UFS} selectedKey={uf} onSelectionChange={(k) => setUf(String(k))} />
      <div className="passo__acoes">
        <Botao variante="primario" onPress={() => aoEscolher(uf)}>Continuar</Botao>
      </div>
    </div>
  );
}
