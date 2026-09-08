from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# ---- master.html ----
p = Path('master.html')
s = p.read_text()
s = replace_once(s,
    '<form id="master-plan-form" class="dialog-body">',
    '<form id="master-plan-form" class="dialog-body" novalidate>',
    'plan form')
s = replace_once(s,
    '<label>Descrição<input id="mp-description" maxlength="500" /></label>',
    '<label>Descrição<input id="mp-description" required maxlength="500" /></label>',
    'description required')
s = replace_once(s,
    '<div class="form-grid two"><label>Preço mensal (R$)<input id="mp-price" inputmode="decimal" required /></label><label>Ordem<input id="mp-order" type="number" value="0" /></label></div>',
    '<div class="form-grid two"><label>Preço mensal (R$)<input id="mp-price" inputmode="decimal" required /></label><label>Ordem<input id="mp-order" type="number" min="0" step="1" value="0" required /></label></div>',
    'price/order required')
s = replace_once(s,
    '<div class="form-grid four"><label>TVs<input id="mp-devices" type="number" min="0" /></label><label>Armazenamento MB<input id="mp-storage" type="number" min="0" /></label><label>Usuários<input id="mp-users" type="number" min="1" /></label><label>Campanhas<input id="mp-campaigns" type="number" min="0" /></label></div>',
    '<div class="form-grid four"><label>TVs<input id="mp-devices" type="number" min="0" required /></label><label>Armazenamento MB<input id="mp-storage" type="number" min="0" required /></label><label>Usuários<input id="mp-users" type="number" min="1" required /></label><label>Campanhas<input id="mp-campaigns" type="number" min="0" required /></label></div>',
    'plan limits required')
s = replace_once(s,
    '<label class="switch-line"><input id="mp-active" type="checkbox" checked /> Plano disponível para novas assinaturas</label>',
    '<p class="helper">Todos os campos do plano são obrigatórios. O sistema não salva enquanto houver campo vazio ou inválido.</p>\n      <label class="switch-line"><input id="mp-active" type="checkbox" checked /> Plano disponível para novas assinaturas</label>',
    'plan required helper')
p.write_text(s)

# ---- master.js ----
p = Path('master.js')
s = p.read_text()
old = """  async function savePlan(ev){ev.preventDefault();const b=$('#mp-save');const price=reaisToCents($('#mp-price').value);if(price===null){planStatus('❌ Informe um preço mensal válido.','error');return}busy(b,true,'Salvando...');planStatus('Salvando...','pending');try{await savePlanRequest({id:$('#mp-id').value||null,name:$('#mp-name').value.trim(),slug:$('#mp-slug').value.trim(),description:$('#mp-description').value.trim(),monthly_price_cents:price,max_devices:planIntOrNull('#mp-devices'),storage_limit_mb:planIntOrNull('#mp-storage'),max_users:planIntOrNull('#mp-users'),max_campaigns:planIntOrNull('#mp-campaigns'),is_active:$('#mp-active').checked,sort_order:Number($('#mp-order').value||0)});planStatus('✅ Plano salvo com sucesso.','success');closeDialog('master-plan-dialog');toast('Plano salvo','Alterações aplicadas com sucesso.');await load().catch(e=>toast('Plano salvo, mas a lista não atualizou',e.message,'error'))}catch(e){const msg=friendlyPlanError(e);planStatus(`❌ ${msg}`,'error');toast('Erro ao salvar plano',msg,'error')}finally{busy(b,false)}}
"""
new = """  function validatePlanForm(){
    const required=[['#mp-name','Nome'],['#mp-slug','Slug'],['#mp-description','Descrição'],['#mp-price','Preço mensal'],['#mp-order','Ordem'],['#mp-devices','TVs'],['#mp-storage','Armazenamento MB'],['#mp-users','Usuários'],['#mp-campaigns','Campanhas']];
    const missing=required.filter(([selector])=>String($(selector)?.value??'').trim()==='');
    if(missing.length){planStatus(`❌ Preencha todos os campos obrigatórios. Falta: ${missing.map(([,label])=>label).join(', ')}.`,'error');$(missing[0][0])?.focus();return null}
    const name=$('#mp-name').value.trim(),slug=$('#mp-slug').value.trim(),description=$('#mp-description').value.trim();
    const price=reaisToCents($('#mp-price').value),sortOrder=Number($('#mp-order').value),maxDevices=Number($('#mp-devices').value),storageMb=Number($('#mp-storage').value),maxUsers=Number($('#mp-users').value),maxCampaigns=Number($('#mp-campaigns').value);
    if(name.length<2){planStatus('❌ Informe um nome de plano válido.','error');$('#mp-name').focus();return null}
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){planStatus('❌ O slug deve usar apenas letras minúsculas, números e hífen.','error');$('#mp-slug').focus();return null}
    if(description.length<2){planStatus('❌ Preencha a descrição do plano.','error');$('#mp-description').focus();return null}
    if(price===null||price<0){planStatus('❌ Informe um preço mensal válido.','error');$('#mp-price').focus();return null}
    if(!Number.isInteger(sortOrder)||sortOrder<0){planStatus('❌ Informe uma ordem válida.','error');$('#mp-order').focus();return null}
    if(!Number.isInteger(maxDevices)||maxDevices<0){planStatus('❌ Informe a quantidade de TVs.','error');$('#mp-devices').focus();return null}
    if(!Number.isInteger(storageMb)||storageMb<0){planStatus('❌ Informe o armazenamento em MB.','error');$('#mp-storage').focus();return null}
    if(!Number.isInteger(maxUsers)||maxUsers<1){planStatus('❌ O plano deve permitir pelo menos 1 usuário.','error');$('#mp-users').focus();return null}
    if(!Number.isInteger(maxCampaigns)||maxCampaigns<0){planStatus('❌ Informe a quantidade de campanhas.','error');$('#mp-campaigns').focus();return null}
    return {id:$('#mp-id').value||null,name,slug,description,monthly_price_cents:price,max_devices:maxDevices,storage_limit_mb:storageMb,max_users:maxUsers,max_campaigns:maxCampaigns,is_active:$('#mp-active').checked,sort_order:sortOrder};
  }
  async function savePlan(ev){
    ev.preventDefault();
    const payload=validatePlanForm();
    if(!payload)return;
    const b=$('#mp-save');
    busy(b,true,'Salvando...');
    planStatus('Salvando...','pending');
    try{
      const result=await savePlanRequest(payload);
      if(!result?.ok||!result?.plan?.id)throw new Error('O servidor não confirmou o salvamento do plano.');
      $('#mp-id').value=result.plan.id;
      $('#mp-title').textContent='Editar plano';
      planStatus('✅ Salvo com sucesso. As alterações foram aplicadas.','success');
      toast('Salvo com sucesso',`Plano ${result.plan.name||payload.name} atualizado.`);
      await load().catch(e=>toast('Plano salvo, mas a lista não atualizou',e.message,'error'));
    }catch(e){
      const msg=friendlyPlanError(e);
      planStatus(`❌ Erro ao salvar: ${msg}`,'error');
      toast('Erro ao salvar plano',msg,'error');
    }finally{busy(b,false)}
  }
"""
s = replace_once(s, old, new, 'savePlan')
p.write_text(s)

# ---- app.js ----
p = Path('app.js')
s = p.read_text()
marker = "  async function handleMediaUpload(file) {\n"
helper = r'''  async function optimizeImageForUpload(file) {
    const original = { file, name: file.name, optimized: false, originalSize: file.size };
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return original;
    let url = null;
    try {
      url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        const timeout = setTimeout(() => reject(new Error('Tempo excedido ao otimizar imagem.')), 15000);
        el.onload = () => { clearTimeout(timeout); resolve(el); };
        el.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível abrir a imagem para otimização.')); };
        el.src = url;
      });
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      if (!sourceWidth || !sourceHeight) return original;

      // Mantém a resolução original quando já está dentro de 4K e nunca amplia imagem pequena.
      const maxEdge = 3840;
      const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return original;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (!blob || !blob.size) return original;
      // Se não houver ganho de tamanho, preserva o arquivo original e sua qualidade original.
      if (blob.size >= file.size) return original;
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 110) || 'imagem';
      const optimizedFile = new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
      return { file: optimizedFile, name: optimizedFile.name, optimized: true, originalSize: file.size, width, height };
    } catch (error) {
      console.warn('Otimização WebP ignorada; usando arquivo original.', error);
      return original;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

'''
if helper.strip() not in s:
    if marker not in s:
        raise SystemExit('handleMediaUpload marker not found')
    s = s.replace(marker, helper + marker, 1)

old = """    const progress = $('#media-progress');
    const progressText = $('#media-progress-text');
    let uploadedPath = null;
    progress.classList.remove('hidden');
    try {
      progressText.textContent = 'Lendo informações do arquivo';
      const meta = await getMediaMetadata(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);
      const objectPath = `${state.company.id}/${crypto.randomUUID()}-${safeName}`;
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');

      progressText.textContent = `Enviando ${formatBytes(file.size)}`;
      await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, {
        body: file,
        contentType: file.type || 'application/octet-stream',
        extraHeaders: { 'x-upsert': 'false' },
      });
      uploadedPath = objectPath;

      progressText.textContent = 'Registrando mídia na biblioteca';
      await restRequest('media_assets', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          name: file.name,
          media_type: file.type.startsWith('video/') ? 'video' : 'image',
          mime_type: file.type || null,
          storage_path: objectPath,
          source_url: null,
          duration_seconds: meta.duration,
          size_bytes: file.size,
          width: meta.width,
          height: meta.height,
          processing_status: 'ready',
          created_by: state.user.id,
        },
        prefer: 'return=minimal',
      });
      uploadedPath = null;
      toast('Mídia enviada', file.name);
      await loadAllData();
"""
new = """    const progress = $('#media-progress');
    const progressText = $('#media-progress-text');
    let uploadedPath = null;
    let uploadFile = file;
    let uploadName = file.name;
    let optimization = null;
    progress.classList.remove('hidden');
    try {
      if (file.type.startsWith('image/')) {
        progressText.textContent = 'Otimizando imagem em alta qualidade para WebP';
        optimization = await optimizeImageForUpload(file);
        uploadFile = optimization.file;
        uploadName = optimization.name;
      }
      progressText.textContent = 'Lendo informações do arquivo';
      const meta = await getMediaMetadata(uploadFile);
      const safeName = uploadName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);
      const objectPath = `${state.company.id}/${crypto.randomUUID()}-${safeName}`;
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');

      progressText.textContent = `Enviando ${formatBytes(uploadFile.size)}`;
      await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, {
        body: uploadFile,
        contentType: uploadFile.type || 'application/octet-stream',
        extraHeaders: { 'x-upsert': 'false' },
      });
      uploadedPath = objectPath;

      progressText.textContent = 'Registrando mídia na biblioteca';
      await restRequest('media_assets', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          name: uploadName,
          media_type: uploadFile.type.startsWith('video/') ? 'video' : 'image',
          mime_type: uploadFile.type || null,
          storage_path: objectPath,
          source_url: null,
          duration_seconds: meta.duration,
          size_bytes: uploadFile.size,
          width: meta.width,
          height: meta.height,
          processing_status: 'ready',
          created_by: state.user.id,
        },
        prefer: 'return=minimal',
      });
      uploadedPath = null;
      const detail = optimization?.optimized
        ? `${uploadName} • otimizada ${formatBytes(optimization.originalSize)} → ${formatBytes(uploadFile.size)} sem ampliar a imagem`
        : uploadName;
      toast('Mídia enviada', detail);
      await loadAllData();
"""
s = replace_once(s, old, new, 'media upload')
p.write_text(s)

# ---- index.html ----
p = Path('index.html')
s = p.read_text()
s = replace_once(s,
    '<p>Envie imagens e vídeos para uso nas playlists.</p>',
    '<p>Envie imagens e vídeos. JPEG/PNG são otimizadas automaticamente para WebP em alta qualidade, mantendo a resolução original quando já estiver até 4K.</p>',
    'media helper text')
p.write_text(s)

print('patch applied')
