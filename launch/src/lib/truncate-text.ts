export function truncateText(text: string, maxCharacters: number) {
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) return text;

  return `${characters.slice(0, maxCharacters - 1).join("").trimEnd()}…`;
}
