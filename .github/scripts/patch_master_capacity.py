from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'marker not found: {label}')
    return text.replace(old, new, 1)

# master.html
p = Path('master.html')
s = p.read_text()
s = replace_once(
    s,
    '<article><span>Clientes</span><strong id="mm-companies">0</strong><small id="mm-companies-detail">0 ativos</small></article>',
    '<article><span>Clientes</span><strong id="mm-companies">0 / 6</strong><small id="mm-companies-detail">Capacidade da plataforma</small></article>',
    'master clients metric',
)
s = replace_once(
    s,
    '<article><span>Armazenamento</span><strong id="mm-storage">0 MB</strong><small>Total registrado</small></article>',
    '<article><span>Armazenamento</span><strong id="mm-storage">0 MB / 1.024 MB</strong><small id="mm-storage-detail">0 MB reservados • 1.024 MB disponíveis</small></article>',
    'master storage metric',
)
p.write_text(s)

# master.js
p = Path('master.js')
s = p.read_text()
old_metrics = "  function renderMetrics(){ const m=state.data.metrics||{}; $('#mm-companies').textContent=m.companies||0; $('#mm-companies-detail').textContent=`${m.active_companies||0} ativos • ${m.suspended_companies||0} suspensos`; $('#mm-mrr').textContent=money(m.mrr_cents); $('#mm-users').textContent=m.users||0; $('#mm-devices').textContent=m.devices||0; $('#mm-devices-detail').textContent=`${m.online_devices||0} online`; $('#mm-storage').textContent=bytes(m.storage_bytes); }"
new_metrics = """  function renderMetrics(){
    const m=state.data.metrics||{};
    const maxCompanies=Number(m.max_companies||6);
    const companies=Number(m.companies||0);
    const capacityMb=Number(m.storage_capacity_mb||1024);
    const reservedMb=Number(m.storage_reserved_mb||0);
    const usedBytes=Number(m.storage_bytes||0);
    const allocatableMb=Math.max(0,capacityMb-reservedMb);
    $('#mm-companies').textContent=`${companies} / ${maxCompanies}`;
    $('#mm-companies-detail').textContent=`${m.active_companies||0} ativos • ${Math.max(0,maxCompanies-companies)} vaga(s)`;
    $('#mm-mrr').textContent=money(m.mrr_cents);
    $('#mm-users').textContent=m.users||0;
    $('#mm-devices').textContent=m.devices||0;
    $('#mm-devices-detail').textContent=`${m.online_devices||0} online`;
    $('#mm-storage').textContent=`${bytes(usedBytes)} / ${capacityMb.toLocaleString('pt-BR')} MB`;
    $('#mm-storage-detail').textContent=`${reservedMb.toLocaleString('pt-BR')} MB reservados • ${allocatableMb.toLocaleString('pt-BR')} MB disponíveis para limites`;
    $$('[data-open-client]').forEach(btn=>{
      const full=companies>=maxCompanies;
      btn.disabled=full;
      btn.title=full?`Limite de ${maxCompanies} clientes atingido`:'';
    });
  }"""
s = replace_once(s, old_metrics, new_metrics, 'renderMetrics')

old_open = "  function openNewClient(){ fillPlanSelects(); $('#master-client-form').reset(); $('#mc-trial-days').value='7'; openDialog('master-client-dialog'); }"
new_open = """  function openNewClient(){
    const m=state.data?.metrics||{};
    const max=Number(m.max_companies||6);
    if(Number(m.companies||0)>=max){toast('Limite de clientes atingido',`A plataforma está em ${max}/${max} clientes. Para cadastrar outro, libere capacidade ou altere a infraestrutura.`,'error');return}
    fillPlanSelects(); $('#master-client-form').reset(); $('#mc-trial-days').value='7'; openDialog('master-client-dialog');
  }"""
s = replace_once(s, old_open, new_open, 'openNewClient')

old_create = "  async function createClient(ev){ev.preventDefault();const b=$('#mc-save');busy(b,true,'Criando...');try{const d=await master({action:'create_client',company_name:$('#mc-company-name').value.trim(),owner_name:$('#mc-owner-name').value.trim(),owner_email:$('#mc-owner-email').value.trim(),plan_id:$('#mc-plan').value,trial_days:Number($('#mc-trial-days').value||0),temporary_password:$('#mc-temp-password').value});closeDialog('master-client-dialog');toast('Cliente criado',d.delivery==='invite'?'Convite enviado por e-mail.':d.delivery==='temporary_password'?'Acesso criado com senha temporária.':'Usuário existente vinculado.');await load();}catch(e){toast('Erro ao criar cliente',e.message,'error')}finally{busy(b,false)}}"
new_create = "  async function createClient(ev){ev.preventDefault();const b=$('#mc-save');busy(b,true,'Criando...');try{const d=await master({action:'create_client',company_name:$('#mc-company-name').value.trim(),owner_name:$('#mc-owner-name').value.trim(),owner_email:$('#mc-owner-email').value.trim(),plan_id:$('#mc-plan').value,trial_days:Number($('#mc-trial-days').value||0),temporary_password:$('#mc-temp-password').value});closeDialog('master-client-dialog');toast('Cliente criado',d.delivery==='invite'?'Convite enviado por e-mail.':d.delivery==='temporary_password'?'Acesso criado com senha temporária.':'Usuário existente vinculado.');await load();}catch(e){const msg=/platform_client_limit_reached/i.test(String(e.message))?'O limite de 6 clientes desta infraestrutura foi atingido.':e.message;toast('Erro ao criar cliente',msg,'error')}finally{busy(b,false)}}"
s = replace_once(s, old_create, new_create, 'createClient')

old_company_catch = """    }catch(e){
      formStatus('#me-status',`❌ ${e.message}`,'error');
      toast('Erro ao salvar',e.message,'error');
    }finally{busy(b,false)}"""
new_company_catch = """    }catch(e){
      const raw=String(e?.message||'Erro ao salvar');
      const msg=/platform_storage_allocation_exceeded/i.test(raw)
        ? 'A soma dos limites de armazenamento dos clientes não pode ultrapassar 1.024 MB. Reduza o limite deste ou de outro cliente.'
        : raw;
      formStatus('#me-status',`❌ ${msg}`,'error');
      toast('Erro ao salvar',msg,'error');
    }finally{busy(b,false)}"""
s = replace_once(s, old_company_catch, new_company_catch, 'saveCompany catch')
p.write_text(s)

# master-admin capacity metrics
p = Path('supabase/functions/master-admin/index.ts')
s = p.read_text()
new_dash = """async function dash(a){const [co,su,pl,me,de,mi,ca,au,us,cap]=await Promise.all([a.from('companies').select('*').order('created_at',{ascending:false}),a.from('company_subscriptions').select('*'),a.from('plans').select('*').order('sort_order'),a.from('company_members').select('*'),a.from('devices').select('id,company_id,last_seen_at'),a.from('media_assets').select('id,company_id,size_bytes'),a.from('campaigns').select('id,company_id,is_active'),a.from('master_audit_logs').select('*').order('created_at',{ascending:false}).limit(80),allUsers(a),a.rpc('get_master_platform_capacity')]);for(const r of [co,su,pl,me,de,mi,ca,au,cap])if(r.error)throw r.error;const capacity=Array.isArray(cap.data)?(cap.data[0]||{}):(cap.data||{});const um=new Map(us.map(x=>[x.id,{id:x.id,email:x.email||'',display_name:x.user_metadata?.display_name||'',created_at:x.created_at,last_sign_in_at:x.last_sign_in_at,email_confirmed_at:x.email_confirmed_at}]));const sm=new Map((su.data||[]).map(x=>[x.company_id,x]));const pm=new Map((pl.data||[]).map(x=>[x.id,x]));const cs=(co.data||[]).map(c=>{const sub=sm.get(c.id)||null,plan=sub?.plan_id?pm.get(sub.plan_id):null,m=(me.data||[]).filter(x=>x.company_id===c.id),d=(de.data||[]).filter(x=>x.company_id===c.id),med=(mi.data||[]).filter(x=>x.company_id===c.id),cam=(ca.data||[]).filter(x=>x.company_id===c.id);return{...c,owner:um.get(c.owner_user_id)||{id:c.owner_user_id,email:''},subscription:sub,plan,usage:{users:m.filter(x=>x.status!=='disabled').length,devices:d.length,online_devices:d.filter(x=>x.last_seen_at&&Date.now()-new Date(x.last_seen_at).getTime()<90000).length,storage_bytes:med.reduce((s,x)=>s+Number(x.size_bytes||0),0),campaigns:cam.length},members:m.map(x=>({...x,user:um.get(x.user_id)||{id:x.user_id,email:''}}))}});const active=cs.filter(c=>['active','trialing'].includes(c.subscription?.status||''));return{companies:cs,plans:pl.data||[],audits:au.data||[],metrics:{companies:Number(capacity.companies_count??cs.length),max_companies:Number(capacity.max_companies||6),active_companies:cs.filter(c=>c.status==='active').length,suspended_companies:cs.filter(c=>c.status==='suspended').length,users:us.length,devices:(de.data||[]).length,online_devices:(de.data||[]).filter(x=>x.last_seen_at&&Date.now()-new Date(x.last_seen_at).getTime()<90000).length,storage_bytes:Number(capacity.storage_used_bytes??(mi.data||[]).reduce((s,x)=>s+Number(x.size_bytes||0),0)),storage_capacity_mb:Number(capacity.storage_capacity_mb||1024),storage_reserved_mb:Number(capacity.storage_reserved_mb||0),default_company_storage_mb:Number(capacity.default_company_storage_mb||170),mrr_cents:active.reduce((s,c)=>s+Number(c.subscription?.manual_price_cents??c.plan?.monthly_price_cents??0),0)}}}"""
pattern = r"async function dash\(a\)\{.*?\}\nDeno\.serve"
if not re.search(pattern, s, flags=re.S):
    raise SystemExit('marker not found: master-admin dash')
s = re.sub(pattern, new_dash + '\nDeno.serve', s, count=1, flags=re.S)
p.write_text(s)

print('master capacity patch applied')
