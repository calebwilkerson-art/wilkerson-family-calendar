# Wilkerson Calendar

A shared family schedule that runs as a plain web page. No login, no app store. Anyone with the link can add or change things and everyone sees it right away.

**Live site:** the GitHub Pages URL for this repository (Settings › Pages).

## How it works

- `index.html`, `app.js` – the whole app. One page, no build step, no framework.
- `config.js` – where the shared database lives (see below).
- `sw.js`, `manifest.webmanifest`, `icons/` – lets it install to an iPhone or Android Home Screen and keep working offline.

Data is stored in a free [Firebase Realtime Database](https://firebase.google.com/products/realtime-database), reached over its REST and streaming API. There is no server code to run. Until a database is connected the app runs in local mode and only saves on the device it is opened on.

## Go live (one-time, about five minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and **Add project** (any name, Analytics off).
2. Left menu: **Build › Realtime Database › Create database**. Choose the US region and **Start in locked mode**.
3. On the **Rules** tab, replace everything with:
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
   and click **Publish**. (The root stays locked; only calendars whose name you know are readable, and the name in the share link is a random 22-character string.)
4. On the **Data** tab, copy the database URL at the top (ends in `firebaseio.com` or `firebasedatabase.app`).
5. Either open the live site, tap the gear, paste the URL under **Sharing** and tap **Connect and go live** (the share link then carries the settings), **or** put the URL and a calendar name into `config.js` so the plain site URL is the share link:
   ```js
   window.FAMILY_CAL = { db: "https://your-project-default-rtdb.firebaseio.com", cal: "cal-xxxxxxxxxxxxxxxxxx" };
   ```

Whatever is on the first device that connects (including anything already added) becomes the shared starting point.

## iPhone

- **Home Screen:** open the link in Safari, tap Share, then **Add to Home Screen**. It opens full screen with its own icon.
- **Reminders:** Settings › Reminders pings 30 minutes before anything starts while the app is open (on iPhone it must be installed to the Home Screen first).
- **Alerts when the app is closed:** Settings › **Add everything to iPhone Calendar** downloads the schedule with 30-minute alerts into the built-in Calendar. Any single event can be added the same way from its edit screen.

## Directions

Give an event a place or an address and a **GO** button appears on it. It offers Apple Maps or Google Maps driving directions.
