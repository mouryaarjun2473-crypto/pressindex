import express from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import * as cheerio from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {createServer as createViteServer} from 'vite';
import {CURATED_BLOGS, type ArticleSummary, type BlogEntry} from './src/data/blogs.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

interface CachedDigest {
  timestamp: number;
  siteTitle: string;
  siteDescription: string;
  posts: ArticleSummary[];
  notice?: string;
}

const digestCache = new Map<string, CachedDigest>();
const DIGEST_TTL_MS = 15 * 60 * 1000;

interface CachedArticle {
  timestamp: number;
  data: {
    title: string;
    byline: string;
    publishedAt: string;
    siteName: string;
    url: string;
    leadImage: string;
    contentHtml: string;
    excerpt: string;
    wordCount: number;
    readingMinutes: number;
  };
}

const articleCache = new Map<string, CachedArticle>();
const ARTICLE_TTL_MS = 20 * 60 * 1000;

interface CachedBrowse {
  timestamp: number;
  html: string;
  finalUrl: string;
}

const browseCache = new Map<string, CachedBrowse>();
const BROWSE_TTL_MS = 10 * 60 * 1000;

function isSafePublicHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const BROWSER_PROFILES: Array<Record<string, string>> = [
  {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
    Referer: 'https://www.google.com/',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    Referer: 'https://duckduckgo.com/',
  },
];

async function fetchWithTimeout(
  url: string,
  timeoutMs = 7000,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  profileIndex = 0
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const profile = BROWSER_PROFILES[profileIndex % BROWSER_PROFILES.length];
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        ...profile,
        Accept: accept,
      },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  timeoutMs = 8500,
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
) {
  const first = await fetchWithTimeout(url, timeoutMs, accept, 0);
  if (first.status === 429 || first.status === 503 || first.status === 403) {
    if (first.status === 429 || first.status === 503) {
      await new Promise((r) => setTimeout(r, 400));
    }
    try {
      const second = await fetchWithTimeout(url, timeoutMs, accept, 1);
      if (second.ok) return second;
    } catch {
      // return first response
    }
  }
  return first;
}

function stripHtml(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.text().replace(/\s+/g, ' ').trim();
}

function extractFirstImage(html: string, baseUrl: string): string {
  if (!html) return '';
  try {
    const $ = cheerio.load(html);
    const src = $('img').first().attr('src') || $('img').first().attr('data-src') || '';
    if (!src) return '';
    return new URL(src, baseUrl).toString();
  } catch {
    return '';
  }
}

function textValue(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj['#text'] === 'string') return obj['#text'];
    if (typeof obj['@_href'] === 'string') return obj['@_href'];
  }
  return '';
}

function parseXmlFeed(xml: string, blog: BlogEntry): ArticleSummary[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const posts: ArticleSummary[] = [];

  // RSS 2.0 / RDF
  const rss = parsed.rss as Record<string, unknown> | undefined;
  const channel = (rss?.channel || (parsed['rdf:RDF'] as Record<string, unknown> | undefined)) as
    | Record<string, unknown>
    | undefined;

  if (channel && channel.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    for (let i = 0; i < Math.min(items.length, 15); i++) {
      const item = items[i] as Record<string, unknown>;
      const title = stripHtml(textValue(item.title)) || 'Untitled Dispatch';
      const rawLink = textValue(item.link) || textValue(item.guid);
      let link = blog.url;
      try {
        if (rawLink) link = new URL(rawLink, blog.url).toString();
      } catch {
        link = blog.url;
      }

      const rawDesc =
        textValue(item['content:encoded']) ||
        textValue(item.description) ||
        textValue(item.summary);
      const excerpt = stripHtml(rawDesc).slice(0, 240);

      let image = '';
      const mediaContent = item['media:content'] as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const mediaThumb = item['media:thumbnail'] as Record<string, unknown> | undefined;
      const enclosure = item.enclosure as Record<string, unknown> | undefined;
      if (Array.isArray(mediaContent) && mediaContent[0]?.['@_url']) {
        image = String(mediaContent[0]['@_url']);
      } else if (mediaContent && !Array.isArray(mediaContent) && mediaContent['@_url']) {
        image = String(mediaContent['@_url']);
      } else if (mediaThumb?.['@_url']) {
        image = String(mediaThumb['@_url']);
      } else if (enclosure?.['@_url'] && String(enclosure['@_type'] || '').startsWith('image')) {
        image = String(enclosure['@_url']);
      } else {
        image = extractFirstImage(rawDesc, link);
      }

      const rawCats = item.category;
      const categories: string[] = [];
      if (Array.isArray(rawCats)) {
        for (const c of rawCats.slice(0, 3)) {
          const cv = stripHtml(textValue(c));
          if (cv) categories.push(cv);
        }
      } else if (rawCats) {
        const cv = stripHtml(textValue(rawCats));
        if (cv) categories.push(cv);
      }

      posts.push({
        id: `${blog.id}-${i}-${Buffer.from(link).toString('base64').slice(0, 10)}`,
        blogId: blog.id,
        blogName: blog.name,
        blogUrl: blog.url,
        blogDomain: blog.domain,
        title,
        link,
        pubDate: textValue(item.pubDate) || textValue(item['dc:date']) || '',
        author: stripHtml(textValue(item['dc:creator']) || textValue(item.author)) || blog.author,
        excerpt: excerpt || blog.tagline,
        image: image || undefined,
        categories: categories.length > 0 ? categories : [blog.category],
        isLive: true,
      });
    }
    return posts;
  }

  // Atom (including Blogger /feeds/posts/default)
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (feed && feed.entry) {
    const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
    for (let i = 0; i < Math.min(entries.length, 15); i++) {
      const entry = entries[i] as Record<string, unknown>;
      const title = stripHtml(textValue(entry.title)) || 'Untitled Entry';

      let link = blog.url;
      const rawLinks = entry.link;
      if (Array.isArray(rawLinks)) {
        const alt = rawLinks.find(
          (l) => (l as Record<string, unknown>)['@_rel'] === 'alternate'
        ) as Record<string, unknown> | undefined;
        const chosen = alt || (rawLinks[0] as Record<string, unknown>);
        if (chosen?.['@_href']) {
          link = String(chosen['@_href']);
        }
      } else if (rawLinks && typeof rawLinks === 'object') {
        const href = (rawLinks as Record<string, unknown>)['@_href'];
        if (typeof href === 'string') link = href;
      }

      const rawContent = textValue(entry.content) || textValue(entry.summary);
      const excerpt = stripHtml(rawContent).slice(0, 240);
      const mediaThumb = entry['media:thumbnail'] as Record<string, unknown> | undefined;
      const image =
        (mediaThumb?.['@_url'] ? String(mediaThumb['@_url']) : '') ||
        extractFirstImage(rawContent, link);

      const authorObj = entry.author as Record<string, unknown> | undefined;
      const authorName = authorObj ? stripHtml(textValue(authorObj.name)) : '';

      const rawCats = entry.category;
      const categories: string[] = [];
      if (Array.isArray(rawCats)) {
        for (const c of rawCats.slice(0, 3)) {
          const term = (c as Record<string, unknown>)['@_term'];
          if (typeof term === 'string' && term) categories.push(term);
        }
      } else if (rawCats && typeof rawCats === 'object') {
        const term = (rawCats as Record<string, unknown>)['@_term'];
        if (typeof term === 'string' && term) categories.push(term);
      }

      posts.push({
        id: `${blog.id}-${i}-${Buffer.from(link).toString('base64').slice(0, 10)}`,
        blogId: blog.id,
        blogName: blog.name,
        blogUrl: blog.url,
        blogDomain: blog.domain,
        title,
        link,
        pubDate: textValue(entry.published) || textValue(entry.updated) || '',
        author: authorName || blog.author,
        excerpt: excerpt || blog.tagline,
        image: image || undefined,
        categories: categories.length > 0 ? categories : [blog.category],
        isLive: true,
      });
    }
  }

  return posts;
}

function scrapeHtmlHeadlines(html: string, blog: BlogEntry): {posts: ArticleSummary[]; siteTitle: string; siteDescription: string; feedLink: string} {
  const $ = cheerio.load(html);
  const siteTitle = $('title').first().text().trim() || blog.name;
  const siteDescription =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    blog.description;

  const feedLinkRaw =
    $('link[type="application/rss+xml"]').first().attr('href') ||
    $('link[type="application/atom+xml"]').first().attr('href') ||
    '';
  let feedLink = '';
  if (feedLinkRaw) {
    try {
      feedLink = new URL(feedLinkRaw, blog.url).toString();
    } catch {
      feedLink = '';
    }
  }

  const seen = new Set<string>();
  const posts: ArticleSummary[] = [];

  $('article a, h1 a, h2 a, h3 a, .post-title a, .entry-title a, main a').each((_, el) => {
    if (posts.length >= 12) return;
    const $el = $(el);
    const title = $el.text().replace(/\s+/g, ' ').trim();
    const href = $el.attr('href');
    if (!href || title.length < 18 || title.length > 180) return;
    if (/^(home|about|contact|privacy|terms|login|sign in|sign up|subscribe|read more|get started|start your blog)/i.test(title)) return;

    try {
      const absUrl = new URL(href, blog.url).toString();
      if (!absUrl.startsWith('http') || seen.has(absUrl)) return;
      if (/\/(login|signin|sign-in|signup|sign-up|register|pricing|auth|oauth)\b/i.test(absUrl)) return;
      seen.add(absUrl);

      const parentText = $el.closest('article, .post, li, div').text().replace(/\s+/g, ' ').trim();
      const excerpt = parentText.length > title.length + 20 ? parentText.slice(0, 220) : blog.tagline;

      posts.push({
        id: `${blog.id}-html-${posts.length}`,
        blogId: blog.id,
        blogName: blog.name,
        blogUrl: blog.url,
        blogDomain: blog.domain,
        title,
        link: absUrl,
        pubDate: '',
        author: blog.author,
        excerpt,
        categories: [blog.category],
        isLive: true,
      });
    } catch {
      // ignore invalid href
    }
  });

  return {posts, siteTitle, siteDescription, feedLink};
}

interface SearchRecord {
  blog: BlogEntry;
  nameLower: string;
  domainLower: string;
  authorLower: string;
  catLower: string;
  taglineLower: string;
  descLower: string;
  topicsLower: string[];
}

const CURATED_BLOG_BY_DOMAIN = new Map<string, BlogEntry>();
const CURATED_BLOG_BY_ID = new Map<string, BlogEntry>();
const SEARCH_INDEX: SearchRecord[] = [];
for (const b of CURATED_BLOGS) {
  CURATED_BLOG_BY_ID.set(b.id.toLowerCase(), b);
  const dom = b.domain.replace(/^www\./i, '').toLowerCase();
  if (!CURATED_BLOG_BY_DOMAIN.has(dom)) {
    CURATED_BLOG_BY_DOMAIN.set(dom, b);
  }
  SEARCH_INDEX.push({
    blog: b,
    nameLower: b.name.toLowerCase(),
    domainLower: b.domain.toLowerCase(),
    authorLower: b.author.toLowerCase(),
    catLower: b.category.toLowerCase(),
    taglineLower: b.tagline.toLowerCase(),
    descLower: b.description.toLowerCase(),
    topicsLower: b.topics.map((t) => t.toLowerCase()),
  });
}

function buildBlogFromUrl(targetUrl: string): BlogEntry {
  try {
    const dom = new URL(targetUrl).hostname.replace(/^www\./i, '').toLowerCase();
    const existing = CURATED_BLOG_BY_DOMAIN.get(dom);
    if (existing) return existing;
  } catch {
    // ignore URL parse errors
  }

  const parsed = new URL(targetUrl);
  const domain = parsed.hostname.replace(/^www\./, '');
  const label = domain.split('.')[0] || domain;
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    id: `custom-${domain}`,
    name,
    url: targetUrl,
    domain,
    category: 'Tech & Web',
    author: name,
    established: 'Web',
    tagline: `Direct in-site view for ${domain}`,
    description: `Live web publication loaded directly from ${targetUrl}.`,
    topics: [domain, name.toLowerCase()],
    accentHex: '#1E3A8A',
    monogram: name.slice(0, 2).toUpperCase(),
  };
}

async function fetchSiteDigest(blog: BlogEntry, timeoutMs = 5500): Promise<CachedDigest> {
  const cacheKey = blog.url;
  const cached = digestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DIGEST_TTL_MS) {
    return cached;
  }

  let posts: ArticleSummary[] = [];
  let siteTitle = blog.name;
  let siteDescription = blog.description;
  let notice: string | undefined;

  // 1. Try explicit RSS/Atom feed first
  if (blog.feedUrl) {
    try {
      const resp = await fetchWithTimeout(
        blog.feedUrl,
        timeoutMs,
        'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
      );
      if (resp.ok) {
        const xml = await resp.text();
        posts = parseXmlFeed(xml, blog);
      }
    } catch {
      // Fall through to HTML homepage discovery
    }
  }

  // 2. If no posts yet, fetch homepage HTML and discover RSS or scrape headlines
  if (posts.length === 0) {
    try {
      const resp = await fetchWithTimeout(blog.url, timeoutMs);
      if (resp.ok) {
        const html = await resp.text();
        const scraped = scrapeHtmlHeadlines(html, blog);
        siteTitle = scraped.siteTitle;
        siteDescription = scraped.siteDescription;

        if (scraped.feedLink && scraped.feedLink !== blog.feedUrl) {
          try {
            const feedResp = await fetchWithTimeout(scraped.feedLink, timeoutMs);
            if (feedResp.ok) {
              const feedXml = await feedResp.text();
              posts = parseXmlFeed(feedXml, blog);
            }
          } catch {
            // use scraped HTML headlines
          }
        }

        if (posts.length === 0) {
          posts = scraped.posts;
        }
      } else {
        notice = `Remote server returned HTTP ${resp.status}. You can still browse or open the site link directly.`;
      }
    } catch {
      notice = 'Live feed request timed out or was restricted by the remote host. Showing editorial index profile.';
    }
  }

  // 3. Ensure there is always at least a clean homepage entry so user can open the site directly
  if (posts.length === 0) {
    posts = [
      {
        id: `${blog.id}-frontpage`,
        blogId: blog.id,
        blogName: blog.name,
        blogUrl: blog.url,
        blogDomain: blog.domain,
        title: `${blog.name} — Front Page & Latest Archive`,
        link: blog.url,
        pubDate: '',
        author: blog.author,
        excerpt: blog.description,
        categories: [blog.category],
        isLive: false,
      },
    ];
  }

  const result: CachedDigest = {
    timestamp: Date.now(),
    siteTitle,
    siteDescription,
    posts,
    notice,
  };
  digestCache.set(cacheKey, result);
  return result;
}

const TOPIC_SYNONYMS: Record<string, string[]> = {
  coding: ['programming', 'javascript', 'css', 'web design', 'frontend', 'emacs', 'apps script', 'arduino'],
  programming: ['coding', 'javascript', 'css', 'web development', 'emacs', 'apps script'],
  design: ['web design', 'ui', 'ux', 'graphic design', 'css', 'typography', 'fonts', 'sketchnotes'],
  blogging: ['blog', 'blogger', 'blogspot', 'problogger', 'shoutmeloud', 'copyblogger', 'writing', 'seo'],
  blog: ['blogging', 'blogger', 'blogspot', 'writing', 'essays'],
  blogger: ['blogspot', 'blogger buster', 'google blogger', 'templates'],
  google: ['labnol', 'apps script', 'gmail', 'google sheets', 'blogger'],
  gadgets: ['gizmodo', 'engadget', 'hardware', 'reviews', 'smartphones', 'laptops', 'electronics'],
  tech: ['technology', 'gadgets', 'software', 'apps', 'tutorials', 'how to', 'linux', 'windows'],
  technology: ['tech', 'gadgets', 'software', 'science', 'web'],
  diy: ['instructables', 'maker', 'arduino', 'crafts', 'woodworking', 'projects', 'how to'],
  funny: ['satire', 'humor', 'despair', 'demotivators', 'comedy', 'weird'],
  humor: ['satire', 'despair', 'demotivators', 'funny', 'comedy'],
  english: ['esl', 'efl', 'grammar', 'vocabulary', 'teaching', 'michelle henry'],
  study: ['learning', 'english', 'education', 'trivia', 'history', 'productivity'],
  news: ['politics', 'tech news', 'daily kos', 'althouse', 'gizmodo', 'engadget', 'mashable'],
  money: ['monetization', 'adsense', 'affiliate marketing', 'problogger', 'shoutmeloud'],
  earning: ['monetization', 'adsense', 'affiliate marketing', 'problogger', 'shoutmeloud'],
  environment: ['climate', 'sustainability', 'treehugger', 'green', 'solar', 'nature'],
  facts: ['trivia', 'mental floss', 'neatorama', 'history', 'science'],
  productivity: ['lifehack', 'sacha chua', 'habits', 'time management', 'emacs', 'automation', 'notion'],
  ai: ['machine learning', 'llm', 'data science', 'hugging face', 'analytics vidhya', 'towards data science'],
  python: ['coding', 'data science', 'machine learning', 'geeksforgeeks', 'freecodecamp', 'kaggle'],
  startups: ['founders', 'saas', 'venture capital', 'indie hackers', 'yourstory', 'entrepreneur', 'foundr'],
  startup: ['startups', 'founders', 'saas', 'yourstory', 'indie hackers', 'entrepreneur'],
  business: ['small business', 'startups', 'entrepreneurship', 'marketing', 'finance', 'saas'],
  marketing: ['seo', 'content marketing', 'copywriting', 'hubspot', 'social media', 'growth'],
  seo: ['search engine', 'google search', 'search engine land', 'shoutmeloud', 'hubspot', 'backlinks'],
  data: ['data science', 'analytics', 'kaggle', 'towards data science', 'machine learning'],
  cybersecurity: ['hacking', 'security', 'infosec', 'the hacker news', 'privacy'],
  hacking: ['cybersecurity', 'the hacker news', 'infosec', 'security'],
  india: ['india today', 'yourstory', 'geeksforgeeks', 'labnol', 'refrens', 'paidforarticles'],
  nocode: ['no-code', 'webflow', 'framer', 'carrd', 'wix', 'dorik', 'typedream'],
  newsletter: ['newsletters', 'substack', 'beehiiv', 'buttondown', 'ghost', 'kit'],
  newsletters: ['substack', 'beehiiv', 'buttondown', 'ghost', 'kit', 'the hustle'],
  books: ['goodreads', 'ourboox', 'wattpad', 'reading', 'literature'],
  research: ['science', 'academia', 'zenodo', 'osf', 'figshare', 'researchgate', 'lse blogs'],
  web3: ['blockchain', 'crypto', 'steemit', 'hive', 'peakd', 'paragraph', 'matters'],
  pr: ['press release', 'prlog', 'openpr', 'pr.com', '1888pressrelease', 'press'],
  law: ['legal', 'courts', 'supreme court', 'litigation', 'legal tech', 'law firms', 'bar and bench', 'livelaw', 'abovethelaw'],
  legal: ['law', 'courts', 'litigation', 'legal tech', 'constitutional law', 'legal news'],
  photography: ['cameras', 'lighting', 'lightroom', 'petapixel', 'fstoppers', 'photojournalism', 'portraits'],
  camera: ['photography', 'cameras', 'gear reviews', 'lenses', 'petapixel'],
  travel: ['itineraries', 'backpacking', 'hotels', 'adventure', 'digital nomad', 'city guides', 'tourism'],
  food: ['recipes', 'cooking', 'culinary', 'nutrition', 'baking', 'restaurants', 'plant-based'],
  recipes: ['food', 'cooking', 'meal prep', 'baking', 'healthy food'],
  fitness: ['workouts', 'running', 'yoga', 'strength training', 'nutrition', 'triathlon'],
  yoga: ['mindfulness', 'meditation', 'fitness', 'wellness', 'breathwork'],
  realestate: ['real estate', 'property', 'mortgages', 'housing', 'coworking', 'commercial real estate'],
  housing: ['real estate', 'mortgages', 'interior design', 'homebuilding', 'architecture'],
  education: ['teaching', 'teachers', 'universities', 'higher education', 'students', 'courses', 'stem'],
  teachers: ['teaching', 'education', 'classroom', 'ela', 'pedagogy'],
  climate: ['environment', 'sustainability', 'clean energy', 'solar', 'conservation', 'grist', 'ecology'],
  solar: ['clean energy', 'renewable energy', 'photovoltaics', 'ev', 'sustainability', 'cleantechnica'],
  pets: ['dogs', 'cats', 'veterinary', 'dog training', 'pet health', 'animal wellness'],
  dogs: ['pets', 'dog training', 'dog food', 'canine science', 'whole dog journal'],
  cats: ['pets', 'feline health', 'modern cat', 'pet behavior'],
  gaming: ['video games', 'game dev', 'esports', 'indie games', 'game design', 'unreal engine'],
  gamedev: ['game dev', 'game design', 'game engines', '3d art', 'unreal engine', 'c++'],
  woodworking: ['carpentry', 'furniture', 'joinery', 'tools', 'diy', 'fine woodworking'],
  architecture: ['buildings', 'interior design', 'green building', 'urbanism', 'dezeen', 'archdaily'],
  hr: ['recruiting', 'talent acquisition', 'people ops', 'workplace', 'hiring', 'leadership'],
  recruiting: ['hr', 'hiring', 'talent acquisition', 'careers', 'sourcing'],
  accounting: ['bookkeeping', 'tax', 'fintech', 'finance', 'cpa', 'invoicing'],
  fintech: ['accounting', 'finance', 'investing', 'payments', 'wealth tech'],
};

function expandSearchTokens(tokens: string[]): Set<string> {
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = TOPIC_SYNONYMS[t];
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return expanded;
}

function scoreRecordForQuery(
  rec: SearchRecord,
  tokens: string[],
  qLower: string,
  expandedTokens: Set<string>
): number {
  let score = 0;
  const {nameLower, domainLower, authorLower, catLower, taglineLower, descLower, topicsLower} = rec;

  if (nameLower === qLower || domainLower === qLower) score += 150;
  else if (nameLower.includes(qLower) || domainLower.includes(qLower)) score += 90;
  if (topicsLower.some((t) => t === qLower)) score += 80;

  for (const token of expandedTokens) {
    const isDirect = tokens.includes(token);
    const weight = isDirect ? 1 : 0.45;
    if (nameLower.includes(token)) score += 45 * weight;
    if (domainLower.includes(token)) score += 35 * weight;
    if (authorLower.includes(token)) score += 30 * weight;
    if (catLower.includes(token)) score += 20 * weight;
    for (const topic of topicsLower) {
      if (topic === token) score += 42 * weight;
      else if (topic.includes(token)) score += 24 * weight;
    }
    if (taglineLower.includes(token)) score += 18 * weight;
    if (descLower.includes(token)) score += 10 * weight;
  }

  return Math.round(score);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok', blogsCount: CURATED_BLOGS.length});
  });

  // Fetch live digest (RSS / Atom / scraped headlines) for a specific site
  app.get('/api/site-digest', async (req, res) => {
    const rawUrl = String(req.query.url || '');
    const parsed = isSafePublicHttpUrl(rawUrl);
    if (!parsed) {
      res.status(400).json({error: 'Invalid or disallowed URL'});
      return;
    }

    const blog = buildBlogFromUrl(parsed.toString());
    const digest = await fetchSiteDigest(blog);
    res.json({
      blog,
      siteTitle: digest.siteTitle,
      siteDescription: digest.siteDescription,
      posts: digest.posts,
      notice: digest.notice,
    });
  });

  // Fetch & sanitize an article or webpage for clean in-site reading
  app.get('/api/article', async (req, res) => {
    const rawUrl = String(req.query.url || '');
    const parsed = isSafePublicHttpUrl(rawUrl);
    if (!parsed) {
      res.status(400).json({error: 'Invalid or disallowed URL'});
      return;
    }

    const targetUrl = parsed.toString();
    const cached = articleCache.get(targetUrl);
    if (cached && Date.now() - cached.timestamp < ARTICLE_TTL_MS) {
      res.json(cached.data);
      return;
    }

    try {
      const resp = await fetchWithRetry(targetUrl, 8500);
      if (!resp.ok) {
        res.status(502).json({
          error: `Remote site responded with HTTP ${resp.status}`,
          url: targetUrl,
        });
        return;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        res.status(415).json({
          error: 'Target URL is not an HTML article page.',
          url: targetUrl,
        });
        return;
      }

      const html = await resp.text();
      const $ = cheerio.load(html);

      const title =
        $('meta[property="og:title"]').attr('content')?.trim() ||
        $('h1').first().text().trim() ||
        $('title').first().text().trim() ||
        parsed.hostname;

      const byline =
        $('meta[name="author"]').attr('content')?.trim() ||
        $('[rel="author"]').first().text().trim() ||
        $('.author, .byline').first().text().trim() ||
        parsed.hostname.replace(/^www\./, '');

      const publishedAt =
        $('meta[property="article:published_time"]').attr('content')?.trim() ||
        $('time').first().attr('datetime') ||
        $('time').first().text().trim() ||
        '';

      const siteName =
        $('meta[property="og:site_name"]').attr('content')?.trim() ||
        parsed.hostname.replace(/^www\./, '');

      let leadImage =
        $('meta[property="og:image"]').attr('content')?.trim() ||
        $('meta[name="twitter:image"]').attr('content')?.trim() ||
        '';
      if (leadImage) {
        try {
          leadImage = new URL(leadImage, targetUrl).toString();
        } catch {
          leadImage = '';
        }
      }

      // Remove boilerplate & unsafe elements
      $(
        'script, style, noscript, iframe, svg, nav, header, footer, aside, form, button, .nav, .navbar, .sidebar, .footer, .header, .ad, .ads, .advertisement, .cookie, .comments, #comments, .share-buttons'
      ).remove();

      const candidates = [
        'article',
        '[role="main"] article',
        '.post-content',
        '.entry-content',
        '.post-body',
        '.article-content',
        '.article-body',
        'main',
        '[role="main"]',
      ];

      const matchedSelector = candidates.find(
        (selector) => $(selector).first().text().trim().length > 220
      );
      const $container = $(matchedSelector || 'body').first();

      // Remove any nested h1 duplicating the page title
      $container.find('h1').first().remove();

      // Resolve relative links & images
      $container.find('a').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          try {
            $(el).attr('href', new URL(href, targetUrl).toString());
          } catch {
            // keep
          }
        }
      });

      $container.find('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (src) {
          try {
            $(el).attr('src', new URL(src, targetUrl).toString());
            $(el).attr('referrerpolicy', 'no-referrer');
            $(el).removeAttr('srcset');
          } catch {
            $(el).remove();
          }
        } else {
          $(el).remove();
        }
      });

      const contentHtml = $container.html() || '<p>No readable article body was detected on this page. Switch to the Live Site Frame tab to view the full page directly.</p>';
      const plainText = $container.text().replace(/\s+/g, ' ').trim();
      const wordCount = plainText ? plainText.split(/\s+/).length : 0;
      const readingMinutes = Math.max(1, Math.round(wordCount / 220));
      const excerpt = plainText.slice(0, 260);

      const data = {
        title,
        byline,
        publishedAt,
        siteName,
        url: targetUrl,
        leadImage,
        contentHtml,
        excerpt,
        wordCount,
        readingMinutes,
      };

      articleCache.set(targetUrl, {timestamp: Date.now(), data});
      res.json(data);
    } catch {
      res.status(502).json({
        error: 'Unable to fetch article content cleanly. Try the Live Site Frame tab or open in a new tab.',
        url: targetUrl,
      });
    }
  });

  // Safe In-Site Live Browser Proxy (strips X-Frame-Options/CSP, resolves assets, prevents iframe escapes, and serves In-Site Broadsheet fallback on WAF/403/429)
  function escapeHtmlText(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function renderInSiteBroadsheetHtml(
    targetUrl: string,
    hostname: string,
    reasonText: string
  ): Promise<string> {
    const blog = buildBlogFromUrl(targetUrl);
    let digest: CachedDigest | null = null;
    try {
      digest = await fetchSiteDigest(blog, 4500);
    } catch {
      digest = null;
    }

    const livePosts = (digest?.posts || []).filter((p) => p.isLive);
    const postsMarkup =
      livePosts.length > 0
        ? livePosts
            .map(
              (p) => `
            <article class="card">
              <div class="meta">${escapeHtmlText(p.author || blog.name)}${
                p.pubDate ? ` &middot; ${escapeHtmlText(p.pubDate.slice(0, 16))}` : ''
              }</div>
              <h3>
                <a href="/api/browse?url=${encodeURIComponent(p.link)}" data-reader-url="${escapeHtmlText(
                  p.link
                )}">${escapeHtmlText(p.title)}</a>
              </h3>
              <p>${escapeHtmlText(p.excerpt || blog.tagline)}</p>
              <div class="card-actions">
                <button type="button" class="btn-link" onclick="window.parent.postMessage({type:'pressindex:open-reader',url:${JSON.stringify(
                  p.link
                )}},'*')">Read in Clean Reader</button>
                <a class="btn-muted" href="/api/browse?url=${encodeURIComponent(p.link)}">Load Article Frame</a>
              </div>
            </article>
          `
            )
            .join('')
        : `
          <div class="empty-card">
            <h3>${escapeHtmlText(blog.name)} — Indexed Publication Profile</h3>
            <p>${escapeHtmlText(blog.description)}</p>
            <div class="topics">
              ${blog.topics
                .slice(0, 8)
                .map((t) => `<span class="topic">${escapeHtmlText(t)}</span>`)
                .join('')}
            </div>
          </div>
        `;

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtmlText(blog.name)} — PressIndex Broadsheet View</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Georgia, "Times New Roman", serif; background: #FAF9F6; color: #141413; margin: 0; padding: 28px 20px 56px; line-height: 1.6; }
      .wrap { max-width: 880px; margin: 0 auto; }
      .masthead { background: #FFFFFF; border: 1px solid #E7E5E4; border-radius: 12px; padding: 28px; margin-bottom: 20px; }
      .eyebrow { font-family: system-ui, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #78716C; margin-bottom: 8px; }
      h1 { font-size: 28px; line-height: 1.2; margin: 0 0 10px; }
      .desc { font-family: system-ui, sans-serif; font-size: 15px; color: #44403C; margin: 0 0 16px; }
      .notice { font-family: system-ui, sans-serif; font-size: 13px; background: #F5F5F4; border: 1px solid #E7E5E4; border-radius: 8px; padding: 12px 14px; color: #57534E; margin-bottom: 18px; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .btn-primary { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 600; background: #1E3A8A; color: #FFFFFF; border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; text-decoration: none; }
      .btn-secondary { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 500; background: #FFFFFF; color: #141413; border: 1px solid #D6D3D1; border-radius: 8px; padding: 9px 14px; cursor: pointer; text-decoration: none; }
      .subbar { font-family: system-ui, sans-serif; display: flex; gap: 8px; margin-bottom: 22px; }
      .subbar input { flex: 1; padding: 10px 12px; font-size: 13px; border: 1px solid #D6D3D1; border-radius: 8px; background: #FFFFFF; color: #141413; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
      .card, .empty-card { background: #FFFFFF; border: 1px solid #E7E5E4; border-radius: 10px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; }
      .meta { font-family: system-ui, sans-serif; font-size: 12px; color: #78716C; margin-bottom: 6px; }
      .card h3, .empty-card h3 { font-size: 18px; line-height: 1.3; margin: 0 0 8px; }
      .card h3 a { color: #141413; text-decoration: none; }
      .card h3 a:hover { color: #1E3A8A; text-decoration: underline; }
      .card p, .empty-card p { font-family: system-ui, sans-serif; font-size: 13px; color: #57534E; margin: 0 0 12px; }
      .card-actions { font-family: system-ui, sans-serif; display: flex; gap: 14px; padding-top: 10px; border-top: 1px solid #F5F5F4; font-size: 12px; }
      .btn-link { background: none; border: 0; padding: 0; color: #1E3A8A; font-weight: 600; cursor: pointer; font-size: 12px; font-family: system-ui, sans-serif; }
      .btn-muted { color: #78716C; text-decoration: none; }
      .topics { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .topic { font-family: system-ui, sans-serif; font-size: 12px; color: #44403C; background: #F5F5F4; padding: 4px 10px; border-radius: 6px; }
    </style>
    <script>
      try {
        window.parent.postMessage({ type: 'pressindex:frame-ready', url: ${JSON.stringify(targetUrl)} }, '*');
        window.parent.postMessage({ type: 'pressindex:frame-fallback', url: ${JSON.stringify(targetUrl)}, reason: ${JSON.stringify(reasonText)} }, '*');
      } catch {}
    </script>
  </head>
  <body>
    <div class="wrap">
      <section class="masthead">
        <div class="eyebrow">${escapeHtmlText(blog.category)} &middot; ${escapeHtmlText(hostname)}</div>
        <h1>${escapeHtmlText(blog.name)}</h1>
        <p class="desc">${escapeHtmlText(blog.description)}</p>
        <div class="notice">${escapeHtmlText(reasonText)}</div>
        <div class="actions">
          <button type="button" class="btn-primary" onclick="window.parent.postMessage({type:'pressindex:switch-reader'},'*')">Open Clean Reader</button>
          <a class="btn-secondary" href="/api/browse?url=${encodeURIComponent(targetUrl)}&safe=1">Retry Static Safe View</a>
          <a class="btn-secondary" href="${escapeHtmlText(targetUrl)}" target="_blank" rel="noopener noreferrer">Open Website Directly &nearr;</a>
        </div>
      </section>

      <form class="subbar" action="/api/browse" method="GET">
        <input type="url" name="url" value="${escapeHtmlText(targetUrl)}" placeholder="Paste any article URL from ${escapeHtmlText(hostname)} to open inside PressIndex..." required />
        <button type="submit" class="btn-primary">Load URL Here</button>
      </form>

      <section class="grid">${postsMarkup}</section>
    </div>
  </body>
</html>`;
  }

  function resolveRelativeCssUrls(css: string, baseUrl: string): string {
    if (!css) return css;
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, rawPath) => {
      const cleaned = rawPath.trim();
      if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('#')) {
        return match;
      }
      try {
        const abs = new URL(cleaned, baseUrl).toString();
        return `url(${quote || '"'}${abs}${quote || '"'})`;
      } catch {
        return match;
      }
    });
  }

  function resolveSrcsetAttr(srcset: string, baseUrl: string): string {
    return srcset
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return trimmed;
        const spaceIdx = trimmed.search(/\s/);
        const urlPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const descPart = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
        try {
          const abs = new URL(urlPart, baseUrl).toString();
          return `${abs}${descPart}`;
        } catch {
          return trimmed;
        }
      })
      .join(', ');
  }

  app.get('/api/browse', async (req, res) => {
    const rawUrl = String(req.query.url || '');
    const safeMode = req.query.safe === '1' || req.query.safe === 'true';
    const parsed = isSafePublicHttpUrl(rawUrl);
    if (!parsed) {
      res.status(400).send('Invalid or disallowed URL');
      return;
    }

    const targetUrl = parsed.toString();
    const cacheKey = `${targetUrl}::${safeMode ? 'safe' : 'full'}`;
    const cachedBrowse = browseCache.get(cacheKey);
    if (cachedBrowse && Date.now() - cachedBrowse.timestamp < BROWSE_TTL_MS) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.removeHeader('X-Frame-Options');
      res.send(cachedBrowse.html);
      return;
    }

    try {
      const resp = await fetchWithRetry(targetUrl, 8500);
      const contentType = resp.headers.get('content-type') || 'text/html';
      const finalUrl = resp.url || targetUrl;

      if (!resp.ok) {
        const fallbackHtml = await renderInSiteBroadsheetHtml(
          targetUrl,
          parsed.hostname,
          `${parsed.hostname} limits direct automated framing right now (HTTP ${resp.status}). PressIndex automatically loaded its In-Site Broadsheet Edition below so you can continue reading inside the site.`
        );
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(fallbackHtml);
        return;
      }

      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        res.redirect(finalUrl);
        return;
      }

      const html = await resp.text();
      const isBotChallenge =
        /<title>\s*(Just a moment\.\.\.|Attention Required!\s*\|\s*Cloudflare|Access denied|Verify you are human)/i.test(
          html
        ) ||
        /cf-browser-verification|cf-chl-|challenge-platform|__CF\$cv\$params/i.test(html);

      if (isBotChallenge) {
        const fallbackHtml = await renderInSiteBroadsheetHtml(
          finalUrl,
          parsed.hostname,
          `${parsed.hostname} uses automated bot verification for embedded frames. PressIndex switched cleanly to its In-Site Broadsheet Edition below.`
        );
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(fallbackHtml);
        return;
      }

      const $ = cheerio.load(html);

      // Remove frame-blocking meta tags and <base> (we resolve relative URLs explicitly so links/history never escape /api/browse)
      $(
        'base, meta[http-equiv="Content-Security-Policy"], meta[http-equiv="X-Frame-Options"], meta[http-equiv="content-security-policy"]'
      ).remove();

      // Rewrite or remove <meta http-equiv="refresh">
      $('meta[http-equiv]').each((_, el) => {
        const eq = ($(el).attr('http-equiv') || '').toLowerCase();
        if (eq === 'refresh') {
          const content = $(el).attr('content') || '';
          const urlMatch = content.match(/url\s*=\s*['"]?([^'";]+)['"]?/i);
          if (urlMatch && urlMatch[1]) {
            try {
              const abs = new URL(urlMatch[1].trim(), finalUrl).toString();
              $(el).attr('content', `0;url=/api/browse?url=${encodeURIComponent(abs)}`);
            } catch {
              $(el).remove();
            }
          } else {
            $(el).remove();
          }
        }
      });

      // Resolve static resource URLs so page styling & media work without <base>
      $('link[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('data:') || href.startsWith('#')) return;
        try {
          $(el).attr('href', new URL(href, finalUrl).toString());
        } catch {
          // ignore
        }
      });

      $('img, source, video, audio').each((_, el) => {
        const src = $(el).attr('src');
        if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
          try {
            $(el).attr('src', new URL(src, finalUrl).toString());
          } catch {
            // ignore
          }
        }
        const dataSrc = $(el).attr('data-src');
        if (dataSrc && !dataSrc.startsWith('data:')) {
          try {
            $(el).attr('data-src', new URL(dataSrc, finalUrl).toString());
          } catch {
            // ignore
          }
        }
        const poster = $(el).attr('poster');
        if (poster && !poster.startsWith('data:')) {
          try {
            $(el).attr('poster', new URL(poster, finalUrl).toString());
          } catch {
            // ignore
          }
        }
        const srcset = $(el).attr('srcset');
        if (srcset) {
          $(el).attr('srcset', resolveSrcsetAttr(srcset, finalUrl));
        }
      });

      $('style').each((_, el) => {
        const css = $(el).html();
        if (css) $(el).html(resolveRelativeCssUrls(css, finalUrl));
      });

      $('[style]').each((_, el) => {
        const st = $(el).attr('style');
        if (st && st.includes('url(')) {
          $(el).attr('style', resolveRelativeCssUrls(st, finalUrl));
        }
      });

      // Rewrite nested iframes to also proxy safely via /api/browse
      $('iframe[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (!src || src.startsWith('about:') || src.startsWith('javascript:')) return;
        try {
          const abs = new URL(src, finalUrl).toString();
          if (abs.startsWith('http://') || abs.startsWith('https://')) {
            $(el).attr('src', `/api/browse?url=${encodeURIComponent(abs)}`);
          }
        } catch {
          // ignore
        }
      });

      // Handle scripts: in safeMode strip scripts for pure static rendering; otherwise neutralize frame-busters & resolve external script src
      if (safeMode) {
        $('script').remove();
      } else {
        $('script').each((_, el) => {
          const src = $(el).attr('src');
          if (src) {
            try {
              const abs = new URL(src, finalUrl).toString();
              // Strip known frame-busting loader bundles (e.g. wordpress.com home bundle)
              if (/home\.logged-out\/page-.*\/js\/bundle\.js/i.test(abs)) {
                $(el).remove();
                return;
              }
              $(el).attr('src', abs);
            } catch {
              // ignore
            }
          } else {
            const text = $(el).html() || '';
            if (text.length < 3000 && /top\.location|parent\.location|frameElement|self\s*!==\s*top|window\.top/i.test(text)) {
              $(el).remove();
            } else if (/top\.location|parent\.location|window\.top/i.test(text)) {
              const neutralized = text
                .replace(/window\.top\.location/g, 'window.self.location')
                .replace(/\btop\.location/g, 'self.location')
                .replace(/\bparent\.location/g, 'self.location');
              $(el).html(neutralized);
            }
          }
        });
      }

      // Rewrite anchor links and form actions so clicking inside the embedded site stays inside /api/browse
      $('a').each((_, el) => {
        $(el).attr('target', '_self');
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
          return;
        }
        try {
          const abs = new URL(href, finalUrl).toString();
          if (abs.startsWith('http://') || abs.startsWith('https://')) {
            $(el).attr('href', `/api/browse?url=${encodeURIComponent(abs)}${safeMode ? '&safe=1' : ''}`);
          }
        } catch {
          // ignore
        }
      });

      $('form').each((_, el) => {
        $(el).attr('target', '_self');
        const action = $(el).attr('action');
        if (action && !action.startsWith('javascript:')) {
          try {
            $(el).attr('action', new URL(action, finalUrl).toString());
          } catch {
            // ignore
          }
        } else {
          $(el).attr('action', finalUrl);
        }
      });

      // Inject top-of-head In-Frame Navigation Guard so dynamic links, forms, window.open, and history stay inside /api/browse
      const guardScript = `
        <script data-pressindex-guard="1">
          (function () {
            var BASE_URL = ${JSON.stringify(finalUrl)};
            var SAFE_SUFFIX = ${JSON.stringify(safeMode ? '&safe=1' : '')};
            function toBrowse(raw) {
              if (!raw || typeof raw !== 'string') return null;
              if (raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return null;
              if (raw.indexOf('/api/browse?url=') !== -1) return raw;
              try {
                var abs = new URL(raw, BASE_URL).toString();
                if (abs.startsWith('http://') || abs.startsWith('https://')) {
                  return '/api/browse?url=' + encodeURIComponent(abs) + SAFE_SUFFIX;
                }
              } catch (e) {}
              return null;
            }
            document.addEventListener('click', function (e) {
              var el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
              if (!el) return;
              var raw = el.getAttribute('href');
              var proxied = toBrowse(raw);
              if (proxied && proxied !== raw) {
                e.preventDefault();
                window.location.href = proxied;
              }
            }, true);
            document.addEventListener('submit', function (e) {
              var form = e.target;
              if (!form || form.tagName !== 'FORM') return;
              var method = (form.getAttribute('method') || 'GET').toUpperCase();
              if (method === 'GET') {
                e.preventDefault();
                try {
                  var action = form.getAttribute('action') || BASE_URL;
                  var dest = new URL(action, BASE_URL);
                  var fd = new FormData(form);
                  fd.forEach(function (val, key) { dest.searchParams.set(key, String(val)); });
                  window.location.href = '/api/browse?url=' + encodeURIComponent(dest.toString()) + SAFE_SUFFIX;
                } catch (err) {}
              }
            }, true);
            try {
              window.open = function (u) {
                var p = toBrowse(String(u || ''));
                if (p) window.location.href = p;
                return window;
              };
            } catch (e) {}
            try {
              var origPush = history.pushState.bind(history);
              var origReplace = history.replaceState.bind(history);
              history.pushState = function (s, t, u) {
                try { return origPush(s, t, u); } catch (e) { return; }
              };
              history.replaceState = function (s, t, u) {
                try { return origReplace(s, t, u); } catch (e) { return; }
              };
            } catch (e) {}
            try {
              window.parent.postMessage({ type: 'pressindex:frame-ready', url: BASE_URL }, '*');
            } catch (e) {}
          })();
        </script>
      `;

      if ($('head').length > 0) {
        $('head').prepend(guardScript);
      } else {
        $.root().prepend(guardScript);
      }

      const finalHtml = $.html();
      browseCache.set(cacheKey, {timestamp: Date.now(), html: finalHtml, finalUrl});
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.removeHeader('X-Frame-Options');
      res.send(finalHtml);
    } catch {
      const fallbackHtml = await renderInSiteBroadsheetHtml(
        targetUrl,
        parsed.hostname,
        `${parsed.hostname} took too long to respond for a live frame. PressIndex opened its In-Site Broadsheet Edition below so you can read immediately.`
      );
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(fallbackHtml);
    }
  });

  // Fetch latest articles across curated blogs
  app.get('/api/feeds/latest', async (req, res) => {
    const category = String(req.query.category || '').trim();
    const targetBlogs = category && category !== 'All'
      ? CURATED_BLOGS.filter((b) => b.category === category)
      : CURATED_BLOGS.slice(0, 14);

    const results = await Promise.allSettled(
      targetBlogs.map((blog) => fetchSiteDigest(blog, 4500))
    );

    const allPosts: ArticleSummary[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const p of r.value.posts.slice(0, 3)) {
          if (p.isLive) allPosts.push(p);
        }
      }
    }

    allPosts.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });

    res.json({posts: allPosts.slice(0, 36)});
  });

  function findTopBlogsForQuery(rawQuery: string, limit = 24): Array<BlogEntry & {matchScore: number}> {
    const qLower = rawQuery.trim().toLowerCase();
    if (!qLower) return [];
    const tokens = qLower.split(/[\s,.;:!?/]+/).filter((t) => t.length >= 2);
    const expandedTokens = expandSearchTokens(tokens);
    const scored: Array<{blog: BlogEntry; score: number}> = [];
    for (const rec of SEARCH_INDEX) {
      const score = scoreRecordForQuery(rec, tokens, qLower, expandedTokens);
      if (score > 0) scored.push({blog: rec.blog, score});
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => ({...s.blog, matchScore: s.score}));
  }

  // Smart cross-site search: returns best matching blog(s) + live articles across ~30k sites
  app.get('/api/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({query: '', topBlog: null, matchingBlogs: [], matchingArticles: []});
      return;
    }

    const qLower = q.toLowerCase();
    const tokens = qLower.split(/[\s,.;:!?/]+/).filter((t) => t.length >= 2);
    const expandedTokens = expandSearchTokens(tokens);
    const metaScoreById = new Map<string, number>();
    const scoredBlogs: Array<{blog: BlogEntry; score: number}> = [];

    for (const rec of SEARCH_INDEX) {
      const score = scoreRecordForQuery(rec, tokens, qLower, expandedTokens);
      if (score > 0) {
        metaScoreById.set(rec.blog.id, score);
        scoredBlogs.push({blog: rec.blog, score});
      }
    }
    scoredBlogs.sort((a, b) => b.score - a.score);

    const matchingBlogs = scoredBlogs.slice(0, 24).map((s) => ({
      ...s.blog,
      matchScore: s.score,
    }));

    const topBlog = matchingBlogs[0] || null;

    // Ensure initial feeds are warmed (bounded to 2.5s max wait) so article searches find matches
    if (digestCache.size < 15) {
      await Promise.race([
        warmupAllFeeds(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    }

    // Fetch live posts from top 6 matching blogs (fast, cached) to surface relevant live articles too!
    const topCandidates = scoredBlogs.slice(0, 6).map((s) => s.blog);
    await Promise.allSettled(topCandidates.map((b) => fetchSiteDigest(b, 4000)));

    // Search across all cached posts (plus newly fetched topCandidates posts)
    const articleMatches: Array<ArticleSummary & {score: number}> = [];
    const articleBlogBoost = new Map<string, number>();

    for (const digest of digestCache.values()) {
      for (const post of digest.posts) {
        const titleLower = post.title.toLowerCase();
        const hay = `${titleLower} ${post.excerpt} ${post.blogName} ${post.categories.join(' ')}`.toLowerCase();
        let aScore = 0;
        if (hay.includes(qLower)) aScore += 40;
        for (const t of tokens) {
          if (titleLower.includes(t)) aScore += 20;
          else if (hay.includes(t)) aScore += 8;
        }
        if (aScore > 0) {
          articleBlogBoost.set(
            post.blogId,
            Math.max(articleBlogBoost.get(post.blogId) || 0, aScore)
          );
        }
        if (aScore === 0 && topBlog && post.blogId === topBlog.id) {
          aScore = 5;
        }
        if (aScore > 0) {
          articleMatches.push({...post, score: aScore});
        }
      }
    }

    const candidateMap = new Map<string, BlogEntry>();
    for (const s of scoredBlogs.slice(0, 80)) {
      candidateMap.set(s.blog.id, s.blog);
    }
    for (const blogId of articleBlogBoost.keys()) {
      const b = CURATED_BLOG_BY_ID.get(blogId);
      if (b) candidateMap.set(b.id, b);
    }

    const mergedBlogs = Array.from(candidateMap.values())
      .map((blog) => ({
        ...blog,
        matchScore: (metaScoreById.get(blog.id) || 0) + (articleBlogBoost.get(blog.id) || 0),
      }))
      .filter((b) => b.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 24);

    const finalTopBlog = mergedBlogs[0] || topBlog;
    articleMatches.sort((a, b) => b.score - a.score);

    res.json({
      query: q,
      topBlog: finalTopBlog,
      matchingBlogs: mergedBlogs,
      matchingArticles: articleMatches.slice(0, 24),
    });
  });

  const resolveBaseUrl = (req: express.Request): string => {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
    return `${proto}://${host}`;
  };

  const escapeAttr = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const injectBlogSeoHtml = (
    html: string,
    reqPath: string,
    baseUrl: string,
    searchQuery = ''
  ): string => {
    const blogMatch = reqPath.match(/^\/blog\/([a-z0-9-]+)\/?$/i);
    if (blogMatch) {
      const blog = CURATED_BLOG_BY_ID.get(blogMatch[1].toLowerCase());
      if (!blog) return html;

      const title = `${blog.name} – Read & Search on PressIndex`;
      const desc = `${blog.tagline} ${blog.description}`.slice(0, 158);
      const canonical = `${baseUrl}/blog/${blog.id}`;
      const keywords = [blog.name, blog.domain, blog.category, ...blog.topics].slice(0, 14).join(', ');

      let out = html
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(title)}</title>`)
        .replace(
          /<meta\s+name="description"[\s\S]*?\/>/i,
          `<meta name="description" content="${escapeAttr(desc)}" />`
        )
        .replace(
          /<meta\s+property="og:title"[\s\S]*?\/>/i,
          `<meta property="og:title" content="${escapeAttr(title)}" />`
        )
        .replace(
          /<meta\s+property="og:description"[\s\S]*?\/>/i,
          `<meta property="og:description" content="${escapeAttr(desc)}" />`
        )
        .replace(
          /<meta\s+name="twitter:title"[\s\S]*?\/>/i,
          `<meta name="twitter:title" content="${escapeAttr(title)}" />`
        )
        .replace(
          /<meta\s+name="twitter:description"[\s\S]*?\/>/i,
          `<meta name="twitter:description" content="${escapeAttr(desc)}" />`
        );

      const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: blog.name,
        description: blog.description,
        url: canonical,
        author: {'@type': 'Person', name: blog.author},
        keywords,
        mainEntityOfPage: blog.url,
        isPartOf: {
          '@type': 'WebSite',
          name: 'PressIndex',
          url: `${baseUrl}/`,
        },
      });

      out = out.replace(
        '</head>',
        `  <meta name="keywords" content="${escapeAttr(keywords)}" />\n    <link rel="canonical" href="${canonical}" />\n    <meta property="og:url" content="${canonical}" />\n    <script type="application/ld+json">${jsonLd}</script>\n  </head>`
      );

      // Inject semantic SSR digest inside #root so search engine crawlers see full topic/domain metadata immediately
      const ssrDigest = `<noscript><main><h1>${escapeHtmlText(blog.name)} (${escapeHtmlText(
        blog.domain
      )})</h1><p>${escapeHtmlText(blog.description)}</p><p>Topics: ${escapeHtmlText(
        blog.topics.join(', ')
      )}</p></main></noscript>`;
      out = out.replace('<div id="root"></div>', `<div id="root">${ssrDigest}</div>`);
      return out;
    }

    const trimmedQ = searchQuery.trim();
    if (trimmedQ) {
      const matches = findTopBlogsForQuery(trimmedQ, 12);
      const matchNames = matches.slice(0, 6).map((b) => b.name).join(', ');
      const title = `${trimmedQ} – Search Blogs & Articles on PressIndex`;
      const desc = matchNames
        ? `Read ${trimmedQ} blogs & articles inside PressIndex: ${matchNames}. Search ${CURATED_BLOGS.length.toLocaleString()}+ sites in one workspace.`
        : `Search ${trimmedQ} across ${CURATED_BLOGS.length.toLocaleString()}+ curated blogs and websites inside PressIndex.`;
      const canonical = `${baseUrl}/?q=${encodeURIComponent(trimmedQ)}`;

      let out = html
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(title)}</title>`)
        .replace(
          /<meta\s+name="description"[\s\S]*?\/>/i,
          `<meta name="description" content="${escapeAttr(desc.slice(0, 158))}" />`
        )
        .replace(
          /<meta\s+property="og:title"[\s\S]*?\/>/i,
          `<meta property="og:title" content="${escapeAttr(title)}" />`
        )
        .replace(
          /<meta\s+property="og:description"[\s\S]*?\/>/i,
          `<meta property="og:description" content="${escapeAttr(desc.slice(0, 158))}" />`
        )
        .replace(
          /<meta\s+name="twitter:title"[\s\S]*?\/>/i,
          `<meta name="twitter:title" content="${escapeAttr(title)}" />`
        )
        .replace(
          /<meta\s+name="twitter:description"[\s\S]*?\/>/i,
          `<meta name="twitter:description" content="${escapeAttr(desc.slice(0, 158))}" />`
        );

      const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SearchResultsPage',
        name: title,
        url: canonical,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: matches.length,
          itemListElement: matches.map((b, idx) => ({
            '@type': 'ListItem',
            position: idx + 1,
            name: b.name,
            url: `${baseUrl}/blog/${b.id}`,
          })),
        },
      });

      out = out.replace(
        '</head>',
        `  <link rel="canonical" href="${canonical}" />\n    <meta property="og:url" content="${canonical}" />\n    <script type="application/ld+json">${jsonLd}</script>\n  </head>`
      );

      if (matches.length > 0) {
        const listMarkup = matches
          .map(
            (b) =>
              `<li><a href="/blog/${escapeHtmlText(b.id)}">${escapeHtmlText(
                b.name
              )} (${escapeHtmlText(b.domain)})</a> — ${escapeHtmlText(b.tagline)}</li>`
          )
          .join('');
        out = out.replace(
          '<div id="root"></div>',
          `<div id="root"><noscript><main><h1>Search results for ${escapeHtmlText(
            trimmedQ
          )} on PressIndex</h1><ul>${listMarkup}</ul></main></noscript></div>`
        );
      }
      return out;
    }

    // Homepage SEO + WebSite SearchAction schema so Google understands PressIndex topic search
    const canonical = `${baseUrl}/`;
    const homeLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'PressIndex',
      url: canonical,
      description: `Curated atlas and in-site reader indexing ${CURATED_BLOGS.length.toLocaleString()}+ blogs, websites, and articles.`,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${baseUrl}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    });
    return html.replace(
      '</head>',
      `  <link rel="canonical" href="${canonical}" />\n    <meta property="og:url" content="${canonical}" />\n    <script type="application/ld+json">${homeLd}</script>\n  </head>`
    );
  };

  app.get('/robots.txt', (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    const urls = [
      `${baseUrl}/`,
      ...CURATED_BLOGS.map((b) => `${baseUrl}/blog/${b.id}`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
  });

  // Vite dev middleware or static dist serving
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.get(/^(\/|\/blog\/[a-z0-9-]+\/?|\/read\/?)$/i, async (req, res, next) => {
      try {
        const rawHtml = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const searchQ = typeof req.query.q === 'string' ? req.query.q : '';
        const seoHtml = injectBlogSeoHtml(transformed, req.path, resolveBaseUrl(req), searchQ);
        res.status(200).set({'Content-Type': 'text/html'}).end(seoHtml);
      } catch (e) {
        next(e);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const rawHtml = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
      const searchQ = typeof req.query.q === 'string' ? req.query.q : '';
      const seoHtml = injectBlogSeoHtml(rawHtml, req.path, resolveBaseUrl(req), searchQ);
      res.status(200).set({'Content-Type': 'text/html'}).send(seoHtml);
    });
  }

  let warmupPromise: Promise<unknown> | null = null;
  function warmupAllFeeds() {
    if (!warmupPromise) {
      const feedBlogs = CURATED_BLOGS.filter((b) => Boolean(b.feedUrl)).slice(0, 36);
      warmupPromise = Promise.allSettled(
        feedBlogs.map((blog) => fetchSiteDigest(blog, 4500))
      );
    }
    return warmupPromise;
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PressIndex server running on http://0.0.0.0:${PORT}`);
    // Gently pre-warm live feeds in the background so article-level search works immediately
    void warmupAllFeeds();
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
