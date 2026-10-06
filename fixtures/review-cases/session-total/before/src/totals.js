export function totalMinutes(sessions) {
  return sessions.reduce((total, session) => total + session.minutes, 0);
}
