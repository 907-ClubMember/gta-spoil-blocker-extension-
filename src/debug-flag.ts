/**
 * The "Debug: show why" option (it shows matched terms, i.e. spoilers) exists only in dev builds or with GSB_DEBUG_WHY=1.
 * __GSB_DEBUG_WHY__ is set at build time (wxt.config.ts); scripts run outside the bundler see it undefined, so it reads false.
 * The store build replaces it with false, and every branch guarded by DEBUG_WHY is dropped (tests/e2e/store-build.spec.ts).
 */
export const DEBUG_WHY: boolean = typeof __GSB_DEBUG_WHY__ !== 'undefined' && __GSB_DEBUG_WHY__;
