import { describe, expect, it } from 'vitest';
import {
  domainMatches,
  generateUnlockCode,
  localTime,
  matchesTarget,
  normalizeHost,
  normalizeUrl,
  randomSecret,
  verifyUnlockCode,
} from '../src/index.js';

describe('normalización y coincidencias', () => {
  it('normaliza hosts y URLs', () => {
    expect(normalizeHost('HTTPS://www.Example.com:8080/a?b')).toBe('example.com');
    expect(normalizeHost('*.example.com')).toBe('example.com');
    expect(normalizeUrl('https://www.YouTube.com/Shorts/abc')).toBe('youtube.com/shorts/abc');
  });

  it('dominios incluyen subdominios pero no sufijos parecidos', () => {
    expect(domainMatches('m.facebook.com', 'facebook.com')).toBe(true);
    expect(domainMatches('notfacebook.com', 'facebook.com')).toBe(false);
  });

  it('prefijos de URL y palabras clave', () => {
    const shorts = { kind: 'url', prefix: 'youtube.com/shorts' } as const;
    expect(matchesTarget(shorts, { type: 'web', url: 'https://m.youtube.com/shorts/xyz' })).toBe(true);
    expect(matchesTarget(shorts, { type: 'web', url: 'https://www.youtube.com/watch?v=1' })).toBe(false);
    expect(matchesTarget({ kind: 'keyword', keyword: 'casino' }, { type: 'web', url: 'https://www.google.com/search?q=Casino%20online' })).toBe(true);
  });

  it('apps de escritorio sin distinguir mayúsculas', () => {
    expect(matchesTarget({ kind: 'service', id: 'discord' }, { type: 'app', platform: 'windows', id: 'discord.EXE' })).toBe(true);
    expect(matchesTarget({ kind: 'app', id: 'com.foo', platform: 'ios' }, { type: 'app', platform: 'android', id: 'com.foo' })).toBe(false);
  });

  it('la categoría de evasión incluye DNS sobre HTTPS', () => {
    expect(matchesTarget({ kind: 'category', category: 'bypass' }, { type: 'web', url: 'https://dns.google/dns-query' })).toBe(true);
  });
});

describe('hora local', () => {
  it('convierte a zona horaria', () => {
    const lt = localTime(new Date('2026-09-21T04:30:00Z'), 'America/Mexico_City');
    expect(lt).toEqual({ day: '2026-09-20', weekday: 0, minutes: 22 * 60 + 30 });
  });
});

describe('códigos sin conexión', () => {
  it('genera y valida con la duración correcta', async () => {
    const secret = randomSecret();
    const now = new Date('2026-09-21T10:00:00Z');
    const code = await generateUnlockCode(secret, 30, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(await verifyUnlockCode(secret, code, now)).toMatchObject({ minutes: 30 });
    // Sigue valiendo en el siguiente paso de 10 minutos, pero no después.
    expect(await verifyUnlockCode(secret, code, new Date(now.getTime() + 10 * 60_000))).not.toBeNull();
    expect(await verifyUnlockCode(secret, code, new Date(now.getTime() + 25 * 60_000))).toBeNull();
    expect(await verifyUnlockCode(randomSecret(), code, now)).toBeNull();
  });

  it('vector fijo (debe coincidir con Kotlin y Swift)', async () => {
    const code = await generateUnlockCode('secreto-de-prueba', 60, new Date(1_800_000_000_000));
    expect(code).toBe(await generateUnlockCode('secreto-de-prueba', 60, new Date(1_800_000_000_000)));
    // Si cambia el algoritmo este valor cambia: actualizar también los agentes nativos.
    expect(code).toMatchInlineSnapshot(`"428045"`);
  });
});
