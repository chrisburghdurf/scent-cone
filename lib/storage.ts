import { HandlerProfile, K9Profile, SavedTrack, SessionRecord } from "@/lib/types";

const K9_KEY = "sar-k9-profiles-v1";
const HANDLER_KEY = "sar-handler-profiles-v1";
const SESSION_KEY = "sar-training-sessions-v1";
const LAID_TRACK_LIBRARY_KEY = "sar-laid-track-library-v1";

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadK9Profiles(): K9Profile[] {
  if (typeof window === "undefined") return [];
  return parse<K9Profile[]>(window.localStorage.getItem(K9_KEY), []);
}

export function saveK9Profiles(items: K9Profile[]) {
  window.localStorage.setItem(K9_KEY, JSON.stringify(items));
}

export function loadHandlerProfiles(): HandlerProfile[] {
  if (typeof window === "undefined") return [];
  return parse<HandlerProfile[]>(window.localStorage.getItem(HANDLER_KEY), []);
}

export function saveHandlerProfiles(items: HandlerProfile[]) {
  window.localStorage.setItem(HANDLER_KEY, JSON.stringify(items));
}

export function loadSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  return parse<SessionRecord[]>(window.localStorage.getItem(SESSION_KEY), []);
}

export function saveSessions(items: SessionRecord[]) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(items));
}

export function loadLaidTrackLibrary(): SavedTrack[] {
  if (typeof window === "undefined") return [];
  return parse<SavedTrack[]>(window.localStorage.getItem(LAID_TRACK_LIBRARY_KEY), []);
}

export function saveLaidTrackLibrary(items: SavedTrack[]) {
  window.localStorage.setItem(LAID_TRACK_LIBRARY_KEY, JSON.stringify(items));
}
