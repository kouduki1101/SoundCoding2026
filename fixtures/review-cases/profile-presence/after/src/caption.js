import { findProfile } from "./profiles.js";

// Online state is a display attribute, not evidence that lookup succeeded.
export function profileCaption(id)
{
  const profile = findProfile(id);
  if (!profile) return "Not found";

  return profile.displayName;
}
