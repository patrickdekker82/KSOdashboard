/** Labels en kleuren van de verlofstatussen; op één plek zodat ze overal gelijk zijn. */
export const STATUS_LABEL: Record<string, string> = {
  aangevraagd: 'Wacht op goedkeuring',
  goedgekeurd: 'Goedgekeurd',
  afgewezen: 'Afgewezen',
  geannuleerd: 'Ingetrokken',
};

export function statusKleur(status: string): string {
  if (status === 'goedgekeurd') return 'var(--capaciteit)';
  if (status === 'afgewezen') return 'var(--ziekte)';
  return 'var(--inkt-zacht)';
}
