import { useTranslation } from 'react-i18next';
import './InventoryOverlayToggle.css';

interface InventoryOverlayToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function InventoryOverlayToggle({ 
  checked, 
  onChange, 
  disabled = false,
  loading = false 
}: InventoryOverlayToggleProps) {
  const { t } = useTranslation();

  return (
    <label className={`inventory-overlay-toggle ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled || loading}
      />
      <span className="toggle-checkmark"></span>
      <span className="toggle-label">
        {t('priceChart.addInventoryOverlay')}
        {loading && <span className="toggle-loading"></span>}
      </span>
    </label>
  );
}
