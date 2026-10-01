'use strict';
/* ============ 1. DATOS Y PERSISTENCIA (localStorage) ============ */
const KEY = 'finanzas_v1';
const REC = {0:'Una sola vez',1:'Mensual',2:'Cada 2 meses',3:'Trimestral',6:'Semestral',12:'Anual'};
const def = () => ({balance:0, payDay:30, nextPay:'', payAmount:0, cycle:{mode:'first', day:1}, minSafe:300, theme:'auto',
  cats:['Vivienda','Alimentación','Transporte','Ocio','Suscripciones','Seguros','Otros'],
  tags:['Prescindible','Necesario','Importante','Extra'], exp:[], paid:{}, log:[]});
let S = load();
function load(){ try{ return Object.assign(def(), JSON.parse(localStorage.getItem(KEY)||'{}')); }catch(e){ return def(); } }
function save(){ localStorage.setItem(KEY, JSON.stringify(S)); }

/* ============ 2. FECHAS (siempre a mediodía local para evitar saltos de horario) ============ */
const lastDay = (y,m) => new Date(y,m+1,0).getDate();
// Fecha en (año, mes, día) con desbordes de mes y recorte al último día del mes (31 -> 30/28/29)
function mk(y,m,d){ const b=new Date(y,m,1,12); return new Date(b.getFullYear(), b.getMonth(), Math.min(d,lastDay(b.getFullYear(),b.getMonth())), 12); }
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parse = s => { const [a,b,c]=s.split('-').map(Number); return new Date(a,b-1,c,12); };
const fmtD = s => { const [a,b,c]=s.split('-'); return `${c}/${b}/${a}`; };
const today = () => iso(new Date());
const addDays = (s,n) => { const d=parse(s); d.setDate(d.getDate()+n); return iso(d); };
const eur = n => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n||0);
const num = v => { const n=parseFloat(String(v).replace(/\./g,'').replace(',','.')); return isNaN(n)?0:n; };
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,9);

// Inicio de ciclo del mes (y,m) según configuración
function cycleStartOf(y,m){ const c=S.cycle; return c.mode==='first'?mk(y,m,1):c.mode==='last'?mk(y,m,31):mk(y,m,c.day); }
// Ciclo financiero que contiene la fecha t
function cycle(t=today()){
  const d=parse(t);
  for(let o=1;o>=-2;o--){
    const s=cycleStartOf(d.getFullYear(),d.getMonth()+o);
    if(iso(s)<=t){ const n=cycleStartOf(d.getFullYear(),d.getMonth()+o+1); return {start:iso(s), end:addDays(iso(n),-1)}; }
  }
}
// Si la nómina ya pasó, calcula la siguiente a partir del día habitual
function normPay(){
  const t=today();
  if(!S.nextPay){ const d=new Date(); let p=mk(d.getFullYear(),d.getMonth(),S.payDay); if(iso(p)<t)p=mk(d.getFullYear(),d.getMonth()+1,S.payDay); S.nextPay=iso(p); }
  let g=0; while(S.nextPay<t && g++<48){ const p=parse(S.nextPay); S.nextPay=iso(mk(p.getFullYear(),p.getMonth()+1,S.payDay)); }
}
// Fechas en que ocurre un gasto dentro de [from,to]
function occ(e,from,to){
  const out=[];
  if(!+e.rec){ if(e.date>=from&&e.date<=to)out.push(e.date); return out; }
  const a=parse(e.date), dayN=e.rule==='last'?31:e.rule==='first'?1:a.getDate();
  for(let k=0;k<1200;k++){
    const d=iso(mk(a.getFullYear(),a.getMonth()+k*e.rec,dayN));
    if(d>to)break;
    if(d>=from&&d>=e.date)out.push(d);
  }
  return out;
}

/* ============ 3. MOTOR DE CÁLCULO ============ */
const spent = (name,c) => S.log.filter(l=>l.variable===name&&l.date>=c.start&&l.date<=c.end).reduce((s,l)=>s+l.amt,0);
// Ocurrencias con importe efectivo. Variable pendiente = presupuesto - gastado real en el ciclo
function items(from,to){
  const c=cycle(), r=[];
  S.exp.forEach(e=>occ(e,from,to).forEach(d=>{
    const paid=!!S.paid[e.id+'|'+d]; let amt=+e.amount;
    if(e.type==='variable'&&!paid&&d>=c.start&&d<=c.end) amt=Math.max(0,amt-spent(e.variable||e.name,c));
    r.push({e,date:d,paid,amt});
  }));
  return r.sort((x,y)=>x.date<y.date?-1:x.date>y.date?1:0);
}
// Estado financiero. Conceptos separados: saldo real, comprometido, disponible, previsto, mínimo.
function calc(){
  normPay();
  const t=today(), c=cycle(t), np=S.nextPay, end=c.end>np?c.end:np;
  const it=items(c.start,end);
  const pend=it.filter(i=>!i.paid&&i.date<np);                      // pendientes hasta la nómina
  const aft=it.filter(i=>!i.paid&&i.date>=np&&i.date<=c.end);       // pendientes tras la nómina, dentro del ciclo
  const sum=a=>a.reduce((s,i)=>s+i.amt,0), pay=+S.payAmount||0;
  const com=sum(pend), post=sum(aft), av=S.balance-com, fc=S.balance-com+pay-post;
  let b=S.balance; const pts=[{l:'Hoy',v:b}];
  pend.forEach(i=>{b-=i.amt;pts.push({l:i.e.name,v:b});});
  b+=pay; pts.push({l:'Nómina',v:b});
  aft.forEach(i=>{b-=i.amt;pts.push({l:i.e.name,v:b});});
  return {t,c,np,it,pend,aft,com,post,av,fc,pay,pts,days:Math.round((parse(np)-parse(t))/864e5)};
}
function alerts(k){
  const a=[], m=S.minSafe, minV=Math.min(...k.pts.map(p=>p.v));
  if(minV<0)a.push(['bad','Tu saldo previsto puede ser negativo ('+eur(minV)+').']);
  else if(minV<m)a.push(['','El saldo previsto baja de tu mínimo de seguridad ('+eur(m)+').']);
  if(k.av<m&&k.av>=0)a.push(['','Dinero disponible por debajo del mínimo de seguridad.']);
  if(k.com>0&&k.com>S.balance*0.8&&S.balance>0)a.push(['','Tienes muchos gastos pendientes antes de la nómina.']);
  const big=k.pend.find(i=>i.date>=k.t&&i.date<=addDays(k.t,3)&&i.amt>=Math.max(S.balance*.25,1));
  if(big)a.push(['','Gasto importante cerca: '+big.e.name+' ('+eur(big.amt)+', '+fmtD(big.date)+').']);
  if(k.days<=3)a.push(['','Tu nómina llega '+(k.days===0?'hoy':'en '+k.days+' día(s)')+'.']);
  return a;
}

/* ============ 4. INTERFAZ ============ */
let tab='resumen', F={q:'',cat:'',tag:'',vr:'',type:'',st:'',per:''};
const $=s=>document.querySelector(s);
const opt=(arr,sel)=>arr.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(sel)?'selected':''}>${esc(l)}</option>`).join('');
const sheet=h=>{$('#sheet').innerHTML='<div class="bk" data-act="close"></div><div class="pn">'+h+'</div>';$('#sheet').hidden=false;};
const closeSheet=()=>{$('#sheet').hidden=true;$('#sheet').innerHTML='';};

function applyTheme(){ document.documentElement.dataset.theme=S.theme==='auto'?'':S.theme; }

function render(){
  applyTheme();
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  $('#view').innerHTML = tab==='resumen'?vResumen():tab==='mov'?vMov():vAjustes();
  save();
}
function group(list,keyFn){ const m={}; list.forEach(i=>{ keyFn(i).forEach(k=>{ m[k]=(m[k]||0)+i.amt; }); }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); }
function bars(rows,total){ return rows.length?rows.map(([k,v])=>`<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span>${esc(k)}</span><b>${eur(v)}</b></div><div class="bar"><i style="width:${total?Math.max(2,v/total*100):0}%"></i></div></div>`).join(''):'<small>Sin datos</small>'; }

function chart(pts){
  if(pts.length<2)return '';
  const W=320,H=140,p=22, vs=pts.map(x=>x.v), mn=Math.min(0,...vs), mx=Math.max(...vs,1), rg=(mx-mn)||1;
  const X=i=>p+i*(W-2*p)/(pts.length-1), Y=v=>H-p-(v-mn)/rg*(H-2*p);
  const line=pts.map((q,i)=>`${X(i)},${Y(q.v)}`).join(' ');
  const mnS=S.minSafe>mn&&S.minSafe<mx?`<line x1="${p}" x2="${W-p}" y1="${Y(S.minSafe)}" y2="${Y(S.minSafe)}" stroke="var(--warn)" stroke-dasharray="4"/>`:'';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%"><line x1="${p}" x2="${W-p}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--bad)" stroke-width=".8"/>${mnS}
  <polyline points="${line}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round"/>
  ${pts.map((q,i)=>`<circle cx="${X(i)}" cy="${Y(q.v)}" r="3.5" fill="${q.v<0?'var(--bad)':'var(--ac)'}"/>`).join('')}
  <text x="${p}" y="${H-5}">Hoy ${eur(pts[0].v)}</text><text x="${W-p}" y="${H-5}" text-anchor="end">Final ${eur(pts[pts.length-1].v)}</text></svg>
  <small>Línea roja = 0 €, discontinua = mínimo de seguridad.</small>`;
}

function vResumen(){
  const k=calc(), cyc=k.it.filter(i=>i.date>=k.c.start&&i.date<=k.c.end);
  const logC=S.log.filter(l=>l.date>=k.c.start&&l.date<=k.c.end).map(l=>({e:{cat:l.cat,tags:[]},amt:l.amt}));
  const all=cyc.concat(logC), tot=all.reduce((s,i)=>s+i.amt,0);
  const cats=group(all,i=>[i.e.cat||'Sin categoría']);
  const tgs=S.tags.map(t=>[t,cyc.filter(i=>(i.e.tags||[]).includes(t)).reduce((s,i)=>s+i.amt,0)]).filter(x=>x[1]>0);
  const vars=[...new Set(S.exp.filter(e=>e.type==='variable').map(e=>e.variable||e.name))].map(v=>{
    const bud=S.exp.filter(e=>e.type==='variable'&&(e.variable||e.name)===v).reduce((s,e)=>s+ +e.amount,0), sp=spent(v,k.c);
    return `<div class="row"><div>${esc(v)}<small>Presupuesto ${eur(bud)} · Gastado ${eur(sp)}</small></div><div class="r ${bud-sp<0?'neg':''}"><b>${eur(bud-sp)}</b><small>disponible</small></div></div>`; }).join('');
  const next=k.it.filter(i=>i.date>=k.t||!i.paid).slice(0,8);
  return `<h2>Resumen</h2>
  ${alerts(k).map(a=>`<div class="alert ${a[0]}">⚠️ ${esc(a[1])}</div>`).join('')}
  <div class="card hero"><small>DINERO DISPONIBLE (saldo seguro)</small><div class="big ${k.av<0?'neg':''}">${eur(k.av)}</div><small>Puedes gastarlo sin comprometer los pagos hasta la nómina</small></div>
  <div class="grid"><div class="card"><small>Saldo actual</small><div class="n">${eur(S.balance)}</div></div>
  <div class="card"><small>Comprometido</small><div class="n">${eur(k.com)}</div></div>
  <div class="card"><small>Próxima nómina · ${fmtD(k.np)}</small><div class="n">+${eur(k.pay)}</div><small>${k.days===0?'Es hoy':'Faltan '+k.days+' días'}</small></div>
  <div class="card"><small>Saldo previsto</small><div class="n ${k.fc<0?'neg':''}">${eur(k.fc)}</div><small>tras nómina y gastos del ciclo</small></div></div>
  <small class="mu" style="display:block;margin:8px 2px">Ciclo actual: ${fmtD(k.c.start)} → ${fmtD(k.c.end)}</small>
  <h3>Gastos hasta la nómina · ${eur(k.com)}</h3><div class="card">${k.pend.length?k.pend.map(i=>`<div class="row"><div>${esc(i.e.name)}<small>${fmtD(i.date)}</small></div><div class="r">${eur(i.amt)}</div></div>`).join(''):'<small>Nada pendiente 🎉</small>'}</div>
  <h3>Próximos gastos</h3><div class="card">${next.length?next.map(i=>`<div class="row"><div>${fmtD(i.date)} — ${esc(i.e.name)}</div><div class="r">${eur(i.e.type==='variable'&&i.paid?i.e.amount:i.amt)} <span class="pill ${i.paid?'p':''}">${i.paid?'Pagado':'Pendiente'}</span></div></div>`).join(''):'<small>Sin gastos próximos</small>'}</div>
  <h3>Evolución del saldo</h3><div class="card">${chart(k.pts)}</div>
  <h3>Por categoría · ${eur(tot)}</h3><div class="card">${bars(cats,tot)}</div>
  <h3>Por etiqueta</h3><div class="card"><small>Las etiquetas clasifican; no suman al total.</small>${bars([['Antes de nómina (por fechas)',k.com]].concat(tgs),Math.max(tot,k.com))}</div>
  ${vars?`<h3>Variables presupuestadas</h3><div class="card">${vars}</div>`:''}
  ${calendar(k)}`;
}
// Calendario compacto del ciclo: puntos por día
function calendar(k){
  const days=[]; for(let d=k.c.start;d<=k.c.end&&days.length<62;d=addDays(d,1))days.push(d);
  const cell=d=>{ const its=k.it.filter(i=>i.date===d), pay=d===k.np;
    const bg=pay?'var(--ac)':its.length?(its.every(i=>i.paid)?'var(--bd)':'var(--ac2)'):'transparent';
    return `<div style="text-align:center;padding:6px 0;border-radius:8px;background:${bg};${pay?'color:#fff;':''}font-size:13px">${+d.slice(8)}<br><small style="${pay?'color:#fff':''}">${pay?'💶':its.length?its.length+'×':'·'}</small></div>`; };
  return `<h3>Calendario del ciclo</h3><div class="card"><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${days.map(cell).join('')}</div><small>💶 nómina · fondo claro = gastos pendientes · gris = pagados</small></div>`;
}

function ruleTxt(e){ return (REC[e.rec]||'')+(+e.rec?(e.rule==='last'?' · último día':e.rule==='first'?' · día 1':' · día '+parse(e.date).getDate()):' · '+fmtD(e.date)); }
function vMov(){
  const k=calc(), far=k.c.end>k.np?k.c.end:k.np, y5=addDays(k.t,1825);
  const rows=S.exp.map(e=>{
    const win=occ(e,k.c.start,far), un=win.filter(d=>!S.paid[e.id+'|'+d]);
    const target=un[0]||null, nextD=target||occ(e,k.t,y5)[0]||null;
    return {e,win,target,nextD,st:win.length&&!un.length?'paid':'pend'};
  }).filter(r=>{const e=r.e;
    return (!F.q||e.name.toLowerCase().includes(F.q.toLowerCase()))&&(!F.cat||e.cat===F.cat)&&(!F.tag||(e.tags||[]).includes(F.tag))&&
    (!F.vr||(e.variable||'')===F.vr)&&(!F.type||e.type===F.type)&&(!F.st||r.st===F.st)&&
    (!F.per||(F.per==='ciclo'?occ(e,k.c.start,k.c.end).length:occ(e,k.c.start,addDays(k.np,-1)).length)); });
  const vl=[...new Set(S.exp.map(e=>e.variable).filter(Boolean))];
  return `<h2>Movimientos</h2>
  <div class="card"><small>SALDO ACTUAL (€)</small><input id="bal" inputmode="decimal" value="${String(S.balance).replace('.',',')}"><button class="btn" data-act="saldo">Actualizar saldo</button></div>
  <button class="btn" data-act="newExp">+ Añadir gasto</button><button class="btn sec" data-act="newReal">+ Registrar gasto</button>
  <h3>Filtros</h3><div class="card"><input id="fq" placeholder="Buscar por nombre" value="${esc(F.q)}">
  <div class="two"><select data-f="cat"><option value="">Categoría</option>${opt(S.cats.map(c=>[c,c]),F.cat)}</select><select data-f="tag"><option value="">Etiqueta</option>${opt(S.tags.map(c=>[c,c]),F.tag)}</select>
  <select data-f="vr"><option value="">Variable</option>${opt(vl.map(c=>[c,c]),F.vr)}</select><select data-f="type"><option value="">Fijo/Variable</option>${opt([['fijo','Fijo'],['variable','Variable']],F.type)}</select>
  <select data-f="st"><option value="">Estado</option>${opt([['pend','Pendiente'],['paid','Pagado']],F.st)}</select><select data-f="per"><option value="">Fecha: todas</option>${opt([['ciclo','Este ciclo'],['nomina','Hasta nómina']],F.per)}</select></div></div>
  <h3>Gastos programados (${rows.length})</h3>
  ${rows.map(r=>`<div class="card"><div class="row" style="border:0;padding-top:0"><div><b>${esc(r.e.name)}</b><small>${esc(r.e.cat)} · ${r.e.type==='variable'?'Variable (presupuesto)':'Fijo'} · ${ruleTxt(r.e)}</small>${(r.e.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join('')}${r.e.variable?`<span class="pill p">${esc(r.e.variable)}</span>`:''}</div>
  <div class="r"><b>${eur(r.e.amount)}</b><small>${r.nextD?fmtD(r.target||r.nextD):'—'}</small>${r.win.length?`<span class="pill ${r.st==='paid'?'p':''}">${r.st==='paid'?'Pagado':'Pendiente'}</span>`:''}</div></div>
  <div class="acts"><button data-act="edit" data-id="${r.e.id}">Editar</button><button data-act="dup" data-id="${r.e.id}">Duplicar</button>
  ${r.win.length?`<button data-act="pay" data-id="${r.e.id}">${r.target?'Marcar pagado':'Deshacer pago'}</button>`:''}<button data-act="del" data-id="${r.e.id}">Eliminar</button></div></div>`).join('')||'<div class="card"><small>No hay gastos. Pulsa “+ Añadir gasto”.</small></div>'}
  <h3>Gastos reales registrados</h3><div class="card">${S.log.slice().sort((a,b)=>a.date<b.date?1:-1).map(l=>`<div class="row"><div>${esc(l.name)}<small>${fmtD(l.date)} · ${esc(l.cat)}${l.variable?' · '+esc(l.variable):''}</small></div><div class="r">${eur(l.amt)}<small><a data-act="undoReal" data-id="${l.id}" style="color:var(--ac)">Deshacer</a> · <a data-act="editReal" data-id="${l.id}" style="color:var(--ac)">Editar</a></small></div></div>`).join('')||'<small>Ninguno todavía</small>'}</div>`;
}

function vAjustes(){
  const list=(arr,kind)=>arr.map((x,i)=>`<div class="row"><span>${esc(x)}</span><span class="acts" style="padding:0"><button data-act="ren" data-kind="${kind}" data-i="${i}">Editar</button><button data-act="rm" data-kind="${kind}" data-i="${i}">Eliminar</button></span></div>`).join('');
  return `<h2>Ajustes</h2>
  <div class="card"><b>Nómina</b><label>Día habitual de cobro<input id="s_pd" type="number" min="1" max="31" value="${S.payDay}"></label>
  <label>Próxima nómina (fecha real)<input id="s_np" type="date" value="${S.nextPay}"></label>
  <label>Importe de la nómina (€)<input id="s_pa" inputmode="decimal" value="${String(S.payAmount).replace('.',',')}"></label>
  <button class="btn" data-act="savePay">Editar próxima nómina</button></div>
  <div class="card"><b>Periodo de facturación</b><label>El ciclo empieza…<select id="s_cm">${opt([['first','El día 1 de cada mes'],['last','El último día del mes anterior'],['day','Un día concreto']],S.cycle.mode)}</select></label>
  <label>Día concreto (si procede)<input id="s_cd" type="number" min="1" max="31" value="${S.cycle.day}"></label>
  <label>Saldo mínimo de seguridad (€)<input id="s_ms" inputmode="decimal" value="${String(S.minSafe).replace('.',',')}"></label>
  <label>Tema<select id="s_th">${opt([['auto','Automático'],['light','Claro'],['dark','Oscuro']],S.theme)}</select></label>
  <button class="btn" data-act="saveCfg">Guardar configuración</button></div>
  <h3>Categorías</h3><div class="card">${list(S.cats,'cats')}<button class="btn sec" data-act="addk" data-kind="cats">+ Nueva categoría</button></div>
  <h3>Etiquetas</h3><div class="card">${list(S.tags,'tags')}<button class="btn sec" data-act="addk" data-kind="tags">+ Nueva etiqueta</button></div>
  <h3>Datos</h3><div class="card"><button class="btn" data-act="export">Exportar datos (JSON)</button><button class="btn sec" data-act="import">Importar datos</button><button class="btn red" data-act="wipe">Borrar todos los datos</button><small>Todo se guarda solo en este dispositivo.</small></div>`;
}

/* ---- Formularios ---- */
function expForm(e={}){
  const x=Object.assign({name:'',amount:'',type:'fijo',date:today(),rule:'day',rec:1,cat:S.cats[0]||'',tags:[],variable:''},e);
  const vl=[...new Set(S.exp.map(q=>q.variable).filter(Boolean))];
  sheet(`<h3 style="margin-top:0">${e.id?'Editar':'Nuevo'} gasto</h3>
  <label>Nombre<input id="f_n" value="${esc(x.name)}"></label><label>Cantidad o presupuesto (€)<input id="f_a" inputmode="decimal" value="${esc(String(x.amount).replace('.',','))}"></label>
  <label>Tipo<select id="f_t">${opt([['fijo','Fijo'],['variable','Variable (presupuesto)']],x.type)}</select></label>
  <label>Fecha (primer cobro)<input type="date" id="f_d" value="${x.date}"></label>
  <label>Regla de fecha<select id="f_r">${opt([['day','Mismo día del mes'],['last','Último día del mes'],['first','Primer día del mes']],x.rule)}</select></label>
  <label>Recurrencia<select id="f_c">${opt(Object.entries(REC),x.rec)}</select></label>
  <label>Categoría<select id="f_k">${opt(S.cats.map(c=>[c,c]),x.cat)}</select></label>
  <label>Variable / grupo (opcional)<input id="f_v" list="vl" value="${esc(x.variable)}"><datalist id="vl">${vl.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></label>
  <label>Etiquetas</label><div class="chips">${S.tags.map(t=>`<label class="chip"><input type="checkbox" class="f_g" value="${esc(t)}" ${(x.tags||[]).includes(t)?'checked':''}>${esc(t)}</label>`).join('')}</div>
  <button class="btn" data-act="saveExp" data-id="${e.id||''}">Guardar</button><button class="btn sec" data-act="close">Cancelar</button>`);
}
function realForm(l={}){
  const x=Object.assign({name:'',amt:'',cat:S.cats[0]||'',variable:'',date:today()},l);
  const vl=[...new Set(S.exp.map(q=>q.variable||(q.type==='variable'?q.name:'')).filter(Boolean))];
  sheet(`<h3 style="margin-top:0">${l.id?'Editar':'Registrar'} gasto real</h3>
  <label>Concepto<input id="r_n" value="${esc(x.name)}"></label><label>Importe (€)<input id="r_a" inputmode="decimal" value="${esc(String(x.amt).replace('.',','))}"></label>
  <label>Categoría<select id="r_k">${opt(S.cats.map(c=>[c,c]),x.cat)}</select></label>
  <label>Variable (ej. Supermercado)<input id="r_v" list="rl" value="${esc(x.variable)}"><datalist id="rl">${vl.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></label>
  <label>Fecha<input type="date" id="r_d" value="${x.date}"></label>
  <button class="btn" data-act="saveReal" data-id="${l.id||''}">Guardar (descuenta del saldo)</button><button class="btn sec" data-act="close">Cancelar</button>`);
}

/* ============ 5. EVENTOS ============ */
const v=id=>$('#'+id).value;
document.addEventListener('click',ev=>{
  const nb=ev.target.closest('#nav button'); if(nb){tab=nb.dataset.tab;render();window.scrollTo(0,0);return;}
  const el=ev.target.closest('[data-act]'); if(!el)return;
  const a=el.dataset.act, id=el.dataset.id, ex=S.exp.find(e=>e.id===id), kind=el.dataset.kind, i=+el.dataset.i;
  const k=()=>calc();
  if(a==='close')closeSheet();
  else if(a==='saldo'){S.balance=num(v('bal'));render();}
  else if(a==='newExp')expForm();
  else if(a==='newReal')realForm();
  else if(a==='edit')expForm(ex);
  else if(a==='dup'){const c=Object.assign({},ex,{id:uid(),name:ex.name+' (copia)',tags:[...(ex.tags||[])]});S.exp.push(c);render();expForm(c);}
  else if(a==='del'){if(confirm('¿Eliminar «'+ex.name+'»?')){S.exp=S.exp.filter(e=>e.id!==id);Object.keys(S.paid).forEach(p=>{if(p.startsWith(id+'|'))delete S.paid[p];});render();}}
  else if(a==='pay'){const c=k(),far=c.c.end>c.np?c.c.end:c.np,w=occ(ex,c.c.start,far),un=w.filter(d=>!S.paid[id+'|'+d]);
    if(un.length)S.paid[id+'|'+un[0]]=true; else delete S.paid[id+'|'+w[w.length-1]]; render();}
  else if(a==='saveExp'){
    const n=v('f_n').trim(); if(!n||!v('f_d')){alert('Indica nombre y fecha.');return;}
    const o={id:id||uid(),name:n,amount:num(v('f_a')),type:v('f_t'),date:v('f_d'),rule:v('f_r'),rec:+v('f_c'),cat:v('f_k'),variable:v('f_v').trim(),tags:[...document.querySelectorAll('.f_g:checked')].map(c=>c.value)};
    const ix=S.exp.findIndex(e=>e.id===id); if(ix>=0)S.exp[ix]=o; else S.exp.push(o); closeSheet();render();}
  else if(a==='saveReal'){
    const amt=num(v('r_a')); if(!amt||!v('r_d')){alert('Indica importe y fecha.');return;}
    const o={id:id||uid(),name:v('r_n').trim()||'Gasto',amt,cat:v('r_k'),variable:v('r_v').trim(),date:v('r_d')};
    const ix=S.log.findIndex(l=>l.id===id); if(ix>=0){S.balance+=S.log[ix].amt;S.log[ix]=o;}else S.log.push(o);
    S.balance-=amt; closeSheet();render();}
  else if(a==='undoReal'){const l=S.log.find(x=>x.id===id);if(l&&confirm('¿Deshacer y devolver '+eur(l.amt)+' al saldo?')){S.balance+=l.amt;S.log=S.log.filter(x=>x.id!==id);render();}}
  else if(a==='editReal')realForm(S.log.find(x=>x.id===id));
  else if(a==='savePay'){S.payDay=Math.min(31,Math.max(1,+v('s_pd')||30));if(v('s_np'))S.nextPay=v('s_np');S.payAmount=num(v('s_pa'));render();alert('Nómina guardada.');}
  else if(a==='saveCfg'){S.cycle={mode:v('s_cm'),day:Math.min(31,Math.max(1,+v('s_cd')||1))};S.minSafe=num(v('s_ms'));S.theme=v('s_th');render();alert('Configuración guardada.');}
  else if(a==='addk'){const n=(prompt('Nombre:')||'').trim();if(n&&!S[kind].includes(n)){S[kind].push(n);render();}}
  else if(a==='ren'){const o=S[kind][i],n=(prompt('Nuevo nombre:',o)||'').trim();if(n&&n!==o){S[kind][i]=n;S.exp.forEach(e=>{if(kind==='cats'&&e.cat===o)e.cat=n;if(kind==='tags')e.tags=(e.tags||[]).map(t=>t===o?n:t);});S.log.forEach(l=>{if(kind==='cats'&&l.cat===o)l.cat=n;});render();}}
  else if(a==='rm'){const o=S[kind][i];if(confirm('¿Eliminar «'+o+'»?')){S[kind].splice(i,1);S.exp.forEach(e=>{if(kind==='cats'&&e.cat===o)e.cat='';if(kind==='tags')e.tags=(e.tags||[]).filter(t=>t!==o);});render();}}
  else if(a==='export'){const b=new Blob([JSON.stringify(S,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),l=document.createElement('a');l.href=u;l.download='mi-dinero-'+today()+'.json';document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);}
  else if(a==='import')$('#imp').click();
  else if(a==='wipe'){if(confirm('¿Borrar TODOS los datos? No se puede deshacer.')&&confirm('Confirma de nuevo: se borrará todo.')){S=def();render();}}
});
document.addEventListener('change',ev=>{
  if(ev.target.dataset.f){F[ev.target.dataset.f]=ev.target.value;render();}
  if(ev.target.id==='imp'){const f=ev.target.files[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{try{const d=JSON.parse(r.result);if(!Array.isArray(d.exp))throw 0;S=Object.assign(def(),d);render();alert('Datos importados.');}catch(e){alert('Archivo no válido.');}};r.readAsText(f);ev.target.value='';}
});
document.addEventListener('input',ev=>{ if(ev.target.id==='fq'){F.q=ev.target.value;const p=ev.target.selectionStart;render();const n=$('#fq');n.focus();n.setSelectionRange(p,p);} });
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&tab==='resumen')render(); }); // refresca al volver a abrir (fecha actual)

render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
