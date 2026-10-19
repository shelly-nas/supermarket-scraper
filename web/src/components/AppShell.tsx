import React, { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTheme, ThemeMode } from '../context/ThemeContext';
import {
  CartIcon,
  CloseIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TagIcon,
} from './Icons';
import './AppShell.css';

const NAV_ITEMS = [
  { to: '/discounts', label: 'Discounts', icon: <TagIcon /> },
  { to: '/configurations', label: 'Configuraties', icon: <SettingsIcon /> },
];

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'system', label: 'System theme', icon: <MonitorIcon /> },
  { mode: 'light', label: 'Light theme', icon: <SunIcon /> },
  { mode: 'dark', label: 'Dark theme', icon: <MoonIcon /> },
];

const AppLogo: React.FC = () => (
  <div className="app-logo">
    <span className="app-logo-mark">
      <CartIcon />
    </span>
    <span className="app-logo-text">
      <span className="app-logo-name">Supermarket Scraper</span>
      <span className="app-logo-sub">Shelly NAS</span>
    </span>
  </div>
);

const ThemeSwitch: React.FC = () => {
  const { mode, setMode } = useTheme();
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={`theme-switch-option${mode === option.mode ? ' is-active' : ''}`}
          aria-pressed={mode === option.mode}
          aria-label={option.label}
          title={option.label}
          onClick={() => setMode(option.mode)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
};

/** Logo, nav items and theme switch; rendered in the sidebar and in the mobile drawer. */
const Navigation: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => (
  <div className="app-nav">
    <AppLogo />
    <nav className="app-nav-items" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
          onClick={onNavigate}
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
    <div className="app-nav-footer">
      <span className="t-label">Theme</span>
      <ThemeSwitch />
    </div>
  </div>
);

/**
 * App shell from the shelly-nas design: a sticky 248px sidebar from 900px up,
 * below that a fixed top bar whose menu button opens the same navigation in a drawer.
 */
const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const location = useLocation();

  const openDrawer = () => drawerRef.current?.showModal();
  const closeDrawer = () => drawerRef.current?.close();

  // Close the drawer after any navigation (also back/forward).
  useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  // The drawer is hidden from 900px up; close it so the modal never traps a hidden page.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) closeDrawer();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Navigation />
      </aside>

      <header className="app-topbar">
        <button
          type="button"
          className="btn btn-quiet icon-btn app-topbar-menu"
          aria-label="Menu openen"
          onClick={openDrawer}
        >
          <MenuIcon />
        </button>
        <AppLogo />
      </header>

      <dialog
        ref={drawerRef}
        className="app-drawer"
        aria-label="Menu"
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself.
          if (e.target === e.currentTarget) closeDrawer();
        }}
      >
        <div className="app-drawer-panel">
          <button
            type="button"
            className="btn btn-quiet icon-btn app-drawer-close"
            aria-label="Menu sluiten"
            onClick={closeDrawer}
          >
            <CloseIcon />
          </button>
          <Navigation onNavigate={closeDrawer} />
        </div>
      </dialog>

      <main className="app-main">{children}</main>
    </div>
  );
};

export default AppShell;
