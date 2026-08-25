export function computeDeletionDate(addedAt: string | undefined, actionAfterDays: number | undefined): string | undefined {
  if (!addedAt || actionAfterDays === undefined || !Number.isFinite(actionAfterDays)) return undefined;
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + actionAfterDays);
  return date.toISOString();
}

export function daysUntil(isoDate: string | undefined, now = new Date()): number | undefined {
  if (!isoDate) return undefined;
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return undefined;
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((targetDay - nowDay) / 86_400_000);
}
