import { areaDe, contarPorArea } from "./areas";
import { queda, semAptidao, semValor } from "./exemplos";

test("cada tipo cai na sua área e o desconhecido vai para a Produção", () => {
  expect(areaDe({ ...semAptidao, tipo: "produz_sem_aptidao" })).toBe("aptidao");
  expect(areaDe({ ...semAptidao, tipo: "servico_fora_do_cadastro" })).toBe("cadastro");
  expect(areaDe({ ...semAptidao, tipo: "habilitacao_sem_producao" })).toBe("cadastro");
  expect(areaDe({ ...semAptidao, tipo: "rejeicao_acima_dos_pares" })).toBe("producao");
  expect(areaDe({ ...semAptidao, tipo: "tipo_que_nao_existe" })).toBe("producao");
});

test("contarPorArea soma por área e devolve zero nas que não têm", () => {
  const c = contarPorArea([queda, semAptidao, semValor]);
  expect(c.cadastro + c.aptidao + c.producao).toBe(3);
  expect(c.aptidao).toBe(1);
  expect(contarPorArea([])).toEqual({ cadastro: 0, aptidao: 0, producao: 0 });
});
