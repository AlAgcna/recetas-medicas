import { describe, expect, it } from 'vitest';
import { indicationHistory, indicationHistoryDate, type ImportedIndication, type Publication } from '../src/shared/contracts';

const publication: Publication = { id: 'vigente', patientId: 'ficha', scope: 'patient', kind: 'indication',
  title: 'Vigente ficticia', content: 'Texto ficticio', active: true, publishedAt: Date.parse('2025-02-10T02:30:00Z') };
const imported: ImportedIndication = { id: 'importada', patientId: 'ficha', title: 'Histórica ficticia', content: 'Texto ficticio',
  documentDate: '2024-01-12', importedAt: Date.parse('2026-11-05T12:00:00Z'), originalName: 'ficticio.docx', sha256: 'a'.repeat(64), size: 100 };

describe('historial profesional combinado', () => {
  it('ordena por la fecha documental, no por la carga, y deja las desconocidas al final', () => {
    const entries = indicationHistory({ publications: [publication], importedIndications: [
      { ...imported, id: 'sin-fecha', documentDate: null }, imported,
      { ...imported, id: 'ultima', documentDate: '2025-02-10' },
    ] });
    // La publicación de las 02:30 UTC corresponde al 9 de febrero en La Rioja.
    expect(entries.map(entry => entry.value.id)).toEqual(['ultima', 'vigente', 'importada', 'sin-fecha']);
    expect(indicationHistoryDate(entries[0])).toBe('10 de febrero de 2025');
    expect(indicationHistoryDate(entries.at(-1)!)).toBe('Fecha del documento desconocida');
  });
  it('excluye recetas y general y permite usar la importada como base sin publicarla', () => {
    const entries = indicationHistory({ publications: [{ ...publication, scope: 'general', patientId: null }, { ...publication, kind: 'prescription' }], importedIndications: [imported] });
    expect(entries).toEqual([{ source: 'import', value: imported }]);
    expect(imported).not.toHaveProperty('active');
    expect(imported).not.toHaveProperty('publishedAt');
  });
});
