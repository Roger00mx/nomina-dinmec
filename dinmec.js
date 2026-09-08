// dinmec.js — enlace de solo lectura con dinmec-app (Supabase)
//
// Trae de la app de manufactura las horas extra autorizadas y los dias de
// vacaciones tomados en un periodo, y los cruza contra los empleados de nomina.
// NUNCA escribe en Supabase.
//
// Llaves: se configuran en Render -> Environment
//   SUPABASE_URL       = https://xxxxxxxx.supabase.co
//   SUPABASE_ANON_KEY  = eyJ...

// Llama a la funcion nomina_periodo(p_desde, p_hasta) de Supabase.
async function traer(desde, hasta) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const llave = process.env.SUPABASE_ANON_KEY || '';
  if (!base || !llave) {
    return { error: 'Faltan las variables SUPABASE_URL y SUPABASE_ANON_KEY en Render.' };
  }

  let respuesta;
  try {
    respuesta = await fetch(base + '/rest/v1/rpc/nomina_periodo', {
      method: 'POST',
      headers: {
        apikey: llave,
        Authorization: 'Bearer ' + llave,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_desde: desde, p_hasta: hasta }),
    });
  } catch (e) {
    return { error: 'No se pudo contactar a Supabase: ' + e.message };
  }

  const texto = await respuesta.text();
  if (!respuesta.ok) {
    return { error: 'Supabase respondio ' + respuesta.status + ': ' + texto.slice(0, 300) };
  }

  let filas;
  try { filas = JSON.parse(texto); }
  catch (e) { return { error: 'Supabase devolvio una respuesta que no es JSON' }; }
  if (!Array.isArray(filas)) return { error: 'Se esperaba una lista de Supabase' };
  return { filas };
}

// Numero de empleado normalizado (quita ceros a la izquierda, guiones, letras)
function claveNum(valor) {
  const s = String(valor == null ? '' : valor).trim();
  if (!s) return '';
  const digitos = s.replace(/\D/g, '');
  return digitos ? String(parseInt(digitos, 10)) : s.toLowerCase();
}

// Nombre normalizado: sin acentos, sin dobles espacios, minusculas
function claveNombre(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Cruza las filas de dinmec-app contra los empleados de nomina.
// Enlaza primero por numero de empleado; si no hay, intenta por nombre.
function cruzar(filas, empleados) {
  const lista = Array.isArray(empleados) ? empleados : [];
  const porNumero = new Map();
  const porNombre = new Map();

  for (const e of lista) {
    for (const campo of [e.idReloj, e.numero, e.numEmpleado, e.num]) {
      const k = claveNum(campo);
      if (k && !porNumero.has(k)) porNumero.set(k, e);
    }
    const n = claveNombre(e.nombre);
    if (n && !porNombre.has(n)) porNombre.set(n, e);
  }

  const enlazados = [];
  const sinEnlazar = [];

  for (const f of filas) {
    const dato = {
      numEmpleado: f.num_empleado == null ? null : f.num_empleado,
      nombre: f.nombre || '',
      puesto: f.puesto || '',
      activo: f.activo,
      heHorasNormales: Number(f.he_horas_normales) || 0,
      heHorasDobles: Number(f.he_horas_dobles) || 0,
      heDias: Number(f.he_dias) || 0,
      heComidaMinutos: Number(f.he_comida_minutos) || 0,
      vacDias: Number(f.vac_dias) || 0,
      permisoHorasPagadas: Number(f.permiso_horas_pagadas) || 0,
      permisoHorasNoPagadas: Number(f.permiso_horas_no_pagadas) || 0,
      permisosConteo: Number(f.permisos_conteo) || 0,
    };

    const k = claveNum(dato.numEmpleado);
    let emp = k ? porNumero.get(k) : null;
    let via = emp ? 'numero' : '';
    if (!emp) {
      emp = porNombre.get(claveNombre(dato.nombre));
      if (emp) via = 'nombre';
    }

    if (emp) enlazados.push({ ...dato, idReloj: emp.idReloj, nombreNomina: emp.nombre, enlacePor: via });
    else sinEnlazar.push(dato);
  }

  const conDatos = new Set(enlazados.map(x => String(x.idReloj)));
  const sinMovimiento = lista
    .filter(e => e.activo && !conDatos.has(String(e.idReloj)))
    .map(e => ({ idReloj: e.idReloj, nombre: e.nombre }));

  return { enlazados, sinEnlazar, sinMovimiento };
}

module.exports = { traer, cruzar };
