import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ServiceProvider } from "./services/service-context";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <ServiceProvider>
      <App />
    </ServiceProvider>
  </StrictMode>,
);
