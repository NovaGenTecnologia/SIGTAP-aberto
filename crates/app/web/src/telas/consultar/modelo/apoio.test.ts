import { rotuloDaTabela } from "./apoio";

test("tabelas que a busca acha ganham nome de gente, e as desconhecidas aparecem como vieram", () => {
  expect(rotuloDaTabela("tb_cid")).toBe("CID");
  expect(rotuloDaTabela("tb_descricao_detalhe")).toBe("Descrição oficial");
  expect(rotuloDaTabela("tb_forma_organizacao")).toBe("Forma de organização");
  expect(rotuloDaTabela("tb_qualquer")).toBe("tb_qualquer");
});
