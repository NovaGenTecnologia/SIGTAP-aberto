import { QueryClientProvider } from "@tanstack/react-query";
import { ProvedorDeAvisos } from "./componentes/base/Avisos";
import { clienteDeConsultas } from "./dados/consultas";
import { ProvedorDaSessao } from "./shell/sessao";
import { Shell } from "./shell/Shell";
import { Telas } from "./telas/Telas";

export function App() {
  return (
    <QueryClientProvider client={clienteDeConsultas}>
      <ProvedorDeAvisos>
        <ProvedorDaSessao>
          <Shell><Telas /></Shell>
        </ProvedorDaSessao>
      </ProvedorDeAvisos>
    </QueryClientProvider>
  );
}
