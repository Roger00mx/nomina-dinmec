// motor.js — Motor de cálculo de nómina DINMEC
// Reglas implementadas:
//  • Tolerancia de 5 min en la entrada; después cuenta retardo.
//  • Cada 3 retardos en la semana = 1 día de descuento.
//  • Sin checada de regreso de un descanso = duración estándar + 10 min de castigo.
//  • Sin checada de salida = se asume salida puntual a la hora del turno.
//  • 1ª checada muy tarde con día completo de checadas = olvido de entrada (retardo, entra a su hora).
//  • Desayuno 20 min y comida 30 min (configurable por empleado, hay casos 30/20).
//  • Horas extras = horas trabajadas − horas esperadas del turno (con umbral mínimo).
//  • Trabajo en día no laboral (sábado de CNC, feriado) = todas las horas son extra.
//  • La semana corre de viernes a jueves (configurable).

// ---------- utilidades de fecha/hora ----------

function aMin(hhmm) { // '07:00' -> 420
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minAHora(min) { // 425 -> '07:05'
  if (min == null) return '';
  min = Math.round(min);
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = ((min % 60) + 60) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function fechaAObj(iso) { // 'YYYY-MM-DD' -> Date (mediodía local, evita líos de zona horaria)
  return new Date(iso + 'T12:00:00');
}

function objAFecha(d) {
  return d.toISOString().slice(0, 10);
}

function sumarDias(iso, n) {
  const d = fechaAObj(iso);
  d.setDate(d.getDate() + n);
  return objAFecha(d);
}

function diaSemana(iso) { // 1=Lun ... 7=Dom
  const js = fechaAObj(iso).getDay(); // 0=Dom
  return js === 0 ? 7 : js;
}

const NOMBRES_DIA = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };

// Encuentra el inicio de la semana de nómina que contiene la fecha dada.
function inicioDeSemana(iso, diaInicio) {
  let f = iso;
  while (diaSemana(f) !== diaInicio) f = sumarDias(f, -1);
  return f;
}

// ---------- clasificación de checadas de un día ----------
// Recibe minutos ordenados y devuelve la interpretación del día.

function clasificarDia(minutos, turno, empleado, parametros, laboral) {
  const r = {
    entrada: null, salida: null,
    desayuno: null, comida: null,      // { sal, reg, usado, castigo }
    permisos: [],                       // [{ sal, reg, minutos }]
    numChecadas: minutos.length,
    alertas: [],
    entradaAsumida: false, salidaAsumida: false,
  };
  const entradaTurno = aMin(turno.horaEntrada);
  let salidaTurno = aMin(turno.horaSalida);
  if (turno.cruzaMedianoche) salidaTurno += 1440;

  const desayunoPermitido = empleado.desayunoMin ?? parametros.desayunoMin;
  const comidaPermitida = empleado.comidaMin ?? parametros.comidaMin;
  const castigo = parametros.castigoMin;

  if (minutos.length === 0) return r;

  // ¿Olvidó checar la entrada? (1ª checada muy tarde pero el día tiene más checadas)
  let ms = minutos.slice();
  if (laboral && ms.length >= 3 &&
      ms[0] >= entradaTurno + parametros.olvidoEntradaMin && ms[0] <= entradaTurno + 240) {
    r.entrada = entradaTurno; // entra "a su hora" pero...
    r.entradaAsumida = true;  // ...cuenta como retardo (regla de la empresa)
    r.alertas.push('No checó entrada: se asume hora de turno y cuenta retardo');
  } else {
    r.entrada = ms.shift();
    if (laboral && r.entrada > entradaTurno + 240) {
      r.alertas.push('Entrada muy tarde para su turno: revisar si trabajó otro turno ese día');
    }
  }

  // ¿La última checada es la salida, o no checó salida?
  // En días no laborales no se asume nada: la última checada es la salida.
  if (!laboral) {
    if (ms.length > 0) r.salida = ms.pop();
    else { r.salida = r.entrada; r.alertas.push('Una sola checada en día no laboral: no se cuentan horas'); }
  } else if (ms.length > 0 && ms[ms.length - 1] >= salidaTurno - 90) {
    r.salida = ms.pop();
  } else {
    r.salida = salidaTurno; // salida puntual asumida
    r.salidaAsumida = true;
    r.alertas.push('No checó salida: se asume salida puntual del turno');
  }

  // Lo que queda en medio son descansos (pares salida/regreso) o permisos.
  const pares = [];
  let suelta = null;
  for (let i = 0; i + 1 < ms.length; i += 2) pares.push({ sal: ms[i], reg: ms[i + 1] });
  if (ms.length % 2 === 1) suelta = ms[ms.length - 1];

  const descansos = [];
  for (const p of pares) {
    const dur = p.reg - p.sal;
    if (dur > 60) {
      r.permisos.push({ sal: p.sal, reg: p.reg, minutos: dur });
      r.alertas.push(`Permiso/ausencia de ${Math.round(dur)} min (${minAHora(p.sal)}–${minAHora(p.reg)})`);
    } else {
      descansos.push({ sal: p.sal, reg: p.reg, usado: dur, castigo: false });
    }
  }
  if (suelta != null) {
    // Checada de descanso sin regreso: duración estándar + castigo.
    descansos.push({ sal: suelta, reg: null, usado: null, castigo: true });
    r.alertas.push(`Descanso sin checada de regreso: se aplican ${castigo} min de castigo`);
  }

  // Asignar desayuno y comida. Si solo hay un descanso, se decide por la mitad
  // del turno: antes de la mitad es desayuno, después es comida.
  descansos.sort((a, b) => a.sal - b.sal);
  if (descansos.length === 1) {
    const mitadTurno = (entradaTurno + salidaTurno) / 2;
    if (descansos[0].sal >= mitadTurno) r.comida = descansos[0];
    else r.desayuno = descansos[0];
  } else {
    if (descansos.length > 0) r.desayuno = descansos[0];
    if (descansos.length > 1) r.comida = descansos[1];
  }
  for (let i = 2; i < descansos.length; i++) {
    const d = descansos[i];
    const dur = d.usado ?? 0;
    r.permisos.push({ sal: d.sal, reg: d.reg, minutos: dur });
    r.alertas.push('Más descansos de los esperados: revisar');
  }

  // Completar duraciones con castigo y detectar excesos.
  if (r.desayuno) {
    if (r.desayuno.castigo) r.desayuno.usado = desayunoPermitido + castigo;
    if (r.desayuno.usado > desayunoPermitido) {
      r.alertas.push(`Desayuno de ${Math.round(r.desayuno.usado)} min (permitido ${desayunoPermitido})`);
    }
  }
  if (r.comida) {
    if (r.comida.castigo) r.comida.usado = comidaPermitida + castigo;
    if (r.comida.usado > comidaPermitida) {
      r.alertas.push(`Comida de ${Math.round(r.comida.usado)} min (permitido ${comidaPermitida})`);
    }
  }
  if (minutos.length === 2) r.alertas.push('Solo entrada y salida (sin checadas de descansos)');
  if (minutos.length === 1) r.alertas.push('Una sola checada en el día: revisar');

  return r;
}

// ---------- cálculo de un día ----------

function calcularDia(fecha, empleado, turno, minutos, excepcion, parametros, esFeriado) {
  const ds = diaSemana(fecha);
  const laboralTurno = turno.dias.includes(ds) && !esFeriado;
  const desayunoPermitido = empleado.desayunoMin ?? parametros.desayunoMin;
  const comidaPermitida = empleado.comidaMin ?? parametros.comidaMin;

  const dia = {
    fecha, dia: NOMBRES_DIA[ds], idReloj: empleado.idReloj, nombre: empleado.nombre,
    turno: turno.codigo, laboral: laboralTurno, feriado: !!esFeriado,
    entrada: null, salida: null, salDesayuno: null, regDesayuno: null,
    salComida: null, regComida: null, numChecadas: minutos.length,
    retardoMin: 0, esRetardo: false, falta: false,
    minDesayuno: 0, minComida: 0, minPermisos: 0, minCastigo: 0,
    horasTrabajadas: 0, horasEsperadas: laboralTurno ? turno.horasDia : 0,
    horasExtras: 0, alertas: [], excepcion: excepcion ? excepcion.tipo : '',
  };

  if (esFeriado) dia.alertas.push('Feriado');

  // Excepciones que anulan el día (permiso, incapacidad, vacaciones): no hay falta ni retardo.
  const tiposLibres = ['Permiso', 'Incapacidad', 'Vacaciones'];
  const diaLibre = excepcion && tiposLibres.includes(excepcion.tipo);

  if (minutos.length === 0) {
    if (laboralTurno && !diaLibre) {
      dia.falta = true;
      dia.alertas.push('FALTA: sin checadas en día laboral');
    }
    return dia;
  }

  const c = clasificarDia(minutos, turno, empleado, parametros, laboralTurno && !diaLibre);
  dia.alertas.push(...c.alertas);
  dia.entrada = minAHora(c.entrada);
  dia.salida = minAHora(c.salida % 1440);
  if (c.entradaAsumida) dia.entrada += '*';
  if (c.salidaAsumida) dia.salida += '*';
  if (c.desayuno) { dia.salDesayuno = minAHora(c.desayuno.sal); dia.regDesayuno = c.desayuno.reg != null ? minAHora(c.desayuno.reg) : '—'; dia.minDesayuno = Math.round(c.desayuno.usado); }
  if (c.comida)   { dia.salComida = minAHora(c.comida.sal);     dia.regComida = c.comida.reg != null ? minAHora(c.comida.reg) : '—';     dia.minComida = Math.round(c.comida.usado); }
  dia.minPermisos = Math.round(c.permisos.reduce((s, p) => s + p.minutos, 0));

  // Retardo (solo en día laboral del turno)
  const entradaTurno = aMin(turno.horaEntrada);
  if (laboralTurno && !diaLibre && excepcion?.tipo !== 'Retardo justificado') {
    const tolerancia = parametros.toleranciaMin;
    if (c.entradaAsumida) {
      dia.esRetardo = true;
      dia.retardoMin = 0;
    } else if (c.entrada > entradaTurno + tolerancia) {
      dia.esRetardo = true;
      dia.retardoMin = Math.round(c.entrada - entradaTurno);
    }
  }

  // Horas trabajadas: salida − entrada, menos permisos y menos exceso de descansos.
  let salida = c.salida;
  let entrada = c.entrada;
  if (turno.cruzaMedianoche && salida < entrada) salida += 1440;
  const excesoDesayuno = Math.max(0, (dia.minDesayuno || 0) - desayunoPermitido);
  const excesoComida = Math.max(0, (dia.minComida || 0) - comidaPermitida);
  dia.minCastigo = excesoDesayuno + excesoComida;
  let minTrabajados = (salida - entrada) - dia.minPermisos - excesoDesayuno - excesoComida;
  if (minTrabajados < 0) minTrabajados = 0;
  dia.horasTrabajadas = +(minTrabajados / 60).toFixed(2);

  // Horas extras
  if (!laboralTurno) {
    // Día no laboral trabajado (sábado extra, feriado): todo cuenta como extra.
    dia.horasExtras = dia.horasTrabajadas;
    if (dia.horasTrabajadas > 0) dia.alertas.push('Día no laboral trabajado: horas cuentan como extra');
  } else {
    const extra = dia.horasTrabajadas - dia.horasEsperadas;
    dia.horasExtras = extra >= parametros.umbralHorasExtra ? +extra.toFixed(2) : 0;
    if (extra < -0.5 && !c.salidaAsumida && !diaLibre) {
      dia.alertas.push(`Salió ${Math.abs(extra).toFixed(1)} h antes de completar su turno`);
    }
  }
  dia.horasExtras = +dia.horasExtras.toFixed(2);

  return dia;
}

// ---------- cálculo del periodo completo ----------

function calcularPeriodo(opciones) {
  const { fechaInicio, numSemanas, empleados, turnos, checadas, excepciones, parametros, prestamos, banco, decisiones } = opciones;
  // Clave con la que se buscan las decisiones del periodo (destino de horas extra, etc.).
  // Cuando se calcula por fecha de pago, la clave es la fecha de pago y no la de inicio.
  const claveDecisiones = opciones.claveDecisiones || fechaInicio;

  const turnosPorCodigo = {};
  for (const t of turnos) turnosPorCodigo[t.codigo] = t;

  const feriados = new Set((parametros.feriados || []).map(f => f.fecha));
  const fechaFin = sumarDias(fechaInicio, numSemanas * 7 - 1);

  // Índice de excepciones: "id_fecha" -> excepción
  const excPorClave = {};
  for (const e of excepciones) excPorClave[e.idReloj + '_' + e.fecha] = e;

  // Índice de turnos asignados por semana: "id_viernesInicio" -> código de turno
  // (para horarios especiales temporales, ej. "esta semana trabajan de 7pm a 7am")
  const asigPorClave = {};
  for (const a of (opciones.asignaciones || [])) asigPorClave[a.idReloj + '_' + a.inicio] = a.turno;

  // Índice de días de viaje (choferes que no pueden checar): "id_fecha" -> registro
  const viajePorDia = {};
  for (const v of (opciones.viajes || [])) {
    if (!v.desde) continue;
    let f = v.desde;
    const hasta = v.hasta || v.desde;
    for (let i = 0; i < 60 && f <= hasta; i++) { // tope de 60 días por registro
      viajePorDia[v.idReloj + '_' + f] = v;
      f = sumarDias(f, 1);
    }
  }

  // Agrupar checadas por empleado y fecha (en minutos desde medianoche).
  // Para turnos nocturnos, las checadas de madrugada pertenecen al día anterior.
  const porEmpleado = {};
  for (const ch of checadas) {
    if (ch.fecha < sumarDias(fechaInicio, -1) || ch.fecha > sumarDias(fechaFin, 1)) continue;
    (porEmpleado[ch.idReloj] = porEmpleado[ch.idReloj] || []).push(ch);
  }

  const dias = [];
  const resumen = [];

  for (const empleado of empleados) {
    if (!empleado.activo) continue;
    const lista = (porEmpleado[empleado.idReloj] || []).slice()
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

    // Puesto CNC: sus rotaciones de turno inician en LUNES (no en viernes como la
    // nómina), así que el turno se detecta automáticamente por bloque de lunes a
    // domingo. Una semana de pago puede quedar mixta: viernes con un turno y de
    // lunes en adelante con otro.
    const esCNC = String(empleado.puesto || '').toUpperCase().includes('CNC');
    const turnoPorBloque = {};
    if (esCNC && lista.length) {
      const bloques = new Set();
      for (let d = 0; d < numSemanas * 7; d++) {
        bloques.add(inicioDeSemana(sumarDias(fechaInicio, d), 1)); // 1 = lunes
      }
      for (const lunes of bloques) {
        let mejor = null;
        for (const t of turnos) {
          const a = ajusteSemana(lista, lunes, t);
          if (a && (!mejor || a.score < mejor.score)) mejor = { ...a, turno: t };
        }
        if (mejor && mejor.score < 240) turnoPorBloque[lunes] = mejor.turno;
      }
    }

    const semanasEmp = [];

    for (let s = 0; s < numSemanas; s++) {
      const iniSem = sumarDias(fechaInicio, s * 7);
      // Turno de la semana: 1° la asignación especial de esa semana (horario temporal),
      // luego S2 en la segunda semana de quincena, y si no, el turno base S1.
      const asignacionExplicita = asigPorClave[empleado.idReloj + '_' + iniSem];
      const codigoTurnoSemana = asignacionExplicita
        || ((s === 1 && empleado.turnoS2) ? empleado.turnoS2 : empleado.turnoS1);
      const turnoSemana = turnosPorCodigo[codigoTurnoSemana] || turnosPorCodigo[empleado.turnoS1];

      const sem = { inicio: iniSem, fin: sumarDias(iniSem, 6), retardos: 0, faltas: 0, horasExtras: 0, heDomingo: 0, horasTrabajadas: 0, diasTrabajados: 0 };

      for (let d = 0; d < 7; d++) {
        const fecha = sumarDias(iniSem, d);
        const exc = excPorClave[empleado.idReloj + '_' + fecha];
        let turnoDia = turnoSemana;
        let turnoDetectado = false;
        // CNC sin asignación manual: usar el turno detectado del bloque lunes-domingo.
        if (esCNC && !asignacionExplicita) {
          const tb = turnoPorBloque[inicioDeSemana(fecha, 1)];
          if (tb) { turnoDia = tb; turnoDetectado = tb.codigo !== turnoSemana.codigo; }
        }
        if (exc && exc.tipo === 'Cambio turno' && exc.turnoAlternativo && turnosPorCodigo[exc.turnoAlternativo]) {
          turnoDia = turnosPorCodigo[exc.turnoAlternativo];
          turnoDetectado = false;
        }
        if (!turnoDia) continue;

        // Checadas del día (con ventana ampliada para turno nocturno)
        let minutosDia = [];
        if (turnoDia.cruzaMedianoche) {
          // La hora de salida (ej. 07:00) es del día siguiente; se aceptan checadas hasta 4 h después.
          const finVentana = aMin(turnoDia.horaSalida) + 240;
          for (const ch of lista) {
            const m = aMin(ch.hora.slice(0, 5));
            if (ch.fecha === fecha && m >= aMin(turnoDia.horaEntrada) - 120) minutosDia.push(m);
            else if (ch.fecha === sumarDias(fecha, 1) && m <= finVentana) minutosDia.push(m + 1440);
          }
        } else {
          // Checadas de madrugada (antes de las 5:00) pertenecen al día anterior:
          // son salidas tardías de quien trabajó horas extra pasada la medianoche.
          for (const ch of lista) {
            const m = aMin(ch.hora.slice(0, 5));
            if (ch.fecha === fecha && m >= 300) minutosDia.push(m);
            else if (ch.fecha === sumarDias(fecha, 1) && m < 300) minutosDia.push(m + 1440);
          }
        }
        minutosDia.sort((a, b) => a - b);
        // Quitar checadas dobles (menos de 2 minutos entre una y otra)
        minutosDia = minutosDia.filter((m, i) => i === 0 || m - minutosDia[i - 1] >= 2);

        const dia = calcularDia(fecha, empleado, turnoDia, minutosDia, exc, parametros, feriados.has(fecha));
        dia.semana = s + 1;
        if (turnoDetectado && (minutosDia.length > 0 || dia.laboral)) {
          dia.alertas.unshift('🔄 Rotación CNC detectada: ' + turnoDia.codigo);
        }

        // Día de viaje (captura manual): manda sobre las checadas del reloj.
        // En día laboral se paga la jornada normal completa + las horas extra
        // capturadas; en día no laboral (sábado/domingo) todo es extra.
        const viaje = viajePorDia[empleado.idReloj + '_' + fecha];
        if (viaje) {
          const extraDia = +(viaje.horasExtraDia || 0);
          dia.falta = false;
          dia.esRetardo = false;
          dia.retardoMin = 0;
          dia.horasExtras = extraDia;
          dia.horasTrabajadas = +((dia.laboral ? dia.horasEsperadas : 0) + extraDia).toFixed(2);
          dia.entrada = null; dia.salida = null;
          dia.salDesayuno = null; dia.regDesayuno = null; dia.salComida = null; dia.regComida = null;
          dia.minDesayuno = 0; dia.minComida = 0; dia.minPermisos = 0; dia.minCastigo = 0;
          dia.alertas = ['🚚 Viaje: horas capturadas manualmente' + (viaje.nota ? ' — ' + viaje.nota : '')];
          if (minutosDia.length > 0) dia.alertas.push('Tenía checadas ese día: se ignoraron por la captura de viaje');
        }

        dias.push(dia);

        if (dia.esRetardo) sem.retardos++;
        if (dia.falta) sem.faltas++;
        sem.horasExtras += dia.horasExtras;
        if (diaSemana(fecha) === 7) sem.heDomingo += dia.horasExtras; // domingo se paga doble
        sem.horasTrabajadas += dia.horasTrabajadas;
        if (dia.horasTrabajadas > 0) sem.diasTrabajados++;
      }

      sem.horasExtras = +sem.horasExtras.toFixed(2);
      sem.heDomingo = +sem.heDomingo.toFixed(2);
      sem.horasTrabajadas = +sem.horasTrabajadas.toFixed(2);
      sem.diasDescuentoRetardos = Math.floor(sem.retardos / parametros.retardosPorFalta);
      semanasEmp.push(sem);
    }

    // ----- resumen de nómina del empleado -----
    const turnoBase = turnosPorCodigo[empleado.turnoS1];
    const diasSemana = turnoBase ? turnoBase.dias.length : 5;
    const costoDia = diasSemana > 0 ? empleado.sueldoSemanal / diasSemana : 0;

    let sueldoBase = 0, descuentos = 0, totRetardos = 0, totFaltas = 0, totHE = 0, totHEDom = 0, totHrs = 0, diasDescontados = 0;
    for (const sem of semanasEmp) {
      const diasDesc = sem.faltas + sem.diasDescuentoRetardos;
      sueldoBase += empleado.sueldoSemanal;
      // El descuento de una semana nunca puede ser mayor que el sueldo de esa semana.
      descuentos += Math.min(diasDesc * costoDia, empleado.sueldoSemanal);
      diasDescontados += diasDesc;
      totRetardos += sem.retardos;
      totFaltas += sem.faltas;
      totHE += sem.horasExtras;
      totHEDom += sem.heDomingo;
      totHrs += sem.horasTrabajadas;
    }

    // Costo de la hora extra según el puesto: CNC al doble, los demás a tiempo y medio.
    // El DOMINGO se paga doble para todos (si el factor del puesto es mayor, se respeta).
    const factorHE = esCNC ? (parametros.factorHoraExtraCNC ?? 2) : (parametros.factorHoraExtra ?? 1.5);
    const costoHoraExtra = +((empleado.costoHoraNormal || 0) * factorHE).toFixed(2);
    const factorDomingo = Math.max(parametros.factorHoraExtraDomingo ?? 2, factorHE);
    const costoHoraExtraDomingo = +((empleado.costoHoraNormal || 0) * factorDomingo).toFixed(2);
    const heEntreSemana = +(totHE - totHEDom).toFixed(2);

    // Decisiones del periodo (destino de horas extra, horas de banco aplicadas a faltas)
    const clave = claveDecisiones + '_' + empleado.idReloj;
    const dec = (decisiones && decisiones[clave]) || {};
    const destinoHE = dec.destinoHE || 'pagar'; // 'pagar' | 'banco'
    const saldoBanco = (banco && banco[empleado.idReloj]) || 0;
    const horasCubren = Math.min(dec.horasCubrenFaltas || 0, saldoBanco);
    const recuperadoPorBanco = horasCubren * (empleado.costoHoraNormal || 0);

    const pagoHE = destinoHE === 'pagar'
      ? heEntreSemana * costoHoraExtra + totHEDom * costoHoraExtraDomingo
      : 0;
    const heABanco = destinoHE === 'banco' ? totHE : 0;

    // Préstamos activos del empleado
    const prestamosEmp = (prestamos || []).filter(p => p.idReloj === empleado.idReloj && p.activo && p.saldo > 0);
    const abonoPrestamo = prestamosEmp.reduce((s, p) => s + Math.min(p.abono, p.saldo), 0);

    const totalSueldo = sueldoBase;
    const neto = +(sueldoBase - descuentos + recuperadoPorBanco + pagoHE - abonoPrestamo).toFixed(2);
    const montoDispersion = empleado.dispersion ? Math.min(parametros.montoDispersion, Math.max(neto, 0)) : 0;

    resumen.push({
      idReloj: empleado.idReloj, nombre: empleado.nombre,
      periodoInicio: fechaInicio, periodoFin: fechaFin, numSemanas,
      grupoPago: empleado.grupoPago || 'A', puesto: empleado.puesto || '',
      sueldoSemanal: empleado.sueldoSemanal, costoDia: +costoDia.toFixed(2),
      costoHoraExtra, factorHE,
      semanas: semanasEmp,
      retardos: totRetardos, faltas: totFaltas, diasDescontados,
      horasTrabajadas: +totHrs.toFixed(2), horasExtras: +totHE.toFixed(2),
      heEntreSemana, heDomingo: +totHEDom.toFixed(2),
      costoHoraExtraDomingo, factorDomingo,
      destinoHE, pagoHE: +pagoHE.toFixed(2), heABanco: +heABanco.toFixed(2),
      saldoBanco: +saldoBanco.toFixed(2), horasCubrenFaltas: horasCubren,
      recuperadoPorBanco: +recuperadoPorBanco.toFixed(2),
      descuentos: +descuentos.toFixed(2),
      abonoPrestamo: +abonoPrestamo.toFixed(2),
      saldoPrestamo: +prestamosEmp.reduce((s, p) => s + p.saldo, 0).toFixed(2),
      totalSueldo: +totalSueldo.toFixed(2), neto,
      dispersion: empleado.dispersion, banco: empleado.banco,
      montoDispersion: +montoDispersion.toFixed(2),
      efectivo: +(neto - montoDispersion).toFixed(2),
    });
  }

  return { fechaInicio, fechaFin, numSemanas, dias, resumen };
}

// ---------- detector de turnos ----------
// Compara las checadas reales de cada empleado en cada semana contra todos los
// turnos del catálogo. Si el turno que tiene asignado no cuadra con sus horarios
// reales, sugiere el turno que mejor encaja (ej.: detecta a quien trabajó de
// 7pm a 7am aunque tenga asignado un turno de día).

// Agrupa las checadas de un día según las reglas de un turno y devuelve
// primera/última en minutos continuos (la salida puede pasar de 1440).
function checadasDelDia(lista, fecha, turno) {
  const ms = [];
  if (turno.cruzaMedianoche) {
    const finVentana = aMin(turno.horaSalida) + 240;
    for (const ch of lista) {
      const m = aMin(ch.hora.slice(0, 5));
      if (ch.fecha === fecha && m >= aMin(turno.horaEntrada) - 120) ms.push(m);
      else if (ch.fecha === sumarDias(fecha, 1) && m <= finVentana) ms.push(m + 1440);
    }
  } else {
    for (const ch of lista) {
      const m = aMin(ch.hora.slice(0, 5));
      if (ch.fecha === fecha && m >= 300) ms.push(m);
      else if (ch.fecha === sumarDias(fecha, 1) && m < 300) ms.push(m + 1440);
    }
  }
  return ms.sort((a, b) => a - b);
}

// Qué tan bien encajan las checadas de una semana con un turno.
// La ENTRADA pesa mucho (la gente llega puntual a su turno); salir MÁS TARDE
// casi no penaliza (son horas extra normales), salir ANTES sí. Los días donde
// la interpretación deja checadas sueltas (1 sola checada, o jornada de menos
// de 4 h) también penalizan: la interpretación correcta deja días "limpios".
function ajusteSemana(lista, iniSem, turno) {
  const entradaT = aMin(turno.horaEntrada);
  const salidaT = turno.cruzaMedianoche ? aMin(turno.horaSalida) + 1440 : aMin(turno.horaSalida);
  const difs = [];
  let diasRaros = 0;
  for (let d = 0; d < 7; d++) {
    const fecha = sumarDias(iniSem, d);
    if (!turno.dias.includes(diaSemana(fecha))) continue;
    const ms = checadasDelDia(lista, fecha, turno);
    if (!ms.length) continue;
    if (ms.length < 2 || ms[ms.length - 1] - ms[0] < 240) { diasRaros++; continue; }
    const difEntrada = Math.min(Math.abs(ms[0] - entradaT), 480);
    const salioAntes = Math.min(Math.max(0, salidaT - ms[ms.length - 1]), 480);
    const salioDespues = Math.min(Math.max(0, ms[ms.length - 1] - salidaT), 600);
    difs.push(difEntrada + salioAntes + 0.1 * salioDespues);
  }
  if (difs.length < 2) return null; // se necesitan al menos 2 días limpios para opinar
  const score = (difs.reduce((a, b) => a + b, 0) + diasRaros * 120) / difs.length;
  return { score, dias: difs.length };
}

function detectarTurnos(opciones) {
  const { empleados, turnos, checadas, asignaciones, fechaInicio, numSemanas } = opciones;
  const turnosPorCodigo = {};
  for (const t of turnos) turnosPorCodigo[t.codigo] = t;
  const asigPorClave = {};
  for (const a of (asignaciones || [])) asigPorClave[a.idReloj + '_' + a.inicio] = a.turno;

  const fechaFin = sumarDias(fechaInicio, numSemanas * 7 - 1);
  const porEmpleado = {};
  for (const ch of checadas) {
    if (ch.fecha < sumarDias(fechaInicio, -1) || ch.fecha > sumarDias(fechaFin, 1)) continue;
    (porEmpleado[ch.idReloj] = porEmpleado[ch.idReloj] || []).push(ch);
  }

  const sugerencias = [];
  for (const emp of empleados) {
    if (!emp.activo) continue;
    // Los CNC rotan solos: su turno se detecta automáticamente por bloque, no se sugiere.
    if (String(emp.puesto || '').toUpperCase().includes('CNC')) continue;
    const lista = (porEmpleado[emp.idReloj] || []).slice()
      .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    if (!lista.length) continue;

    for (let s = 0; s < numSemanas; s++) {
      const iniSem = sumarDias(fechaInicio, s * 7);
      const codigoActual = asigPorClave[emp.idReloj + '_' + iniSem]
        || ((s === 1 && emp.turnoS2) ? emp.turnoS2 : emp.turnoS1);
      const turnoActual = turnosPorCodigo[codigoActual];
      if (!turnoActual) continue;

      const actual = ajusteSemana(lista, iniSem, turnoActual);
      if (!actual || actual.score <= 150) continue; // el turno asignado cuadra razonablemente

      let mejor = null;
      for (const t of turnos) {
        if (t.codigo === codigoActual) continue;
        const a = ajusteSemana(lista, iniSem, t);
        if (a && (!mejor || a.score < mejor.score)) mejor = { ...a, turno: t };
      }
      if (mejor && mejor.score < 90 && mejor.score + 60 < actual.score) {
        sugerencias.push({
          idReloj: emp.idReloj, nombre: emp.nombre, semanaInicio: iniSem,
          turnoActual: codigoActual, turnoSugerido: mejor.turno.codigo,
          descripcionSugerido: mejor.turno.descripcion || mejor.turno.codigo,
          dias: mejor.dias,
        });
      }
    }
  }
  return sugerencias;
}

module.exports = { calcularPeriodo, detectarTurnos, inicioDeSemana, sumarDias, diaSemana, aMin, minAHora };
