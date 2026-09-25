import { CATEGORIES, PLATFORMS, SERVICES, describeTarget, type CategoryId, type Platform, type Target } from '@guardian/core';
import { useMemo, useState } from 'react';
import { PLATFORM_LABELS } from '../format';

const key = (t: Target) => JSON.stringify(t);

type Tab = 'services' | 'categories' | 'custom';

/** Selector de qué se bloquea: servicios del catálogo, categorías, todo, o apps/sitios personalizados. */
export function TargetPicker({ value, onChange, allowAll = true }: { value: Target[]; onChange: (v: Target[]) => void; allowAll?: boolean }) {
  const [tab, setTab] = useState<Tab>('services');
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(value.map(key)), [value]);
  const has = (t: Target) => selected.has(key(t));
  const toggle = (t: Target) => onChange(has(t) ? value.filter((v) => key(v) !== key(t)) : [...value, t]);
  const all: Target = { kind: 'all' };

  const services = SERVICES.filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || CATEGORIES[s.category].name.toLowerCase().includes(q);
  });

  return (
    <div className="stack" style={{ gap: 10 }}>
      {value.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {value.map((t) => (
            <span className="chip" key={key(t)}>
              {describeTarget(t)}
              <button type="button" onClick={() => toggle(t)} aria-label={`Quitar ${describeTarget(t)}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {allowAll && (
        <label className={`pick ${has(all) ? 'on' : ''}`}>
          <input type="checkbox" checked={has(all)} onChange={() => toggle(all)} />
          <span>
            <strong>Todo el dispositivo</strong>
            <span className="muted small"> — todas las apps y sitios (salvo llamadas, SMS, emergencias y lo permitido)</span>
          </span>
        </label>
      )}

      <div className="tabs" style={{ marginBottom: 4 }}>
        {(
          [
            ['services', 'Apps y sitios'],
            ['categories', 'Categorías'],
            ['custom', 'Personalizado'],
          ] as const
        ).map(([id, label]) => (
          <a key={id} href="#" className={`tab ${tab === id ? 'active' : ''}`} onClick={(e) => (e.preventDefault(), setTab(id))}>
            {label}
          </a>
        ))}
      </div>

      {tab === 'services' && (
        <>
          <input placeholder="Buscar (Instagram, juegos, YouTube…)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="picker-grid">
            {services.map((s) => {
              const t: Target = { kind: 'service', id: s.id };
              return (
                <label key={s.id} className={`pick ${has(t) ? 'on' : ''}`} title={CATEGORIES[s.category].name}>
                  <input type="checkbox" checked={has(t)} onChange={() => toggle(t)} />
                  {s.name}
                </label>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Cada servicio bloquea su app (Android, iPhone, PC) y su sitio web a la vez.
          </p>
        </>
      )}

      {tab === 'categories' && (
        <div className="picker-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {(Object.keys(CATEGORIES) as CategoryId[]).map((c) => {
            const t: Target = { kind: 'category', category: c };
            return (
              <label key={c} className={`pick ${has(t) ? 'on' : ''}`}>
                <input type="checkbox" checked={has(t)} onChange={() => toggle(t)} />
                <span>
                  <strong>{CATEGORIES[c].name}</strong>
                  <br />
                  <span className="muted small">{CATEGORIES[c].description}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {tab === 'custom' && <CustomTarget onAdd={(t) => !has(t) && onChange([...value, t])} />}
    </div>
  );
}

function CustomTarget({ onAdd }: { onAdd: (t: Target) => void }) {
  const [kind, setKind] = useState<'domain' | 'url' | 'keyword' | 'app'>('domain');
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState<Platform | ''>('android');
  const [label, setLabel] = useState('');

  const add = () => {
    const v = text.trim();
    if (!v) return;
    if (kind === 'domain') onAdd({ kind, domain: v.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') });
    if (kind === 'url') onAdd({ kind, prefix: v });
    if (kind === 'keyword') onAdd({ kind, keyword: v.toLowerCase() });
    if (kind === 'app') onAdd({ kind, id: v, platform: platform || undefined, label: label.trim() || undefined });
    setText('');
    setLabel('');
  };

  const hints = {
    domain: 'ejemplo.com (incluye todos sus subdominios)',
    url: 'youtube.com/shorts (bloquea sólo esa sección)',
    keyword: 'casino (bloquea URLs y búsquedas que la contengan)',
    app: 'com.ejemplo.app · Discord.exe · com.hnc.Discord',
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={{ width: 'auto' }}>
          <option value="domain">Sitio web (dominio)</option>
          <option value="url">Sección de un sitio (URL)</option>
          <option value="keyword">Palabra clave</option>
          <option value="app">App por identificador</option>
        </select>
        {kind === 'app' && (
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} style={{ width: 'auto' }}>
            {PLATFORMS.filter((p) => p !== 'browser' && p !== 'ios').map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
            <option value="">Cualquiera</option>
          </select>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input placeholder={hints[kind]} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        {kind === 'app' && <input placeholder="Nombre (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 180 }} />}
        <button type="button" className="primary" onClick={add}>
          Agregar
        </button>
      </div>
      {kind === 'app' && (
        <p className="muted small" style={{ margin: 0 }}>
          En iPhone las apps se eligen desde el propio iPhone (restricción de Apple): abre Guardián en el iPhone → “Elegir apps”.
        </p>
      )}
    </div>
  );
}
