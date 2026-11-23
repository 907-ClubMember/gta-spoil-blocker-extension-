# Changelog

## 0.1.16

### Highlights

- Covered text can no longer show its name in a hover tooltip on links and buttons inside comments and replies.

### Fixes

#### All sites
- Covered text can no longer show its name in a hover tooltip on links and buttons inside comments and replies.
- Reddit: a strong spoiler name in a user's name on a comment or post is now covered on its own (just the name).

## 0.1.15

### Highlights

- Text that's on screen but further down the page (sidebars, side panels, footers) is now covered within a fraction of a second.

### Fixes

#### All sites
- Text that's on screen but further down the page (sidebars, side panels, footers) is now covered within a fraction of a second.

## 0.1.14

### Highlights

- Settings changed in another tab now apply when you come back to a tab that was in the background.
- Google: fewer search results covered just because another row nearby names the game.
- Big feeds with thousands of posts no longer freeze for about a second after loading.

### Fixes

#### All sites
- Settings changed in another tab now apply when you come back to a tab that was in the background or that you return to with Back.
- Big feeds with thousands of posts no longer freeze for about a second at 3 and 10 seconds after loading.

#### Google
- Fewer search results are covered just because another row nearby names the game.
- In Remove mode, the "removed N here" line now shows; tabs and side panels no longer hide it.

#### Settings
- A page-part switch (such as comments) that a site does not offer no longer does anything on that site.
- The help for hiding replies names the six sites where each reply is checked on its own: X, Reddit, Bluesky, Steam Community, Instagram and Facebook.
- The Total blackout help mentions the thin line Remove mode leaves where a whole area is emptied.

## 0.1.13

### Highlights

- Pictures and posts opened inside pop-up viewers (e.g. Instagram) are covered faster on busy pages.

### Fixes

#### All sites
- Pictures and posts opened inside pop-up viewers (e.g. Instagram) are covered faster on busy pages.

## 0.1.12

### Highlights

- All sites: content added late to busy pages sometimes showed briefly before being covered; pop-up post viewers (e.g. Instagram) are checked first.

### Fixes

#### All sites
- Fixes content added late to busy pages sometimes showing briefly before being covered; pop-up post viewers (e.g. Instagram) are checked first.

## 0.1.11

### Highlights

- Instagram: the tiles of a search grid keep their labels, and a post you showed stays shown when you open it.
- Instagram: a lone comment under a post is covered on its own, not with the post.
- Remove mode: a thin line marks each area it emptied, with a Show button for this visit.
- Google: a match in a knowledge panel's own header or description covers the whole panel with one label; a match inside one result covers that result.

### Changes

- **Remove mode area line.** With Remove chosen in Settings, where every post in a grid, feed or list is removed, one thin line now sits in its place: "Spoiler Blocker removed N items here · Show". Show brings them back for this visit only; a reload removes them again. One removed post among others gets no line, and blur and Shrink are unchanged. The setting's help text says so. The line keeps up on feeds with hundreds of posts (400 posts in under a second).
- **Google knowledge panels with several results.** When the big panel holds two or more results, a match in the panel's own header or description covers the whole panel with one label; a match inside one result covers that result. The panel is judged on its own words.

### Fixes

#### Instagram
- The tiles of a search grid were all blurred with no labels; each tile now shows its label.
- A post you showed from the grid stays shown when its post window opens, also when the window opens before the address changes.
- A single comment under a post is judged on its own and gets its own cover; showing the post no longer shows it.

#### All sites
- A label no longer spills out of a small inline link or tab, or shows on one that is hidden.

## 0.1.10

### Highlights

- Settings: Back up and restore. Save your settings to a file and load them back, and a copy installed from GitHub now keeps its settings when you update it.
- YouTube: the "Up next" card at the end of a video is covered when the next video is hidden, and autoplay to a hidden video is covered and paused.
- YouTube: the hover preview no longer plays over a hidden search or home result.
- Steam, Instagram and Facebook: each comment is judged on its own words, with its own cover and label.
- Reddit Chats: each message is covered on its own, not the whole window.
- Pictures you showed in a post stay shown when you open them in the site's full-screen viewer.

### Changes

- **Back up and restore.** Settings has a new Back up and restore section. "Back up settings" saves your choices and lists to a file, never the spoiler list. "Restore from file" checks the file, says how many settings it changes, and applies them only on a second press. A file that is not a settings file is refused with nothing changed. A restore never takes a pause from the file, and the confirm line says so when a file would turn hiding off.
- **GitHub copies keep their settings.** The zip on GitHub now has a fixed extension ID, so a folder you load unpacked keeps its settings across versions. The Chrome Web Store build is unchanged. How to update has a new line: replace the files in the same folder and press Reload, or back up your settings first.
- **Comments on Steam, Instagram and Facebook.** Under a hidden post on a Steam Community thread or an opened Instagram or Facebook post, comments are no longer hidden with it. Each is judged on its own words and gets its own cover and label, and a press on a comment's label shows only that comment.
- **YouTube "Up next".** The card at the end of a video is judged on its own title and channel. Its cover takes the thumbnail, title and channel, so Cancel and Play still work.
- **YouTube autoplay.** When autoplay moves to a hidden video, that video is covered and paused, even if you had shown the video before it, and even when YouTube changes the video without a page change.
- **Twitch channel pages.** Only the player is covered, never the channel's name row, buttons or about panels. A live channel is told apart from a past broadcast, so a live player is not covered for its length, and a cover is lifted (with its sound) when the channel turns out to be live.
- **Reddit Chats.** In new Reddit's Chats window each message is covered on its own, with its own label. The room header, the typing line and the message box are never read, and a sender's name is not a hit by itself.
- **Pictures near the game's name.** A picture covered for sitting next to the game's name now also makes the replies under it count as replies to a post about the game.
- **Google.** "People also ask" rows, video rows, post cards and topic rows are each covered on their own again; a picture next to the game inside one covers that row.

### Fixes

#### YouTube
- Ads are judged on their own words, never on what the page is about.

#### Reddit
- A new Reddit video that stayed blurred after you pressed show is released, also when you open the post.

#### All sites
- "spoiler blocker" and "spoiler filter" are no longer spoiler words by themselves.
- Pictures you showed in the feed stay shown in the site's full-screen viewer, and a full-screen picture's label sits in its middle, not over the viewer's menu.
- No more "Unchecked runtime.lastError ... back/forward cache" entry on Chrome's extension errors page after going back and forward.

## 0.1.9

### Highlights

- New Reddit and X: a hidden post keeps its author row and its action buttons in view; only its words and pictures are covered.
- New Reddit and Bluesky: each reply under a hidden post is judged on its own words, with its own cover and label.
- On new Reddit, "Hide picture and video posts" now covers only the post's picture, not its comments.
- People's display names are never matched on Reddit, Twitch, Discord, YouTube and Steam, as on X.
- Search results from official stores and the publisher show again on Google, Bing and DuckDuckGo, and YouTube videos from the publisher's, PlayStation's and Xbox's channels count as official.

### Changes

- **Reddit and X posts.** A post on new Reddit or X hidden for its words keeps its author row and its action buttons (vote, reply, share) in view; only its words, pictures and any quoted post are covered. If those rows themselves name something on the list, the whole post is covered as before.
- **Replies.** On new Reddit and Bluesky, replies under a hidden post are no longer hidden with it. Each is judged on its own words and gets its own cover and label. A weak name or a strong spoiler phrase in a reply still covers it.
- **Picture and video posts.** On new Reddit, "Hide picture and video posts" covers only the post's picture. Its comments are judged on their own words, as with the switch off.
- **Display names.** A person's display name or handle is never matched against the list on Reddit, Twitch, Discord, YouTube and Steam, as it already was on X. A comment or chat line is judged only on its words. This also means a listed name used alone as a username is no longer covered; a name written as a spoiler still is.
- **YouTube official channels.** Videos from the publisher's, PlayStation's and Xbox's channels get the same pass as other official content: their thumbnail and title show, unless a spoiler word covers them. The channel is checked by its handle or id, never by the name shown.

### Fixes

#### Search engines
- "Let official stores and the publisher's site through" works again on Google, Bing and DuckDuckGo, including a result's extra links and redirect links. Only the engine's own "more results from this site" search is ignored; any other engine link in a result still keeps it covered.

#### Reddit
- Profile pictures and community icons are no longer covered just for being near a post about GTA 6.
- Ads are judged on their own words, never on what the page is about.

#### Google
- On a big topic page that holds the search results, each result is covered on its own, not all of them.

#### All sites
- A short article or list that wraps several posts covers only the post that matches, not all of them.
- A match in a menu, tab bar, toolbar or button is covered at the smallest piece, and a reply box keeps its text field and Send button.
- A match in a tab or menu entry is covered as the whole entry, not as a tiny link inside it.
- Site rules apply only to a site's main app, so a long article on a site's blog or help pages is no longer covered as one post.

## 0.1.8

### Highlights

- Settings: switching from Total blackout to Careful or Casual now really goes back to that preset's GIF and picture choices.
- The Blackout card now says that Blackout covers no words while "Cover pictures only, never words" is on.
- Site settings no longer offer a comments switch on sites where it does nothing: X, Facebook, Instagram, Bluesky, Threads, Twitch, Kick and Discord.
- Replies under a post or comment hidden only for a blocked account or one of your own words are no longer hidden as replies to a post about GTA 6.
- After you show a hidden post, replies that load later are judged on their own words.

### Changes

- **Presets.** Casual and Careful now set the GIF and reply picture choices too, so switching to them from Total blackout leaves nothing of Total blackout behind. Changing any of these choices by hand makes the preset Custom.
- **Blackout.** The card says that Blackout covers no words while "Cover pictures only, never words" is on.
- **Site settings.** The comments switch is left out of the cards for X, Facebook, Instagram, Bluesky, Threads, Twitch, Kick and Discord, where it does nothing. Reddit, YouTube, Steam and other sites keep it, and group cards keep every switch. Saved values load unchanged.

### Fixes

#### Reddit and X
- Replies under a post or comment hidden only for a blocked account or one of your own words are no longer hidden as replies to a post about GTA 6. If the hidden post's words name the game, its replies are still treated as replies to it.
- After you show a hidden post, replies that load later are judged on their own words.

## 0.1.7

### Highlights

- Reaction and reply GIFs are judged by their label again by default, and GIFs about GTA 6 stay covered. "Cover them" in Settings still covers all GIFs.
- Blackout is simpler: it hides everything that mentions GTA 6, starting on release day, at midnight your time, or at a time you pick. Pages marked safe in My lists are left alone.
- Old Reddit: comments are checked one by one, and the subreddit banner and the reply box are never covered.
- Discord: in a channel marked as a game place only by its category, topic or server name, chat lines with spoiler words are now covered.
- Revealing a covered post opens its own page, not another link in it.

### Changes

- **GIFs.** Reaction GIFs default to "Judge them by their label" again; GIFs about GTA 6 stay covered. Installs from 0.1.6 that are still on its GIF defaults move to the new default once. A reply GIF from a GIF library follows its label too, including new Reddit's Giphy replies. "Cover them" still covers all GIFs.
- **Settings examples.** The examples now use GTA 6, with made-up posts.
- **Blackout.** The card is rewritten: "Blackout: hide everything that mentions GTA 6", with a Start choice (release day, midnight your time, or a time you pick). Pages marked safe in My lists are left alone. The popup and Current settings say "Blackout is ON, until you turn it off".

### Fixes

#### Old Reddit
- Comments are checked one by one. The subreddit banner and the reply box are never covered, and a game subreddit's whole content column is no longer covered as one block.

#### Old Reddit and other forums
- Posts about a subreddit's spoiler rules are no longer hidden just for using the word "spoiler".

#### X
- Picture replies under a covered post stay covered.

#### Discord
- In a channel marked as a game place only by its category, topic or server name, chat lines with spoiler words are now covered.
- In a game channel, store-style link previews no longer skip the picture cover (a bot could fake them).
- A chat message edited to a different text of the same length is checked again.

#### All sites
- Revealing a covered post opens its own page, not another link in it.
- "This page only" entries saved before 0.1.6 apply again on web apps that change the part after # in the address.

## 0.1.6

### Highlights

- Chats on Discord, Twitch, Kick and YouTube check each message on its own, and a mention no longer hides the messages after it.
- New popup buttons: turn off on all of a site, or on this page only. Turning off or on works at once, with no refresh.
- YouTube: when autoplay moves on to a covered video, it stays covered and paused until you press its label. Its poster and end screen are covered too.
- Reaction and reply GIFs are now covered like other pictures. You can show them again in Settings, Pictures.
- Search results that link only to the publisher's site or the big game stores are shown, unless the summary has a spoiler word.

### New

- **Chat, message by message.** On Discord, Twitch, Kick and YouTube live chat, each message is checked strictly on its own words, and a mention of the game no longer hides the messages after it. In a chat about the game (a game Discord server or channel, or a stream or video about the game), messages about deaths, betrayals, twists or the ending are hidden even when they name no one. Every hidden chat message has its own label in its row. The popup and the Current settings panel say so on chat sites.
- **Clear my lists.** A new Settings button that empties your own lists. Reset to defaults now keeps your lists and only puts your choices back. Both ask for a second press and say when they are done.

### Changes

- **Popup buttons.** "Turn off on all of <site>" and "Turn off on this page only", with the page's address shown under them. On web apps that keep their view in the address, each view is remembered on its own.
- **Turning off or on is instant.** Covers and labels go away, and come back, at once with no refresh. Sound and play we took from a video are given back; a video you muted or paused yourself stays as you left it.
- **Showing a video brings its sound back.** Pressing the label on a covered video now gives its sound back, on every site (for example Reddit video posts).
- **GIFs.** Reaction GIFs and GIFs posted as replies are now covered like other pictures by default: on pages about the game and next to posts that mention it. This also applies if you never changed these settings. To show them again, pick "Judge them by their label" and "Show them" in Settings, Pictures.
- **Search results.** On Google, Bing and DuckDuckGo, results that link only to the publisher's site or the PlayStation, Xbox, Steam or Epic stores are shown unless the summary contains a spoiler word. Reviews, forums, community and curator pages stay covered.
- **"Pictures next to the name of the game."** It now says where each choice applies (only on pages about the game, or also in mixed feeds like your Reddit or YouTube home), with an example, a line on each preset and a note in Current settings.

### Fixes

#### YouTube
- When autoplay moves on to a covered game video, it stays covered and paused until you press its label. Pressing YouTube's big play button over a covered video shows and plays it.
- The poster, the end screen and the progress-bar preview are covered with the video.

#### Discord
- Link previews are judged like the site they come from. In a server, channel or category about the game, preview pictures and uploads are covered by default; official store and publisher previews stay visible.
- Long previews and forwarded messages are read to the end.

#### Reddit
- On old and new Reddit, the home, all and popular feeds are judged post by post.
- A covered picture can't be opened by clicking it or pressing Enter.

#### Twitch/Kick
- Search results and category pages are judged card by card, with one bar per card; box art is never covered. Hover previews are covered too.

#### Bluesky
- A post's own page no longer shows what it should hide, and a post you showed stays shown.

#### X
- A covered post no longer hides its whole conversation without a label: each reply is judged on its own words. While the main post is covered, replies are read as if the page were about the game (a weak name counts, and so does a strong spoiler phrase), and every cover has its own label.

#### Google
- Search suggestions that split a name between what you typed and what Google added are covered.

#### Settings
- The second press of Reset to defaults and Clear my lists now reliably completes, even if the page is redrawn between presses.

#### Other
- Another extension can no longer lift a cover by setting a blur-removing style on the covered element.

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
