import type { PdfMetadata } from '../shared/contracts';

export function PdfIntegrity({ pdf }: { pdf: PdfMetadata }) {
  return <details className="pdf-integrity"><summary>Información de integridad del PDF</summary>
    <p>El portal conserva y entrega el archivo adjuntado, sin editarlo. Tamaño: {pdf.size.toLocaleString('es-AR')} bytes.</p>
    <span className="field-caption">HUELLA SHA-256 DEL ARCHIVO CONSERVADO</span><code>{pdf.sha256}</code>
    <p>Esta huella permite comparar archivos. No es una firma digital, no certifica la validez de la receta y no impide modificar una copia descargada. No verificamos firmas digitales.</p>
  </details>;
}
