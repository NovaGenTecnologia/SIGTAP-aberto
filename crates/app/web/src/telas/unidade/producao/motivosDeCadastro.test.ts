import { destinoDoMotivo } from "./motivosDeCadastro";

test.each([
  ["060072", "servicos"], ["060055", "servicos"],
  ["050098", "habilitacoes"], ["060120", "habilitacoes"],
  ["050008", "leitos"], ["060020", "leitos"], ["060021", "leitos"], ["060022", "leitos"],
  ["060110", "profissionais"], ["060065", "profissionais"],
])("o motivo %s leva ao Cadastro, aba %s", (codigo, aba) => {
  expect(destinoDoMotivo(codigo)).toEqual({ rotulo: "Ver no Cadastro", tela: { tela: "cadastro", aba, q: "" } });
});

test("motivo fora da lista curada não ganha link", () => {
  for (const codigo of ["020069", "060225", "999999", "", "60072"]) expect(destinoDoMotivo(codigo)).toBeNull();
});

test("o código vem com espaços do arquivo e ainda assim acha o destino", () => {
  expect(destinoDoMotivo(" 060072 ")?.tela).toEqual({ tela: "cadastro", aba: "servicos", q: "" });
});
