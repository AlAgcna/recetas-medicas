import { test, expect } from '@playwright/test';
import { exampleIndicationDocx } from '../helpers/indication-docx';

test('importa un Word al historial, permite copiarlo y nunca lo publica automáticamente', async ({ page, baseURL }) => {
  await page.goto('/profesional/ingreso');
  await page.getByRole('button', { name: 'Entrar a la demostración' }).click();
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: {
    dni: '00000113', whatsapp: '+5493800000113', firstName: 'Alba', lastName: 'Importación', contactVerified: true,
  } });
  expect(created.status()).toBe(201);
  const { patient } = await created.json();
  const bytes = exampleIndicationDocx('<w:p><w:r><w:t>Texto histórico ficticio &amp; revisión.</w:t></w:r></w:p><w:p><w:r><w:t>Segunda línea sin validez clínica.</w:t></w:r></w:p>');
  await page.goto(`/profesional/pacientes/${patient.id}`);
  await page.getByRole('tab', { name: /Indicaciones y Recetas/ }).click();
  await page.getByRole('link', { name: 'Importar indicación desde Word', exact: true }).click();
  await page.getByLabel('Word original de la indicación', { exact: true }).setInputFiles({ name: 'indicacion-ficticia.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes) });
  await page.getByRole('button', { name: 'Leer Word y revisar' }).click();
  await expect(page.getByLabel('Texto de la indicación histórica', { exact: true })).toHaveValue('Texto histórico ficticio & revisión.\nSegunda línea sin validez clínica.');
  await expect(page.getByLabel('Fecha de la indicación', { exact: true })).toHaveValue('');
  const before = await (await page.request.get(`/api/doctor/patients/${patient.id}`)).json();
  expect(before.importedIndications).toEqual([]);
  await page.getByLabel('Título de la indicación histórica', { exact: true }).fill('Indicación histórica revisada');
  await page.getByLabel('Fecha de la indicación', { exact: true }).fill('2024-02-10');
  await page.getByRole('button', { name: 'Revisar importación', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar importación al historial' })).toBeDisabled();
  await page.getByRole('button', { name: 'Volver a revisar' }).click();
  await expect(page.getByLabel('Fecha de la indicación', { exact: true })).toHaveValue('2024-02-10');
  await page.getByRole('button', { name: 'Revisar importación', exact: true }).click();
  await page.getByLabel('Confirmo que revisé el paciente, el texto y la fecha del documento.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirmar importación al historial' }).click();
  await expect(page.getByText('Indicación importada al historial. No se publicó ni se modificó la indicación vigente.')).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Evolución de indicaciones' });
  await expect(timeline).toContainText('10 de febrero de 2024');
  await expect(timeline).toContainText('Histórica importada · No visible en el portal');
  await timeline.locator('summary').click();
  await expect(timeline).toContainText('Texto histórico ficticio & revisión.');
  const download = page.waitForEvent('download');
  await timeline.getByRole('link', { name: 'Descargar Word original' }).click();
  expect((await download).suggestedFilename()).toBe('indicacion-original.docx');
  const detail = await (await page.request.get(`/api/doctor/patients/${patient.id}`)).json();
  expect(detail.publications).toEqual([]);
  expect(detail.importedIndications).toHaveLength(1);

  // La histórica se puede usar como base, pero sigue siendo una copia local.
  await page.getByRole('link', { name: 'Añadir Indicación/Receta', exact: true }).click();
  await page.getByRole('button', { name: 'Crear una indicación' }).click();
  await page.getByRole('button', { name: 'Crear a partir de la última indicación' }).click();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Indicación histórica revisada');
  await expect(page.getByLabel('Indicaciones para el paciente', { exact: true })).toHaveValue('Texto histórico ficticio & revisión.\nSegunda línea sin validez clínica.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: 'Volver a la ficha', exact: true }).click();

  // Un segundo intento del mismo original no crea otra entrada.
  await page.getByRole('tab', { name: /Indicaciones y Recetas/ }).click();
  await page.getByRole('link', { name: 'Importar indicación desde Word', exact: true }).click();
  await page.getByLabel('Word original de la indicación', { exact: true }).setInputFiles({ name: 'indicacion-ficticia.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes) });
  await page.getByRole('button', { name: 'Leer Word y revisar' }).click();
  await page.getByLabel('Se desconoce la fecha del documento', { exact: true }).check();
  await page.getByRole('button', { name: 'Revisar importación', exact: true }).click();
  await page.getByLabel('Confirmo que revisé el paciente, el texto y la fecha del documento.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirmar importación al historial' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Este Word ya está importado' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.goto('/pacientes/ingreso');
  await page.getByLabel('DNI', { exact: true }).fill('00000113');
  await page.getByRole('button', { name: 'Solicitar código', exact: true }).click();
  await page.locator('.demo-inbox').getByLabel('DNI').fill('00000113');
  await page.getByRole('button', { name: 'Ver mensaje simulado' }).click();
  await page.getByLabel('Código de acceso', { exact: true }).fill((await page.locator('.demo-code strong').textContent())!);
  await page.getByRole('button', { name: 'Entrar a mi portal' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Alba', exact: true })).toBeVisible();
  await expect(page.getByText('Indicación histórica revisada', { exact: true })).toHaveCount(0);
  const portal = await (await page.request.get('/api/patient/publications')).json();
  expect(JSON.stringify(portal)).not.toContain('Texto histórico ficticio');
});
