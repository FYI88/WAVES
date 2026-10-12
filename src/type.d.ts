// Types for the runtime bridge Type injects on window.type when the app runs
// inside Type. All members are absent when the app is opened standalone.

type TypeAppBackendRuntime = {
  /** The app's Convex deployment URL. */
  url?: string;
  /** The app's Convex HTTP Actions URL. */
  httpActionsUrl?: string;
  /** "active" on the live app, "development" on an editor's isolated draft,
   * and "preview" for read-only verification or thumbnails. */
  renderMode?: "active" | "development" | "preview";
  /** Whether this app uses anonymous sessions, optionally recognizes Type
   * members, or requires a Type member. */
  viewerIdentity?: "anonymous" | "optional" | "required";
  /** Resolves the short-lived, app-scoped backend session. Apps use the
   * platform-owned TypeAppProvider rather than calling this directly. */
  resolveSession?: (options?: {
    forceRefresh?: boolean;
    forceRefreshToken?: boolean;
  }) => Promise<
    | {
        status: "granted";
        token: string;
        viewer: "anonymous" | "member" | "public_link";
        capabilities: { read: true; write: boolean };
      }
    | {
        status: "denied";
        reason: "artifact_access" | "identity_required";
      }
    | {
        status: "unavailable";
        reason:
          | "configuration"
          | "host_unavailable"
          | "platform"
          | "timeout";
      }
  >;
};

type TypeAiPrompt =
  | string
  | Array<{ role: "user" | "assistant"; content: string }>;

type TypeAiOptions = {
  system?: string;
  /** Maximum 1,024. */
  maxOutputTokens?: number;
};

type TypeAiRuntime = {
  available: boolean;
  complete: {
    (
      promptOrMessages: TypeAiPrompt,
      options: TypeAiOptions & {
        schema: Record<string, unknown> & { type: "object" };
      },
    ): Promise<Record<string, unknown>>;
    (
      promptOrMessages: TypeAiPrompt,
      options?: TypeAiOptions & { schema?: never },
    ): Promise<string>;
  };
};

type TypeIntegrationError = Error & {
  invocationId?: string;
  details?: { stage: "request" | "provider" | "response"; dispatched: boolean; field?: string; providerStatus?: number; providerCode?: string };
  code:
    | "approval_cancelled"
    | "approval_required"
    | "configuration"
    | "integration_unavailable"
    | "operation_failed"
    | "outcome_unknown"
    | "permission_denied"
    | "rate_limited"
    | "validation";
  retryable: boolean;
};

type TypeIntegrationsRuntime = {
  /** Invoke an alias declared in .type/integrations.json. Type resolves the
   * exact Space connection and keeps credentials outside the app. Reads may
   * omit intentId. Writes and destructive operations require a stable intentId
   * derived from a persisted app resource or job plus the workflow step. Reuse
   * that intentId when retrying; never retry an outcome_unknown result. */
  invoke<TResult = unknown>(
    operation: string,
    input: Record<string, unknown>,
    options?: { intentId?: string },
  ): Promise<TResult>;
};

interface Window {
  type?: {
    appBackend?: TypeAppBackendRuntime;
    /** Available on the live, authenticated app surface. Rejections are
     * TypeIntegrationError values. */
    integrations?: TypeIntegrationsRuntime;
    /** Not available in this app. App-owned data lives in the app's own Convex
     * deployment: declare it in convex/schema.ts and read or write it with
     * Convex queries and mutations. Reading or assigning this throws at
     * runtime, so a local shim is not a fallback either. */
    appData?: never;
  };
  /** Capped, one-turn AI completions. Available only on supported surfaces. */
  typeAi?: TypeAiRuntime;
  /** Legacy alias of window.type.appData, kept only for old static artifacts.
   * Not available in this app; reading or assigning it throws at runtime. */
  typeDb?: never;
}
