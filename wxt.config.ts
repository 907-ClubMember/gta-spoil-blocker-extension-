import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Spoiler Blocker for GTA 6',
    description: 'Hides GTA 6 spoilers across the web. Runs locally; the spoiler list updates itself.',
    permissions: ['storage', 'alarms', 'contextMenus', 'activeTab'],
    host_permissions: ['https://raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/*'],
  },
});
