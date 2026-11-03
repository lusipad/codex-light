// The former combined account snapshot no longer has a product caller.
// Its signed-out, partial failure, identity and disposal contracts now exercise
// the production Usage loader/hook used by the separate account/usage pages.
await import("./verify-account-usage-b.mjs");
