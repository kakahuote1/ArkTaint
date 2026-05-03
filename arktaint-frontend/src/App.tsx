import { useEffect, useState } from 'react';
import Overview from './components/Overview';
import Workbench from './components/Workbench';
import './index.css';

type PageId = 'overview' | 'workbench';

const navItems: Array<{ id: PageId; label: string }> = [
  { id: 'overview', label: '产品介绍' },
  { id: 'workbench', label: '分析工作台' },
];

function normalizePage(value: string): PageId {
  return value === 'workbench' ? 'workbench' : 'overview';
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
          <span className="brand-mark" />
          <span>ArkTaint</span>
        </button>

        <nav className="topnav" aria-label="主导航">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`topnav-link ${page === item.id ? 'active' : ''}`}
              onClick={() => openPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button className="topbar-cta" onClick={() => openPage(page === 'overview' ? 'workbench' : 'overview')}>
          {page === 'overview' ? '进入工作台' : '返回介绍'}
        </button>
      </header>

      {page === 'overview' ? (
        <Overview onStart={() => openPage('workbench')} />
      ) : (
        <main className="experience-shell workbench-page">
          <Workbench />
        </main>
      )}
    </div>
  );
}

export default App;
