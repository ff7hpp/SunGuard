export const themes = ["dark", "calm", "light"];

export function validTheme(value) {
  return themes.includes(value) ? value : "dark";
}
