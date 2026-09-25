import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api';

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', familyName: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : { ...form, familyName: form.familyName || undefined };
      const res = await api<{ token: string }>(`/api/auth/${mode}`, 'POST', body);
      setToken(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <img src="/icon.svg" alt="" /> Guardián
        </div>
        <div>
          <h1>{mode === 'login' ? 'Entrar' : 'Crear cuenta de administrador'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Controla qué apps y sitios se bloquean, cuánto tiempo y cuándo, en todos los dispositivos.
          </p>
        </div>
        {mode === 'register' && (
          <label className="field">
            <span>Tu nombre</span>
            <input required value={form.name} onChange={set('name')} autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>Correo</span>
          <input required type="email" value={form.email} onChange={set('email')} autoComplete="email" />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input required type="password" minLength={8} value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Nombre del grupo (opcional)</span>
            <input value={form.familyName} onChange={set('familyName')} placeholder="Familia Pérez, Mi equipo…" />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
        <button type="button" className="ghost" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '¿No tienes cuenta? Crear una' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  );
}
