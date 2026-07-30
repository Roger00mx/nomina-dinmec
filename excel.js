// excel.js — Generador de archivos .xlsx sin dependencias (Nómina DINMEC)
// Crea un ZIP (método almacenado, sin compresión) con el XML mínimo de Excel,
// con estilos: títulos, encabezados azul marino, bordes y formato de moneda.
const zlib = require('zlib');

// ---------- CRC32 (requerido por el formato ZIP) ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- ZIP (entradas sin compresión) ----------
function crearZip(archivos) { // archivos: [{ nombre, contenido (Buffer) }]
  const locales = [];
  const centrales = [];
  let offset = 0;
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, 'utf8');
    const datos = a.contenido;
    const crc = crc32(datos);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0);
    cab.writeUInt16LE(20, 4);        // versión
    cab.writeUInt16LE(0x0800, 6);    // UTF-8
    cab.writeUInt16LE(0, 8);         // sin compresión
    cab.writeUInt16LE(0, 10);        // hora
    cab.writeUInt16LE(0x5821, 12);   // fecha fija
    cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(datos.length, 18);
    cab.writeUInt32LE(datos.length, 22);
    cab.writeUInt16LE(nombre.length, 26);
    cab.writeUInt16LE(0, 28);
    locales.push(cab, nombre, datos);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x5821, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(datos.length, 20);
    cen.writeUInt32LE(datos.length, 24);
    cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrales.push(cen, nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const cuerpoCentral = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cuerpoCentral.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, cuerpoCentral, fin]);
}

// ---------- XML de Excel ----------
function xml(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="4">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  <font><b/><sz val="14"/><color rgb="FF1D3A5F"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1D3A5F"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFDF0E2"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left style="thin"><color rgb="FFB0B7C3"/></left><right style="thin"><color rgb="FFB0B7C3"/></right><top style="thin"><color rgb="FFB0B7C3"/></top><bottom style="thin"><color rgb="FFB0B7C3"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="0"/>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1"/>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="right"/></xf>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="1"/>
  <xf numFmtId="164" fontId="1" fillId="3" borderId="1"/>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1"/>
</cellXfs>
</styleSheet>`;

const ESTILO = { titulo: 1, enc: 2, txt: 3, num: 4, money: 5, moneyb: 6, txtb: 7 };

function hojaXml(hoja) {
  let cols = '';
  if (hoja.anchos && hoja.anchos.length) {
    cols = '<cols>' + hoja.anchos.map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  }
  let filas = '';
  for (const fila of hoja.filas) {
    filas += '<row>';
    for (const celda of fila) {
      if (celda == null) { filas += '<c/>'; continue; }
      const c = (typeof celda === 'object') ? celda : { v: celda };
      const s = ESTILO[c.t] ?? (typeof c.v === 'number' ? ESTILO.num : 0);
      if (typeof c.v === 'number' && c.t !== 'titulo' && c.t !== 'enc' && c.t !== 'txt' && c.t !== 'txtb') {
        filas += `<c s="${s}"><v>${c.v}</v></c>`;
      } else {
        filas += `<c s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
      }
    }
    filas += '</row>';
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${filas}</sheetData></worksheet>`;
}

function generarXlsx(hojas) { // hojas: [{ nombre, anchos, filas }]
  const archivos = [];
  archivos.push({
    nombre: '[Content_Types].xml',
    contenido: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`, 'utf8'),
  });
  archivos.push({
    nombre: '_rels/.rels',
    contenido: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, 'utf8'),
  });
  archivos.push({
    nombre: 'xl/workbook.xml',
    contenido: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${hojas.map((h, i) => `<sheet name="${xml(h.nombre.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`, 'utf8'),
  });
  archivos.push({
    nombre: 'xl/_rels/workbook.xml.rels',
    contenido: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hojas.map((h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, 'utf8'),
  });
  archivos.push({ nombre: 'xl/styles.xml', contenido: Buffer.from(ESTILOS, 'utf8') });
  hojas.forEach((h, i) => {
    archivos.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: Buffer.from(hojaXml(h), 'utf8') });
  });
  return crearZip(archivos);
}

module.exports = { generarXlsx };
