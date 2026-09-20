/* Family calendar settings.
 *
 * Leave `db` blank to run in local mode (saves on each device only).
 * To make the calendar live for everyone with the link, set `db` to your
 * Firebase Realtime Database URL, for example:
 *   db: "https://wilkerson-calendar-default-rtdb.firebaseio.com"
 * `cal` is the calendar's name inside that database. Keep it hard to guess.
 * These can also be set from inside the app (Settings > Sharing), which
 * embeds them in the share link instead.
 */
window.FAMILY_CAL = {
  db: "",
  cal: ""
};
