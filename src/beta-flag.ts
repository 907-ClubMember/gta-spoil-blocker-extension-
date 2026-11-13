/**
 * The beta flavour (the owner's own browser: a "This looks wrong" report, a BETA badge) exists only when built with GSB_BETA=1.
 * __GSB_BETA__ is set at build time (wxt.config.ts); scripts run outside the bundler see it undefined, so it reads false.
 * The store build replaces it with false, and every branch guarded by BETA is dropped (tests/e2e/store-build.spec.ts).
 */
export const BETA: boolean = typeof __GSB_BETA__ !== 'undefined' && __GSB_BETA__;
