# Spoiler Blocker for GTA 6
![logo of the extension](https://raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/refs/heads/main/Artboard%201.PNG.png)

There was an extension a long time ago for blocking spoilers for StarWars episode 7 when it came out. (Before we knew it as bad). I was wondering how to replicate that without having to read gta.wiki and block them myself. Which would require someone to know or spoil the plot for themselves.

This extension was created to try and solve that, I have given claude a set of rules then flagged by hand things from GTA 4+DLC + GTA 5 + RDR2, this was iterated several times over with my spot checking and giving corrections on how to flag what text in gta.wiki. This hopefully will then correctly label content from GTA.wiki as it is added.

## AI notice

If it wasn't obvious this heavily uses AI. The only things not AI is the artwork made by my wonderful girlfriend and this README as I hate reading AI slop someone half-assed. This was made from the claude Pro sub vibecoded on my laptop.

## How it works

1. Scrapes the gta.wiki for GTA 6 content then labels the content based off its rules, this is then stored encoded in "spoilers.json" on this repo
2. The extension then gets updates from "spoilers.json" as new content is labeled
3. Then using the settings in your instance of the extension content is flagged based on its label 


## Supported sites
Youtube + live chat, old/new Reddit, X, Bluesky, Facebook, Insta, Twitch, Kick, Discord (web version), Steam, Google, Bing, and most normal websites with generic support

## Features

- **How much to hide:** customizable level of hiding based off pre-sets can be customized.  
- **Where:** Can whitelist / blacklist sites, hide media / audio on sites as it plays
- **Your own words:** add custom keywords to blacklist
- **Known spoilers** currently hardcoded to block "Shirrako" other accounts can be added to your instance of the extension 

## Privacy

Pages are checked only inside your browser. I get no information from you installing this extension and no changes occur to your browser besides the blocking. If someone does try to sell me on injecting code to sell residential proxies I'll put them on blast like the GOAT [Ajay](https://sponsor.ajay.app/emails) Full details: [privacy policy](https://gist.github.com/907-ClubMember/d4d83238a67f3b81a3cd80b687c30c24).

## Install
# TODO
Put chrome webstore link here 

## Thanks

The list is built from the work of the volunteer editors of [GTA Wiki](https://gta.wiki), 
(text under CC BY-SA). If this saved your playthrough, consider
[tipping GTA Wiki](https://ko-fi.com/gtawiki) and [helping with the wiki](https://gta.wiki/w/GTA_Wiki:How_to_Help). You can also tip [me](https://ko-fi.com/ai_slop_fund) if you wanna help me make more projects or to show your thanks.

Not affiliated with, endorsed by or connected to Rockstar Games, Take-Two Interactive, gta.wiki. Grand Theft Auto and GTA are trademarks
of Take-Two Interactive.

---

### Open source

All code here is public so anyone can look / tweak it 

- **what the extension downloads:** one file, the spoiler list, from
  `raw.githubusercontent.com/907-ClubMember/gta-spoil-blocker-extension-/main/lists/dist/spoilers.json`. It holds text related to spoilers. They are
  base64-encoded so that opening the file doesn't spoil you; `src/list/index.ts` shows how it is read. Nothing else is fetched or sent; the address is in
  `src/list/store.ts`.
- **Permissions** (in `wxt.config.ts`): `storage` (your settings and the list), `alarms` (the update timer), `contextMenus`
  (the right-click "hide this"), `activeTab` (pause on the current site), all pages (to check them for spoilers), and
  `raw.githubusercontent.com` (the list download). Details in [PRIVACY.md](PRIVACY.md).
- **Same code as the store:** each store version has a tag here (for example `v0.1.0`). Build that tag and compare it with
  the store version.

