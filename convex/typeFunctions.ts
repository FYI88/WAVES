// Platform-owned by Type. Public backend functions must use these wrappers.
// Import internalQuery/internalMutation/internalAction from _generated/server.
import { ConvexError } from "convex/values";
import {
  action as baseAction,
  httpAction as baseHttpAction,
  mutation as baseMutation,
  query as baseQuery,
} from "./_generated/server";
import { release } from "./typePlatform";

type BackgroundIntegrationRuntime = {
  endpoint: string;
  token: string;
  artifactId: string;
  organizationId: string;
};

const backgroundIntegrationRuntime: BackgroundIntegrationRuntime | null =
  null as BackgroundIntegrationRuntime | null;

type FunctionContext = {
  auth: {
    getUserIdentity(): Promise<unknown | null>;
  };
};

type FunctionHandler = (
  context: FunctionContext,
  args: unknown,
) => unknown | Promise<unknown>;

type FunctionDefinition = {
  handler: FunctionHandler;
  [key: string]: unknown;
};

type TypeAppIdentity = {
  viewer_type?: unknown;
  app_capabilities?: unknown;
  app_release?: unknown;
};

// Write implies read, so one capability check covers both the capability and
// the member requirement for every builder below.
async function authorize(
  context: FunctionContext,
  capability: "read" | "write",
  memberOnly: boolean,
): Promise<void> {
  const identity = await context.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: "APP_SESSION_REQUIRED" });
  }
  const appIdentity = identity as TypeAppIdentity;
  if (
    release !== null &&
    appIdentity.app_release !== release.promotionId
  ) {
    throw new ConvexError({ code: "APP_RELEASE_MISMATCH" });
  }
  const capabilities = appIdentity.app_capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes(capability)) {
    throw new ConvexError({ code: "APP_CAPABILITY_REQUIRED", capability });
  }
  if (memberOnly && appIdentity.viewer_type !== "member") {
    throw new ConvexError({ code: "TYPE_MEMBER_REQUIRED" });
  }
}

function capabilityDefinition(
  definition: unknown,
  capability: "read" | "write",
  memberOnly: boolean,
): unknown {
  if (typeof definition === "function") {
    const handler = definition as FunctionHandler;
    return async (context: FunctionContext, args: unknown) => {
      await authorize(context, capability, memberOnly);
      return await handler(context, args);
    };
  }

  const record = definition as FunctionDefinition;
  return {
    ...record,
    handler: async (context: FunctionContext, args: unknown) => {
      await authorize(context, capability, memberOnly);
      return await record.handler(context, args);
    },
  };
}

function capabilityBuilder<Builder>(
  builder: Builder,
  capability: "read" | "write",
  memberOnly: boolean,
): Builder {
  const base = builder as (definition: never) => unknown;
  return ((definition: unknown) =>
    base(
      capabilityDefinition(definition, capability, memberOnly) as never,
    )) as Builder;
}

export const query = capabilityBuilder(baseQuery, "read", false);
export const mutation = capabilityBuilder(baseMutation, "write", false);

// Actions cannot touch the database directly, but they can reach internal
// mutations, so the default action requires write. Use readAction for actions
// that only read or call outward: without it a read-only viewer cannot run
// them at all.
export const action = capabilityBuilder(baseAction, "write", false);
export const readAction = capabilityBuilder(baseAction, "read", false);
export const httpAction = capabilityBuilder(baseHttpAction, "write", false);

export const viewerQuery = capabilityBuilder(baseQuery, "read", true);
export const viewerMutation = capabilityBuilder(baseMutation, "write", true);
export const viewerAction = capabilityBuilder(baseAction, "write", true);
export const viewerReadAction = capabilityBuilder(baseAction, "read", true);
export const viewerHttpAction = capabilityBuilder(
  baseHttpAction,
  "write",
  true,
);

export type TypeAppBackgroundIntegrationResolution =
  | {
      status: "succeeded";
      invocationId: string;
      result: unknown;
      authorization?: {
        source: "publisher_personal";
        credentialOwnerName: string;
        accountLabel: string;
      };
    }
  | {
      status: "failed";
      code:
        | "configuration"
        | "integration_unavailable"
        | "operation_failed"
        | "outcome_unknown"
        | "permission_denied"
        | "rate_limited"
        | "validation";
      message: string;
      retryable: boolean;
      invocationId?: string;
      details?: { stage: "request" | "provider" | "response"; dispatched: boolean; field?: string; providerStatus?: number; providerCode?: string };
    };

function backgroundIntegrationFailure(
  code: Extract<TypeAppBackgroundIntegrationResolution, { status: "failed" }>["code"],
  message: string,
  retryable = false,
): TypeAppBackgroundIntegrationResolution {
  return { status: "failed", code, message, retryable };
}

function isBackgroundIntegrationFailureCode(
  value: unknown,
): value is Extract<
  TypeAppBackgroundIntegrationResolution,
  { status: "failed" }
>["code"] {
  return (
    value === "configuration" ||
    value === "integration_unavailable" ||
    value === "operation_failed" ||
    value === "outcome_unknown" ||
    value === "permission_denied" ||
    value === "rate_limited" ||
    value === "validation"
  );
}

/**
 * Executes one fixed, publish-approved Space integration read. Call this only
 * from a Convex action; queries and mutations cannot make outbound requests.
 * Type resolves the operation input from the active release, so app runtime
 * code cannot replace the approved SQL or provider arguments.
 */
export async function invokeBackgroundIntegration(
  capability: string,
): Promise<TypeAppBackgroundIntegrationResolution> {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(capability)) {
    return backgroundIntegrationFailure(
      "validation",
      "Background integration capability is invalid.",
    );
  }
  if (backgroundIntegrationRuntime === null) {
    return backgroundIntegrationFailure(
      "configuration",
      "Background integrations are available only on an active published app release.",
    );
  }

  const attemptId =
    "background-" +
    Date.now().toString(36) +
    "-" +
    crypto.randomUUID().replaceAll("-", "").slice(0, 32);
  let response: Response;
  try {
    // The operation executor owns the provider-appropriate deadline. A second,
    // shorter transport timeout here can abandon valid work while the server
    // continues running it and misreport that outcome as a connection failure.
    response = await fetch(backgroundIntegrationRuntime.endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer " + backgroundIntegrationRuntime.token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        artifactId: backgroundIntegrationRuntime.artifactId,
        organizationId: backgroundIntegrationRuntime.organizationId,
        capability,
        attemptId,
      }),
    });
  } catch {
    return backgroundIntegrationFailure(
      "outcome_unknown",
      "Type could not confirm the background integration outcome. Do not repeat the request automatically.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return backgroundIntegrationFailure(
      "outcome_unknown",
      "Type could not confirm the background integration outcome. Do not repeat the request automatically.",
    );
  }
  if (!payload || typeof payload !== "object" || !("status" in payload)) {
    return backgroundIntegrationFailure(
      "outcome_unknown",
      "Type could not confirm the background integration outcome. Do not repeat the request automatically.",
    );
  }
  const resolution = payload as {
    status?: unknown;
    invocationId?: unknown;
    result?: unknown;
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    details?: unknown;
    authorization?: unknown;
  };
  if (
    response.ok &&
    resolution.status === "succeeded" &&
    typeof resolution.invocationId === "string"
  ) {
    const authorization = resolution.authorization;
    const personalAuthorization =
      authorization &&
      typeof authorization === "object" &&
      "source" in authorization &&
      authorization.source === "publisher_personal" &&
      "credentialOwnerName" in authorization &&
      typeof authorization.credentialOwnerName === "string" &&
      "accountLabel" in authorization &&
      typeof authorization.accountLabel === "string"
        ? {
            source: "publisher_personal" as const,
            credentialOwnerName: authorization.credentialOwnerName,
            accountLabel: authorization.accountLabel,
          }
        : undefined;
    return {
      status: "succeeded",
      invocationId: resolution.invocationId,
      result: resolution.result,
      ...(personalAuthorization ? { authorization: personalAuthorization } : {}),
    };
  }
  if (
    resolution.status === "failed" &&
    isBackgroundIntegrationFailureCode(resolution.code) &&
    typeof resolution.message === "string" &&
    typeof resolution.retryable === "boolean"
  ) {
    const details = resolution.details;
    const safeDetails: Extract<TypeAppBackgroundIntegrationResolution, { status: "failed" }>["details"] = details && typeof details === "object"
      && "stage" in details && (details.stage === "request" || details.stage === "provider" || details.stage === "response")
      && "dispatched" in details && typeof details.dispatched === "boolean"
      ? {
          stage: details.stage,
          dispatched: details.dispatched,
          ...("field" in details && typeof details.field === "string" ? { field: details.field } : {}),
          ...("providerStatus" in details && typeof details.providerStatus === "number" ? { providerStatus: details.providerStatus } : {}),
          ...("providerCode" in details && typeof details.providerCode === "string" ? { providerCode: details.providerCode } : {}),
        } : undefined;
    return {
      ...(safeDetails ? { details: safeDetails } : {}),
      status: "failed",
      code: resolution.code,
      message: resolution.message,
      retryable: resolution.retryable,
      ...(typeof resolution.invocationId === "string" ? { invocationId: resolution.invocationId } : {}),
    };
  }
  return backgroundIntegrationFailure(
    "outcome_unknown",
    "Type could not confirm the background integration outcome. Do not repeat the request automatically.",
  );
}
