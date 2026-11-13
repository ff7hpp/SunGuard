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
