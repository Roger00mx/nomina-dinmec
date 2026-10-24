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

// ---------- horas extra autorizadas, listas para comparar ----------
// Devuelve { ok, desde, hasta, porId, sinEnlazar }.
// porId esta indexado por idReloj de nomina: { horasNormales, horasDobles,
// horasTotales, dias, comidaMinutos, enlacePor }.
async function horasExtraPorEmpleado(desde, hasta, empleados) {
  const r = await traer(desde, hasta);
  if (r.error) return { ok: false, desde, hasta, error: r.error, porId: {}, sinEnlazar: [] };

  const idx = indice(empleados);
  const porId = {};
  const sinEnlazar = [];

  for (const f of r.filas) {
    const dato = {
      horasNormales: Number(f.he_horas_normales) || 0,
      horasDobles: Number(f.he_horas_dobles) || 0,
      dias: Number(f.he_dias) || 0,
      comidaMinutos: Number(f.he_comida_minutos) || 0,
    };
    dato.horasTotales = +(dato.horasNormales + dato.horasDobles).toFixed(2);

    const hit = buscar(idx, f.num_empleado, f.nombre);
    if (!hit) {
      // Solo estorba avisar de quien no trae horas extra en el periodo.
      if (dato.horasTotales > 0 || dato.dias > 0) {
        sinEnlazar.push({
          numEmpleado: f.num_empleado == null ? null : f.num_empleado,
          nombre: f.nombre || '', ...dato,
        });
      }
      continue;
    }

    const k = String(hit.empleado.idReloj);
    const previo = porId[k];
    if (previo) {
      previo.horasNormales = +(previo.horasNormales + dato.horasNormales).toFixed(2);
      previo.horasDobles = +(previo.horasDobles + dato.horasDobles).toFixed(2);
      previo.horasTotales = +(previo.horasNormales + previo.horasDobles).toFixed(2);
      previo.dias += dato.dias;
      previo.comidaMinutos += dato.comidaMinutos;
    } else {
      porId[k] = { ...dato, enlacePor: hit.via };
    }
  }

  return { ok: true, desde, hasta, porId, sinEnlazar };
}


// ---------- formatos de RH (FO-RHS-07 / 08 / 09) con su detalle ----------
// Lectura directa de las tablas de Solicitudes RH de dinmec-app (solo lectura).
async function leerTabla(ruta) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const llave = process.env.SUPABASE_ANON_KEY || '';
  if (!base || !llave) return { error: 'Faltan las variables SUPABASE_URL y SUPABASE_ANON_KEY en Render.' };
  let r;
  try {
    r = await fetch(base + '/rest/v1/' + ruta, { headers: { apikey: llave, Authorization: 'Bearer ' + llave } });
  } catch (e) { return { error: 'No se pudo contactar a Supabase: ' + e.message }; }
  const texto = await r.text();
  if (!r.ok) return { error: ruta.split('?')[0] + ' respondio ' + r.status + ': ' + texto.slice(0, 300) };
  try { return { filas: JSON.parse(texto) }; } catch (e) { return { error: ruta.split('?')[0] + ' no devolvio JSON' }; }
}

// Trae una tabla filtrando por una lista de ids (en bloques para no hacer la URL enorme)
async function leerPorIds(tabla, campo, ids, select = '*') {
  const lista = [...new Set(ids.filter(Boolean))];
  const filas = [];
  for (let i = 0; i < lista.length; i += 80) {
    const bloque = lista.slice(i, i + 80).join(',');
    const r = await leerTabla(`${tabla}?select=${select}&${campo}=in.(${bloque})&limit=5000`);
    if (r.error) return r;
    filas.push(...r.filas);
  }
  return { filas };
}

const aMinutos = h => {
  if (!h) return null;
  const [a, b] = String(h).split(':').map(Number);
  return isNaN(a) || isNaN(b) ? null : a * 60 + b;
};
const hhmm = h => (h ? String(h).slice(0, 5) : null);

// Horas netas de una tarea: las capturadas al cierre o fin - inicio - comida.
function horasTarea(t) {
  if (t.total_horas != null && t.total_horas !== '') return +Number(t.total_horas).toFixed(2);
  const i = aMinutos(t.hora_inicio), f = aMinutos(t.hora_fin);
  if (i == null || f == null) return null;
  let min = f - i; if (min < 0) min += 1440;
  if (t.comida_aplica) min -= Number(t.comida_minutos) || 0;
  return +Math.max(0, min / 60).toFixed(2);
}

const ESTATUS_TXT = {
  pendiente_trabajador: 'Espera acuse del trabajador', pendiente_lider: 'Espera VoBo líder',
  pendiente_direccion: 'Espera Dirección', autorizada: 'Autorizada', enviada_finanzas: 'Enviada a Finanzas',
};

// Devuelve { ok, error, porId: { idReloj: { he:[], permisos:[], vacaciones:[] } }, sinEnlazar: [] }
async function formatosDetalle(desde, hasta, empleados) {
  const vacio = { ok: false, desde, hasta, porId: {}, sinEnlazar: [] };
  const SEL = 'id,folio,tipo,estatus,num_empleado,solicitante_id,origen,he_motivo,he_tipo_pago,he_total_horas,he_lugar,he_lugar_detalle,'
    + 'ps_paga_horas,ps_total_horas_pagar,vac_inicio,vac_fin,vac_dias_requeridos,comentarios_trabajador,fecha_solicitud,lider_nombre,direccion_nombre';

  const [tareas, bloques, vacs] = await Promise.all([
    leerTabla(`rh_he_tareas?select=*&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha,orden&limit=5000`),
    leerTabla(`rh_ps_bloques?select=*&fecha_salida=gte.${desde}&fecha_salida=lte.${hasta}&order=fecha_salida,orden&limit=5000`),
    leerTabla(`rh_solicitudes?select=${SEL}&tipo=eq.vacaciones&vac_inicio=lte.${hasta}&vac_fin=gte.${desde}&limit=2000`),
  ]);
  const err = [tareas, bloques, vacs].find(x => x.error);
  if (err) return { ...vacio, error: err.error };

  const idsSol = [...tareas.filas.map(t => t.solicitud_id), ...bloques.filas.map(b => b.solicitud_id)];
  const sols = await leerPorIds('rh_solicitudes', 'id', idsSol, SEL);
  if (sols.error) return { ...vacio, error: sols.error };
  const todas = [...sols.filas, ...vacs.filas].filter(x => x.estatus !== 'rechazada');
  const porSol = new Map(todas.map(x => [x.id, x]));

  const repos = await leerPorIds('rh_ps_reposicion', 'solicitud_id', bloques.filas.map(b => b.solicitud_id));
  const ops = await leerPorIds('operators', 'id', todas.map(x => x.solicitante_id), 'id,nombre,numero');
  const vemp = await leerPorIds('vac_empleados', 'operator_id', todas.map(x => x.solicitante_id), 'operator_id,num_trabajador,nombre');
  const opPorId = new Map((ops.filas || []).map(o => [o.id, o]));
  const vePorOp = new Map((vemp.filas || []).map(v => [v.operator_id, v]));

  const idx = indice(empleados);
  const porId = {};
  const sinEnlazarMap = new Map();
  const destino = sol => {
    const op = opPorId.get(sol.solicitante_id) || {};
    const ve = vePorOp.get(sol.solicitante_id) || {};
    const nombre = op.nombre || ve.nombre || '';
    const hit = buscar(idx, sol.num_empleado ?? ve.num_trabajador ?? op.numero, nombre)
      || buscar(idx, op.numero, nombre) || buscar(idx, ve.num_trabajador, nombre);
    if (!hit) {
      const k = claveNombre(nombre) || String(sol.num_empleado || '?');
      const prev = sinEnlazarMap.get(k) || { nombre, numEmpleado: sol.num_empleado ?? ve.num_trabajador ?? op.numero ?? null, folios: [] };
      if (sol.folio && !prev.folios.includes(sol.folio)) prev.folios.push(sol.folio);
      sinEnlazarMap.set(k, prev);
      return null;
    }
    const k = String(hit.empleado.idReloj);
    return (porId[k] = porId[k] || { he: [], permisos: [], vacaciones: [] });
  };
  const cab = sol => ({
    solicitudId: sol.id, folio: sol.folio || '', estatus: sol.estatus, estatusTxt: ESTATUS_TXT[sol.estatus] || sol.estatus,
    firme: sol.estatus === 'autorizada' || sol.estatus === 'enviada_finanzas', asignada: sol.origen === 'asignacion',
  });

  for (const t of tareas.filas) {
    const sol = porSol.get(t.solicitud_id); if (!sol) continue;
    const d = destino(sol); if (!d) continue;
    d.he.push({
      ...cab(sol), fecha: t.fecha, horaInicio: hhmm(t.hora_inicio), horaFin: hhmm(t.hora_fin),
      comidaMin: t.comida_aplica ? Number(t.comida_minutos) || 0 : 0, horas: horasTarea(t),
      descripcion: t.descripcion || '', concluido: t.concluido, avance: t.avance_pct,
      motivo: sol.he_motivo || '', tipoPago: sol.he_tipo_pago || '',
      lugar: sol.he_lugar || '', lugarDetalle: sol.he_lugar_detalle || '', totalSolicitud: sol.he_total_horas,
      fechaSolicitud: sol.fecha_solicitud || null, liderNombre: sol.lider_nombre || '', direccionNombre: sol.direccion_nombre || '',
      comentarios: sol.comentarios_trabajador || '', orden: t.orden ?? null,
    });
  }
  const repPorSol = {};
  for (const r of (repos.filas || [])) (repPorSol[r.solicitud_id] = repPorSol[r.solicitud_id] || []).push(r);
  for (const b of bloques.filas) {
    const sol = porSol.get(b.solicitud_id); if (!sol) continue;
    const d = destino(sol); if (!d) continue;
    d.permisos.push({
      ...cab(sol), fecha: b.fecha_salida, horaSalida: hhmm(b.hora_salida), fechaRegreso: b.fecha_regreso, horaRegreso: hhmm(b.hora_regreso),
      horas: b.total_horas != null ? +Number(b.total_horas).toFixed(2) : null, pagaHoras: !!sol.ps_paga_horas,
      reposicion: (repPorSol[b.solicitud_id] || []).map(r => ({ del: r.fecha_del, al: r.fecha_al, entrada: hhmm(r.hora_entrada), salida: hhmm(r.hora_salida) })),
      motivo: sol.comentarios_trabajador || '',
      fechaSolicitud: sol.fecha_solicitud || null, liderNombre: sol.lider_nombre || '', direccionNombre: sol.direccion_nombre || '',
    });
  }
  for (const v of vacs.filas) {
    if (v.estatus === 'rechazada') continue;
    const d = destino(v); if (!d) continue;
    d.vacaciones.push({ ...cab(v), inicio: v.vac_inicio, fin: v.vac_fin, dias: v.vac_dias_requeridos });
  }
  return { ok: true, desde, hasta, porId, sinEnlazar: [...sinEnlazarMap.values()] };
}

module.exports = { traer, traerVacaciones, cruzar, vacacionesComoExcepciones, horasExtraPorEmpleado, formatosDetalle };
