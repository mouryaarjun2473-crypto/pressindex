import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ArrowRight,
  Bookmark,
  BookOpen,
  Globe,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {AddSiteModal} from './components/AddSiteModal';
import {type ActiveNav, Header} from './components/Header';
import {
  type SearchBlogMatch,
  SearchResultsSection,
} from './components/SearchResultsSection';
import {SiteWorkspace} from './components/SiteWorkspace';
import {
  type ArticleSummary,
  BLOG_CATEGORIES,
  type BlogCategory,
  type BlogEntry,
  CURATED_BLOGS,
} from './data/blogs';

const HERO_IMAGE = '/src/assets/images/editorial_press_hero_1794886921149.jpg';
const TECH_IMAGE = '/src/assets/images/editorial_tech_web_1794886921520.jpg';
const CULTURE_IMAGE = '/src/assets/images/editorial_curiosity_culture_1794886921979.jpg';

const QUICK_SEARCH_TOPICS = [
  'Web Design & CSS',
  'Blogging & SEO',
  'Google Scripts',
  'Gadgets',
  'DIY Projects',
  'Trivia & History',
  'Productivity & Emacs',
  'Politics & Law',
];

const SAVED_STORAGE_KEY = 'pressindex_saved_blog_ids_v1';
const CUSTOM_SITES_KEY = 'pressindex_custom_blogs_v1';

export default function App() {
  const [activeNav, setActiveNav] = useState<ActiveNav>('directory');
  const [selectedCategory, setSelectedCategory] = useState<'All' | BlogCategory>('All');
  const [visibleCount, setVisibleCount] = useState(45);
  const [aboutVisibleCount, setAboutVisibleCount] = useState(60);
  const [aboutFilter, setAboutFilter] = useState('');

  // Custom added sites persisted in localStorage
  const [customBlogs, setCustomBlogs] = useState<BlogEntry[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_SITES_KEY);
      return raw ? (JSON.parse(raw) as BlogEntry[]) : [];
    } catch {
      return [];
    }
  });

  // Saved/bookmarked blog IDs persisted in localStorage
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const allBlogs = useMemo(
    () => [...customBlogs, ...CURATED_BLOGS],
    [customBlogs]
  );

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    topBlog: SearchBlogMatch | null;
    matchingBlogs: SearchBlogMatch[];
    matchingArticles: ArticleSummary[];
  }>({
    topBlog: null,
    matchingBlogs: [],
    matchingArticles: [],
  });

  // Live Feed state
  const [feedPosts, setFeedPosts] = useState<ArticleSummary[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedLoadedOnce, setFeedLoadedOnce] = useState(false);

  // Open Site Workspace state
  const [workspaceTarget, setWorkspaceTarget] = useState<{
    blog: BlogEntry;
    articleUrl?: string;
    mode: 'reader' | 'live';
  } | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedIds));
    } catch {
      // ignore storage errors
    }
  }, [savedIds]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_SITES_KEY, JSON.stringify(customBlogs));
    } catch {
      // ignore storage errors
    }
  }, [customBlogs]);

  const toggleSaveBlog = useCallback((blogId: string) => {
    setSavedIds((prev) =>
      prev.includes(blogId) ? prev.filter((id) => id !== blogId) : [...prev, blogId]
    );
  }, []);

  const openAnyUrlInsideSite = useCallback(
    (rawUrl: string) => {
      try {
        const parsed = new URL(rawUrl);
        const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
        const matched = allBlogs.find(
          (b) => b.domain.replace(/^www\./, '').toLowerCase() === hostname
        );
        const label = hostname.split('.')[0] || hostname;
        const fallbackBlog: BlogEntry = matched || {
          id: `ext-${hostname}`,
          name: label.charAt(0).toUpperCase() + label.slice(1),
          url: `${parsed.protocol}//${parsed.host}/`,
          domain: hostname,
          category: 'Tech & Web',
          author: hostname,
          established: 'Web',
          tagline: `Reading article directly inside PressIndex from ${hostname}`,
          description: `In-site reader view for ${parsed.toString()}`,
          topics: [hostname],
          accentHex: '#1E3A8A',
          monogram: label.slice(0, 2).toUpperCase(),
        };
        setWorkspaceTarget({
          blog: fallbackBlog,
          articleUrl: parsed.toString(),
          mode: 'reader',
        });
        window.history.pushState(
          {},
          '',
          `/read?url=${encodeURIComponent(parsed.toString())}`
        );
        document.title = `${fallbackBlog.name} – Article Reader on PressIndex`;
      } catch {
        // ignore invalid URL
      }
    },
    [allBlogs]
  );

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        setSubmittedQuery('');
        return;
      }

      // If user pasted any website/article URL into search, open it directly inside PressIndex
      if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
        const normalized = /^https?:\/\//i.test(trimmed)
          ? trimmed
          : `https://${trimmed}`;
        openAnyUrlInsideSite(normalized);
        return;
      }

      setSubmittedQuery(trimmed);
      setSearchLoading(true);
      setActiveNav('directory');
      window.history.replaceState({}, '', `/?q=${encodeURIComponent(trimmed)}`);
      document.title = `${trimmed} – Search Blogs & Articles on PressIndex`;

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setSearchResult({
          topBlog: data.topBlog || null,
          matchingBlogs: Array.isArray(data.matchingBlogs) ? data.matchingBlogs : [],
          matchingArticles: Array.isArray(data.matchingArticles)
            ? data.matchingArticles
            : [],
        });
      } catch {
        // Graceful client-side fallback if offline/error
        const qLower = trimmed.toLowerCase();
        const localMatches: SearchBlogMatch[] = allBlogs
          .filter((b) => {
            const hay = `${b.name} ${b.domain} ${b.tagline} ${b.description} ${b.topics.join(' ')}`.toLowerCase();
            return hay.includes(qLower);
          })
          .slice(0, 24)
          .map((b) => ({...b, matchScore: 50}));

        setSearchResult({
          topBlog: localMatches[0] || null,
          matchingBlogs: localMatches,
          matchingArticles: [],
        });
      } finally {
        setSearchLoading(false);
      }
    },
    [allBlogs, openAnyUrlInsideSite]
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(searchInput);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSubmittedQuery('');
    if (window.location.search.includes('q=')) {
      window.history.replaceState({}, '', '/');
    }
    document.title = 'PressIndex – Curated Blog Atlas & In-Site Reader';
  };

  const loadLatestFeed = useCallback(async (category?: 'All' | BlogCategory) => {
    setFeedLoading(true);
    try {
      const catParam = category && category !== 'All' ? `?category=${encodeURIComponent(category)}` : '';
      const res = await fetch(`/api/feeds/latest${catParam}`);
      const data = await res.json();
      setFeedPosts(Array.isArray(data.posts) ? data.posts : []);
      setFeedLoadedOnce(true);
    } catch {
      setFeedPosts([]);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeNav === 'feed' && !feedLoadedOnce) {
      loadLatestFeed(selectedCategory);
    }
  }, [activeNav, feedLoadedOnce, loadLatestFeed, selectedCategory]);

  const openBlogInWorkspace = useCallback((blog: BlogEntry, mode: 'reader' | 'live' = 'reader') => {
    setWorkspaceTarget({blog, mode});
    if (!blog.id.startsWith('custom-')) {
      window.history.pushState({}, '', `/blog/${blog.id}`);
      document.title = `${blog.name} – Read & Search on PressIndex`;
    }
  }, []);

  const closeWorkspace = useCallback(() => {
    setWorkspaceTarget(null);
    if (
      window.location.pathname.startsWith('/blog/') ||
      window.location.pathname.startsWith('/read')
    ) {
      window.history.pushState({}, '', '/');
    }
    document.title = 'PressIndex – Curated Blog Atlas & In-Site Reader';
  }, []);

  // Support direct /blog/:id, /read?url=..., and /?q=... links
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);

      if (window.location.pathname.startsWith('/read')) {
        const readUrl = params.get('url');
        if (readUrl) {
          openAnyUrlInsideSite(readUrl);
          return;
        }
      }

      const pathMatch = window.location.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/i);
      if (pathMatch) {
        const matched = allBlogs.find((b) => b.id === pathMatch[1].toLowerCase());
        if (matched) {
          setWorkspaceTarget({blog: matched, mode: 'reader'});
          document.title = `${matched.name} – Read & Search on PressIndex`;
          return;
        }
      } else {
        setWorkspaceTarget(null);
        document.title = 'PressIndex – Curated Blog Atlas & In-Site Reader';
      }

      const urlQuery = params.get('q');
      if (urlQuery && urlQuery.trim()) {
        setSearchInput(urlQuery.trim());
        void runSearch(urlQuery.trim());
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [allBlogs, openAnyUrlInsideSite, runSearch]);

  const openArticleInWorkspace = (article: ArticleSummary) => {
    const matchedBlog =
      allBlogs.find((b) => b.id === article.blogId) ||
      ({
        id: article.blogId,
        name: article.blogName,
        url: article.blogUrl,
        domain: article.blogDomain,
        category: 'Tech & Web',
        author: article.author,
        established: 'Web',
        tagline: article.excerpt,
        description: article.excerpt,
        topics: article.categories,
        accentHex: '#1E3A8A',
        monogram: article.blogName.slice(0, 2).toUpperCase(),
      } satisfies BlogEntry);

    setWorkspaceTarget({
      blog: matchedBlog,
      articleUrl: article.link,
      mode: 'reader',
    });
    window.history.pushState(
      {},
      '',
      `/read?url=${encodeURIComponent(article.link)}`
    );
    document.title = `${article.title} – PressIndex`;
  };

  const handleAddAndOpenCustomSite = (blog: BlogEntry, saveToDir: boolean) => {
    if (saveToDir) {
      setCustomBlogs((prev) => [blog, ...prev]);
    }
    setWorkspaceTarget({blog, mode: 'reader'});
  };

  const filteredDirectoryBlogs = useMemo(() => {
    if (selectedCategory === 'All') return allBlogs;
    return allBlogs.filter((b) => b.category === selectedCategory);
  }, [allBlogs, selectedCategory]);

  const savedBlogs = useMemo(
    () => allBlogs.filter((b) => savedIds.includes(b.id)),
    [allBlogs, savedIds]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#141413]">
      <Header
        activeNav={activeNav}
        onSelectNav={(nav) => {
          setActiveNav(nav);
          if (nav !== 'directory') {
            setSubmittedQuery('');
          }
        }}
        onOpenAddSite={() => setIsAddModalOpen(true)}
        savedCount={savedBlogs.length}
      />

      <main className="flex-1">
        {/* Hero Masthead & Unified Topic Search (shown on Directory view) */}
        {activeNav === 'directory' && (
          <section className="border-b border-stone-200 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
                {/* Left Column: Headline & Topic Search Anchor */}
                <div className="lg:col-span-7 flex flex-col justify-center">
                  <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">
                    Curated Web Atlas · {allBlogs.length} Publications Indexed
                  </p>
                  <h1 className="font-serif text-3xl sm:text-5xl font-bold text-[#141413] tracking-tight leading-[1.12] mb-4 max-w-2xl">
                    Read Every Blog Inside One Editorial Workspace.
                  </h1>
                  <p className="text-base sm:text-lg text-stone-600 leading-relaxed max-w-xl mb-7">
                    Open any of these {allBlogs.length} blogs, publishing platforms, and news sites directly inside PressIndex in Clean Reader or Live Site Frame, or search any topic or article URL to read it right here.
                  </p>

                  {/* Search Form */}
                  <form onSubmit={handleSearchSubmit} className="max-w-2xl">
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <div className="relative flex-1">
                        <Search
                          className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="search"
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          placeholder="Search any topic or blog (e.g. copywriting, CSS, emacs, gadgets, DIY)..."
                          aria-label="Search blogs and topics"
                          className="w-full pl-10 pr-9 py-3 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg text-[#141413] placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A] focus:ring-1 focus:ring-[#1E3A8A]"
                        />
                        {searchInput && (
                          <button
                            type="button"
                            onClick={clearSearch}
                            aria-label="Clear search"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <button
                        type="submit"
                        className="px-6 py-3 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Find Matching Blog
                      </button>
                    </div>
                  </form>

                  {/* Quick topic suggestions (functional filter buttons) */}
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-stone-500">
                    <span className="font-medium text-stone-700">Try topic:</span>
                    {QUICK_SEARCH_TOPICS.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => {
                          setSearchInput(topic);
                          runSearch(topic);
                        }}
                        className="text-stone-600 hover:text-[#1E3A8A] underline decoration-stone-300 underline-offset-4 hover:decoration-[#1E3A8A] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right Column: Editorial Archive Image */}
                <div className="lg:col-span-5 flex flex-col">
                  <figure className="flex-1 flex flex-col rounded-xl overflow-hidden border border-stone-200 bg-stone-100">
                    <div className="relative flex-1 min-h-[240px] bg-gradient-to-br from-stone-200 to-stone-100">
                      <img
                        src={HERO_IMAGE}
                        alt="Archival broadsheets, bound journals, and movable type blocks on a limestone desk"
                        className="w-full h-full lg:h-full object-cover"
                      />
                    </div>
                    <figcaption className="px-4 py-2.5 bg-[#FAF9F6] border-t border-stone-200 text-xs font-serif italic text-stone-500">
                      Fig. 1 — Independent web publications indexed for in-site reading and cross-topic discovery.
                    </figcaption>
                  </figure>
                </div>
              </div>

              {/* Full-Width 4-Column Operational Summary Strip */}
              <div className="mt-10 pt-6 border-t border-stone-200 grid grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <div className="font-mono text-xl sm:text-2xl font-medium tabular-nums text-[#141413]">
                    {allBlogs.length}
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    Curated Blogs &amp; Sites Indexed
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xl sm:text-2xl font-medium tabular-nums text-[#141413]">
                    2 Modes
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    Clean Reader &amp; Live Site Frame
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xl sm:text-2xl font-medium tabular-nums text-[#141413]">
                    {BLOG_CATEGORIES.length} Desks
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    Tech, Blogging, Culture, DIY, Policy
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xl sm:text-2xl font-medium tabular-nums text-[#141413]">
                    Live RSS
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    Real-Time Article &amp; Topic Search
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Active Search Results Section */}
        {activeNav === 'directory' && submittedQuery && (
          <SearchResultsSection
            query={submittedQuery}
            loading={searchLoading}
            topBlog={searchResult.topBlog}
            matchingBlogs={searchResult.matchingBlogs}
            matchingArticles={searchResult.matchingArticles}
            onOpenBlog={openBlogInWorkspace}
            onOpenArticle={openArticleInWorkspace}
            onClearSearch={clearSearch}
          />
        )}

        {/* Full Directory Grid (when no search is active) */}
        {activeNav === 'directory' && !submittedQuery && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
            {/* Editorial Desk Spotlights */}
            <section aria-label="Curatorial Desks">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('Tech & Web')}
                  className="group text-left bg-white border border-stone-200 rounded-xl overflow-hidden hover:border-stone-300 transition-colors cursor-pointer grid grid-cols-1 sm:grid-cols-12 items-stretch"
                >
                  <div className="sm:col-span-5 min-h-[160px] bg-stone-100">
                    <img
                      src={TECH_IMAGE}
                      alt="Drafting compass, blueprint grid, and cobalt ink for Tech and Web publications"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="sm:col-span-7 p-5 flex flex-col justify-between">
                    <div>
                      <p className="text-xs text-stone-500 mb-1">
                        Editorial Desk · {allBlogs.filter((b) => b.category === 'Tech & Web').length} Publications
                      </p>
                      <h2 className="font-serif text-xl font-semibold text-[#141413] group-hover:text-[#1E3A8A] transition-colors mb-2">
                        Tech, Web Craft &amp; Guides
                      </h2>
                      <p className="text-sm text-stone-600 line-clamp-2">
                        Smashing Magazine, DEV Community, CSS-Tricks, freeCodeCamp, GeeksforGeeks, and Labnol.
                      </p>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A8A]">
                      <span>Filter Tech &amp; Web</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedCategory('Culture & Curiosity')}
                  className="group text-left bg-white border border-stone-200 rounded-xl overflow-hidden hover:border-stone-300 transition-colors cursor-pointer grid grid-cols-1 sm:grid-cols-12 items-stretch"
                >
                  <div className="sm:col-span-5 min-h-[160px] bg-stone-100">
                    <img
                      src={CULTURE_IMAGE}
                      alt="Archival index cards, reading magnifier, and field notebooks for Culture and Curiosity blogs"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="sm:col-span-7 p-5 flex flex-col justify-between">
                    <div>
                      <p className="text-xs text-stone-500 mb-1">
                        Editorial Desk · {allBlogs.filter((b) => b.category === 'Culture & Curiosity').length} Publications
                      </p>
                      <h2 className="font-serif text-xl font-semibold text-[#141413] group-hover:text-[#1E3A8A] transition-colors mb-2">
                        Culture, History &amp; Oddities
                      </h2>
                      <p className="text-sm text-stone-600 line-clamp-2">
                        Kottke.org, Boing Boing, Mental Floss, Neatorama, Reddit, Goodreads, and Issuu.
                      </p>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A8A]">
                      <span>Filter Culture &amp; Curiosity</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </button>
              </div>
            </section>

            {/* Category Filter Toolbar + Complete Directory */}
            <section aria-label="Publication Directory">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="font-serif text-2xl font-bold text-[#141413]">
                    Complete Publication Directory
                  </h2>
                  <p className="text-sm text-stone-600 mt-0.5">
                    Select any site below to open and read it directly inside PressIndex.
                  </p>
                </div>

                <div
                  role="tablist"
                  aria-label="Filter blogs by category"
                  className="flex items-center gap-1 p-1 bg-stone-200/70 rounded-lg overflow-x-auto max-w-full"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === 'All'}
                    onClick={() => {
                      setSelectedCategory('All');
                      setVisibleCount(45);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedCategory === 'All'
                        ? 'bg-white text-[#141413] shadow-sm'
                        : 'text-stone-600 hover:text-[#141413]'
                    }`}
                  >
                    All ({allBlogs.length})
                  </button>
                  {BLOG_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={selectedCategory === cat}
                      onClick={() => {
                        setSelectedCategory(cat);
                        setVisibleCount(45);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedCategory === cat
                          ? 'bg-white text-[#141413] shadow-sm'
                          : 'text-stone-600 hover:text-[#141413]'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredDirectoryBlogs.slice(0, visibleCount).map((blog) => {
                  const isSaved = savedIds.includes(blog.id);
                  return (
                    <article
                      key={blog.id}
                      className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between hover:border-stone-300 transition-colors"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-xs font-bold font-mono shrink-0"
                              style={{backgroundColor: blog.accentHex}}
                              aria-hidden="true"
                            >
                              {blog.monogram}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs text-stone-500 truncate">
                                {blog.category} · <span className="font-mono">{blog.domain}</span>
                              </div>
                              <h3 className="font-serif text-lg font-bold text-[#141413] truncate">
                                <button
                                  type="button"
                                  onClick={() => openBlogInWorkspace(blog, 'reader')}
                                  className="hover:text-[#1E3A8A] transition-colors cursor-pointer text-left"
                                >
                                  {blog.name}
                                </button>
                              </h3>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleSaveBlog(blog.id)}
                            aria-label={isSaved ? `Remove ${blog.name} from saved` : `Save ${blog.name}`}
                            className={`p-1.5 rounded-md transition-colors shrink-0 cursor-pointer ${
                              isSaved
                                ? 'text-[#1E3A8A] bg-[#1E3A8A]/10'
                                : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'
                            }`}
                          >
                            <Bookmark
                              className="w-4 h-4"
                              fill={isSaved ? 'currentColor' : 'none'}
                              aria-hidden="true"
                            />
                          </button>
                        </div>

                        <p className="text-sm text-stone-600 leading-relaxed line-clamp-2 mb-3">
                          {blog.tagline}
                        </p>

                        <p className="text-xs text-stone-400 truncate">
                          {blog.topics.slice(0, 5).join(' · ')}
                        </p>
                      </div>

                      <div className="mt-4 pt-3.5 border-t border-stone-100 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openBlogInWorkspace(blog, 'reader')}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A8A] hover:underline whitespace-nowrap cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Open Inside Site</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openBlogInWorkspace(blog, 'live')}
                          className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-[#141413] whitespace-nowrap cursor-pointer"
                        >
                          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Live Frame</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {filteredDirectoryBlogs.length > visibleCount && (
                <div className="mt-8 pt-6 border-t border-stone-200 flex flex-wrap items-center justify-between gap-4">
                  <span className="text-xs font-mono tabular-nums text-stone-500">
                    Showing {Math.min(visibleCount, filteredDirectoryBlogs.length)} of{' '}
                    {filteredDirectoryBlogs.length} publications
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((c) => c + 45)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors cursor-pointer"
                    >
                      Show 45 More
                    </button>
                    {filteredDirectoryBlogs.length <= 500 ? (
                      <button
                        type="button"
                        onClick={() => setVisibleCount(filteredDirectoryBlogs.length)}
                        className="px-4 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg transition-colors cursor-pointer"
                      >
                        Show All ({filteredDirectoryBlogs.length})
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setVisibleCount((c) => c + 150)}
                        className="px-4 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg transition-colors cursor-pointer"
                      >
                        Show +150 More
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Live Feed View */}
        {activeNav === 'feed' && (
          <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-stone-200 mb-8">
              <div>
                <p className="text-xs uppercase tracking-widest text-stone-500 mb-1">
                  Cross-Publication Stream
                </p>
                <h1 className="font-serif text-3xl font-bold text-[#141413]">
                  Latest Dispatches Across All Blogs
                </h1>
              </div>

              <button
                type="button"
                onClick={() => loadLatestFeed(selectedCategory)}
                disabled={feedLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${feedLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Refresh Feed</span>
              </button>
            </div>

            {feedLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="bg-white border border-stone-200 rounded-xl p-6 space-y-3"
                  >
                    <div className="h-3 bg-stone-200 rounded w-1/4 animate-pulse" />
                    <div className="h-6 bg-stone-200 rounded w-2/3 animate-pulse" />
                    <div className="h-4 bg-stone-200/70 rounded w-full animate-pulse" />
                  </div>
                ))}
              </div>
            ) : feedPosts.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-xl p-10 text-center">
                <p className="text-sm text-stone-600 mb-4">
                  No live feed entries loaded yet. Try refreshing or open any site directly from the Directory.
                </p>
                <button
                  type="button"
                  onClick={() => loadLatestFeed('All')}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] rounded-lg cursor-pointer"
                >
                  Load All Feeds
                </button>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-200">
                {feedPosts.map((post) => (
                  <article
                    key={post.id}
                    className="p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-stone-50/70 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1.5">
                        <span className="font-semibold text-[#1E3A8A]">{post.blogName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{post.author}</span>
                        {post.pubDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {new Date(post.pubDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </>
                        )}
                      </div>
                      <h2 className="font-serif text-xl font-semibold text-[#141413] leading-snug mb-2">
                        <button
                          type="button"
                          onClick={() => openArticleInWorkspace(post)}
                          className="text-left hover:text-[#1E3A8A] transition-colors cursor-pointer"
                        >
                          {post.title}
                        </button>
                      </h2>
                      <p className="text-sm text-stone-600 line-clamp-2 leading-relaxed">
                        {post.excerpt}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => openArticleInWorkspace(post)}
                      className="px-4 py-2 text-xs font-semibold text-[#1E3A8A] bg-[#1E3A8A]/8 hover:bg-[#1E3A8A]/15 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      Read Inside Site
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Saved Publications View */}
        {activeNav === 'saved' && (
          <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="pb-6 border-b border-stone-200 mb-8">
              <p className="text-xs uppercase tracking-widest text-stone-500 mb-1">
                Personal Reading Shelf
              </p>
              <h1 className="font-serif text-3xl font-bold text-[#141413]">
                Saved Publications ({savedBlogs.length})
              </h1>
            </div>

            {savedBlogs.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-xl p-12 text-center">
                <Bookmark className="w-8 h-8 text-stone-300 mx-auto mb-3" aria-hidden="true" />
                <h2 className="font-serif text-xl font-semibold text-[#141413] mb-2">
                  Your Reading Shelf Is Empty
                </h2>
                <p className="text-sm text-stone-600 max-w-md mx-auto mb-6">
                  Bookmark any of the {allBlogs.length.toLocaleString()} curated sites in the Directory to keep them ready for quick daily reading.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveNav('directory')}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg cursor-pointer"
                >
                  Explore Directory
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {savedBlogs.map((blog) => (
                  <div
                    key={blog.id}
                    className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xs text-stone-500">
                          {blog.category} · <span className="font-mono">{blog.domain}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleSaveBlog(blog.id)}
                          className="text-xs text-stone-500 hover:text-red-700 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                      <h3 className="font-serif text-xl font-bold text-[#141413] mb-1.5">
                        {blog.name}
                      </h3>
                      <p className="text-sm text-stone-600 mb-4">{blog.tagline}</p>
                    </div>

                    <div className="pt-3 border-t border-stone-100 flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => openBlogInWorkspace(blog, 'reader')}
                        className="text-xs font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                      >
                        Open Clean Reader
                      </button>
                      <button
                        type="button"
                        onClick={() => openBlogInWorkspace(blog, 'live')}
                        className="text-xs font-medium text-stone-600 hover:text-[#141413] cursor-pointer"
                      >
                        Live Site Frame
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* About & Complete A-Z URL Index View */}
        {activeNav === 'about' && (
          <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
            <div className="bg-white border border-stone-200 rounded-xl p-6 sm:p-8">
              <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">
                About PressIndex
              </p>
              <h1 className="font-serif text-3xl font-bold text-[#141413] mb-4">
                How All {allBlogs.length} Sites Open Inside One Unified Reader
              </h1>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-stone-600 leading-relaxed">
                <div>
                  <h2 className="font-serif text-lg font-semibold text-[#141413] mb-1.5">
                    01. Clean Reader Extraction
                  </h2>
                  <p>
                    Fetches each site&rsquo;s live RSS, Atom, or homepage headlines and strips navigation clutter so every article reads like a clean broadsheet essay right inside PressIndex.
                  </p>
                </div>
                <div>
                  <h2 className="font-serif text-lg font-semibold text-[#141413] mb-1.5">
                    02. Live Site Frame Proxy
                  </h2>
                  <p>
                    When you want to browse a publication&rsquo;s original layout inside this website, the built-in proxy renders the live site in an embedded viewport with in-site link navigation.
                  </p>
                </div>
                <div>
                  <h2 className="font-serif text-lg font-semibold text-[#141413] mb-1.5">
                    03. Topic-to-Blog Search
                  </h2>
                  <p>
                    Searching for any subject automatically ranks and surfaces the best matching publication along with related blogs and live articles from across the index.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="font-serif text-xl font-semibold text-[#141413]">
                  Complete Indexed Source List ({allBlogs.length})
                </h2>
                <input
                  type="text"
                  value={aboutFilter}
                  onChange={(e) => {
                    setAboutFilter(e.target.value);
                    setAboutVisibleCount(60);
                  }}
                  placeholder="Filter sources by name, domain, or category..."
                  aria-label="Filter indexed sources"
                  className="w-full sm:w-72 px-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg text-[#141413] placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>
              {(() => {
                const q = aboutFilter.trim().toLowerCase();
                const filteredSources = q
                  ? allBlogs.filter(
                      (b) =>
                        b.name.toLowerCase().includes(q) ||
                        b.domain.toLowerCase().includes(q) ||
                        b.category.toLowerCase().includes(q)
                    )
                  : allBlogs;
                const shownSources = filteredSources.slice(0, aboutVisibleCount);
                return (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500 uppercase tracking-wider">
                            <th className="py-3 px-6 font-medium">Publication</th>
                            <th className="py-3 px-4 font-medium">Category</th>
                            <th className="py-3 px-4 font-medium">URL</th>
                            <th className="py-3 px-6 font-medium text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200">
                          {shownSources.map((blog) => (
                            <tr key={blog.id} className="hover:bg-stone-50/70">
                              <td className="py-3 px-6 font-medium text-[#141413]">
                                {blog.name}
                              </td>
                              <td className="py-3 px-4 text-stone-600">{blog.category}</td>
                              <td className="py-3 px-4 font-mono text-xs text-stone-500">
                                {blog.url}
                              </td>
                              <td className="py-3 px-6 text-right">
                                <button
                                  type="button"
                                  onClick={() => openBlogInWorkspace(blog, 'reader')}
                                  className="text-xs font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                                >
                                  Open Inside Site
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {filteredSources.length > shownSources.length && (
                      <div className="px-6 py-4 border-t border-stone-200 bg-stone-50/60 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-stone-500">
                          Showing {shownSources.length} of {filteredSources.length} sources
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setAboutVisibleCount((c) => c + 100)}
                            className="px-3.5 py-1.5 text-xs font-medium bg-white border border-stone-200 rounded-lg text-[#141413] hover:bg-stone-100 cursor-pointer"
                          >
                            Show 100 More
                          </button>
                          {filteredSources.length <= 1000 ? (
                            <button
                              type="button"
                              onClick={() => setAboutVisibleCount(filteredSources.length)}
                              className="px-3.5 py-1.5 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                            >
                              Show All ({filteredSources.length})
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAboutVisibleCount((c) => c + 500)}
                              className="px-3.5 py-1.5 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                            >
                              Show +500 More
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </section>
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-stone-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-500">
          <div className="flex items-center gap-2">
            <span className="font-serif font-semibold text-sm text-[#141413]">
              PressIndex
            </span>
            <span aria-hidden="true">·</span>
            <span>Curated Blog Atlas &amp; In-Site Reader</span>
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveNav('directory')}
              className="hover:text-[#141413] cursor-pointer"
            >
              Directory
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('feed')}
              className="hover:text-[#141413] cursor-pointer"
            >
              Live Feed
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('about')}
              className="hover:text-[#141413] cursor-pointer"
            >
              All {allBlogs.length} Sources
            </button>
          </div>
        </div>
      </footer>

      {/* In-Site Workspace Overlay */}
      {workspaceTarget && (
        <SiteWorkspace
          blog={workspaceTarget.blog}
          initialArticleUrl={workspaceTarget.articleUrl}
          initialMode={workspaceTarget.mode}
          isSaved={savedIds.includes(workspaceTarget.blog.id)}
          onToggleSave={toggleSaveBlog}
          onClose={closeWorkspace}
        />
      )}

      {/* Custom Site URL Modal */}
      <AddSiteModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddAndOpen={handleAddAndOpenCustomSite}
      />
    </div>
  );
}
