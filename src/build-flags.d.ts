/**
 * Set at build time (wxt.config.ts, vitest.config.ts). True in dev mode (`wxt`) or with GSB_DEBUG_WHY=1, false for the store
 * build: the "Debug: show why" option, its matched-term tooltip and data-gsb-debug are then compiled out entirely.
 */
declare const __GSB_DEBUG_WHY__: boolean;

/**
 * Set at build time (wxt.config.ts). True only with GSB_BETA=1 (the owner's beta build). In the store build it is false and the
 * beta code (src/beta, src/content/report-snapshot.ts, the report page) is compiled out entirely.
 */
declare const __GSB_BETA__: boolean;
