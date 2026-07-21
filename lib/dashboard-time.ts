export function safeTimeZone(value?: string | null) {
  const candidate = String(value || '').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  };
}

function offsetAt(date: Date, timeZone: string) {
  const parts = partsInZone(date, timeZone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - date.getTime();
}

export function zonedDateTimeToUtc(
  parts: Pick<ZonedParts, 'year' | 'month' | 'day'> & Partial<Pick<ZonedParts, 'hour' | 'minute' | 'second'>>,
  timeZoneInput: string
) {
  const timeZone = safeTimeZone(timeZoneInput);
  const initial = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
  let result = new Date(initial - offsetAt(new Date(initial), timeZone));
  // Re-check once for DST boundaries where the first approximation uses the adjacent offset.
  result = new Date(initial - offsetAt(result, timeZone));
  return result;
}

export function startOfDayInZone(date: Date, timeZoneInput: string) {
  const timeZone = safeTimeZone(timeZoneInput);
  const parts = partsInZone(date, timeZone);
  return zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day }, timeZone);
}

export function addCalendarDaysInZone(date: Date, days: number, timeZoneInput: string) {
  const timeZone = safeTimeZone(timeZoneInput);
  const parts = partsInZone(date, timeZone);
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return zonedDateTimeToUtc(
    {
      year: calendar.getUTCFullYear(),
      month: calendar.getUTCMonth() + 1,
      day: calendar.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second
    },
    timeZone
  );
}

export function addDayBoundaryInZone(dayStart: Date, days: number, timeZoneInput: string) {
  const timeZone = safeTimeZone(timeZoneInput);
  const parts = partsInZone(dayStart, timeZone);
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return zonedDateTimeToUtc(
    { year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate() },
    timeZone
  );
}

export function formatInZone(dateValue: string | Date | null | undefined, timeZoneInput: string) {
  if (!dateValue) return '—';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZoneInput),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}
