export function activitySubject(selected, panels) {
  return Number.isInteger(selected) && panels[selected] ? panels[selected].id : "SIMULATOR";
}
