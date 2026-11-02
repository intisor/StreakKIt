// domain/time-window.ts: IANA timezone math, grace periods, ISO weekdays, and expiry calculation

/**
 * Parses YYYY-MM-DD into [year, month, day] numbers.
 */
export function parseDateString(dateStr: string): [number, number, number] {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid date string: ${dateStr}. Expected YYYY-MM-DD`);
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return [year, month, day];
}

/**
 * Formats [year, month, day] to YYYY-MM-DD
 */
export function formatDateString(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Given occurredAtUtc, ianaTimezone (e.g., 'Africa/Lagos'), and gracePeriodMinutes:
 * Subtracts gracePeriodMinutes from occurredAtUtc, then formats into YYYY-MM-DD in ianaTimezone.
 * Example: 01:30 AM on Tuesday with 120m grace becomes 11:30 PM Monday -> yields Monday's date.
 */
export function computeLogicalDate(
  occurredAtUtc: Date,
  ianaTimezone: string = 'UTC',
  gracePeriodMinutes: number = 0
): string {
  const shiftedUtc = new Date(occurredAtUtc.getTime() - gracePeriodMinutes * 60 * 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(shiftedUtc);
}

/**
 * Returns ISO weekday number for a YYYY-MM-DD date:
 * Monday = 1, Tuesday = 2, Wednesday = 3, Thursday = 4, Friday = 5, Saturday = 6, Sunday = 7
 */
export function getIsoWeekday(dateStr: string): number {
  const [year, month, day] = parseDateString(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

/**
 * Checks if a date is exempt according to the bitmask:
 * Mon=1 (1<<0), Tue=2 (1<<1), Wed=4 (1<<2), Thu=8 (1<<3), Fri=16 (1<<4), Sat=32 (1<<5), Sun=64 (1<<6)
 */
export function isExemptDay(dateStr: string, exemptDaysBitmask: number): boolean {
  if (exemptDaysBitmask <= 0) return false;
  const isoWeekday = getIsoWeekday(dateStr);
  const bit = 1 << (isoWeekday - 1);
  return (exemptDaysBitmask & bit) !== 0;
}

/**
 * Adds an integer number of days to a YYYY-MM-DD date string.
 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = parseDateString(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Returns the number of calendar days between two dates: toDate - fromDate.
 */
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  const [y1, m1, d1] = parseDateString(fromDateStr);
  const [y2, m2, d2] = parseDateString(toDateStr);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000));
}

/**
 * Lists all dates strictly between startDateExclusive and endDateExclusive.
 * If endDate <= startDate + 1, returns empty array.
 */
export function listDatesBetween(startDateExclusive: string, endDateExclusive: string): string[] {
  const dates: string[] = [];
  let current = addDays(startDateExclusive, 1);
  while (daysBetween(current, endDateExclusive) > 0) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

/**
 * Converts a calendar date at 23:59:59.999 in a given IANA timezone into exact UTC Date.
 */
export function localEndOfDayToUtc(dateStr: string, ianaTimezone: string): Date {
  const [year, month, day] = parseDateString(dateStr);
  // Initial estimate assuming target is UTC
  const targetUtcGuess = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  // Determine the timezone offset at that time
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(targetUtcGuess);
  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  let h = parseInt(p.hour, 10);
  if (h === 24) h = 0;

  const localGuess = new Date(
    Date.UTC(
      parseInt(p.year, 10),
      parseInt(p.month, 10) - 1,
      parseInt(p.day, 10),
      h,
      parseInt(p.minute, 10),
      parseInt(p.second, 10),
      999
    )
  );

  const offsetMs = localGuess.getTime() - targetUtcGuess.getTime();
  return new Date(targetUtcGuess.getTime() - offsetMs);
}

/**
 * Computes the exact UTC timestamp when the streak window will expire.
 * Starting from fromLogicalDate + 1 day, finds the next calendar date D_next that is NOT exempt.
 * The deadline is D_next at 23:59:59.999 in user's timezone + gracePeriodMinutes.
 */
export function computeNextWindowExpiry(
  fromLogicalDate: string,
  ianaTimezone: string,
  exemptDaysBitmask: number,
  gracePeriodMinutes: number
): Date {
  let nextDate = addDays(fromLogicalDate, 1);
  while (isExemptDay(nextDate, exemptDaysBitmask)) {
    nextDate = addDays(nextDate, 1);
  }

  const endOfDayUtc = localEndOfDayToUtc(nextDate, ianaTimezone);
  return new Date(endOfDayUtc.getTime() + gracePeriodMinutes * 60 * 1000);
}
