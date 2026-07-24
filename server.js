// server.js — Nómina DINMEC (Node.js sin dependencias)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const motor = require('./motor');

const PUERTO = process.env.PORT || 3300;
const PUBLICO = path.join(__dirname, 'public');

store.inicializar();

// ---------- sesiones simples (persistentes en disco) ----------
// Se guardan en data/sesiones.json para que los usuarios no tengan que volver a
// entrar cada vez que el servidor se reinicia (modo 24/7).
let sesiones = new Set(store.leer('sesiones', []));

function guardarSesiones() {
  store.guardar('sesiones', [...sesiones].slice(-300)); // máximo 300 sesiones vivas
}

// Protección contra intentos de adivinar la contraseña:
// después de 5 intentos fallidos, esa dirección queda bloqueada 5 minutos.
const intentosFallidos = {}; // ip -> { fallos, bloqueadoHasta }

function ipDe(req) {
  return req.headers['cf-connecting-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'desconocida';
}

function tieneAcceso(req) {
  const parametros = store.leer('parametros', {});
  if (!parametros.password) return true;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/sesion=([a-f0-9]+)/);
  if (!m) return false;
  // Si no la conocemos, releer del disco (pudo crearla otra instancia o un reinicio previo)
  if (!sesiones.has(m[1])) sesiones = new Set(store.leer('sesiones', []));
  return sesiones.has(m[1]);
}

// ---------- utilidades HTTP ----------
function json(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', c => { datos += c; if (datos.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try { resolve(datos ? JSON.parse(datos) : {}); }
      catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

// ---------- importación del archivo del reloj (.dat) ----------
// Formato ATTLOG: idEmpleado <TAB> YYYY-MM-DD HH:MM:SS <TAB> ...
function importarAttlog(texto) {
  const checadas = store.leer('checadas', []);
  const empleados = store.leer('empleados', []);
  const idsConocidos = new Set(empleados.map(e => String(e.idReloj)));
  const existentes = new Set(checadas.map(c => c.idReloj + '|' + c.fecha + ' ' + c.hora));

  let nuevas = 0, duplicadas = 0, invalidas = 0;
  const desconocidos = new Set();
  let fechaMin = null, fechaMax = null;

  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const partes = linea.split(/\t+/).map(p => p.trim()).filter(p => p !== '');
    if (partes.length < 2) { invalidas++; continue; }
    const id = parseInt(partes[0], 10);
    const m = partes[1].match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
    if (isNaN(id) || !m) { invalidas++; continue; }
    const fecha = m[1];
    const hora = m[2].length === 5 ? m[2] + ':00' : m[2];
    const clave = id + '|' + fecha + ' ' + hora;
    if (existentes.has(clave)) { duplicadas++; continue; }
    existentes.add(clave);
    checadas.push({ idReloj: id, fecha, hora });
    nuevas++;
    if (!idsConocidos.has(String(id))) desconocidos.add(id);
    if (!fechaMin || fecha < fechaMin) fechaMin = fecha;
    if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
  }

  checadas.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  store.guardar('checadas', checadas);
  return { nuevas, duplicadas, invalidas, desconocidos: [...desconocidos].sort((a, b) => a - b), fechaMin, fechaMax, total: checadas.length };
}

// ---------- cálculo de nómina ----------
function datosBase() {
  return {
    turnos: store.leer('turnos', []),
    checadas: store.leer('checadas', []),
    excepciones: store.leer('excepciones', []),
    asignaciones: store.leer('asignaciones', []),
    viajes: store.leer('viajes', []),
    capturas: store.leer('capturas', []),
    prestamos: store.leer('prestamos', []),
    banco: store.leer('banco', {}),
    decisiones: store.leer('decisiones', {}),
    parametros: store.leer('parametros', {}),
  };
}

function calcularNomina(fechaInicio, numSemanas) {
  const base = datosBase();
  const inicio = motor.inicioDeSemana(fechaInicio, base.parametros.diaInicioSemana || 5);
  return motor.calcularPeriodo({
    ...base,
    fechaInicio: inicio,
    numSemanas: numSemanas === 2 ? 2 : 1,
    empleados: store.leer('empleados', []),
  });
}

// Cálculo por FECHA DE PAGO: ese viernes cobran los del grupo SEMANAL (1 semana)
// más el grupo quincenal (A o B) al que le toque, alternando cada semana.
function calcularPago(fecha) {
  const base = datosBase();
  const diaInicio = base.parametros.diaInicioSemana || 5;
  const fechaPago = motor.inicioDeSemana(fecha, diaInicio);
  const empleados = store.leer('empleados', []).filter(e => e.activo);

  // ¿A qué grupo quincenal le toca? Se alterna semana a semana desde la fecha ancla del grupo A.
  const ancla = motor.inicioDeSemana(base.parametros.anclaGrupoA || fechaPago, diaInicio);
  const dias = Math.round((new Date(fechaPago + 'T12:00:00') - new Date(ancla + 'T12:00:00')) / 86400000);
  const semanasDesdeAncla = Math.round(dias / 7);
  const grupoQuincenal = ((semanasDesdeAncla % 2) + 2) % 2 === 0 ? 'A' : 'B';

  const grupoDe = e => e.grupoPago || 'A';
  const semanales = empleados.filter(e => grupoDe(e) === 'SEMANAL');
  const quincenales = empleados.filter(e => grupoDe(e) === grupoQuincenal);

  const resSemanal = motor.calcularPeriodo({
    ...base, empleados: semanales, claveDecisiones: fechaPago,
    fechaInicio: motor.sumarDias(fechaPago, -7), numSemanas: 1,
  });
  const resQuincenal = motor.calcularPeriodo({
    ...base, empleados: quincenales, claveDecisiones: fechaPago,
    fechaInicio: motor.sumarDias(fechaPago, -14), numSemanas: 2,
  });

  // Detector de turnos: revisa las 2 últimas semanas de TODOS los empleados activos
  // y sugiere el turno que mejor encaja cuando las checadas no cuadran con el asignado.
  const sugerencias = motor.detectarTurnos({
    empleados, turnos: base.turnos, checadas: base.checadas, asignaciones: base.asignaciones,
    fechaInicio: motor.sumarDias(fechaPago, -14), numSemanas: 2,
  });

  return {
    fechaPago,
    grupoQuincenal,
    sugerencias,
    semanal: { inicio: resSemanal.fechaInicio, fin: resSemanal.fechaFin, empleados: semanales.length },
    quincenal: { inicio: resQuincenal.fechaInicio, fin: resQuincenal.fechaFin, empleados: quincenales.length },
    resumen: [...resSemanal.resumen.map(r => ({ ...r, grupo: 'SEMANAL' })),
              ...resQuincenal.resumen.map(r => ({ ...r, grupo: grupoQuincenal }))],
    dias: [...resSemanal.dias, ...resQuincenal.dias],
    noCobranHoy: empleados.filter(e => grupoDe(e) !== 'SEMANAL' && grupoDe(e) !== grupoQuincenal)
      .map(e => ({ idReloj: e.idReloj, nombre: e.nombre, grupo: grupoDe(e) })),
  };
}

// ---------- cerrar pago (aplica banco de horas y abonos de préstamos) ----------
function cerrarPeriodo(fecha) {
  const periodos = store.leer('periodos', []);
  const resultado = calcularPago(fecha);
  if (periodos.some(p => p.fechaPago === resultado.fechaPago)) {
    return { error: 'Este pago ya fue cerrado. Reábrelo primero si necesitas corregirlo.' };
  }

  const banco = store.leer('banco', {});
  const prestamos = store.leer('prestamos', []);
  const movimientos = [];

  for (const r of resultado.resumen) {
    // Banco de horas: entra lo enviado a banco, salen las horas usadas para cubrir faltas.
    const delta = (r.heABanco || 0) - (r.horasCubrenFaltas || 0);
    if (delta !== 0) {
      banco[r.idReloj] = +(((banco[r.idReloj] || 0) + delta).toFixed(2));
      movimientos.push({ tipo: 'banco', idReloj: r.idReloj, delta });
    }
    // Abonos de préstamos
    if (r.abonoPrestamo > 0) {
      let restante = r.abonoPrestamo;
      for (const p of prestamos) {
        if (p.idReloj !== r.idReloj || !p.activo || p.saldo <= 0 || restante <= 0) continue;
        const abono = Math.min(p.abono, p.saldo, restante);
        p.saldo = +(p.saldo - abono).toFixed(2);
        restante -= abono;
        if (p.saldo <= 0) p.activo = false;
        movimientos.push({ tipo: 'prestamo', idReloj: r.idReloj, prestamoId: p.id, abono });
      }
    }
  }

  store.guardar('banco', banco);
  store.guardar('prestamos', prestamos);
  periodos.push({
    fechaPago: resultado.fechaPago, grupoQuincenal: resultado.grupoQuincenal,
    semanal: resultado.semanal, quincenal: resultado.quincenal,
    cerradoEl: new Date().toISOString(),
    movimientos, resumen: resultado.resumen,
  });
  store.guardar('periodos', periodos);
  return { ok: true, fechaPago: resultado.fechaPago };
}

function reabrirPeriodo(fechaPago) {
  const periodos = store.leer('periodos', []);
  const idx = periodos.findIndex(p => p.fechaPago === fechaPago);
  if (idx === -1) return { error: 'Pago no encontrado' };
  const per = periodos[idx];
  const banco = store.leer('banco', {});
  const prestamos = store.leer('prestamos', []);
  for (const mov of per.movimientos || []) {
    if (mov.tipo === 'banco') {
      banco[mov.idReloj] = +(((banco[mov.idReloj] || 0) - mov.delta).toFixed(2));
    } else if (mov.tipo === 'prestamo') {
      const p = prestamos.find(x => x.id === mov.prestamoId);
      if (p) { p.saldo = +(p.saldo + mov.abono).toFixed(2); p.activo = true; }
    }
  }
  periodos.splice(idx, 1);
  store.guardar('banco', banco);
  store.guardar('prestamos', prestamos);
  store.guardar('periodos', periodos);
  return { ok: true };
}

// ---------- servidor ----------
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname;

  try {
    // ---- login ----
    if (ruta === '/api/login' && req.method === 'POST') {
      const ip = ipDe(req);
      const registro = intentosFallidos[ip] || { fallos: 0, bloqueadoHasta: 0 };
      if (Date.now() < registro.bloqueadoHasta) {
        const min = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
        return json(res, 429, { error: `Demasiados intentos fallidos. Espera ${min} minuto(s) e intenta de nuevo.` });
      }
      const { password } = await leerCuerpo(req);
      const parametros = store.leer('parametros', {});
      // La comparación ignora mayúsculas/minúsculas y espacios al inicio/final.
      const escrita = String(password || '').trim().toLowerCase();
      const correcta = String(parametros.password || '').trim().toLowerCase();
      if (!correcta || escrita === correcta) {
        delete intentosFallidos[ip];
        const token = crypto.randomBytes(16).toString('hex');
        sesiones.add(token);
        guardarSesiones();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `sesion=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      registro.fallos++;
      if (registro.fallos >= 5) {
        registro.bloqueadoHasta = Date.now() + 5 * 60 * 1000;
        registro.fallos = 0;
      }
      intentosFallidos[ip] = registro;
      return json(res, 401, { error: 'Contraseña incorrecta' });
    }

    if (ruta === '/api/sesion') {
      return json(res, 200, { conectado: tieneAcceso(req), empresa: store.leer('parametros', {}).empresa || '' });
    }

    // ---- API protegida ----
    if (ruta.startsWith('/api/')) {
      if (!tieneAcceso(req)) return json(res, 401, { error: 'Sesión no iniciada' });

      // Colecciones simples con CRUD por reemplazo completo
      const colecciones = ['empleados', 'turnos', 'excepciones', 'prestamos', 'asignaciones', 'viajes', 'capturas'];
      for (const col of colecciones) {
        if (ruta === '/api/' + col) {
          if (req.method === 'GET') return json(res, 200, store.leer(col, []));
          if (req.method === 'PUT') {
            const datos = await leerCuerpo(req);
            if (!Array.isArray(datos)) return json(res, 400, { error: 'Se esperaba una lista' });
            store.guardar(col, datos);
            return json(res, 200, { ok: true });
          }
        }
      }

      if (ruta === '/api/parametros') {
        if (req.method === 'GET') return json(res, 200, store.leer('parametros', {}));
        if (req.method === 'PUT') {
          const datos = await leerCuerpo(req);
          store.guardar('parametros', { ...store.leer('parametros', {}), ...datos });
          return json(res, 200, { ok: true });
        }
      }

      if (ruta === '/api/banco' && req.method === 'GET') {
        return json(res, 200, store.leer('banco', {}));
      }

      // Respaldo completo de todos los datos (para migrar a la nube o guardar copia)
      const COLECCIONES_RESPALDO = ['parametros', 'empleados', 'turnos', 'checadas', 'excepciones',
        'asignaciones', 'viajes', 'capturas', 'prestamos', 'banco', 'decisiones', 'periodos'];

      if (ruta === '/api/respaldo' && req.method === 'GET') {
        const datos = { app: 'nomina-dinmec', creado: new Date().toISOString() };
        for (const c of COLECCIONES_RESPALDO) {
          const porDefecto = ['parametros', 'banco', 'decisiones'].includes(c) ? {} : [];
          datos[c] = store.leer(c, porDefecto);
        }
        return json(res, 200, datos);
      }

      if (ruta === '/api/respaldo/restaurar' && req.method === 'POST') {
        const datos = await leerCuerpo(req);
        if (datos.app !== 'nomina-dinmec') return json(res, 400, { error: 'Este archivo no es un respaldo de Nómina DINMEC' });
        let restauradas = 0;
        for (const c of COLECCIONES_RESPALDO) {
          if (datos[c] !== undefined) { store.guardar(c, datos[c]); restauradas++; }
        }
        return json(res, 200, { ok: true, restauradas });
      }

      // Dirección de internet actual (el túnel la escribe en tunel.log)
      if (ruta === '/api/tunel' && req.method === 'GET') {
        try {
          const log = fs.readFileSync(path.join(__dirname, 'tunel.log'), 'utf8');
          const urls = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
          return json(res, 200, { url: urls ? urls[urls.length - 1] : null });
        } catch (e) {
          return json(res, 200, { url: null });
        }
      }

      if (ruta === '/api/decisiones' && req.method === 'PUT') {
        const { clave, datos } = await leerCuerpo(req);
        const dec = store.leer('decisiones', {});
        dec[clave] = { ...(dec[clave] || {}), ...datos };
        store.guardar('decisiones', dec);
        return json(res, 200, { ok: true });
      }

      if (ruta === '/api/checadas/importar' && req.method === 'POST') {
        const { texto } = await leerCuerpo(req);
        if (!texto) return json(res, 400, { error: 'Archivo vacío' });
        return json(res, 200, importarAttlog(texto));
      }

      if (ruta === '/api/checadas/resumen' && req.method === 'GET') {
        const checadas = store.leer('checadas', []);
        const fechas = checadas.map(c => c.fecha);
        return json(res, 200, {
          total: checadas.length,
          fechaMin: fechas.length ? fechas.reduce((a, b) => a < b ? a : b) : null,
          fechaMax: fechas.length ? fechas.reduce((a, b) => a > b ? a : b) : null,
        });
      }

      if (ruta === '/api/checadas' && req.method === 'GET') {
        const desde = url.searchParams.get('desde') || '0000';
        const hasta = url.searchParams.get('hasta') || '9999';
        const id = url.searchParams.get('id');
        let lista = store.leer('checadas', []).filter(c => c.fecha >= desde && c.fecha <= hasta);
        if (id) lista = lista.filter(c => String(c.idReloj) === id);
        return json(res, 200, lista);
      }

      if (ruta === '/api/checadas' && req.method === 'DELETE') {
        const { desde, hasta } = await leerCuerpo(req);
        let checadas = store.leer('checadas', []);
        const antes = checadas.length;
        checadas = checadas.filter(c => !(c.fecha >= desde && c.fecha <= hasta));
        store.guardar('checadas', checadas);
        return json(res, 200, { eliminadas: antes - checadas.length });
      }

      if (ruta === '/api/nomina' && req.method === 'GET') {
        const inicio = url.searchParams.get('inicio');
        const semanas = parseInt(url.searchParams.get('semanas') || '2', 10);
        if (!inicio) return json(res, 400, { error: 'Falta la fecha de inicio' });
        return json(res, 200, calcularNomina(inicio, semanas));
      }

      if (ruta === '/api/pago' && req.method === 'GET') {
        const fecha = url.searchParams.get('fecha');
        if (!fecha) return json(res, 400, { error: 'Falta la fecha de pago' });
        return json(res, 200, calcularPago(fecha));
      }

      if (ruta === '/api/periodos' && req.method === 'GET') {
        return json(res, 200, store.leer('periodos', []).map(p => ({
          fechaPago: p.fechaPago, grupoQuincenal: p.grupoQuincenal, cerradoEl: p.cerradoEl,
        })));
      }

      if (ruta === '/api/periodos/cerrar' && req.method === 'POST') {
        const { fecha } = await leerCuerpo(req);
        const r = cerrarPeriodo(fecha);
        return json(res, r.error ? 400 : 200, r);
      }

      if (ruta === '/api/periodos/reabrir' && req.method === 'POST') {
        const { fecha } = await leerCuerpo(req);
        const r = reabrirPeriodo(fecha);
        return json(res, r.error ? 400 : 200, r);
      }

      return json(res, 404, { error: 'Ruta no encontrada' });
    }

    // ---- archivos estáticos ----
    let archivo = ruta === '/' ? '/index.html' : ruta;
    archivo = path.normalize(archivo).replace(/^([.][.][\\/])+/, '');
    const completo = path.join(PUBLICO, archivo);
    if (!completo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
    fs.readFile(completo, (err, contenido) => {
      if (err) { res.writeHead(404); return res.end('No encontrado'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(completo)] || 'application/octet-stream' });
      res.end(contenido);
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log('  AVISO: La aplicacion ya esta corriendo (en otra ventana o en segundo plano).');
    console.log('  Solo abre tu navegador en: http://localhost:' + PUERTO);
    console.log('');
    process.exit(0); // ya hay un servidor sirviendo la app; este sobra
  } else {
    console.log('Error al iniciar el servidor:', e.message);
    process.exit(1);
  }
});

servidor.listen(PUERTO, () => {
  console.log('');
  console.log('  ============================================================');
  console.log('   NOMINA DINMEC lista. Abre tu navegador en:');
  console.log('   http://localhost:' + PUERTO);
  console.log('');
  console.log('   IMPORTANTE: NO cierres esta ventana negra mientras');
  console.log('   uses la aplicacion (puedes minimizarla).');
  console.log('  ============================================================');
  console.log('');
});
