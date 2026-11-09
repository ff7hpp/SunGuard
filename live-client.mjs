export const metricCatalog = [
  { id: "power", label: "Power output", unit: "kW", level: "Farm" },
  { id: "temperature", label: "Panel temperature", unit: "°C", level: "Panel / farm" },
  { id: "voltage", label: "DC voltage", unit: "V", level: "Panel" },
  { id: "current", label: "DC current", unit: "A", level: "Panel" },
  { id: "efficiency", label: "Efficiency", unit: "%", level: "Panel / zone" },
  { id: "irradiance", label: "Irradiance", unit: "W/m²", level: "Site" },
  { id: "frequency", label: "AC frequency", unit: "Hz", level: "Inverter / site" },
  { id: "availability", label: "Availability", unit: "%", level: "Farm" },
  { id: "alerts", label: "Anomaly risk", unit: "alerts", level: "Analytics" },
];

export function selectedMetrics(candidate) {
  const available = new Set(metricCatalog.map(metric => metric.id));
  const selected = Array.isArray(candidate) ? candidate.filter(id => available.has(id)) : [];
  return selected.length ? [...new Set(selected)] : ["power", "temperature", "alerts"];
}

export function lifecycleProgress(lifecycle) {
  const total = Number(lifecycle?.total) || 15;
  const current = Math.max(0, Math.min(Number(lifecycle?.step) || 0, total));
  return { current, total, percent: Math.round(current / total * 100) };
}
