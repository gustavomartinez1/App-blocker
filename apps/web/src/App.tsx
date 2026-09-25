import { useEffect, useState } from 'react';
import { getToken, useData, type EventItem, type RequestItem } from './api';
import { ToastHost } from './components/ui';
import { AlertsPage } from './pages/Alerts';
import { AuthPage } from './pages/Auth';
import { HomePage } from './pages/Home';
import { ProfilePage } from './pages/Profile';
import { RequestsPage } from './pages/Requests';
import { SettingsPage } from './pages/Settings';
import { useRoute } from './router';

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  useEffect(() => {
    const on = () => setAuthed(!!getToken());
    window.addEventListener('guardian:auth', on);
    return () => window.removeEventListener('guardian:auth', on);
  }, []);
  return (
    <>
      {authed ? <Shell /> : <AuthPage />}
      <ToastHost />
    </>
  );
}

function Shell() {
  const route = useRoute();
  const [section = '', ...rest] = route;
  const requests = useData<RequestItem[]>('/api/requests?status=pending', ['request']);
  const alerts = useData<EventItem[]>('/api/events?unread=1&limit=100', ['event']);
  const pending = requests.data?.length ?? 0;
  const unread = alerts.data?.filter((e) => e.severity !== 'info').length ?? 0;

  const links = [
    { href: '#/', id: '', icon: '🏠', label: 'Inicio' },
    { href: '#/solicitudes', id: 'solicitudes', icon: '🔓', label: 'Solicitudes', count: pending },
    { href: '#/alertas', id: 'alertas', icon: '🚨', label: 'Alertas', count: unread },
    { href: '#/ajustes', id: 'ajustes', icon: '⚙️', label: 'Ajustes' },
  ];

  let page;
  switch (section) {
    case 'perfil':
      page = <ProfilePage id={rest[0] ?? ''} tab={rest[1] ?? 'resumen'} />;
      break;
    case 'solicitudes':
      page = <RequestsPage />;
      break;
    case 'alertas':
      page = <AlertsPage onRead={alerts.reload} />;
      break;
    case 'ajustes':
      page = <SettingsPage />;
      break;
    default:
      page = <HomePage />;
  }

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Principal">
        <div className="brand">
          <img src="/icon.svg" alt="" /> Guardián
        </div>
        {links.map((l) => (
          <a key={l.id} href={l.href} className={`nav-link ${section === l.id || (l.id === '' && section === 'perfil') ? 'active' : ''}`}>
            <span aria-hidden>{l.icon}</span>
            <span className="label">{l.label}</span>
            {!!l.count && <span className="badge red count">{l.count}</span>}
          </a>
        ))}
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}
