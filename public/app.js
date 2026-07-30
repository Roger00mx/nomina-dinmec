// Nómina DINMEC — interfaz
'use strict';

const $ = sel => document.querySelector(sel);
const contenido = $('#contenido');

let PARAMETROS = {};
let EMPLEADOS = [];
let TURNOS = [];
let NOMINA = null;           // último cálculo (por fecha de pago)
let PAGO = JSON.parse(localStorage.getItem('pago') || 'null') || { fecha: '' };
const NOMBRE_GRUPO = { SEMANAL: 'Semanal', A: 'Grupo A', B: 'Grupo B' };

const DIAS_NOMBRE = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// ---------- utilidades ----------
async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/api/login') { mostrarLogin(); throw new Error('Sesión no iniciada'); }
  if (!r.ok) throw new Error(datos.error || 'Error del servidor');
  return datos;
}

function dinero(n) {
  return '$' + (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 2.78 horas -> "2 h 47 min" (para mostrar el conteo exacto por minutos)
function horasYMin(h) {
  if (!h) return '0 min';
  const totalMin = Math.round(h * 60);
  const hrs = Math.floor(totalMin / 60), min = totalMin % 60;
  if (hrs === 0) return `${min} min`;
  return min === 0 ? `${hrs} h` : `${hrs} h ${min} min`;
}

function esc(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fechaBonita(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function ajustarInicioSemana(iso) {
  // Retrocede hasta el día configurado como inicio de semana (viernes por defecto)
  const objetivo = PARAMETROS.diaInicioSemana || 5;
  let f = iso;
  for (let i = 0; i < 7; i++) {
    const js = new Date(f + 'T12:00:00').getDay();
    const dia = js === 0 ? 7 : js;
    if (dia === objetivo) return f;
    f = sumarDias(f, -1);
  }
  return iso;
}

function descargarCSV(nombre, filas) {
  const csv = '﻿' + filas.map(f => f.map(c => {
    c = String(c ?? '');
    return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
  }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
}

function nombreEmpleado(id) {
  const e = EMPLEADOS.find(x => x.idReloj == id);
  return e ? e.nombre : 'ID ' + id;
}

// ---------- arranque y login ----------
async function iniciar() {
  const ses = await fetch('/api/sesion').then(r => r.json());
  if (!ses.conectado) return mostrarLogin();
  $('#login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  [PARAMETROS, EMPLEADOS, TURNOS] = await Promise.all([
    api('/api/parametros'), api('/api/empleados'), api('/api/turnos'),
  ]);
  if (!PAGO.fecha) {
    const res = await api('/api/checadas/resumen');
    PAGO.fecha = ajustarInicioSemana(res.fechaMax || new Date().toISOString().slice(0, 10));
  }
  navegar('nomina');
}

function mostrarLogin() {
  $('#login').classList.remove('oculto');
  $('#app').classList.add('oculto');
  $('#login-pass').focus();
}

$('#login-btn').addEventListener('click', entrar);
$('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });

async function entrar() {
  $('#login-error').textContent = 'Entrando…';
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#login-pass').value } });
    location.reload();
  } catch (e) {
    $('#login-error').textContent = e.message.includes('fetch')
      ? 'No hay conexión con el servidor. Abre "INICIAR NOMINA.bat" y deja abierta la ventana negra.'
      : e.message;
  }
}

// ---------- navegación ----------
const VISTAS = {};
$('#pestanas').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) navegar(btn.dataset.vista);
});

function navegar(vista) {
  document.querySelectorAll('#pestanas button').forEach(b =>
    b.classList.toggle('activa', b.dataset.vista === vista));
  contenido.innerHTML = '<div class="tarjeta">Cargando…</div>';
  VISTAS[vista]().catch(e => {
    contenido.innerHTML = `<div class="aviso aviso-error">Error: ${esc(e.message)}</div>`;
  });
}

// ---------- selector de fecha de pago (compartido) ----------
function selectorPago(alCambiar) {
  const div = document.createElement('div');
  div.className = 'fila-controles';
  div.innerHTML = `
    <div class="campo"><label>Fecha de pago (${DIAS_NOMBRE[PARAMETROS.diaInicioSemana || 5]})</label>
      <input type="date" id="pago-fecha" value="${PAGO.fecha}"></div>
    <button class="btn btn-primario" id="pago-calcular">Calcular</button>
    <span class="texto-chico">Ese día cobran los del grupo <b>Semanal</b> (su última semana) más el
      <b>grupo quincenal</b> al que le toque (sus últimas 2 semanas). El corte es el jueves anterior.</span>`;
  div.querySelector('#pago-calcular').addEventListener('click', () => {
    PAGO.fecha = ajustarInicioSemana(div.querySelector('#pago-fecha').value);
    localStorage.setItem('pago', JSON.stringify(PAGO));
    alCambiar();
  });
  return div;
}

async function cargarPago() {
  NOMINA = await api(`/api/pago?fecha=${PAGO.fecha}`);
  PAGO.fecha = NOMINA.fechaPago;
  localStorage.setItem('pago', JSON.stringify(PAGO));
  return NOMINA;
}

// ============================================================
// VISTA: NÓMINA
// ============================================================
VISTAS.nomina = async function () {
  await cargarPago();
  const [periodos, tunel] = await Promise.all([api('/api/periodos'), api('/api/tunel').catch(() => ({ url: null }))]);
  const cerrado = periodos.find(p => p.fechaPago === NOMINA.fechaPago);

  const totalNeto = NOMINA.resumen.reduce((s, r) => s + r.neto, 0);
  const totalHE = NOMINA.resumen.reduce((s, r) => s + r.horasExtras, 0);
  const totalDispersion = NOMINA.resumen.reduce((s, r) => s + r.montoDispersion, 0);
  const totalRetardos = NOMINA.resumen.reduce((s, r) => s + r.retardos, 0);
  const totalFaltas = NOMINA.resumen.reduce((s, r) => s + r.faltas, 0);

  contenido.innerHTML = '';
  const cont = document.createElement('div');

  const tarjetaSel = document.createElement('div');
  tarjetaSel.className = 'tarjeta';
  tarjetaSel.appendChild(selectorPago(() => navegar('nomina')));
  cont.appendChild(tarjetaSel);

  const q = NOMINA.quincenal, s = NOMINA.semanal;
  cont.insertAdjacentHTML('beforeend', `
    ${tunel.url ? `<div class="aviso aviso-ok">🌐 Dirección de internet actual (compártela para entrar desde cualquier red):
      <a href="${esc(tunel.url)}" target="_blank"><b>${esc(tunel.url)}</b></a>
      <span class="texto-chico">— cambia si la computadora se reinicia; vuelve a copiarla de aquí.</span></div>` : ''}`);
  cont.insertAdjacentHTML('beforeend', `
    ${cerrado ? `<div class="aviso aviso-ambar">🔒 Este pago fue cerrado el ${fechaBonita(cerrado.cerradoEl.slice(0, 10))}. Los saldos de banco de horas y préstamos ya fueron aplicados.</div>` : ''}
    <div class="aviso aviso-info">📅 El <b>${fechaBonita(NOMINA.fechaPago)}</b> cobran:
      <b>${NOMBRE_GRUPO[NOMINA.grupoQuincenal]}</b> (${q.empleados} personas · quincena del ${fechaBonita(q.inicio)} al ${fechaBonita(q.fin)})
      + <b>Semanal</b> (${s.empleados} personas · semana del ${fechaBonita(s.inicio)} al ${fechaBonita(s.fin)}).
      El grupo ${NOMINA.grupoQuincenal === 'A' ? 'B' : 'A'} cobra el ${fechaBonita(sumarDias(NOMINA.fechaPago, 7))}.</div>
    ${(NOMINA.sugerencias || []).map((sg, i) => `
      <div class="aviso aviso-ambar">🔍 <b>${esc(sg.nombre)}</b>: en la semana del ${fechaBonita(sg.semanaInicio)} sus checadas
        no cuadran con su turno <b>${esc(sg.turnoActual)}</b>; parece que trabajó <b>${esc(sg.turnoSugerido)}</b>
        (${esc(sg.descripcionSugerido)}, detectado en ${sg.dias} días).
        <button class="btn btn-mini btn-primario btn-aplicar-sug" data-i="${i}">✔ Aplicar ese turno a esa semana</button>
      </div>`).join('')}
    <div class="kpis">
      <div class="kpi"><div class="valor">${fechaBonita(NOMINA.fechaPago)}</div><div class="nombre">Fecha de pago</div></div>
      <div class="kpi"><div class="valor">${dinero(totalNeto)}</div><div class="nombre">Total a pagar</div></div>
      <div class="kpi"><div class="valor">${dinero(totalDispersion)}</div><div class="nombre">Dispersión bancaria</div></div>
      <div class="kpi"><div class="valor">${dinero(totalNeto - totalDispersion)}</div><div class="nombre">Efectivo</div></div>
      <div class="kpi"><div class="valor">${totalHE.toFixed(1)} h</div><div class="nombre">Horas extras</div></div>
      <div class="kpi"><div class="valor">${totalRetardos} / ${totalFaltas}</div><div class="nombre">Retardos / Faltas</div></div>
    </div>`);

  // tabla principal
  function celdaRetardos(sem, numSem, r) {
    if (!sem) return '—';
    let html = String(sem.retardos || 0);
    if (sem.diasDescuentoRetardos > 0) {
      if (sem.justificadoPor) {
        html += ` <span class="etiqueta et-verde btn-quitar-just" data-id="${r.idReloj}" data-sem="${numSem}"
          style="cursor:pointer" title="Descuento perdonado. Autorizó: ${esc(sem.justificadoPor)}. Clic para quitar la justificación.">✓ ${esc(sem.justificadoPor)}</span>`;
      } else {
        html += ` <span class="etiqueta et-rojo">−${sem.diasDescuentoRetardos}d</span>
          <button class="btn btn-mini btn-justificar" data-id="${r.idReloj}" data-sem="${numSem}"
          title="Perdonar el descuento de esta semana con justificante autorizado" ${cerrado ? 'disabled' : ''}>🖊 Justificar</button>`;
      }
    }
    return html;
  }

  let filas = '';
  for (const r of NOMINA.resumen) {
    const s1 = r.semanas[0] || {};
    const s2 = r.semanas[1];
    const etiquetaGrupo = r.grupo === 'SEMANAL'
      ? '<span class="etiqueta et-verde">Semanal</span>'
      : `<span class="etiqueta et-azul">Grupo ${r.grupo}</span>`;
    filas += `<tr>
      <td>${r.idReloj}</td>
      <td>${esc(r.nombre)}</td>
      <td>${etiquetaGrupo}</td>
      <td class="texto-chico">${fechaBonita(r.periodoInicio)} – ${fechaBonita(r.periodoFin)}</td>
      <td class="num">${dinero(r.sueldoSemanal)}</td>
      <td class="num">${celdaRetardos(s1, 1, r)}</td>
      <td class="num">${s1.faltas || 0}</td>
      <td class="num">${celdaRetardos(s2, 2, r)}</td>
      <td class="num">${s2 ? (s2.faltas || 0) : '—'}</td>
      <td class="num">${r.horasTrabajadas.toFixed(1)}</td>
      <td class="num"><b>${horasYMin(r.horasExtras)}</b>${r.heDomingo ? ` <span class="etiqueta et-ambar" title="Horas de domingo, pagadas al doble">dom ${horasYMin(r.heDomingo)}</span>` : ''}</td>
      <td>
        <select data-id="${r.idReloj}" class="sel-destino" ${cerrado ? 'disabled' : ''}>
          <option value="pagar" ${r.destinoHE === 'pagar' ? 'selected' : ''}>💵 Pagar</option>
          <option value="banco" ${r.destinoHE === 'banco' ? 'selected' : ''}>🏦 A banco</option>
        </select>
      </td>
      <td class="num">${r.saldoBanco.toFixed(1)} h
        ${r.faltas > 0 && r.saldoBanco > 0 ? `<input type="number" class="inp-cubrir" data-id="${r.idReloj}" value="${r.horasCubrenFaltas || 0}" min="0" max="${r.saldoBanco}" step="0.5" style="width:60px" title="Horas del banco para cubrir faltas" ${cerrado ? 'disabled' : ''}>` : ''}
      </td>
      <td class="num">${dinero(r.pagoHE)}</td>
      <td class="num" style="color:var(--rojo)">${r.descuentos ? '−' + dinero(r.descuentos) : '—'}</td>
      <td class="num" style="color:var(--rojo)">${r.abonoPrestamo ? '−' + dinero(r.abonoPrestamo) : '—'}</td>
      <td class="num"><b>${dinero(r.neto)}</b></td>
      <td class="num">${r.montoDispersion ? dinero(r.montoDispersion) : '—'}</td>
      <td class="num">${dinero(r.efectivo)}</td>
    </tr>`;
  }

  cont.insertAdjacentHTML('beforeend', `
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">Resumen de nómina</h2>
        <span style="flex:1"></span>
        <button class="btn btn-azul" id="btn-recibos">🖨️ Imprimir recibos</button>
        <button class="btn btn-azul" id="btn-excel-nomina">📗 Descargar Excel</button>
        <button class="btn" id="btn-csv-nomina">⬇️ CSV</button>
        <button class="btn" id="btn-csv-dispersion">⬇️ Dispersión CSV</button>
        ${cerrado
          ? '<button class="btn btn-peligro" id="btn-reabrir">Reabrir periodo</button>'
          : '<button class="btn btn-primario" id="btn-cerrar">✅ Cerrar periodo</button>'}
      </div>
      <div class="tabla-scroll"><table>
        <thead><tr>
          <th>ID</th><th>Nombre</th><th>Grupo</th><th>Periodo que cobra</th><th>Sueldo sem.</th>
          <th>Ret. S1</th><th>Faltas S1</th><th>Ret. S2</th><th>Faltas S2</th>
          <th>Hrs trab.</th><th>Hrs extra</th><th>Destino H.E.</th><th>Banco hrs</th>
          <th>Pago H.E.</th><th>Descuentos</th><th>Préstamo</th>
          <th>NETO</th><th>Dispersión</th><th>Efectivo</th>
        </tr></thead>
        <tbody>${filas || '<tr><td colspan="19">Nadie cobra en esta fecha</td></tr>'}</tbody>
      </table></div>
      ${NOMINA.noCobranHoy.length ? `<p class="texto-chico" style="margin-top:8px">😴 No cobran esta fecha (les toca el ${fechaBonita(sumarDias(NOMINA.fechaPago, 7))}):
        ${NOMINA.noCobranHoy.map(e => esc(e.nombre)).join(', ')}.</p>` : ''}
      <p class="texto-chico" style="margin-top:8px">
        Retardos: entrada después de ${PARAMETROS.toleranciaMin} min de tolerancia · ${PARAMETROS.retardosPorFalta} retardos en la semana = 1 día de descuento ·
        Horas extras con umbral mínimo de ${PARAMETROS.umbralHorasExtra} h, pagadas a ×${PARAMETROS.factorHoraExtra ?? 1.5} la hora normal (×${PARAMETROS.factorHoraExtraCNC ?? 2} para puesto CNC) ·
        Domingo trabajado se paga ×${PARAMETROS.factorHoraExtraDomingo ?? 2} para todos ·
        «A banco» guarda las horas extra para cubrir faltas después.
      </p>
    </div>`);

  contenido.appendChild(cont);

  // eventos de decisiones
  contenido.querySelectorAll('.sel-destino').forEach(sel => sel.addEventListener('change', async () => {
    await api('/api/decisiones', { method: 'PUT', body: { clave: NOMINA.fechaPago + '_' + sel.dataset.id, datos: { destinoHE: sel.value } } });
    navegar('nomina');
  }));
  contenido.querySelectorAll('.inp-cubrir').forEach(inp => inp.addEventListener('change', async () => {
    await api('/api/decisiones', { method: 'PUT', body: { clave: NOMINA.fechaPago + '_' + inp.dataset.id, datos: { horasCubrenFaltas: +inp.value || 0 } } });
    navegar('nomina');
  }));

  async function guardarJustificacion(idReloj, numSem, autoriza) {
    const r = NOMINA.resumen.find(x => x.idReloj == idReloj);
    const justRetardos = {};
    r.semanas.forEach((sem, i) => { if (sem.justificadoPor) justRetardos[String(i + 1)] = sem.justificadoPor; });
    if (autoriza) justRetardos[String(numSem)] = autoriza;
    else delete justRetardos[String(numSem)];
    await api('/api/decisiones', { method: 'PUT', body: { clave: NOMINA.fechaPago + '_' + idReloj, datos: { justRetardos } } });
    navegar('nomina');
  }
  contenido.querySelectorAll('.btn-justificar').forEach(btn => btn.addEventListener('click', () => {
    const quien = prompt('Justificante de retardos:\n¿Quién AUTORIZA perdonar el descuento de esta semana?\n(escribe el nombre)');
    if (quien && quien.trim()) guardarJustificacion(btn.dataset.id, btn.dataset.sem, quien.trim());
  }));
  contenido.querySelectorAll('.btn-quitar-just').forEach(et => et.addEventListener('click', () => {
    if (confirm('¿Quitar la justificación? El descuento por retardos volverá a aplicarse.')) {
      guardarJustificacion(et.dataset.id, et.dataset.sem, '');
    }
  }));

  contenido.querySelectorAll('.btn-aplicar-sug').forEach(btn => btn.addEventListener('click', async () => {
    const sg = NOMINA.sugerencias[+btn.dataset.i];
    const asignaciones = await api('/api/asignaciones');
    asignaciones.push({ idReloj: sg.idReloj, inicio: sg.semanaInicio, turno: sg.turnoSugerido, nota: 'Detectado automáticamente' });
    await api('/api/asignaciones', { method: 'PUT', body: asignaciones });
    navegar('nomina');
  }));

  $('#btn-recibos').addEventListener('click', imprimirRecibos);
  $('#btn-excel-nomina').addEventListener('click', () => {
    window.location.href = '/api/excel/nomina?fecha=' + NOMINA.fechaPago;
  });
  $('#btn-csv-nomina').addEventListener('click', () => {
    const filas = [['ID', 'Nombre', 'Grupo', 'Periodo inicio', 'Periodo fin', 'Sueldo semanal', 'Retardos', 'Faltas', 'Hrs trabajadas', 'Hrs extra', 'Pago HE', 'Descuentos', 'Abono préstamo', 'Neto', 'Dispersión', 'Efectivo']];
    for (const r of NOMINA.resumen) filas.push([r.idReloj, r.nombre, NOMBRE_GRUPO[r.grupo] || r.grupo, r.periodoInicio, r.periodoFin, r.sueldoSemanal, r.retardos, r.faltas, r.horasTrabajadas, r.horasExtras, r.pagoHE, r.descuentos, r.abonoPrestamo, r.neto, r.montoDispersion, r.efectivo]);
    descargarCSV(`nomina_pago_${NOMINA.fechaPago}.csv`, filas);
  });
  $('#btn-csv-dispersion').addEventListener('click', () => {
    const filas = [['ID', 'Nombre', 'Banco', 'Monto']];
    for (const r of NOMINA.resumen) if (r.montoDispersion > 0) filas.push([r.idReloj, r.nombre, r.banco, r.montoDispersion]);
    descargarCSV(`dispersion_pago_${NOMINA.fechaPago}.csv`, filas);
  });
  const btnCerrar = $('#btn-cerrar');
  if (btnCerrar) btnCerrar.addEventListener('click', async () => {
    if (!confirm('¿Cerrar este pago? Se aplicarán los movimientos de banco de horas y los abonos de préstamos de las personas que cobran hoy.')) return;
    await api('/api/periodos/cerrar', { method: 'POST', body: { fecha: NOMINA.fechaPago } });
    navegar('nomina');
  });
  const btnReabrir = $('#btn-reabrir');
  if (btnReabrir) btnReabrir.addEventListener('click', async () => {
    if (!confirm('¿Reabrir este pago? Se revertirán los movimientos de banco de horas y préstamos.')) return;
    await api('/api/periodos/reabrir', { method: 'POST', body: { fecha: NOMINA.fechaPago } });
    navegar('nomina');
  });
};

function imprimirRecibos() {
  const zona = $('#zona-impresion');
  let html = '';
  for (const r of NOMINA.resumen) {
    if (r.neto <= 0 && r.horasTrabajadas === 0) continue;
    html += `<div class="recibo">
      <div class="recibo-cab">
        <img src="logo.png" alt="">
        <div>
          <h2>${esc(PARAMETROS.empresa)} — Recibo de nómina</h2>
          <div>Pago del ${fechaBonita(NOMINA.fechaPago)} · ${NOMBRE_GRUPO[r.grupo] || ''} ·
            Periodo: ${fechaBonita(r.periodoInicio)} al ${fechaBonita(r.periodoFin)}</div>
        </div>
      </div>
      <p><b>${esc(r.nombre)}</b> &nbsp;·&nbsp; N° ${r.idReloj}</p>
      <table>
        <tr><th>Concepto</th><th>Detalle</th><th style="text-align:right">Importe</th></tr>
        <tr><td>Sueldo (${r.semanas.length} semana${r.semanas.length > 1 ? 's' : ''})</td><td>${dinero(r.sueldoSemanal)} / semana</td><td class="num">${dinero(r.totalSueldo)}</td></tr>
        ${r.pagoHE > 0 && r.heEntreSemana > 0 ? `<tr><td>Horas extras (L-S)</td><td>${horasYMin(r.heEntreSemana)} × ${dinero(r.costoHoraExtra)}/h (hora normal ×${r.factorHE})</td><td class="num">${dinero(r.heEntreSemana * r.costoHoraExtra)}</td></tr>` : ''}
        ${r.pagoHE > 0 && r.heDomingo > 0 ? `<tr><td>Horas extras domingo</td><td>${horasYMin(r.heDomingo)} × ${dinero(r.costoHoraExtraDomingo)}/h (hora normal ×${r.factorDomingo})</td><td class="num">${dinero(r.heDomingo * r.costoHoraExtraDomingo)}</td></tr>` : ''}
        ${r.heABanco > 0 ? `<tr><td>Horas a banco</td><td>${r.heABanco.toFixed(2)} h guardadas</td><td class="num">—</td></tr>` : ''}
        ${r.recuperadoPorBanco > 0 ? `<tr><td>Faltas cubiertas con banco</td><td>${r.horasCubrenFaltas} h</td><td class="num">${dinero(r.recuperadoPorBanco)}</td></tr>` : ''}
        ${r.descuentos > 0 ? `<tr><td>Descuentos</td><td>${r.faltas} falta(s), ${r.retardos} retardo(s) → ${r.diasDescontados} día(s)</td><td class="num">−${dinero(r.descuentos)}</td></tr>` : ''}
        ${r.abonoPrestamo > 0 ? `<tr><td>Abono a préstamo</td><td>Saldo restante: ${dinero(Math.max(r.saldoPrestamo - r.abonoPrestamo, 0))}</td><td class="num">−${dinero(r.abonoPrestamo)}</td></tr>` : ''}
        <tr><td colspan="2" class="neto">NETO A PAGAR</td><td class="num neto">${dinero(r.neto)}</td></tr>
        ${r.montoDispersion > 0 ? `<tr><td colspan="2">Dispersión bancaria ${esc(r.banco || '')}</td><td class="num">${dinero(r.montoDispersion)}</td></tr>
        <tr><td colspan="2">Efectivo</td><td class="num">${dinero(r.efectivo)}</td></tr>` : ''}
      </table>
      <div class="firmas"><div>Recibí conforme</div><div>Autorizó</div></div>
    </div>`;
  }
  zona.innerHTML = html;
  window.print();
}

// ============================================================
// VISTA: DETALLE DIARIO
// ============================================================
VISTAS.detalle = async function () {
  await cargarPago();
  contenido.innerHTML = '';
  const cont = document.createElement('div');

  const tarjetaSel = document.createElement('div');
  tarjetaSel.className = 'tarjeta';
  tarjetaSel.appendChild(selectorPago(() => navegar('detalle')));

  const filtro = document.createElement('div');
  filtro.className = 'fila-controles';
  filtro.innerHTML = `
    <div class="campo"><label>Empleado</label>
      <select id="det-emp"><option value="">— Todos (solo días con actividad o alertas) —</option>
        ${EMPLEADOS.filter(e => e.activo).map(e => `<option value="${e.idReloj}">${e.idReloj} — ${esc(e.nombre)}</option>`).join('')}
      </select></div>
    <label style="align-self:center"><input type="checkbox" id="det-alertas"> Solo con alertas</label>
    <span style="flex:1"></span>
    <button class="btn btn-azul" id="btn-excel-detalle">📗 Descargar Excel</button>`;
  filtro.querySelector('#btn-excel-detalle').addEventListener('click', () => {
    window.location.href = '/api/excel/detalle?fecha=' + NOMINA.fechaPago;
  });
  tarjetaSel.appendChild(filtro);
  cont.appendChild(tarjetaSel);

  const tarjetaTabla = document.createElement('div');
  tarjetaTabla.className = 'tarjeta';
  cont.appendChild(tarjetaTabla);
  contenido.appendChild(cont);

  const empGuardado = sessionStorage.getItem('det-emp') || '';
  filtro.querySelector('#det-emp').value = empGuardado;

  function pintar() {
    const emp = filtro.querySelector('#det-emp').value;
    sessionStorage.setItem('det-emp', emp);
    const soloAlertas = filtro.querySelector('#det-alertas').checked;
    let dias = NOMINA.dias;
    if (emp) dias = dias.filter(d => d.idReloj == emp);
    else dias = dias.filter(d => d.numChecadas > 0 || d.falta || d.alertas.length);
    if (soloAlertas) dias = dias.filter(d => d.alertas.length || d.falta);

    let filas = '';
    dias.forEach((d, idx) => {
      const clase = d.falta ? 'fila-falta' : (!d.laboral ? 'fila-nolaboral' : '');
      filas += `<tr class="${clase}">
        <td>${d.idReloj}</td><td>${esc(d.nombre)}</td>
        <td>${fechaBonita(d.fecha)} <b>${d.dia}</b></td>
        <td>${esc(d.turno)}${d.laboral ? '' : ' <span class="etiqueta et-azul">No laboral</span>'}${d.excepcion ? ` <span class="etiqueta et-azul">${esc(d.excepcion)}</span>` : ''}</td>
        <td>${d.entrada || '—'}</td>
        <td class="texto-chico">${d.salDesayuno || ''}${d.regDesayuno ? '→' + d.regDesayuno : ''} ${d.minDesayuno ? `(${d.minDesayuno}m)` : ''}</td>
        <td class="texto-chico">${d.salComida || ''}${d.regComida ? '→' + d.regComida : ''} ${d.minComida ? `(${d.minComida}m)` : ''}</td>
        <td>${d.salida || '—'}</td>
        <td class="num">${d.numChecadas}</td>
        <td class="num">${d.esRetardo ? `<span class="etiqueta et-rojo">Sí${d.retardoMin ? ' +' + d.retardoMin + 'm' : ''}</span>` : (d.laboral && d.numChecadas ? '<span class="etiqueta et-verde">No</span>' : '')}</td>
        <td class="num">${d.horasTrabajadas ? d.horasTrabajadas.toFixed(2) : ''}</td>
        <td class="num">${d.horasEsperadas || ''}</td>
        <td class="num">${d.horasExtras ? '<b>' + horasYMin(d.horasExtras) + '</b>' : ''}</td>
        <td><button class="btn btn-mini btn-editar-dia" data-i="${idx}" title="${d.editadoManual ? 'Editar o quitar la captura manual de este día' : 'Editar entrada/salida de este día a mano'}">${d.editadoManual ? '✏️✔' : '✏️'}</button></td>
        <td class="texto-chico">${d.falta ? '<span class="etiqueta et-rojo">FALTA</span> ' : ''}${d.alertas.filter(a => !a.startsWith('FALTA')).map(esc).join(' · ')}</td>
      </tr>`;
    });

    tarjetaTabla.innerHTML = `
      <h2>Detalle diario — pago del ${fechaBonita(NOMINA.fechaPago)}
        <span class="texto-chico">(quincenal: ${fechaBonita(NOMINA.quincenal.inicio)} al ${fechaBonita(NOMINA.quincenal.fin)} ·
        semanal: ${fechaBonita(NOMINA.semanal.inicio)} al ${fechaBonita(NOMINA.semanal.fin)})</span></h2>
      <div class="tabla-scroll"><table>
        <thead><tr>
          <th>ID</th><th>Nombre</th><th>Fecha</th><th>Turno</th><th>Entrada</th>
          <th>Desayuno</th><th>Comida</th><th>Salida</th><th># Chec.</th><th>Retardo</th>
          <th>Hrs trab.</th><th>Hrs esp.</th><th>Hrs extra</th><th>✏️</th><th>Alertas</th>
        </tr></thead><tbody>${filas || '<tr><td colspan="15">Sin datos en este periodo</td></tr>'}</tbody>
      </table></div>
      <p class="texto-chico" style="margin-top:8px">* junto a una hora significa que fue asumida (no hubo checada) · ✏ = horario editado a mano · Los días con fondo rojo son faltas.
        Con el botón ✏️ puedes corregir la entrada/salida de cualquier día (viajes de choferes, salidas avisadas sin checar, etc.).</p>`;

    tarjetaTabla.querySelectorAll('.btn-editar-dia').forEach(btn =>
      btn.addEventListener('click', () => editarDia(dias[+btn.dataset.i])));
  }

  // Editor manual de un día: corrige entrada/salida con responsable y nota.
  // Se guarda como "captura" (la misma de Excepciones, donde también se puede añadir foto).
  async function editarDia(d) {
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(20,41,63,.6);z-index:150;display:flex;align-items:center;justify-content:center;padding:16px';
    const limpiar = t => (t || '').replace(/[✏*—]/g, '').trim();
    fondo.innerHTML = `
      <div class="tarjeta" style="max-width:430px;width:100%;margin:0">
        <h2>✏️ Editar día — ${esc(d.nombre)}</h2>
        <p class="texto-chico" style="margin-bottom:10px">${fechaBonita(d.fecha)} (${d.dia}) · turno ${esc(d.turno)}.
          El día editado no genera retardo ni falta; las horas de más salen como extra.
          Si la salida es menor que la entrada, se entiende que salió al día siguiente.</p>
        <div class="fila-controles">
          <div class="campo"><label>Entrada</label><input type="time" id="ed-entrada" value="${limpiar(d.entrada)}"></div>
          <div class="campo"><label>Salida</label><input type="time" id="ed-salida" value="${limpiar(d.salida)}"></div>
        </div>
        <div class="fila-controles">
          <div class="campo"><label>Capturado por (obligatorio)</label><input id="ed-quien" style="width:170px"></div>
          <div class="campo"><label>Motivo / nota</label><input id="ed-nota" style="width:170px" placeholder="ej. Viaje, salida avisada"></div>
        </div>
        <p class="texto-chico">Para adjuntar foto del justificante, usa la sección «Editar horarios» de la pestaña Excepciones.</p>
        <div class="fila-controles" style="margin-top:10px">
          <button class="btn btn-primario" id="ed-guardar">💾 Guardar</button>
          ${d.editadoManual ? '<button class="btn btn-peligro" id="ed-quitar">Quitar edición manual</button>' : ''}
          <button class="btn" id="ed-cancelar">Cancelar</button>
          <span id="ed-msg" class="error"></span>
        </div>
      </div>`;
    document.body.appendChild(fondo);
    fondo.addEventListener('click', e => { if (e.target === fondo) fondo.remove(); });
    fondo.querySelector('#ed-cancelar').addEventListener('click', () => fondo.remove());

    fondo.querySelector('#ed-guardar').addEventListener('click', async () => {
      const entrada = fondo.querySelector('#ed-entrada').value;
      const salida = fondo.querySelector('#ed-salida').value;
      const quien = fondo.querySelector('#ed-quien').value.trim();
      if (!entrada || !salida) { fondo.querySelector('#ed-msg').textContent = 'Faltan entrada y salida'; return; }
      if (!quien) { fondo.querySelector('#ed-msg').textContent = 'Escribe quién captura'; return; }
      const capturas = await api('/api/capturas');
      const existente = capturas.find(c => c.idReloj === d.idReloj && c.fecha === d.fecha);
      const lista = capturas.filter(c => !(c.idReloj === d.idReloj && c.fecha === d.fecha));
      lista.push({ idReloj: d.idReloj, fecha: d.fecha, entrada, salida, capturadoPor: quien, nota: fondo.querySelector('#ed-nota').value.trim(), foto: existente?.foto || '' });
      await api('/api/capturas', { method: 'PUT', body: lista });
      fondo.remove();
      navegar('detalle');
    });

    const btnQuitar = fondo.querySelector('#ed-quitar');
    if (btnQuitar) btnQuitar.addEventListener('click', async () => {
      if (!confirm('¿Quitar la edición manual? El día volverá a calcularse con las checadas del reloj.')) return;
      const capturas = await api('/api/capturas');
      await api('/api/capturas', { method: 'PUT', body: capturas.filter(c => !(c.idReloj === d.idReloj && c.fecha === d.fecha)) });
      fondo.remove();
      navegar('detalle');
    });
  }

  filtro.querySelector('#det-emp').addEventListener('change', pintar);
  filtro.querySelector('#det-alertas').addEventListener('change', pintar);
  pintar();
};

// ============================================================
// VISTA: IMPORTAR CHECADAS
// ============================================================
VISTAS.importar = async function () {
  const res = await api('/api/checadas/resumen');
  contenido.innerHTML = `
    <div class="tarjeta">
      <h2>Importar archivo del reloj checador</h2>
      <p style="margin-bottom:12px">Arrastra aquí el archivo <b>.dat</b> que descargas del reloj (formato ATTLOG), o haz clic para buscarlo.
      Las checadas repetidas se ignoran automáticamente, así que puedes subir el mismo archivo varias veces sin problema.</p>
      <div class="zona-arrastre" id="zona">
        <p style="font-size:38px">📥</p>
        <p><b>Suelta el archivo aquí</b> o haz clic para elegirlo</p>
        <input type="file" id="archivo" accept=".dat,.txt" style="display:none">
      </div>
      <div id="resultado"></div>
    </div>
    <div class="tarjeta">
      <h2>Checadas almacenadas</h2>
      ${res.total
        ? `<p>Hay <b>${res.total.toLocaleString('es-MX')}</b> checadas guardadas, del <b>${fechaBonita(res.fechaMin)}</b> al <b>${fechaBonita(res.fechaMax)}</b>.</p>`
        : '<p>Todavía no hay checadas. Importa tu primer archivo .dat arriba.</p>'}
      <div class="fila-controles" style="margin-top:12px">
        <div class="campo"><label>Borrar desde</label><input type="date" id="del-desde"></div>
        <div class="campo"><label>hasta</label><input type="date" id="del-hasta"></div>
        <button class="btn btn-peligro" id="btn-borrar">Borrar checadas del rango</button>
      </div>
      <p class="texto-chico">Usa esto solo si importaste datos equivocados. Siempre puedes volver a subir el archivo .dat.</p>
    </div>`;

  const zona = $('#zona');
  const inputArchivo = $('#archivo');
  zona.addEventListener('click', () => inputArchivo.click());
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('encima'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.classList.remove('encima');
    if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0]);
  });
  inputArchivo.addEventListener('change', () => {
    if (inputArchivo.files[0]) procesarArchivo(inputArchivo.files[0]);
  });

  async function procesarArchivo(archivo) {
    $('#resultado').innerHTML = '<div class="aviso aviso-info">Procesando…</div>';
    try {
      const texto = await archivo.text();
      const r = await api('/api/checadas/importar', { method: 'POST', body: { texto } });
      let html = `<div class="aviso aviso-ok">✅ Se importaron <b>${r.nuevas}</b> checadas nuevas
        (${r.duplicadas} repetidas ignoradas${r.invalidas ? ', ' + r.invalidas + ' líneas inválidas' : ''}).
        Rango del archivo: ${fechaBonita(r.fechaMin)} — ${fechaBonita(r.fechaMax)}.</div>`;
      if (r.desconocidos.length) {
        html += `<div class="aviso aviso-ambar">⚠️ Estos IDs del reloj <b>no están en el catálogo de empleados</b>:
          ${r.desconocidos.join(', ')}. Sus checadas se guardaron pero no aparecerán en la nómina hasta que los agregues en la pestaña Empleados.</div>`;
      }
      $('#resultado').innerHTML = html;
    } catch (e) {
      $('#resultado').innerHTML = `<div class="aviso aviso-error">Error: ${esc(e.message)}</div>`;
    }
  }

  $('#btn-borrar').addEventListener('click', async () => {
    const desde = $('#del-desde').value, hasta = $('#del-hasta').value;
    if (!desde || !hasta) return alert('Indica el rango de fechas a borrar.');
    if (!confirm(`¿Borrar TODAS las checadas del ${desde} al ${hasta}? Esta acción no se puede deshacer.`)) return;
    const r = await api('/api/checadas', { method: 'DELETE', body: { desde, hasta } });
    alert(`Se borraron ${r.eliminadas} checadas.`);
    navegar('importar');
  });
};

// ============================================================
// VISTA: EMPLEADOS
// ============================================================
VISTAS.empleados = async function () {
  EMPLEADOS = await api('/api/empleados');
  const opcionesTurno = t => TURNOS.map(x => `<option value="${x.codigo}" ${t === x.codigo ? 'selected' : ''}>${x.codigo}</option>`).join('');

  function filaEmpleado(e, i) {
    const g = e.grupoPago || 'A';
    return `<tr data-i="${i}">
      <td><input type="number" value="${e.idReloj}" data-c="idReloj" style="width:60px"></td>
      <td><input value="${esc(e.nombre)}" data-c="nombre" style="width:230px"></td>
      <td><input value="${esc(e.puesto || '')}" data-c="puesto" style="width:80px" placeholder="ej. CNC" list="lista-puestos"></td>
      <td><select data-c="grupoPago">
        <option value="A" ${g === 'A' ? 'selected' : ''}>Grupo A</option>
        <option value="B" ${g === 'B' ? 'selected' : ''}>Grupo B</option>
        <option value="SEMANAL" ${g === 'SEMANAL' ? 'selected' : ''}>Semanal</option>
      </select></td>
      <td><input type="number" value="${e.sueldoSemanal}" data-c="sueldoSemanal" style="width:90px" step="0.01"></td>
      <td><select data-c="turnoS1">${opcionesTurno(e.turnoS1)}</select></td>
      <td><select data-c="turnoS2"><option value="">(mismo)</option>${opcionesTurno(e.turnoS2)}</select></td>
      <td><input type="number" value="${e.costoHoraNormal}" data-c="costoHoraNormal" style="width:75px" step="0.01"></td>
      <td><input type="number" value="${e.desayunoMin}" data-c="desayunoMin" style="width:55px"></td>
      <td><input type="number" value="${e.comidaMin}" data-c="comidaMin" style="width:55px"></td>
      <td style="text-align:center"><input type="checkbox" ${e.dispersion ? 'checked' : ''} data-c="dispersion"></td>
      <td><input value="${esc(e.banco || '')}" data-c="banco" style="width:90px"></td>
      <td style="text-align:center"><input type="checkbox" ${e.sinChecador ? 'checked' : ''} data-c="sinChecador" title="Pago fijo: cobra su semana completa sin checar (practicantes)"></td>
      <td style="text-align:center"><input type="checkbox" ${e.activo ? 'checked' : ''} data-c="activo"></td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  contenido.innerHTML = `
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">Catálogo de empleados</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar">➕ Agregar empleado</button>
        <button class="btn btn-primario" id="btn-guardar">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px">El <b>ID Reloj</b> debe coincidir con el número que usa el empleado en el checador.
        <b>Grupo</b>: los grupos A y B cobran quincena en viernes alternados; «Semanal» cobra cada viernes.
        Puedes cambiar a cualquier persona de grupo cuando quieras — aplica desde el siguiente cálculo.
        <b>Puesto</b>: escribe <b>CNC</b> a quienes rotan turnos iniciando en lunes — para ellos la app
        detecta solo el turno de cada semana de rotación (pueden quedar semanas de pago mixtas: viernes
        con un turno y de lunes en adelante con otro).
        «Turno S2» solo se usa si el empleado cambia de turno en la segunda semana de la quincena.
        Desayuno/Comida son los minutos permitidos (hay casos de 30/20 en lugar de 20/30).
        La <b>hora extra se calcula sola</b>: hora normal × 1.5, y para puesto CNC × 2 (los factores se cambian en ⚙️ Parámetros).</p>
      <datalist id="lista-puestos"><option value="CNC"><option value="OFICINA"><option value="METROLOGIA"><option value="LIMPIEZA"><option value="ALMACEN"><option value="PRACTICANTE"></datalist>
      <div class="tabla-scroll"><table>
        <thead><tr><th>ID Reloj</th><th>Nombre</th><th>Puesto</th><th>Grupo</th><th>Sueldo sem.</th><th>Turno S1</th><th>Turno S2</th>
        <th>$ H. normal</th><th>Desay. (min)</th><th>Comida (min)</th><th>Dispersión</th><th>Banco</th><th>No checa<br>(pago fijo)</th><th>Activo</th><th></th></tr></thead>
        <tbody id="cuerpo-emp">${EMPLEADOS.map(filaEmpleado).join('')}</tbody>
      </table></div>
      <div id="msg-emp"></div>
    </div>`;

  $('#btn-agregar').addEventListener('click', () => {
    EMPLEADOS.push({ idReloj: '', numEmpleado: '', nombre: '', sueldoSemanal: 0, turnoS1: TURNOS[0]?.codigo || '', turnoS2: '', costoHoraNormal: 0, costoHoraExtra: 0, dispersion: false, banco: '', desayunoMin: 20, comidaMin: 30, activo: true });
    $('#cuerpo-emp').insertAdjacentHTML('beforeend', filaEmpleado(EMPLEADOS[EMPLEADOS.length - 1], EMPLEADOS.length - 1));
  });

  $('#cuerpo-emp').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar')) {
      const tr = e.target.closest('tr');
      if (confirm('¿Quitar este empleado de la lista? (si solo dejó de trabajar, mejor desmárcalo como Activo)')) tr.remove();
    }
  });

  $('#btn-guardar').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-emp tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const emp = {
        idReloj: +v('idReloj').value, numEmpleado: +v('idReloj').value,
        nombre: v('nombre').value.trim(), puesto: v('puesto').value.trim(),
        grupoPago: v('grupoPago').value,
        sueldoSemanal: +v('sueldoSemanal').value || 0,
        turnoS1: v('turnoS1').value, turnoS2: v('turnoS2').value,
        costoHoraNormal: +v('costoHoraNormal').value || 0,
        desayunoMin: +v('desayunoMin').value || 20, comidaMin: +v('comidaMin').value || 30,
        dispersion: v('dispersion').checked, banco: v('banco').value.trim(),
        sinChecador: v('sinChecador').checked, activo: v('activo').checked,
      };
      if (emp.idReloj && emp.nombre) lista.push(emp);
    }
    const ids = lista.map(e => e.idReloj);
    if (new Set(ids).size !== ids.length) {
      $('#msg-emp').innerHTML = '<div class="aviso aviso-error">Hay IDs de reloj repetidos. Corrígelos antes de guardar.</div>';
      return;
    }
    await api('/api/empleados', { method: 'PUT', body: lista });
    EMPLEADOS = lista;
    $('#msg-emp').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
  });
};

// ============================================================
// VISTA: TURNOS
// ============================================================
VISTAS.turnos = async function () {
  TURNOS = await api('/api/turnos');

  function filaTurno(t, i) {
    const checks = [1, 2, 3, 4, 5, 6, 7].map(d =>
      `<label style="margin-right:4px"><input type="checkbox" data-dia="${d}" ${t.dias.includes(d) ? 'checked' : ''}>${DIAS_NOMBRE[d]}</label>`).join('');
    return `<tr>
      <td><input value="${esc(t.codigo)}" data-c="codigo" style="width:120px"></td>
      <td><input type="time" value="${t.horaEntrada}" data-c="horaEntrada"></td>
      <td><input type="time" value="${t.horaSalida}" data-c="horaSalida"></td>
      <td><input type="number" value="${t.horasDia}" data-c="horasDia" style="width:65px" step="0.1"></td>
      <td class="texto-chico">${checks}</td>
      <td style="text-align:center"><input type="checkbox" ${t.cruzaMedianoche ? 'checked' : ''} data-c="cruzaMedianoche"></td>
      <td style="text-align:center"><input type="checkbox" ${t.descuentaDescansos ? 'checked' : ''} data-c="descuentaDescansos" title="Extra = horas totales − jornada − TODO el tiempo de descansos (no solo el exceso)"></td>
      <td><input value="${esc(t.descripcion || '')}" data-c="descripcion" style="width:200px"></td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  contenido.innerHTML = `
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">Catálogo de turnos</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar-t">➕ Agregar turno</button>
        <button class="btn btn-primario" id="btn-guardar-t">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px"><b>Horas/día</b> son las horas esperadas del turno;
        lo que pase de ahí cuenta como hora extra. Marca <b>Cruza medianoche</b> para turnos nocturnos.
        <b>Jornada efectiva</b>: descuenta TODO el tiempo de descansos antes de calcular el extra
        (ej. nocturno: extra = horas totales − 8.4 − tiempo de comida); sin marcar, el descanso permitido va incluido en la jornada.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Código</th><th>Entrada</th><th>Salida</th><th>Horas/día</th><th>Días laborales</th><th>Cruza medianoche</th><th>Jornada efectiva</th><th>Descripción</th><th></th></tr></thead>
        <tbody id="cuerpo-turnos">${TURNOS.map(filaTurno).join('')}</tbody>
      </table></div>
      <div id="msg-turnos"></div>
    </div>`;

  $('#btn-agregar-t').addEventListener('click', () => {
    const nuevo = { codigo: '', horaEntrada: '07:00', horaSalida: '17:00', dias: [1, 2, 3, 4, 5], horasDia: 10, cruzaMedianoche: false, descripcion: '' };
    $('#cuerpo-turnos').insertAdjacentHTML('beforeend', filaTurno(nuevo, TURNOS.length));
  });

  $('#cuerpo-turnos').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar') && confirm('¿Quitar este turno?')) e.target.closest('tr').remove();
  });

  $('#btn-guardar-t').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-turnos tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const dias = [...tr.querySelectorAll('[data-dia]')].filter(x => x.checked).map(x => +x.dataset.dia);
      const t = {
        codigo: v('codigo').value.trim(), horaEntrada: v('horaEntrada').value, horaSalida: v('horaSalida').value,
        horasDia: +v('horasDia').value || 8, dias, cruzaMedianoche: v('cruzaMedianoche').checked,
        descuentaDescansos: v('descuentaDescansos').checked,
        descripcion: v('descripcion').value.trim(),
      };
      if (t.codigo) lista.push(t);
    }
    await api('/api/turnos', { method: 'PUT', body: lista });
    TURNOS = lista;
    $('#msg-turnos').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
  });
};

// ============================================================
// VISTA: EXCEPCIONES
// ============================================================
VISTAS.excepciones = async function () {
  const [excepciones, asignaciones, viajes, capturas] = await Promise.all([
    api('/api/excepciones'), api('/api/asignaciones'), api('/api/viajes'), api('/api/capturas')]);
  const TIPOS = ['Permiso', 'Incapacidad', 'Vacaciones', 'Retardo justificado', 'Cambio turno'];

  const opcionesEmp = id => EMPLEADOS.filter(e => e.activo).map(e =>
    `<option value="${e.idReloj}" ${e.idReloj == id ? 'selected' : ''}>${e.idReloj} — ${esc(e.nombre)}</option>`).join('');
  const opcionesTipo = t => TIPOS.map(x => `<option ${x === t ? 'selected' : ''}>${x}</option>`).join('');
  const opcionesTurno = t => '<option value="">—</option>' + TURNOS.map(x => `<option ${x.codigo === t ? 'selected' : ''}>${x.codigo}</option>`).join('');

  function fila(e) {
    return `<tr>
      <td><select data-c="idReloj">${opcionesEmp(e.idReloj)}</select></td>
      <td><input type="date" value="${e.fecha || ''}" data-c="fecha"></td>
      <td><input type="date" value="${e.hasta || ''}" data-c="hasta" title="Opcional: hasta qué día aplica (los sábados y domingos del rango se omiten en permisos, incapacidades y vacaciones)"></td>
      <td><select data-c="tipo">${opcionesTipo(e.tipo)}</select></td>
      <td><select data-c="turnoAlternativo">${opcionesTurno(e.turnoAlternativo)}</select></td>
      <td><input value="${esc(e.observacion || '')}" data-c="observacion" style="width:220px"></td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  function filaAsig(a) {
    return `<tr>
      <td><select data-c="idReloj">${opcionesEmp(a.idReloj)}</select></td>
      <td><input type="date" value="${a.inicio || ''}" data-c="inicio"></td>
      <td><select data-c="turno">${TURNOS.map(x => `<option ${x.codigo === a.turno ? 'selected' : ''}>${x.codigo}</option>`).join('')}</select></td>
      <td><input value="${esc(a.nota || '')}" data-c="nota" style="width:220px"></td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  function filaViaje(v) {
    return `<tr>
      <td><select data-c="idReloj">${opcionesEmp(v.idReloj)}</select></td>
      <td><input type="date" value="${v.desde || ''}" data-c="desde"></td>
      <td><input type="date" value="${v.hasta || ''}" data-c="hasta"></td>
      <td><input type="number" value="${v.horasExtraDia ?? ''}" data-c="horasExtraDia" style="width:70px" step="0.5" min="0"></td>
      <td><input value="${esc(v.nota || '')}" data-c="nota" style="width:220px" placeholder="ej. Viaje a Monterrey"></td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  function filaCaptura(c) {
    return `<tr>
      <td><select data-c="idReloj">${opcionesEmp(c.idReloj)}</select></td>
      <td><input type="date" value="${c.fecha || ''}" data-c="fecha"></td>
      <td><input type="time" value="${c.entrada || ''}" data-c="entrada"></td>
      <td><input type="time" value="${c.salida || ''}" data-c="salida"></td>
      <td><input value="${esc(c.capturadoPor || '')}" data-c="capturadoPor" style="width:130px" placeholder="quién captura"></td>
      <td><input value="${esc(c.nota || '')}" data-c="nota" style="width:150px" placeholder="motivo"></td>
      <td style="white-space:nowrap">
        <input type="hidden" data-c="foto" value="${esc(c.foto || '')}">
        <button class="btn btn-mini btn-foto" title="Subir o tomar foto del justificante">📷</button>
        <button class="btn btn-mini btn-ver-foto" ${c.foto ? '' : 'style="display:none"'}>Ver</button>
        <input type="file" accept="image/*" capture="environment" style="display:none" class="inp-foto">
      </td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  contenido.innerHTML = `
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">✏️ Editar horarios de choferes — entrada/salida con evidencia</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar-c">➕ Agregar día</button>
        <button class="btn btn-primario" id="btn-guardar-c">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px">Para editar la <b>entrada y salida exactas</b> de un día (Antonio, Honorio…):
        se registra <b>quién hace la captura</b> y se puede adjuntar <b>foto del justificante</b> (desde el celular abre la cámara).
        Ese día no genera retardo ni falta; si la salida es menor que la entrada, se entiende que salió al día siguiente.
        Esta captura manda sobre las checadas del reloj y sobre el registro de viaje.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Empleado</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Capturado por</th><th>Nota</th><th>Foto</th><th></th></tr></thead>
        <tbody id="cuerpo-cap">${capturas.map(filaCaptura).join('')}</tbody>
      </table></div>
      <div id="msg-cap"></div>
    </div>
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">🚚 Horas de viaje — captura manual para choferes</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar-v">➕ Agregar viaje</button>
        <button class="btn btn-primario" id="btn-guardar-v">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px">Para cuando un chofer (Antonio, Honorio…) sale de viaje y <b>no puede checar</b>.
        Cada día del rango se paga como <b>jornada completa</b> (sin retardo ni falta) más las <b>horas extra por día</b> que captures.
        En sábado o domingo del rango, todas las horas capturadas cuentan como extra (domingo al doble). Si ese día hubiera checadas
        en el reloj, la captura manual manda.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Chofer / empleado</th><th>Desde</th><th>Hasta</th><th>Hrs extra por día</th><th>Nota</th><th></th></tr></thead>
        <tbody id="cuerpo-via">${viajes.map(filaViaje).join('')}</tbody>
      </table></div>
      <div id="msg-via"></div>
    </div>
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">Turnos por semana — horarios especiales temporales</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar-a">➕ Agregar</button>
        <button class="btn btn-primario" id="btn-guardar-a">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px">Para cuando alguien trabaja un horario distinto <b>solo por una o varias semanas</b>
        (ej. de 7pm a 7am, o el prolongado de 7am a 7pm). Elige cualquier día de la semana deseada: se ajusta solo al viernes de inicio.
        Esa semana se calcula con ese turno y las horas de más salen como extras. El detector automático de la pestaña Nómina
        también puede llenar esto por ti.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Empleado</th><th>Semana (cualquier día)</th><th>Turno de esa semana</th><th>Nota</th><th></th></tr></thead>
        <tbody id="cuerpo-asig">${asignaciones.map(filaAsig).join('')}</tbody>
      </table></div>
      <div id="msg-asig"></div>
    </div>
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">Excepciones — permisos, incapacidades, vacaciones, cambios de turno</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar-e">➕ Agregar</button>
        <button class="btn btn-primario" id="btn-guardar-e">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px">Si el tipo es Permiso, Incapacidad, Vacaciones o Retardo justificado, esos días
        <b>no cuentan como falta ni retardo</b>. Puedes poner un <b>rango</b> con «Hasta» (ej. incapacidad de varios días): los sábados
        y domingos dentro del rango se omiten solos, porque no cuentan para permisos ni vacaciones. «Cambio turno» aplica el turno alternativo a cada día del rango.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Empleado</th><th>Desde</th><th>Hasta (opcional)</th><th>Tipo</th><th>Turno alternativo</th><th>Observación</th><th></th></tr></thead>
        <tbody id="cuerpo-exc">${excepciones.map(fila).join('')}</tbody>
      </table></div>
      <div id="msg-exc"></div>
    </div>`;

  // --- capturas de horario con foto ---
  function reducirFoto(archivo) {
    return new Promise((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolver(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => rechazar(new Error('No se pudo leer la imagen'));
      img.src = URL.createObjectURL(archivo);
    });
  }

  function verFoto(dataURL) {
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    fondo.innerHTML = `<img src="${dataURL}" style="max-width:92vw;max-height:92vh;border-radius:8px">`;
    fondo.addEventListener('click', () => fondo.remove());
    document.body.appendChild(fondo);
  }

  $('#btn-agregar-c').addEventListener('click', () => {
    $('#cuerpo-cap').insertAdjacentHTML('beforeend', filaCaptura({ idReloj: EMPLEADOS[0]?.idReloj, fecha: '' }));
  });
  $('#cuerpo-cap').addEventListener('click', async e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.classList.contains('btn-quitar')) {
      if (confirm('¿Eliminar esta captura de horario?')) tr.remove();
    } else if (e.target.classList.contains('btn-foto')) {
      tr.querySelector('.inp-foto').click();
    } else if (e.target.classList.contains('btn-ver-foto')) {
      const foto = tr.querySelector('[data-c="foto"]').value;
      if (foto) verFoto(foto);
    }
  });
  $('#cuerpo-cap').addEventListener('change', async e => {
    if (!e.target.classList.contains('inp-foto')) return;
    const tr = e.target.closest('tr');
    const archivo = e.target.files[0];
    if (!archivo) return;
    try {
      tr.querySelector('[data-c="foto"]').value = await reducirFoto(archivo);
      tr.querySelector('.btn-ver-foto').style.display = '';
      $('#msg-cap').innerHTML = '<div class="aviso aviso-info">📷 Foto lista. No olvides dar «Guardar cambios».</div>';
    } catch (err) {
      alert('No se pudo procesar la foto: ' + err.message);
    }
  });
  $('#btn-guardar-c').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-cap tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const reg = { idReloj: +v('idReloj').value, fecha: v('fecha').value, entrada: v('entrada').value, salida: v('salida').value, capturadoPor: v('capturadoPor').value.trim(), nota: v('nota').value.trim(), foto: v('foto').value };
      if (reg.idReloj && reg.fecha && reg.entrada && reg.salida) {
        if (!reg.capturadoPor) { $('#msg-cap').innerHTML = '<div class="aviso aviso-error">Falta «Capturado por» en una fila: escribe quién hace la captura.</div>'; return; }
        lista.push(reg);
      }
    }
    await api('/api/capturas', { method: 'PUT', body: lista });
    $('#msg-cap').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
  });

  $('#btn-agregar-v').addEventListener('click', () => {
    $('#cuerpo-via').insertAdjacentHTML('beforeend', filaViaje({ idReloj: EMPLEADOS[0]?.idReloj, desde: '', hasta: '', horasExtraDia: 0 }));
  });
  $('#cuerpo-via').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar')) e.target.closest('tr').remove();
  });
  $('#btn-guardar-v').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-via tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const reg = { idReloj: +v('idReloj').value, desde: v('desde').value, hasta: v('hasta').value || v('desde').value, horasExtraDia: +v('horasExtraDia').value || 0, nota: v('nota').value.trim() };
      if (reg.idReloj && reg.desde) {
        if (reg.hasta < reg.desde) reg.hasta = reg.desde;
        lista.push(reg);
      }
    }
    await api('/api/viajes', { method: 'PUT', body: lista });
    $('#msg-via').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
  });

  $('#btn-agregar-a').addEventListener('click', () => {
    $('#cuerpo-asig').insertAdjacentHTML('beforeend', filaAsig({ idReloj: EMPLEADOS[0]?.idReloj, inicio: '', turno: TURNOS[0]?.codigo }));
  });
  $('#cuerpo-asig').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar')) e.target.closest('tr').remove();
  });
  $('#btn-guardar-a').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-asig tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const a = { idReloj: +v('idReloj').value, inicio: v('inicio').value ? ajustarInicioSemana(v('inicio').value) : '', turno: v('turno').value, nota: v('nota').value.trim() };
      if (a.idReloj && a.inicio && a.turno) lista.push(a);
    }
    await api('/api/asignaciones', { method: 'PUT', body: lista });
    $('#msg-asig').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
  });

  $('#btn-agregar-e').addEventListener('click', () => {
    $('#cuerpo-exc').insertAdjacentHTML('beforeend', fila({ idReloj: EMPLEADOS[0]?.idReloj, fecha: '', tipo: 'Permiso' }));
  });
  $('#cuerpo-exc').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar')) e.target.closest('tr').remove();
  });
  $('#btn-guardar-e').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-exc tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const e = { idReloj: +v('idReloj').value, fecha: v('fecha').value, hasta: v('hasta').value, tipo: v('tipo').value, turnoAlternativo: v('turnoAlternativo').value, observacion: v('observacion').value.trim() };
      if (e.hasta && e.hasta < e.fecha) e.hasta = e.fecha;
      if (e.idReloj && e.fecha) lista.push(e);
    }
    await api('/api/excepciones', { method: 'PUT', body: lista });
    $('#msg-exc').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
  });
};

// ============================================================
// VISTA: PRÉSTAMOS
// ============================================================
VISTAS.prestamos = async function () {
  const prestamos = await api('/api/prestamos');
  const banco = await api('/api/banco');

  const opcionesEmp = id => EMPLEADOS.filter(e => e.activo).map(e =>
    `<option value="${e.idReloj}" ${e.idReloj == id ? 'selected' : ''}>${e.idReloj} — ${esc(e.nombre)}</option>`).join('');

  function fila(p) {
    return `<tr data-id="${esc(p.id || '')}">
      <td><select data-c="idReloj">${opcionesEmp(p.idReloj)}</select></td>
      <td><input type="date" value="${p.fecha || ''}" data-c="fecha"></td>
      <td><input type="number" value="${p.monto ?? ''}" data-c="monto" style="width:90px" step="0.01"></td>
      <td><input type="number" value="${p.abono ?? ''}" data-c="abono" style="width:90px" step="0.01" title="Se descuenta cada periodo al cerrar"></td>
      <td class="num">${p.saldo != null ? dinero(p.saldo) : '(igual al monto)'}</td>
      <td style="text-align:center"><input type="checkbox" ${p.activo !== false ? 'checked' : ''} data-c="activo"></td>
      <td><input value="${esc(p.nota || '')}" data-c="nota" style="width:180px"></td>
      <td><button class="btn btn-mini btn-peligro btn-quitar">✕</button></td>
    </tr>`;
  }

  const saldosBanco = Object.entries(banco).filter(([, h]) => h > 0)
    .map(([id, h]) => `<span class="etiqueta et-azul" style="margin:2px">${esc(nombreEmpleado(id))}: <b>${h.toFixed(1)} h</b></span>`).join(' ');

  contenido.innerHTML = `
    <div class="tarjeta">
      <h2>Banco de horas</h2>
      <p class="texto-chico" style="margin-bottom:8px">Horas extra guardadas (en lugar de pagarse) que pueden usarse para cubrir faltas. Se administran desde la pestaña Nómina.</p>
      ${saldosBanco || '<p>Nadie tiene horas guardadas por ahora.</p>'}
    </div>
    <div class="tarjeta">
      <div class="fila-controles">
        <h2 style="margin:0">Préstamos a empleados</h2>
        <span style="flex:1"></span>
        <button class="btn" id="btn-agregar-p">➕ Agregar préstamo</button>
        <button class="btn btn-primario" id="btn-guardar-p">💾 Guardar cambios</button>
      </div>
      <p class="texto-chico" style="margin:6px 0 10px">El <b>abono</b> se descuenta del pago en cada periodo al momento de <b>cerrar el periodo</b> en la pestaña Nómina, hasta agotar el saldo.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Empleado</th><th>Fecha</th><th>Monto</th><th>Abono por periodo</th><th>Saldo</th><th>Activo</th><th>Nota</th><th></th></tr></thead>
        <tbody id="cuerpo-pre">${prestamos.map(fila).join('')}</tbody>
      </table></div>
      <div id="msg-pre"></div>
    </div>`;

  $('#btn-agregar-p').addEventListener('click', () => {
    $('#cuerpo-pre').insertAdjacentHTML('beforeend', fila({ idReloj: EMPLEADOS[0]?.idReloj, fecha: new Date().toISOString().slice(0, 10) }));
  });
  $('#cuerpo-pre').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar') && confirm('¿Eliminar este préstamo?')) e.target.closest('tr').remove();
  });
  $('#btn-guardar-p').addEventListener('click', async () => {
    const lista = [];
    for (const tr of document.querySelectorAll('#cuerpo-pre tr')) {
      const v = c => tr.querySelector(`[data-c="${c}"]`);
      const anterior = prestamos.find(p => p.id === tr.dataset.id);
      const monto = +v('monto').value || 0;
      const p = {
        id: tr.dataset.id || ('p' + Date.now() + Math.random().toString(36).slice(2, 6)),
        idReloj: +v('idReloj').value, fecha: v('fecha').value,
        monto, abono: +v('abono').value || 0,
        saldo: anterior ? anterior.saldo : monto,
        activo: v('activo').checked, nota: v('nota').value.trim(),
      };
      if (anterior && anterior.monto !== monto) p.saldo = monto; // si corrigen el monto, se reinicia el saldo
      if (p.idReloj && p.monto > 0) lista.push(p);
    }
    await api('/api/prestamos', { method: 'PUT', body: lista });
    $('#msg-pre').innerHTML = '<div class="aviso aviso-ok">✅ Cambios guardados</div>';
    navegar('prestamos');
  });
};

// ============================================================
// VISTA: PARÁMETROS
// ============================================================
VISTAS.parametros = async function () {
  PARAMETROS = await api('/api/parametros');
  const p = PARAMETROS;
  const feriados = p.feriados || [];

  contenido.innerHTML = `
    <div class="tarjeta">
      <h2>Parámetros generales</h2>
      <div class="fila-controles">
        <div class="campo"><label>Nombre de la empresa</label><input id="pa-empresa" value="${esc(p.empresa)}" style="width:240px"></div>
        <div class="campo"><label>Inicio de semana de nómina</label>
          <select id="pa-dia">${[1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}" ${p.diaInicioSemana == d ? 'selected' : ''}>${DIAS_NOMBRE[d]}</option>`).join('')}</select></div>
        <div class="campo"><label>Viernes de pago del Grupo A (referencia)</label>
          <input type="date" id="pa-ancla" value="${esc(p.anclaGrupoA || '')}" title="Un viernes en que cobró (o cobrará) el Grupo A; de ahí se alternan A y B"></div>
        <div class="campo"><label>Contraseña de acceso (vacío = sin login)</label><input id="pa-pass" value="${esc(p.password || '')}"></div>
      </div>
      <h3>Reglas de asistencia</h3>
      <div class="fila-controles">
        <div class="campo"><label>Tolerancia de entrada (min)</label><input type="number" id="pa-tolerancia" value="${p.toleranciaMin}" style="width:80px"></div>
        <div class="campo"><label>Retardos para 1 día de descuento</label><input type="number" id="pa-retardos" value="${p.retardosPorFalta}" style="width:80px"></div>
        <div class="campo"><label>Castigo por no checar regreso (min)</label><input type="number" id="pa-castigo" value="${p.castigoMin}" style="width:80px"></div>
        <div class="campo"><label>Umbral de horas extra (h)</label><input type="number" id="pa-umbral" value="${p.umbralHorasExtra}" step="0.25" style="width:80px"></div>
        <div class="campo"><label>Hora extra normal (× hora normal)</label><input type="number" id="pa-factor" value="${p.factorHoraExtra ?? 1.5}" step="0.25" style="width:80px"></div>
        <div class="campo"><label>Hora extra CNC (× hora normal)</label><input type="number" id="pa-factor-cnc" value="${p.factorHoraExtraCNC ?? 2}" step="0.25" style="width:80px"></div>
        <div class="campo"><label>Domingo trabajado (× hora normal, todos)</label><input type="number" id="pa-factor-dom" value="${p.factorHoraExtraDomingo ?? 2}" step="0.25" style="width:80px"></div>
        <div class="campo"><label>Conteo de horas extra</label>
          <select id="pa-redondeo">
            <option value="0" ${!p.redondeoHE ? 'selected' : ''}>Exacto al minuto (recomendado)</option>
            <option value="0.5" ${p.redondeoHE == 0.5 ? 'selected' : ''}>Redondear a media hora (2.78 → 2.5)</option>
            <option value="1" ${p.redondeoHE == 1 ? 'selected' : ''}>Redondear a hora completa (2.78 → 2)</option>
          </select></div>
        <div class="campo"><label>Desayuno por defecto (min)</label><input type="number" id="pa-desayuno" value="${p.desayunoMin}" style="width:80px"></div>
        <div class="campo"><label>Comida por defecto (min)</label><input type="number" id="pa-comida" value="${p.comidaMin}" style="width:80px"></div>
        <div class="campo"><label>Olvido de entrada a partir de (min tarde)</label><input type="number" id="pa-olvido" value="${p.olvidoEntradaMin}" style="width:80px"></div>
        <div class="campo"><label>Checada doble: ignorar la 2ª si viene a menos de (min)</label><input type="number" id="pa-doble" value="${p.ventanaDobleChecada ?? 5}" style="width:80px"></div>
        <div class="campo"><label>Monto de dispersión bancaria</label><input type="number" id="pa-dispersion" value="${p.montoDispersion}" step="0.01" style="width:110px"></div>
      </div>
      <h3>Días feriados</h3>
      <div id="lista-feriados">
        ${feriados.map((f, i) => `<div class="fila-controles" data-i="${i}">
          <input type="date" value="${f.fecha}" data-c="fecha">
          <input value="${esc(f.descripcion || '')}" data-c="descripcion" placeholder="Descripción" style="width:220px">
          <button class="btn btn-mini btn-peligro btn-quitar-f">✕</button></div>`).join('')}
      </div>
      <button class="btn btn-mini" id="btn-feriado">➕ Agregar feriado</button>
      <div style="margin-top:16px">
        <button class="btn btn-primario" id="btn-guardar-pa">💾 Guardar parámetros</button>
        <span id="msg-pa"></span>
      </div>
    </div>
    <div class="tarjeta">
      <h2>Respaldo de toda la información</h2>
      <p class="texto-chico" style="margin:6px 0 10px">Descarga un archivo con TODO (empleados, checadas, nómina, préstamos, configuración).
        Sirve como copia de seguridad y para <b>migrar los datos a la versión en la nube (Render)</b>: descargas aquí y restauras allá.</p>
      <div class="fila-controles">
        <button class="btn btn-azul" id="btn-respaldo">⬇️ Descargar respaldo completo</button>
        <button class="btn" id="btn-restaurar">⬆️ Restaurar desde un respaldo…</button>
        <input type="file" id="archivo-respaldo" accept=".json" style="display:none">
        <span id="msg-respaldo"></span>
      </div>
    </div>`;

  $('#btn-feriado').addEventListener('click', () => {
    $('#lista-feriados').insertAdjacentHTML('beforeend', `<div class="fila-controles">
      <input type="date" data-c="fecha"><input data-c="descripcion" placeholder="Descripción" style="width:220px">
      <button class="btn btn-mini btn-peligro btn-quitar-f">✕</button></div>`);
  });
  $('#lista-feriados').addEventListener('click', e => {
    if (e.target.classList.contains('btn-quitar-f')) e.target.closest('.fila-controles').remove();
  });

  $('#btn-respaldo').addEventListener('click', async () => {
    const datos = await api('/api/respaldo');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }));
    a.download = `respaldo_nomina_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    $('#msg-respaldo').innerHTML = '<span class="etiqueta et-verde">✅ Respaldo descargado</span>';
  });
  $('#btn-restaurar').addEventListener('click', () => $('#archivo-respaldo').click());
  $('#archivo-respaldo').addEventListener('change', async () => {
    const archivo = $('#archivo-respaldo').files[0];
    if (!archivo) return;
    if (!confirm('¿Restaurar este respaldo? REEMPLAZA todos los datos actuales (empleados, checadas, nómina, configuración).')) return;
    try {
      const datos = JSON.parse(await archivo.text());
      const r = await api('/api/respaldo/restaurar', { method: 'POST', body: datos });
      $('#msg-respaldo').innerHTML = `<span class="etiqueta et-verde">✅ Restaurado (${r.restauradas} secciones). Recargando…</span>`;
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      $('#msg-respaldo').innerHTML = `<span class="etiqueta et-rojo">Error: ${esc(e.message)}</span>`;
    }
  });

  $('#btn-guardar-pa').addEventListener('click', async () => {
    const feriados = [...document.querySelectorAll('#lista-feriados > div')].map(d => ({
      fecha: d.querySelector('[data-c="fecha"]').value,
      descripcion: d.querySelector('[data-c="descripcion"]').value.trim(),
    })).filter(f => f.fecha);
    await api('/api/parametros', {
      method: 'PUT', body: {
        empresa: $('#pa-empresa').value.trim(),
        diaInicioSemana: +$('#pa-dia').value,
        anclaGrupoA: $('#pa-ancla').value,
        password: $('#pa-pass').value,
        toleranciaMin: +$('#pa-tolerancia').value,
        retardosPorFalta: +$('#pa-retardos').value,
        castigoMin: +$('#pa-castigo').value,
        umbralHorasExtra: +$('#pa-umbral').value,
        factorHoraExtra: +$('#pa-factor').value || 1.5,
        factorHoraExtraCNC: +$('#pa-factor-cnc').value || 2,
        factorHoraExtraDomingo: +$('#pa-factor-dom').value || 2,
        redondeoHE: +$('#pa-redondeo').value,
        desayunoMin: +$('#pa-desayuno').value,
        comidaMin: +$('#pa-comida').value,
        olvidoEntradaMin: +$('#pa-olvido').value,
        ventanaDobleChecada: +$('#pa-doble').value,
        montoDispersion: +$('#pa-dispersion').value,
        feriados,
      },
    });
    PARAMETROS = await api('/api/parametros');
    $('#msg-pa').innerHTML = ' <span class="etiqueta et-verde">✅ Guardado</span>';
  });
};

iniciar();
