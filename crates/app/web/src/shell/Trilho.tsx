import { DESTINOS, useRota } from "./rotas";

export function Trilho() {
  const { destino } = useRota();
  return (
    <nav className="trilho" aria-label="Principal">
      <ul className="trilho__lista">
        {DESTINOS.map((d) => (
          <li key={d.id}>
            <a href={`#/${d.id}`} className="trilho__item" aria-current={destino === d.id ? "page" : undefined}>{d.rotulo}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
