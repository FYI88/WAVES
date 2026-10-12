import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import * as AppModule from "./App";
import "./styles.css";
import { createTypeAppClient, TypeAppProvider } from "./typeAuth";

// Inside Type, the platform injects the app's backend location on
// window.type.appBackend. The literal fallback is this build's isolated
// development deployment, used only when testing outside Type.
const DEVELOPMENT_BACKEND_URL = "https://mellow-malamute-48.convex.cloud";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}
const root = createRoot(rootElement);
const client = createTypeAppClient(DEVELOPMENT_BACKEND_URL);
// Accept either normal React export convention while retaining typechecking.
const components: { App?: ComponentType; default?: ComponentType } = AppModule;
const App = components.App ?? components.default;
if (!App) throw new Error("App.tsx must export an App component");

if (!client) {
  root.render(
    <main className="app-shell">
      <p className="text-secondary">
        App data is temporarily unavailable. Reload the app and try again.
      </p>
    </main>,
  );
} else {
  // TypeAppProvider establishes an app-scoped backend session. The session is
  // anonymous unless .type/viewer-policy.json opts into Type identity.
  root.render(
    <StrictMode>
      <TypeAppProvider client={client}>
        <App />
      </TypeAppProvider>
    </StrictMode>,
  );
}
