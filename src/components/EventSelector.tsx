import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { EventCategory } from '../types/asset';
import { CATEGORY_CONFIG, FED_CATEGORIES } from '../services/eventsApi';
import './EventSelector.css';

interface EventSelectorProps {
  selectedCategories: EventCategory[];
  onChange: (categories: EventCategory[]) => void;
  loading?: boolean;
}

export function EventSelector({ 
  selectedCategories, 
  onChange, 
  loading = false 
}: EventSelectorProps) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);
  
  // Non-fed categories shown as individual options
  const standaloneCategories: EventCategory[] = [
    'government_shutdown',
    'recession',
  ];

  // All categories for "Select All" functionality
  const allCategories: EventCategory[] = [
    ...standaloneCategories,
    ...FED_CATEGORIES,
  ];

  const handleToggle = (category: EventCategory) => {
    if (selectedCategories.includes(category)) {
      onChange(selectedCategories.filter(c => c !== category));
    } else {
      onChange([...selectedCategories, category]);
    }
  };

  // Toggle all Fed categories at once
  const handleToggleFedDecisions = () => {
    const allFedSelected = FED_CATEGORIES.every(c => selectedCategories.includes(c));
    
    if (allFedSelected) {
      // Remove all fed categories
      onChange(selectedCategories.filter(c => !FED_CATEGORIES.includes(c)));
    } else {
      // Add all fed categories that aren't already selected
      const newCategories = [...selectedCategories];
      FED_CATEGORIES.forEach(c => {
        if (!newCategories.includes(c)) {
          newCategories.push(c);
        }
      });
      onChange(newCategories);
    }
  };

  const handleSelectAll = () => {
    if (selectedCategories.length === allCategories.length) {
      onChange([]);
    } else {
      onChange([...allCategories]);
    }
  };

  // Check if all fed categories are selected
  const allFedSelected = FED_CATEGORIES.every(c => selectedCategories.includes(c));
  const someFedSelected = FED_CATEGORIES.some(c => selectedCategories.includes(c));

  // Function to get translated category name
  const getCategoryName = (category: EventCategory): string => {
    switch (category) {
      case 'government_shutdown':
        return t('eventSelector.governmentShutdown');
      case 'recession':
        return t('eventSelector.recession');
      case 'fed_rate_hike':
        return t('eventSelector.rateHike');
      case 'fed_rate_cut':
        return t('eventSelector.rateCut');
      case 'fed_rate_hold':
        return t('eventSelector.rateHold');
    }
  };

  // Close mobile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileDropdownRef.current && !mobileDropdownRef.current.contains(event.target as Node)) {
        setMobileOpen(false);
      }
    };

    if (mobileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileOpen]);

  // Shared option renderer
  const renderOptions = () => (
    <>
      {/* Standalone categories */}
      {standaloneCategories.map(category => {
        const config = CATEGORY_CONFIG[category];
        const isSelected = selectedCategories.includes(category);
        
        return (
          <label 
            key={category} 
            className={`event-option ${isSelected ? 'selected' : ''}`}
            style={{ 
              '--event-color': config.color,
              borderColor: isSelected ? config.color : 'transparent',
            } as React.CSSProperties}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => handleToggle(category)}
              disabled={loading}
            />
            <span 
              className="event-color-indicator"
              style={{ backgroundColor: config.color }}
            />
            <span className="event-option-icon">{config.icon}</span>
            <span className="event-option-name">{getCategoryName(category)}</span>
          </label>
        );
      })}

      {/* Fed Decisions group button */}
      <label 
        className={`event-option event-option-group ${allFedSelected ? 'selected' : ''} ${someFedSelected && !allFedSelected ? 'partial' : ''}`}
        style={{ 
          '--event-color': '#5c7cfa',
          borderColor: allFedSelected ? '#5c7cfa' : someFedSelected ? '#5c7cfa80' : 'transparent',
        } as React.CSSProperties}
      >
        <input
          type="checkbox"
          checked={allFedSelected}
          onChange={handleToggleFedDecisions}
          disabled={loading}
        />
        <span 
          className="event-color-indicator"
          style={{ backgroundColor: '#5c7cfa' }}
        />
        <span className="event-option-icon">🏦</span>
        <span className="event-option-name">{t('eventSelector.fedDecisions')}</span>
      </label>

      {/* Individual Fed categories */}
      {FED_CATEGORIES.map(category => {
        const config = CATEGORY_CONFIG[category];
        const isSelected = selectedCategories.includes(category);
        
        return (
          <label 
            key={category} 
            className={`event-option event-option-sub ${isSelected ? 'selected' : ''}`}
            style={{ 
              '--event-color': config.color,
              borderColor: isSelected ? config.color : 'transparent',
            } as React.CSSProperties}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => handleToggle(category)}
              disabled={loading}
            />
            <span 
              className="event-color-indicator"
              style={{ backgroundColor: config.color }}
            />
            <span className="event-option-icon">{config.icon}</span>
            <span className="event-option-name">{getCategoryName(category)}</span>
          </label>
        );
      })}
    </>
  );

  return (
    <div className="event-selector">
      {/* Desktop: full pills layout */}
      <div className="event-selector-desktop">
        <div className="event-selector-header">
          <span className="event-selector-title">{t('eventSelector.chartEvents')}</span>
          <button 
            className="event-selector-toggle-all"
            onClick={handleSelectAll}
            disabled={loading}
          >
            {selectedCategories.length === allCategories.length ? t('eventSelector.clearAll') : t('eventSelector.selectAll')}
          </button>
        </div>
        <div className="event-selector-options">
          {renderOptions()}
        </div>
      </div>

      {/* Mobile/tablet: dropdown */}
      <div className="event-selector-mobile" ref={mobileDropdownRef}>
        <button 
          className="event-selector-mobile-trigger"
          onClick={() => setMobileOpen(!mobileOpen)}
          disabled={loading}
        >
          <span className="event-selector-mobile-label">
            {t('eventSelector.chartEvents')} ({selectedCategories.length})
          </span>
          <span className={`event-selector-mobile-arrow ${mobileOpen ? 'open' : ''}`}>▼</span>
        </button>
        {mobileOpen && (
          <div className="event-selector-mobile-dropdown">
            <div className="event-selector-mobile-header">
              <button 
                className="event-selector-toggle-all"
                onClick={handleSelectAll}
                disabled={loading}
              >
                {selectedCategories.length === allCategories.length ? t('eventSelector.clearAll') : t('eventSelector.selectAll')}
              </button>
            </div>
            <div className="event-selector-mobile-options">
              {renderOptions()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
