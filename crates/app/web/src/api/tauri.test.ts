import { chamar, ouvir, ErroDoPrograma } from "./tauri";

afterEach(() => { delete (window as { __TAURI__?: unknown }).__TAURI__; });

test("chamar repassa o comando e os argumentos ao Tauri", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: 1 });
  (window as any).__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } };
  await expect(chamar("situacao", { a: 1 })).resolves.toEqual({ ok: 1 });
  expect(invoke).toHaveBeenCalledWith("situacao", { a: 1 });
});

test("falha do backend vira ErroDoPrograma com a mensagem em texto", async () => {
  (window as any).__TAURI__ = { core: { invoke: vi.fn().mockRejectedValue("há uma tarefa em andamento.") }, event: { listen: vi.fn() } };
  await expect(chamar("x")).rejects.toThrow(new ErroDoPrograma("há uma tarefa em andamento."));
});

test("fora do programa (sem __TAURI__) o erro diz o que fazer", async () => {
  await expect(chamar("situacao")).rejects.toThrow(/Abra o SIGTAP Aberto/);
});

test("ouvir entrega só o payload e devolve a função de cancelar", async () => {
  const cancelar = vi.fn();
  let cb: (e: { payload: unknown }) => void = () => {};
  (window as any).__TAURI__ = { core: { invoke: vi.fn() }, event: { listen: vi.fn(async (_n: string, f: typeof cb) => { cb = f; return cancelar; }) } };
  const recebido = vi.fn();
  const parar = await ouvir("progresso", recebido);
  cb({ payload: { fracao: 0.5 } });
  expect(recebido).toHaveBeenCalledWith({ fracao: 0.5 });
  parar();
  expect(cancelar).toHaveBeenCalled();
});
