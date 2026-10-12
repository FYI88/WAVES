// Platform-owned by Type. Lets this app's Convex backend verify
// Type-authorized viewers through ctx.auth.getUserIdentity(). Do not edit or delete.
export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.type.com/api/type-app-auth",
      jwks: "https://api.type.com/api/type-app-auth/jwks.json",
      algorithm: "RS256",
      applicationID: "type-app:v2:31:wart_01m49r5x6je9bt19v0f9gzqfcc:35:dev/wapb-01m49ywcs1e8ft8tgbpm85959m",
    },
  ],
};
