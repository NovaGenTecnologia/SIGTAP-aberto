import { ProgressBar } from "react-aria-components";
import "./base.css";

export function Progresso({ rotulo, valor }: { rotulo: string; valor?: number }) {
  return (
    <ProgressBar className="progresso" value={valor} isIndeterminate={valor === undefined} aria-label={rotulo}>
      {({ percentage }) => (
        <>
          <div className="progresso__trilho">
            <div className="progresso__barra" data-indeterminado={valor === undefined || undefined}
              ref={(el) => { if (el && percentage !== undefined) el.style.width = `${percentage}%`; }} />
          </div>
        </>
      )}
    </ProgressBar>
  );
}
