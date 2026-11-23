/** Device storage key of a coach's unsaved attendance draft (per user and session). */
export function draftStorageKey(userId: string, eventId: string): string {
  return `club-os.attendance-draft.v1:${userId}:${eventId}`;
}
