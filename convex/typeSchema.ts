// Platform-owned by Type. Preserve the typePlatformTables spread in schema.ts.
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const typePlatformTables = {
  typeLegacyDocuments: defineTable({
    migrationId: v.string(),
    collection: v.string(),
    docId: v.string(),
    data: v.any(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_collection", ["collection"])
    .index("by_collection_doc", ["collection", "docId"])
    .index("by_migration", ["migrationId"]),
  typeLegacyMigrationBatches: defineTable({
    migrationId: v.string(),
    batchKey: v.string(),
    documentCount: v.number(),
  })
    .index("by_migration", ["migrationId"])
    .index("by_migration_batch", ["migrationId", "batchKey"]),
};
