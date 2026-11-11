/* CuidaGeri | Etapa 4M — pedidos de acesso por organizacao.
   Modulo isolado; nao altera app.js ou funcoes existentes.
   Usa apenas as RPCs v4l, v4k e perfil do proprio usuario. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.APP_CONFIG || {};
const valid = cfg.supabaseUrl?.startsWith('https://') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('COLE_');
const db = valid ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;
const PILOT_SLUG = 'familia-sr-reginaldo';
let currentUserId = null;
let currentOrgId = null;
let refreshId = 0;
const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = String(text);
  if (className) el.className = className;
  return el;
};
const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR') : '—';
const roleName = role => role === 'manager' ? 'Gestora' : 'Cuidadora';
const statusName = status => ({ pending:'Pendente', approved:'Aprovada', rejected:'Rejeitada', cancelled:'Cancelada' })[status] || status;
const alertText = err => err?.message || 'Não foi possível concluir a operação.';

function ensureUI() {
  if (!$('access4mCaregiver')) {
    const caregiver = node('section', undefined, 'card access4m-card');
    caregiver.id = 'access4mCaregiver';
    caregiver.hidden = true;
    caregiver.append(node('h2', 'Solicitar acesso a uma família'));
    caregiver.append(node('p', 'Seu cadastro Google não dá acesso automático aos pacientes. Solicite autorização da administração geral.', 'muted'));
    const form = node('form'); form.id = 'access4mForm';
    const label = node('label', 'Família disponível');
    const select = node('select'); select.id = 'access4mFamily';
    select.append(new Option('Família do Sr. Reginaldo', PILOT_SLUG));
    label.append(select); form.append(label);
    const roleLabel = node('label', 'Tipo de acesso solicitado');
    const roles = node('select'); roles.id = 'access4mRole';
    roles.append(new Option('Cuidadora', 'caregiver'), new Option('Gestora (sujeito à futura habilitação)', 'manager'));
    roleLabel.append(roles); form.append(roleLabel);
    const btn = node('button', 'Enviar solicitação'); btn.type='submit'; btn.id='access4mSubmit'; form.append(btn);
    caregiver.append(form);
    const msg = node('p', '', 'muted'); msg.id = 'access4mMessage'; msg.setAttribute('role', 'status'); caregiver.append(msg);
    caregiver.append(node('h3', 'Minhas solicitações'));
    const history = node('div'); history.id = 'access4mMyList'; caregiver.append(history);
    ($('myProfile') || $('new'))?.append(caregiver);
    form.addEventListener('submit', handleRequest);
  }
  if (!$('access4mAdmin')) {
    const admin = node('section', undefined, 'card access4m-card');
    admin.id = 'access4mAdmin'; admin.hidden = true;
    admin.append(node('h2', 'Solicitações de acesso à família'));
    admin.append(node('p', 'Aprovar ou rejeitar pedidos de cuidadoras. Pedidos para gestora não podem ser aprovados nesta etapa.', 'muted'));
    const refresh = node('button', 'Atualizar solicitações', 'small light');
    refresh.type = 'button'; refresh.addEventListener('click', () => update(true));
    admin.append(refresh);
    const msg = node('p', '', 'muted'); msg.id = 'access4mAdminMessage'; msg.setAttribute('role', 'status'); admin.append(msg);
    const list = node('div'); list.id='access4mAdminList'; admin.append(list);
    $('access')?.querySelector('.card')?.append(admin);
  }
  if (!$('access4mStyles')) {
    const style = node('style'); style.id = 'access4mStyles';
    style.textContent = `
      .access4m-card { margin-top: 22px; }
      .access4m-card[hidden] { display: none !important; }
      .access4m-item { padding: 14px 0; border-bottom: 1px solid rgba(120,130,145,.22); }
      .access4m-item:last-child { border-bottom: 0; }
      .access4m-item strong { display:block; margin-bottom:4px; }
      .access4m-item .muted { margin:3px 0; font-size:.9em; }
      .access4m-actions {display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;}
      .access4m-actions button {flex:0 1 auto;}
      #access4mMessage, #access4mAdminMessage { margin: 10px 0; }
    `;
    document.head.append(style);
  }
}

async function call(name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

function renderMyRequests(items, hasMembership) {
  const root = $('access4mMyList'); if (!root) return;
  root.replaceChildren();
  if (!items.length) root.append(node('p', hasMembership ? 'Você já está vinculada à família.' : 'Nenhuma solicitação registrada.', 'muted'));
  for (const item of items) {
    const line = node('div', undefined, 'access4m-item');
    line.append(node('strong', `${item.organization_name} — ${roleName(item.requested_role)}`));
    line.append(node('p', `${statusName(item.status)} · ${fmtDate(item.created_at)}`, 'muted'));
    if (item.review_note) line.append(node('p', `Observação: ${item.review_note}`, 'muted'));
    if (item.status === 'pending') {
      const btn = node('button', 'Cancelar pedido', 'small light'); btn.type = 'button';
      btn.addEventListener('click', async () => {
        if (!window.confirm('Cancelar esta solicitação?')) return;
        btn.disabled = true;
        try { await call('care_org_access_cancel_v4l', {p_request_id:item.id}); await update(true); }
        catch(err) { $('access4mMessage').textContent = alertText(err); btn.disabled = false; }
      });
      line.append(btn);
    }
    root.append(line);
  }
}

function renderAdmin(items) {
  const root = $('access4mAdminList'); if (!root) return;
  root.replaceChildren();
  const pendings = items.filter(item => item.status === 'pending');
  root.append(node('h3', `Pendentes (${pendings.length})`));
  if (!pendings.length) root.append(node('p', 'Nenhuma solicitação pendente.', 'muted'));
  for (const item of pendings) {
    const row = node('div', undefined, 'access4m-item');
    row.append(node('strong', item.requester_name || 'Pessoa sem nome informado'));
    row.append(node('p', `${item.organization_name} · ${roleName(item.requested_role)} · ${fmtDate(item.created_at)}`, 'muted'));
    const actions = node('div', undefined, 'access4m-actions');
    const approve = node('button', 'Aprovar', 'small'); approve.type = 'button';
    approve.disabled = item.requested_role !== 'caregiver';
    if (approve.disabled) approve.title = 'Aprovação de gestora indisponível até a próxima etapa';
    const reject = node('button', 'Rejeitar', 'small light'); reject.type = 'button';
    const submit = async allowed => {
      if (!window.confirm(allowed ? `Aprovar ${item.requester_name} como cuidadora?` : `Rejeitar a solicitação de ${item.requester_name}?`)) return;
      approve.disabled = true; reject.disabled = true;
      try {
        await call('care_org_access_review_v4l', {p_request_id:item.id, p_approve:allowed, p_note:null});
        $('access4mAdminMessage').textContent = allowed ? 'Solicitação aprovada. A cuidadora já pode acessar a família.' : 'Solicitação rejeitada.';
        await update(true);
      } catch(err) {
        $('access4mAdminMessage').textContent = alertText(err);
        approve.disabled = item.requested_role !== 'caregiver'; reject.disabled = false;
      }
    };
    approve.addEventListener('click', () => submit(true));
    reject.addEventListener('click', () => submit(false));
    actions.append(approve,reject); row.append(actions); root.append(row);
  }
  const recent = items.filter(item=>item.status !== 'pending').slice(0,20);
  root.append(node('h3', 'Últimas solicitações analisadas'));
  if (!recent.length) root.append(node('p','Nenhuma solicitação analisada.', 'muted'));
  for (const item of recent) {
    const row=node('div',undefined,'access4m-item');
    row.append(node('strong', `${item.requester_name} — ${statusName(item.status)}`));
    row.append(node('p', `${roleName(item.requested_role)} · ${fmtDate(item.created_at)}`, 'muted'));
    root.append(row);
  }
}

async function handleRequest(ev) {
  ev.preventDefault();
  const btn=$('access4mSubmit'); btn.disabled=true;
  $('access4mMessage').textContent = 'Registrando solicitação...';
  try {
    await call('care_org_access_request_v4l', {
      p_slug: $('access4mFamily').value,
      p_requested_role: $('access4mRole').value,
    });
    $('access4mMessage').textContent='Solicitação enviada à administração geral.';
    await update(true);
  } catch(err) { $('access4mMessage').textContent=alertText(err); }
  finally {btn.disabled=false;}
}

async function update(force=false) {
  if (!db) return;
  ensureUI();
  const thisRefresh=++refreshId;
  try {
    const {data:auth, error:authError}=await db.auth.getUser();
    if (authError || !auth.user) {
      currentUserId=null; currentOrgId=null;
      $('access4mCaregiver').hidden=true; $('access4mAdmin').hidden=true;
      return;
    }
    const id=auth.user.id;
    const {data:p,error:profileError}=await db.from('care_profiles').select('id,role,approved,access_removed_at').eq('id',id).maybeSingle();
    if (profileError) throw profileError;
    if (thisRefresh!==refreshId) return;
    if (!p || !p.approved || p.access_removed_at) {
      $('access4mCaregiver').hidden=true; $('access4mAdmin').hidden=true;
      return;
    }
    currentUserId=id;
    if (p.role === 'admin') {
      $('access4mCaregiver').hidden = true;
      const {data:orgs}=await db.rpc('care_org_choices_v4k');
      const org=(orgs||[]).find(o=>o.organization_role==='owner' && o.organization_name?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes('reginaldo'));
      currentOrgId=org?.organization_id||null;
      $('access4mAdmin').hidden = !currentOrgId;
      if (currentOrgId) {
        const items=await call('care_org_access_requests_list_v4l',{p_organization_id:currentOrgId});
        if (thisRefresh===refreshId) renderAdmin(items||[]);
      }
    } else if (p.role==='caregiver') {
      $('access4mAdmin').hidden=true;
      const {data:orgs,error:orgError}=await db.rpc('care_org_choices_v4k');
      if (orgError) throw orgError;
      const linked=(orgs||[]).some(o=>o.organization_name?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes('reginaldo'));
      const items=await call('care_org_access_requests_list_v4l',{p_organization_id:null});
      if (thisRefresh!==refreshId) return;
      $('access4mCaregiver').hidden=false;
      $('access4mForm').hidden=linked;
      $('access4mMessage').textContent=linked?'Seu acesso à família já está autorizado.':'';
      renderMyRequests(items||[],linked);
    }
  } catch(err) {
    const box=$('access4mAdmin')?.hidden ? $('access4mMessage') : $('access4mAdminMessage');
    if(box) box.textContent=`Não foi possível consultar solicitações: ${alertText(err)}`;
  }
}

function start() {
  if (!db) return;
  ensureUI();
  update();
  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-tab="access"], [data-tab="myProfile"]')) update();
  });
  db.auth.onAuthStateChange((_event,session)=>{
    // Deferred to avoid calling Supabase APIs synchronously from auth callback.
    if (session?.user?.id !== currentUserId) Promise.resolve().then(() => update());
  });
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
