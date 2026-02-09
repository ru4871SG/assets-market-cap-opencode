import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from './LanguageSelector';
import './Header.css';

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo-section">
          <h1>{t('header.title')}</h1>
          <span className="tagline">{t('header.tagline')}</span>
        </div>
        <div className="header-controls">
          <LanguageSelector />
          <button 
            className="theme-toggle" 
            onClick={toggleTheme}
            title={t(theme === 'dark' ? 'header.themeDark' : 'header.themeLight')}
            aria-label={t(theme === 'dark' ? 'header.themeDark' : 'header.themeLight')}
          >
            {theme === 'dark' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
