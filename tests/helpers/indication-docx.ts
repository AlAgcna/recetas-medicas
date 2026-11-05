import { strToU8, zipSync } from 'fflate';

// Exclusivamente sintético. Nunca copiar aquí documentos del consultorio.
export const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function exampleIndicationDocx(body = '<w:p><w:r><w:t>Indicación ficticia sin validez médica.</w:t></w:r></w:p>', extra: Record<string, Uint8Array> = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${wordNamespace}"><w:body>${body}</w:body></w:document>`),
    ...extra,
  });
}
export function exampleWordFile(bytes = exampleIndicationDocx(), name = 'indicacion-ficticia.docx') {
  return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
