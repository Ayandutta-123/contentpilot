/**
 * Market meme FORMATS (archetypes), not scraped copyrighted JPEG templates.
 */
export type MemeFormat = {
  id: string;
  label: string;
  structure: string;
  panels: string[];
  imageRecipe: string;
  useWhen: string;
  heat: number;
};

export const MEME_FORMAT_CATALOG: MemeFormat[] = [
  {
    id: 'expectation_vs_reality',
    label: 'Expectation vs Reality',
    structure: 'Left = expectation (pain). Right = reality (brand win). Short labels.',
    panels: ['Expectation', 'Reality'],
    imageRecipe:
      'Vertical split meme layout, left side dull/messy/frustrated metaphor, right side clean/solved metaphor, flat internet-meme illustration style, bold simple shapes, high contrast, NO readable text, NO logos, NO celebrity faces',
    useWhen: 'Product contrast, before/after ops pain',
    heat: 9,
  },
  {
    id: 'reject_approve',
    label: 'Reject / Approve',
    structure: 'Top panel = reject the old way. Bottom panel = approve the brand way.',
    panels: ['Nah', 'Hell yes'],
    imageRecipe:
      'Two-panel comic meme: top panel person-silhouette pushing away old paperwork, bottom panel same silhouette pointing at a sleek dashboard — anonymous silhouette only, meme comic flat style, NO celebrity likeness, NO text in art',
    useWhen: 'Choosing brand solution over legacy',
    heat: 9,
  },
  {
    id: 'expanding_brain',
    label: 'Expanding brain',
    structure: '3–4 escalating stages ending on brand insight (last = galaxy brain).',
    panels: ['Level 1', 'Level 2', 'Level 3', 'Galaxy'],
    imageRecipe:
      'Four stacked horizontal meme panels, each with a glowing brain motif getting brighter, absurd internet meme aesthetic, flat vector, NO readable text, NO logos',
    useWhen: 'Tiered thinking / maturity narrative',
    heat: 7,
  },
  {
    id: 'distracted_choice',
    label: 'Distracted choice',
    structure:
      'Character looks at shiny distraction (bad habit) while partner (good process) is ignored — brand = the right path.',
    panels: ['Distraction', 'What we should do', 'Us'],
    imageRecipe:
      'Three-figure meme composition with anonymous silhouettes only (no real people), comic meme style, clear left-right attention gag, NO celebrity faces, NO text in artwork',
    useWhen: 'Teams chasing shiny tools vs real ops',
    heat: 8,
  },
  {
    id: 'this_is_fine',
    label: 'This is fine',
    structure: 'Calm denial while everything burns — brand offers the extinguisher.',
    panels: ['This is fine', 'Meanwhile…'],
    imageRecipe:
      'Classic sitcom-room-on-fire meme composition with anonymous cartoon dog-like character (original, not copying trademarked character designs), flat meme art, NO text, NO logos',
    useWhen: 'Ignoring broken manual processes',
    heat: 8,
  },
  {
    id: 'waiting',
    label: 'Still waiting',
    structure: 'Endless wait for the old process vs instant brand outcome.',
    panels: ['Waiting on…', 'With us'],
    imageRecipe:
      'Two-panel meme: left empty waiting room / loading forever vibe, right instant green check dashboard, crude internet meme illustration, high contrast, NO text in art, NO celebrities',
    useWhen: 'Speed / SLA / reports delay',
    heat: 8,
  },
  {
    id: 'trade_offer',
    label: 'Trade offer',
    structure: 'I receive X / you receive Y — brand bargain joke.',
    panels: ['I receive', 'You receive'],
    imageRecipe:
      'Two-column trade-offer meme desk layout with anonymous silhouette, paper slips as blank shapes (no writing), internet meme flat style, NO readable text, NO logos',
    useWhen: 'Partnership / value exchange',
    heat: 6,
  },
  {
    id: 'one_does_not_simply',
    label: 'One does not simply…',
    structure: 'Epic obstacle meme: “one does not simply [pain]” → brand is the pass.',
    panels: ['One does not simply', 'Unless…'],
    imageRecipe:
      'Epic fantasy bridge meme composition with anonymous armored silhouette (original, not a known actor), dramatic meme still, NO readable text carved in stone, NO celebrity faces',
    useWhen: 'Hard industry myths',
    heat: 6,
  },
];

export function getMemeFormat(id: string): MemeFormat | undefined {
  return MEME_FORMAT_CATALOG.find((f) => f.id === id);
}
