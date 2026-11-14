export function replayInterval(speed) {
  return 60000 / ([1, 5, 10, 50, 100].includes(speed) ? speed : 1);
}

export function analysisPeriod(data, through, group = 1) {
  const end = through == null ? data.minutes.length - 1 : through;
  const current = data.minutes[end];
  if (!current) return { minutes: [], incidents: [] };
  const bucket = Math.floor(current.minute / group);
  const minutes = group === 1 || through == null
    ? data.minutes.slice(0, end + 1)
    : data.minutes.slice(0, end + 1).filter(row => row.date === current.date && Math.floor(row.minute / group) === bucket);
  return { minutes, incidents: data.incidents.filter(event => event.time >= minutes[0].time && event.time <= current.time) };
}

export function replaySummary(data) {
  const minutes = data.minutes || [];
  const power = minutes.map(row => row.power).filter(Number.isFinite);
  const temperature = minutes.map(row => row.tempMax ?? row.temperature).filter(Number.isFinite);
  return {
    averagePower: power.length ? power.reduce((a, b) => a + b, 0) / power.length : null,
    peakTemperature: temperature.length ? Math.max(...temperature) : null,
    missing: minutes.reduce((sum, row) => sum + Math.max(0, 300 - row.recorded), 0),
    incidents: (data.incidents || []).length,
  };
}
