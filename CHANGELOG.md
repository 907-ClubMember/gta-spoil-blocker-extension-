# Changelog

## 0.1.5

### Highlights

- Settings has a new Current settings panel: what is on, what you changed, and whether hiding is paused. It stays in view on every tab.
- "Hide picture and video posts" is explained more clearly, and is greyed out, with the reason, when it can't do anything.
- Where Settings names the choice you start with, it now says "(default)" instead of "recommended".

### New

- **Current settings panel.** Settings now shows a summary of what is in effect: on or off and the level, what is hidden, the settings you changed (each one a link that takes you to it), your safe sites, strict sites, own words and other lists as counts, and whether hiding is paused, with a Resume now button. On a wide window it sits beside the settings; on a narrow one it is a bar at the top that opens with a tap. It updates as you change things. A Hide button puts it away, and the page remembers that.

### Changes

- **Hide picture and video posts.** Its help now says what it needs and when it adds little. The box is greyed out, with the reason next to it, when spoiler pictures are off or in Casual, where it can't do anything. When "Pictures next to the name of the game" already covers those posts, its example and the panel say it adds little.
- **"(default)" labels.** Where Settings names the choice you start with, it now says "(default)" instead of "recommended", and only on that choice.

## 0.1.4

### Highlights

- Turn off on this page: one click in the popup, with Undo.
- Twitch and Kick live streams stay clear and keep their sound. Replays and clips are judged like any video.
- X: a spoiler written into a name or handle, even run together, is covered. Plain names stay.
- Facebook: comments under a covered post are covered with it.
- Discord: Klipy GIFs that give nothing away no longer stay covered.

### New

- **Turn off on this page.** The popup has a Turn off on this page button. It lets through only the page you are on, and an Undo button brings it back.

### Changes

- **Examples in Settings.** The examples now use a made-up game, so they give nothing away.

### Fixes

#### Facebook
- On a post's own page, in a group and in an opened post, the comments are covered along with a covered post, including comments that load later.

#### X
- A spoiler hidden in a display name or handle is covered, even when the words are run together with no spaces. A plain name with nothing about the game stays visible.

#### Discord
- A Klipy GIF that gives nothing away is shown once it has loaded, instead of staying covered. Videos and uploads next to it are still judged.

#### Google
- The Google logo is no longer covered.

#### Twitch/Kick
- A live player stays clear and is never muted or paused. On an offline channel, replays and clips are judged like any other video.

## 0.1.3

### Highlights

- Choose Pictures per site or per group, like Livestream sites or YouTube, from the right-click menu or the popup.
- Each cover says why it is there and which setting caused it, with a Change this link.
- Picture-only posts cover just the picture, and one press on a cover shows the whole post.
- Right-click a word or link and choose Never hide this.
- Fixes for Instagram, Reddit, Facebook, X, Gmail, Discord, Google and YouTube.

### New

- **Pictures per site.** Each site can have its own picture choice: Covered, Shown, or Same as everywhere. Settings also has groups of sites: Livestream sites (Twitch, Kick and YouTube live pages) and YouTube. A site's own choice beats its group's.
- **Pictures on this site** in the right-click menu, and the same control in the popup. The popup also says when a group decides for the site you are on.
- **Covers say why.** The label reads the reason, for example "Hidden: character spoiler". It never shows the word that matched. A small picture shows an eye button that tells the reason on hover.
- **Which setting did it.** When the cover came from a setting, the label adds a short tag, such as "· Strict", "· your own words" or "· this site's setting".
- **Change this.** Hover over or tab to a cover's label to see the reason and a Change this button. It opens Settings at the setting behind that kind of cover. It works with the keyboard, in full screen and inside dialogs.
- **Never hide this.** Right-click a word or a link to an account and choose Never hide this. The game's own name can't be added, so a post that names the game is still judged.
- **Reply GIFs and photos.** A GIF or photo posted as a reply with no words of its own can follow its own option, instead of being covered as a picture next to the game.
- **Official stores.** Official store pages, search results and link cards that point to them, and the publisher's own posts are let through. You can turn this off in Settings ("Let official stores and the publisher's site through").
- **What's new.** After an update, the popup shows a short note once, like this one.
- **Update notice.** The popup tells you when a newer version is out.
- **How to update.** If you installed from GitHub, the popup has How to update, with three steps and a link to the latest release. The Settings page says so too.
- **Examples in Settings.** Each choice that changes what gets covered shows a made-up example of what it does.

### Changes

- **Picture-only posts.** On Reddit, X and Facebook, a post that is only a picture now covers just the picture. The author, title and buttons stay visible. Comments and replies are still covered whole.
- **One press shows the whole post.** Pressing a cover now shows every cover in that post, not just the part you pressed.
- **Videos stay quiet.** A covered video is paused and muted until you show it, and its sound comes back when you do. A video player is covered as one piece, so no clicks get through.
- **Official trailers.** When you allow trailers, official trailers from the game's maker and the big outlets play, including in YouTube's up-next cards.
- **Press the label.** Pressing a cover's label shows it without opening the link underneath.
- **Dialogs and photo viewers.** A pop-up dialog is covered as one group, with its label inside it where you can reach it. One press shows everything in it.
- **Small spaces.** A cover too narrow for the full label shows the reason in a few words at its bottom. Smaller still, it shows the eye button.
- **Topics.** "Posts about leaks" and "Posts about trailers" now offer only Hide and Show.

### Fixes

#### Instagram
- A covered picture takes its own clicks and taps, so the post doesn't open or get liked underneath it.
- On a post's own page and in an opened post, the cover now sits on the post, not at the edge of the page.
- Comments inside an opened post are covered along with its picture, including pictures inside comments.
- A caption about the game now covers every slide of a multi-picture post. One press shows all the slides, including ones that load later.

#### Reddit
- On a post page, the comments stay covered while the post is covered, on both new and old Reddit.
- On link posts, only the link card's own picture passes the official-store check, never the words around it.

#### Facebook
- A picture-only post covers only its pictures, and the author row stays reachable.
- A comment and its replies are covered whole.
- Image-only replies (a GIF, sticker or photo) with nothing about the game are shown, following your reply options.
- Photo viewers get one label you can press, and one press shows the whole viewer.

#### X
- A picture-only post covers only the picture. The name and the action row stay visible.
- People's names and @handles on X aren't hidden just for sharing a character's name; spoilers written into a name still are.

#### Gmail
- An inbox row covers only its subject and preview. The checkbox, star, sender and date stay usable, and the row still opens.
- A name in the sender covers the whole row.
- Text that Gmail keeps hidden for screen readers no longer covers a row on its own. The text you see decides.

#### Discord
- Channel names in the sidebar are hidden only on a clear match, not just for a spoiler-type word.
- GIFs from Discord's GIF picker count as reaction GIFs and follow your reaction GIF setting.

#### Google
- Each related search is covered on its own.
- Search results that link to an official store are let through (Bing too).

#### YouTube
- After pressing Back from a video to the results, titles that no longer concern the game are shown again.
- An official trailer no longer flashes a cover for a moment as it loads.

#### Other sites
- On Twitch, a live channel's player is never covered; recorded videos and clips still are.
- Twitch, Kick and Discord chat: a line with a spoiler word right after a mention of the game in the visible chat is covered, even when the mention loads later.
- Wikis: a floated picture or a narrow table cell gets its label over it, not far away down the page.
- Bluesky: GIFs from Bluesky's GIF picker are recognised as reaction GIFs (if a GIF can't be confirmed, it stays covered), and search results whose buttons load late are read as posts.
