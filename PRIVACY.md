# Privacy

**What the extension reads:** the text of pages you visit, plus the captions, descriptions, titles and file names of their pictures and videos, only inside your browser, to decide what to hide. It also reads inside frames on a page (such as a comment box from another site), so those can be judged too. Nothing from a page is stored or sent anywhere.

**Spoiler accounts:** to hide everything a known spoiler account posts, the extension also reads the addresses of the links inside posts (a channel or profile link), only inside your browser. The built-in list of such accounts ships with the extension; accounts you add yourself are stored in your browser only.

**What it cannot see:** what is inside a picture or video. The picture-and-video options blur media because of where it sits (a page about the game, or a post that names it), not because anything looked at it.

**Inside your browser only:** when a page has frames, the extension passes one yes/no answer between the page and its frames ("is this page about the game?"), through the browser's own messaging. It never leaves your computer.

**What it stores (in your browser only):** your settings (strictness, blur strength and hide style, how you reveal things, the picture-and-video and sound options, the replies option, a mode for each kind of spoiler, the parts of a page you switch off, settings per site, a pause time, an end date, and the "finished the story" switch), your own keywords and allowed words, your hint words, your allow/block site lists, the spoiler-accounts switch and the accounts you added, and the downloaded spoiler list. The hidden-items count in the popup and on the toolbar icon is asked from the open page each time and not stored. Items you showed are remembered only in memory for as long as the page is open.

**The only network request the extension makes by itself:** downloading the spoiler list, one file, from `raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-`. It happens on the schedule you pick (hourly by default, or manual only) and when you press "Update now". The request carries no cookies, no account, and nothing about what you browse. GitHub can see that your IP address fetched the file, as with any download.

**The tip and help links** open GTA Wiki's site, its Ko-fi page, or the extension maker's Ko-fi page in a new tab only when you click one. The extension does not contact these sites on its own and does not send your browsing there.

**No analytics, no tracking, no accounts.** Settings are not synced between devices.

**Gmail, Discord and other private pages:** matching happens locally, like everywhere else. Hidden items are only blurred or removed on your screen.

**Permissions and why:** `storage` (settings and the list), `alarms` (the update timer), `contextMenus` (the "hide this on every page" right-click), `activeTab` (pause on the current site, and read the address of the tab you open the popup on), access to all pages and the frames in them (to scan them for spoilers), and access to `raw.githubusercontent.com` (the list download).

**One limit:** hiding changes the page, and the page's own scripts can see those changes. A site could work out that the extension is installed, or test whether a word you added gets hidden. Nothing is sent by the extension; this is how any page-changing extension works.
