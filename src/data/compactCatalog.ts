import type {BlogCategory, BlogEntry} from './blogs.ts';

export const COMPACT_CATEGORIES: readonly BlogCategory[] = [
  'Tech & Web',
  'Blogging & Writing',
  'Business & Marketing',
  'Culture & Curiosity',
  'DIY & Productivity',
  'Politics & Commentary',
];

export type CompactSiteTuple = [
  url: string,
  catIndex: number,
  name?: string,
  extraTopics?: string[],
];

const PALETTE = [
  '#1E3A8A',
  '#1D4ED8',
  '#0F766E',
  '#B45309',
  '#991B1B',
  '#1E293B',
  '#4338CA',
  '#047857',
  '#374151',
  '#7C2D12',
];

const CATEGORY_DEFAULT_TAGLINE: readonly string[] = [
  'Technology coverage, software documentation, and digital web resources.',
  'Independent blogging, digital publishing, essays, and editorial craft.',
  'Business news, digital marketing, finance, startups, and industry insights.',
  'Arts, science, culture, media, entertainment, and global curiosity.',
  'Practical learning, health, education, recipes, tutorials, and everyday guides.',
  'News journalism, public policy, law, civic data, and commentary.',
];

const CATEGORY_DEFAULT_TOPICS: readonly string[][] = [
  ['technology', 'software', 'web'],
  ['blogging', 'writing', 'publishing'],
  ['business', 'marketing', 'finance'],
  ['culture', 'media', 'knowledge'],
  ['guides', 'education', 'lifestyle'],
  ['news', 'policy', 'government'],
];

const SMALL_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'for', 'to', 'at', 'by', 'or']);
const ACRONYMS = new Set([
  'ai', 'ml', 'it', 'seo', 'api', 'dev', 'ui', 'ux', 'tv', 'fm', 'uk', 'us', 'eu', 'un',
  'bbc', 'cnn', 'npr', 'pbs', 'mit', 'cmu', 'nyu', 'ucla', 'iit', 'iim', 'nit', 'isro',
  'drdo', 'icmr', 'naco', 'ncdc', 'rbi', 'sebi', 'cbse', 'ncert', 'ugc', 'aicte', 'nhp',
  'who', 'cdc', 'nih', 'fda', 'epa', 'nasa', 'cern', 'ieee', 'acm', 'w3c', 'ietf', 'php',
  'js', 'css', 'sql', 'aws', 'gcp', 'ibm', 'sap', 'hp', 'dell', 'amd', 'espn', 'hbo',
  'ndtv', 'dna', 'ht', 'toi', 'ft', 'wsj', 'nyt', 'hbr', 'ted', 'diy', 'faq', 'b2b', 'saas',
]);

function formatSegment(raw: string): string {
  const parts = raw
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((w, i) => {
      const low = w.toLowerCase();
      if (ACRONYMS.has(low)) return low.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(low)) return low;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function deriveSiteName(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\d*\./i, '').toLowerCase();
    const labels = host.split('.');
    // Handle multi-part ccSLDs like .co.uk, .gov.in, .ac.in, .edu.au, .com.au
    let main = labels[0] || host;
    const sub =
      labels.length >= 3 &&
      labels[0] !== 'blog' &&
      labels[0] !== 'news' &&
      labels[0] !== 'docs' &&
      labels[0] !== 'ai'
        ? null
        : labels.length >= 3
          ? labels[0]
          : null;

    if (
      labels.length >= 3 &&
      /^(co|com|org|net|gov|edu|ac|nic|res)$/i.test(labels[labels.length - 2]) &&
      labels[labels.length - 1].length === 2
    ) {
      main = labels[labels.length - 3] || labels[0];
    } else if (labels.length >= 3 && (labels[0] === 'blog' || labels[0] === 'news' || labels[0] === 'docs' || labels[0] === 'ai')) {
      main = labels[1] || labels[0];
    }

    const baseName = formatSegment(main);
    const prefix = sub && sub !== main ? formatSegment(sub) : '';
    const pathClean = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter((s) => s && s !== 'en-us' && s !== 'en' && s !== 'intl')
      .slice(-1)[0];

    let display = baseName;
    if (prefix) {
      display = `${baseName} ${prefix}`;
    }
    if (pathClean && pathClean !== 'blog' && pathClean !== 'blogs' && pathClean !== 'insights' && pathClean !== 'resources') {
      display = `${display} — ${formatSegment(pathClean)}`;
    } else if (pathClean && !prefix) {
      display = `${display} ${formatSegment(pathClean)}`;
    }
    return display || host;
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0] || url;
  }
}

export function hydrateCompactSites(
  tuples: CompactSiteTuple[],
  offset: number,
  idPrefix: string
): BlogEntry[] {
  return tuples.map((tuple, idx) => {
    const [rawUrl, catIdx, customName, extraTopics] = tuple;
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    let domain = url;
    let pathParts: string[] = [];
    try {
      const parsed = new URL(url);
      domain = parsed.hostname.replace(/^www\d*\./i, '').toLowerCase();
      pathParts = parsed.pathname
        .toLowerCase()
        .split(/[/\-_]+/)
        .filter((p) => p.length >= 3 && p !== 'en' && p !== 'www' && p !== 'intl');
    } catch {
      domain = url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0] || 'site';
    }

    const name = customName || deriveSiteName(url);
    const safeCatIdx = catIdx >= 0 && catIdx < COMPACT_CATEGORIES.length ? catIdx : 0;
    const category = COMPACT_CATEGORIES[safeCatIdx];
    const defaultTagline = CATEGORY_DEFAULT_TAGLINE[safeCatIdx];

    const hostTokens = domain
      .split('.')
      .slice(0, -1)
      .flatMap((part) => part.split('-'))
      .filter((t) => t.length >= 2 && !/^(co|com|org|net|gov|nic|ac|edu)$/i.test(t));

    const regionTopics: string[] = [];
    if (domain.endsWith('.gov.in') || domain.endsWith('.nic.in') || domain.endsWith('.in')) {
      regionTopics.push('india');
    }
    if (domain.endsWith('.gov') || domain.endsWith('.gov.in') || domain.endsWith('.gov.uk')) {
      regionTopics.push('government', 'official');
    }
    if (domain.endsWith('.edu') || domain.endsWith('.ac.in') || domain.endsWith('.ac.uk') || domain.includes('.edu.')) {
      regionTopics.push('education', 'university', 'research');
    }

    const topicSet = new Set<string>([
      ...hostTokens,
      ...pathParts,
      ...regionTopics,
      ...CATEGORY_DEFAULT_TOPICS[safeCatIdx],
      ...(extraTopics || []),
    ]);

    const slug = domain
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);

    const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/);
    const monogram =
      words.length >= 2
        ? `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase()
        : name.slice(0, 2).toUpperCase();

    return {
      id: `${idPrefix}-${slug || 'site'}-${idx + offset}`,
      name,
      url,
      domain,
      category,
      author: `${name} Editorial`,
      established: 'Active Index',
      tagline: `${name} — ${defaultTagline}`,
      description: `${defaultTagline} Open and read ${name} (${domain}) directly inside PressIndex via Clean Reader or the Live Site Frame.`,
      topics: Array.from(topicSet).slice(0, 12),
      accentHex: PALETTE[(idx + offset) % PALETTE.length],
      monogram: monogram || 'PI',
    };
  });
}
