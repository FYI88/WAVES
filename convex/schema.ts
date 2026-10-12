import { defineSchema } from "convex/server";
import { typePlatformTables } from "./typeSchema";

// Keep the platform tables spread, then add the app's own tables.
export default defineSchema({
  ...typePlatformTables,
});
