import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import * as AppModule from "./App";
import { AppErrorBoundary } from "./App";
// Bundled fonts: no runtime request to Google Fonts, so the APK works fully offline.
// Latin + Greek subsets cover the FR/EN UI and the physics symbols (ε, σ, θ, η, λ, δ).
import "@fontsource/inter-tight/latin-400.css";
import "@fontsource/inter-tight/latin-500.css";
import "@fontsource/inter-tight/latin-600.css";
import "@fontsource/inter-tight/latin-700.css";
import "@fontsource/inter-tight/latin-800.css";
import "@fontsource/inter-tight/greek-400.css";
import "@fontsource/inter-tight/greek-500.css";
import "@fontsource/inter-tight/greek-600.css";
import "@fontsource/inter-tight/greek-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/greek-400.css";
import "@fontsource/jetbrains-mono/greek-500.css";
import "@fontsource/jetbrains-mono/greek-600.css";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");
const components: { App?: ComponentType; default?: ComponentType } = AppModule;
const App = components.App ?? components.default;
if (!App) throw new Error("App.tsx must export an App component");

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
