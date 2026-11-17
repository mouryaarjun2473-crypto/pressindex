import React, {useState} from 'react';
import {Globe, X} from 'lucide-react';
import {type BlogCategory, BLOG_CATEGORIES, type BlogEntry} from '../data/blogs';

interface AddSiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAndOpen: (blog: BlogEntry, saveToDirectory: boolean) => void;
}

export const AddSiteModal: React.FC<AddSiteModalProps> = ({
  isOpen,
  onClose,
  onAddAndOpen,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [category, setCategory] = useState<BlogCategory>('Tech & Web');
  const [saveToDir, setSaveToDir] = useState(true);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let normalized = urlInput.trim();
    if (!normalized) {
      setError('Please enter a website or blog URL.');
      return;
    }
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }

    try {
      const parsed = new URL(normalized);
      const domain = parsed.hostname.replace(/^www\./, '');
      const defaultName = domain.split('.')[0] || domain;
      const finalName =
        nameInput.trim() ||
        defaultName.charAt(0).toUpperCase() + defaultName.slice(1);

      const newBlog: BlogEntry = {
        id: `custom-${Date.now()}`,
        name: finalName,
        url: parsed.toString(),
        domain,
        category,
        author: finalName,
        established: 'Custom',
        tagline: `Opened directly inside PressIndex from ${domain}.`,
        description: `User-added publication at ${parsed.toString()}.`,
        topics: [domain, finalName.toLowerCase(), category.toLowerCase()],
        accentHex: '#1E3A8A',
        monogram: finalName.slice(0, 2).toUpperCase(),
      };

      onAddAndOpen(newBlog, saveToDir);
      setUrlInput('');
      setNameInput('');
      onClose();
    } catch {
      setError('Please enter a valid web address (for example: https://example.com).');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-site-title"
    >
      <div className="bg-white border border-stone-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-[#1E3A8A]" aria-hidden="true" />
            <h2 id="add-site-title" className="font-serif text-lg font-semibold text-[#141413]">
              Open Any Website Inside PressIndex
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-stone-500 hover:text-[#141413] rounded-md hover:bg-stone-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="custom-url" className="block text-sm font-medium text-stone-800 mb-1.5">
              Website or Blog URL
            </label>
            <input
              id="custom-url"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/blog/"
              className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg focus:outline-none focus:border-[#1E3A8A] focus:ring-1 focus:ring-[#1E3A8A]"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="custom-name" className="block text-sm font-medium text-stone-800 mb-1.5">
                Publication Name (optional)
              </label>
              <input
                id="custom-name"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="My Favorite Blog"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>

            <div>
              <label htmlFor="custom-cat" className="block text-sm font-medium text-stone-800 mb-1.5">
                Category
              </label>
              <select
                id="custom-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as BlogCategory)}
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-stone-300 rounded-lg focus:outline-none focus:border-[#1E3A8A]"
              >
                {BLOG_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-stone-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={saveToDir}
              onChange={(e) => setSaveToDir(e.target.checked)}
              className="w-4 h-4 rounded border-stone-300 text-[#1E3A8A] focus:ring-[#1E3A8A]"
            />
            <span>Also add this site to my Directory list</span>
          </label>

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172554] rounded-lg transition-colors cursor-pointer"
            >
              Open Inside PressIndex
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
