# Middle-earth: The War of the Realms

A fan-made, non-commercial conquest board game for the browser, set on a map inspired by Tolkien's Middle-earth.
Classic rules: reinforce, attack with dice, fortify, trade territory cards. Two to five realms, AI opponents,
secret missions, a quick mode, hot-seat play and online rooms.

**Play:** https://josephc96.github.io/Risk-Lotr/

## Online play

One player hosts: *Host an online game* opens a room and gives a link to share. Friends open the link, enter a
name and take an open realm. Browsers connect directly to each other (WebRTC), so the host must keep the tab open.
The game is saved on the host's device; *Reopen online room* in the main menu continues it another day.

## Working on it

- `index.html`, `js/`, `css/`, `assets/` are the source.
- `python build.py` regenerates `play.html` (local play) and `docs/` (the GitHub Pages site).
- Serve the folder over HTTP to play locally, e.g. `python -m http.server 8765`, then open `play.html`.

This is a personal fan project. It is not affiliated with or endorsed by the Tolkien Estate, Middle-earth
Enterprises or any game publisher.
