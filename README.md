# Spoiler Blocker for GTA 6

**Browse the internet without getting GTA 6 spoiled.**

A free Chrome extension that hides GTA 6 spoilers on the sites you already use: YouTube (including live chat), Reddit, X,
Bluesky, Threads, Facebook, Instagram, Twitch and Kick chat, Discord, Steam, Google, Bing and ordinary websites. Who dies, the twists, the ending, the last missions: covered up before you see them.
Everything else on the page stays the way it was.

## How it works

1. **It knows what to look for.** A list of GTA 6 story names (characters, missions, places, big moments) is updated every hour
   while the game's fan wikis fill in after launch. You never see the list.
2. **It checks each page as it loads**, on your own computer, before the page is even shown.
3. **It covers just the spoiler**: that one post, comment, video or chat message gets blurred with a small label like
   "Hidden: story spoiler". Click it if you want to peek.

It also hides everything posted by known spoiler accounts, and it won't hide someone just asking for "no spoilers please".

## You're in control

- **How much to hide:** only the big moments, the main story (the default), or everything.
- **How it looks:** blur, collapse, or remove completely.
- **Where:** pause it on a site, mark sites as safe, or make a site extra strict.
- **When to stop:** set a date, or tell it you've finished the story.
- **Your own words:** add anything else you want hidden.

## Private by design

Pages are checked only inside your browser. Nothing you read is sent anywhere: no tracking, no ads, no account, no analytics.
The only thing it downloads is the spoiler list itself. Full details: [privacy policy](https://gist.github.com/907-ClubMember/d4d83238a67f3b81a3cd80b687c30c24).

## Install

Coming soon on the Chrome Web Store.

## Something got through, or something was hidden by mistake?

Use **Issues > New issue > "Report a spoiler or a wrongly hidden post"** and give a link to the page. **Please don't type the
spoiler itself**: reports are checked by a tool, and the maintainer is playing the game too.

## Thanks

The list is built from the work of the volunteer editors of [GTA Wiki](https://gta.wiki), the GTA Wiki on Fandom and Wikipedia
(text under CC BY-SA). Only names are kept, never their writing. If this saved your playthrough, consider
[tipping GTA Wiki](https://ko-fi.com/gtawiki).

Not affiliated with, endorsed by or connected to Rockstar Games or Take-Two Interactive. Grand Theft Auto and GTA are trademarks
of Take-Two Interactive.

---

### Check it yourself

This repository is here so anyone can check what the extension does on their computer.

- **What it downloads:** one file, the spoiler list, from
  `raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/main/lists/dist/spoilers.json`. It holds only names, never code. They are
  base64-encoded so that opening the file doesn't spoil you; `src/list/index.ts` shows how it is read. Nothing else is fetched or sent; the address is in
  `src/list/store.ts`.
- **Permissions** (in `wxt.config.ts`): `storage` (your settings and the list), `alarms` (the update timer), `contextMenus`
  (the right-click "hide this"), `activeTab` (pause on the current site), all pages (to check them for spoilers), and
  `raw.githubusercontent.com` (the list download). Details in [PRIVACY.md](PRIVACY.md).
- **Same code as the store:** each store version has a tag here (for example `v0.1.0`). Build that tag and compare it with
  the store version.

To build it: `npm ci`, then `npm run build` (output in `.output/`). Pull requests with code are not accepted. To report a safety problem privately, see [SECURITY.md](SECURITY.md); to report a missed or wrongly hidden spoiler,
use the report form above and give a link only.
