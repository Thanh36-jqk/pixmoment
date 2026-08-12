import { nanoid } from "nanoid";

const STORAGE_KEY = "pixmoment_owner_id";

// A per-browser id, not a real account — enough to let someone list the
// albums they've created on this device without any login/email/password.
// Lost if they clear storage or switch browser/device; that tradeoff is
// the whole point of skipping real auth.
export function getOwnerId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = nanoid();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
