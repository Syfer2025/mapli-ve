import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import "./styles/global.css";

const container = document.getElementById("root");
if (container === null) throw new Error("elemento #root não encontrado em index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
