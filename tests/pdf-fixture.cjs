// Small deterministic PDF: two pages, standard fonts, vector graphics and an inert script action.
function pdfFixture(label = "Owlet PDF review") {
  const stream = (text) =>
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /OpenAction 8 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 640] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    stream(
      `0.1 0.35 0.65 rg 32 460 416 60 re f\n0 0 0 rg BT /F1 24 Tf 32 570 Td (${label}) Tj /F1 14 Tf 0 -32 Td (Selectable text, rendered locally.) Tj ET`,
    ),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 640] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream(
      "BT /F1 24 Tf 32 570 Td (Second page) Tj /F1 14 Tf 0 -32 Td (Page navigation works.) Tj ET",
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /S /JavaScript /JS (globalThis.__pdfScriptRan = true) >>",
  ];
  let result = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    result += `${String(offset).padStart(10, "0")} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(result);
}
module.exports = { pdfFixture };
