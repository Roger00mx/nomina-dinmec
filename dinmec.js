// dinmec.js — enlace de solo lectura con dinmec-app (Supabase)
//
// Trae de la app de manufactura:
//   • nomina_periodo(desde, hasta)    -> horas extra y vacaciones RESUMIDAS por trabajador
//   • nomina_vacaciones(desde, hasta) -> los DIAS de vacaciones, fecha por fecha
//
// NUNCA escribe en Supabase. Si Supabase no responde, la nomina sigue funcionando
// con lo que ya tiene capturado: quien llama debe revisar el campo .error.
//
// Llaves: se configuran en Render -> Environment
//   SUPABASE_URL       = https://xxxxxxxx.supabase.co
//   SUPABASE_ANON_KEY  = eyJ...

// ---------- llamada generica a una funcion de Supabase ----------
async function llamarRpc(funcion, cuerpo) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const llave = process.env.SUPABASE_ANON_KEY || '';
  if (!base || !llave) {
    return { error: 'Faltan las variables SUPABASE_URL y SUPABASE_ANON_KEY en Render.' };
  }

  let respuesta;
  try {
    respuesta = await fetch(base + '/rest/v1/rpc/' + funcion, {
      method: 'POST',
      headers: {
        apikey: llave,
        Authorization: 'Bearer ' + llave,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    return { error: 'No se pudo contactar a Supabase: ' + e.message };
  }

  const texto = await respuesta.text();
  if (!respuesta.ok) {
    return { error: funcion + ' respondio ' + respuesta.status + ': ' + texto.slice(0, 300) };
  }

  let filas;
  try { filas = JSON.parse(texto); }
  catch (e) { return { error: funcion + ' devolvio una respuesta que no es JSON' }; }
  if (!Array.isArray(filas)) return { error: 'Se esperaba una lista de ' + funcion };
  return { filas };
}

async function traer(desde, hasta) {
  return llamarRpc('nomina_periodo', { p_desde: desde, p_hasta: hasta });
}

async function traerVacaciones(desde, hasta) {
  return llamarRpc('nomina_vacaciones', { p_desde: desde, p_hasta: hasta });
}

// ---------- enlace de personas entre las dos apps ----------

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

// Arma los indices de busqueda a partir de los empleados de nomina
function indice(empleados) {
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
  return { lista, porNumero, porNombre };
}

// Busca primero por numero de empleado; si no, por nombre.
function buscar(idx, numEmpleado, nombre) {
  const k = claveNum(numEmpleado);
  const porNum = k ? idx.porNumero.get(k) : null;
  if (porNum) return { empleado: porNum, via: 'numero' };
  const porNom = idx.porNombre.get(claveNombre(nombre));
  if (porNom) return { empleado: porNom, via: 'nombre' };
  return null;
}

// ---------- cruce del resumen (ruta /api/dinmec) ----------
function cruzar(filas, empleados) {
  const idx = indice(empleados);
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
    const hit = buscar(idx, dato.numEmpleado, dato.nombre);
    if (hit) {
      enlazados.push({
        ...dato,
        idReloj: hit.empleado.idReloj,
        nombreNomina: hit.empleado.nombre,
        enlacePor: hit.via,
      });
    } else {
      sinEnlazar.push(dato);
    }
  }

  const conDatos = new Set(enlazados.map(x => String(x.idReloj)));
  const sinMovimiento = idx.lista
    .filter(e => e.activo && !conDatos.has(String(e.idReloj)))
    .map(e => ({ idReloj: e.idReloj, nombre: e.nombre }));

  return { enlazados, sinEnlazar, sinMovimiento };
}

// ---------- vacaciones convertidas en excepciones del motor ----------
// El motor de nomina entiende una excepcion { idReloj, fecha, hasta, tipo }.
// Con tipo 'Vacaciones' ese dia deja de contar como falta y como retardo,
// asi que el trabajador cobra su semana completa.
function vacacionesComoExcepciones(filas, empleados) {
  const idx = indice(empleados);
  const excepciones = [];
  const vistos = new Set();
  const sinEnlazarMap = new Map();

  for (const f of (filas || [])) {
    if (!f || !f.fecha) continue;
    const hit = buscar(idx, f.num_empleado, f.nombre);
    if (!hit) {
      const clave = claveNombre(f.nombre) || claveNum(f.num_empleado) || '?';
      const previo = sinEnlazarMap.get(clave)
        || { numEmpleado: f.num_empleado == null ? null : f.num_empleado, nombre: f.nombre || '', dias: 0 };
      previo.dias++;
      sinEnlazarMap.set(clave, previo);
      continue;
    }
    const clave = hit.empleado.idReloj + '_' + f.fecha;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    excepciones.push({
      idReloj: hit.empleado.idReloj,
      fecha: f.fecha,
      hasta: f.fecha,
      tipo: 'Vacaciones',
      origen: 'dinmec-app',
      nota: 'Vacaciones autorizadas en dinmec-app',
    });
  }

  return { excepciones, sinEnlazar: [...sinEnlazarMap.values()] };
}

module.exports = { traer, traerVacaciones, cruzar, vacacionesComoExcepciones };
