import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import * as AppModule from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");
const components: { App?: ComponentType; default?: ComponentType } = AppModule;
const App = components.App ?? components.default;
if (!App) throw new Error("App.tsx must export an App component");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
