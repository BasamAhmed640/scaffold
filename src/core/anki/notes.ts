// ANK-01 note types and tags. Decks express subjects, tags express content, suspension expresses scope.

export const ROOT_DECK = 'Scaffold';

export const NOTE_TYPES = {
  basic: {
    modelName: 'Scaffold Basic',
    inOrderFields: ['Front', 'Back', 'KC_ID', 'Link', 'Extra'],
    isCloze: false,
    cardTemplates: [
      {
        Name: 'Card 1',
        Front: '{{Front}}',
        Back: '{{FrontSide}}<hr id=answer>{{Back}}{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}{{#Link}}<div class="link"><a href="{{Link}}">concept note</a></div>{{/Link}}',
      },
    ],
  },
  cloze: {
    modelName: 'Scaffold Cloze',
    inOrderFields: ['Text', 'Back Extra', 'KC_ID', 'Link', 'Extra'],
    isCloze: true,
    cardTemplates: [
      {
        Name: 'Cloze',
        Front: '{{cloze:Text}}',
        Back: '{{cloze:Text}}{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}{{#Link}}<div class="link"><a href="{{Link}}">concept note</a></div>{{/Link}}',
      },
    ],
  },
} as const;

export const CARD_CSS =
  '.card { font-family: system-ui, sans-serif; font-size: 20px; text-align: left; }\n.extra, .link { font-size: 14px; opacity: 0.75; margin-top: 1em; }';

export const TAG = {
  scaffold: 'scaffold',
  anchor: 'anchor',
  check: 'scaffold::check',
  newPaused: 'scaffold::new-paused',
  dormant: 'scope::dormant',
  leech: 'leech',
  subject: (id: string): string => `subj::${id}`,
  kc: (id: string): string => `kc::${id}`,
  /** `scope::dormant::<date>::<reason>`: hierarchical, so `tag:scope::dormant` finds every dormant card. */
  dormantOn: (date: string, reason: string): string => `scope::dormant::${date}::${slugTag(reason)}`,
  retired: (reason: RetireReason): string => `retired::${reason}`,
} as const;

export const RETIRE_REASONS = ['outdated', 'superseded', 'irrelevant', 'replaced', 'duplicate'] as const;
export type RetireReason = (typeof RETIRE_REASONS)[number];

/** Tags cannot hold spaces; keep reasons short and readable. */
export function slugTag(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'unspecified'
  );
}

export function subjectOfTags(tags: string[]): string | null {
  const t = tags.find((x) => x.toLowerCase().startsWith('subj::'));
  return t ? t.slice('subj::'.length) : null;
}

export function kcsOfTags(tags: string[]): string[] {
  return tags.filter((x) => x.toLowerCase().startsWith('kc::')).map((x) => x.slice('kc::'.length));
}

export const hasTag = (tags: string[], tag: string): boolean =>
  tags.some(
    (x) => x.toLowerCase() === tag.toLowerCase() || x.toLowerCase().startsWith(`${tag.toLowerCase()}::`),
  );

/** Strips HTML for comparisons and short display (Anki fields hold HTML). */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** `obsidian://open?vault=…&file=…` for the concept note (ANK-02 Link field). */
export function obsidianLink(vaultName: string, fileRel: string): string {
  const file = fileRel.replace(/\\/g, '/').replace(/\.md$/, '');
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}
