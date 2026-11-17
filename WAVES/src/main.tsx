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

// index.html owns the independent reload fallback if the bootstrap is missing.
const startup = window.wavesStartup;
startup?.start(async () => {
  const { mountApp } = await import("./mountApp");
  return mountApp(startup.ready);
});
