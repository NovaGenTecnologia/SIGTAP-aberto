import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("fora do programa, mostra erro claro e a ação de tentar de novo", async () => {
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/Abra o SIGTAP Aberto/);
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
});
