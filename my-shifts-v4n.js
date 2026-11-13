/* CuidaGeri | Meus plantoes - consulta apenas do mes corrente.
   Isolado do app.js. Nao disponibiliza campos financeiros nem exportacao.
   A autorizacao de acesso aos dados continua responsabilidade do Supabase/RLS. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.APP_CONFIG || {};
const ready = cfg.supabaseUrl?.startsWith('https://') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('COLE_');
const db = ready ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:'cuidageri-auth'}
}) : null;
const $ = id => document.getElementById(id);
const fmt = iso => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return 'Data não informada';
  const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`;
};
const statuses = {pending:'Pendente', approved:'Aprovado', rejected:'Rejeitado'};
let currentRequest = 0;

function create(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = String(text);
  if (cls) el.className=cls;
  return el;
}
function isVisible() { return !!$('myShifts') && !$('myShifts').hidden; }
function status(message) { if ($('myShiftsStatus')) $('myShiftsStatus').textContent=message; }

async function loadMyShifts() {
  if (!db || !isVisible()) return;
  const request = ++currentRequest;
  const list = $('myShiftsList'); list.replaceChildren();
  status('Consultando seus plantões...');
  try {
    const {data:sessionResult,error:sessionError} = await db.auth.getUser();
    if (sessionError || !sessionResult?.user) throw new Error('Entre com sua conta Google para consultar os plantões.');
    const user = sessionResult.user;
    const {data:profile,error:profileError} = await db.from('care_profiles')
      .select('display_name,role,approved,access_removed_at')
      .eq('id',user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== 'caregiver' || !profile.approved || profile.access_removed_at) {
      throw new Error('Esta consulta está disponível somente para cuidadoras autorizadas.');
    }
    const now = new Date();
    const y=now.getFullYear(), m=String(now.getMonth()+1).padStart(2,'0');
    const start=`${y}-${m}-01`;
    const nextStart = now.getMonth() === 11 ? `${y+1}-01-01` : `${y}-${String(now.getMonth()+2).padStart(2,'0')}-01`;
    const {data:rows,error:shiftError} = await db.from('care_shifts')
      .select('id,caregiver_id,work_date,patient_id,environment,shift_hours,status,start_time,end_time')
      .eq('caregiver_id',user.id).gte('work_date',start).lt('work_date',nextStart)
      .order('work_date',{ascending:false}).limit(200);
    if (shiftError) throw shiftError;
    if (request !== currentRequest || !isVisible()) return;
    const patientIds = [...new Set((rows||[]).map(r=>r.patient_id).filter(Boolean))];
    let names = new Map();
    if (patientIds.length) {
      const {data:patients,error:patientError}=await db.from('care_patients')
        .select('id,name').in('id',patientIds);
      // Falha ou restricao de leitura de pacientes nao libera dados de outra organizacao.
      if (!patientError) names=new Map((patients||[]).map(p=>[p.id,p.name]));
    }
    if (request !== currentRequest || !isVisible()) return;
    status(`Plantões de ${m}/${y} • ${rows.length} registro(s) • somente consulta`);
    if (!rows.length) {
      list.append(create('p','Nenhum plantão disponível para consulta neste mês. Os meses finalizados seguem a regra de visualização única.', 'muted'));
      return;
    }
    const watermark = `${profile.display_name || 'Cuidadora'} • ${user.email || 'Conta Google'}`;
    for (const r of rows) {
      const item=create('article',undefined,'myShiftsItem');
      item.dataset.mark=watermark;
      const head=create('div',undefined,'myShiftsHead');
      head.append(create('strong',fmt(r.work_date)));
      head.append(create('span',statuses[r.status] || r.status || 'Não informado',`myShiftsStatus ${r.status||''}`));
      item.append(head);
      const who=names.get(r.patient_id)||'Paciente autorizado';
      item.append(create('div',`Paciente: ${who}`,'myShiftsInfo'));
      item.append(create('div',`Jornada: ${r.shift_hours || '—'}h • Local: ${r.environment || 'Não informado'}`,'myShiftsInfo'));
      if (r.start_time || r.end_time) item.append(create('div',`Entrada: ${r.start_time || '—'} • Saída: ${r.end_time || '—'}`,'myShiftsInfo'));
      item.append(create('div',watermark,'myShiftsFoot'));
      list.append(item);
    }
  } catch(err) {
    if (request !== currentRequest) return;
    status(`Não foi possível consultar seus plantões: ${err.message || String(err)}`);
  }
}
function start() {
  if (!$('myShifts')) return;
  if (!db) {status('Configuração do Supabase indisponível.');return;}
  document.addEventListener('click',e=>{
    if (e.target.closest('[data-tab="myShifts"]')) {
      // Handler principal altera a aba no mesmo evento.
      queueMicrotask(loadMyShifts);
    }
  });
  $('myShiftsReload')?.addEventListener('click',loadMyShifts);
  db.auth.onAuthStateChange(()=>{ currentRequest++; });
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
