/* eslint-disable */
/**
 * Generated Type app API bindings.
 *
 * This source-derived declaration replaces Convex's temporary untyped stub.
 * The credential-free compiler stops before provider analysis, so retaining
 * that stub would erase query and mutation result types in the frontend.
 */
import type {
  AnyApi,
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as module_0 from "../app.js";
import type * as module_1 from "../typeAppData.js";
import type * as module_2 from "../typeFunctions.js";
import type * as module_3 from "../typePlatform.js";
import type * as module_4 from "../typeSchema.js";

declare const fullApi: ApiFromModules<{
  "app": typeof module_0;
  "typeAppData": typeof module_1;
  "typeFunctions": typeof module_2;
  "typePlatform": typeof module_3;
  "typeSchema": typeof module_4;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
// Backend modules import internal while this declaration imports those same
// modules to derive the public client. Keeping internal opaque breaks that
// declaration cycle without sacrificing frontend query result types.
export declare const internal: AnyApi;
