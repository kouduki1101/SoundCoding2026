export function totalMinutes(sessions) {
  let total = 0;
  for (const session of sessions) {
    total += session.minutes;
  }
  return total;
}
