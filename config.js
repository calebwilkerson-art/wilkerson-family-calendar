/* Family calendar settings.
 *
 * db  - Firebase Realtime Database URL. With this set, every phone with the
 *       link shares one live calendar. Blank means local mode: the calendar
 *       still works, but it only saves on the device it is opened on.
 * cal - the calendar's name inside that database. Keep it hard to guess.
 * vapidPublic - public half of the Web Push key pair. The private half lives
 *       in this repository's Actions secrets and never reaches the browser.
 */
window.FAMILY_CAL = {
  db: "",
  cal: "wilkerson-main",
  vapidPublic: "BJqQyofB2mpfatjm49Usjxmhz50Dz8yDBqV6SJZEHVMWaLap5y9eWoyoYmUd0207Pu_u3UpZpi8AfguHevQNRmE"
};
