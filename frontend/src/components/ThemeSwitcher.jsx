import { useTheme } from '../context/ThemeContext.jsx';
import Icon from './Icon.jsx';

const OPTIONS = [
  { value: 'light', icon: 'sun', label: 'Light' },
  { value: 'dark', icon: 'moon', label: 'Dark' },
  { value: 'system', icon: 'monitor', label: 'System' },
];

/**
 * Segmented Light / Dark / System switcher. Keyboard-accessible (each option is
 * a real button with an accessible name; the active one has aria-pressed).
 */
export default function ThemeSwitcher() {
  const { preference, setTheme } = useTheme();

  return (
    <div className="theme-switcher" role="group" aria-label="Appearance">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={preference === opt.value}
          aria-label={`${opt.label} theme`}
          title={`${opt.label} theme`}
          onClick={() => setTheme(opt.value)}
        >
          <Icon name={opt.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
