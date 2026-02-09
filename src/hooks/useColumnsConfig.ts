import { useState, useCallback } from 'react';
import { ChangeColumn, DEFAULT_VISIBLE_COLUMNS } from '../types/asset';

const STORAGE_KEY = 'visible_change_columns';

function loadSavedColumns(): ChangeColumn[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Validate that all items are valid ChangeColumn values
      if (Array.isArray(parsed) && parsed.every((c: string) => 
        ['change7d', 'change30d', 'change60d', 'change90d', 'change180d', 'changeYtd'].includes(c)
      )) {
        return parsed;
      }
    }
  } catch {
    // Ignore errors, use default
  }
  return DEFAULT_VISIBLE_COLUMNS;
}

function saveColumns(columns: ChangeColumn[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Ignore storage errors
  }
}

export function useColumnsConfig() {
  const [visibleColumns, setVisibleColumns] = useState<ChangeColumn[]>(loadSavedColumns);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const updateColumns = useCallback((columns: ChangeColumn[]) => {
    setVisibleColumns(columns);
    saveColumns(columns);
  }, []);

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return {
    visibleColumns,
    updateColumns,
    isModalOpen,
    openModal,
    closeModal,
  };
}
