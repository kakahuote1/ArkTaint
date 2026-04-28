import { useState } from 'react';
import Overview from './components/Overview';
import Console from './components/Console';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'console'>('overview');

  return (
    <div className="app-container">
      <nav className="navbar">
        <button className="brand" onClick={() => setActiveTab('overview')}>
          <span className="brand-mark" />
          <span>ArkTaint</span>
        </button>

        <div className="nav-links">
          <button
            className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            项目介绍
          </button>
          <button
            className={`nav-link ${activeTab === 'console' ? 'active' : ''}`}
            onClick={() => setActiveTab('console')}
          >
            分析控制台
          </button>
        </div>

        <button className="nav-action" onClick={() => setActiveTab('console')}>
          开始分析
        </button>
      </nav>

      {activeTab === 'overview' ? (
        <Overview onStart={() => setActiveTab('console')} />
      ) : (
        <Console />
      )}
    </div>
  );
}

export default App;