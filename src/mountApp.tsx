import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import * as AppModule from "./App";
import { AppErrorBoundary } from "./App";
import "./styles.css";

export function mountApp(onReady: () => void): () => void {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing #root element");
  const components: { App?: ComponentType<{ onReady?: () => void }>; default?: ComponentType<{ onReady?: () => void }> } = AppModule;
  const App = components.App ?? components.default;
  if (!App) throw new Error("App.tsx must export an App component");
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <AppErrorBoundary onError={onReady}>
        <App onReady={onReady} />
      </AppErrorBoundary>
    </StrictMode>,
  );
  return () => root.unmount();
}
