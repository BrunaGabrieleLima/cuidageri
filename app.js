import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.APP_CONFIG||{};
const ok=cfg.supabaseUrl?.startsWith('https://') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('COLE_');
const $=id=>document.getElementById(id), money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,session,patients=[],shifts=[],payments=[],profiles=[];
const isAdmin=()=>profile?.role==='admin'&&profile?.approved===true;
function notice(message){$('notice').textContent=message;$('notice').style.display='block';setTimeout(()=>$('notice').style.display='none',4500)}
function fail(e){notice(e?.message||String(e))}
function working(fn){return async ev=>{try{ev?.preventDefault?.();await fn(ev)}catch(e){fail(e)}}}
function caregiverTypeLabel(t){return t==='avulsa'?'Avulsa':t==='recorrente'?'Recorrente':'Não informado'}
function statusLabel(s){return {pending:'Pendente',approved:'Aprovado',rejected:'Rejeitado'}[s]||s}
const total=s=>Number(s.rate||0)+Number(s.transport||0)+Number(s.meals||0)+Number(s.other_costs||0);
const paid=id=>payments.filter(p=>p.shift_id===id).reduce((t,p)=>t+Number(p.amount),0);
function parseCSVLine(line){const out=[];let cur='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===','&&!quote){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}
function csvExport(filename,rows){if(!rows.length)return notice('Não há registros para exportar.');const keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const content='\uFEFF'+keys.join(';')+'\r\n'+rows.map(r=>keys.map(k=>cell(r[k])).join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
async function refresh(){const admin=isAdmin();const queries=[db.from('care_patients').select('*').eq('active',true).order('name'),db.from('care_shifts').select(admin?'*':'id,caregiver_id,work_date,patient_id,status').order('work_date',{ascending:false}).limit(1000)];if(admin)queries.push(db.from('care_payments').select('*'),db.from('care_profiles').select('*').order('display_name'));const results=await Promise.all(queries);for(const x of results)if(x.error)throw x.error;patients=results[0].data;shifts=results[1].data||[];payments=admin?(results[2].data||[]):[];profiles=admin?(results[3].data||[]):[];$('patient').innerHTML=patients.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');render()}
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
function render(){const admin=isAdmin();
if(admin){const mine=shifts;
$('historyList').innerHTML=mine.length?mine.map(s=>`<div class="record"><div class="recordHead"><span>${esc(s.work_date)} · ${esc(s.caregiver_name)}</span><span class="pill ${s.status}">${statusLabel(s.status)}</span></div><div class="recordMeta">${esc(patients.find(p=>p.id===s.patient_id)?.name||'Paciente')} · ${esc(s.environment)} · ${esc(s.shift_hours)}h · ${esc(s.shift_kind)} · ${caregiverTypeLabel(s.caregiver_type)}${s.notes?'<br>'+esc(s.notes):''}<br>Total: ${money(total(s))} · Pago: ${money(paid(s.id))}</div></div>`).join(''):'<p class="muted">Nenhum plantão registrado.</p>';}
if(!admin)return;
const pend=shifts.filter(s=>s.status==='pending').length; const appr=shifts.filter(s=>s.status==='approved'); const av=appr.filter(s=>s.caregiver_type==='avulsa'); $('dashboardKpis').innerHTML=`<div class="kpis"><div class="kpi"><small>Aguardando aprovação</small><b>${pend}</b></div><div class="kpi"><small>Avulsas aprovadas</small><b>${av.length} plantões</b></div><div class="kpi"><small>Saldo das avulsas</small><b>${money(av.reduce((t,s)=>t+Math.max(0,total(s)-paid(s.id)),0))}</b></div></div>`;
$('reviewList').innerHTML=shifts.filter(s=>s.status==='pending').map(s=>`<div class="record" data-id="${esc(s.id)}"><div class="recordHead"><span>${esc(s.caregiver_name)} · ${esc(s.work_date)}</span><span class="pill">Pendente</span></div><div class="recordMeta">${esc(patients.find(p=>p.id===s.patient_id)?.name||'')} · ${esc(s.environment)} · ${esc(s.shift_hours)}h · ${esc(s.shift_kind)} · <b>${caregiverTypeLabel(s.caregiver_type)}</b><br>${esc(s.notes)}</div><label class="review-type">Modalidade confirmada<select data-field="caregiver_type"><option value="avulsa" ${s.caregiver_type==='avulsa'?'selected':''}>Avulsa</option><option value="recorrente" ${s.caregiver_type==='recorrente'?'selected':''}>Recorrente</option></select></label><div class="twocol"><label>Diária (R$)<input data-field="rate" type="number" min="0" step="0.01" value="${Number(s.rate)>0?s.rate:suggestedRate(s)}"></label><label>Transporte (R$)<input data-field="transport" type="number" min="0" step="0.01" value="${s.transport}"></label><label>Alimentação (R$)<input data-field="meals" type="number" min="0" step="0.01" value="${s.meals}"></label><label>Outras despesas (R$)<input data-field="other_costs" type="number" min="0" step="0.01" value="${s.other_costs}"></label></div><div class="rowActions"><button data-action="approve" data-id="${esc(s.id)}">Aprovar</button><button class="light" data-action="reject" data-id="${esc(s.id)}">Rejeitar</button></div></div>`).join('')||'<p class="muted">Nenhum plantão aguardando aprovação.</p>';
const active=shifts.filter(s=>s.status==='approved');const due=active.reduce((t,s)=>t+total(s),0), transferred=payments.reduce((t,p)=>t+Number(p.amount),0);
$('financeSummary').innerHTML=`<div class="stat"><small>Valor aprovado</small><b>${money(due)}</b></div><div class="stat"><small>Registrado como pago</small><b>${money(transferred)}</b></div><div class="stat"><small>Saldo aprovado</small><b>${money(due-transferred)}</b></div>`;
renderAvulsas();
$('financeList').innerHTML=active.filter(s=>s.caregiver_type!=='avulsa').map(s=>`<div class="record"><div class="recordHead"><span>${esc(s.caregiver_name)} · ${esc(s.work_date)}</span><span>${money(Math.max(0,total(s)-paid(s.id)))}</span></div><div class="recordMeta">Devido: ${money(total(s))} · Pago: ${money(paid(s.id))} · ${esc(s.environment)}</div><div class="rowActions">${total(s)-paid(s.id)>0.005?`<button class="small" data-action="payment" data-id="${esc(s.id)}">Registrar pagamento</button>`:"Quitado"}</div></div>`).join('')||'<p class="muted">Sem plantões aprovados.</p>';
$('accessList').innerHTML=profiles.map(p=>`<div class="record"><div class="recordHead"><span>${esc(p.display_name||'(sem nome)')}</span><span class="pill ${p.approved?'approved':''}">${p.approved?'Liberado':'Pendente'}</span></div><div class="recordMeta">${esc(p.role)} · ID: ${esc(p.id)}</div>${p.id!==session.user.id?`<div class="rowActions"><button data-action="access" data-id="${esc(p.id)}" data-value="${p.approved?'false':'true'}">${p.approved?'Suspender':'Liberar'}</button></div>`:''}</div>`).join('')}
async function boot(){const {data,error}=await db.auth.getSession();if(error)throw error;session=data.session;$('auth').hidden=!!session;$('app').hidden=!session;if(!session)return;
const {data:p,error:e}=await db.from('care_profiles').select('*').eq('id',session.user.id).single();if(e)throw e;profile=p;$('welcome').textContent=`Olá, ${p.display_name||'cuidadora'}!`;$('roleBadge').hidden=false;$('roleBadge').textContent=p.role==='admin'?'Administração':'Cuidadora';$('accessInfo').textContent=p.role==='admin'?'Confira e aprove os plantões enviados.':'Registre seus próprios plantões para conferência.';$('pendingAccess').hidden=p.approved;$('authorized').hidden=!p.approved;
if(p.approved){document.querySelectorAll('.adminOnly').forEach(el=>el.hidden=p.role!=='admin');document.querySelectorAll('.caregiverOnly').forEach(el=>el.hidden=p.role==='admin');showTab('new');$('monthHistory').hidden=true;$('monthHistory').innerHTML='';await refresh()}}
function showTab(id){if(id!=='closeMonth'){$('monthHistory').innerHTML='';$('monthHistory').hidden=true;}document.querySelectorAll('.pane').forEach(el=>el.hidden=el.id!==id);document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===id))}
if(!ok){$('setup').hidden=false;$('auth').hidden=true}else{
 db=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'cuidageri-auth'}});
 db.auth.onAuthStateChange(()=>setTimeout(()=>boot().catch(fail),0));
 boot().catch(fail);
}
$('authForm').addEventListener('submit',working(async()=>{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;await boot()}));
$('showRegister').addEventListener('click',()=>{$('loginView').hidden=true;$('registerView').hidden=false;$('registerEmail').value=$('email').value.trim();});
$('showLogin').addEventListener('click',()=>{$('registerView').hidden=true;$('loginView').hidden=false;$('password').value='';});
$('registerForm').addEventListener('submit',working(async()=>{const name=$('displayName').value.trim();if(!name)throw Error('Informe seu nome.');const {error}=await db.auth.signUp({email:$('registerEmail').value.trim(),password:$('registerPassword').value,options:{data:{display_name:name}}});if(error)throw error;$('registerPassword').value='';notice('Cadastro solicitado. Confira seu e-mail e aguarde liberação.');$('showLogin').click()}));
$('logoutBtn').addEventListener('click',working(async()=>{await db.auth.signOut();await boot()}));
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
$('workDate').value=new Date().toLocaleDateString('en-CA');$('closureMonth').value=$('workDate').value.slice(0,7);
$('shiftForm').addEventListener('submit',working(async()=>{const obj={caregiver_id:session.user.id,caregiver_name:profile.display_name,patient_id:$('patient').value,work_date:$('workDate').value,environment:$('environment').value,shift_hours:Number($('hours').value),start_time:$('start').value||null,end_time:$('end').value||null,shift_kind:$('kind').value,caregiver_type:$('caregiverType').value,notes:$('notes').value.trim()};const duplicate=shifts.some(s=>s.caregiver_id===session.user.id&&s.work_date===obj.work_date&&s.patient_id===obj.patient_id&&s.status!=='rejected');if(duplicate&&!confirm('Já existe um plantão seu para esse paciente na data informada. Deseja enviar outro registro?'))return;const {error}=await db.from('care_shifts').insert(obj);if(error)throw error;$('notes').value='';notice('Plantão enviado para aprovação.');await refresh();showTab('new')}));
$('reviewList').addEventListener('click',working(async ev=>{const b=ev.target.closest('button[data-action]');if(!b)return;const root=b.closest('.record');const values={status:b.dataset.action==='approve'?'approved':'rejected',reviewed_by:session.user.id,reviewed_at:new Date().toISOString()};values.caregiver_type=root.querySelector('select[data-field="caregiver_type"]').value;for(const x of root.querySelectorAll('input[data-field]')){const v=Number(x.value);if(!Number.isFinite(v)||v<0)throw Error('Valor inválido.');values[x.dataset.field]=v}if(!confirm(b.dataset.action==='approve'?'Aprovar este plantão e seus valores?':'Rejeitar este plantão?'))return;const {error}=await db.from('care_shifts').update(values).eq('id',b.dataset.id);if(error)throw error;notice('Registro atualizado.');await refresh()}));
async function paymentHandler(ev){const b=ev.target.closest('button[data-action="payment"]');if(!b)return;const s=shifts.find(x=>x.id===b.dataset.id);const remaining=total(s)-paid(s.id);if(remaining<=0.005)throw Error('Plantão já quitado.');const raw=prompt('Valor efetivamente transferido (R$):',String(Math.max(0,remaining).toFixed(2)));if(raw===null)return;const amount=Number(raw.replace(',','.'));if(!Number.isFinite(amount)||amount<=0||amount>remaining+0.001)throw Error('Valor maior que o saldo ou inválido.');const date=prompt('Data do pagamento (AAAA-MM-DD):',new Date().toISOString().slice(0,10));if(!date)return;const ref=prompt('Referência do Pix/comprovante (opcional):','')??'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Data inválida.');const {error}=await db.from('care_payments').insert({shift_id:s.id,amount,paid_on:date,reference:ref,created_by:session.user.id});if(error)throw error;notice('Pagamento registrado.');await refresh()}
$('financeList').addEventListener('click',working(paymentHandler));
$('casualSummary').addEventListener('click',working(paymentHandler));
$('accessList').addEventListener('click',working(async ev=>{const b=ev.target.closest('button[data-action="access"]');if(!b)return;if(!confirm('Alterar acesso desta pessoa?'))return;const {error}=await db.from('care_profiles').update({approved:b.dataset.value==='true'}).eq('id',b.dataset.id);if(error)throw error;await refresh()}));
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
