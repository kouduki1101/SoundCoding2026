import { totalMinutes } from "./totals.js";

export function makeReport(sessions) {
  return { minutes: totalMinutes(sessions), count: sessions.length };
}
