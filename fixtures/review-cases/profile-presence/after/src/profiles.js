export function findProfile(id) {
  if (id === "local") {
    return { displayName: "Local profile", online: false };
  }
  if (id === "guest") {
    return { displayName: "Guest profile", online: true };
  }
  return null;
}
