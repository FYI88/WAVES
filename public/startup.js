/* Local classic script: runs before React, fonts, state hydration or physics. */
(function () {
  var shell = document.getElementById("startup-shell");
  var status = document.getElementById("startup-status");
  var retry = document.getElementById("startup-retry");
  var root = document.getElementById("root");
  var fr = navigator.language.toLowerCase().indexOf("fr") === 0;
  var finished = false;
  var disposed = false;
  var started = false;
  var frame = 0;
  var unmount;
  var reload = function () { window.location.reload(); };
  var message = function (text) {
    if (status) status.textContent = text;
    if (retry) retry.hidden = false;
  };
  if (status) status.textContent = fr ? "Chargement de la simulation…" : "Loading simulation…";
  if (retry) {
    retry.textContent = fr ? "Réessayer" : "Retry";
    retry.addEventListener("click", reload);
  }
  // A slow device is not a fatal error. Keep the shell and accept a late commit.
  var deadline = window.setTimeout(function () {
    if (finished || disposed) return;
    message(fr ? "Le chargement prend plus de temps que prévu. Vous pouvez patienter ou réessayer." : "Loading is taking longer than expected. You can keep waiting or retry.");
  }, 8000);
  var stopWaiting = function () {
    window.clearTimeout(deadline);
    window.cancelAnimationFrame(frame);
  };
  var ready = function () {
    if (finished || disposed) return;
    finished = true;
    stopWaiting();
    if (root) root.removeAttribute("aria-busy");
    // If a late commit replaces a focused retry, don't lose keyboard position.
    if (retry && document.activeElement === retry && root) {
      root.setAttribute("tabindex", "-1");
      root.focus();
    }
    if (retry) retry.removeEventListener("click", reload);
    document.removeEventListener("error", resourceError, true);
    if (shell) shell.remove();
  };
  var fail = function () {
    if (finished || disposed) return;
    stopWaiting();
    message(fr ? "Impossible de charger l’application. Réessayez ; si vous êtes en ligne, vérifiez votre connexion." : "The app could not load. Retry; if using the web, check your connection.");
  };
  // Vite moves the module script into <head> and drops inline onerror. Capture
  // resource errors here as well, before deferred modules execute.
  var resourceError = function (event) {
    var target = event.target;
    if (target && ((target.tagName === "SCRIPT" && target.type === "module") ||
      (target.tagName === "LINK" && target.rel === "stylesheet"))) fail();
  };
  document.addEventListener("error", resourceError, true);
  window.wavesStartup = {
    ready: ready,
    fail: fail,
    start: function (load) {
      if (started || finished || disposed) return;
      started = true;
      // Two frames allow the HTML shell to paint before importing/evaluating
      // App and its synchronous loadInitial/results/sweep work. No timed delay.
      frame = window.requestAnimationFrame(function () {
        if (disposed || finished) return;
        frame = window.requestAnimationFrame(function () {
          if (disposed || finished) return;
          Promise.resolve().then(function () {
            if (!disposed && !finished) return load();
          }).then(function (cleanup) {
            if (disposed) { if (cleanup) cleanup(); }
            else unmount = cleanup;
          }).catch(fail);
        });
      });
    },
    dispose: function () {
      if (disposed) return;
      disposed = true;
      stopWaiting();
      if (retry) retry.removeEventListener("click", reload);
      document.removeEventListener("error", resourceError, true);
      if (unmount) unmount();
    },
  };
})();
