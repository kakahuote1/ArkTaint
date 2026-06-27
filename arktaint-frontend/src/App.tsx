import { useEffect, useState } from 'react';
import Overview from './components/Overview';
import Workbench from './components/Workbench';
import Docs from './components/Docs';
import './index.css';

type PageId = 'overview' | 'docs' | 'workbench';

function normalizePage(value: string): PageId {
  if (value === 'workbench') return 'workbench';
  if (value === 'docs') return 'docs';
  return 'overview';
}

function App() {
  const [page, setPage] = useState<PageId>(() => normalizePage(window.location.hash.replace('#', '')));

  useEffect(() => {
    const handler = () => setPage(normalizePage(window.location.hash.replace('#', '')));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const openPage = (next: PageId) => {
    const hash = `#${next}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app-container">
      <header className="topbar">
        <button className="brand" onClick={() => openPage('overview')}>
          <svg className="brand-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="brandGrad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="50%" stopColor="#0ea5e9" />
                <stop offset="100%" stopColor="#2dd4bf" />
              </linearGradient>
              <linearGradient id="brandInner" x1="8" y1="8" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#7dd3fc" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
            <rect x="1" y="1" width="26" height="26" rx="7" fill="url(#brandGrad)" opacity="0.18" />
            <rect x="1" y="1" width="26" height="26" rx="7" stroke="url(#brandGrad)" strokeWidth="1.5" fill="none" />
            <path d="M8 10L14 7L20 10V18L14 21L8 18V10Z" fill="url(#brandInner)" opacity="0.25" />
            <path
              d="M8 10L14 7L20 10V18L14 21L8 18V10Z"
              stroke="url(#brandInner)"
              strokeWidth="1.2"
              fill="none"
              strokeLinejoin="round"
            />
            <path d="M14 7V21" stroke="url(#brandGrad)" strokeWidth="0.8" opacity="0.5" />
            <path d="M8 10L20 18" stroke="url(#brandGrad)" strokeWidth="0.6" opacity="0.3" />
            <path d="M20 10L8 18" stroke="url(#brandGrad)" strokeWidth="0.6" opacity="0.3" />
            <circle cx="14" cy="14" r="2.5" fill="url(#brandInner)" opacity="0.9" />
          </svg>
          <span>ArkTaint</span>
        </button>

        <nav className="topnav" aria-label="主导航">
          <button
            className={`topnav-link ${page === 'overview' ? 'active' : ''}`}
            onClick={() => openPage('overview')}
          >
            产品介绍
          </button>
          <button
            className={`topnav-link ${page === 'docs' ? 'active' : ''}`}
            onClick={() => openPage('docs')}
          >
            使用文档
          </button>
          <button
            className={`topnav-link ${page === 'workbench' ? 'active' : ''}`}
            onClick={() => openPage('workbench')}
          >
            分析工作台
          </button>
        </nav>
      </header>

      {page === 'overview' ? (
        <Overview onStart={() => openPage('workbench')} />
      ) : page === 'docs' ? (
        <Docs />
      ) : (
        <main className="experience-shell workbench-page">
          <Workbench />
        </main>
      )}
    </div>
  );
}

export default App;
