/* CuidaGeri | Etapa 4O: pedidos de ajuste, sem alterar o app.js. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.APP_CONFIG||{};
const db=(cfg.supabaseUrl?.startsWith('https://') && cfg.supabaseAnonKey)
 ? createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'cuidageri-auth'}}):null;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label={requested:'Aguardando cuidadora',submitted:'Aguardando administração',approved:'Ajuste aprovado',rejected:'Ajuste rejeitado'};
let user=null,admin=false,all=[],requests=[],patients=[],busy=false,seq=0;
const money=v=>Number(v||0).toFixed(2);
const err= e => alert(e?.message||String(e));
const toDate=d=>String(d||'').split('-').reverse().join('/');
function button(t,fn,cls='') {const b=document.createElement('button');b.type='button';b.className='small '+cls;b.textContent=t;b.addEventListener('click',fn);return b;}
function text(t){const p=document.createElement('p');p.textContent=t;return p;}
function field(l,v,type='text') {const d=document.createElement('label');d.className='cgAdjField';d.textContent=l;const inp=document.createElement('input');inp.type=type;inp.value=v??'';if(type==='number'){inp.step='0.01';inp.min='0'}d.append(inp);return {d,inp};}
function selectField(l,value,options) {const d=document.createElement('label');d.className='cgAdjField';d.textContent=l;const e=document.createElement('select');for(const [v,t] of options){const o=document.createElement('option');o.value=v;o.textContent=t;e.append(o);}e.value=String(value||'');d.append(e);return {d,inp:e};}
function textarea(l,value=''){const d=document.createElement('label');d.className='cgAdjField';d.textContent=l;const t=document.createElement('textarea');t.value=value??'';t.rows=3;d.append(t);return {d,inp:t};}
function mkCard(title,subtitle){const c=document.createElement('div');c.className='cgAdjCard';const h=document.createElement('strong');h.textContent=title;c.append(h);if(subtitle){const p=text(subtitle);p.className='muted';c.append(p)}return c;}
async function rpc(name,payload){const {data,error}=await db.rpc(name,payload);if(error)throw error;return data;}
async function getData(){
 const {data:u,error:e}=await db.auth.getUser();if(e||!u?.user)return false;user=u.user;
 const {data:p,error:pe}=await db.from('care_profiles').select('role,approved,access_removed_at').eq('id',user.id).maybeSingle();
 if(pe||!p?.approved||p.access_removed_at)return false;admin=p.role==='admin';
 const {data:req,error:re}=await db.rpc('care_shift_adj_list_v4o',{});if(re)throw re;requests=req||[];
 if(admin){const {data:sh,error:se}=await db.from('care_shifts').select('id,work_date,patient_id,caregiver_name,caregiver_id,environment,shift_hours,caregiver_type,shift_kind,status,organization_id').order('work_date',{ascending:false}).limit(1000);if(se)throw se;all=sh||[];}
 const {data:pa,error:pae}=await db.from('care_patients').select('id,name,organization_id').eq('active',true).order('name');if(!pae)patients=pa||[];
 return true;
}
function safeButtonRequest(shift){
 return button('Solicitar ajuste',async()=>{
  const instruction=prompt(`Descreva o que ${shift.caregiver_name} precisa corrigir no plantão de ${toDate(shift.work_date)}:`);
  if(instruction===null)return;
  if(instruction.trim().length<5){alert('Descreva o ajuste com pelo menos 5 caracteres.');return;}
  if(!confirm(`Enviar solicitação de ajuste para ${shift.caregiver_name}?\nNão alterará o plantão até sua aprovação.`))return;
  try{await rpc('care_shift_adj_request_v4o',{p_shift_id:shift.id,p_instruction:instruction.trim()});await load(true);alert('Solicitação enviada. O pagamento desse plantão fica bloqueado até a decisão.');}catch(e){err(e)}
 },'light');
}
function attachHistoryButtons(){
 const host=$('historyList');if(!host||!admin)return;
 const cards=[...host.children].filter(x=>x.classList.contains('record'));
 const openIds=new Set(requests.filter(r=>['requested','submitted'].includes(r.status)).map(r=>r.shift_id));
 for(const card of cards){if(card.dataset.cgAdjBound)continue;
  // O app legado não expõe IDs no HTML: só adicionamos botão em correspondência inequívoca.
  const head=card.querySelector('.recordHead');const meta=card.querySelector('.recordMeta');if(!head||!meta)continue;
  const line=head.textContent||'';const date=line.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const matches=all.filter(s=>s.work_date===date && line.includes(s.caregiver_name)
    && meta.textContent.includes((patients.find(p=>p.id===s.patient_id)||{}).name||'\u0000')
    && meta.textContent.includes(`${s.shift_hours}h`));
  if(matches.length!==1)continue;
  card.dataset.cgAdjBound='1';const shift=matches[0];
  const actions=document.createElement('div');actions.className='rowActions';
  if(openIds.has(shift.id))actions.append(text('Há um ajuste em andamento para este plantão.'));
  else actions.append(safeButtonRequest(shift));card.append(actions);
 }
}
function renderAdmin(){
 const host=$('cgAdjustAdmin');if(!host)return;host.replaceChildren();
 const head=document.createElement('h3');head.textContent='Solicitações de ajuste';host.append(head);
 const submitted=requests.filter(r=>r.status==='submitted');
 if(!submitted.length)host.append(text('Nenhuma resposta de cuidadora aguardando análise.'));
 for(const r of submitted){
  const card=mkCard(`${r.caregiver_name} • ${toDate(r.work_date)}`,`Pedido: ${r.instruction}\nResposta: ${r.caregiver_explanation||'Sem comentário'}`);
  const summary=text(`Proposta: ${toDate(r.proposed_work_date)} • ${patients.find(p=>p.id===r.proposed_patient_id)?.name||'Paciente'} • ${r.proposed_environment} • ${r.proposed_shift_hours}h • ${r.proposed_caregiver_type} • ${r.proposed_shift_kind}`);card.append(summary);
  if(r.proposed_notes)card.append(text(`Observações: ${r.proposed_notes}`));
  const inputs={};const fwrap=document.createElement('div');fwrap.className='cgAdjGrid';
  for(const [key,l] of [['rate','Diária (R$)'],['transport','Transporte (R$)'],['meals','Alimentação (R$)'],['other_costs','Outras despesas (R$)']]){const f=field(l,money(r[key]),'number');fwrap.append(f.d);inputs[key]=f.inp;}card.append(fwrap);
  const actions=document.createElement('div');actions.className='rowActions';
  actions.append(button('Aprovar ajuste',async()=>{
   const params={p_request_id:r.id,p_decision:'approve',p_review_note:'Ajuste aprovado pela administração.'};
   for(const k of Object.keys(inputs)){const n=Number(inputs[k].value);if(!Number.isFinite(n)||n<0){alert('Confira os valores financeiros.');return;}params['p_'+k]=n;}
   if(!confirm('Aprovar as informações e os valores acima? Isso atualizará o plantão e seu financeiro.'))return;
   try{await rpc('care_shift_adj_review_v4o',params);await load(true);alert('Ajuste aprovado. Atualize o dashboard para conferir os valores.')}catch(e){err(e)}
  }));
  for(const [action,caption] of [['reject','Rejeitar ajuste'],['request_again','Solicitar novo ajuste']])actions.append(button(caption,async()=>{
   const note=prompt('Informe o motivo para a cuidadora:');if(note===null)return;if(note.trim().length<5){alert('Informe o motivo.');return;}
   try{await rpc('care_shift_adj_review_v4o',{p_request_id:r.id,p_decision:action,p_review_note:note.trim()});await load(true)}catch(e){err(e)}
  },'light'));
  card.append(actions);host.append(card);
 }
}
function renderCaregiver(){
 const host=$('cgAdjustCaregiver');if(!host||admin)return;host.replaceChildren();
 const head=document.createElement('h3');head.textContent='Ajustes solicitados pela administração';host.append(head);
 const mine=requests.filter(r=>r.caregiver_id===user?.id);
 if(!mine.length)host.append(text('Nenhuma solicitação de ajuste para seus plantões.'));
 for(const r of mine){
  const card=mkCard(`${toDate(r.work_date)} • ${label[r.status]||r.status}`,r.instruction);
  if(r.status==='submitted')card.append(text('Sua resposta foi enviada para a administração.'));
  if(r.status==='approved'||r.status==='rejected')card.append(text(r.review_note||'Solicitação concluída.'));
  if(r.status==='requested'){
   const inputs={};const wrap=document.createElement('div');wrap.className='cgAdjGrid';
   const date=field('Data',r.work_date,'date');wrap.append(date.d);inputs.work_date=date.inp;
   const pat=selectField('Paciente',r.patient_id,patients.map(p=>[p.id,p.name]));wrap.append(pat.d);inputs.patient_id=pat.inp;
   const env=selectField('Local',r.environment,[['Residência','Residência'],['Hospital','Hospital'],['Outro','Outro']]);wrap.append(env.d);inputs.environment=env.inp;
   const hours=selectField('Horas',r.shift_hours,[['12','12 horas'],['24','24 horas']]);wrap.append(hours.d);inputs.shift_hours=hours.inp;
   const type=selectField('Modalidade',r.caregiver_type,[['recorrente','Recorrente'],['avulsa','Avulsa']]);wrap.append(type.d);inputs.caregiver_type=type.inp;
   const kind=selectField('Tipo de plantão',r.shift_kind,[['Normal','Normal'],['Extra','Extra'],['Avulso','Avulso'],['Familiar','Familiar']]);wrap.append(kind.d);inputs.shift_kind=kind.inp;
   const notes=textarea('Observações',r.notes);wrap.append(notes.d);inputs.notes=notes.inp;
   const explanation=textarea('O que foi corrigido? (obrigatório)','');wrap.append(explanation.d);inputs.explanation=explanation.inp;
   card.append(wrap);card.append(button('Enviar correção para análise',async()=>{
    const params={p_request_id:r.id,p_work_date:inputs.work_date.value,p_patient_id:inputs.patient_id.value,p_environment:inputs.environment.value,p_shift_hours:Number(inputs.shift_hours.value),p_caregiver_type:inputs.caregiver_type.value,p_shift_kind:inputs.shift_kind.value,p_notes:inputs.notes.value,p_explanation:inputs.explanation.value};
    if(params.p_explanation.trim().length<5){alert('Explique o que foi corrigido.');return;}
    if(!confirm('Enviar esses dados para avaliação administrativa?'))return;
    try{await rpc('care_shift_adj_submit_v4o',params);await load(true);alert('Enviado para análise. Os dados do plantão não foram alterados ainda.')}catch(e){err(e)}
   }));
  }
  host.append(card);
 }
}
async function load(force){
 if(!db||busy)return;busy=true;const n=++seq;
 try{const ready=await getData();if(!ready)return;if(n!==seq)return;
  if(admin){renderAdmin();attachHistoryButtons()}else renderCaregiver();
 }catch(e){const target=admin?$('cgAdjustAdmin'):$('cgAdjustCaregiver');if(target){target.replaceChildren();target.append(text(`Não foi possível carregar os ajustes: ${e.message||String(e)}`));}}
 finally{busy=false;}
}
function boot(){if(!$('cgAdjustAdmin')||!$('cgAdjustCaregiver'))return;
 document.addEventListener('click',e=>{if(e.target.closest('[data-tab="history"],[data-tab="myShifts"]'))setTimeout(()=>load(true),120)});
 const list=$('historyList');if(list){const obs=new MutationObserver(()=>{if(admin&&!busy)setTimeout(attachHistoryButtons,0)});obs.observe(list,{childList:true});}
 db?.auth.onAuthStateChange(()=>{setTimeout(()=>load(true),200)});
 setTimeout(()=>load(true),450);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
