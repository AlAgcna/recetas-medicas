import { test, expect, type Page } from '@playwright/test';

async function enterDoctor(page: Page) {
  await page.goto('/profesional/ingreso');
  await page.getByRole('button', { name: 'Entrar a la demostración' }).click();
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
}

async function chooseInsurance(page: Page, search: string, name: string) {
  await page.getByRole('combobox', { name: 'Obra social', exact: true }).fill(search);
  await page.getByRole('option', { name, exact: true }).click();
}

async function enterPatient(page: Page, dni: string) {
  await page.goto('/pacientes/ingreso');
  await page.getByLabel('DNI', { exact: true }).fill(dni);
  await page.getByRole('button', { name: 'Solicitar código', exact: true }).click();
  // El buzón simulado pide el DNI otra vez: es una pieza aparte del ingreso real,
  // que en producción no existe.
  await page.locator('.demo-inbox').getByLabel('DNI').fill(dni);
  await page.getByRole('button', { name: 'Ver mensaje simulado' }).click();
  await page.getByLabel('Código de acceso', { exact: true }).fill((await page.locator('.demo-code strong').textContent())!);
  await page.getByRole('button', { name: 'Entrar a mi portal' }).click();
}

test('inicio y búsqueda del consultorio con datos ficticios', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Soy la médica' })).toBeVisible();
  const logo = page.getByRole('img', { name: 'Consultorio, portal clínico' });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await enterDoctor(page);
  await page.getByLabel('Buscar paciente', { exact: true }).fill('00000001');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ejemplo, Ana', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Demostración, Luis', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-pacientes.png', fullPage: true });
});

test('autoguarda el borrador, finaliza la consulta y conserva los campos', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT'].includes(request.method()) && request.url().includes('/consultations')) writes.push(request.postDataJSON().status);
  });
  await enterDoctor(page);
  await page.getByRole('link', { name: 'Nuevo paciente', exact: true }).click();
  await page.getByLabel('DNI', { exact: false }).fill('00000101');
  await page.getByLabel('WhatsApp', { exact: false }).fill('+5493800000101');
  await page.getByLabel('Nombre', { exact: true }).fill('Rosa');
  await page.getByLabel('Apellido', { exact: true }).fill('Prueba');
  await chooseInsurance(page, 'pami', 'PAMI');
  await page.getByRole('button', { name: 'Guardar paciente' }).click();
  await expect(page.getByRole('heading', { name: 'Rosa Prueba', exact: true })).toBeVisible();
  await expect(page.locator('.patient-summary').getByText('PAMI', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Nueva consulta', exact: true }).first().click();
  await page.getByLabel('Motivo de consulta', { exact: true }).fill('Motivo ficticio del prototipo');
  await expect(page.locator('.editor-status .badge-green')).toContainText('Borrador guardado a las');
  expect(writes).toEqual(['draft']);
  await page.getByRole('link', { name: 'Volver a la ficha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rosa Prueba', exact: true })).toBeVisible();
  await expect(page.locator('.consultation-row').first()).toContainText('Borrador');
  await page.locator('.consultation-row').first().click();
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toHaveValue('Motivo ficticio del prototipo');
  await page.getByLabel('Examen físico', { exact: true }).fill('Examen ficticio');
  await page.getByLabel('Diagnóstico', { exact: true }).fill('Registro sin validez clínica');
  await page.getByLabel('Peso', { exact: true }).fill('70');
  await page.getByLabel('Talla', { exact: true }).fill('170');
  await page.getByLabel('Perímetro abdominal', { exact: true }).fill('92');
  await expect(page.getByText('El IMC calculado es 24,2 kg/m²')).toBeVisible();
  await page.getByRole('button', { name: 'Revisar y finalizar' }).click();
  await expect(page.getByRole('heading', { name: '¿Finalizar esta consulta?', exact: true })).toBeVisible();
  expect(writes.every(status => status === 'draft')).toBe(true);
  await page.getByRole('button', { name: 'Confirmar finalización' }).click();
  await expect(page.getByText('Consulta finalizada. No se publicó información en el portal del paciente.')).toBeVisible();
  expect(writes.filter(status => status === 'finalized')).toEqual(['finalized']);
  await page.locator('.consultation-row').first().click();
  await expect(page.getByRole('heading', { name: 'Consulta finalizada', exact: true })).toBeVisible();
  await expect(page.getByText('Registro sin validez clínica', { exact: true })).toBeVisible();
  await expect(page.getByText('92 cm', { exact: true })).toBeVisible();
  await expect(page.getByText('24,2 kg/m²', { exact: true })).toBeVisible();
  await expect(page.getByText('No registrado', { exact: true })).toHaveCount(6);
});

test('indica qué campo falta para finalizar y lleva el foco hasta él', async ({ page, baseURL }) => {
  await enterDoctor(page);
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: { dni: '00000109', whatsapp: '+5493800000109', firstName: 'Elena', lastName: 'Validación' } });
  expect(created.ok()).toBe(true);
  const { patient } = await created.json();
  await page.goto(`/profesional/pacientes/${patient.id}/consultas/nueva`);
  await page.getByRole('button', { name: 'Revisar y finalizar' }).click();
  await expect(page.getByRole('alert')).toContainText('Motivo de consulta: Completá este campo antes de finalizar.');
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Motivo de consulta', { exact: true }).fill('Motivo ficticio');
  await page.getByRole('button', { name: 'Revisar y finalizar' }).click();
  await expect(page.getByRole('alert')).toContainText('Examen físico: Completá este campo antes de finalizar.');
  await expect(page.getByLabel('Examen físico', { exact: true })).toBeFocused();
  await page.getByLabel('Examen físico', { exact: true }).fill('Examen ficticio');
  await page.getByRole('button', { name: 'Revisar y finalizar' }).click();
  await expect(page.getByRole('alert')).toContainText('Diagnóstico: Completá este campo antes de finalizar.');
  await expect(page.getByLabel('Diagnóstico', { exact: true })).toBeFocused();
  await page.getByLabel('Diagnóstico', { exact: true }).fill('Diagnóstico ficticio');
  await page.getByRole('button', { name: 'Revisar y finalizar' }).click();
  await expect(page.getByRole('heading', { name: '¿Finalizar esta consulta?', exact: true })).toBeVisible();
});

test('corrige una consulta finalizada con una enmienda y conserva la versión anterior', async ({ page, baseURL }) => {
  await enterDoctor(page);
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: { dni: '00000105', whatsapp: '+5493800000105', firstName: 'Elsa', lastName: 'Enmienda' } });
  expect(created.ok()).toBe(true);
  const { patient } = await created.json();
  const recorded = await page.request.post(`/api/doctor/patients/${patient.id}/consultations`, { headers, data: { date: '2026-10-05', vitals: { systolic: 120 }, reason: 'Motivo original', examination: 'Examen original', diagnosis: 'Diagnóstico original', status: 'finalized' } });
  expect(recorded.ok()).toBe(true);
  await page.goto(`/profesional/pacientes/${patient.id}`);
  await expect(page.locator('.consultation-row')).toHaveCount(1);
  await page.locator('.consultation-row').first().click();
  await expect(page.getByRole('heading', { name: 'Consulta finalizada', exact: true })).toBeVisible();
  await expect(page.getByText('Diagnóstico original', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enmendar esta consulta' }).click();
  await expect(page.getByRole('heading', { name: 'Enmendar consulta', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  await expect(page.getByRole('alert')).toContainText('Escribí el motivo de la enmienda.');
  await page.getByLabel('Diagnóstico', { exact: true }).fill('Diagnóstico corregido en la enmienda');
  await page.getByLabel('Motivo de la enmienda').fill('Se transcribió mal el diagnóstico');
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  await expect(page.getByRole('heading', { name: '¿Registrar esta enmienda?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar enmienda' }).click();
  await expect(page.getByText('Enmienda registrada. La versión anterior se conserva en el historial de la consulta.')).toBeVisible();
  await expect(page.locator('.consultation-row')).toHaveCount(1);
  await expect(page.locator('.consultation-row').first()).toContainText('Enmendada');
  await page.locator('.consultation-row').first().click();
  await expect(page.getByText('Diagnóstico corregido en la enmienda', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Historial de enmiendas', exact: true })).toBeVisible();
  await expect(page.getByText('Se transcribió mal el diagnóstico', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: /Ver la versión reemplazada/ }).click();
  await expect(page.locator('.form-card .alert')).toContainText('Esta versión fue reemplazada');
  await expect(page.getByText('Diagnóstico original', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enmendar esta consulta' })).toHaveCount(0);
});

test('reintenta el borrador sin conexión y advierte antes de salir sin guardarlo', async ({ page }) => {
  let failures = 1;
  await page.route('**/consultations**', route => (failures-- > 0 ? route.abort() : route.continue()));
  await enterDoctor(page);
  await page.getByRole('heading', { name: 'Ejemplo, Ana' }).click();
  await page.getByRole('link', { name: 'Nueva consulta', exact: true }).click();
  await page.getByLabel('Motivo de consulta', { exact: true }).fill('Cambio ficticio sin guardar');
  await expect(page.locator('.editor-status .badge-amber')).toContainText('Sin guardar; se reintenta');
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar el borrador');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: 'Volver a la ficha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nueva consulta', exact: true })).toBeVisible();
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toHaveValue('Cambio ficticio sin guardar');
  await expect(page.locator('.editor-status .badge-green')).toContainText('Borrador guardado a las', { timeout: 20_000 });
});

test('conserva el texto cuando la sesión vence al guardar', async ({ page }) => {
  await enterDoctor(page);
  await page.getByRole('heading', { name: 'Ejemplo, Ana' }).click();
  await page.getByRole('link', { name: 'Nueva consulta', exact: true }).click();
  await page.getByLabel('Motivo de consulta', { exact: true }).fill('Texto que no debe perderse');
  await expect(page.locator('.editor-status .badge-green')).toContainText('Borrador guardado a las');
  await page.evaluate(() => fetch('/api/doctor/logout', { method: 'POST', headers: { 'X-Portal-Request': '1' } }).then(response => response.status));
  await page.getByLabel('Examen físico', { exact: true }).fill('Cambio posterior al cierre de sesión');
  await expect(page.locator('.editor-status .badge-amber')).toContainText('Sesión vencida');
  await expect(page.getByRole('alert')).toContainText('Tu sesión terminó y el borrador no se guardó');
  await expect(page.getByLabel('Motivo de consulta', { exact: true })).toHaveValue('Texto que no debe perderse');
  await expect(page.getByLabel('Examen físico', { exact: true })).toHaveValue('Cambio posterior al cierre de sesión');
});

test('vista previa, publicación y acceso autónomo con código simulado', async ({ page }) => {
  const downloads: string[] = [];
  page.on('request', request => { if (request.url().includes('/download')) downloads.push(request.url()); });
  await enterDoctor(page);
  await page.getByRole('heading', { name: 'Ejemplo, Ana' }).click();
  await page.getByRole('tab', { name: /Indicaciones y Recetas/ }).click();
  await page.getByRole('link', { name: 'Añadir Indicación/Receta', exact: true }).click();
  await page.getByRole('button', { name: 'Crear una indicación' }).click();
  await page.getByRole('button', { name: 'Crear desde cero' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Entrega de prueba del recorrido');
  await page.getByLabel('Indicaciones para el paciente', { exact: true }).fill('Contenido ficticio, no es consejo médico.\nSegunda línea de ejemplo para leer en pantalla.');
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await expect(page.getByText('Vista previa · Todavía no publicado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar publicación' })).toBeDisabled();
  await page.getByLabel('Confirmo el reemplazo de la indicación específica activa y su conservación en el historial.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirmar publicación' }).click();
  await expect(page.getByText('Documento publicado. El paciente puede acceder sin autorización adicional.')).toBeVisible();
  await enterPatient(page, '00000001');
  await expect(page.getByRole('heading', { name: 'Hola, Ana', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entrega de prueba del recorrido', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Indicaciones', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Entrega de prueba del recorrido' })).toContainText('Segunda línea de ejemplo para leer en pantalla.');
  const signature = page.getByRole('article', { name: 'Entrega de prueba del recorrido' }).getByRole('img', { name: 'Firma de la médica' });
  await expect(signature).toBeVisible();
  expect(await signature.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText('Antecedentes de ejemplo.docx')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('article', { name: 'Entrega de prueba del recorrido' }).getByRole('link', { name: 'Descargar indicación', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('indicacion-especifica.txt');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tus indicaciones, a mano' })).toBeVisible();
});

test('el portal funciona en una pantalla móvil sin desbordar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pacientes/ingreso');
  await expect(page.getByRole('heading', { name: 'Tus indicaciones, a mano' })).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-movil.png', fullPage: true });
});

test('el desplegable conserva una cobertura que no está en el catálogo', async ({ page }) => {
  await enterDoctor(page);
  await page.getByRole('link', { name: 'Nuevo paciente', exact: true }).click();
  await page.getByLabel('DNI', { exact: false }).fill('00000103');
  await page.getByLabel('WhatsApp', { exact: false }).fill('+5493800000103');
  await page.getByLabel('Nombre', { exact: true }).fill('Carla');
  await page.getByLabel('Apellido', { exact: true }).fill('Ejemplo');
  await chooseInsurance(page, 'otra', 'Otra');
  await page.getByLabel('Nombre de la obra social', { exact: true }).fill('Cobertura de prueba especial');
  await page.getByRole('button', { name: 'Guardar paciente' }).click();
  await expect(page.locator('.patient-summary').getByText('Cobertura de prueba especial', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Completar datos/ }).click();
  await expect(page.getByRole('combobox', { name: 'Obra social', exact: true })).toHaveValue('Otra');
  await expect(page.getByLabel('Nombre de la obra social', { exact: true })).toHaveValue('Cobertura de prueba especial');
});

test('estadísticas mensuales, pacientes únicos y mes sin consultas', async ({ page, baseURL }) => {
  await enterDoctor(page);
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: { dni: '00000102', whatsapp: '+5493800000102', firstName: 'Eva', lastName: 'Estadística', insurance: 'PAMI' } });
  expect(created.status()).toBe(201);
  const { patient } = await created.json();
  for (const date of ['2025-08-20', '2025-08-21']) {
    const response = await page.request.post(`/api/doctor/patients/${patient.id}/consultations`, { headers, data: { date, vitals: {}, reason: 'Ejemplo', examination: 'Ejemplo', diagnosis: 'Ejemplo', status: 'finalized' } });
    expect(response.status()).toBe(201);
  }
  await page.getByRole('link', { name: 'Estadísticas', exact: true }).click();
  await page.getByLabel('Mes de atención', { exact: true }).fill('2025-08');
  await expect(page.getByRole('article', { name: 'Pacientes atendidos', exact: true }).locator('.metric-value')).toHaveText('1');
  await expect(page.getByRole('article', { name: 'Consultas finalizadas', exact: true }).locator('.metric-value')).toHaveText('2');
  await expect(page.getByRole('article', { name: 'Recetas publicadas', exact: true }).locator('.metric-value')).toHaveText('0');
  await expect(page.locator('.leading-insurance').getByText('PAMI', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /PAMI/ })).toContainText('100 %');
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-estadisticas.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByLabel('Mes de atención', { exact: true }).fill('2099-01');
  await expect(page.getByRole('heading', { name: 'No hay consultas finalizadas en este mes' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Pacientes atendidos', exact: true }).locator('.metric-value')).toHaveText('0');
});

test('las recetas PDF siguen disponibles para descargar desde el celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterPatient(page, '00000002');
  await expect(page.getByRole('heading', { name: 'Recetas', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar receta (PDF)', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('receta.pdf');
});

test('la búsqueda de coberturas admite tildes, teclado y cancelación sin enviar el formulario', async ({ page }) => {
  await enterDoctor(page);
  await page.getByRole('link', { name: 'Nuevo paciente', exact: true }).click();
  const combo = page.getByRole('combobox', { name: 'Obra social', exact: true });
  await combo.fill('policia');
  await expect(page.getByRole('option', { name: 'Policía Federal', exact: true })).toBeVisible();
  await combo.press('Enter');
  await expect(combo).toHaveValue('Policía Federal');
  await expect(page.getByRole('heading', { name: 'Nuevo paciente', exact: true })).toBeVisible();
  await combo.fill('PREVENCION');
  await expect(page.getByRole('option', { name: 'Prevención Salud', exact: true })).toBeVisible();
  await combo.press('Escape');
  await expect(combo).toHaveValue('Policía Federal');
  await chooseInsurance(page, 'luz', 'Mutual de Luz y Fuerza');
  await expect(combo).toHaveValue('Mutual de Luz y Fuerza');
  await combo.fill('osunlar');
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-coberturas.png', fullPage: true });
});

test('crea una indicación nueva a partir de la última sin modificar la anterior', async ({ page, baseURL }) => {
  await enterDoctor(page);
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: { dni: '00000111', whatsapp: '+5493800000111', firstName: 'Marta', lastName: 'Seguimiento' } });
  expect(created.status()).toBe(201);
  const { patient } = await created.json();
  const first = await page.request.post(`/api/doctor/patients/${patient.id}/publications`, {
    headers, data: { kind: 'indication', title: 'Indicación inicial', content: 'Contenido inicial ficticio', expectedActiveId: null },
  });
  expect(first.status()).toBe(201);
  const firstPublication = (await first.json()).publication;

  await page.goto(`/profesional/pacientes/${patient.id}/entrega`);
  await expect(page.getByLabel('Título', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Crear una indicación' }).click();
  await expect(page.getByText('Última indicación: «Indicación inicial»')).toBeVisible();
  await page.getByRole('button', { name: 'Crear a partir de la última indicación' }).click();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Indicación inicial');
  await expect(page.getByLabel('Indicaciones para el paciente', { exact: true })).toHaveValue('Contenido inicial ficticio');
  await expect(page.getByRole('status')).toContainText('la anterior no se modifica');

  // La copia es sólo texto: hasta confirmar, la anterior sigue activa e intacta.
  const before = await (await page.request.get(`/api/doctor/patients/${patient.id}`)).json();
  expect(before.publications).toEqual([firstPublication]);

  await page.getByLabel('Título', { exact: true }).fill('Indicación de seguimiento');
  await page.getByLabel('Indicaciones para el paciente', { exact: true }).fill('Contenido actualizado ficticio');
  await page.getByRole('button', { name: 'Vista previa' }).click();
  await page.getByLabel('Confirmo el reemplazo de la indicación específica activa y su conservación en el historial.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirmar publicación' }).click();
  await expect(page.getByText('Documento publicado.')).toBeVisible();

  const detail = await (await page.request.get(`/api/doctor/patients/${patient.id}`)).json();
  const indications = detail.publications.filter((item: { kind: string }) => item.kind === 'indication');
  expect(indications).toHaveLength(2);
  expect(indications.filter((item: { active: boolean }) => item.active)).toHaveLength(1);
  expect(indications.find((item: { active: boolean }) => item.active).title).toBe('Indicación de seguimiento');
  expect(indications.find((item: { id: string }) => item.id === firstPublication.id))
    .toMatchObject({ title: 'Indicación inicial', content: 'Contenido inicial ficticio', active: false });
});

test('tarjetas, inicio desde cero y receta PDF sin publicar durante la elección', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDoctor(page);
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: { dni: '00000112', whatsapp: '+5493800000112', firstName: 'Sara', lastName: 'Tarjetas' } });
  expect(created.status()).toBe(201);
  const { patient } = await created.json();
  const publications: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/(publications|prescriptions)$/.test(new URL(request.url()).pathname)) publications.push(request.url());
  });
  await page.goto(`/profesional/pacientes/${patient.id}`);
  await page.getByRole('tab', { name: /Indicaciones y Recetas/ }).click();
  await expect(page.getByText('Todavía no hay indicaciones para este paciente')).toBeVisible();
  await page.getByRole('link', { name: 'Añadir Indicación/Receta', exact: true }).click();
  await expect(page.getByLabel('Título', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('PDF original de la receta', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-tarjetas-movil.png', fullPage: true });
  await page.getByRole('button', { name: 'Crear una indicación' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '¿Cómo querés crear la indicación?' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Crear a partir de la última indicación' })).toBeDisabled();
  await page.getByRole('button', { name: 'Volver a elegir el tipo' }).click();
  await page.getByRole('button', { name: 'Crear una indicación' }).click();
  await page.getByRole('button', { name: 'Crear desde cero' }).click();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Indicaciones para el paciente', { exact: true })).toHaveValue('');
  await page.getByLabel('Título', { exact: true }).fill('Texto ficticio sin publicar');
  await page.getByLabel('Indicaciones para el paciente', { exact: true }).fill('Debe conservarse al cancelar el cambio.');
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await page.getByRole('button', { name: 'Volver a editar' }).click();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Texto ficticio sin publicar');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Cambiar elección' }).click();
  await expect(page.getByLabel('Indicaciones para el paciente', { exact: true })).toHaveValue('Debe conservarse al cancelar el cambio.');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cambiar elección' }).click();
  await page.getByRole('button', { name: 'Subir una receta' }).click();
  await expect(page.getByRole('heading', { name: 'Subir receta en PDF' })).toBeFocused();
  await expect(page.getByLabel('Indicaciones para el paciente', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Descripción de la receta', { exact: true })).toBeVisible();
  const sample = await page.request.get('/api/doctor/sample-prescription');
  expect(sample.ok()).toBe(true);
  await page.getByLabel('PDF original de la receta', { exact: true }).setInputFiles({ name: 'receta-ficticia.pdf', mimeType: 'application/pdf', buffer: await sample.body() });
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar publicación' })).toBeDisabled();
  await page.getByRole('button', { name: 'Volver a editar' }).click();
  await expect(page.getByText(/Archivo seleccionado: receta-ficticia.pdf/)).toBeVisible();
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  expect(publications).toEqual([]);
  const before = await (await page.request.get(`/api/doctor/patients/${patient.id}`)).json();
  expect(before.publications).toEqual([]);
  await page.getByLabel('Confirmo que revisé el paciente y el PDF seleccionado. En esta demo el documento es ficticio.', { exact: true }).check();
  await page.getByRole('button', { name: 'Confirmar publicación' }).click();
  await expect(page.getByText('Documento publicado.')).toBeVisible();
  expect(publications).toHaveLength(1);
  await page.getByRole('tab', { name: /Indicaciones y Recetas/ }).click();
  await expect(page.getByRole('link', { name: 'Descargar PDF original', exact: true })).toBeVisible();
  const detail = await (await page.request.get(`/api/doctor/patients/${patient.id}`)).json();
  expect(detail.publications).toHaveLength(1);
  expect(detail.publications[0].kind).toBe('prescription');
});

test('una general y una específica, descarga opcional y reemplazos con historial', async ({ page, baseURL }) => {
  await enterDoctor(page);
  const headers = { Origin: baseURL!, 'X-Portal-Request': '1' };
  const created = await page.request.post('/api/doctor/patients', { headers, data: { dni: '00000104', whatsapp: '+5493800000104', firstName: 'Julia', lastName: 'Ejemplo', insurance: 'APOS', contactVerified: true } });
  expect(created.status()).toBe(201);
  const { patient } = await created.json();

  async function publishGeneral(title: string, content: string) {
    await page.goto('/profesional/indicacion-general');
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Indicaciones generales para todos los pacientes', { exact: true }).fill(content);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
    await expect(page.getByText('Todos los pacientes', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar publicación' })).toBeDisabled();
    await page.getByLabel('Confirmo que esta indicación general no contiene datos personales y se publicará para todos los pacientes.', { exact: true }).check();
    await page.getByRole('button', { name: 'Confirmar publicación' }).click();
    await expect(page.getByText('Indicación general publicada. Está disponible para todos los pacientes al ingresar a su portal.', { exact: true })).toBeVisible();
  }

  async function publishSpecific(title: string, replacing: boolean) {
    await page.goto(`/profesional/pacientes/${patient.id}/entrega`);
    await page.getByRole('button', { name: 'Crear una indicación' }).click();
    await page.getByRole('button', { name: 'Crear desde cero' }).click();
    await expect(page.getByLabel('Título', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Indicaciones para el paciente', { exact: true })).toHaveValue('');
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Indicaciones para el paciente', { exact: true }).fill(`Contenido específico ficticio: ${title}`);
    await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
    if (replacing) {
      await expect(page.getByRole('button', { name: 'Confirmar publicación' })).toBeDisabled();
      await page.getByLabel('Confirmo el reemplazo de la indicación específica activa y su conservación en el historial.', { exact: true }).check();
    }
    await page.getByRole('button', { name: 'Confirmar publicación' }).click();
    await expect(page.getByText('Documento publicado. El paciente puede acceder sin autorización adicional.')).toBeVisible();
  }

  await publishGeneral('General inicial del recorrido', 'Texto general ficticio, sin información de personas.');
  await publishSpecific('Específica inicial de Julia', false);
  await enterPatient(page, '00000104');
  await expect(page.getByRole('heading', { name: 'Hola, Julia', exact: true })).toBeVisible();
  await expect(page.locator('.portal-indication')).toHaveCount(2);
  const first = await (await page.request.get('/api/patient/publications')).json();
  const firstIds = first.publications.filter((item: { kind: string }) => item.kind === 'indication').map((item: { id: string }) => item.id);
  const download = page.waitForEvent('download');
  await page.getByRole('article', { name: 'General inicial del recorrido' }).getByRole('link', { name: 'Descargar indicación', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('indicacion-general.txt');

  await publishGeneral('General vigente del recorrido', 'Texto general actualizado, solo de ejemplo.');
  await publishSpecific('Específica vigente de Julia', true);
  await page.goto('/pacientes');
  await expect(page.locator('.portal-indication')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'General vigente del recorrido' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Específica vigente de Julia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'General inicial del recorrido' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Específica inicial de Julia' })).toHaveCount(0);
  for (const id of firstIds) expect((await page.request.get(`/api/patient/publications/${id}/download`)).status()).toBe(404);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-indicaciones.png', fullPage: true });

  await page.goto(`/profesional/pacientes/${patient.id}`);
  await page.getByRole('tab', { name: /Indicaciones y Recetas/ }).click();
  const general = page.locator('.general-indication-summary');
  await expect(general).not.toHaveAttribute('open');
  await expect(general.locator('.preserve-lines')).toBeHidden();
  await general.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(general.locator('.preserve-lines')).toHaveText('Texto general actualizado, solo de ejemplo.');
  await expect(general.locator('.preserve-lines')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(general.locator('.preserve-lines')).toBeHidden();

  const timeline = page.getByRole('list', { name: 'Evolución de indicaciones' });
  await expect(timeline.locator('summary strong')).toHaveText(['Específica vigente de Julia', 'Específica inicial de Julia']);
  const versions = timeline.locator('details');
  await expect(versions).toHaveCount(2);
  for (const version of await versions.all()) {
    await expect(version).not.toHaveAttribute('open');
    await expect(version.locator('summary time')).toBeVisible();
    await expect(version.locator('summary time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);
    await expect(version.locator('.preserve-lines')).toBeHidden();
    await version.locator('summary').click();
    await expect(version.locator('.preserve-lines')).toBeVisible();
  }
  await expect(versions.first().locator('summary')).toContainText('Vigente · Visible en el portal');
  await expect(versions.last().locator('summary')).toContainText('Histórica · No visible en el portal');
  await expect(versions.last()).toContainText('Reemplazada el');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/opencode/portal-clinico-evolucion-movil.png', fullPage: true });
});
