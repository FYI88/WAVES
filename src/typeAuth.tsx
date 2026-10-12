// Type owns this file and rewrites it on every checkout and build — edits here
// are lost. Import from it instead of calling client.setAuth() or writing an
// auth hook. The host distinguishes access denial from a temporary platform
// failure; reducing both to a null token would show the wrong screen.

import {
  Authenticated,
  AuthLoading,
  ConvexProviderWithAuth,
  ConvexReactClient,
  Unauthenticated,
} from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type TypeAppViewerKind = "anonymous" | "member" | "public_link";
type TypeAppSessionResolution =
  | {
      status: "granted";
      token: string;
      viewer: TypeAppViewerKind;
      capabilities: { read: true; write: boolean };
    }
  | {
      status: "denied";
      reason: "artifact_access" | "identity_required";
    }
  | {
      status: "unavailable";
      reason: "configuration" | "host_unavailable" | "platform" | "timeout";
    };
type TypeAppSessionState =
  | { status: "loading" }
  | TypeAppSessionResolution;
type TypeAppSessionView =
  | Extract<TypeAppSessionState, { status: "granted" }>
  | (Exclude<TypeAppSessionState, { status: "granted" }> & {
      capabilities: { read: false; write: false };
    });

const NO_TYPE_APP_CAPABILITIES = { read: false, write: false } as const;

const hostResolveSession = window.type?.appBackend?.resolveSession;
const viewerPolicy = window.type?.appBackend?.viewerIdentity ?? "anonymous";
const TypeAppSessionContext = createContext<TypeAppSessionState>({
  status: "loading",
});

/**
 * Builds the app's Convex client, or returns null when no backend is reachable.
 * fallbackBackendUrl is used only when running outside Type.
 */
export function createTypeAppClient(
  fallbackBackendUrl: string,
): ConvexReactClient | null {
  const backendUrl = window.type?.appBackend?.url ?? fallbackBackendUrl;
  return backendUrl.length > 0 ? new ConvexReactClient(backendUrl) : null;
}

function normalizeForViewerPolicy(
  resolution: TypeAppSessionResolution,
): TypeAppSessionResolution {
  if (
    viewerPolicy === "required" &&
    resolution.status === "granted" &&
    resolution.viewer !== "member"
  ) {
    return { status: "denied", reason: "identity_required" };
  }
  return resolution;
}

function useTypeAppSessionAuth() {
  const [session, setSession] = useState<TypeAppSessionState>({
    status: "loading",
  });

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!hostResolveSession) {
        setSession({
          status: "unavailable",
          reason: "host_unavailable",
        });
        return null;
      }
      const resolution = normalizeForViewerPolicy(
        await hostResolveSession({ forceRefresh: forceRefreshToken }),
      );
      setSession(resolution);
      return resolution.status === "granted" ? resolution.token : null;
    },
    [],
  );

  useEffect(() => {
    if (!hostResolveSession) {
      setSession({
        status: "unavailable",
        reason: "host_unavailable",
      });
      return;
    }
    let active = true;
    hostResolveSession().then(
      (resolution) => {
        if (!active) {
          return;
        }
        setSession(normalizeForViewerPolicy(resolution));
      },
      () => {
        if (!active) {
          return;
        }
        setSession({ status: "unavailable", reason: "platform" });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return {
    fetchAccessToken,
    isAuthenticated: session.status === "granted",
    isLoading: session.status === "loading",
    session,
  };
}

function TypeAppSessionMessage({
  session,
}: {
  session: Exclude<TypeAppSessionState, { status: "granted" }>;
}) {
  const message =
    session.status === "loading"
      ? "Loading app…"
      : session.status === "denied" &&
          session.reason === "identity_required"
        ? "Open this app from your Type workspace to continue."
        : session.status === "denied"
          ? "You don’t have access to this app."
          : session.reason === "host_unavailable"
            ? "Open this app in Type to use its data."
            : "The app service is temporarily unavailable. Reload and try again.";
  return (
    <main className="app-shell">
      <p className="text-secondary">{message}</p>
    </main>
  );
}

export function useTypeAppSession(): TypeAppSessionView {
  const session = useContext(TypeAppSessionContext);
  return session.status === "granted"
    ? session
    : { ...session, capabilities: NO_TYPE_APP_CAPABILITIES };
}

/**
 * Gates only the feature that needs a Type member. Anonymous and optional
 * apps should prefer this over making the whole app require identity.
 */
export function TypeAppIdentityGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const session = useTypeAppSession();
  if (session.status === "granted" && session.viewer === "member") {
    return children;
  }
  return (
    fallback ?? (
      <p className="text-secondary">
        Open this app from your Type workspace to use this feature.
      </p>
    )
  );
}

/**
 * Establishes the app-scoped backend session. Viewer identity is anonymous by
 * default and is included only when the app's viewer policy requests it.
 */
export function TypeAppProvider({
  children,
  client,
}: {
  children: ReactNode;
  client: ConvexReactClient;
}) {
  const auth = useTypeAppSessionAuth();
  const useAuth = useMemo(
    () => () => ({
      fetchAccessToken: auth.fetchAccessToken,
      isAuthenticated: auth.isAuthenticated,
      isLoading: auth.isLoading,
    }),
    [auth.fetchAccessToken, auth.isAuthenticated, auth.isLoading],
  );
  return (
    <TypeAppSessionContext.Provider value={auth.session}>
      <ConvexProviderWithAuth client={client} useAuth={useAuth}>
        <AuthLoading>
          <TypeAppSessionMessage session={{ status: "loading" }} />
        </AuthLoading>
        <Authenticated>{children}</Authenticated>
        <Unauthenticated>
          <TypeAppSessionMessage
            session={
              auth.session.status === "granted"
                ? { status: "unavailable", reason: "platform" }
                : auth.session
            }
          />
        </Unauthenticated>
      </ConvexProviderWithAuth>
    </TypeAppSessionContext.Provider>
  );
}
