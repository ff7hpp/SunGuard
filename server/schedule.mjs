const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export function collectionWindow(now = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const active = minute >= 540 && minute <= 1050;
  return {
    timezone: "Europe/Istanbul", active, minute,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    sampleTime: new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString()
  };
}

export function historyDates(now) {
  const today = Date.parse(collectionWindow(now).localDate + "T00:00:00Z");
  return Array.from({ length: 7 }, (_, i) =>
    new Date(today - (6 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function openingTime(date) {
  const wallTime = Date.parse(date + "T09:00:00Z");
  const local = collectionWindow(new Date(wallTime));
  const localTime = Date.parse(local.localDate + "T00:00:00Z") + local.minute * 60_000;
  return wallTime - (localTime - wallTime);
}
