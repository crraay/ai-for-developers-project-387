/** Calendar helpers shared by the browser specs (no test definitions here). */

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function weekdayInTimeZone(dateString: string, timeZone: string): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(`${dateString}T12:00:00`));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[value];
}

export function isWeekday(dateString: string): boolean {
  // The string is already a host-local calendar date; weekday is pure calendar
  // arithmetic, so no timezone conversion is involved.
  const [year, month, day] = dateString.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

/** Pure calendar arithmetic on a yyyy-mm-dd string (no timezones involved). */
export function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

export function lastWeekdayOnOrBefore(dateString: string): string {
  for (let offset = 0; offset < 7; offset++) {
    const candidate = addDaysToDateString(dateString, -offset);
    if (isWeekday(candidate)) {
      return candidate;
    }
  }
  /* c8 ignore next -- a 7-day look-back always finds a weekday */
  throw new Error(`no weekday on or before ${dateString}`);
}

export function firstWeekdayAfter(dateString: string): string {
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addDaysToDateString(dateString, offset);
    if (isWeekday(candidate)) {
      return candidate;
    }
  }
  /* c8 ignore next -- a 7-day look-ahead always finds a weekday */
  throw new Error(`no weekday after ${dateString}`);
}

/**
 * Returns a future Saturday at least `minDays` out and inside the 14-day window,
 * formatted as yyyy-mm-dd in the given IANA timezone. Weekday is pure calendar
 * arithmetic on the date string, so no timezone conversion is involved.
 */
export function futureSaturdayDate(timeZone: string, minDays = 2): string {
  const today = formatDateInTimeZone(new Date(), timeZone);
  for (let offset = minDays; offset <= 13; offset++) {
    const candidate = addDaysToDateString(today, offset);
    const [year, month, day] = candidate.split('-').map(Number);
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6) {
      return candidate;
    }
  }
  /* c8 ignore next -- a 12-day span always contains a Saturday */
  throw new Error(`no Saturday inside the booking window after ${today}`);
}

/**
 * Returns a future weekday (Mon-Fri) at least `minDays` out, formatted as
 * yyyy-mm-dd in the given IANA timezone. The booking window is 14 calendar days
 * including today, so staying well inside it keeps the slot bookable.
 */
export function futureWeekdayDate(timeZone: string, minDays = 2): string {
  let candidate = addDays(new Date(), minDays);
  while (true) {
    const formatted = formatDateInTimeZone(candidate, timeZone);
    const day = weekdayInTimeZone(formatted, timeZone);
    if (day !== 0 && day !== 6) {
      return formatted;
    }
    candidate = addDays(candidate, 1);
  }
}
