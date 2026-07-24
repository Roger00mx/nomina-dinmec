// store.js — Persistencia en archivos JSON (sin dependencias)
const fs = require('fs');
const path = require('path');

// En la PC del taller los datos viven en la carpeta "data"; en Render (nube)
// viven en el disco persistente indicado por la variable DIR_DATOS (/datos).
const DATA_DIR = process.env.DIR_DATOS || path.join(__dirname, 'data');

function rutaDe(nombre) {
  return path.join(DATA_DIR, nombre + '.json');
}

function leer(nombre, porDefecto) {
  try {
    const txt = fs.readFileSync(rutaDe(nombre), 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return porDefecto;
  }
}

function guardar(nombre, datos) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = rutaDe(nombre) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), 'utf8');
  fs.renameSync(tmp, rutaDe(nombre));
}

// ---------- Datos iniciales (semilla tomada del Excel "17 mayo.xlsx") ----------

const TURNOS_INICIALES = [
  { codigo: 'T1_MATUTINO',   horaEntrada: '07:00', horaSalida: '15:00', dias: [1,2,3,4,5,6], horasDia: 8,   cruzaMedianoche: false, descripcion: '1° Turno (7-15) L-S' },
  { codigo: 'T2_VESPERTINO', horaEntrada: '15:00', horaSalida: '23:00', dias: [1,2,3,4,5],   horasDia: 8,   cruzaMedianoche: false, descripcion: '2° Turno (15-23) L-V' },
  { codigo: 'T2_SABADO',     horaEntrada: '15:00', horaSalida: '20:00', dias: [6],           horasDia: 5,   cruzaMedianoche: false, descripcion: '2° Turno sábado (15-20)' },
  { codigo: 'T3_NOCTURNO',   horaEntrada: '23:00', horaSalida: '07:00', dias: [1,2,3,4,5],   horasDia: 8,   cruzaMedianoche: true,  descripcion: '3° Turno nocturno (23-7) L-V' },
  { codigo: 'METROLOGIA',    horaEntrada: '08:00', horaSalida: '18:00', dias: [1,2,3,4,5],   horasDia: 10,  cruzaMedianoche: false, descripcion: 'Metrología 8-18 L-V' },
  { codigo: 'OFICINA',       horaEntrada: '07:00', horaSalida: '17:00', dias: [1,2,3,4,5],   horasDia: 10,  cruzaMedianoche: false, descripcion: 'Oficina 7-17 L-V' },
  { codigo: 'LIMPIEZA',      horaEntrada: '07:00', horaSalida: '16:00', dias: [1,2,3,4,5],   horasDia: 9,   cruzaMedianoche: false, descripcion: 'Limpieza 7-16 L-V' },
  { codigo: 'ALMACEN',       horaEntrada: '07:00', horaSalida: '16:30', dias: [1,2,3,4,5],   horasDia: 9.5, cruzaMedianoche: false, descripcion: 'Almacén 7-16:30 L-V' },
  { codigo: 'DIA_7A7',       horaEntrada: '07:00', horaSalida: '19:00', dias: [1,2,3,4,5],   horasDia: 10,  cruzaMedianoche: false, descripcion: 'Horario prolongado día (7am-7pm)' },
  { codigo: 'NOCHE_7A7',     horaEntrada: '19:00', horaSalida: '07:00', dias: [1,2,3,4,5],   horasDia: 10,  cruzaMedianoche: true,  descripcion: 'Horario prolongado noche (7pm-7am)' },
];

function emp(id, nombre, sueldo, turnoS1, turnoS2, costoHN, costoHE, dispersion, banco) {
  return {
    idReloj: id, numEmpleado: id, nombre, sueldoSemanal: sueldo,
    turnoS1, turnoS2: turnoS2 || '', costoHoraNormal: costoHN, costoHoraExtra: costoHE,
    dispersion: !!dispersion, banco: banco || '',
    desayunoMin: 20, comidaMin: 30, activo: true,
  };
}

const EMPLEADOS_INICIALES = [
  emp(3,   'Leonardo González Ríos',                4840,    'OFICINA', '',              96.8,   193.6,   true,  'BANORTE'),
  emp(4,   'Jesús Delfino Romero Hernández',        3000,    'OFICINA', 'T2_VESPERTINO', 60,     120,     false, ''),
  emp(8,   'Samuel Nocelotl Rivera',                4500,    'OFICINA', '',              90,     180,     false, ''),
  emp(12,  'Vicente Larios',                        3400,    'T2_VESPERTINO', 'T1_MATUTINO', 85, 170,     true,  ''),
  emp(13,  'Guillermo Barrios García',              5600,    'OFICINA', '',              112,    224,     true,  ''),
  emp(14,  'Juan Daniel González de Jesús',         6050,    'METROLOGIA', '',           121,    242,     true,  ''),
  emp(19,  'Jesús Moyotl Xochitecatl',              3500,    'T2_VESPERTINO', 'T1_MATUTINO', 87.5, 175,   true,  'BANORTE'),
  emp(20,  'Angel Montiel',                         4875,    'OFICINA', '',              97.5,   195,     true,  ''),
  emp(33,  'Esmeralda de la Luz Perez Xochitecatl', 2362.8,  'LIMPIEZA', '',             52.51,  105.01,  true,  'BANORTE'),
  emp(36,  'Jose Antonino Cocone Panecatl',         2700,    'T1_MATUTINO', 'T1_MATUTINO', 67.5, 135,     true,  'BANORTE'),
  emp(37,  'Aureliano Martínez Durán',              2500,    'OFICINA', '',              50,     100,     true,  'BANORTE'),
  emp(42,  'Sagrario Agustina León Zepeda',         5500,    'OFICINA', '',              110,    220,     true,  'BANORTE'),
  emp(52,  'Yadira Toxqui Hernández',               4166.67, 'OFICINA', '',              83.33,  166.67,  false, ''),
  emp(59,  'Benjamín Arévalo Herrera',              4000,    'OFICINA', '',              80,     160,     false, ''),
  emp(65,  'Miriam Rivera Cuatlayotl',              1930,    'OFICINA', '',              38.6,   77.2,    false, ''),
  emp(68,  'Cristian Uriel Carcaño Contreras',      3500,    'OFICINA', '',              70,     140,     false, ''),
  emp(78,  'Angel Huerta Luna',                     4700,    'OFICINA', '',              94,     188,     true,  'BANORTE'),
  emp(95,  'Oscar Hugo Martínez Gómez',             4400,    'OFICINA', 'T2_VESPERTINO', 88,     176,     true,  'BANORTE'),
  emp(107, 'Eduardo Fabrizio',                      3025,    'OFICINA', '',              60.5,   121,     true,  ''),
  emp(121, 'Martín García Loeza',                   4000,    'OFICINA', '',              80,     160,     false, ''),
  emp(125, 'Honorio Navarro',                       2500,    'OFICINA', '',              50,     100,     false, ''),
  emp(129, 'José Texca López',                      2300,    'OFICINA', '',              46,     92,      false, ''),
  emp(130, 'Antonio Solís Martínez',                2100,    'OFICINA', '',              42,     84,      false, ''),
  emp(137, 'Erik García Bernardo',                  2750,    'OFICINA', '',              55,     110,     false, ''),
  emp(140, 'América',                               3500,    'OFICINA', '',              70,     140,     true,  ''),
  emp(156, 'Yahir Nocelotl Atenco',                 2600,    'OFICINA', '',              52,     104,     false, ''),
  emp(164, 'Empleado 164',                          0,       'OFICINA', '',              0,      0,       false, ''),
  emp(167, 'Jafet Cordero Escalante',               600,     'OFICINA', '',              12,     24,      false, ''),
];

const PARAMETROS_INICIALES = {
  empresa: 'DINMEC SOLUTIONS',
  // La semana de nómina corre de viernes a jueves (el corte es el jueves).
  diaInicioSemana: 5,          // 5 = viernes (1=Lun ... 7=Dom)
  toleranciaMin: 5,            // minutos de tolerancia en la entrada
  retardosPorFalta: 3,         // cada 3 retardos en la semana = 1 día de descuento
  castigoMin: 10,              // minutos de castigo por no checar regreso de descanso
  umbralHorasExtra: 0.5,       // horas extras menores a esto no se pagan
  factorHoraExtra: 1.5,        // hora extra normal = hora normal × 1.5
  factorHoraExtraCNC: 2,       // hora extra de puesto CNC = hora normal × 2
  factorHoraExtraDomingo: 2,   // trabajar en DOMINGO se paga doble para todos
  redondeoHE: 0,               // 0 = conteo exacto al minuto; 0.5 o 1 = redondear hacia abajo a ese múltiplo
  montoDispersion: 4725.60,    // monto fijo de dispersión bancaria
  desayunoMin: 20,             // minutos de desayuno por defecto
  comidaMin: 30,               // minutos de comida por defecto
  olvidoEntradaMin: 60,        // si la 1ª checada llega esto (o más) tarde, se asume olvido de entrada
  password: 'dinmec',          // contraseña de acceso (vacío = sin login)
  feriados: [],                // [{ fecha: 'YYYY-MM-DD', descripcion: '' }]
};

function inicializar() {
  if (!fs.existsSync(rutaDe('turnos')))      guardar('turnos', TURNOS_INICIALES);
  if (!fs.existsSync(rutaDe('empleados')))   guardar('empleados', EMPLEADOS_INICIALES);
  if (!fs.existsSync(rutaDe('parametros')))  guardar('parametros', PARAMETROS_INICIALES);
  if (!fs.existsSync(rutaDe('checadas')))    guardar('checadas', []);
  if (!fs.existsSync(rutaDe('excepciones'))) guardar('excepciones', []);
  if (!fs.existsSync(rutaDe('asignaciones'))) guardar('asignaciones', []); // turnos por semana
  if (!fs.existsSync(rutaDe('viajes')))       guardar('viajes', []);       // horas manuales de choferes en viaje
  if (!fs.existsSync(rutaDe('capturas')))     guardar('capturas', []);     // horarios editados a mano (con foto)

  if (!fs.existsSync(rutaDe('prestamos')))   guardar('prestamos', []);
  if (!fs.existsSync(rutaDe('banco')))       guardar('banco', {});      // { idReloj: horas }
  if (!fs.existsSync(rutaDe('decisiones')))  guardar('decisiones', {}); // { "inicio_id": {...} }
  if (!fs.existsSync(rutaDe('periodos')))    guardar('periodos', []);   // periodos cerrados
}

module.exports = { leer, guardar, inicializar, PARAMETROS_INICIALES };
