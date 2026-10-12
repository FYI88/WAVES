import { v } from "convex/values";
import { query } from "./typeFunctions";

// A neutral round trip that confirms the generated frontend and backend are
// connected before the agent adds app-specific functions.
export const status = query({
  args: {},
  returns: v.object({ ready: v.boolean() }),
  handler: async () => ({ ready: true }),
});
