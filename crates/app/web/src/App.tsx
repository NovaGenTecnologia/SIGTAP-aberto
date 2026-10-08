import { QueryClientProvider } from "@tanstack/react-query";
import { Assistente } from "./assistente/Assistente";
import { ProvedorDeAvisos } from "./componentes/base/Avisos";
import { clienteDeConsultas } from "./dados/consultas";
import { TarefasProvider } from "./dados/TarefasProvider";
import { ProvedorDaSessao } from "./shell/sessao";
import { Shell } from "./shell/Shell";
import { Telas } from "./telas/Telas";

export function App() {
  return (
    <QueryClientProvider client={clienteDeConsultas}>
      <ProvedorDeAvisos>
        <ProvedorDaSessao>
          <TarefasProvider>
            <Shell assistente={(aoConcluir) => <Assistente aoConcluir={aoConcluir} />}><Telas /></Shell>
          </TarefasProvider>
        </ProvedorDaSessao>
      </ProvedorDeAvisos>
    </QueryClientProvider>
  );
}
