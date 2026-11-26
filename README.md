# Let It Snow ❄️

A tiny desktop app for Windows and macOS that makes snow fall gently over your screen
and shows a snow globe counting down to Christmas.

![preview](docs/preview.png)

## What it does

- **Snow over everything.** A transparent, always-on-top layer on every monitor. Clicks go
  straight through it, so you can keep working.
- **Snow piles up** on top of your taskbar (Windows) or dock (Mac), and melts very slowly.
- **Snowflake icon** in the system tray / menu bar:
  - Let it snow (on/off)
  - How much snow: Light flurries, Gentle snow, Heavy snow, Blizzard
  - Pile up on the taskbar / dock
  - Show Christmas countdown, Reset countdown position
  - Start when I log in
- **Snow globe countdown.** Shows days, hours and minutes until Christmas. Click it to shake
  the globe, drag it to move it, hover and press × to hide it.

Settings are saved between launches.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Look for the snowflake in your tray (Windows, bottom right, maybe under the ^ arrow)
or menu bar (Mac, top right). There is no window or dock icon on purpose.

## Build installers

```bash
npm run dist:win   # on Windows -> dist/Let It Snow Setup.exe and a portable .exe
npm run dist:mac   # on a Mac    -> dist/Let It Snow.dmg (Intel + Apple Silicon)
```

The builds are **unsigned** for now. Windows will show a SmartScreen warning ("More info" →
"Run anyway") and macOS needs right-click → Open the first time. To sell it, add code
signing: an Apple Developer ID ($99/year, plus notarization) and a Windows code signing
certificate.

## Project layout

```
src/main.js      tray menu, overlay windows (one per monitor), widget window, settings
src/overlay.*    the falling snow + pile-up (canvas)
src/widget.*     the snow globe countdown (canvas)
src/preload.js   small safe bridge between the windows and main
assets/          app + tray icons
```

## Ideas for next versions

- Snow settling on the top edges of open windows (needs native window positions per OS)
- Sweep the pile away with the mouse
- Themes: New Year fireworks, falling leaves, cherry blossoms
- Custom countdown dates (birthdays, holidays, launches)
