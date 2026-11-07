export const states = {
  normal: { label: "Normal", mark: "●", color: "#8fb2a6", surface: "#b4c8d3" },
  warning: { label: "Warning", mark: "▲", color: "#f2bb65", surface: "#ffc669" },
  critical: { label: "Critical", mark: "◆", color: "#fa785a", surface: "#ff7754" },
  offline: { label: "No signal", mark: "○", color: "#a5a9b2", surface: "#777e8a" },
  isolated: { label: "Isolated", mark: "■", color: "#a9a0e7", surface: "#a9a0e7" }
};

export const panels = Array.from({ length: 500 }, (_, index) => {
  const row = Math.floor(index / 25) + 1;
  const col = index % 25 + 1;
  const id = `R${String(row).padStart(2, "0")}-C${String(col).padStart(2, "0")}`;
  const status = index === 102 || index === 368 ? "critical"
    : [28, 132, 223, 289, 435].includes(index) ? "warning"
    : index === 487 ? "offline" : "normal";
  const missing = status === "offline";
  return {
    index, row, col, id, status,
    power: missing ? null : status === "critical" ? 128 + index % 19
      : status === "warning" ? 290 + index % 23 : 415 + index % 67,
    temperature: missing ? null : status === "critical" ? 71 : 38 + index % 9,
    voltage: missing ? null : (38 + index % 13 / 10).toFixed(1)
  };
});

export function isolate(panel) {
  if (panel.status === "offline" || panel.status === "isolated") return panel;
  return { ...panel, status: "isolated", power: 0 };
}
