import React from 'react';
import {Plus} from 'lucide-react';

export type ActiveNav = 'directory' | 'feed' | 'saved' | 'about';

interface HeaderProps {
  activeNav: ActiveNav;
  onSelectNav: (nav: ActiveNav) => void;
  onOpenAddSite: () => void;
  savedCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeNav,
  onSelectNav,
  onOpenAddSite,
  savedCount,
}) => {
  const navItems: Array<{id: ActiveNav; label: string}> = [
    {id: 'directory', label: 'Directory'},
    {id: 'feed', label: 'Live Feed'},
    {id: 'saved', label: savedCount > 0 ? `Saved (${savedCount})` : 'Saved'},
    {id: 'about', label: 'About'},
  ];

  return (
    <header className="sticky top-0 z-30 bg-[#FAF9F6]/95 backdrop-blur-sm border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Title (single line wordmark) */}
        <button
          type="button"
          onClick={() => onSelectNav('directory')}
          className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-[#141413] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1E3A8A]"
        >
          PressIndex
        </button>

        {/* Zone 2: 4 single-line nav links */}
        <nav aria-label="Primary Navigation" className="hidden md:flex items-center gap-7">
          {navItems.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectNav(item.id)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1E3A8A] ${
                  isActive
                    ? 'text-[#141413] border-[#1E3A8A]'
                    : 'text-stone-600 border-transparent hover:text-[#141413] hover:border-stone-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenAddSite}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Open URL</span>
          </button>
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden border-t border-stone-200 px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto"
      >
        {navItems.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectNav(item.id)}
              className={`text-xs font-medium whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded-md transition-colors ${
                isActive
                  ? 'bg-[#1E3A8A] text-white'
                  : 'text-stone-600 hover:bg-stone-200/60'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
