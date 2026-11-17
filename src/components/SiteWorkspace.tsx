import React, {useEffect, useRef, useState} from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  ExternalLink,
  Globe,
  RefreshCw,
} from 'lucide-react';
import type {ArticleSummary, BlogEntry} from '../data/blogs';

interface ExtractedArticle {
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
}

interface SiteWorkspaceProps {
  blog: BlogEntry;
  initialArticleUrl?: string;
  initialMode?: 'reader' | 'live';
  isSaved: boolean;
  onToggleSave: (blogId: string) => void;
  onClose: () => void;
}

function formatReadableDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 20);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const SiteWorkspace: React.FC<SiteWorkspaceProps> = ({
  blog,
  initialArticleUrl,
  initialMode = 'reader',
  isSaved,
  onToggleSave,
  onClose,
}) => {
  const [mode, setMode] = useState<'reader' | 'live'>(initialMode);
  const [digestLoading, setDigestLoading] = useState(true);
  const [posts, setPosts] = useState<ArticleSummary[]>([]);
  const [digestNotice, setDigestNotice] = useState<string | undefined>();

  const [articleHistory, setArticleHistory] = useState<string[]>(
    initialArticleUrl ? [initialArticleUrl] : []
  );
  const currentArticleUrl = articleHistory[articleHistory.length - 1] || null;

  const [articleLoading, setArticleLoading] = useState(false);
  const [articleData, setArticleData] = useState<ExtractedArticle | null>(null);
  const [articleError, setArticleError] = useState<string | null>(null);

  const [liveUrl, setLiveUrl] = useState(initialArticleUrl || blog.url);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [safeFrameMode, setSafeFrameMode] = useState(false);
  const [frameBlockedFallback, setFrameBlockedFallback] = useState(false);

  const proseRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Fetch site digest
  useEffect(() => {
    let cancelled = false;
    setDigestLoading(true);
    setDigestNotice(undefined);
    setFrameBlockedFallback(false);

    fetch(`/api/site-digest?url=${encodeURIComponent(blog.url)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPosts(Array.isArray(data.posts) ? data.posts : []);
        setDigestNotice(data.notice);
      })
      .catch(() => {
        if (cancelled) return;
        setDigestNotice('Unable to reach live feed right now. Try Live Site Frame or open the website directly.');
      })
      .finally(() => {
        if (!cancelled) setDigestLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [blog.url]);

  // Fetch specific article when selected
  useEffect(() => {
    if (!currentArticleUrl) {
      setArticleData(null);
      setArticleError(null);
      return;
    }

    let cancelled = false;
    setArticleLoading(true);
    setArticleError(null);

    fetch(`/api/article?url=${encodeURIComponent(currentArticleUrl)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Could not extract article.');
        }
        return json as ExtractedArticle;
      })
      .then((data) => {
        if (!cancelled) {
          setArticleData(data);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setArticleError(err.message || 'Unable to load article in Clean Reader.');
        }
      })
      .finally(() => {
        if (!cancelled) setArticleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentArticleUrl]);

  // Intercept links inside extracted prose so they open inside PressIndex
  const handleProseClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;

    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      setArticleHistory((prev) => [...prev, href]);
      setLiveUrl(href);
    }
  };

  const openPostInReader = (url: string) => {
    setArticleHistory((prev) => [...prev, url]);
    setLiveUrl(url);
    setSafeFrameMode(false);
    setFrameBlockedFallback(false);
    setMode('reader');
  };

  const goBackArticle = () => {
    setArticleHistory((prev) => prev.slice(0, -1));
  };

  // Listen for in-frame messages from PressIndex proxy/broadsheet fallback
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data as {type?: string; url?: string} | null;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'pressindex:switch-reader') {
        setMode('reader');
      } else if (msg.type === 'pressindex:open-reader' && msg.url) {
        openPostInReader(msg.url);
      } else if (msg.type === 'pressindex:frame-fallback') {
        setIframeLoading(false);
        setFrameBlockedFallback(true);
      } else if (msg.type === 'pressindex:frame-ready') {
        setIframeLoading(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleIframeLoad = () => {
    setIframeLoading(false);
    const frameEl = iframeRef.current;
    if (!frameEl) return;
    try {
      const currentHref = frameEl.contentWindow?.location?.href || '';
      if (!currentHref.includes('/api/browse')) {
        if (!safeFrameMode) {
          setSafeFrameMode(true);
          setIframeLoading(true);
          setIframeKey((k) => k + 1);
        } else {
          setFrameBlockedFallback(true);
        }
      }
    } catch {
      // Cross-origin frame escape (e.g. X-Frame-Options refused to connect) -> auto-recover in Safe Static View
      if (!safeFrameMode) {
        setSafeFrameMode(true);
        setIframeLoading(true);
        setIframeKey((k) => k + 1);
      } else {
        setFrameBlockedFallback(true);
      }
    }
  };

  const activeExternalUrl = currentArticleUrl || liveUrl || blog.url;
  const hasOnlyFallbackPost = !digestLoading && posts.length > 0 && posts.every((p) => !p.isLive);
  const readerCannotOpenSite =
    mode === 'reader' &&
    (Boolean(articleError) || (!currentArticleUrl && hasOnlyFallbackPost && Boolean(digestNotice)));
  const liveCannotOpenSite = mode === 'live' && frameBlockedFallback;
  const cannotOpenInsideSite = readerCannotOpenSite || liveCannotOpenSite;

  return (
    <div
      className="fixed inset-0 z-40 bg-[#FAF9F6] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`${blog.name} workspace`}
    >
      {/* Workspace Top Bar */}
      <div className="bg-white border-b border-stone-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-stone-700 hover:text-[#141413] hover:bg-stone-100 rounded-lg transition-colors shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Back</span>
          </button>

          <div className="h-5 w-px bg-stone-200 shrink-0" aria-hidden="true" />

          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-bold font-mono shrink-0"
            style={{backgroundColor: blog.accentHex}}
            aria-hidden="true"
          >
            {blog.monogram}
          </div>

          <div className="min-w-0">
            <div className="font-serif font-semibold text-base text-[#141413] truncate">
              {blog.name}
            </div>
            <div className="font-mono text-xs text-stone-500 truncate">
              {blog.domain}
            </div>
          </div>
        </div>

        {/* Mode Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setMode('reader')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'reader'
                ? 'bg-white text-[#141413] shadow-sm'
                : 'text-stone-600 hover:text-[#141413]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clean Reader</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLiveUrl(currentArticleUrl || blog.url);
              setFrameBlockedFallback(false);
              setIframeLoading(true);
              setMode('live');
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'live'
                ? 'bg-white text-[#141413] shadow-sm'
                : 'text-stone-600 hover:text-[#141413]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Live Site Frame</span>
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onToggleSave(blog.id)}
            aria-label={isSaved ? 'Remove from saved' : 'Save publication'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isSaved
                ? 'bg-[#1E3A8A]/10 border-[#1E3A8A]/30 text-[#1E3A8A]'
                : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <Bookmark
              className="w-3.5 h-3.5"
              fill={isSaved ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
          </button>

          {cannotOpenInsideSite && (
            <a
              href={activeExternalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span className="hidden sm:inline">Open Website Directly</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {/* Mode 1: Clean Reader */}
      {mode === 'reader' && (
        <div className="flex-1 overflow-y-auto">
          {currentArticleUrl ? (
            /* Specific Article Reading Canvas */
            <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
              <div className="mb-8 pb-4 border-b border-stone-200 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={goBackArticle}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {articleHistory.length > 1
                      ? 'Previous Article'
                      : `All Posts on ${blog.name}`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLiveUrl(currentArticleUrl);
                    setFrameBlockedFallback(false);
                    setIframeLoading(true);
                    setMode('live');
                  }}
                  className="text-xs font-medium text-stone-600 hover:text-[#141413] underline underline-offset-4 cursor-pointer"
                >
                  View in Live Site Frame
                </button>
              </div>

              {articleLoading ? (
                <div className="space-y-4 py-8">
                  <div className="h-8 bg-stone-200/80 rounded w-3/4 animate-pulse" />
                  <div className="h-4 bg-stone-200/60 rounded w-1/3 animate-pulse" />
                  <div className="h-64 bg-stone-200/50 rounded-lg mt-6 animate-pulse" />
                  <div className="space-y-2.5 pt-4">
                    <div className="h-4 bg-stone-200/60 rounded w-full animate-pulse" />
                    <div className="h-4 bg-stone-200/60 rounded w-11/12 animate-pulse" />
                    <div className="h-4 bg-stone-200/60 rounded w-4/5 animate-pulse" />
                  </div>
                </div>
              ) : articleError ? (
                <div className="bg-white border border-stone-200 rounded-xl p-8 text-center">
                  <h2 className="font-serif text-xl font-semibold text-[#141413] mb-2">
                    Clean Reader Could Not Parse This Page
                  </h2>
                  <p className="text-sm text-stone-600 mb-6 max-w-md mx-auto">
                    {articleError}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setLiveUrl(currentArticleUrl);
                        setFrameBlockedFallback(false);
                        setIframeLoading(true);
                        setMode('live');
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg cursor-pointer"
                    >
                      Open in Live Site Frame
                    </button>
                    <a
                      href={currentArticleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg"
                    >
                      <span>Open Website Directly</span>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              ) : articleData ? (
                <article>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-3">
                    <span className="font-medium text-stone-800">{articleData.siteName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{articleData.byline}</span>
                    {articleData.publishedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatReadableDate(articleData.publishedAt)}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {articleData.readingMinutes} min read
                    </span>
                  </div>

                  <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#141413] leading-tight mb-6">
                    {articleData.title}
                  </h1>

                  {articleData.leadImage && (
                    <div className="mb-8 rounded-lg overflow-hidden border border-stone-200 bg-stone-100">
                      <img
                        src={articleData.leadImage}
                        alt={articleData.title}
                        referrerPolicy="no-referrer"
                        className="w-full max-h-[420px] object-cover"
                        onError={(e) => {
                          (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  <div
                    ref={proseRef}
                    onClick={handleProseClick}
                    className="editorial-prose"
                    dangerouslySetInnerHTML={{__html: articleData.contentHtml}}
                  />
                </article>
              ) : null}
            </div>
          ) : (
            /* Site Front Page Digest */
            <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
              <div className="bg-white border border-stone-200 rounded-xl p-6 sm:p-8 mb-8">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                  <div className="max-w-2xl">
                    <div className="flex items-center gap-2 text-xs text-stone-500 mb-2">
                      <span>{blog.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{blog.author}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Est. {blog.established}</span>
                    </div>
                    <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#141413] mb-3">
                      {blog.name}
                    </h1>
                    <p className="text-base text-stone-600 leading-relaxed mb-4">
                      {blog.description}
                    </p>
                    <div className="text-xs text-stone-500">
                      Topics: {blog.topics.slice(0, 8).join(' · ')}
                    </div>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setLiveUrl(blog.url);
                        setFrameBlockedFallback(false);
                        setIframeLoading(true);
                        setMode('live');
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Globe className="w-4 h-4" aria-hidden="true" />
                      <span>Browse Live Website</span>
                    </button>
                  </div>
                </div>
              </div>

              {digestNotice && (
                <div className="mb-6 px-4 py-3 bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-700 flex flex-wrap items-center justify-between gap-3">
                  <span>{digestNotice}</span>
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setLiveUrl(blog.url);
                        setFrameBlockedFallback(false);
                        setIframeLoading(true);
                        setMode('live');
                      }}
                      className="text-xs font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                    >
                      Try Live Site Frame
                    </button>
                    {hasOnlyFallbackPost && (
                      <a
                        href={blog.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#141413] hover:text-[#1E3A8A] underline underline-offset-4"
                      >
                        <span>Open Website Directly</span>
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-xl font-semibold text-[#141413]">
                  Latest Dispatches &amp; Articles
                </h2>
                {!digestLoading && (
                  <span className="text-xs font-mono tabular-nums text-stone-500">
                    {posts.length} {posts.length === 1 ? 'entry' : 'entries'}
                  </span>
                )}
              </div>

              {digestLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="bg-white border border-stone-200 rounded-xl p-5 space-y-3"
                    >
                      <div className="h-3 bg-stone-200 rounded w-1/3 animate-pulse" />
                      <div className="h-5 bg-stone-200 rounded w-5/6 animate-pulse" />
                      <div className="h-4 bg-stone-200/70 rounded w-full animate-pulse" />
                      <div className="h-4 bg-stone-200/70 rounded w-2/3 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {posts.map((post) => (
                    <div
                      key={post.id}
                      className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between hover:border-stone-300 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-xs text-stone-500 mb-2">
                          <span>{post.author}</span>
                          {post.pubDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{formatReadableDate(post.pubDate)}</span>
                            </>
                          )}
                        </div>
                        <h3 className="font-serif text-lg font-semibold text-[#141413] leading-snug mb-2">
                          <button
                            type="button"
                            onClick={() => openPostInReader(post.link)}
                            className="text-left hover:text-[#1E3A8A] transition-colors cursor-pointer"
                          >
                            {post.title}
                          </button>
                        </h3>
                        <p className="text-sm text-stone-600 line-clamp-3 leading-relaxed">
                          {post.excerpt}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => openPostInReader(post.link)}
                          className="text-xs font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                        >
                          Read Inside PressIndex
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLiveUrl(post.link);
                            setFrameBlockedFallback(false);
                            setIframeLoading(true);
                            setMode('live');
                          }}
                          className="text-xs text-stone-500 hover:text-[#141413] cursor-pointer"
                        >
                          Live Frame
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mode 2: Live Site Embedded Browser Frame */}
      {mode === 'live' && (
        <div className="flex-1 flex flex-col min-h-0 bg-white">
          <div className="bg-stone-50 border-b border-stone-200 px-4 py-2 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  setFrameBlockedFallback(false);
                  setIframeLoading(true);
                  setIframeKey((k) => k + 1);
                }}
                aria-label="Reload live site frame"
                className="p-1.5 text-stone-600 hover:text-[#141413] rounded hover:bg-stone-200/70 transition-colors cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <div className="font-mono text-xs text-stone-600 bg-white border border-stone-200 rounded px-2.5 py-1 truncate flex-1">
                {liveUrl}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {iframeLoading && (
                <span className="text-stone-500 font-medium hidden sm:inline">Loading live page...</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSafeFrameMode((prev) => !prev);
                  setFrameBlockedFallback(false);
                  setIframeLoading(true);
                  setIframeKey((k) => k + 1);
                }}
                className={`text-xs font-medium px-2.5 py-1 rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  safeFrameMode
                    ? 'bg-[#1E3A8A]/10 border-[#1E3A8A]/30 text-[#1E3A8A]'
                    : 'bg-white border-stone-200 text-stone-600 hover:text-[#141413]'
                }`}
              >
                {safeFrameMode ? 'Safe View: On' : 'Safe View'}
              </button>
              <button
                type="button"
                onClick={() => setMode('reader')}
                className="text-xs font-medium text-[#1E3A8A] hover:underline whitespace-nowrap cursor-pointer"
              >
                Switch to Clean Reader
              </button>
            </div>
          </div>

          <iframe
            ref={iframeRef}
            key={`${liveUrl}-${safeFrameMode ? 'safe' : 'full'}-${iframeKey}`}
            src={`/api/browse?url=${encodeURIComponent(liveUrl)}${safeFrameMode ? '&safe=1' : ''}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={`Live view of ${blog.name}`}
            className="w-full flex-1 border-0 bg-white"
            onLoad={handleIframeLoad}
          />
        </div>
      )}
    </div>
  );
};
