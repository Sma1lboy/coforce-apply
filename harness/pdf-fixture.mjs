const pdfFixture = (label, pages, full = true, size = 20) => {
  const safe = label.replace(/[()\\]/g, '');
  const bottom = full ? ' BT /F1 12 Tf 72 40 Td (page filled to the bottom margin) Tj ET' : '';
  const stream = `BT /F1 ${size} Tf 72 720 Td (${safe}) Tj ET${bottom}`;
  const pageObjects = Array.from({ length: pages }, (_, index) => 4 + (index * 2));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjects.map(number => `${number} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageObjects.flatMap(pageObject => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ]),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
};

// `size` exists so a caller can draw a full bullet sentence as the page's text
// layer (20pt runs off the media box); the extraction gate needs that layer to
// carry the real bullet, not a short label.
export const onePagePdf = (label, full = true, size = 20) =>
  pdfFixture(label, 1, full, size);

export const twoPagePdf = (label, full = true, size = 20) =>
  pdfFixture(label, 2, full, size);
