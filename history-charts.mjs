import { metricCatalog } from "./live-client.mjs";
import { PANEL_COUNT } from "./grid.js";

const number = value => Number.isFinite(value) ? value.toFixed(1) : "—";
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const operatingMinutes = 511;
const slot = row => (row.dayIndex ?? 0) * operatingMinutes + row.minute - 540;
const minuteLabel = row => `${row.date ? row.date.slice(5) + " · " : ""}${clock(row.minute)}`;
const canvas = (label, marks) => `<svg class="history-plot" viewBox="0 0 400 130" role="img" aria-label="${label}"><path class="history-axis" d="M36 8V108H392"/>${marks}</svg>`;
const dot = (x, y, title, radius = 2.4) => `<circle cx="${x}" cy="${y}" r="${radius}"><title>${title}</title></circle>`;

function plot(metric, rows, minuteView, dates = [], imported = false) {
  const id = metric.id;
  const minKey = { temperature: "tempMin", voltage: "voltageMin", current: "currentMin" }[id];
  const maxKey = { temperature: "tempMax", voltage: "voltageMax", current: "currentMax" }[id];
  const values = rows.flatMap(row => [row[id], row[minKey], row[maxKey]]).filter(Number.isFinite);
  const fixed = { power: 0, frequency: 50, voltage: imported ? undefined : 39 }[id];
  if (Number.isFinite(fixed)) values.push(fixed);
  if (!rows.some(row => Number.isFinite(row[id]))) return '<p class="context">No measurements for this selection.</p>';
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  const pad = Math.max((upper - lower) * 0.08, 0.05);
  const low = id === "power" ? 0 : lower - pad;
  const high = upper + pad;
  const lastSlot = Math.max(1, dates.length) * operatingMinutes - 1;
  const x = (row, i) => 40 + 346 * (minuteView ? slot(row) / lastSlot : row.step ? (row.step - 1) / 14 : i / Math.max(1, rows.length - 1));
  const y = value => 105 - 93 * (value - low) / (high - low);
  const label = row => minuteView ? minuteLabel(row) : row.step ? `Stage ${row.step} · ${row.scenario}` : row.date;
  const segments = [];
  let points = [];
  const marks = [];
  const radius = minuteView ? 0.75 : 2.4;
  rows.forEach((row, i) => {
    if (!Number.isFinite(row[id]) || (minuteView && i &&
      (row.dayIndex !== rows[i - 1].dayIndex || row.minute !== rows[i - 1].minute + 1))) {
      if (points.length) segments.push(points);
      points = [];
    }
    if (!Number.isFinite(row[id])) return;
    const px = x(row, i);
    const py = y(row[id]);
    points.push([px, py]);
    if (dates.length > 1 && i % 5 && !(id === "temperature" && row.tempMax >= 70)) return;
    if (id === "temperature" || id === "voltage") {
      const low = row[minKey] ?? row[id];
      const high = row[maxKey] ?? row[id];
      marks.push(`<line class="${id === "temperature" && high >= 70 ? "history-critical" : "history-range"}" x1="${px}" x2="${px}" y1="${y(low)}" y2="${y(high)}"><title>${label(row)} · ${number(low)}–${number(high)} ${metric.unit}</title></line>`);
    }
    if (id === "frequency") {
      marks.push(`<line x1="${px}" x2="${px}" y1="${y(50)}" y2="${py}"><title>${label(row)} · ${number(row[id])} Hz (${(row[id] - 50).toFixed(3)} Hz from 50)</title></line>`);
    }
    if (id === "current") {
      for (const value of new Set([row[minKey], row[id], row[maxKey]])) {
        if (Number.isFinite(value)) marks.push(dot(px, y(value), `${label(row)} · ${number(value)} A`, radius));
      }
    } else {
      marks.push(dot(px, py, `${label(row)} · ${id === "frequency" ? row[id].toFixed(3) : number(row[id])} ${metric.unit}`, radius));
    }
  });
  if (points.length) segments.push(points);
  const lines = ["power", "voltage", "efficiency"].includes(id) ? segments.map(segment => {
    const path = segment.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
    const area = id === "power" ? `<path class="history-area" d="${path}L${segment.at(-1)[0]},${y(0)}L${segment[0][0]},${y(0)}Z"/>` : "";
    return `${area}<path class="history-line" d="${path}"/>`;
  }).join("") : "";
  const reference = ["frequency", "voltage"].includes(id) && Number.isFinite(fixed)
    ? `<path class="history-reference" d="M36 ${y(fixed)}H392"><title>Simulation reference ${fixed} ${metric.unit}</title></path>` : "";
  const axis = rows[0]?.step ? '<text x="40" y="125">Stage 1</text><text x="386" y="125" text-anchor="end">Stage 15</text>'
    : minuteView ? minuteAxis(dates)
    : rows.map((row, i) => `<text x="${x(row, i)}" y="125" text-anchor="middle">${row.date.slice(5)}</text>`).join("");
  return canvas(metric.label, `${reference}${lines}${marks.join("")}<text x="2" y="15">${number(high)}</text><text x="2" y="107">${number(low)}</text>${axis}`);
}

function minuteAxis(dates) {
  if (dates.length < 2) return '<text x="40" y="125">09:00</text><text x="386" y="125" text-anchor="end">17:30</text>';
  return dates.map((date, i) => `<text x="${40 + 346 * (i + .5) / dates.length}" y="125" text-anchor="middle">${date.slice(5)}</text>`).join("");
}

function bars(rows, id, minuteView, dates = []) {
  const availability = id === "availability";
  const max = availability ? 100 : Math.max(1, ...rows.map(row => row.warning + row.critical));
  const size = 344 / (minuteView ? operatingMinutes * Math.max(1, dates.length) : rows[0]?.step ? 15 : rows.length);
  const marks = rows.map((row, i) => {
    const first = availability ? row.availability : row.warning;
    if (first == null || (!minuteView && !row.samples)) return "";
    const recorded = minuteView ? 100 * row.recorded / PANEL_COUNT : row.recorded;
    const second = availability ? Math.max(0, recorded - first) : row.critical;
    const missing = availability ? Math.max(0, 100 - recorded) : 0;
    const values = [first, second, missing];
    let bottom = 108;
    const x = 40 + size * (minuteView ? slot(row) : row.step ? row.step - 1 : i);
    return values.map((value, index) => {
      const height = 95 * value / max;
      bottom -= height;
      const title = availability ? `${number(value)}% ${["available", "unavailable", "unreported"][index]}` : `${value} ${["warning", "critical"][index]} incidents`;
      return height ? `<rect class="history-segment-${index}" x="${x}" y="${bottom}" width="${Math.max(availability ? size : 1.4, size * .84)}" height="${height}"><title>${minuteView ? minuteLabel(row) : row.step ? `Stage ${row.step}` : row.date} · ${title}</title></rect>` : "";
    }).join("") + (!minuteView ? `<text x="${x}" y="125">${row.step ?? row.date.slice(5)}</text>` : "");
  }).join("");
  return canvas(availability ? "Availability distribution" : "New incidents by severity", marks + (minuteView ? minuteAxis(dates) : ""));
}

function heatmap(dates, minutes, imported) {
  const weekly = dates.length > 1;
  const block = weekly ? 15 : 1;
  return dates.map((date, index) => {
    const cells = Array.from({ length: Math.ceil(operatingMinutes / block) }, (_, i) => {
      const start = i * block;
      const end = Math.min(start + block, operatingMinutes);
      const values = [];
      for (let j = start; j < end; j++) {
        const value = minutes.get(index * operatingMinutes + j)?.[imported ? "illuminance" : "irradiance"];
        if (Number.isFinite(value)) values.push(value);
      }
      const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
      return `<span title="${date} · ${clock(start + 540)}${weekly ? "–" + clock(end - 1 + 540) : ""} · ${number(value)} ${imported ? "lux" : "W/m²"}" style="--heat:${Number.isFinite(value) ? Math.min(100, value / (imported ? 655.35 : 10)) : 0}%"></span>`;
    }).join("");
    return `<div class="${weekly ? "history-heat-row" : ""}">${weekly ? `<span>${date.slice(5)}</span>` : ""}<div class="history-minute-heat" aria-label="${date} ${imported ? "illuminance" : "irradiance"} heatmap">${cells}</div></div>`;
  }).join("") + `<p class="context">09:00–17:30 · ${weekly ? "each square averages up to 15 minutes" : "each square represents one minute"}.</p>`;
}

export function renderHistory(data) {
  const { days, date, minutes, incidents } = data;
  const dates = date ? [date] : days.map(day => day.date);
  const dayIndexes = new Map(dates.map((day, index) => [day, index]));
  const rows = minutes.map(row => {
    const day = date ?? row.date;
    return { ...row, date: day, dayIndex: dayIndexes.get(day) };
  }).filter(row => row.dayIndex !== undefined);
  const byMinute = new Map(rows.map(row => [slot(row), row]));
  const provenance = [...new Set(minutes.map(row => row.quality))].join(", ");
  const incidentsByMinute = new Map();
  const minuteByTimestamp = new Map(rows.map(row => [row.time, row]));
  for (const incident of incidents) {
    const row = minuteByTimestamp.get(incident.time);
    if (!row) continue;
    const key = slot(row);
    if (!incidentsByMinute.has(key)) incidentsByMinute.set(key, { warning: 0, critical: 0 });
    incidentsByMinute.get(key)[incident.severity]++;
  }
  const cards = metricCatalog.map(metric => {
    let chart;
    if (metric.id === "irradiance") chart = heatmap(dates, byMinute, data.imported);
    else if (data.imported && ["efficiency", "frequency"].includes(metric.id)) chart = '<p class="context">Not recorded in the imported file.</p>';
    else if (!rows.length) chart = '<p class="context">No samples for this period.</p>';
    else if (metric.id === "availability") {
      chart = bars(rows, metric.id, true, dates) + '<p class="context">Available · unavailable · unreported</p>';
    } else if (metric.id === "alerts") {
      const alertRows = rows.map(row => ({ ...row, warning: 0, critical: 0, ...incidentsByMinute.get(slot(row)) }));
      chart = bars(alertRows, metric.id, true, dates) + '<p class="context">New warning and critical incidents. Offline events count as warnings.</p>';
      if (incidentsByMinute.size) chart += `<details><summary>Incident details</summary><ul>${incidents.filter(event => minuteByTimestamp.has(event.time)).map(event =>
        `<li>${minuteLabel(minuteByTimestamp.get(event.time))} · ${event.panelId} · ${event.status}</li>`).join("")}</ul></details>`;
    } else if (metric.id === "efficiency") {
      const valid = rows.filter(row => Number.isFinite(row.efficiency));
      const value = valid.length ? valid.reduce((sum, row) => sum + row.efficiency * (row.samples ?? 1), 0)
        / valid.reduce((sum, row) => sum + (row.samples ?? 1), 0) : null;
      const gauge = Number.isFinite(value) ? `<div class="history-gauge" style="--gauge:${value}%"><strong>${number(value)}%</strong></div>` : "";
      chart = gauge + plot(metric, rows, true, dates);
    } else chart = plot(metric, rows, true, dates, data.imported);
    const light = data.imported && metric.id === "irradiance";
    return `<article class="paper history-card"><h3>${light ? "Illuminance" : metric.label} <small>${light ? "lux" : metric.unit}</small></h3>${chart}</article>`;
  }).join("");
  return `<p class="context">${data.imported ? "Imported measurements" : data.source === "simulated" ? "Simulated measurements" : "Real measurements"} · ${dates[0]}${dates.length > 1 ? " to " + dates.at(-1) : ""} · Europe/Istanbul · ${rows.length} recorded minutes${provenance ? " · " + provenance : ""}</p><div class="history-grid">${cards}</div>`;
}

export function renderSimulationCharts(lifecycle) {
  const rows = lifecycle?.series ?? [];
  const latest = rows.at(-1);
  const cards = metricCatalog.map(metric => {
    const id = metric.id;
    let chart = '<p class="context">Waiting for first stage…</p>';
    if (latest && id === "irradiance") {
      chart = `<div class="history-minute-heat simulation-heat">${Array.from({ length: 15 }, (_, i) => {
        const value = rows[i]?.irradiance;
        return `<span title="Stage ${i + 1} · ${number(value)} W/m²" style="--heat:${value ? Math.min(100, value / 10) : 0}%"></span>`;
      }).join("")}</div>`;
    } else if (latest && ["availability", "alerts"].includes(id)) {
      chart = bars(rows, id, false);
    } else if (latest) {
      chart = plot(metric, rows, false);
      if (id === "efficiency") chart = `<div class="history-gauge" style="--gauge:${latest.efficiency}%"><strong>${number(latest.efficiency)}%</strong></div>` + chart;
    }
    const value = id === "alerts" && latest ? latest.warning + latest.critical : latest?.[id];
    return `<article class="paper history-card"><h3>${metric.label} <small>${metric.unit}</small></h3><p class="context">${number(value)} ${metric.unit}</p>${chart}</article>`;
  }).join("");
  return `<p class="context" role="status">Stage ${lifecycle?.step ?? 0} of 15 · ${lifecycle?.label ?? "Ready"} · ${lifecycle?.active ? "Running" : latest ? "Complete" : "Ready"}</p><div class="history-grid">${cards}</div>`;
}
