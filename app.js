// CuidaGeri cadastro v2.5.1 - nome + celular + senha, sem registerEmail
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.APP_CONFIG||{};
const ok=cfg.supabaseUrl?.startsWith('https://') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('COLE_');
const $=id=>document.getElementById(id), money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,session,patients=[],shifts=[],payments=[],profiles=[],invitedPeople=[];
let recoveringPassword=false,confirmationEmail="",signupCaptchaWidget=null;
const isAdmin=()=>profile?.role==='admin'&&profile?.approved===true&&!profile?.access_removed_at;
const inviteToken=()=>new URLSearchParams(location.search).get('convite')||'';
const googleLogin=async()=>{const {error}=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:'select_account'}}});if(error)throw error;};
const phoneBR=s=>{let n=String(s||'').replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(!n.startsWith('55'))n='55'+n;return /^55\d{10,11}$/.test(n)?'+'+n:null};
// Identificador técnico do Auth: não é um e-mail pessoal e não deve receber mensagens.
const caregiverAuthEmail=phone=>phone.replace(/\D/g,'')+'@accounts.cuidageri.example.com';
const isTechnicalEmail=e=>!e||e.endsWith('@accounts.cuidageri.example.com');
const INVOKE='cuidageri-convites';
async function inviteRequest(action,payload={},authorization){const headers={'Content-Type':'application/json','apikey':cfg.supabaseAnonKey};if(authorization)headers.Authorization='Bearer '+authorization;const r=await fetch(cfg.supabaseUrl+'/functions/v1/'+INVOKE,{method:'POST',headers,body:JSON.stringify({action,...payload})});const data=await r.json().catch(()=>({}));if(!r.ok||data.error)throw Error(data.error||'Não foi possível completar a operação.');return data;}
function notice(message){$('notice').textContent=message;$('notice').style.display='block';setTimeout(()=>$('notice').style.display='none',4500)}
function fail(e){notice(e?.message||String(e))}
function working(fn){return async ev=>{try{ev?.preventDefault?.();await fn(ev)}catch(e){fail(e)}}}
function caregiverTypeLabel(t){return t==='avulsa'?'Avulsa':t==='recorrente'?'Recorrente':'Não informado'}
function statusLabel(s){return {pending:'Pendente',approved:'Aprovado',rejected:'Rejeitado'}[s]||s}
const total=s=>Number(s.rate||0)+Number(s.transport||0)+Number(s.meals||0)+Number(s.other_costs||0);
const paid=id=>payments.filter(p=>p.shift_id===id).reduce((t,p)=>t+Number(p.amount),0);
function parseCSVLine(line){const out=[];let cur='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===','&&!quote){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}
function csvExport(filename,rows){if(!rows.length)return notice('Não há registros para exportar.');const keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const content='\uFEFF'+keys.join(';')+'\r\n'+rows.map(r=>keys.map(k=>cell(r[k])).join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
async function refresh(){const admin=isAdmin();const queries=[db.from('care_patients').select('*').eq('active',true).order('name'),db.from('care_shifts').select(admin?'*':'id,caregiver_id,work_date,patient_id,status').order('work_date',{ascending:false}).limit(1000)];if(admin)queries.push(db.from('care_payments').select('*'),db.from('care_profiles').select('*').order('display_name'),db.from('care_phone_invites').select('id,display_name,phone_e164,status,expires_at,created_at').order('created_at',{ascending:false}));const results=await Promise.all(queries);for(const x of results)if(x.error)throw x.error;patients=results[0].data;shifts=results[1].data||[];payments=admin?(results[2].data||[]):[];profiles=admin?(results[3].data||[]):[];invitedPeople=admin?(results[4].data||[]):[];$('patient').innerHTML=patients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');render()}
// Tarifas iniciais sugeridas somente no painel administrativo. A aprovadora pode editá-las.
function suggestedRate(s){
  if(s.caregiver_type!=='avulsa')return Number(s.rate||0);
  if(Number(s.rate)>0)return Number(s.rate);
  if(s.environment==='Hospital'&&Number(s.shift_hours)===24)return 300;
  if(s.environment==='Hospital'&&Number(s.shift_hours)===12)return 150;
  if(s.environment==='Residência'&&Number(s.shift_hours)===24)return 200;
  return 0;
}
function casualRecords(){const month=$('financeMonth').value,person=$('financeCaregiver').value;
 return shifts.filter(s=>s.caregiver_type==='avulsa'&&s.status==='approved'&&(!month||s.work_date.startsWith(month))&&(!person||s.caregiver_name===person));}
function avulsaRows(){return casualRecords().map(s=>({id:s.id,data:s.work_date,cuidadora:s.caregiver_name,paciente:patients.find(p=>p.id===s.patient_id)?.name||'',local:s.environment,jornada_horas:s.shift_hours,tipo:s.shift_kind,diaria:Number(s.rate||0),transporte:Number(s.transport||0),alimentacao:Number(s.meals||0),outras_despesas:Number(s.other_costs||0),total_devido:total(s),total_pago:paid(s.id),saldo:Math.max(0,total(s)-paid(s.id)),situacao:total(s)-paid(s.id)<0.005?'Quitado':'A pagar'}));}
function renderAvulsas(){
 const all=shifts.filter(s=>s.caregiver_type==='avulsa'&&s.status==='approved');
 const names=[...new Set(all.map(s=>s.caregiver_name))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const selected=$('financeCaregiver').value;
 $('financeCaregiver').innerHTML='<option value="">Todas as avulsas</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
 $('financeCaregiver').value=names.includes(selected)?selected:'';
 const rows=avulsaRows(); const group=new Map();
 for(const x of rows){if(!group.has(x.cuidadora))group.set(x.cuidadora,[]);group.get(x.cuidadora).push(x)}
 const sum=(list,key)=>list.reduce((a,x)=>a+Number(x[key]||0),0);
 const due=sum(rows,'total_devido'),payed=sum(rows,'total_pago'),balance=sum(rows,'saldo');
 const pending=shifts.filter(s=>s.caregiver_type==='avulsa'&&s.status==='pending'&&(!$('financeMonth').value||s.work_date.startsWith($('financeMonth').value))&&(!$('financeCaregiver').value||s.caregiver_name===$('financeCaregiver').value)).length;
 $('casualSummary').innerHTML=`<div class="stats"><div class="stat"><small>Avulsas aprovadas</small><b>${money(due)}</b></div><div class="stat"><small>Já pago</small><b>${money(payed)}</b></div><div class="stat"><small>A pagar</small><b>${money(balance)}</b></div></div><p class="muted">${pending} lançamento(s) de avulsas aguardando aprovação — ainda sem valor liberado.</p>`+
 ([...group.entries()].map(([name,list])=>`<div class="casualGroup"><div class="groupHead"><strong>${esc(name)}</strong><span>A pagar: <b>${money(sum(list,'saldo'))}</b></span></div><div class="tableScroll"><table class="detailTable"><thead><tr><th>Data / Jornada</th><th>Local</th><th>Diária</th><th>Transporte</th><th>Alimentação</th><th>Outros</th><th>Total</th><th>Pago</th><th>Saldo</th><th>Ação</th></tr></thead><tbody>${list.map(x=>`<tr><td>${esc(x.data)}<br><small>${esc(x.jornada_horas)}h · ${esc(x.paciente)}</small></td><td>${esc(x.local)}</td><td>${money(x.diaria)}</td><td>${money(x.transporte)}</td><td>${money(x.alimentacao)}</td><td>${money(x.outras_despesas)}</td><td>${money(x.total_devido)}</td><td>${money(x.total_pago)}</td><td><b>${money(x.saldo)}</b></td><td>${x.saldo>0.005?`<button class="small" data-action="payment" data-id="${esc(x.id)}">Pagar</button>`:'Quitado'}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">Total de ${esc(name)}</td><td>${money(sum(list,'diaria'))}</td><td>${money(sum(list,'transporte'))}</td><td>${money(sum(list,'alimentacao'))}</td><td>${money(sum(list,'outras_despesas'))}</td><td>${money(sum(list,'total_devido'))}</td><td>${money(sum(list,'total_pago'))}</td><td>${money(sum(list,'saldo'))}</td><td></td></tr></tfoot></table></div></div>`).join('')||'<p class="muted">Nenhum plantão avulso aprovado para os filtros escolhidos.</p>');
}

// Dashboard administrativo: agregações a partir dos plantões efetivamente cadastrados.
function renderDashboard(){
 if(!isAdmin())return;
 const start=$('dashboardStart').value,end=$('dashboardEnd').value;
 const caregiver=$('dashboardCaregiver').value,patient=$('dashboardPatient').value;
 const caregiverNames=[...new Set(shifts.map(s=>s.caregiver_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 $('dashboardCaregiver').innerHTML='<option value="">Todas as cuidadoras</option>'+caregiverNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
 $('dashboardCaregiver').value=caregiverNames.includes(caregiver)?caregiver:'';
 const names=patients.map(p=>({id:p.id,name:p.name}));
 $('dashboardPatient').innerHTML='<option value="">Todos os pacientes</option>'+names.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
 $('dashboardPatient').value=names.some(p=>p.id===patient)?patient:'';
 const rows=shifts.filter(s=>(!start||s.work_date>=start)&&(!end||s.work_date<=end)&&(!caregiver||s.caregiver_name===caregiver)&&(!patient||s.patient_id===patient));
 const approved=rows.filter(s=>s.status==='approved');
 const sumDue=approved.reduce((a,s)=>a+total(s),0);
 const sumPaid=approved.reduce((a,s)=>a+paid(s.id),0);
 const days=new Set(rows.map(s=>s.work_date));
 const caregivers=new Set(rows.map(s=>s.caregiver_id));
 $('dashboardMetrics').innerHTML=`<div class="kpi"><small>Dias com plantões</small><b>${days.size}</b></div><div class="kpi"><small>Plantões cadastrados</small><b>${rows.length}</b><small>${rows.filter(s=>s.status==='pending').length} pendente(s)</small></div><div class="kpi"><small>Cuidadoras</small><b>${caregivers.size}</b></div><div class="kpi"><small>Valor aprovado</small><b>${money(sumDue)}</b></div><div class="kpi"><small>Pago</small><b>${money(sumPaid)}</b></div><div class="kpi"><small>Saldo a pagar</small><b>${money(Math.max(0,sumDue-sumPaid))}</b></div>`;
 const groups=new Map();
 for(const s of rows){if(!groups.has(s.work_date))groups.set(s.work_date,[]);groups.get(s.work_date).push(s)}
 const dateBR=d=>d?.split('-').reverse().join('/')||'';
 $('dashboardDays').innerHTML=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,items])=>`<details class="dashboardDay"><summary><strong>${esc(dateBR(date))}</strong><span>${items.length} plantão(ões) · ${new Set(items.map(x=>x.caregiver_id)).size} cuidadora(s)</span><b>${money(items.filter(x=>x.status==='approved').reduce((a,x)=>a+total(x),0))}</b></summary><div class="dashboardDayBody">${items.map(s=>`<div><b>${esc(s.caregiver_name||'Sem nome')}</b> — ${esc(patients.find(p=>p.id===s.patient_id)?.name||'Paciente')} · ${esc(s.environment||'')} · ${esc(s.shift_hours)}h <span class="pill ${esc(s.status)}">${statusLabel(s.status)}</span></div>`).join('')}</div></details>`).join('')||'<p class="muted">Nenhum plantão registrado no período selecionado.</p>';
 const byPerson=new Map();
 for(const s of rows){const key=s.caregiver_id||s.caregiver_name;const r=byPerson.get(key)||{name:s.caregiver_name||'Sem nome',count:0,pending:0,due:0,paid:0};r.count++;if(s.status==='pending')r.pending++;if(s.status==='approved'){r.due+=total(s);r.paid+=paid(s.id)}byPerson.set(key,r)}
 $('dashboardPeople').innerHTML=[...byPerson.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(r=>`<div class="dashboardPerson"><div><strong>${esc(r.name)}</strong><small>${r.count} plantão(ões) · ${r.pending} pendente(s)</small></div><div><b>${money(r.due)}</b><small>Pago: ${money(r.paid)} · Saldo: ${money(Math.max(0,r.due-r.paid))}</small></div></div>`).join('')||'<p class="muted">Nenhuma cuidadora no período.</p>';
 $('dashboardDetails').innerHTML=rows.length?`<div class="tableScroll"><table class="detailTable dashboardTable"><thead><tr><th>Data</th><th>Cuidadora</th><th>Paciente</th><th>Ambiente</th><th>Horas</th><th>Status</th><th>Aprovado</th><th>Pago</th><th>Saldo</th></tr></thead><tbody>${[...rows].sort((a,b)=>b.work_date.localeCompare(a.work_date)).map(s=>`<tr><td>${esc(dateBR(s.work_date))}</td><td>${esc(s.caregiver_name)}</td><td>${esc(patients.find(p=>p.id===s.patient_id)?.name||'')}</td><td>${esc(s.environment)}</td><td>${esc(s.shift_hours)}h</td><td>${statusLabel(s.status)}</td><td>${s.status==='approved'?money(total(s)):'—'}</td><td>${s.status==='approved'?money(paid(s.id)):'—'}</td><td>${s.status==='approved'?money(Math.max(0,total(s)-paid(s.id))):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Sem registros no período selecionado.</p>';
}

function render(){const admin=isAdmin();
if(admin){const mine=shifts;
$('historyList').innerHTML=mine.length?mine.map(s=>`<div class="record"><div class="recordHead"><span>${esc(s.work_date)} · ${esc(s.caregiver_name)}</span><span class="pill ${s.status}">${statusLabel(s.status)}</span></div><div class="recordMeta">${esc(patients.find(p=>p.id===s.patient_id)?.name||'Paciente')} · ${esc(s.environment)} · ${esc(s.shift_hours)}h · ${esc(s.shift_kind)} · ${caregiverTypeLabel(s.caregiver_type)}${s.notes?'<br>'+esc(s.notes):''}<br>Total: ${money(total(s))} · Pago: ${money(paid(s.id))}</div></div>`).join(''):'<p class="muted">Nenhum plantão registrado.</p>';}
if(!admin)return;
renderDashboard();
$('reviewList').innerHTML=shifts.filter(s=>s.status==='pending').map(s=>`<div class="record" data-id="${esc(s.id)}"><div class="recordHead"><span>${esc(s.caregiver_name)} · ${esc(s.work_date)}</span><span class="pill">Pendente</span></div><div class="recordMeta">${esc(patients.find(p=>p.id===s.patient_id)?.name||'')} · ${esc(s.environment)} · ${esc(s.shift_hours)}h · ${esc(s.shift_kind)} · <b>${caregiverTypeLabel(s.caregiver_type)}</b><br>${esc(s.notes)}</div><label class="review-type">Modalidade confirmada<select data-field="caregiver_type"><option value="avulsa" ${s.caregiver_type==='avulsa'?'selected':''}>Avulsa</option><option value="recorrente" ${s.caregiver_type==='recorrente'?'selected':''}>Recorrente</option></select></label><div class="twocol"><label>Diária (R$)<input data-field="rate" type="number" min="0" step="0.01" value="${Number(s.rate)>0?s.rate:suggestedRate(s)}"></label><label>Transporte (R$)<input data-field="transport" type="number" min="0" step="0.01" value="${s.transport}"></label><label>Alimentação (R$)<input data-field="meals" type="number" min="0" step="0.01" value="${s.meals}"></label><label>Outras despesas (R$)<input data-field="other_costs" type="number" min="0" step="0.01" value="${s.other_costs}"></label></div><div class="rowActions"><button data-action="approve" data-id="${esc(s.id)}">Aprovar</button><button class="light" data-action="reject" data-id="${esc(s.id)}">Rejeitar</button></div></div>`).join('')||'<p class="muted">Nenhum plantão aguardando aprovação.</p>';
const active=shifts.filter(s=>s.status==='approved');const due=active.reduce((t,s)=>t+total(s),0), transferred=payments.reduce((t,p)=>t+Number(p.amount),0);
$('financeSummary').innerHTML=`<div class="stat"><small>Valor aprovado</small><b>${money(due)}</b></div><div class="stat"><small>Registrado como pago</small><b>${money(transferred)}</b></div><div class="stat"><small>Saldo aprovado</small><b>${money(due-transferred)}</b></div>`;
renderAvulsas();
$('financeList').innerHTML=active.filter(s=>s.caregiver_type!=='avulsa').map(s=>`<div class="record"><div class="recordHead"><span>${esc(s.caregiver_name)} · ${esc(s.work_date)}</span><span>${money(Math.max(0,total(s)-paid(s.id)))}</span></div><div class="recordMeta">Devido: ${money(total(s))} · Pago: ${money(paid(s.id))} · ${esc(s.environment)}</div><div class="rowActions">${total(s)-paid(s.id)>0.005?`<button class="small" data-action="payment" data-id="${esc(s.id)}">Registrar pagamento</button>`:"Quitado"}</div></div>`).join('')||'<p class="muted">Sem plantões aprovados.</p>';
$('accessList').innerHTML=profiles.filter(p=>!p.access_removed_at).map(p=>`<div class="record"><div class="recordHead"><span>${esc(p.display_name||'(sem nome)')}</span><span class="pill ${p.approved?'approved':''}">${p.approved?'Liberado':'Aguardando liberação'}</span></div><div class="recordMeta">${esc(p.role==='admin'?'Administradora':'Cuidadora')} · ${esc(p.id===session.user.id?'Sua conta':(p.email||'Conta vinculada'))}</div>${p.id!==session.user.id?`<div class="rowActions"><button data-action="access" data-id="${esc(p.id)}" data-value="${p.approved?'false':'true'}" class="${p.approved?'light':''}">${p.approved?'Suspender':'Liberar'}</button><button class="dangerBtn" data-action="remove-access" data-id="${esc(p.id)}" data-name="${esc(p.display_name)}">Excluir acesso</button></div>`:'<small class="muted">Sua conta administradora não pode ser excluída por este painel.</small>'}</div>`).join('')||'<p class="muted">Nenhuma conta cadastrada.</p>';
$('removedAccessList').innerHTML=profiles.filter(p=>p.access_removed_at).map(p=>`<div class="record"><div class="recordHead"><span>${esc(p.display_name||'(sem nome)')}</span><span class="pill rejected">Acesso removido</span></div><div class="recordMeta">Histórico preservado · ${esc(p.access_removed_at?.slice(0,10)||'')}</div><div class="rowActions"><button class="light small" data-action="restore-access" data-id="${esc(p.id)}">Restaurar acesso</button></div></div>`).join('')||'<p class="muted">Nenhum acesso removido.</p>';
$('invitedList').innerHTML=invitedPeople.filter(p=>p.status==='pending').map(p=>`<div class="record"><div class="recordHead"><span>${esc(p.display_name)}</span><span class="pill">Aguardando ativação</span></div><div class="recordMeta">${esc(p.phone_e164)} · Válido até ${esc(new Date(p.expires_at).toLocaleString('pt-BR'))}</div><div class="rowActions"><button class="small" data-action="reissue-invite" data-id="${esc(p.id)}">Gerar novo link</button><button class="dangerBtn small" data-action="cancel-invite" data-id="${esc(p.id)}">Cancelar convite</button></div></div>`).join('')||'<p class="muted">Nenhum convite pendente.</p>';
}
async function boot(){
 const {data,error}=await db.auth.getSession();if(error)throw error;session=data.session;
 $('setup').hidden=true;
 $('recoverySetup').hidden=true;
 $('auth').hidden=!!session;
 $('app').hidden=true;
 for(const id of ['loginView','registerView','invitePasswordView','forgotView','resetView','confirmationNotice','googleProfileView'])$(id).hidden=true;
 $('loginView').hidden=!!session;
 if(!session){profile=null;return;}
 const {data:p,error:e}=await db.from('care_profiles').select('*').eq('id',session.user.id).single();
 if(e)throw Error('Não foi possível consultar seu perfil. Verifique se a função de cadastro está ativa no Supabase. '+e.message);
 profile=p;
 // New Google caregiver accounts have no phone until completing the simple first-login form.
 if(p.role!=='admin'&&(!p.phone_e164||!p.display_name?.trim())){
   $('auth').hidden=false;
   $('loginView').hidden=true;
   $('googleProfileView').hidden=false;
   $('googleName').value=p.display_name||session.user.user_metadata?.full_name||session.user.user_metadata?.name||'';
   return;
 }
 $('app').hidden=false;
 $('welcome').textContent=`Olá, ${p.display_name||'cuidadora'}!`;
 $('roleBadge').hidden=false;
 $('roleBadge').textContent=p.role==='admin'?'Administração':'Cuidadora';
 $('accessInfo').textContent=p.role==='admin'?'Confira e aprove os plantões enviados.':'Registre seus próprios plantões para conferência.';
 $('pendingAccess').hidden=!!(p.approved&&!p.access_removed_at);
 $('authorized').hidden=!(p.approved&&!p.access_removed_at);
 if(p.approved&&!p.access_removed_at){
   document.querySelectorAll('.adminOnly').forEach(el=>el.hidden=p.role!=='admin');
   document.querySelectorAll('.caregiverOnly').forEach(el=>el.hidden=p.role==='admin');
   showTab(p.role==='admin'?'dashboard':'new');
   $('monthHistory').hidden=true;$('monthHistory').innerHTML='';await refresh();
 }
}
function showTab(id){if(id!=='closeMonth'){$('monthHistory').innerHTML='';$('monthHistory').hidden=true;}document.querySelectorAll('.pane').forEach(el=>el.hidden=el.id!==id);document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===id))}
if(!ok){$('setup').hidden=false;$('auth').hidden=true}else{
 db=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'cuidageri-auth'}});
 db.auth.onAuthStateChange(()=>{setTimeout(()=>boot().catch(fail),0);});
 boot().catch(fail);
}
$('googleLoginBtn').addEventListener('click',working(googleLogin));
$('googleProfileForm').addEventListener('submit',working(async()=>{
 const name=$('googleName').value.trim(),phone=phoneBR($('googlePhone').value);
 if(name.length<2||name.length>120||!phone)throw Error('Informe seu nome e WhatsApp com DDD.');
 const {error}=await db.rpc('care_complete_google_signup',{p_display_name:name,p_phone:phone});
 if(error)throw Error(error.message||'Não foi possível concluir seu cadastro.');
 notice('Cadastro concluído! Você já pode registrar suas diárias.');await boot();
}));
$('googleProfileLogout').addEventListener('click',working(async()=>{await db.auth.signOut();await boot()}));
$('linkGoogleAdmin').addEventListener('click',working(async()=>{
 if(!isAdmin())throw Error('Somente a administradora pode vincular o Google.');
 if(!confirm('Vincular sua conta Google a este mesmo usuário administrador? Escolha sua conta Google pessoal na próxima tela.'))return;
 const {data,error}=await db.auth.linkIdentity({provider:'google',options:{redirectTo:location.origin+location.pathname}});
 if(error)throw error;
 if(data?.url)location.assign(data.url);
}));
let activatingInvite=false;
$('invitePasswordForm').addEventListener('submit',working(async()=>{
 if(activatingInvite)return;activatingInvite=true;
 const button=$('invitePasswordForm').querySelector('button[type=submit]');button.disabled=true;
 try{
  const phone=phoneBR($('invitePhoneConfirm').value),name=$('inviteNameConfirm').value.trim(),password=$('invitePassword').value;
  if(!phone||name.length<2||name.length>120)throw Error('Informe nome e celular válidos.');
  if(password.length<6||password!==$('invitePasswordConfirm').value)throw Error('Senha com no mínimo 6 caracteres e confirmação idêntica.');
  const res=await inviteRequest('redeem',{token:inviteToken(),name,phone,password});
  history.replaceState(null,'',location.pathname);
  const login=await inviteRequest('login',{phone,password});
  const {error}=await db.auth.setSession({access_token:login.access_token,refresh_token:login.refresh_token});if(error)throw error;
  $('invitePassword').value='';$('invitePasswordConfirm').value='';notice('Conta ativada. Cadastre seu e-mail de recuperação.');await boot();
 }finally{activatingInvite=false;button.disabled=false;}
}));
$('copyGeneratedInvite').addEventListener('click',working(async()=>{await navigator.clipboard.writeText($('generatedInviteText').value);notice('Convite copiado.');}));
function showInvitation(name,phone,url){
 $('generatedInvite').hidden=false;
 $('generatedInviteText').dataset.phone=phone;
 $('generatedInviteText').value=`Olá, ${name}! Você foi convidada para o CuidaGeri. Abra o seu link individual para criar uma senha e acessar seus plantões:\n${url}\nO link expira em 48 horas e funciona uma única vez. Não encaminhe.`;
 $('generatedInvite').scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('shareGeneratedInvite').addEventListener('click',()=>{const text=$('generatedInviteText').value,phone=$('generatedInviteText').dataset.phone;if(text&&phone)window.open('https://wa.me/'+phone.replace(/\D/g,'')+'?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');});
$('loginMethod').value='phone';$('loginMethod').addEventListener('change',()=>{$('loginEmailField').hidden=$('loginMethod').value==='phone';$('loginPhoneField').hidden=$('loginMethod').value!=='phone'});
$('authForm').addEventListener('submit',working(async()=>{let input; if($('loginMethod').value==='phone'){const phone=phoneBR($('loginPhone').value);if(!phone)throw Error('Informe o celular com DDD.');const data=await inviteRequest('login',{phone,password:$('password').value});const {error}=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});if(error)throw error;}else{input={email:$('email').value.trim(),password:$('password').value};const {error}=await db.auth.signInWithPassword(input);if(error)throw Error('E-mail ou senha incorretos.');}await boot()}));
$('showRegister').addEventListener('click',()=>{$('loginView').hidden=true;$('forgotView').hidden=true;$('confirmationNotice').hidden=true;$('registerView').hidden=false;ensureTurnstile();});
$('showLogin').addEventListener('click',()=>{$('registerView').hidden=true;$('forgotView').hidden=true;$('confirmationNotice').hidden=true;$('loginView').hidden=false;$('password').value='';});
function ensureTurnstile(){if(signupCaptchaWidget!==null)return;const render=()=>{if(!window.turnstile)return;const key=cfg.turnstileSiteKey;if(!key){$('turnstileSignup').textContent='Cadastro protegido: configure turnstileSiteKey em config.js.';return;}signupCaptchaWidget=window.turnstile.render('#turnstileSignup',{sitekey:key});};if(window.turnstile)render();else setTimeout(render,900)}
$('registerForm').addEventListener('submit',working(async()=>{
 const name=$('displayName').value.trim(),phone=phoneBR($('registerPhone').value),password=$('registerPassword').value;
 if(name.length<2||!phone||password.length<6||password!==$('registerPasswordConfirm').value)throw Error('Confira nome, celular e confirmação da senha (mínimo 6 caracteres).');
 const captcha=window.turnstile&&signupCaptchaWidget!==null?window.turnstile.getResponse(signupCaptchaWidget):null;
 if(!captcha)throw Error('Conclua a verificação de segurança.');
 try{await inviteRequest('register',{name,phone,password,captcha});
 const data=await inviteRequest('login',{phone,password});const {error}=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});if(error)throw error;
 $('registerPassword').value='';$('registerPasswordConfirm').value='';notice('Cadastro realizado. Informe seu e-mail de recuperação.');await boot();}
 finally{if(window.turnstile&&signupCaptchaWidget!==null)window.turnstile.reset(signupCaptchaWidget)}
}));
$('recoveryEmailForm').addEventListener('submit',working(async()=>{
 const email=$('recoveryEmail').value.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Informe um e-mail válido.');
 const {error}=await db.auth.updateUser({email},{emailRedirectTo:location.origin+location.pathname});if(error)throw error;
 notice('Confira a caixa de entrada do seu e-mail para confirmar o endereço.');
}));
$('recheckRecovery').addEventListener('click',working(async()=>{await db.auth.refreshSession();const {data}=await db.auth.getUser();if(!isTechnicalEmail(data.user?.email))notice('E-mail confirmado.');else notice('A confirmação ainda está pendente. Confira o e-mail.');await boot()}));
$('logoutRecovery').addEventListener('click',working(async()=>{await db.auth.signOut();await boot()}));

$('showForgot').addEventListener('click',()=>{$('loginView').hidden=true;$('registerView').hidden=true;$('forgotView').hidden=false;$('forgotEmail').value=$('email').value.trim();});
$('backFromForgot').addEventListener('click',()=>{$('forgotView').hidden=true;$('loginView').hidden=false;});
$('backFromConfirmation').addEventListener('click',()=>{$('confirmationNotice').hidden=true;$('loginView').hidden=false;$('loginMethod').value='email';$('loginMethod').dispatchEvent(new Event('change'));$('email').value=confirmationEmail;});
$('forgotForm').addEventListener('submit',working(async()=>{const email=$('forgotEmail').value.trim().toLowerCase();const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;notice('Se o e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.');}));
$('resendFromForgot').addEventListener('click',working(async()=>{const email=$('forgotEmail').value.trim().toLowerCase();if(!email)throw Error('Informe seu e-mail.');const {error}=await db.auth.resend({type:'signup',email,options:{emailRedirectTo:location.origin+location.pathname}});if(error)throw error;notice('Se o cadastro estiver pendente, enviaremos uma mensagem de confirmação.');}));
$('resendConfirmation').addEventListener('click',working(async()=>{if(!confirmationEmail)throw Error('E-mail não encontrado.');const {error}=await db.auth.resend({type:'signup',email:confirmationEmail,options:{emailRedirectTo:location.origin+location.pathname}});if(error)throw error;notice('Se o cadastro estiver pendente, enviaremos nova confirmação.');}));
$('resetForm').addEventListener('submit',working(async()=>{const password=$('resetPassword').value;if(password.length<6||password!==$('resetConfirm').value)throw Error('As senhas devem coincidir e ter no mínimo 6 caracteres.');const {error}=await db.auth.updateUser({password});if(error)throw error;recoveringPassword=false;$('resetPassword').value='';$('resetConfirm').value='';notice('Senha atualizada com sucesso.');await boot();}));
$('logoutBtn').addEventListener('click',working(async()=>{await db.auth.signOut();await boot()}));
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
$('workDate').value=new Date().toLocaleDateString('en-CA');$('closureMonth').value=$('workDate').value.slice(0,7);
$('shiftForm').addEventListener('submit',working(async()=>{const obj={caregiver_id:session.user.id,caregiver_name:profile.display_name,patient_id:$('patient').value,work_date:$('workDate').value,environment:$('environment').value,shift_hours:Number($('hours').value),start_time:$('start').value||null,end_time:$('end').value||null,shift_kind:$('caregiverType').value==='avulsa'?'Avulso':$('kind').value,caregiver_type:$('caregiverType').value,notes:$('notes').value.trim()};const duplicate=shifts.some(s=>s.caregiver_id===session.user.id&&s.work_date===obj.work_date&&s.patient_id===obj.patient_id&&s.status!=='rejected');if(duplicate&&!confirm('Já existe um plantão seu para esse paciente na data informada. Deseja enviar outro registro?'))return;const {error}=await db.from('care_shifts').insert(obj);if(error)throw error;$('notes').value='';notice('Plantão enviado para aprovação.');await refresh();showTab('new')}));
$('reviewList').addEventListener('click',working(async ev=>{const b=ev.target.closest('button[data-action]');if(!b)return;const root=b.closest('.record');const values={status:b.dataset.action==='approve'?'approved':'rejected',reviewed_by:session.user.id,reviewed_at:new Date().toISOString()};values.caregiver_type=root.querySelector('select[data-field="caregiver_type"]').value;for(const x of root.querySelectorAll('input[data-field]')){const v=Number(x.value);if(!Number.isFinite(v)||v<0)throw Error('Valor inválido.');values[x.dataset.field]=v}if(!confirm(b.dataset.action==='approve'?'Aprovar este plantão e seus valores?':'Rejeitar este plantão?'))return;const {error}=await db.from('care_shifts').update(values).eq('id',b.dataset.id);if(error)throw error;notice('Registro atualizado.');await refresh()}));
async function paymentHandler(ev){const b=ev.target.closest('button[data-action="payment"]');if(!b)return;const s=shifts.find(x=>x.id===b.dataset.id);const remaining=total(s)-paid(s.id);if(remaining<=0.005)throw Error('Plantão já quitado.');const raw=prompt('Valor efetivamente transferido (R$):',String(Math.max(0,remaining).toFixed(2)));if(raw===null)return;const amount=Number(raw.replace(',','.'));if(!Number.isFinite(amount)||amount<=0||amount>remaining+0.001)throw Error('Valor maior que o saldo ou inválido.');const date=prompt('Data do pagamento (AAAA-MM-DD):',new Date().toISOString().slice(0,10));if(!date)return;const ref=prompt('Referência do Pix/comprovante (opcional):','')??'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Data inválida.');const {error}=await db.from('care_payments').insert({shift_id:s.id,amount,paid_on:date,reference:ref,created_by:session.user.id});if(error)throw error;notice('Pagamento registrado.');await refresh()}
$('financeList').addEventListener('click',working(paymentHandler));
$('casualSummary').addEventListener('click',working(paymentHandler));
$('inviteCaregiverForm').addEventListener('submit',working(async()=>{
 if(!isAdmin())throw Error('Somente a administração pode convidar cuidadoras.');
 const name=$('inviteName').value.trim(),phone=phoneBR($('invitePhone').value);
 if(name.length<2||!phone)throw Error('Informe nome e WhatsApp válido com DDD.');
 const {data:auth}=await db.auth.getSession();
 const data=await inviteRequest('create',{name,phone,appUrl:location.origin},auth.session?.access_token);
 $('generatedInvite').hidden=false;
 $('generatedInviteText').dataset.phone=phone;
 showInvitation(name,phone,data.inviteLink);
 $('inviteCaregiverForm').reset();notice('Convite criado. Compartilhe pelo WhatsApp.');await refresh();
}));
$('accessList').addEventListener('click',working(async ev=>{
 const b=ev.target.closest('button[data-action]');if(!b||!isAdmin())return;
 if(b.dataset.id===session.user.id)throw Error('Você não pode modificar seu próprio acesso.');
 let values;
 if(b.dataset.action==='access'){
   if(!confirm(b.dataset.value==='true'?'Liberar esta conta?':'Suspender o acesso desta conta?'))return;
   values={approved:b.dataset.value==='true'};
 }else if(b.dataset.action==='remove-access'){
   if(!confirm(`Excluir o acesso de ${b.dataset.name||'esta pessoa'}? A conta não poderá utilizar o sistema e os registros financeiros serão preservados.`))return;
   values={approved:false,access_removed_at:new Date().toISOString()};
 }else return;
 const {error}=await db.from('care_profiles').update(values).eq('id',b.dataset.id).eq('role','caregiver');
 if(error)throw error;await refresh();notice('Acesso atualizado.');
}));
$('removedAccessList').addEventListener('click',working(async ev=>{
 const b=ev.target.closest('button[data-action="restore-access"]');if(!b||!isAdmin())return;
 if(!confirm('Restaurar o acesso desta cuidadora?'))return;
 const {error}=await db.from('care_profiles').update({access_removed_at:null,approved:true}).eq('id',b.dataset.id).eq('role','caregiver');if(error)throw error;
 await refresh();notice('Acesso restaurado.');
}));
$('migratePhoneForm').addEventListener('submit',working(async ev=>{
 if(!isAdmin())throw Error('Ação exclusiva da administração.');
 const phone=phoneBR($('migratePhone').value);
 if(!phone)throw Error('Informe o telefone com DDD.');
 if(!confirm('Adaptar a autenticação desta conta sem excluir seus registros? Confirme que o número é da cuidadora.'))return;
 const {data:auth}=await db.auth.getSession();
 const result=await inviteRequest('migrate-existing',{phone},auth.session?.access_token);
 $('migratePhoneForm').reset();notice(result.alreadyConfigured?'Conta já adaptada.':'Conta adaptada. Agora entre com o número e a senha que já havia sido definida.');await refresh();
}));
$('invitedList').addEventListener('click',working(async ev=>{
 const b=ev.target.closest('button[data-action]');if(!b||!isAdmin())return;
 const row=invitedPeople.find(p=>p.id===b.dataset.id && p.status==='pending');
 if(!row)return;
 if(b.dataset.action==='reissue-invite'){
   if(!confirm('Gerar um novo convite para '+row.display_name+'? O link anterior será invalidado.'))return;
   const {data:auth}=await db.auth.getSession();
   const data=await inviteRequest('reissue',{inviteId:row.id,appUrl:location.origin},auth.session?.access_token);
   showInvitation(row.display_name,row.phone_e164,data.inviteLink);
   await refresh();notice('Novo link criado. Copie ou envie pelo WhatsApp; o anterior não funciona mais.');
 }else if(b.dataset.action==='cancel-invite'){
   if(!confirm('Cancelar este convite? O link não poderá mais ativar acesso.'))return;
   const {data:auth}=await db.auth.getSession();await inviteRequest('cancel',{inviteId:b.dataset.id},auth.session?.access_token);
   await refresh();notice('Convite cancelado.');
 }
}));
$('exportBtn').addEventListener('click',()=>{if(!isAdmin())return notice('Acesso exclusivo da administração.');csvExport('plantoes.csv',shifts.map(s=>({data:s.work_date,cuidadora:s.caregiver_name,paciente:patients.find(p=>p.id===s.patient_id)?.name||'',ambiente:s.environment,jornada:s.shift_hours,tipo:s.shift_kind,modalidade:caregiverTypeLabel(s.caregiver_type),situacao:statusLabel(s.status),observacoes:s.notes})));});
$('financeMonth').addEventListener('change',()=>renderAvulsas());
$('financeCaregiver').addEventListener('change',()=>renderAvulsas());
$('exportAvulsas').addEventListener('click',()=>{if(!isAdmin())return;csvExport('fechamento_avulsas.csv',avulsaRows());});
$('exportFinance').addEventListener('click',()=>{if(!isAdmin())return;csvExport('financeiro.csv',shifts.filter(s=>s.status==='approved').map(s=>({data:s.work_date,cuidadora:s.caregiver_name,modalidade:caregiverTypeLabel(s.caregiver_type),diaria:s.rate,transporte:s.transport,alimentacao:s.meals,outros:s.other_costs,devido:total(s),pago:paid(s.id),saldo:total(s)-paid(s.id)})));});

// Fechamento mensal: o resultado vem de uma função atômica no banco, que permite uma única leitura.
$('finishMonthBtn').addEventListener('click',working(async()=>{
 if(isAdmin())throw Error('Administradores já possuem histórico completo.');
 const month=$('closureMonth').value;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Selecione um mês válido.');
 if(!confirm(`Finalizar ${month}? O histórico deste mês será exibido UMA VEZ e os lançamentos ficarão bloqueados. Deseja continuar?`))return;
 const btn=$('finishMonthBtn');btn.disabled=true;
 try{const {data,error}=await db.rpc('care_finalize_month_once',{p_month:month+'-01'});if(error)throw error;
 const rows=Array.isArray(data)?data:[];
 $('monthHistory').hidden=false;
 $('monthHistory').innerHTML=`<h3>Histórico de ${esc(month)} — visualização única</h3>`+(rows.length?rows.map(s=>`<div class="record"><div class="recordHead"><span>${esc(s.work_date)} · ${esc(s.patient_name||'Paciente')}</span><span class="pill ${esc(s.status)}">${statusLabel(s.status)}</span></div><div class="recordMeta">${esc(s.environment)} · ${esc(s.shift_hours)}h · ${esc(s.shift_kind)}${s.notes?'<br>'+esc(s.notes):''}</div></div>`).join(''):'<p class="muted">Nenhum plantão registrado.</p>');
 notice('Mês finalizado. Consulte o histórico agora: ele não será reaberto depois.');await refresh();
 }finally{btn.disabled=false;}
}));
// Conferência CSV administrativa, sem inserção automática de dados históricos.
$('csvFile').addEventListener('change',working(async()=>{
 if(!isAdmin())throw Error('Somente a administração pode conferir CSV.');
 const file=$('csvFile').files?.[0];if(!file)return;
 if(file.size>2*1024*1024)throw Error('CSV acima de 2 MB.');
 const txt=(await file.text()).replace(/^\uFEFF/,'');const lines=txt.split(/\r?\n/).filter(x=>x.trim());
 if(!lines.length)throw Error('CSV vazio.');const sep=lines[0].includes(';')?';':',';
 const split=line=>{const a=[];let s='',q=false;for(let i=0;i<line.length;i++){if(line[i]==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(line[i]===sep&&!q){a.push(s);s=''}else s+=line[i]}a.push(s);return a};
 const sample=lines.slice(0,21).map(split);const heads=sample[0];$('csvPreview').innerHTML=`<p class="muted">${lines.length-1} linhas encontradas. Prévia das primeiras 20; nenhuma linha foi importada.</p><div class="tableScroll"><table class="detailTable"><thead><tr>${heads.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${sample.slice(1).map(row=>`<tr>${heads.map((_,i)=>`<td>${esc(row[i]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}));

$('closureMonth').addEventListener('change',()=>{$('monthHistory').innerHTML='';$('monthHistory').hidden=true;});

// Campos de cadastro: um plantão avulso já identifica sua categoria.
function syncShiftFields(){const isCasual=$('caregiverType').value==='avulsa';$('kindField').hidden=isCasual;$('kind').disabled=isCasual;if(isCasual)$('kind').value='Avulso'}
$('caregiverType').addEventListener('change',syncShiftFields);
syncShiftFields();
// Período inicial: mês atual, com limites inclusivos. O filtro não altera o banco.
function dashboardCurrentMonth(){const now=new Date();const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');$('dashboardStart').value=`${y}-${m}-01`;$('dashboardEnd').value=`${y}-${m}-${String(new Date(y,now.getMonth()+1,0).getDate()).padStart(2,'0')}`;if(isAdmin())renderDashboard()}
dashboardCurrentMonth();
['dashboardStart','dashboardEnd','dashboardCaregiver','dashboardPatient'].forEach(id=>$(id).addEventListener('change',()=>{if($('dashboardStart').value&&$('dashboardEnd').value&&$('dashboardStart').value>$('dashboardEnd').value)return notice('A data inicial não pode ser posterior à final.');renderDashboard()}));
$('dashboardClear').addEventListener('click',()=>{ $('dashboardCaregiver').value='';$('dashboardPatient').value='';dashboardCurrentMonth()});

// Instalação PWA: o navegador decide quando permite apresentar o convite.
let pendingInstallPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pendingInstallPrompt=event;});
window.addEventListener('appinstalled',()=>{pendingInstallPrompt=null;notice('CuidaGeri instalado na tela inicial.');});
function showInstallHelp(){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
 const android=/Android/i.test(navigator.userAgent);
 const msg=ios
 ? 'No iPhone, abra o CuidaGeri no Safari, toque no botão Compartilhar (quadrado com seta para cima), escolha “Adicionar à Tela de Início” e confirme. Se estiver no Chrome, use “Abrir no Safari” primeiro.'
 :android
 ? 'No Android, abra no Chrome ou Edge, toque no menu ⋮ e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. Confirme para criar o ícone.'
 : 'No computador, use o botão de instalação na barra do navegador, se disponível. No celular, abra este endereço no Chrome (Android) ou Safari (iPhone) e adicione à tela inicial.';
 $('installHelpText').textContent=msg;$('installHelp').hidden=false;
}
for(const btn of document.querySelectorAll('.installApp'))btn.addEventListener('click',async()=>{
 if(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true){notice('O CuidaGeri já está aberto como aplicativo.');return;}
 if(pendingInstallPrompt){const p=pendingInstallPrompt;pendingInstallPrompt=null;await p.prompt();return;}
 showInstallHelp();
});
$('closeInstallHelp').addEventListener('click',()=>{$('installHelp').hidden=true});
$('installHelp').addEventListener('click',e=>{if(e.target===$('installHelp'))$('installHelp').hidden=true});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));}
