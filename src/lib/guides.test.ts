import { describe, expect, it } from 'vitest';
import { PAGE_GUIDES, TOUR } from './guides';
import { ptBR } from './locales/pt-BR';

describe('guias', () => {
  it('todo passo tem título e texto nos dicionários', () => {
    const all = [...TOUR, ...Object.values(PAGE_GUIDES).flat()];
    for (const s of all) {
      expect(ptBR, `${s.key}.t`).toHaveProperty([`${s.key}.t`]);
      expect(ptBR, `${s.key}.b`).toHaveProperty([`${s.key}.b`]);
    }
  });
});
