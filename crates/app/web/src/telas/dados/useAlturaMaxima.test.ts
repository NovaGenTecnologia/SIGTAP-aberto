import { act, renderHook } from "@testing-library/react";
import { useAlturaMaxima } from "./useAlturaMaxima";

const janela = (altura: number) => { Object.defineProperty(window, "innerHeight", { value: altura, configurable: true }); window.dispatchEvent(new Event("resize")); };

test("a tabela cresce com a altura da janela e não passa de um mínimo confortável", () => {
  janela(1080);
  const { result } = renderHook(() => useAlturaMaxima());
  expect(result.current).toBe(1080 - 360);
  act(() => janela(768));
  expect(result.current).toBe(420);
  act(() => janela(1440));
  expect(result.current).toBe(1440 - 360);
});
