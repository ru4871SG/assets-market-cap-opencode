import { useTranslation } from 'react-i18next';
import { ChangeColumn, ALL_CHANGE_COLUMNS } from '../types/asset';
import './ColumnsConfigModal.css';

interface ColumnsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  visibleColumns: ChangeColumn[];
  onColumnsChange: (columns: ChangeColumn[]) => void;
}

// Column labels mapping
const COLUMN_LABELS: Record<ChangeColumn, string> = {
  change7d: '7d',
  change30d: '30d',
  change60d: '60d',
  change90d: '90d',
  changeYtd: 'YTD',
  change180d: '180d',
};

export function ColumnsConfigModal({
  isOpen,
  onClose,
  visibleColumns,
  onColumnsChange,
}: ColumnsConfigModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const handleToggle = (column: ChangeColumn) => {
    if (visibleColumns.includes(column)) {
      // Remove column
      onColumnsChange(visibleColumns.filter((c) => c !== column));
    } else {
      // Add column - maintain order based on ALL_CHANGE_COLUMNS
      const newColumns = ALL_CHANGE_COLUMNS.filter(
        (c) => visibleColumns.includes(c) || c === column
      );
      onColumnsChange(newColumns);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="columns-config-modal">
        <div className="modal-header">
          <h3>{t('columnsConfig.title')}</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">{t('columnsConfig.description')}</p>
          <div className="columns-list">
            {ALL_CHANGE_COLUMNS.map((column) => {
              const isSelected = visibleColumns.includes(column);
              return (
                <label
                  key={column}
                  className={`column-option ${isSelected ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggle(column)}
                  />
                  <span className="column-label">
                    {t(`columnsConfig.columns.${column}`, COLUMN_LABELS[column])}
                  </span>
                  <span className="checkmark">{isSelected ? '\u2713' : ''}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="done-btn" onClick={onClose}>
            {t('columnsConfig.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
