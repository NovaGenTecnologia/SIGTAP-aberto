import "./tokens/tokens.css";
import "./tokens/base.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("raiz")!).render(<App />);
