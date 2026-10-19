// Listado solicitado para el consultorio. No implica convenios confirmados.
// «Otra» se presenta en el selector y se guarda con el nombre indicado.
export const insuranceOptions = [
  'OSDE',
  'Swiss Medical',
  'Federada Salud',
  'Sancor Salud',
  'OSUNLaR',
  'APOS',
  'OSPJN',
  'OSSEG',
  'OSUTHGRA',
  'PAMI',
  'Policía Federal',
  'DASUTEN',
  'OSSACRA',
  'Sanatorio Pasteur',
  'Particular',
  'Boreal',
  'Nobis',
  'Medicus Fuerzas de Seguridad',
  'Mutual de Luz y Fuerza',
  'Galeno',
  'Jerárquico Salud',
  'OSFATUN',
  'OSSBA',
  'Prevención Salud',
] as const;

export function insuranceKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

export function insuranceLabel(value: string) {
  const key = insuranceKey(value);
  if (!key) return 'Sin registrar';
  if (key === 'sin obra social') return 'Particular';
  return insuranceOptions.find(option => insuranceKey(option) === key) ?? value.trim().replace(/\s+/g, ' ');
}

export function isNamedInsurance(value: string) {
  return !['particular', 'sin obra social', 'sin registrar'].includes(insuranceKey(value));
}
