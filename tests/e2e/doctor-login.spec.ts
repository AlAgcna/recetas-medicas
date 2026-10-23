import { test, expect } from '@playwright/test';
import { createApp } from '../../src/server/app';
import type { OutgoingEmail } from '../../src/server/email/port';
import { d1Storage } from '../helpers/sqlite-d1';

test('ingreso real por correo: formulario, D1 y cookie de sesión', async ({ page, baseURL }) => {
  const { storage, database } = d1Storage();
  const mail: OutgoingEmail[] = [];
  const { app } = createApp({
    storage, origin: baseURL!, challengeSecret: 'secreto-solo-de-pruebas',
    cookie: { prefix: '', secure: false },
    health: { mode: 'test', persistent: true, whatsapp: false },
    doctorEmail: 'consultorio@ejemplo.test',
    sendEmail(email) { mail.push(email); },
    deliverCode() { throw new Error('No se envía SMS en esta prueba.'); },
  });
  // Montar la interfaz productiva en el Vite de pruebas, sin alterar la entrada
  // demo ni agregar atajos a producción. La API usa SQLite aislado, sin red.
  await page.route('**/src/web/main.tsx', route => route.fulfill({
    contentType: 'application/javascript',
    body: `import React from '/node_modules/.vite/deps/react.js';
      import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
      import { ProductionApp } from '/src/web/ProductionApp.tsx';
      import '/src/web/styles.css';
      ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(ProductionApp));`,
  }));
  const payloads: unknown[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const headers = await request.allHeaders();
    // Metadatos del proxy, sólo para esta API aislada de pruebas.
    headers['cf-connecting-ip'] = '192.0.2.1';
    headers['cf-ipcountry'] = 'AR';
    if (request.method() === 'POST') payloads.push(request.postDataJSON());
    const response = await app.request(request.url(), {
      method: request.method(), headers, body: request.postData() ?? undefined,
    });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  try {
    await page.goto('/profesional/ingreso');
    await page.getByRole('button', { name: 'Enviar código de acceso', exact: true }).click();
    await expect(page.getByLabel('Código', { exact: true })).toBeVisible();
    expect(mail).toHaveLength(1);
    const code = mail[0].text.match(/\b\d{6}\b/)![0];
    expect((await storage.getDoctorChallenge())?.attempts).toBe(0);
    await page.getByLabel('Código', { exact: true }).fill(code === '000000' ? '000001' : '000000');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Código incorrecto');
    expect((await storage.getDoctorChallenge())?.attempts).toBe(1);
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
    expect(payloads).toEqual([{ website: '' }, { code: code === '000000' ? '000001' : '000000' }, { code }]);
    const challenge = await storage.getDoctorChallenge();
    expect(challenge).toBeUndefined();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/profesional\/ingreso$/);
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()?.total).toBe(0);
  } finally {
    database.close();
  }
});
