// Platform-owned by Type. Used only to verify backend availability and release identity.
import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

type TypeAppRelease = {
  version: 1;
  appId: string;
  promotionId: string;
  attemptGeneration: number;
  sourceHash: string;
  checkpointHash: string;
  convexBackendHash: string | null;
};

// Keep the neutral development value widened to the production release shape.
// A const assertion cannot be applied to null and would also make the branch
// below unreachable to TypeScript before the production overlay is injected.
export const release = null as TypeAppRelease | null;

export const status = query({
  args: {},
  returns: v.object({
    ready: v.literal(true),
    release: v.union(
      v.null(),
      v.object({
        version: v.literal(1),
        appId: v.string(),
        promotionId: v.string(),
        attemptGeneration: v.number(),
        sourceHash: v.string(),
        checkpointHash: v.string(),
        convexBackendHash: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async () => ({ ready: true as const, release }),
});

export const session = query({
  args: {},
  returns: v.object({
    capabilities: v.array(v.string()),
    viewerType: v.string(),
  }),
  handler: async (context) => {
    const identity = await context.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({ code: "APP_SESSION_REQUIRED" });
    }
    if (
      release !== null &&
      identity.app_release !== release.promotionId
    ) {
      throw new ConvexError({ code: "APP_RELEASE_MISMATCH" });
    }
    return {
      capabilities: Array.isArray(identity.app_capabilities)
        ? identity.app_capabilities.filter(
            (capability): capability is string =>
              typeof capability === "string",
          )
        : [],
      viewerType:
        typeof identity.viewer_type === "string"
          ? identity.viewer_type
          : "unknown",
    };
  },
});

const legacyDocument = v.object({
  collection: v.string(),
  docId: v.string(),
  data: v.any(),
  version: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

// Type calls these internal functions with a short-lived maintenance key.
// Each batch and its marker commit in one transaction, so replaying a DBOS
// step after a lost response cannot duplicate legacy records.
export const importLegacyDocuments = internalMutation({
  args: {
    migrationId: v.string(),
    batchKey: v.string(),
    documents: v.array(legacyDocument),
  },
  returns: v.object({ batchKey: v.string(), processed: v.number() }),
  handler: async (context, args) => {
    const prior = await context.db
      .query("typeLegacyMigrationBatches")
      .withIndex("by_migration_batch", (query) =>
        query.eq("migrationId", args.migrationId).eq("batchKey", args.batchKey),
      )
      .unique();
    if (prior !== null) {
      if (prior.documentCount !== args.documents.length) {
        throw new ConvexError({ code: "LEGACY_MIGRATION_BATCH_MISMATCH" });
      }
    }

    for (const document of args.documents) {
      const existing = await context.db
        .query("typeLegacyDocuments")
        .withIndex("by_collection_doc", (query) =>
          query
            .eq("collection", document.collection)
            .eq("docId", document.docId),
        )
        .unique();
      const value = { ...document, migrationId: args.migrationId };
      if (existing === null) {
        await context.db.insert("typeLegacyDocuments", value);
      } else {
        await context.db.patch(existing._id, value);
      }
    }
    if (prior === null) {
      await context.db.insert("typeLegacyMigrationBatches", {
        migrationId: args.migrationId,
        batchKey: args.batchKey,
        documentCount: args.documents.length,
      });
    }
    return { batchKey: args.batchKey, processed: args.documents.length };
  },
});

export const legacyMigrationStatus = internalMutation({
  args: { migrationId: v.string() },
  returns: v.object({
    documentCount: v.number(),
    batches: v.array(
      v.object({ batchKey: v.string(), documentCount: v.number() }),
    ),
  }),
  handler: async (context, args) => {
    const batches = await context.db
      .query("typeLegacyMigrationBatches")
      .withIndex("by_migration", (query) =>
        query.eq("migrationId", args.migrationId),
      )
      .take(2001);
    if (batches.length > 2000) {
      throw new ConvexError({ code: "LEGACY_MIGRATION_BATCH_LIMIT" });
    }
    return {
      // Import writes every document and this receipt in one transaction.
      // Summing the small receipts verifies the complete import without
      // reading up to 2,000 large document payloads in one transaction.
      documentCount: batches.reduce(
        (total, batch) => total + batch.documentCount,
        0,
      ),
      batches: batches.map((batch) => ({
        batchKey: batch.batchKey,
        documentCount: batch.documentCount,
      })),
    };
  },
});

// A failed pre-activation attempt can leave data in the otherwise-unpublished
// production deployment. Remove rows from old migration identities in small
// transactions before the current snapshot is verified.
export const cleanupLegacyMigrations = internalMutation({
  args: { currentMigrationId: v.string() },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (context, args) => {
    const batches = await context.db
      .query("typeLegacyMigrationBatches")
      .take(2001);
    if (batches.length > 2000) {
      throw new ConvexError({ code: "LEGACY_MIGRATION_BATCH_LIMIT" });
    }
    const stale = batches.find(
      (batch) => batch.migrationId !== args.currentMigrationId,
    );
    if (stale === undefined) {
      return { deleted: 0, done: true };
    }

    const documents = await context.db
      .query("typeLegacyDocuments")
      .withIndex("by_migration", (query) =>
        query.eq("migrationId", stale.migrationId),
      )
      .take(32);
    for (const document of documents) {
      await context.db.delete(document._id);
    }
    if (documents.length > 0) {
      return { deleted: documents.length, done: false };
    }

    const staleBatches = await context.db
      .query("typeLegacyMigrationBatches")
      .withIndex("by_migration", (query) =>
        query.eq("migrationId", stale.migrationId),
      )
      .take(32);
    for (const batch of staleBatches) {
      await context.db.delete(batch._id);
    }
    return { deleted: staleBatches.length, done: false };
  },
});
