from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

p = Path('app.js')
s = p.read_text()

helpers = r'''
  function currentDevicePlanUsage() {
    const plan = (state.publicConfig?.plans || []).find(item => item.id === state.subscription?.plan_id) || null;
    const rawOverride = state.subscription?.limit_overrides?.max_devices;
    const hasOverride = rawOverride !== undefined && rawOverride !== null && rawOverride !== '';
    const limit = Number(hasOverride ? rawOverride : (plan?.max_devices || 0));
    const used = state.devices.filter(device => !device.retired_at).length;
    const available = limit > 0 ? Math.max(0, limit - used) : null;
    return { planName: plan?.name || 'Plano atual', limit, used, available, hasOverride };
  }

  function renderDevicePlanUsage() {
    const box = $('#device-plan-usage');
    if (!box) return;
    const usage = currentDevicePlanUsage();
    const button = $('#add-device-button');
    if (!usage.limit) {
      box.className = 'plan-usage-banner warning';
      box.innerHTML = '<strong>Limite de TVs não definido</strong><span>Fale com o administrador para configurar seu plano.</span>';
      if (button) button.disabled = false;
      return;
    }
    const full = usage.used >= usage.limit;
    box.className = `plan-usage-banner ${full ? 'limit-reached' : ''}`;
    box.innerHTML = `<div><strong>${escapeHtml(usage.planName)}</strong><span>Seu plano permite ${usage.limit} TV${usage.limit === 1 ? '' : 's'}.</span></div><div class="plan-usage-numbers"><b>${usage.used}</b> em uso <span>•</span> <b>${usage.available}</b> disponível${usage.available === 1 ? '' : 'is'}</div>`;
    if (button) {
      button.disabled = full;
      button.title = full ? `Limite atingido: ${usage.used} de ${usage.limit} TVs em uso.` : `${usage.available} vaga(s) de TV disponível(is) no plano.`;
    }
  }

  function friendlyPairDeviceError(error) {
    const message = String(error?.message || error || 'Erro ao parear TV.');
    if (message.includes('plan_device_limit_reached')) {
      const usage = currentDevicePlanUsage();
      if (usage.limit) return `Limite do plano atingido. Seu plano permite ${usage.limit} TV${usage.limit === 1 ? '' : 's'} e você já está usando ${usage.used}. Para adicionar outra, substitua uma TV ou altere o plano.`;
      return 'Limite de TVs do plano atingido. Fale com o administrador para ajustar seu plano.';
    }
    return message;
  }

'''
s = replace_once(s, '  function renderDevices() {\n', helpers + '  function renderDevices() {\n    renderDevicePlanUsage();\n', 'device plan helpers')

s = replace_once(
    s,
    "    } catch (error) {\n      toast('Não foi possível parear', error.message, 'error');\n    } finally { setBusy(button, false); }\n",
    "    } catch (error) {\n      toast('Não foi possível parear', friendlyPairDeviceError(error), 'error', 6500);\n      renderDevicePlanUsage();\n    } finally { setBusy(button, false); }\n",
    'pair error message',
)

p.write_text(s)

p = Path('index.html')
s = p.read_text()
s = replace_once(
    s,
    '          </div>\n\n          <article class="panel player-branding-panel">\n',
    '          </div>\n\n          <div id="device-plan-usage" class="plan-usage-banner">\n            <div><strong>Plano atual</strong><span>Carregando limite de TVs…</span></div>\n          </div>\n\n          <article class="panel player-branding-panel">\n',
    'plan usage banner',
)
p.write_text(s)

p = Path('styles.css')
s = p.read_text()
if '/* DEVICE_PLAN_USAGE_V1 */' not in s:
    s += r'''

/* DEVICE_PLAN_USAGE_V1 */
.plan-usage-banner { display:flex; align-items:center; justify-content:space-between; gap:18px; margin:0 0 16px; padding:14px 16px; border:1px solid var(--line); border-radius:14px; background:rgba(70,105,255,.08); }
.plan-usage-banner > div:first-child { display:flex; flex-direction:column; gap:3px; }
.plan-usage-banner strong { color:var(--text); }
.plan-usage-banner span { color:var(--muted); font-size:.9rem; }
.plan-usage-numbers { display:flex; align-items:center; gap:7px; white-space:nowrap; color:var(--muted); }
.plan-usage-numbers b { color:var(--text); font-size:1.05rem; }
.plan-usage-banner.limit-reached { border-color:rgba(239,68,68,.55); background:rgba(239,68,68,.08); }
.plan-usage-banner.warning { border-color:rgba(245,158,11,.55); background:rgba(245,158,11,.08); }
#add-device-button:disabled { opacity:.55; cursor:not-allowed; }
@media (max-width: 640px) { .plan-usage-banner { align-items:flex-start; flex-direction:column; gap:10px; } .plan-usage-numbers { white-space:normal; } }
'''
p.write_text(s)
