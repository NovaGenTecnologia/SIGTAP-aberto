import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorFalso as unknown as typeof ResizeObserver;
// Os testes rodam com redução de movimento ligada (a abertura não espera 2 s); abertura.test.tsx liga o movimento.
window.matchMedia ??= ((consulta: string) => ({
  matches: consulta.includes("reduce"), media: consulta, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
