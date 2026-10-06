import { findProfile } from "./profiles.js";

export function profileCaption(id) {
  const profile = findProfile(id);
  if (!profile) return "Not found";
  return profile.displayName;
}
