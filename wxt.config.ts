import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const words = JSON.parse(readFileSync('extension-text.json', 'utf8')) as { manifest: { name: string; description: string } };

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: words.manifest.name,
    description: words.manifest.description,
    permissions: ['storage', 'alarms', 'contextMenus', 'activeTab'],
    host_permissions: ['https://raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/*'],
    // Named here because WXT only finds icons ending in lowercase .png on its own.
    icons: { 16: 'icon/16.PNG', 32: 'icon/32.PNG', 48: 'icon/48.PNG', 128: 'icon/128.PNG' },
    action: { default_icon: { 16: 'icon/16.PNG', 32: 'icon/32.PNG' } },
  },
});
