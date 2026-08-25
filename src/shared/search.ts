export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR')
    .trim();
}

export function matchesSearch(value: string, query: string): boolean {
  return normalizeSearchText(value).includes(normalizeSearchText(query));
}
