type Invocador = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type Escuta = (nome: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
interface TauriGlobal { core: { invoke: Invocador }; event: { listen: Escuta } }

declare global { interface Window { __TAURI__?: TauriGlobal } }

export class ErroDoPrograma extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = "ErroDoPrograma"; }
}

function tauri(): TauriGlobal {
  const t = window.__TAURI__;
  if (!t) throw new ErroDoPrograma("Abra o SIGTAP Aberto pelo programa; esta página não tem acesso aos dados.");
  return t;
}

export async function chamar<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const t = tauri();
  try {
    return (await t.core.invoke(cmd, args)) as T;
  } catch (e) {
    const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "Falha sem descrição.";
    throw new ErroDoPrograma(msg);
  }
}

export async function ouvir<T>(nome: string, cb: (p: T) => void): Promise<() => void> {
  return tauri().event.listen(nome, (e) => cb(e.payload as T));
}
