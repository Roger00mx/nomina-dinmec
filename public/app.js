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
// VISTA: FORMATOS DE DINMEC-APP CONTRA EL RELOJ
// Horas extra (FO-RHS-07), permisos (FO-RHS-08) y vacaciones (FO-RHS-09)
// de cada trabajador que cobra en la fecha de pago, comparados día por día con el reloj.
// ============================================================
const ESTADO_CONC = {
  coincide:          { t: 'Coincide',                  c: 'et-verde' },
  formato_mas:       { t: 'Formato con más horas',     c: 'et-rojo' },
  reloj_mas:         { t: 'Reloj con más horas',       c: 'et-ambar' },
  sin_checadas:      { t: 'Formato sin checadas',      c: 'et-rojo' },
  reloj_sin_formato: { t: 'Extra sin formato',         c: 'et-ambar' },
  sin_extra:         { t: '',                          c: '' },
};
let FORMATOS = null;
const FORM_ABIERTOS = new Set();

VISTAS.formatos = async function () {
  FORMATOS = await api(`/api/formatos?fecha=${PAGO.fecha}`);
  PAGO.fecha = FORMATOS.fechaPago;
  localStorage.setItem('pago', JSON.stringify(PAGO));
  pintarFormatos();
};

function pintarFormatos() {
  const F = FORMATOS;
  const soloRevisar = localStorage.getItem('form_solo') === '1';
  const busca = (localStorage.getItem('form_busca') || '').toLowerCase();
  const conAlgo = e => e.he.length || e.permisos.length || e.vacaciones.length || e.filas.some(x => x.estado !== 'sin_extra');
  const lista = F.empleados
    .filter(e => !busca || e.nombre.toLowerCase().includes(busca) || String(e.idReloj) === busca)
    .filter(e => !soloRevisar || e.revisar > 0)
    .sort((a, b) => (b.revisar - a.revisar) || (conAlgo(b) - conAlgo(a)) || a.nombre.localeCompare(b.nombre));
  const tot = k => F.empleados.reduce((a, e) => a + (e[k] || 0), 0);
  const nFormatos = new Set(F.empleados.flatMap(e => [...e.he, ...e.permisos, ...e.vacaciones].map(x => x.folio))).size;
  const pendientesApp = F.empleados.reduce((a, e) => a + e.he.filter(t => !t.firme).length, 0);

  contenido.innerHTML = '';
  const cont = document.createElement('div');
  const tarjetaSel = document.createElement('div');
  tarjetaSel.className = 'tarjeta';
  tarjetaSel.appendChild(selectorPago(() => navegar('formatos')));
  cont.appendChild(tarjetaSel);

  cont.insertAdjacentHTML('beforeend', `
    ${!F.dinmecOk ? `<div class="aviso aviso-error">No se pudieron traer los formatos de dinmec-app: ${esc(F.dinmecError || '')}</div>` : ''}
    <div class="aviso aviso-info">🧾 Formatos de <b>dinmec-app</b> (horas extra FO-RHS-07, permisos FO-RHS-08 y vacaciones) de quienes cobran el
      <b>${fechaBonita(F.fechaPago)}</b>, comparados día por día con el reloj. Tolerancia: ${Math.round(F.tolerancia * 60)} min.
      <b>Autorizar formato</b> paga las horas del formato ese día aunque el reloj no las muestre; <b>Emparejar</b> deja constancia de que se revisó y se paga lo del reloj.</div>
    <div class="kpis">
      <div class="kpi"><div class="valor">${nFormatos}</div><div class="nombre">Formatos en el periodo</div></div>
      <div class="kpi"><div class="valor">${tot('heFormato').toFixed(1)} h</div><div class="nombre">H.E. en formatos</div></div>
      <div class="kpi"><div class="valor">${tot('heReloj').toFixed(1)} h</div><div class="nombre">H.E. según reloj</div></div>
      <div class="kpi"><div class="valor">${tot('hePagadas').toFixed(1)} h</div><div class="nombre">H.E. a pagar</div></div>
      <div class="kpi"><div class="valor" style="color:${tot('revisar') ? '#d29922' : ''}">${tot('revisar')}</div><div class="nombre">Días por revisar</div></div>
      <div class="kpi"><div class="valor">${pendientesApp}</div><div class="nombre">Tareas sin autorizar en la app</div></div>
    </div>
    ${F.sinEnlazar.length ? `<div class="aviso aviso-ambar">⚠️ Formatos de personas que no se encontraron en nómina (revisa su número de empleado):
      ${F.sinEnlazar.map(x => `<b>${esc(x.nombre || '¿?')}</b>${x.numEmpleado != null ? ' #' + esc(x.numEmpleado) : ''} (${esc(x.folios.join(', '))})`).join(' · ')}</div>` : ''}
    <div class="tarjeta">
      <div class="fila-controles">
        <div class="campo"><label>Buscar trabajador</label><input id="form-busca" value="${esc(busca)}" placeholder="Nombre o ID"></div>
        <label style="align-self:center"><input type="checkbox" id="form-solo" ${soloRevisar ? 'checked' : ''}> Solo con días por revisar</label>
        <span style="flex:1"></span>
        <button class="btn btn-azul" id="form-imprimir-todos">🖨️ Imprimir los que tienen formatos</button>
      </div>
      <div class="tabla-scroll"><table>
        <thead><tr><th>ID</th><th>Trabajador</th><th>Periodo</th><th>H.E. formato</th><th>H.E. reloj</th><th>H.E. a pagar</th>
          <th>Permisos</th><th>Vacaciones</th><th>Por revisar</th><th></th></tr></thead>
        <tbody id="form-cuerpo">${lista.map(filaTrabajadorFormatos).join('') || '<tr><td colspan="10">Sin trabajadores con ese filtro.</td></tr>'}</tbody>
      </table></div>
    </div>`);
  contenido.appendChild(cont);

  const rehacer = () => pintarFormatos();
  $('#form-busca').addEventListener('change', e => { localStorage.setItem('form_busca', e.target.value.trim()); rehacer(); });
  $('#form-solo').addEventListener('change', e => { localStorage.setItem('form_solo', e.target.checked ? '1' : '0'); rehacer(); });
  $('#form-imprimir-todos').addEventListener('click', () => imprimirResumenes(F.empleados.filter(conAlgo), 'todo'));
  $('#form-cuerpo').addEventListener('click', manejarClickFormatos);
}

// Tareas de horas extra del formato para un día, en orden de hora
const tareasDelDia = (e, fecha) => e.he.filter(t => t.fecha === fecha).sort((a, b) => String(a.horaInicio).localeCompare(String(b.horaInicio)));

// Celda "Horario formato": el horario que capturó el operador en cada tarea, para verlo junto a las checadas
function celdaFormato(e, x) {
  const ts = tareasDelDia(e, x.fecha);
  if (!ts.length) return '—';
  const lineas = ts.map(t => `<div style="white-space:nowrap"><b>${esc(t.horaInicio || '?')} → ${esc(t.horaFin || 'pendiente')}</b>
    <span class="texto-chico">${t.horas != null ? horasYMin(t.horas) : ''}${t.comidaMin ? ` (−${t.comidaMin} min comida)` : ''} · ${esc(t.folio)}${t.firme ? '' : ' · sin autorizar'}</span></div>`).join('');
  return lineas + (ts.length > 1 ? `<div class="texto-chico">Total: <b>${horasYMin(x.horasFormato)}</b></div>` : '');
}

function filaTrabajadorFormatos(e) {
  const abierto = FORM_ABIERTOS.has(String(e.idReloj));
  const dif = +(e.heFormato - e.heReloj).toFixed(2);
  let html = `<tr class="fila-click" data-abrir="${e.idReloj}" style="cursor:pointer">
    <td>${e.idReloj}</td>
    <td><b>${esc(e.nombre)}</b><div class="texto-chico">${esc(NOMBRE_GRUPO[e.grupo] || e.grupo)}</div></td>
    <td class="texto-chico">${fechaBonita(e.periodoInicio)} – ${fechaBonita(e.periodoFin)}</td>
    <td>${e.heFormato ? horasYMin(e.heFormato) : '—'}</td>
    <td>${e.heReloj ? horasYMin(e.heReloj) : '—'}${e.he.length && Math.abs(dif) > FORMATOS.tolerancia ? ` <span class="etiqueta ${dif > 0 ? 'et-rojo' : 'et-ambar'}">${dif > 0 ? '+' : '−'}${horasYMin(Math.abs(dif))}</span>` : ''}</td>
    <td><b>${e.hePagadas ? horasYMin(e.hePagadas) : '—'}</b></td>
    <td>${e.permisos.length || '—'}</td>
    <td>${e.vacaciones.length ? e.filas.filter(x => x.vacaciones).length + ' día(s)' : '—'}</td>
    <td>${e.revisar ? `<span class="etiqueta et-ambar">${e.revisar}</span>` : (e.he.length ? '<span class="etiqueta et-verde">OK</span>' : '—')}</td>
    <td style="white-space:nowrap"><button class="btn btn-mini" data-imprimir="${e.idReloj}">🖨️ Resumen</button> ${abierto ? '▲' : '▼'}</td>
  </tr>`;
  if (abierto) html += `<tr><td colspan="10" style="background:rgba(255,255,255,.02)">${detalleTrabajadorFormatos(e)}</td></tr>`;
  return html;
}

function detalleTrabajadorFormatos(e) {
  const filas = e.filas.filter(x => x.estado !== 'sin_extra' || x.permisos.length || x.vacaciones || x.falta || x.decision);
  const accion = x => {
    const hayF = x.horasFormato > 0 || x.folios.length;
    const dec = x.decision;
    if (dec) {
      return `<span class="etiqueta ${dec.usar === 'formato' ? 'et-azul' : 'et-verde'}">${dec.usar === 'formato' ? `Autorizado formato: ${horasYMin(dec.horas)}` : 'Emparejado (reloj)'}</span>
        <button class="btn btn-mini" data-quitar="${e.idReloj}|${x.fecha}" title="Quitar decisión">↺</button>`;
    }
    if (!hayF) return '';
    return `<button class="btn btn-mini btn-primario" data-autorizar="${e.idReloj}|${x.fecha}" title="Pagar las horas del formato ese día">✔ Autorizar formato</button>
      <button class="btn btn-mini" data-emparejar="${e.idReloj}|${x.fecha}" title="Revisado: se paga lo que marca el reloj">🔗 Emparejar</button>`;
  };
  const tareas = e.he.map(t => `<tr>
      <td>${fechaBonita(t.fecha)}</td><td>${esc(t.folio)}</td>
      <td>${esc(t.horaInicio || '—')} → ${esc(t.horaFin || 'pendiente')}${t.comidaMin ? ` <span class="texto-chico">(−${t.comidaMin} min comida)</span>` : ''}</td>
      <td><b>${t.horas != null ? horasYMin(t.horas) : '—'}</b></td>
      <td>${esc(t.descripcion)}</td>
      <td>${t.firme ? `<span class="etiqueta et-verde">${esc(t.estatusTxt)}</span>` : `<span class="etiqueta et-ambar">${esc(t.estatusTxt)}</span>`}</td></tr>`).join('');
  const permisos = e.permisos.map(b => `<tr><td>${fechaBonita(b.fecha)}</td><td>${esc(b.folio)}</td>
      <td>${esc(b.horaSalida || '—')} → ${esc(b.horaRegreso || '—')}${b.fechaRegreso && b.fechaRegreso !== b.fecha ? ' (' + fechaBonita(b.fechaRegreso) + ')' : ''}</td>
      <td>${b.horas != null ? horasYMin(b.horas) : '—'}</td><td>${b.pagaHoras ? 'Se pagan' : 'Las repone'}${b.reposicion.length ? ': ' + b.reposicion.map(r => `${fechaBonita(r.del)} ${r.entrada || ''}–${r.salida || ''}`).join(', ') : ''}</td>
      <td><span class="etiqueta ${b.firme ? 'et-verde' : 'et-ambar'}">${esc(b.estatusTxt)}</span></td></tr>`).join('');
  const vacs = e.vacaciones.map(v => `<span class="etiqueta ${v.firme ? 'et-verde' : 'et-ambar'}">${esc(v.folio)} · ${fechaBonita(v.inicio)} a ${fechaBonita(v.fin)} · ${v.dias} día(s) · ${esc(v.estatusTxt)}</span>`).join(' ');

  return `
    <div style="padding:6px 2px">
      <h3 style="margin:4px 0 8px">Día por día: formato contra reloj</h3>
      ${filas.length ? `<div class="tabla-scroll"><table>
        <thead><tr><th>Fecha</th><th>Turno</th><th>Checadas (reloj)</th><th>H.E. reloj</th><th>Horario formato</th><th>Resultado</th><th>Se paga</th><th>Permiso / vacación</th><th>Acción</th></tr></thead>
        <tbody>${filas.map(x => `<tr>
          <td><b>${x.dia}</b> ${fechaBonita(x.fecha)}</td>
          <td class="texto-chico">${esc(x.turno || '')}${x.laboral ? '' : ' (descanso)'}</td>
          <td style="white-space:nowrap">${x.numChecadas ? `<b>${esc(x.entrada || '—')} → ${esc(x.salida || '—')}</b>` : (x.falta ? '<span class="etiqueta et-rojo">Falta</span>' : '—')}
            ${x.esRetardo ? `<span class="etiqueta et-ambar">Retardo +${x.retardoMin}m</span>` : ''}</td>
          <td>${x.horasExtrasReloj ? horasYMin(x.horasExtrasReloj) : '—'}</td>
          <td>${celdaFormato(e, x)}</td>
          <td>${ESTADO_CONC[x.estado].t ? `<span class="etiqueta ${ESTADO_CONC[x.estado].c}">${ESTADO_CONC[x.estado].t}</span>` : ''}</td>
          <td><b>${x.horasExtrasPagadas ? horasYMin(x.horasExtrasPagadas) : '—'}</b>${x.horasDebe && x.horasExtrasReloj ? `<div class="texto-chico" style="color:var(--rojo)">−${horasYMin(x.horasDebe)} que debe ese día</div>` : ''}</td>
          <td class="texto-chico">${x.vacaciones ? '🏖 Vacaciones' : ''}${x.permisos.map(b => `🚪 Permiso ${esc(b.horaSalida || '')}–${esc(b.horaRegreso || '')}`).join('<br>')}${x.excepcion && !x.vacaciones ? esc(x.excepcion) : ''}</td>
          <td style="white-space:nowrap">${accion(x)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="texto-chico">Sin horas extra, formatos ni permisos en el periodo.</p>'}
      ${tareas ? `<h3 style="margin:14px 0 8px">Formatos de horas extra (FO-RHS-07)</h3><div class="tabla-scroll"><table>
        <thead><tr><th>Fecha</th><th>Folio</th><th>Horario</th><th>Horas</th><th>Descripción</th><th>Estatus en app</th></tr></thead><tbody>${tareas}</tbody></table></div>` : ''}
      ${permisos ? `<h3 style="margin:14px 0 8px">Permisos de salida (FO-RHS-08)</h3><div class="tabla-scroll"><table>
        <thead><tr><th>Fecha</th><th>Folio</th><th>Salida → regreso</th><th>Horas</th><th>Pago</th><th>Estatus en app</th></tr></thead><tbody>${permisos}</tbody></table></div>` : ''}
      ${vacs ? `<h3 style="margin:14px 0 8px">Vacaciones</h3><p>${vacs}</p>` : ''}
    </div>`;
}

async function manejarClickFormatos(ev) {
  const b = ev.target.closest('button');
  const empDe = id => FORMATOS.empleados.find(x => String(x.idReloj) === String(id));
  if (b) {
    ev.stopPropagation();
    if (b.dataset.imprimir) return imprimirResumenes([empDe(b.dataset.imprimir)], null);
    const par = b.dataset.autorizar || b.dataset.emparejar || b.dataset.quitar;
    if (!par) return;
    const [id, fecha] = par.split('|');
    const e = empDe(id);
    const x = e.filas.find(z => z.fecha === fecha);
    let cuerpo;
    if (b.dataset.autorizar) {
      const txt = prompt(`Horas extra a pagar a ${e.nombre} el ${fechaBonita(fecha)} según formato ${x.folios.join(', ')}.\nReloj: ${x.horasExtrasReloj} h · Formato: ${x.horasFormato} h`, String(x.horasFormato));
      if (txt == null) return;
      const horas = Number(String(txt).replace(',', '.'));
      if (isNaN(horas) || horas < 0 || horas > 24) return alert('Horas inválidas');
      const nota = prompt('Nota / motivo (opcional), p. ej. "trabajó en sitio del cliente, no checó":', '') || '';
      cuerpo = { idReloj: e.idReloj, fecha, usar: 'formato', horas, folios: x.folios.join(', '), nota };
    } else if (b.dataset.emparejar) {
      cuerpo = { idReloj: e.idReloj, fecha, usar: 'reloj', folios: x.folios.join(', '), nota: '' };
    } else {
      if (!confirm('¿Quitar la decisión de este día? Vuelve a pagarse lo que marca el reloj.')) return;
      cuerpo = { idReloj: e.idReloj, fecha, usar: null };
    }
    b.disabled = true;
    try {
      await api('/api/conciliacion', { method: 'PUT', body: cuerpo });
      FORM_ABIERTOS.add(String(e.idReloj));
      await VISTAS.formatos();
    } catch (err) { alert(err.message); b.disabled = false; }
    return;
  }
  const tr = ev.target.closest('tr[data-abrir]');
  if (tr) {
    const k = tr.dataset.abrir;
    FORM_ABIERTOS.has(k) ? FORM_ABIERTOS.delete(k) : FORM_ABIERTOS.add(k);
    pintarFormatos();
  }
}

// Resumen imprimible de la semana o quincena del trabajador (para aclarar dudas con él)
function imprimirResumenes(emps, semana) {
  emps = emps.filter(Boolean);
  if (!emps.length) return alert('No hay trabajadores para imprimir.');
  if (semana === null && emps.length === 1 && emps[0].numSemanas > 1) {
    const r = prompt('¿Qué quieres imprimir?\n0 = Quincena completa\n1 = Semana 1\n2 = Semana 2', '0');
    if (r == null) return;
    semana = ['1', '2'].includes(r.trim()) ? Number(r.trim()) : 'todo';
  }
  const zona = $('#zona-impresion');
  zona.innerHTML = emps.map(e => {
    let ini = e.periodoInicio, fin = e.periodoFin;
    if (semana === 1) fin = sumarDias(ini, 6);
    if (semana === 2) ini = sumarDias(ini, 7);
    const enR = f => f >= ini && f <= fin;
    const filas = e.filas.filter(x => enR(x.fecha));
    const he = e.he.filter(t => enR(t.fecha));
    const permisos = e.permisos.filter(b => enR(b.fecha));
    const sum = k => filas.reduce((a, x) => a + (x[k] || 0), 0);
    return `<div class="recibo resumen-semana">
      <div class="recibo-cab"><img src="logo.png" alt="">
        <div><h2>${esc(FORMATOS.empresa)} — Resumen de asistencia y horas extra</h2>
          <div>${esc(e.nombre)} · N° ${e.idReloj} · ${esc(NOMBRE_GRUPO[e.grupo] || e.grupo)} · Periodo ${fechaBonita(ini)} al ${fechaBonita(fin)} · Pago del ${fechaBonita(FORMATOS.fechaPago)}</div></div></div>
      <table>
        <tr><th>Día</th><th>Turno</th><th>Entrada</th><th>Salida</th><th>Hrs trab.</th><th>H.E. reloj</th><th>Horario formato</th><th>H.E. pagadas</th><th>Observaciones</th></tr>
        ${filas.map(x => `<tr><td>${x.dia} ${fechaBonita(x.fecha)}</td><td>${esc(x.turno || '')}${x.laboral ? '' : ' (desc.)'}</td>
          <td>${esc(x.entrada || '—')}</td><td>${esc(x.salida || '—')}</td><td class="num">${x.horasTrabajadas ? x.horasTrabajadas.toFixed(2) : '—'}</td>
          <td class="num">${x.horasExtrasReloj ? horasYMin(x.horasExtrasReloj) : '—'}</td>
          <td>${tareasDelDia(e, x.fecha).map(t => `${esc(t.horaInicio || '?')}–${esc(t.horaFin || '?')} <b>${t.horas != null ? horasYMin(t.horas) : ''}</b>`).join('<br>') || '—'}${x.folios.length ? '<br><small>' + esc(x.folios.join(', ')) + '</small>' : ''}</td>
          <td class="num"><b>${x.horasExtrasPagadas ? horasYMin(x.horasExtrasPagadas) : '—'}</b></td>
          <td><small>${[x.falta ? 'Falta' : '', x.esRetardo ? `Retardo +${x.retardoMin} min` : '', x.vacaciones ? 'Vacaciones' : '',
            ...x.permisos.map(b => `Permiso ${b.horaSalida || ''}–${b.horaRegreso || ''} (${b.pagaHoras ? 'se paga' : 'repone'})`),
            ESTADO_CONC[x.estado].t && x.estado !== 'coincide' ? ESTADO_CONC[x.estado].t : '',
            x.decision ? (x.decision.usar === 'formato' ? `Autorizado por formato${x.decision.nota ? ': ' + x.decision.nota : ''}` : 'Revisado contra reloj') : ''].filter(Boolean).map(esc).join(' · ')}</small></td></tr>`).join('')}
        <tr><td colspan="4"><b>Totales</b></td><td class="num"><b>${sum('horasTrabajadas').toFixed(2)}</b></td><td class="num"><b>${horasYMin(sum('horasExtrasReloj'))}</b></td>
          <td class="num"><b>${horasYMin(sum('horasFormato'))}</b></td><td class="num"><b>${horasYMin(sum('horasExtrasPagadas'))}</b></td>
          <td><small>${filas.filter(x => x.falta).length} falta(s) · ${filas.filter(x => x.esRetardo).length} retardo(s)</small></td></tr>
      </table>
      ${he.length ? `<p style="margin:10px 0 4px"><b>Horas extra reportadas (FO-RHS-07)</b></p><table>
        <tr><th>Fecha</th><th>Folio</th><th>Horario</th><th>Horas</th><th>Actividad</th><th>Estatus</th></tr>
        ${he.map(t => `<tr><td>${fechaBonita(t.fecha)}</td><td>${esc(t.folio)}</td><td>${esc(t.horaInicio || '')}–${esc(t.horaFin || '')}</td>
          <td class="num">${t.horas != null ? horasYMin(t.horas) : '—'}</td><td>${esc(t.descripcion)}</td><td>${esc(t.estatusTxt)}</td></tr>`).join('')}</table>` : ''}
      ${permisos.length ? `<p style="margin:10px 0 4px"><b>Permisos de salida (FO-RHS-08)</b></p><table>
        <tr><th>Fecha</th><th>Folio</th><th>Salida → regreso</th><th>Horas</th><th>Pago</th></tr>
        ${permisos.map(b => `<tr><td>${fechaBonita(b.fecha)}</td><td>${esc(b.folio)}</td><td>${esc(b.horaSalida || '')} → ${esc(b.horaRegreso || '')}</td>
          <td class="num">${b.horas != null ? horasYMin(b.horas) : '—'}</td><td>${b.pagaHoras ? 'Se pagan' : 'Las repone'}</td></tr>`).join('')}</table>` : ''}
      <p style="font-size:10.5px;margin-top:8px">H.E. reloj = tiempo extra calculado con las checadas y el turno asignado. H.E. pagadas = lo que entra en la nómina (incluye lo autorizado por formato).
        Cualquier aclaración debe hacerse antes del cierre de nómina.</p>
      <div class="firmas"><div>Trabajador · enterado</div><div>Recursos Humanos</div></div>
    </div>`;
  }).join('');
  window.print();
}


// ============================================================
// VISTA: DASHBOARD DE ASISTENCIA
// Retardos, tiempo extra, puntualidad, cero ausencias, checadas incompletas
// y horas extra por semana y por mes, para el rango de fechas elegido.
// ============================================================
let DASH = null;
VISTAS.dashboard = async function () {
  const hoy = new Date().toISOString().slice(0, 10);
  let rango = JSON.parse(localStorage.getItem('dash_rango') || 'null');
  if (!rango) rango = { desde: hoy.slice(0, 7) + '-01', hasta: hoy };
  contenido.innerHTML = '<div class="tarjeta">Calculando…</div>';
  DASH = await api(`/api/dashboard?desde=${rango.desde}&hasta=${rango.hasta}`);
  pintarDashboard(rango);
};

function pintarDashboard(rango) {
  const D = DASH;
  const E = D.empleados;
  const hoy = new Date().toISOString().slice(0, 10);
  const mesNom = k => new Date(k + '-15T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
  const presets = {
    'Este mes': () => ({ desde: hoy.slice(0, 7) + '-01', hasta: hoy }),
    'Mes pasado': () => { const d = new Date(hoy.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() - 1);
      const ini = d.toISOString().slice(0, 10); return { desde: ini, hasta: sumarDias(hoy.slice(0, 7) + '-01', -1) }; },
    'Últimos 3 meses': () => ({ desde: sumarDias(hoy, -91), hasta: hoy }),
    'Este año': () => ({ desde: hoy.slice(0, 4) + '-01-01', hasta: hoy }),
  };
  const sum = k => E.reduce((a, e) => a + (e[k] || 0), 0);
  const totLab = sum('diasLaborales'), totAsis = sum('asistencias');
  const pct = (a, b) => b ? (Math.round(a / b * 1000) / 10) + '%' : '—';

  const top = (arr, n = 10) => arr.slice(0, n);
  const ranking = (arr, valor, detalle, max) => arr.length ? `<ol class="rank">${arr.map((e, i) => `<li>
      <span class="pos">${i + 1}</span>
      <div><div class="nom">${esc(e.nombre)} <span class="det">#${e.idReloj}</span></div><div class="det">${detalle(e)}</div>
        ${max ? `<div class="barra" style="width:${Math.max(3, Math.round(parseFloat(valor(e, true)) / max * 100))}%"></div>` : ''}</div>
      <span class="val">${valor(e)}</span></li>`).join('')}</ol>` : '<p class="dash-sub">Sin datos en el rango.</p>';

  const masRetardos = top(E.filter(e => e.retardos).sort((a, b) => b.retardos - a.retardos || b.minRetardo - a.minRetardo));
  const masExtra = top(E.filter(e => e.horasExtras).sort((a, b) => b.horasExtras - a.horasExtras));
  const minDias = Math.max(1, Math.floor(Math.max(...E.map(e => e.asistencias), 0) * 0.6));
  const puntuales = top(E.filter(e => e.asistencias >= minDias && e.puntualidad != null)
    .sort((a, b) => b.puntualidad - a.puntualidad || a.minRetardo - b.minRetardo || b.asistencias - a.asistencias));
  const ceroFaltas = E.filter(e => e.diasLaborales && e.faltas === 0).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const conFaltas = E.filter(e => e.faltas).sort((a, b) => b.faltas - a.faltas);
  const noChecan = top(E.filter(e => e.incompletas).sort((a, b) => b.incompletas - a.incompletas), 12);

  const barras = (lista, clase, etiqueta) => {
    const max = Math.max(...lista.map(x => x.horasExtras), 0.01);
    return lista.length ? `<div class="barras">${lista.map(x => `<div class="col ${clase}" title="${esc(etiqueta(x, true))}: ${horasYMin(x.horasExtras) || '0'} · ${Object.keys(x.porEmp).length} persona(s)">
        <div class="b" style="height:${Math.round(x.horasExtras / max * 100)}%"><span>${Math.round(x.horasExtras)}</span></div>
        <div class="et">${esc(etiqueta(x))}</div></div>`).join('')}</div>` : '<p class="dash-sub">Sin horas extra en el rango.</p>';
  };
  const etSemana = (x, largo) => largo ? `Semana del ${fechaBonita(x.clave)} al ${fechaBonita(sumarDias(x.clave, 6))}` : fechaBonita(x.clave).replace(/ \d{4}$/, '');

  const COLS_TABLA = [
    ['nombre', 'Trabajador'], ['diasLaborales', 'Días lab.'], ['asistencias', 'Asistió'], ['faltas', 'Faltas'],
    ['asistencia', '% asist.'], ['retardos', 'Retardos'], ['minRetardo', 'Min. retardo'], ['puntualidad', '% puntual'],
    ['horasExtras', 'H.E.'], ['horasDebe', 'Debe'], ['incompletas', 'Checadas incompletas'], ['diasLibres', 'Permiso/vac.'],
  ];
  const orden = JSON.parse(localStorage.getItem('dash_orden') || '{"k":"horasExtras","d":-1}');
  const tabla = E.slice().sort((a, b) => {
    const x = a[orden.k] ?? -1, y = b[orden.k] ?? -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * orden.d;
  });

  contenido.innerHTML = `
    <div class="tarjeta">
      <div class="fila-controles">
        <div class="campo"><label>Desde</label><input type="date" id="dash-desde" value="${rango.desde}"></div>
        <div class="campo"><label>Hasta</label><input type="date" id="dash-hasta" value="${rango.hasta}"></div>
        <button class="btn btn-primario" id="dash-ver">Ver</button>
        ${Object.keys(presets).map(p => `<button class="btn btn-mini" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}
        <span style="flex:1"></span>
        <button class="btn btn-azul" id="dash-imprimir">🖨️ Imprimir</button>
      </div>
      <p class="texto-chico">Analizado: <b>${fechaBonita(D.desde)}</b> al <b>${fechaBonita(D.hasta)}</b>${D.ultimaChecada && rango.hasta > D.ultimaChecada ? ` (la última checada cargada es del ${fechaBonita(D.ultimaChecada)})` : ''}.
        Se usan las mismas reglas de la nómina: turno, tolerancia, vacaciones de dinmec-app, excepciones y horas extra autorizadas por formato.</p>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="valor">${E.length}</div><div class="nombre">Personas con actividad</div></div>
      <div class="kpi"><div class="valor">${pct(totAsis, totLab)}</div><div class="nombre">Asistencia (${totAsis} de ${totLab} días)</div></div>
      <div class="kpi"><div class="valor">${pct(totAsis - sum('retardos'), totAsis)}</div><div class="nombre">Puntualidad general</div></div>
      <div class="kpi"><div class="valor" style="color:var(--rojo)">${sum('faltas')}</div><div class="nombre">Faltas</div></div>
      <div class="kpi"><div class="valor" style="color:var(--ambar)">${sum('retardos')}</div><div class="nombre">Retardos (${Math.round(sum('minRetardo') / 60)} h perdidas)</div></div>
      <div class="kpi"><div class="valor">${Math.round(sum('horasExtras'))} h</div><div class="nombre">Horas extra autorizadas</div></div>
      <div class="kpi"><div class="valor">${sum('incompletas')}</div><div class="nombre">Días con checadas incompletas</div></div>
    </div>

    <div class="dash-grid">
      <div class="tarjeta"><h3>⏰ Más retardos</h3><div class="dash-sub">Número de retardos y minutos acumulados</div>
        ${ranking(masRetardos, (e, n) => n ? e.retardos : e.retardos + ' ret.', e => `${e.minRetardo} min en total · ${e.asistencias} días asistidos`, masRetardos[0]?.retardos)}</div>
      <div class="tarjeta"><h3>💪 Más tiempo extra</h3><div class="dash-sub">Horas extra que entran a la nómina</div>
        ${ranking(masExtra, (e, n) => n ? e.horasExtras : horasYMin(e.horasExtras), e => `${esc(e.puesto || '')}${e.horasDebe ? ' · debe ' + horasYMin(e.horasDebe) : ''}`, masExtra[0]?.horasExtras)}</div>
      <div class="tarjeta"><h3>🏅 Más puntuales</h3><div class="dash-sub">% de días que llegó a tiempo (mínimo ${minDias} días asistidos)</div>
        ${ranking(puntuales, (e, n) => n ? e.puntualidad : e.puntualidad + '%', e => `${e.puntuales} de ${e.asistencias} días a tiempo${e.retardos ? ' · ' + e.minRetardo + ' min de retardo' : ''}`, 100)}</div>
    </div>

    <div class="dash-grid">
      <div class="tarjeta"><h3>✅ Cero ausencias (${ceroFaltas.length})</h3><div class="dash-sub">Asistieron todos sus días laborales del rango (los días de permiso o vacaciones no cuentan como falta)</div>
        <div class="chips">${ceroFaltas.map(e => `<span class="etiqueta et-verde" title="${e.asistencias} días">${esc(e.nombre)}</span>`).join('') || '<span class="dash-sub">Nadie en el rango.</span>'}</div>
        ${conFaltas.length ? `<h3 style="margin-top:14px">❌ Con faltas (${conFaltas.length})</h3><div class="chips">${conFaltas.map(e => `<span class="etiqueta et-rojo">${esc(e.nombre)}: ${e.faltas}</span>`).join('')}</div>` : ''}</div>
      <div class="tarjeta"><h3>🕳️ No checan algún horario</h3><div class="dash-sub">Días con entrada, salida o descansos sin checar</div>
        ${ranking(noChecan, (e, n) => n ? e.incompletas : e.incompletas + ' días', e => Object.entries(e.tiposIncompletas).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)}: ${n}`).join(' · '), noChecan[0]?.incompletas)}</div>
    </div>

    <div class="dash-grid">
      <div class="tarjeta"><h3>📅 Horas extra por semana</h3><div class="dash-sub">Semana de nómina (inicia ${['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][D.diaInicioSemana] || 'viernes'}) · total ${Math.round(sum('horasExtras'))} h</div>
        ${barras(D.semanas, '', etSemana)}</div>
      <div class="tarjeta"><h3>🗓️ Horas extra por mes</h3><div class="dash-sub">Mes calendario</div>
        ${barras(D.meses, 'mes', (x, largo) => largo ? mesNom(x.clave) : mesNom(x.clave))}
        ${D.meses.length ? `<div class="tabla-scroll" style="margin-top:10px"><table><thead><tr><th>Mes</th><th>H.E.</th><th>Personas con H.E.</th><th>Retardos</th><th>Faltas</th></tr></thead><tbody>
          ${D.meses.map(m => `<tr><td>${mesNom(m.clave)}</td><td><b>${horasYMin(m.horasExtras) || '0'}</b></td><td>${Object.keys(m.porEmp).length}</td><td>${m.retardos}</td><td>${m.faltas}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
    </div>

    <div class="tarjeta"><h3 style="color:var(--azul)">Todos los trabajadores</h3><div class="dash-sub">Haz clic en un encabezado para ordenar</div>
      <div class="tabla-scroll"><table><thead><tr>${COLS_TABLA.map(([k, t]) => `<th class="ordenable" data-orden="${k}">${t}${orden.k === k ? (orden.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${tabla.map(e => `<tr><td><b>${esc(e.nombre)}</b> <span class="texto-chico">#${e.idReloj}</span></td>
          <td class="num">${e.diasLaborales}</td><td class="num">${e.asistencias}</td>
          <td class="num">${e.faltas ? `<span class="etiqueta et-rojo">${e.faltas}</span>` : '0'}</td>
          <td class="num">${e.asistencia ?? '—'}${e.asistencia != null ? '%' : ''}</td>
          <td class="num">${e.retardos ? `<span class="etiqueta et-ambar">${e.retardos}</span>` : '0'}</td>
          <td class="num">${e.minRetardo || ''}</td><td class="num">${e.puntualidad ?? '—'}${e.puntualidad != null ? '%' : ''}</td>
          <td class="num"><b>${horasYMin(e.horasExtras)}</b></td><td class="num">${e.horasDebe ? horasYMin(e.horasDebe) : ""}</td>
          <td class="num" title="${esc(Object.entries(e.tiposIncompletas).map(([t, n]) => t + ': ' + n).join(', '))}">${e.incompletas || ''}</td>
          <td class="num">${e.diasLibres || ''}</td></tr>`).join('')}</tbody></table></div></div>`;

  const ir = r => { localStorage.setItem('dash_rango', JSON.stringify(r)); VISTAS.dashboard(); };
  $('#dash-ver').addEventListener('click', () => ir({ desde: $('#dash-desde').value, hasta: $('#dash-hasta').value }));
  contenido.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => ir(presets[b.dataset.preset]())));
  contenido.querySelectorAll('[data-orden]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.orden;
    localStorage.setItem('dash_orden', JSON.stringify({ k, d: orden.k === k ? -orden.d : (k === 'nombre' ? 1 : -1) }));
    pintarDashboard(rango);
  }));
  $('#dash-imprimir').addEventListener('click', () => {
    $('#zona-impresion').innerHTML = `<div class="dash-print"><h2>${esc(DASH.empresa || 'DINMEC')} — Dashboard de asistencia · ${fechaBonita(DASH.desde)} al ${fechaBonita(DASH.hasta)}</h2>${contenido.innerHTML}</div>`;
    window.print();
  });
}


// ============================================================
// TARJETA DEL TRABAJADOR (detalle diario de una persona, estilo hoja de Excel)
// Checadas por columna, horario del formato de H.E. (inicio–fin) junto al reloj
// y enlace para ver el formato completo que capturó el trabajador.
// ============================================================
function hhmmDeHoras(h) {
  if (!h) return '';
  const t = Math.round(h * 60);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

function tarjetaEmpleadoHTML(idReloj, dias, FDIA, FALL, FERR) {
  const emp = EMPLEADOS.find(e => String(e.idReloj) === String(idReloj)) || {};
  const res = (NOMINA.resumen || []).find(r => String(r.idReloj) === String(idReloj)) || {};
  const fEmp = FALL?.empleados?.find(e => String(e.idReloj) === String(idReloj)) || null;
  const nombre = emp.nombre || res.nombre || dias[0]?.nombre || '';
  const limpio = t => (t && t !== '—') ? esc(t) : '';
  const dinero2 = n => n != null && !isNaN(n) ? '$ ' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  let tot = { trab: 0, esp: 0, heReloj: 0, heForm: 0, hePag: 0, debe: 0, ret: 0, faltas: 0 };
  const filas = dias.map((d, i) => {
    const f = FDIA[d.idReloj + '_' + d.fecha] || {};
    const heReloj = d.horasExtrasReloj ?? d.horasExtras;
    tot.trab += d.horasTrabajadas || 0; tot.esp += d.horasEsperadas || 0; tot.heReloj += heReloj || 0;
    tot.heForm += f.horasFormato || 0; tot.hePag += d.horasExtras || 0; tot.debe += d.horasDebe || 0;
    tot.ret += d.esRetardo ? 1 : 0; tot.faltas += d.falta ? 1 : 0;

    const tareas = (f.tareas || []);
    const formato = tareas.length ? tareas.map(t => `<div class="tj-formato">
        <b>${esc(t.horaInicio || '?')} – ${esc(t.horaFin || 'pend.')}</b> <span>${t.horas != null ? hhmmDeHoras(t.horas) : ''}</span>
        <a href="#" data-formato="${esc(t.solicitudId)}" data-tipo="he" title="Ver el formato que capturó">${esc(t.folio)} 🔎</a>${t.firme ? '' : ' <span class="tj-pend">sin autorizar</span>'}</div>`).join('') : '';
    const obs = [];
    if (d.falta) obs.push('<b class="tj-rojo">FALTA</b>');
    if (d.esRetardo) obs.push(`<span class="tj-rojo">Retardo +${d.retardoMin} min</span>`);
    if (f.vacaciones || d.excepcion === 'Vacaciones') obs.push('🏖 Vacaciones');
    for (const b of (f.permisos || [])) obs.push(`🚪 Permiso ${esc(b.horaSalida || '')}–${esc(b.horaRegreso || '')} <a href="#" data-formato="${esc(b.solicitudId)}" data-tipo="ps">${esc(b.folio)} 🔎</a> (${b.pagaHoras ? 'se pagan' : 'las repone'})`);
    if (d.excepcion && d.excepcion !== 'Vacaciones') obs.push(esc(d.excepcion));
    if (d.horasDebe) obs.push(`<span class="tj-rojo">Debe ${horasYMin(d.horasDebe)}${heReloj ? ' (se resta de sus H.E. del día)' : ''}</span>`);
    if (f.estado && f.estado !== 'sin_extra' && f.estado !== 'coincide' && ESTADO_CONC[f.estado]) obs.push(`<span class="etiqueta ${ESTADO_CONC[f.estado].c}">${ESTADO_CONC[f.estado].t}</span>`);
    if (f.decision) obs.push(f.decision.usar === 'formato' ? '✔ Autorizado por formato' : '🔗 Emparejado con reloj');
    const otras = (d.checadas || []).length > 6 ? `<div class="tj-chec">Todas: ${(d.checadas || []).map(esc).join(' · ')}</div>` : '';

    const cls = d.falta ? 'tj-falta' : (!d.laboral ? 'tj-nolab' : '');
    const dif = tareas.length ? Math.abs((f.horasFormato || 0) - (heReloj || 0)) : 0;
    return `<tr class="${cls}">
      <td class="tj-n">${i + 1}</td>
      <td class="tj-fecha">${d.dia} ${fechaBonita(d.fecha)}${d.laboral ? '' : '<div class="tj-chec">no laboral</div>'}</td>
      <td class="${d.esRetardo ? 'tj-retardo' : ''}">${limpio(d.entrada)}</td>
      <td>${limpio(d.salDesayuno)}</td><td>${limpio(d.regDesayuno)}</td>
      <td>${limpio(d.salComida)}</td><td>${limpio(d.regComida)}</td>
      <td><b>${limpio(d.salida)}</b>${otras}</td>
      <td class="tj-horas">${hhmmDeHoras(d.horasTrabajadas) || (d.laboral ? '00:00' : '')}</td>
      <td class="tj-fmt">${formato}</td>
      <td class="tj-num">${hhmmDeHoras(heReloj)}</td>
      <td class="tj-num ${tareas.length && dif > 0.25 ? 'tj-dif' : ''}">${tareas.length ? hhmmDeHoras(f.horasFormato) : ''}</td>
      <td class="tj-num"><b>${hhmmDeHoras(d.horasExtras)}</b></td>
      <td class="tj-obs">${obs.join('<br>')}</td>
      <td class="no-imprimir"><button class="btn btn-mini btn-editar-dia" data-fecha="${d.fecha}" title="Editar entrada/salida a mano">${d.editadoManual ? '✏️✔' : '✏️'}</button></td>
    </tr>`;
  }).join('');
  const dif = +(tot.esp - tot.trab).toFixed(2);

  return `
    <div class="fila-controles no-imprimir" style="justify-content:space-between">
      <button class="btn btn-mini" id="tj-tabla">📋 Ver como tabla</button>
      <button class="btn btn-azul" id="tj-imprimir">🖨️ Imprimir tarjeta</button>
    </div>
    ${FERR ? `<div class="aviso aviso-ambar no-imprimir">No se pudieron traer los formatos de dinmec-app (${esc(FERR)}): se muestra solo lo del reloj.</div>` : ''}
    <div class="tj">
      <div class="tj-cab">
        <table class="tj-datos"><tr><th>NÚMERO DE EMPLEADO:</th><td>${esc(idReloj)}</td></tr>
          <tr><th>NOMBRE:</th><td>${esc(nombre)}</td></tr>
          <tr><th>PUESTO / TURNO:</th><td>${esc(emp.puesto || res.puesto || '')} · ${esc(dias[0]?.turno || emp.turnoS1 || '')}</td></tr>
          <tr><th>PERIODO:</th><td>${dias.length ? fechaBonita(dias[0].fecha) + ' al ' + fechaBonita(dias[dias.length - 1].fecha) : ''} · pago del ${fechaBonita(NOMINA.fechaPago)}</td></tr></table>
        <table class="tj-sueldo"><tr><th>SUELDO SEMANAL:</th><td>${dinero2(res.sueldoSemanal ?? emp.sueldoSemanal)}</td></tr>
          <tr><th>COSTO H. NORMAL:</th><td>${dinero2(emp.costoHoraNormal)}</td></tr>
          <tr><th>COSTO H. EXTRA:</th><td>${dinero2(res.costoHoraExtra ?? emp.costoHoraExtra)}</td></tr></table>
      </div>
      <div class="tabla-scroll"><table class="tj-tabla">
        <thead><tr><th></th><th>FECHA</th><th>HORA DE ENTRADA</th><th>SALIDA DESAYUNO</th><th>REGRESO DESAYUNO</th>
          <th>SALIDA A COMER</th><th>REGRESO DE COMER</th><th>SALIDA</th><th>HORAS TRABAJADAS</th>
          <th class="tj-th-fmt">FORMATO H.E.<br>INICIO – FIN</th><th>H.E. RELOJ</th><th>H.E. FORMATO</th><th>H.E. A PAGAR</th><th>OBSERVACIONES</th><th class="no-imprimir"></th></tr></thead>
        <tbody>${filas || `<tr><td colspan="15" style="padding:14px">${esc(nombre)} no cobra en el pago del ${fechaBonita(NOMINA.fechaPago)}${(NOMINA.noCobranHoy || []).some(x => String(x.idReloj) === String(idReloj)) ? ' (su grupo quincenal cobra la siguiente semana): cambia la fecha de pago para ver su quincena' : ''}.</td></tr>`}</tbody>
      </table></div>
      <div class="tj-pie">
        <table class="tj-tot">
          <tr><th>HORAS LABORADAS</th><td>${hhmmDeHoras(tot.trab) || '00:00'}</td></tr>
          <tr><th>HORAS A LABORAR</th><td>${hhmmDeHoras(tot.esp) || '00:00'}</td></tr>
          <tr><th class="tj-rojo">DIF.</th><td class="tj-rojo">${dif > 0 ? '-' + hhmmDeHoras(dif) : '+' + (hhmmDeHoras(-dif) || '00:00')}</td></tr>
        </table>
        <table class="tj-tot">
          <tr><th>H.E. SEGÚN RELOJ</th><td>${hhmmDeHoras(tot.heReloj) || '00:00'}</td></tr>
          <tr><th>H.E. SEGÚN FORMATOS</th><td>${hhmmDeHoras(tot.heForm) || '00:00'}</td></tr>
          <tr><th>HORAS QUE DEBE</th><td class="${tot.debe ? 'tj-rojo' : ''}">${hhmmDeHoras(tot.debe) || '00:00'}</td></tr>
          <tr class="tj-azul"><th>HORAS EXTRAS A PAGAR</th><td>${hhmmDeHoras(tot.hePag) || '00:00'}</td></tr>
        </table>
        <table class="tj-tot">
          <tr><th>RETARDOS</th><td>${tot.ret}</td></tr>
          <tr><th>FALTAS</th><td>${tot.faltas}</td></tr>
          <tr><th>FORMATOS DE H.E.</th><td>${new Set((fEmp?.he || []).map(t => t.folio)).size}</td></tr>
          <tr><th>PERMISOS</th><td>${(fEmp?.permisos || []).length}</td></tr>
        </table>
      </div>
      <p class="tj-nota">Horas en formato hh:mm. <b>Formato H.E. inicio – fin</b> = horario que el trabajador capturó en dinmec-app (🔎 abre el formato completo); debe cuadrar con la hora de salida del reloj.
        <b>H.E. formato</b> en rojo = difiere más de 15 min de lo que marca el reloj. Lo autorizado en «Formatos vs reloj» se refleja en <b>H.E. a pagar</b>.</p>
      <div class="firmas tj-firmas"><div>Trabajador</div><div>Recursos Humanos</div></div>
    </div>`;
}

// Ventana con el formato completo (FO-RHS-07 horas extra / FO-RHS-08 permiso) tal como lo capturó el trabajador
function verFormato(solicitudId, tipo, idReloj, FALL) {
  const fEmp = FALL?.empleados?.find(e => String(e.idReloj) === String(idReloj));
  if (!fEmp) return alert('No se encontró el formato.');
  const items = (tipo === 'ps' ? fEmp.permisos : fEmp.he).filter(x => String(x.solicitudId) === String(solicitudId))
    .sort((a, b) => (a.fecha + (a.horaInicio || a.horaSalida || '')).localeCompare(b.fecha + (b.horaInicio || b.horaSalida || '')));
  if (!items.length) return alert('No se encontró el formato.');
  const h = items[0];
  const fondo = document.createElement('div');
  fondo.style.cssText = 'position:fixed;inset:0;background:rgba(20,41,63,.6);z-index:160;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto';
  const LUGAR = { dinmec: 'Planta Dinmec', cliente: 'Planta del cliente', otro: 'Otro' };
  const cuerpo = tipo === 'ps' ? `
      <table class="tj-tabla"><thead><tr><th>Fecha</th><th>Salida</th><th>Regreso</th><th>Horas</th></tr></thead><tbody>
        ${items.map(b => `<tr><td>${fechaBonita(b.fecha)}</td><td>${esc(b.horaSalida || '')}</td><td>${b.fechaRegreso && b.fechaRegreso !== b.fecha ? fechaBonita(b.fechaRegreso) + ' ' : ''}${esc(b.horaRegreso || '')}</td><td>${b.horas != null ? horasYMin(b.horas) : ''}</td></tr>`).join('')}
      </tbody></table>
      <p style="margin-top:8px"><b>Pago:</b> ${h.pagaHoras ? 'Las horas se pagan' : 'Las horas se reponen'}${h.reposicion?.length ? ' — reposición: ' + h.reposicion.map(r => `${fechaBonita(r.del)}${r.al && r.al !== r.del ? ' al ' + fechaBonita(r.al) : ''} ${r.entrada || ''}–${r.salida || ''}`).join(', ') : ''}</p>
      ${h.motivo ? `<p><b>Motivo / comentarios:</b> ${esc(h.motivo)}</p>` : ''}` : `
      <p><b>Motivo:</b> ${esc(h.motivo || '—')} · <b>Lugar:</b> ${esc(LUGAR[h.lugar] || h.lugar || '—')}${h.lugarDetalle ? ' (' + esc(h.lugarDetalle) + ')' : ''} · <b>Pago:</b> ${esc(h.tipoPago || '—')}${h.asignada ? ' · <b>Asignada por el líder</b>' : ''}</p>
      <table class="tj-tabla" style="margin-top:8px"><thead><tr><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Comida</th><th>Horas</th><th>Actividad realizada</th><th>Avance</th></tr></thead><tbody>
        ${items.map(t => `<tr><td style="white-space:nowrap">${t.fecha === h.fecha && items.length > 1 ? '' : ''}${fechaBonita(t.fecha)}</td><td><b>${esc(t.horaInicio || '')}</b></td><td><b>${esc(t.horaFin || 'pendiente')}</b></td>
          <td>${t.comidaMin ? t.comidaMin + ' min' : '—'}</td><td><b>${t.horas != null ? horasYMin(t.horas) : ''}</b></td>
          <td style="white-space:normal;min-width:220px">${esc(t.descripcion || '')}</td><td>${t.concluido ? 'Concluida' : (t.avance != null ? t.avance + '%' : '')}</td></tr>`).join('')}
        <tr><td colspan="4" style="text-align:right"><b>Total</b></td><td><b>${horasYMin(items.reduce((a, t) => a + (t.horas || 0), 0))}</b></td><td colspan="2"></td></tr>
      </tbody></table>
      ${h.comentarios ? `<p style="margin-top:8px"><b>Comentarios del trabajador:</b> ${esc(h.comentarios)}</p>` : ''}`;
  fondo.innerHTML = `
    <div class="tarjeta" style="max-width:860px;width:100%;margin:0">
      <div style="display:flex;align-items:center;gap:12px;border-bottom:3px solid var(--naranja);padding-bottom:8px;margin-bottom:10px">
        <img src="logo.png" alt="" style="height:42px">
        <div style="flex:1"><h2 style="margin:0">${tipo === 'ps' ? 'FO-RHS-08 · Permiso de salida' : 'FO-RHS-07 · Solicitud de tiempo extra'}</h2>
          <div class="texto-chico">Folio <b>${esc(h.folio)}</b>${h.fechaSolicitud ? ' · solicitado el ' + fechaBonita(String(h.fechaSolicitud).slice(0, 10)) : ''}</div></div>
        <span class="etiqueta ${h.firme ? 'et-verde' : 'et-ambar'}">${esc(h.estatusTxt)}</span>
      </div>
      <p><b>Trabajador:</b> ${esc(fEmp.nombre)} · N° ${esc(fEmp.idReloj)}</p>
      ${cuerpo}
      <p class="texto-chico" style="margin-top:8px">VoBo líder: <b>${esc(h.liderNombre || '—')}</b> · Autorizó Dirección: <b>${esc(h.direccionNombre || '—')}</b></p>
      <div class="fila-controles" style="margin-top:12px"><button class="btn" id="vf-cerrar">Cerrar</button></div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(); });
  fondo.querySelector('#vf-cerrar').addEventListener('click', cerrar);
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

  // Formatos de dinmec-app (H.E., permisos, vacaciones) por "id_fecha"; si no responde, el detalle sigue sin ellos.
  let FDIA = {}, FERR = '', FALL = null;
  try {
    const F = await api(`/api/formatos?fecha=${NOMINA.fechaPago}`);
    FALL = F;
    if (!F.dinmecOk) FERR = F.dinmecError || 'sin conexión';
    for (const e of F.empleados) for (const x of e.filas) {
      FDIA[e.idReloj + '_' + x.fecha] = { ...x, tareas: e.he.filter(t => t.fecha === x.fecha) };
    }
  } catch (err) { FERR = err.message; }

  const hm = h => h ? horasYMin(h) : '';
  const descansoTxt = (sal, reg, min, nom) => sal ? `${nom} ${sal}${reg ? '→' + reg : ''}${min ? ` (${min}m)` : ''}` : '';

  function pintar() {
    const emp = filtro.querySelector('#det-emp').value;
    sessionStorage.setItem('det-emp', emp);
    const soloAlertas = filtro.querySelector('#det-alertas').checked;
    let dias = NOMINA.dias;
    if (emp) dias = dias.filter(d => d.idReloj == emp);
    else dias = dias.filter(d => d.numChecadas > 0 || d.falta || d.alertas.length || FDIA[d.idReloj + '_' + d.fecha]?.folios?.length);
    if (soloAlertas) dias = dias.filter(d => d.alertas.length || d.falta || d.horasDebe);

    if (emp && sessionStorage.getItem('det-vista') !== 'tabla') {
      tarjetaTabla.innerHTML = tarjetaEmpleadoHTML(emp, NOMINA.dias.filter(d => d.idReloj == emp), FDIA, FALL, FERR);
      tarjetaTabla.querySelector('#tj-tabla').addEventListener('click', () => { sessionStorage.setItem('det-vista', 'tabla'); pintar(); });
      tarjetaTabla.querySelector('#tj-imprimir').addEventListener('click', () => {
        $('#zona-impresion').innerHTML = `<div class="tj-print"><div class="recibo-cab"><img src="logo.png" alt="">
          <div><h2>${esc(PARAMETROS.empresa || 'DINMEC')} — Tarjeta de asistencia y horas extra</h2></div></div>${tarjetaTabla.querySelector('.tj').outerHTML}</div>`;
        window.print();
      });
      tarjetaTabla.querySelectorAll('[data-formato]').forEach(a => a.addEventListener('click', ev => {
        ev.preventDefault(); verFormato(a.dataset.formato, a.dataset.tipo, emp, FALL);
      }));
      tarjetaTabla.querySelectorAll('.btn-editar-dia').forEach(btn =>
        btn.addEventListener('click', () => editarDia(NOMINA.dias.find(d => d.idReloj == emp && d.fecha === btn.dataset.fecha))));
      return;
    }

    const COLS = 12;
    let filas = '';
    let tot = null;
    const cerrarTotales = () => {
      if (!tot || tot.n < 2) return '';
      const neto = +(tot.heAut - tot.debe).toFixed(2);
      return `<tr class="fila-total" style="background:#eef2f7;font-weight:600">
        <td colspan="2">Totales ${esc(tot.nombre)} · ${tot.faltas} falta(s) · ${tot.retardos} retardo(s)</td>
        <td></td><td class="num">${tot.trab.toFixed(2)}</td><td class="num">${tot.esp}</td>
        <td class="num" style="color:${tot.debe ? '#c0392b' : ''}">${tot.debe ? 'Debe ' + horasYMin(tot.debe) : ''}</td>
        <td class="num">${hm(tot.heReloj)}</td><td class="num">${hm(tot.heForm)}</td><td class="num">${hm(tot.heAut)}</td>
        <td colspan="${COLS - 9}" class="texto-chico" style="white-space:normal">${tot.debe ? `H.E. autorizadas − horas que debe = <b>${neto >= 0 ? horasYMin(neto) : '−' + horasYMin(-neto)}</b>
          (si se compensan con sus extras o con su banco de horas)` : ''}</td></tr>`;
    };
    dias.forEach((d, idx) => {
      if (!tot || tot.id !== d.idReloj) {
        filas += cerrarTotales();
        tot = { id: d.idReloj, nombre: d.nombre, n: 0, trab: 0, esp: 0, debe: 0, heReloj: 0, heForm: 0, heAut: 0, faltas: 0, retardos: 0 };
      }
      const f = FDIA[d.idReloj + '_' + d.fecha] || {};
      const heReloj = d.horasExtrasReloj ?? d.horasExtras;
      tot.n++; tot.trab += d.horasTrabajadas || 0; tot.esp += d.horasEsperadas || 0; tot.debe += d.horasDebe || 0;
      tot.heReloj += heReloj || 0; tot.heForm += f.horasFormato || 0; tot.heAut += d.horasExtras || 0;
      tot.faltas += d.falta ? 1 : 0; tot.retardos += d.esRetardo ? 1 : 0;

      const clase = d.falta ? 'fila-falta' : (!d.laboral ? 'fila-nolaboral' : '');
      const chec = (d.checadas || []);
      const descansos = [descansoTxt(d.salDesayuno, d.regDesayuno, d.minDesayuno, 'Des.'), descansoTxt(d.salComida, d.regComida, d.minComida, 'Com.')].filter(Boolean).join(' · ');

      // Qué hizo el día: trabajadas contra jornada
      let resumenDia = '';
      if (d.horasDebe) {
        resumenDia = `<span class="etiqueta et-rojo">Debe ${horasYMin(d.horasDebe)}</span>
          <div class="texto-chico">Le faltó tiempo dentro de su horario (retardo, descansos largos, permiso o salida antes)${(d.horasExtrasReloj ?? 0) > 0 ? ': se resta de sus H.E. de ese día' : ''}</div>`;
      } else if (d.laboral && d.horasTrabajadas && d.horasTrabajadas > d.horasEsperadas + 0.08) {
        resumenDia = `<span class="texto-chico">+${horasYMin(+(d.horasTrabajadas - d.horasEsperadas).toFixed(2))} sobre jornada</span>`;
      } else if (d.laboral && d.horasTrabajadas) resumenDia = '<span class="etiqueta et-verde">Completa</span>';

      // Formato del día: horario que capturó el operador
      const tareas = (f.tareas || []).map(t => `<div style="white-space:nowrap">${esc(t.horaInicio || '?')}→${esc(t.horaFin || '?')} <b>${t.horas != null ? horasYMin(t.horas) : ''}</b>
        <span class="texto-chico">${esc(t.folio)}${t.firme ? '' : ' · sin autorizar'}</span></div>`).join('');

      // Permisos, vacaciones y excepciones
      const marcas = [];
      if (f.vacaciones || d.excepcion === 'Vacaciones') marcas.push('<span class="etiqueta et-azul">🏖 Vacaciones</span>');
      (f.permisos || []).forEach(b => marcas.push(`<span class="etiqueta et-ambar">🚪 Permiso ${esc(b.horaSalida || '')}–${esc(b.horaRegreso || '')}</span>
        <div class="texto-chico">${esc(b.folio)} · ${b.pagaHoras ? 'se pagan' : 'las repone'}${b.reposicion?.length ? ': ' + b.reposicion.map(r => fechaBonita(r.del) + ' ' + (r.entrada || '') + '–' + (r.salida || '')).join(', ') : ''}</div>`));
      if (d.excepcion && d.excepcion !== 'Vacaciones') marcas.push(`<span class="etiqueta et-azul">${esc(d.excepcion)}</span>`);
      if (d.minPermisos) marcas.push(`<div class="texto-chico">Salió ${d.minPermisos} min (checadas)</div>`);
      if (f.decision) marcas.push(`<div class="texto-chico">${f.decision.usar === 'formato' ? '✔ H.E. autorizadas por formato' : '🔗 Emparejado con reloj'}${f.decision.nota ? ': ' + esc(f.decision.nota) : ''}</div>`);

      filas += `<tr class="${clase}">
        <td style="white-space:normal;min-width:120px;max-width:170px"><b>${d.idReloj}</b> ${esc(d.nombre)}</td>
        <td style="white-space:nowrap"><b>${d.dia}</b> ${fechaBonita(d.fecha)}
          <div class="texto-chico">${esc(d.turno)}${d.laboral ? '' : ' · No laboral'}${d.feriado ? ' · Feriado' : ''}</div></td>
        <td style="white-space:normal;min-width:170px;max-width:240px">${d.entrada || d.salida ? `<b style="white-space:nowrap">${d.entrada || '—'} → ${d.salida || '—'}</b>` : (d.falta ? '<span class="etiqueta et-rojo">FALTA</span>' : '—')}
          ${chec.length ? `<div class="texto-chico" title="Todas las checadas del reloj">${chec.length} chec.: ${chec.map(esc).join(' · ')}</div>` : ''}
          ${descansos ? `<div class="texto-chico">${descansos}</div>` : ''}
          ${d.esRetardo ? `<span class="etiqueta et-rojo">Retardo${d.retardoMin ? ' +' + d.retardoMin + ' min' : ''}</span>` : ''}</td>
        <td class="num">${d.horasTrabajadas ? d.horasTrabajadas.toFixed(2) : ''}</td>
        <td class="num">${d.horasEsperadas || ''}</td>
        <td style="white-space:normal;min-width:120px;max-width:170px">${resumenDia}</td>
        <td class="num">${hm(heReloj)}</td>
        <td>${tareas || '—'}${f.estado && ESTADO_CONC[f.estado]?.t && f.estado !== 'coincide' ? `<div><span class="etiqueta ${ESTADO_CONC[f.estado].c}">${ESTADO_CONC[f.estado].t}</span></div>` : ''}</td>
        <td class="num">${d.horasExtras ? '<b>' + horasYMin(d.horasExtras) + '</b>' : ''}</td>
        <td style="white-space:normal;max-width:200px">${marcas.join('') || ''}</td>
        <td><button class="btn btn-mini btn-editar-dia" data-i="${idx}" title="${d.editadoManual ? 'Editar o quitar la captura manual de este día' : 'Editar entrada/salida de este día a mano'}">${d.editadoManual ? '✏️✔' : '✏️'}</button></td>
        <td class="texto-chico" style="white-space:normal;min-width:180px;max-width:280px">${d.alertas.filter(a => !a.startsWith('FALTA')).map(esc).join(' · ')}</td>
      </tr>`;
    });
    filas += cerrarTotales();

    tarjetaTabla.innerHTML = `
      <h2>Detalle diario — pago del ${fechaBonita(NOMINA.fechaPago)}
        <span class="texto-chico">(quincenal: ${fechaBonita(NOMINA.quincenal.inicio)} al ${fechaBonita(NOMINA.quincenal.fin)} ·
        semanal: ${fechaBonita(NOMINA.semanal.inicio)} al ${fechaBonita(NOMINA.semanal.fin)})</span></h2>
      ${emp ? '<p><button class="btn btn-mini" id="tj-volver">🪪 Ver como tarjeta del trabajador</button></p>' : ''}
      ${FERR ? `<div class="aviso aviso-ambar">No se pudieron traer los formatos de dinmec-app (${esc(FERR)}): se muestra solo lo del reloj.</div>` : ''}
      <div class="tabla-scroll"><table>
        <thead><tr>
          <th>Trabajador</th><th>Día / turno</th><th>Checadas del reloj</th>
          <th>Hrs trab.</th><th>Jornada</th><th>Resultado del día</th>
          <th>H.E. reloj</th><th>H.E. formato (horario)</th><th>H.E. autorizada</th><th>Permiso / vacaciones</th><th>✏️</th><th>Alertas</th>
        </tr></thead><tbody>${filas || `<tr><td colspan="${COLS}">Sin datos en este periodo</td></tr>`}</tbody>
      </table></div>
      <p class="texto-chico" style="margin-top:8px"><b>H.E. reloj</b> = tiempo extra según checadas y turno · <b>H.E. formato</b> = horario que capturó el operador en dinmec-app ·
        <b>H.E. autorizada</b> = lo que entra a la nómina (incluye lo autorizado por formato en «Formatos vs reloj») · <b>Debe</b> = horas que le faltaron para completar su jornada.
        * junto a una hora = asumida (no hubo checada) · ✏ = horario editado a mano · ⁺¹ = checada de la madrugada siguiente · Fondo rojo = falta.</p>`;

    tarjetaTabla.querySelectorAll('.btn-editar-dia').forEach(btn =>
      btn.addEventListener('click', () => editarDia(dias[+btn.dataset.i])));
    const volver = tarjetaTabla.querySelector('#tj-volver');
    if (volver) volver.addEventListener('click', () => { sessionStorage.setItem('det-vista', 'tarjeta'); pintar(); });
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
