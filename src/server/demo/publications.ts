import type { Publication, PublicationInput, PatientPublication } from '../../shared/contracts';
import type { DemoStore } from './store';

export function activeIndication(store: DemoStore, patientId: string | null): Publication | null {
  const scope = patientId === null ? 'general' : 'patient';
  return [...store.publications.values()].find(item =>
    item.active && item.kind === 'indication' && item.scope === scope && item.patientId === patientId) ?? null;
}

export function publish(store: DemoStore, input: PublicationInput, patientId: string | null, expectedActiveId: string | null, now: number) {
  if (patientId === null && input.kind !== 'indication') throw new Error('Una receta no puede ser general.');
  const previous = input.kind === 'indication' ? activeIndication(store, patientId) : null;
  if (input.kind === 'indication' && expectedActiveId !== (previous?.id ?? null)) return null;
  const publication: Publication = {
    ...input, id: crypto.randomUUID(), patientId, scope: patientId === null ? 'general' : 'patient',
    publishedAt: now, active: true,
  };
  // Sección crítica síncrona de un proceso local. La implementación D1 futura
  // necesita una operación transaccional/condicional y unicidad por ámbito.
  if (previous) store.publications.set(previous.id, { ...previous, active: false, supersededAt: now });
  store.publications.set(publication.id, publication);
  return { publication, replacedId: previous?.id ?? null };
}

export function visiblePublications(store: DemoStore, patientId: string): Publication[] {
  const general = activeIndication(store, null);
  const specific = activeIndication(store, patientId);
  const prescriptions = [...store.publications.values()].filter(item =>
    item.active && item.kind === 'prescription' && item.scope === 'patient' && item.patientId === patientId);
  return [...(general ? [general] : []), ...(specific ? [specific] : []), ...prescriptions];
}

export function patientProjection(publication: Publication): PatientPublication {
  const { id, kind, title, content, publishedAt, scope, pdf } = publication;
  return { id, kind, title, content, publishedAt, scope, ...(pdf ? { pdf } : {}) };
}
