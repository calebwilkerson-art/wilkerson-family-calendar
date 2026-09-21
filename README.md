# Wilkerson Calendar

The family schedule as a plain web page. No login, no app store, no accounts. Anyone with the link can add or change things and everyone else sees it straight away.

**Live:** https://calebwilkerson-art.github.io/wilkerson-family-calendar/

## What's in here

| File | What it does |
| --- | --- |
| `index.html`, `app.js` | The whole app. One page, no build step, no framework. |
| `config.js` | Where the shared database lives, and the public push key. |
| `hero.webp` | The family photo at the top. Ships with the site, so it is there for everyone the moment they open the link. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home Screen install, offline support, and push delivery. |
| `push/send.js` | Sends reminders on a schedule, outside the browser. |
| `tools/make_icons.py` | Rebuilds the app icons. |

Events live in a free [Firebase Realtime Database](https://firebase.google.com/products/realtime-database), reached over its REST and streaming API. There is no server to run. Every change is written with the moment it was made, so a change made on a phone that was offline is only ever dropped if someone else has since changed that same event; nothing else is lost.

## Going live

Until `config.js` has a database URL the calendar still works, but it saves only on the device it is opened on.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and **Add project** (any name, Analytics off).
2. **Build › Realtime Database › Create database**. US region, **Start in locked mode**.
3. On the **Rules** tab, replace everything with this and Publish:
   ```json
   {
     "rules": {
       "$calendar": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```
   The root stays locked. Only a calendar whose exact name you know can be read.
4. On the **Data** tab copy the database URL (ends in `firebaseio.com` or `firebasedatabase.app`) and put it in `config.js`:
   ```js
   window.FAMILY_CAL = { db: "https://your-project-default-rtdb.firebaseio.com", cal: "wilkerson-main", vapidPublic: "…" };
   ```

Whatever is on the first device to connect becomes the shared starting point. Settings › Sharing inside the app can also do this without editing the file, in which case the settings ride along in the share link instead.

## Reminders

Three layers, strongest last.

- **While the app is open**: a check every minute, 30 minutes ahead.
- **iCal**: Settings › *Add everything to iCal* drops the schedule into the iPhone or Mac Calendar with 30-minute alerts. Works forever, with nothing running.
- **Push**: `push/send.js` runs every ten minutes in GitHub Actions. It reads the calendar, works out what is about to start, and pushes to every device that has turned reminders on, whether or not anyone has the app open. It also sends a rundown of the day at 7am. Dead devices are dropped automatically.

Push needs two things in place: a database (above), and the `VAPID_PRIVATE` repository secret, which is already set. Its public half sits in `config.js`; the private half never reaches a browser.

On iPhone, web push only works once the app is on the Home Screen: open the link in Safari, Share, **Add to Home Screen**, then turn Reminders on in Settings.

GitHub switches scheduled workflows off after 60 days of repository inactivity, so `keepalive.yml` makes one commit a month to keep the reminders running.

## Directions

Give an event a place or an address and a **GO** button appears on it, offering Apple Maps or Google Maps driving directions.
