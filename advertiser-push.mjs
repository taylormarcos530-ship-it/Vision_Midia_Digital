// Advertiser-only opt-in. No timer, no campaign writes and no Master/TV subscriptions.
export function createAdvertiserPushControls(api) {
  const $ = selector => document.querySelector(selector);
  const enable = $('#advertiser-push-enable');
  const disable = $('#advertiser-push-disable');
  const test = $('#advertiser-push-test');
  const label = $('#advertiser-push-status');
  let attachedAdvertiserId = null;
  let busy = false;
  let active = false;
  let generation = 0;

  function status(message, isError = false) {
    if (!label) return;
    label.textContent = message;
    label.classList.toggle('push-error', Boolean(isError));
  }
  function render() {
    if (enable) { enable.hidden = active; enable.disabled = busy; }
    if (disable) { disable.hidden = !active; disable.disabled = busy; }
    if (test) { test.hidden = !active; test.disabled = busy; }
  }
  async function localSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.getRegistration('./');
    return reg?.pushManager?.getSubscription() || null;
  }
  function supportError() {
    if (!window.isSecureContext) return 'As notificações precisam de um endereço HTTPS seguro.';
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window))
      return 'Este navegador não oferece notificações push. No iPhone, adicione o portal à Tela de Início e abra por esse atalho.';
    if (Notification.permission === 'denied')
      return 'Notificações bloqueadas. Libere nas configurações do navegador ou do Android.';
    return null;
  }
  function decodeVapidKey(value) {
    const padded = value + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded.replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  async function statusRefresh(forAdvertiserId) {
    const mine = await localSubscription();
    const response = await api.request('/functions/v1/advertiser-push', {
      body: { action: 'status', ...(mine ? {endpoint:mine.endpoint} : {}) },
    });
    if (forAdvertiserId !== attachedAdvertiserId) return;
    active = Boolean(mine && response.subscribed && Notification.permission === 'granted');
    render();
    status(active
      ? 'Notificações ativadas neste aparelho. Você receberá avisos mesmo com o portal fechado.'
      : 'Ative para receber avisos quando suas campanhas vencerem.');
  }

  async function attach(advertiserId) {
    if (!advertiserId || !enable || attachedAdvertiserId === advertiserId) return;
    attachedAdvertiserId = advertiserId;
    const thisGeneration = ++generation;
    const compatibility = supportError();
    if (compatibility) { active = false; render(); status(compatibility, true); return; }
    try {
      await statusRefresh(advertiserId);
    } catch {
      if (thisGeneration === generation) {
        active = false; render();
        status('Não foi possível consultar as notificações. Tente ativar novamente.', true);
      }
    }
  }
  async function activate() {
    if (busy || !attachedAdvertiserId) return;
    const compatibility=supportError();
    if (compatibility) return status(compatibility,true);
    // Must request permission directly from the advertiser's click.
    const permission=await Notification.requestPermission();
    if (permission !== 'granted') return status('Permissão não concedida. Ative nas configurações do aparelho.',true);
    busy=true;render();
    try {
      const response=await api.request('/functions/v1/advertiser-push',{body:{action:'status'}});
      if(!response.public_key) throw new Error('Chave pública de push indisponível.');
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready;
      let sub=await registration.pushManager.getSubscription();
      if(!sub) sub=await registration.pushManager.subscribe({
        userVisibleOnly:true, applicationServerKey:decodeVapidKey(response.public_key),
      });
      const subscription=sub.toJSON();
      await api.request('/functions/v1/advertiser-push',{
        body:{action:'subscribe',endpoint:sub.endpoint,subscription},
      });
      active=true;status('Notificações ativadas neste celular. Use o botão de teste para conferir.');
    }catch(error){
      active=false;
      status('Não foi possível ativar: '+String(error?.message||'erro de conexão'),true);
    }finally{busy=false;render();}
  }

  async function sendTest() {
    if(busy || !active) return;
    busy=true;render();
    try{
      const sub=await localSubscription();
      if(!sub) throw new Error('Notificação não registrada neste aparelho.');
      const response=await api.request('/functions/v1/advertiser-push',{
        body:{action:'test',endpoint:sub.endpoint},
      });
      if(!response.sent) throw new Error('O serviço de push não confirmou o envio.');
      status('Teste enviado para este aparelho. Confira as notificações do celular.');
    }catch(error){
      const reason=String(error?.message||'erro de entrega');
      status(reason==='push_test_cooldown'
        ? 'O teste já foi solicitado recentemente. Tente novamente após 5 minutos.'
        : 'Teste não confirmado: '+reason,true);
    }finally{busy=false;render();}
  }

  async function deactivate() {
    if(busy || !attachedAdvertiserId) return;
    busy=true;render();
    try{
      const sub=await localSubscription();
      if(sub) await api.request('/functions/v1/advertiser-push',{
        body:{action:'unsubscribe',endpoint:sub.endpoint},
      });
      // Keep browser-level subscription intact: it may also serve the Vision Master app.
      active=false;status('Avisos de vencimento desativados neste aparelho.');
    }catch(error){status('Não foi possível desativar: '+String(error?.message||'erro'),true);}
    finally{busy=false;render();}
  }
  async function onLogout() {
    // An explicit logout invalidates this advertiser device registration, avoiding
    // notifications on a shared phone; closing the browser does not log out.
    const sub=await localSubscription().catch(()=>null);
    let serverUnsubscribed = true;
    if(sub) {
      try {
        await api.request('/functions/v1/advertiser-push',{
          body:{action:'unsubscribe',endpoint:sub.endpoint},retry:false,
        });
      } catch { serverUnsubscribed = false; }
    }
    attachedAdvertiserId=null;generation++;active=false;render();status('');
    return serverUnsubscribed;
  }
  enable?.addEventListener('click',()=>{void activate();});
  disable?.addEventListener('click',()=>{void deactivate();});
  test?.addEventListener('click',()=>{void sendTest();});
  render();
  return { attach, onLogout };
}
