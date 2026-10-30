// App No Formalizado: lista de llamadas (cliente, promotor, teléfono), detalle con gestión, base y segmentación,
// dashboard de evolución y administración de usuarios. Lee las tablas nf_* del Supabase de Telemercadeo.
const CFG = window.NF_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const DOMINIO = '@telemercadeo.example';
const ROLES = { admin: 'Administrador', generico: 'Genérico', sistema: 'Sistema' };
const SIN = '__sin';  // filtro "Sin gestionar"
// "Carlos Manuel Alvarez Gutierrez" → "carlos.manuel.alvarez.gutierrez"
const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => Number(v || 0).toLocaleString('es-NI');
const dinero = (v, dec = 2) => v == null ? '—' : 'C$ ' + Number(v).toLocaleString('es-NI', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '—';
const fFecha = v => { if (!v) return '—'; const [a, m, d] = v.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const fHora = v => v ? new Date(v).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const diaLocal = v => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Columnas de la consulta (todas se ven al abrir la solicitud y en la tabla de la base)
const CAMPOS = [
  { k: 'solicitud', t: 'Solicitud' },
  { k: 'cliente', t: 'Cliente' },
  { k: 'cedula', t: 'Cédula' },
  { k: 'telefono', t: 'Teléfono cliente' },
  { k: 'correo', t: 'Correo cliente' },
  { k: 'promotor', t: 'Promotor' },
  { k: 'tipo_credito', t: 'Tipo de crédito' },
  { k: 'categorizacion', t: 'Categorización' },
  { k: 'estado', t: 'Estado' },
  { k: 'fecha_creacion', t: 'Fecha creación', fecha: true },
  { k: 'monto_solicitado', t: 'Monto solicitado', dinero: true },
  { k: 'monto_tasa', t: 'Tasa', tasa: true },
  { k: 'monto_aprobado', t: 'Monto aprobado', dinero: true },
  { k: 'monto_pagare', t: 'Monto pagaré', dinero: true },
  { k: 'suc_origen', t: 'Sucursal origen' },
  { k: 'medio_captacion', t: 'Medio de captación' },
];
const GESTION = [
  { k: 'estatus_llamada', t: 'Estatus de llamada', est: true },
  { k: 'comentario', t: 'Comentario', coment: true },
  { k: 'gestiones', t: 'Gestiones', num: true },
  { k: 'gestionado_por', t: 'Gestionado por' },
  { k: 'gestionado_en', t: 'Última gestión', hora: true },
  { k: 'ingreso_en', t: 'En la base desde', hora: true },
];
const SALIDA = [
  { k: 'salida_en', t: 'Salió de la base', hora: true },
  { k: 'motivo_salida', t: 'Motivo de salida' },
  { k: 'estado_salida', t: 'Estado al salir' },
];
const SEGMENTOS = [
  ['estado', 'Estado (motivo TUD)'], ['tipo_credito', 'Tipo de crédito'], ['categorizacion', 'Categorización'],
  ['suc_origen', 'Sucursal origen'], ['medio_captacion', 'Medio de captación'], ['estatus_llamada', 'Estatus de llamada'],
  ['promotor', 'Promotor'],
];
const SEG_FUERA = [['motivo_salida', 'Motivo de salida'], ['estado_salida', 'Estado al salir']];

const S = { perfil: null, sol: [], estatus: [], cargas: [], tab: 'llamadas', vista: 'en', filtro: null,
            orden: { k: 'fecha_creacion', asc: true }, abierta: null };
const esAdmin = () => S.perfil?.rol === 'admin';
const contacto = e => S.estatus.find(x => x.estatus === e)?.contacto;

// ---------- Sesión ----------
async function perfilActual() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  return ok(await sb.from('nf_perfiles').select('*').eq('id', data.session.user.id).maybeSingle());
}

function mostrarLogin(msg = '') {
  $('app').hidden = true;
  $('login').hidden = false;
  $('flog').hidden = false;
  $('fclave').hidden = true;
  $('lmsg').textContent = msg;
}

$('flog').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    ok(await sb.auth.signInWithPassword({ email: slug($('lu').value) + DOMINIO, password: $('lp').value }));
    const p = await perfilActual();
    if (!p || !p.activo || p.rol === 'sistema') { await sb.auth.signOut(); return mostrarLogin('Usuario sin acceso a App No Formalizado'); }
    S.perfil = p;
    $('lp').value = '';
  } catch {
    return mostrarLogin('Usuario o contraseña incorrectos');
  }
  if (S.perfil.cambiar_clave) return pedirClave();
  await iniciar();
});

function pedirClave() {
  $('app').hidden = true;
  $('login').hidden = false;
  $('flog').hidden = true;
  $('fclave').hidden = false;
  $('cmsg').textContent = '';
  $('cn1').focus();
}

$('fclave').addEventListener('submit', async e => {
  e.preventDefault();
  const n1 = $('cn1').value, n2 = $('cn2').value;
  if (n1.length < 8) return ($('cmsg').textContent = 'La contraseña debe tener al menos 8 caracteres.');
  if (n1 !== n2) return ($('cmsg').textContent = 'Las dos contraseñas no coinciden.');
  try {
    ok(await sb.auth.updateUser({ password: n1 }));
    ok(await sb.rpc('nf_clave_cambiada'));
    $('cn1').value = $('cn2').value = '';
    await iniciar();
  } catch (err) { $('cmsg').textContent = err.message; }
});

async function iniciar() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('yoNombre').textContent = S.perfil.nombre;
  $('yoRol').textContent = ROLES[S.perfil.rol] || '';
  $('tabAdmin').hidden = !esAdmin();
  await cargar();
}

// ---------- Datos ----------
async function leerTodo(tabla, orden, filtro = q => q) {
  // PostgREST entrega como máximo 1000 filas por llamada: se pide por páginas
  const filas = [];
  for (let i = 0; ; i += 1000) {
    const p = ok(await filtro(sb.from(tabla).select('*')).order(orden).range(i, i + 999));
    filas.push(...p);
    if (p.length < 1000) return filas;
  }
}

async function cargar() {
  try {
    [S.sol, S.estatus, S.cargas] = await Promise.all([
      leerTodo('nf_solicitudes', 'solicitud'), leerTodo('nf_estatus', 'orden'), leerTodo('nf_cargas', 'id')]);
    aviso('');
  } catch (err) { return aviso(`No se pudieron leer los datos: ${err.message}`, true); }
  const ult = S.cargas[S.cargas.length - 1];
  $('ultima').textContent = ult ? `Última carga: ${fHora(ult.fecha)}` : 'Sin cargas aún';
  armarFiltrosLlamadas();
  pintar();
}

function aviso(texto, error = false) {
  $('aviso').hidden = !texto;
  $('aviso').textContent = texto || '';
  $('aviso').classList.toggle('error', error);
}

const enBase = () => S.sol.filter(r => r.en_base);
const coincide = (r, q) => !q || [r.cliente, r.cedula, r.telefono, r.promotor, r.solicitud]
  .some(v => v != null && String(v).toUpperCase().includes(q));

function pintar() {
  for (const [t, id] of [['llamadas', 'vLlamadas'], ['base', 'vBase'], ['dashboard', 'vDash'], ['admin', 'vAdmin']]) $(id).hidden = S.tab !== t;
  $('cntLlam').textContent = n0(enBase().length);
  if (S.tab === 'llamadas') pintarLlamadas();
  else if (S.tab === 'base') pintarBase();
  else if (S.tab === 'dashboard') pintarDashboard();
  else pintarUsuarios();
}

// ---------- Llamadas ----------
function armarFiltrosLlamadas() {
  const est = $('lEstatus'), actual = est.value;
  est.innerHTML = `<option value="">Todos</option><option value="${SIN}">Sin gestionar</option>`
    + S.estatus.map(x => `<option>${esc(x.estatus)}</option>`).join('');
  est.value = actual;
  const pro = $('lPromotor'), pAct = pro.value;
  const ps = [...new Set(enBase().map(r => r.promotor).filter(Boolean))].sort();
  pro.innerHTML = '<option value="">Todos</option>' + ps.map(p => `<option>${esc(p)}</option>`).join('');
  if (ps.includes(pAct)) pro.value = pAct;
}

function pintarLlamadas() {
  const q = $('lBuscar').value.trim().toUpperCase(), est = $('lEstatus').value, pro = $('lPromotor').value;
  const filas = enBase().filter(r => coincide(r, q) && (!pro || r.promotor === pro)
      && (!est || (est === SIN ? !r.estatus_llamada : r.estatus_llamada === est)))
    .sort((a, b) => (a.fecha_creacion || '').localeCompare(b.fecha_creacion || '') || a.solicitud - b.solicitud);
  $('tLlamadas').innerHTML = filas.map(r => `<tr data-sol="${r.solicitud}" class="${r.estatus_llamada ? 'gestionada' : ''}"
      title="${r.estatus_llamada ? esc(r.estatus_llamada) : 'Sin gestionar'}">
    <td>${esc(r.cliente)}</td><td>${esc(r.promotor || '—')}</td><td>${esc(r.telefono || '—')}</td></tr>`).join('');
  $('lVacio').hidden = filas.length > 0;
}

// ---------- Detalle y gestión ----------
function valor(c, v) {
  if (v == null || v === '') return '—';
  if (c.fecha) return fFecha(v);
  if (c.hora) return fHora(v);
  if (c.dinero) return dinero(v);
  if (c.tasa) return `${Number(v).toLocaleString('es-NI')}%`;
  return v;
}

async function abrir(sol) {
  const r = S.sol.find(x => x.solicitud === sol);
  if (!r) return;
  S.abierta = sol;
  $('mKicker').textContent = `Solicitud ${r.solicitud} · ${r.en_base ? 'en la base' : 'salió de la base'}`;
  $('mCliente').textContent = r.cliente || '';
  const tel = (r.telefono || '').replace(/[^\d+]/g, '');
  $('mLlamar').hidden = !tel;
  $('mLlamar').href = `tel:${tel}`;
  $('mLlamar').textContent = `📞 ${r.telefono || ''}`;
  const extra = [{ k: 'ingreso_en', t: 'En la base desde', hora: true }, ...(r.en_base ? [] : SALIDA)];
  $('mDatos').innerHTML = [...CAMPOS, ...extra].map(c => `<div><dt>${c.t}</dt><dd>${esc(valor(c, r[c.k]))}</dd></div>`).join('');
  $('gEstatus').innerHTML = '<option value="">Elegí el estatus…</option>'
    + S.estatus.map(x => `<option${x.estatus === r.estatus_llamada ? ' selected' : ''}>${esc(x.estatus)}</option>`).join('');
  $('gComentario').value = r.comentario || '';
  $('gMsg').textContent = '';
  const admin = esAdmin();
  $('gSolo').hidden = admin;
  for (const id of ['gEstatus', 'gComentario']) $(id).disabled = !admin;
  $('gGuardar').hidden = !admin;
  $('modal').hidden = false;
  document.body.style.overflow = 'hidden';
  await pintarHistorial(sol);
}

async function pintarHistorial(sol) {
  $('gHistorial').innerHTML = '<li class="small muted">Cargando…</li>';
  try {
    const hs = ok(await sb.from('nf_gestiones').select('*').eq('solicitud', sol).order('creado_en', { ascending: false }));
    $('gHistorial').innerHTML = hs.length ? hs.map(h => `<li>
        <div class="meta">${esc(fHora(h.creado_en))} · ${esc(h.nombre || '')}</div>
        <span class="est ${contacto(h.estatus) ? 'ok' : 'no'}">${esc(h.estatus)}</span>
        ${h.comentario ? `<p>${esc(h.comentario)}</p>` : ''}</li>`).join('')
      : '<li class="small muted">Todavía no hay gestiones.</li>';
  } catch (err) { $('gHistorial').innerHTML = `<li class="small">${esc(err.message)}</li>`; }
}

function cerrar() {
  $('modal').hidden = true;
  document.body.style.overflow = '';
  S.abierta = null;
}

$('fGestion').addEventListener('submit', async e => {
  e.preventDefault();
  const sol = S.abierta, estatus = $('gEstatus').value, comentario = $('gComentario').value;
  const btn = $('gGuardar');
  btn.disabled = true;
  try {
    ok(await sb.rpc('nf_gestionar', { p_solicitud: sol, p_estatus: estatus, p_comentario: comentario }));
    const r = S.sol.find(x => x.solicitud === sol);
    Object.assign(r, { estatus_llamada: estatus, comentario: comentario.trim() || null, gestionado_por: S.perfil.nombre,
                       gestionado_en: new Date().toISOString(), gestiones: (r.gestiones || 0) + 1 });
    $('gMsg').style.color = 'var(--verde-osc)';
    $('gMsg').textContent = '¡Gestión guardada!';
    await pintarHistorial(sol);
    pintar();
  } catch (err) {
    $('gMsg').style.color = 'var(--rojo)';
    $('gMsg').textContent = err.message;
  } finally { btn.disabled = false; }
});

$('mCerrar').addEventListener('click', cerrar);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) cerrar(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) cerrar(); });
$('tLlamadas').addEventListener('click', e => { const tr = e.target.closest('tr[data-sol]'); if (tr) abrir(+tr.dataset.sol); });
$('bBody').addEventListener('click', e => { const tr = e.target.closest('tr[data-sol]'); if (tr) abrir(+tr.dataset.sol); });

// ---------- Base y segmentación ----------
const vacioSeg = v => v == null || v === '' ? '(sin dato)' : v;
const colsBase = () => [...CAMPOS, ...GESTION, ...(S.vista === 'fuera' ? SALIDA : [])];

function filasBase() {
  const q = $('bBuscar').value.trim().toUpperCase();
  return S.sol.filter(r => r.en_base === (S.vista === 'en') && coincide(r, q)
    && (!S.filtro || vacioSeg(S.filtro.k === 'estatus_llamada' && !r[S.filtro.k] ? 'Sin gestionar' : r[S.filtro.k]) === S.filtro.v));
}

function barras(conteo, total, k, clickable) {
  const max = Math.max(...conteo.map(([, n]) => n), 1);
  return '<div class="barras">' + conteo.map(([v, n]) => {
    const on = S.filtro?.k === k && S.filtro.v === v;
    const tag = clickable ? 'button' : 'div';
    return `<${tag} class="barra${on ? ' on' : ''}" ${clickable ? `type="button" data-k="${k}" data-v="${esc(v)}"` : ''}
      title="${esc(v)}: ${n0(n)} (${pct(n, total)})">
      <span class="n">${esc(v)}</span>
      <span class="pista"><span class="relleno" style="width:${(100 * n / max).toFixed(1)}%"></span></span>
      <span class="v"><b>${n0(n)}</b> · ${pct(n, total)}</span></${tag}>`;
  }).join('') + '</div>';
}

function contar(filas, k) {
  const m = new Map();
  for (const r of filas) {
    const v = k === 'estatus_llamada' && !r[k] ? 'Sin gestionar' : vacioSeg(r[k]);
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}

function pintarBase() {
  const filas = filasBase();
  const tot = filas.length;
  $('bFiltro').hidden = !S.filtro;
  if (S.filtro) $('bFiltro').innerHTML = `${esc(S.filtro.t)}: ${esc(S.filtro.v)} <button type="button" aria-label="Quitar filtro">×</button>`;

  const gest = filas.filter(r => r.estatus_llamada).length;
  const cont = filas.filter(r => contacto(r.estatus_llamada)).length;
  const monto = filas.reduce((s, r) => s + Number(r.monto_solicitado || 0), 0);
  const tiles = S.vista === 'en'
    ? [['Clientes en la base', n0(tot), 'listos para llamar', 'hero'],
       ['Monto solicitado', dinero(monto, 0), 'suma de la selección', 'navy'],
       ['Gestionados', n0(gest), `${pct(gest, tot)} de la selección`, ''],
       ['Contactados', n0(cont), `${pct(cont, tot)} de la selección`, 'cielo'],
       ['Sin gestionar', n0(tot - gest), `${pct(tot - gest, tot)} de la selección`, 'naranja']]
    : (() => {
        const form = filas.filter(r => r.motivo_salida === 'FORMALIZÓ');
        const formGest = form.filter(r => r.gestiones > 0).length;
        return [['Salieron de la base', n0(tot), 'desde la primera carga', 'hero'],
                ['Formalizaron', n0(form.length), `${pct(form.length, tot)} de las salidas`, ''],
                ['Formalizaron tras llamada', n0(formGest), 'tenían al menos una gestión', 'cielo'],
                ['Monto solicitado', dinero(monto, 0), 'suma de la selección', 'navy']];
      })();
  $('bKpis').innerHTML = tiles.map(([l, v, s, c]) =>
    `<div class="kpi ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

  const segs = S.vista === 'en' ? SEGMENTOS : [...SEG_FUERA, ...SEGMENTOS];
  $('bSegmentos').innerHTML = segs.map(([k, t]) => {
    let c = contar(filas, k);
    if (c.length > 10) { const resto = c.slice(9).reduce((s, [, n]) => s + n, 0); c = [...c.slice(0, 9), [`Otros (${c.length - 9})`, resto]]; }
    return `<div class="panel" data-t="${esc(t)}"><h3>${t}</h3>${barras(c, tot, k, true)}</div>`;
  }).join('');

  const cols = colsBase();
  const ord = ordenar(filas);
  $('bHead').innerHTML = '<tr>' + cols.map(c =>
    `<th data-k="${c.k}" class="${c.dinero || c.tasa || c.num ? 'num' : ''}">${c.t}${S.orden.k === c.k ? `<span class="flecha">${S.orden.asc ? '▲' : '▼'}</span>` : ''}</th>`).join('') + '</tr>';
  $('bBody').innerHTML = ord.map(r => `<tr data-sol="${r.solicitud}" style="cursor:pointer">` + cols.map(c => {
    const v = r[c.k];
    if (v == null || v === '') return '<td class="nada">—</td>';
    if (c.est) return `<td><span class="est ${contacto(v) ? 'ok' : 'no'}">${esc(v)}</span></td>`;
    if (c.coment) return `<td class="coment">${esc(v)}</td>`;
    const num = c.dinero || c.tasa || c.num;
    return `<td class="${num ? 'num' : ''}">${esc(valor(c, v))}</td>`;
  }).join('') + '</tr>').join('');
  $('bVacio').hidden = ord.length > 0;
}

function ordenar(filas) {
  const { k, asc } = S.orden;
  return [...filas].sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
  });
}

$('bSegmentos').addEventListener('click', e => {
  const b = e.target.closest('button.barra');
  if (!b || b.dataset.v.startsWith('Otros (')) return;
  const { k, v } = b.dataset;
  S.filtro = S.filtro?.k === k && S.filtro.v === v ? null : { k, v, t: b.closest('.panel').dataset.t };
  pintarBase();
});
$('bFiltro').addEventListener('click', e => { if (e.target.closest('button')) { S.filtro = null; pintarBase(); } });
$('bVista').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  S.vista = b.dataset.v;
  S.filtro = null;
  document.querySelectorAll('#bVista button').forEach(x => x.classList.toggle('on', x === b));
  pintarBase();
});
$('bHead').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (!th) return;
  S.orden = { k: th.dataset.k, asc: S.orden.k === th.dataset.k ? !S.orden.asc : true };
  pintarBase();
});

function descargar() {
  const cols = colsBase();
  const datos = ordenar(filasBase()).map(r => Object.fromEntries(cols.map(c => {
    const v = r[c.k];
    if (v == null) return [c.t, ''];
    if (c.fecha) return [c.t, new Date(v + 'T00:00:00')];
    if (c.hora) return [c.t, new Date(v)];
    return [c.t, v];
  })));
  const ws = XLSX.utils.json_to_sheet(datos, { header: cols.map(c => c.t), cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' });
  ws['!cols'] = cols.map(c => ({ wch: c.coment ? 50 : ['cliente', 'promotor', 'gestionado_por'].includes(c.k) ? 34 : Math.max(c.t.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, S.vista === 'en' ? 'En la base' : 'Salieron');
  XLSX.writeFile(wb, `App No Formalizado ${S.vista === 'en' ? 'base' : 'salidas'} ${diaLocal(new Date())}.xlsx`);
}

// ---------- Dashboard ----------
// Paleta de marca validada (orden verde → navy → naranja → cielo pasa la prueba de daltonismo)
const COL = { base: '#4B9D45', entradas: '#06255B', otras: '#F5821F', form: '#00A4E0' };
const tip = $('tip');
function mostrarTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - w - 8)}px`;
  tip.style.top = `${Math.max(8, e.clientY - h - 12)}px`;
}
const ocultarTip = () => { tip.hidden = true; };
const filaTip = (color, t, v) => `<div class="fila"><span>${color ? `<i style="background:${color}"></i>` : ''}${t}</span><b>${v}</b></div>`;

function escala(max) {
  // Máximo "redondo" y 4 divisiones para la rejilla
  const paso = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1) / 4)));
  const div = [1, 2, 2.5, 5, 10].map(m => m * paso).find(d => d * 4 >= max) || paso * 10;
  return { tope: div * 4, marcas: [0, 1, 2, 3, 4].map(i => i * div) };
}

function ejeY(marcas, y, x0, x1) {
  return marcas.map(m => `<line class="${m ? 'rejilla' : 'base0'}" x1="${x0}" x2="${x1}" y1="${y(m)}" y2="${y(m)}"/>
    <text class="eje" x="${x0 - 6}" y="${y(m) + 4}" text-anchor="end">${n0(m)}</text>`).join('');
}

function graficoEvolucion() {
  const el = $('gEvolucion');
  const ds = S.cargas;
  if (!ds.length) { el.innerHTML = '<p class="small muted">Sin cargas aún.</p>'; return; }
  const W = 640, H = 260, m = { l: 44, r: 16, t: 18, b: 34 };
  const { tope, marcas } = escala(Math.max(...ds.map(d => d.en_base)));
  const x = i => m.l + (ds.length === 1 ? (W - m.l - m.r) / 2 : i * (W - m.l - m.r) / (ds.length - 1));
  const y = v => m.t + (H - m.t - m.b) * (1 - v / tope);
  const linea = ds.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.en_base).toFixed(1)}`).join('');
  const area = `${linea}L${x(ds.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  // Una etiqueta por día (en su primera carga), con al menos 60px entre etiquetas
  let ultX = -Infinity;
  const etqX = ds.map((d, i) => {
    const dia = diaLocal(d.fecha);
    if ((i && diaLocal(ds[i - 1].fecha) === dia) || x(i) - ultX < 60) return '';
    ultX = x(i);
    return `<text class="eje" x="${x(i)}" y="${H - 12}" text-anchor="middle">${fFecha(dia).slice(0, 5)}</text>`;
  }).join('');
  const ult = ds[ds.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Solicitudes en la base por carga">
    ${ejeY(marcas, y, m.l, W - m.r)}
    <path d="${area}" fill="${COL.base}" fill-opacity=".12"/>
    <path d="${linea}" fill="none" stroke="${COL.base}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${ds.length <= 40 ? ds.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.en_base)}" r="3" fill="${COL.base}" stroke="#fff" stroke-width="2"/>`).join('') : ''}
    <text class="etq" x="${x(ds.length - 1)}" y="${y(ult.en_base) - 10}" text-anchor="end">${n0(ult.en_base)}</text>
    ${etqX}
    <line id="cruz" class="base0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/>
    <rect id="zona" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>
  </svg>`;
  const svg = el.querySelector('svg'), cruz = svg.querySelector('#cruz');
  svg.querySelector('#zona').addEventListener('mousemove', e => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const px = pt.matrixTransform(svg.getScreenCTM().inverse()).x;
    const i = ds.length === 1 ? 0 : Math.max(0, Math.min(ds.length - 1, Math.round((px - m.l) / ((W - m.l - m.r) / (ds.length - 1)))));
    const d = ds[i];
    cruz.setAttribute('x1', x(i)); cruz.setAttribute('x2', x(i)); cruz.setAttribute('visibility', 'visible');
    mostrarTip(e, `<b>${fHora(d.fecha)}</b>${filaTip(COL.base, 'En la base', n0(d.en_base))}
      ${filaTip(COL.entradas, 'Nuevas', n0(d.nuevas))}${filaTip('', 'Reingresos', n0(d.reingresos))}
      ${filaTip(COL.otras, 'Salidas', n0(d.salidas))}${filaTip(COL.form, 'Formalizaron', n0(d.formalizadas))}`);
  });
  svg.querySelector('#zona').addEventListener('mouseleave', () => { cruz.setAttribute('visibility', 'hidden'); ocultarTip(); });
}

function graficoFlujo() {
  const el = $('gFlujo');
  // La primera carga mete toda la base como "nueva": no es un flujo, se deja fuera
  const dias = new Map();
  S.cargas.slice(1).forEach(c => {
    const k = diaLocal(c.fecha);
    const d = dias.get(k) || { dia: k, entradas: 0, form: 0, otras: 0 };
    d.entradas += c.nuevas + c.reingresos; d.form += c.formalizadas; d.otras += c.salidas - c.formalizadas;
    dias.set(k, d);
  });
  const ds = [...dias.values()].slice(-21);
  $('gFlujoLeyenda').innerHTML = [[COL.entradas, 'Entradas (nuevas + reingresos)'], [COL.form, 'Salidas: formalizaron'], [COL.otras, 'Salidas: otros motivos']]
    .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  if (!ds.length) { el.innerHTML = '<p class="small muted">Se verá desde la segunda carga.</p>'; return; }
  const W = 640, H = 260, m = { l: 44, r: 16, t: 18, b: 34 };
  const { tope, marcas } = escala(Math.max(...ds.map(d => Math.max(d.entradas, d.form + d.otras)), 1));
  const y = v => m.t + (H - m.t - m.b) * (1 - v / tope);
  const banda = (W - m.l - m.r) / ds.length, bw = Math.min(22, banda * 0.32);
  const barra = (x, v0, v1, color, arribaRedondo) => {
    if (v1 <= v0) return '';
    const yt = y(v1), yb = y(v0) - (v0 ? 2 : 0), h = Math.max(0, yb - yt);  // 2px de separación entre segmentos
    const r = arribaRedondo ? Math.min(4, h / 2) : 0;
    return `<path d="M${x},${yb}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${yb}Z" fill="${color}"/>`;
  };
  const cada = Math.max(1, Math.ceil(ds.length / 8));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas y salidas de la base por día">
    ${ejeY(marcas, y, m.l, W - m.r)}
    ${ds.map((d, i) => {
      const c = m.l + banda * i + banda / 2;
      return `<g data-i="${i}">
        <rect x="${m.l + banda * i}" y="${m.t}" width="${banda}" height="${H - m.t - m.b}" fill="transparent"/>
        ${barra(c - bw - 1, 0, d.entradas, COL.entradas, true)}
        ${barra(c + 1, 0, d.form, COL.form, !d.otras)}
        ${barra(c + 1, d.form, d.form + d.otras, COL.otras, true)}
        ${i % cada ? '' : `<text class="eje" x="${c}" y="${H - 12}" text-anchor="middle">${fFecha(d.dia).slice(0, 5)}</text>`}
      </g>`;
    }).join('')}
  </svg>`;
  el.querySelectorAll('g[data-i]').forEach(g => {
    const d = ds[+g.dataset.i];
    g.addEventListener('mousemove', e => mostrarTip(e, `<b>${fFecha(d.dia)}</b>${filaTip(COL.entradas, 'Entradas', n0(d.entradas))}
      ${filaTip(COL.form, 'Formalizaron', n0(d.form))}${filaTip(COL.otras, 'Otras salidas', n0(d.otras))}`));
    g.addEventListener('mouseleave', ocultarTip);
  });
}

function pintarDashboard() {
  const base = enBase(), tot = base.length, fuera = S.sol.filter(r => !r.en_base);
  const gest = base.filter(r => r.estatus_llamada).length;
  const cont = base.filter(r => contacto(r.estatus_llamada)).length;
  const form = fuera.filter(r => r.motivo_salida === 'FORMALIZÓ');
  const formGest = form.filter(r => r.gestiones > 0).length;
  const c = S.cargas, ult = c[c.length - 1], ant = c[c.length - 2];
  const delta = ult && ant ? ult.en_base - ant.en_base : null;
  const tiles = [
    ['En la base hoy', n0(tot), delta == null ? 'primera carga' : `${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}${n0(delta)} vs carga anterior`, 'hero'],
    ['Gestionados', n0(gest), `${pct(gest, tot)} de la base`, ''],
    ['Contactados', n0(cont), `${pct(cont, tot)} de la base`, 'cielo'],
    ['Salieron de la base', n0(fuera.length), 'desde la primera carga', 'naranja'],
    ['Formalizaron', n0(form.length), `${n0(formGest)} con gestión de llamada`, 'lima'],
  ];
  $('dKpis').innerHTML = tiles.map(([l, v, s, k]) =>
    `<div class="kpi ${k}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
  graficoEvolucion();
  graficoFlujo();
  $('gMotivos').innerHTML = fuera.length ? barras(contar(fuera, 'motivo_salida'), fuera.length, 'motivo_salida', false)
    : '<p class="small muted">Todavía no ha salido ninguna solicitud.</p>';
  $('gGestion').innerHTML = tot ? barras(contar(base, 'estatus_llamada'), tot, 'estatus_llamada', false)
    : '<p class="small muted">La base está vacía.</p>';
  $('dCargas').innerHTML = [...c].reverse().map(x => `<tr><td>${esc(fHora(x.fecha))}</td><td class="num">${n0(x.en_base)}</td>
    <td class="num">${n0(x.nuevas)}</td><td class="num">${n0(x.reingresos)}</td><td class="num">${n0(x.salidas)}</td>
    <td class="num">${n0(x.formalizadas)}</td></tr>`).join('') || '<tr><td colspan="6" class="nada">Sin cargas aún</td></tr>';
}

// ---------- Administración ----------
function claveTemporal() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), n => abc[n % abc.length]).join('');
}

async function pintarUsuarios() {
  try {
    const us = ok(await sb.from('nf_perfiles').select('*').order('nombre'));
    $('tUsuarios').innerHTML = us.map(u => `<tr data-id="${u.id}">
      <td>${esc(u.usuario)}</td><td>${esc(u.nombre)}</td>
      <td>${u.rol === 'sistema' ? 'Sistema' : `<select data-campo="rol">${['admin', 'generico'].map(k => `<option value="${k}"${k === u.rol ? ' selected' : ''}>${ROLES[k]}</option>`).join('')}</select>`}</td>
      <td>${u.rol === 'sistema' ? 'Sí' : `<input type="checkbox" data-campo="activo"${u.activo ? ' checked' : ''}>`}</td>
      <td>${u.rol === 'sistema' ? '' : '<button class="btn mini lin" data-acc="clave">Restablecer contraseña</button>'}</td></tr>`).join('');
  } catch (err) { aviso(err.message, true); }
}

$('fnuevo').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = $('nNombre').value.trim().replace(/\s+/g, ' '), clave = claveTemporal();
  try {
    ok(await sb.rpc('nf_crear_usuario', { p_usuario: slug(nombre), p_nombre: nombre, p_rol: $('nRol').value, p_password: clave }));
    $('nNombre').value = '';
    prompt(`Usuario creado. Ingresa con su nombre completo "${nombre}" y esta contraseña temporal (se le pedirá cambiarla). Si ya tenía usuario en el CRM de Telemercadeo, entra con su contraseña de siempre.`, clave);
    pintarUsuarios();
  } catch (err) { alert(err.message); }
});

$('tUsuarios').addEventListener('change', async e => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  try {
    ok(await sb.rpc('nf_editar_usuario', { p_id: tr.dataset.id, p_rol: tr.querySelector('[data-campo=rol]').value,
                                            p_activo: tr.querySelector('[data-campo=activo]').checked }));
  } catch (err) { alert(err.message); pintarUsuarios(); }
});

$('tUsuarios').addEventListener('click', async e => {
  const b = e.target.closest('button[data-acc=clave]');
  if (!b || !confirm('¿Restablecer la contraseña de este usuario?')) return;
  const clave = claveTemporal();
  try {
    ok(await sb.rpc('nf_restablecer_clave', { p_id: b.closest('tr').dataset.id, p_password: clave }));
    prompt('Contraseña restablecida. Contraseña temporal (se le pedirá cambiarla):', clave);
  } catch (err) { alert(err.message); }
});

$('btnClave').addEventListener('click', async () => {
  const actual = prompt('Contraseña actual:');
  if (!actual) return;
  const nueva = prompt('Nueva contraseña (mínimo 8 caracteres):');
  if (!nueva) return;
  if (nueva.length < 8) return alert('La contraseña debe tener al menos 8 caracteres.');
  try {
    ok(await sb.auth.signInWithPassword({ email: S.perfil.usuario + DOMINIO, password: actual }));
    ok(await sb.auth.updateUser({ password: nueva }));
    alert('Contraseña cambiada.');
  } catch { alert('La contraseña actual no es correcta.'); }
});

$('btnSalir').addEventListener('click', async () => { await sb.auth.signOut(); S.perfil = null; mostrarLogin(); });

// ---------- Eventos ----------
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  pintar();
});
for (const id of ['lEstatus', 'lPromotor']) $(id).addEventListener('change', pintarLlamadas);
$('lBuscar').addEventListener('input', pintarLlamadas);
$('bBuscar').addEventListener('input', pintarBase);
$('btnDescargar').addEventListener('click', descargar);
addEventListener('scroll', ocultarTip, { passive: true });

(async () => {
  try {
    S.perfil = await perfilActual();
    if (!S.perfil?.activo || S.perfil.rol === 'sistema') return mostrarLogin();
    if (S.perfil.cambiar_clave) return pedirClave();
    await iniciar();
  } catch (err) {
    mostrarLogin(`No se pudo iniciar: ${err.message}`);
  }
})();
