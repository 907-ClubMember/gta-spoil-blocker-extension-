import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';
import { BETA_COMMAND, BETA_MENU_TITLE, BETA_SHORTCUT } from './src/beta/strings';

const words = JSON.parse(readFileSync('extension-text.json', 'utf8')) as { manifest: { name: string; description: string } };

// The beta flavour (the owner's own browser) is built only with GSB_BETA=1; the store build has none of it (src/beta-flag.ts).
const BETA = process.env.GSB_BETA === '1';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
/** Text after "beta." in version_name: GSB_BETA_ID if set, else <yyyymmdd> <short commit>. Chrome's own `version` stays numeric. */
const betaId = () => {
  if (process.env.GSB_BETA_ID) return process.env.GSB_BETA_ID;
  let commit = 'nogit';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  return `${new Date().toISOString().slice(0, 10).replace(/-/g, '')} ${commit}`;
};

export default defineConfig({
  srcDir: 'src',
  // GSB_OUT_DIR lets a second build (the beta one for tests) go to its own folder.
  outDir: process.env.GSB_OUT_DIR ?? '.output',
  // The report page exists only in the beta flavour: the store build does not even emit report.html.
  // The beta build alone adds `downloads` (the report files are written to Downloads); the permissions list below stays the store's.
  hooks: {
    // The store zip is never a beta build (scripts/zip-store.ts also clears GSB_BETA for wxt zip).
    'zip:start': () => { if (BETA) throw new Error('GSB_BETA=1 is set: a beta build is never zipped for the store'); },
    // The beta build alone also has the "This looks wrong" shortcut (`commands` needs no permission; the owner can change the key at
    // chrome://extensions/shortcuts). The store manifest has no `commands`.
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!BETA) return;
      manifest.permissions = [...(manifest.permissions ?? []), 'downloads'];
      manifest.commands = { [BETA_COMMAND]: { suggested_key: { default: BETA_SHORTCUT }, description: BETA_MENU_TITLE } };
    },
    'entrypoints:resolved': (_wxt, entrypoints) => { if (!BETA) for (let i = entrypoints.length - 1; i >= 0; i--) if (entrypoints[i]!.name === 'report') entrypoints.splice(i, 1); },
  },
  // The debug option (shows matched terms, i.e. spoilers) exists only in dev builds or with GSB_DEBUG_WHY=1; never in the store zip.
  vite: (env) => ({ define: { __GSB_DEBUG_WHY__: JSON.stringify(env.mode === 'development' || process.env.GSB_DEBUG_WHY === '1'), __GSB_BETA__: JSON.stringify(BETA) } }),
  manifest: {
    name: BETA ? `${words.manifest.name} (BETA)` : words.manifest.name,
    ...(BETA ? { version_name: `${pkg.version}-beta.${betaId()}` } : {}),
    description: words.manifest.description,
    permissions: ['storage', 'alarms', 'contextMenus', 'activeTab'],
    host_permissions: ['https://raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/*'],
    // Named here because WXT only finds icons ending in lowercase .png on its own.
    icons: { 16: 'icon/16.PNG', 32: 'icon/32.PNG', 48: 'icon/48.PNG', 128: 'icon/128.PNG' },
    action: { default_icon: { 16: 'icon/16.PNG', 32: 'icon/32.PNG' } },
  },
});
