import React from 'react';
import {ArrowRight, BookOpen, Globe, SearchX} from 'lucide-react';
import type {ArticleSummary, BlogEntry} from '../data/blogs';

export interface SearchBlogMatch extends BlogEntry {
  matchScore: number;
}

interface SearchResultsSectionProps {
  query: string;
  loading: boolean;
  topBlog: SearchBlogMatch | null;
  matchingBlogs: SearchBlogMatch[];
  matchingArticles: ArticleSummary[];
  onOpenBlog: (blog: BlogEntry, mode?: 'reader' | 'live') => void;
  onOpenArticle: (article: ArticleSummary) => void;
  onClearSearch: () => void;
}

export const SearchResultsSection: React.FC<SearchResultsSectionProps> = ({
  query,
  loading,
  topBlog,
  matchingBlogs,
  matchingArticles,
  onOpenBlog,
  onOpenArticle,
  onClearSearch,
}) => {
  const otherBlogs = topBlog
    ? matchingBlogs.filter((b) => b.id !== topBlog.id)
    : matchingBlogs;

  return (
    <section aria-label="Search Results" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-stone-200 mb-8">
        <div>
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-1">
            Topic &amp; Publication Search
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#141413]">
            Results for &ldquo;{query}&rdquo;
          </h2>
        </div>

        <button
          type="button"
          onClick={onClearSearch}
          className="text-sm font-medium text-stone-600 hover:text-[#141413] underline underline-offset-4 cursor-pointer"
        >
          Clear search and show all sites
        </button>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="bg-white border border-stone-200 rounded-xl p-8 space-y-4">
            <div className="h-3 bg-stone-200 rounded w-32 animate-pulse" />
            <div className="h-8 bg-stone-200 rounded w-1/2 animate-pulse" />
            <div className="h-4 bg-stone-200/70 rounded w-3/4 animate-pulse" />
          </div>
        </div>
      ) : !topBlog && matchingArticles.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center">
          <SearchX className="w-8 h-8 text-stone-400 mx-auto mb-3" aria-hidden="true" />
          <h3 className="font-serif text-xl font-semibold text-[#141413] mb-2">
            No Matching Blog Found for &ldquo;{query}&rdquo;
          </h3>
          <p className="text-sm text-stone-600 max-w-md mx-auto mb-6">
            Try searching a broader topic like web design, blogging, gadgets, productivity, trivia, DIY, or politics.
          </p>
          <button
            type="button"
            onClick={onClearSearch}
            className="px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg cursor-pointer"
          >
            Browse All Indexed Publications
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Best Matching Blog Spotlight */}
          {topBlog && (
            <div>
              <p className="text-xs uppercase tracking-widest text-[#1E3A8A] font-semibold mb-3">
                Top Matching Blog
              </p>
              <div className="bg-white border border-stone-200 rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-2">
                    <span className="font-medium text-stone-800">{topBlog.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{topBlog.domain}</span>
                    <span aria-hidden="true">·</span>
                    <span>By {topBlog.author}</span>
                  </div>

                  <div className="flex items-center gap-3.5 mb-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold font-mono shrink-0"
                      style={{backgroundColor: topBlog.accentHex}}
                      aria-hidden="true"
                    >
                      {topBlog.monogram}
                    </div>
                    <h3 className="font-serif text-2xl sm:text-3xl font-bold text-[#141413]">
                      {topBlog.name}
                    </h3>
                  </div>

                  <p className="text-base text-stone-700 leading-relaxed mb-3">
                    {topBlog.description}
                  </p>

                  <p className="text-xs text-stone-500">
                    Relevant topics: {topBlog.topics.slice(0, 7).join(' · ')}
                  </p>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenBlog(topBlog, 'reader')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4" aria-hidden="true" />
                    <span>Open Blog Inside Site</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenBlog(topBlog, 'live')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Globe className="w-4 h-4" aria-hidden="true" />
                    <span>Live Frame</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Related Blogs */}
          {otherBlogs.length > 0 && (
            <div>
              <h3 className="font-serif text-xl font-semibold text-[#141413] mb-4">
                Related Publications ({otherBlogs.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {otherBlogs.map((blog) => (
                  <div
                    key={blog.id}
                    className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between hover:border-stone-300 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs text-stone-500 mb-2">
                        <span>{blog.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{blog.domain}</span>
                      </div>
                      <h4 className="font-serif text-lg font-semibold text-[#141413] mb-1.5">
                        {blog.name}
                      </h4>
                      <p className="text-sm text-stone-600 line-clamp-2 mb-3">
                        {blog.tagline}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => onOpenBlog(blog, 'reader')}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                      >
                        <span>Open Inside Site</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenBlog(blog, 'live')}
                        className="text-xs text-stone-500 hover:text-[#141413] cursor-pointer"
                      >
                        Live Frame
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matching Live Articles */}
          {matchingArticles.length > 0 && (
            <div>
              <h3 className="font-serif text-xl font-semibold text-[#141413] mb-4">
                Matching Articles From These Blogs
              </h3>
              <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-200">
                {matchingArticles.map((article) => (
                  <div
                    key={article.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1">
                        <span className="font-medium text-stone-800">{article.blogName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{article.author}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenArticle(article)}
                        className="font-serif text-lg font-semibold text-[#141413] hover:text-[#1E3A8A] text-left transition-colors cursor-pointer"
                      >
                        {article.title}
                      </button>
                      <p className="text-sm text-stone-600 line-clamp-2 mt-1">
                        {article.excerpt}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenArticle(article)}
                      className="px-3.5 py-2 text-xs font-semibold text-[#1E3A8A] bg-[#1E3A8A]/8 hover:bg-[#1E3A8A]/15 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      Read Article
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
