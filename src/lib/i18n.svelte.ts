import { ptBR } from './locales/pt-BR';
import { enUS } from './locales/en-US';
import type { Lang } from './types';

export type Key = keyof typeof ptBR;

const dicts: Record<Lang, Record<Key, string>> = { 'pt-BR': ptBR, 'en-US': enUS };

export const lang = $state({ current: 'pt-BR' as Lang });

export function detectLang(): Lang {
  const n = (typeof navigator !== 'undefined' && navigator.language) || 'pt-BR';
  return n.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
}

export function format(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Texto no idioma atual. Ler `lang.current` aqui faz a tela se redesenhar ao trocar. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const d = dicts[lang.current] ?? ptBR;
  return format(d[key] ?? ptBR[key] ?? key, params);
}

export function hasKey(key: string): key is Key {
  return key in ptBR;
}

export const dictionaries = dicts;
