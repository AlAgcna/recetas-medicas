import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readIndicationDocx } from '../src/server/indication-docx';
import { sha256 } from '../src/server/file-input';
import { exampleIndicationDocx, exampleWordFile } from './helpers/indication-docx';

describe('lectura acotada e inerte de indicaciones Word', () => {
  it('extrae párrafos, tildes, saltos y tablas como texto y conserva cada byte del original', async () => {
    const bytes = exampleIndicationDocx('<w:p><w:r><w:t>Texto ficticio &amp; revisión</w:t><w:br/><w:t>Segunda línea.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Otra sección.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>', { 'word/media/image.png': new Uint8Array([0, 1, 2]) });
    const { preview, original } = await readIndicationDocx(exampleWordFile(bytes));
    expect(preview.content).toBe('Texto ficticio & revisión\nSegunda línea.\nOtra sección.');
    expect(preview.hasImages).toBe(true);
    expect(preview.sha256).toBe(await sha256(bytes));
    expect(original.bytes).toEqual(bytes);
    expect(original.originalName).toBe('indicacion-ficticia.docx');
  });
  it.each([
    ['macro', exampleIndicationDocx(undefined, { 'word/vbaProject.bin': strToU8('no ejecutar') })],
    ['objeto', exampleIndicationDocx(undefined, { 'word/embeddings/data.bin': new Uint8Array(1) })],
    ['externo', exampleIndicationDocx(undefined, { 'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship TargetMode="External" Target="https://ejemplo.test/privado"/></Relationships>') })],
    ['entidad', exampleIndicationDocx(undefined, { 'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY dato SYSTEM "file:///no-leer">]><x>&dato;</x>') })],
    ['XML mal formado', exampleIndicationDocx(undefined, { 'word/document.xml': strToU8('<w:document>') })],
    ['sin documento', zipSync({ 'otro.txt': strToU8('no es Word') })],
    ['imagen sin texto', exampleIndicationDocx('<w:p><w:drawing/></w:p>')],
    ['revisiones', exampleIndicationDocx('<w:ins><w:p><w:r><w:t>Cambio pendiente</w:t></w:r></w:p></w:ins>')],
    ['texto largo', exampleIndicationDocx(`<w:p><w:r><w:t>${'x'.repeat(5001)}</w:t></w:r></w:p>`)],
    ['XML excesivo', exampleIndicationDocx(undefined, { 'word/document.xml': strToU8('x'.repeat(1024 * 1024 + 1)) })],
    ['bomba de compresión', exampleIndicationDocx(undefined, { 'word/media/huge.png': new Uint8Array(25 * 1024 * 1024) })],
  ])('rechaza %s antes de guardar o ejecutar contenido', async (_label, bytes) => {
    await expect(readIndicationDocx(exampleWordFile(bytes))).rejects.toThrow();
  });
  it('rechaza extensiones, tamaños y contenedores falsos', async () => {
    await expect(readIndicationDocx(exampleWordFile(undefined, 'atajo.lnk'))).rejects.toThrow('.docx');
    await expect(readIndicationDocx(exampleWordFile(strToU8('no es zip')))).rejects.toThrow('reconocible');
    await expect(readIndicationDocx(exampleWordFile(new Uint8Array(5 * 1024 * 1024 + 1)))).rejects.toThrow('5 MB');
  });
});
