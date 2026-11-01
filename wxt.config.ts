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
  },
});
