# Spoiler Blocker for GTA 6

![Logo](public/icon/128.PNG)

Chrome Web Store: under review for a while now; until then, [install it from GitHub below](#manual-installation-guide).

A long time ago there was an extension that blocked spoilers for Star Wars: Episode VII when it came out (before we knew it was bad). I wanted to replicate that but, far as I know that involved someone watching the move and adding the spoilers to the extension to block by hand, adding the spoilers would mean spoiling myself first.

This extension watches the community-run GTA wiki, labels new names and details as they are added, and publishes the result as a single list that the extension downloads. Claude does the labeling, tuned by me hand-labeling a large number of items and giving it rules. In testing, it currently labels about 85% of unknown entries from the GTA wiki correctly. It blocks spoilers in your browser based on the settings you choose.

## Manual installation guide

### First install

1. Open the [releases page](https://github.com/907-ClubMember/gta-spoil-blocker-extension-/releases/latest) and download the file ending in `-chrome.zip` (not "Source code").
2. Unzip it into a folder you will keep, for example "Documents/spoiler-blocker". Do not use your Downloads folder or a temporary folder.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Press **Load unpacked** and pick the unzipped folder.
5. Pin the icon: click the puzzle-piece menu next to the address bar and pin Spoiler Blocker for GTA 6.

### Updating

When a newer version is out, the extension's popup tells you, and its **How to update** button shows these same steps.

1. Download the latest zip from the [releases page](https://github.com/907-ClubMember/gta-spoil-blocker-extension-/releases/latest): the file ending in `-chrome.zip`, not "Source code".
2. Unzip it **over the same folder you loaded before**: pick that folder as the destination, or copy the files into it and choose Replace. A different folder is a separate copy that starts with default settings.
3. Open `chrome://extensions` and press **Reload** on the extension's card, then refresh any pages you have open.

Your settings stay as long as you use the same folder. The extension never downloads the new version itself; it only opens the releases page when you press the link.

### Uninstalling

1. Open `chrome://extensions` and press **Remove** on the extension's card.
2. If you want, delete the folder you unzipped it into.

## Screenshots

![A covered thread, before and after](docs/images/1-thread-sidebyside.png)

![A picture post with only the picture covered](docs/images/2-picture-sidebyside.png)

![The extension's popup](docs/images/3-popup.png)

![The settings page](docs/images/4-settings.png)

## What it does

- Works on YouTube (including live chat), Reddit (old and new), X, Bluesky, Facebook, Instagram, Twitch, Kick, Discord (web), Steam (store and community), Google, Bing, DuckDuckGo and Gmail, with basic support for other websites.
- Hides the whole post or comment.
- Hides everything from known spoiler accounts, and you can add your own.
- You choose how much to protect: only the big moments, the main story (the default), or everything, to be extra safe.
- Official trailers from the publisher and major game news channels play as normal, or you can choose to block them too.
- Reaction GIFs in replies are shown if they are judged likely to be safe. Reply photos stay covered unless you choose to show them, as there is no easy way to tell whether a screenshot contains spoilers.
- Hover over a cover to see why it is hidden, and adjust your settings if too much is being hidden.
- Safe and strict site lists, your own words to hide, and words never to hide.
- Works alongside common extensions such as ad blockers and dark-mode tools. Not every extension has been tested, so there may be issues I haven't accounted for, and not every extension will be supported.

## Limitations

This extension labels words from gta.wiki. It does not understand what the words mean, only what they are (a fictional car, a protagonist, etc.). If someone describes the story or spoilers of GTA 6 without any keywords, it can still get through: for example, "he dies", "she dies" or "the ending sucks" on a page with nothing else tying it to GTA 6. The extension also cannot tell whether an image is a spoiler. Images are blocked on pages about GTA 6, but a screenshot of a spoiler posted with no GTA 6 context would get through.

I would use this as a final layer of spoiler protection, after muting keywords on sites and leaving GTA 6-related communities. Because it is a Chrome extension, it only works on desktop Chrome; mobile apps such as Reddit and X are still a risk. It is meant for after you have taken every other precaution.

It labeled about 85% of entries correctly in testing. On GTA 6's wiki so far it has missed no spoilers, and it leans toward hiding more than needed, so some things that aren't spoilers may still get blocked.

## Report a problem

Something missed, something hidden that should not be, or a page that looks broken? Open an [issue](https://github.com/907-ClubMember/gta-spoil-blocker-extension-/issues/new/choose) and pick the form that fits:

- **Missed spoiler**: something that should have been covered was not.
- **Wrong hide**: something harmless was covered.
- **Broken page**: the extension breaks or misplaces a page.

**Never type a spoiler or a name from the game.** The forms never ask for one: you choose the site, paste the page link and tick three boxes. A program reads the reports, and there are systems in place to try to keep the issues page free of spoiler keywords at all times. Before you send a report, check the **Why** panel in the popup.

## Privacy

I am not interested in your data. Pages are read only inside your browser. No account, no tracking, no analytics. The only download is the spoiler list itself. The code is open source on GitHub.

## Browser support

Chrome is the only supported browser. The zip from GitHub can also be loaded in other Chromium-based browsers, but this is untested, as the extension has only been tested in Chrome.

## AI notice

Made heavily with AI, with hand-checking against earlier games to correct classification issues and push the labeling in the right direction. The artwork is human-made, and took a very, very grueling 30 seconds to make in Illustrator. If you are boycotting AI, this extension may not be for you. I made this as a project for myself and am sharing it for fun, to see if anyone else gets use out of it. It is far from perfect, but it is good enough for me.

## Credits

Thanks to the volunteer editors of GTA Wiki, whose work the list is built on (text under CC BY-SA). If this saved your playthrough, consider donating or contributing to them.

[GTA Wiki: donate](https://x.com/GTAWikiOfficial/status/2102401945772159220?a=hBmgLIC5wehSHM5Cu1s&s=20)
[GTA Wiki: how to help](https://gta.wiki/w/GTA_Wiki:How_to_Help)

If you want to throw me a bone as thanks, please make sure you have donated to GTA Wiki first:
[Ko-fi](https://ko-fi.com/ai_slop_fund)

## Disclaimer

Not affiliated with, endorsed by or connected to Rockstar Games, Take-Two Interactive or gta.wiki. Grand Theft Auto and GTA are trademarks of Take-Two Interactive.
