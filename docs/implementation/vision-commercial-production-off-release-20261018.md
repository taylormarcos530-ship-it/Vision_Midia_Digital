# Vision Mídia Digital — recibo de implantação comercial DESATIVADA

**Data:** 18/10/2026 (UTC). **Ambiente:** Supabase OFICIAL `fpadgedrgcxrrqflzhjt`.  
**Resultado:** infraestrutura criada e backend atualizado. **PUBLICIDADE DESATIVADA (NO-GO para anunciar em TVs reais).**

## Prova anterior à implantação
- GitHub Actions: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/39149903495
- Código aprovado: `3b13bc8d51511724d44463d6be002cb0f955626c`; **730/730 PASS**, sem falhas ou pulados.
- SQL reviewed: `supabase/sql/vision-commercial-production-install-20261018.sql`. Testado em PGlite isolado com RLS e projeção segura.
- Os arquivos de implantação foram congelados em `supabase/releases/commercial_off_20261018/`. A cópia exata do código anterior foi mantida em `supabase/releases/commercial_off_20261018/rollback/` (gateway v15, Master v6, web-push).
- **Não houve merge da branch inteira**.

## Implantação efetivada e verificada
- Migração no banco oficial: `vision_commercial_official_safe_projection_20261018` — sucesso.
- 5 tabelas `vision_*` comerciais, 5 triggers comerciais, políticas RLS. `source_storage_path`, `source_media_id` e `checksum` são indisponíveis a `authenticated`; `private.vision_portal_data` usa projeção explícita segura.
- 0 anunciantes, campanhas comerciais, revisões, targets e agregados após a instalação.
- Master `master-admin` **v7 ACTIVE**, `verify_jwt=true`. `device-gateway` **v16 ACTIVE**, `verify_jwt=false` (mesma configuração anterior). A fonte implantada de ambos foi comparada caractere por caractere com os arquivos congelados.
- O gate imutável `const COMMERCIAL_RELEASE_APPROVED = false;` fica no Master e nos 3 caminhos do gateway. Mesmo com variáveis ambientais antigas, anúncios e ações comerciais não se tornam ativos.
- Após atualização, a consulta somente leitura encontrou 30 registros de dispositivos, 6 empresas, 0 links comerciais; às **17:36 UTC**, 1 dispositivo ativo teve heartbeat nos 3 minutos anteriores, último `17:35:36 UTC`. Isso sugere comunicação normal de pelo menos um dispositivo; **não é teste de exibição**.
- Antes e depois: Player, APK, TV Life, mídia e playlist de clientes não sofreram atualização ou comando da execução. Vision Menu Digital e Vercel produção não foram modificados.

## Retorno seguro / rollback
1. Enquanto o gate está desativado, **não há anúncios comerciais para desativar em TVs**. Não apague dados, mídias nem playlists.
2. Se `master-admin` v7 ou `device-gateway` v16 apresentarem uma regressão operacional comprovada, restaure somente a Edge específica a partir dos arquivos congelados em `rollback/`, mantendo a mesma configuração `verify_jwt`; valide respostas e heartbeat. Evite rollback amplo de banco.
3. **Não remover o schema** para desligar publicidade: isso afeta histórico futuro e permissões; o gate já está OFF.

## Próximos passos finitos (não executados)
1. Revisar implantação selecionada da UI Master/Anunciante e habilitar operações de campanha apenas com autorização explícita e teste em staging que preserve a restrição A/B; atualmente o gate OFF responde `commercial_staging_not_enabled`.
2. Fazer **piloto físico isolado autorizado**, com responsável no estabelecimento, backup da grade original, teste 4/8 em equipamento controlado, medição real de reprodução e prova de retorno.
3. Somente com piloto GO liberar `COMMERCIAL_RELEASE_APPROVED` e `VISION_COMMERCIAL_ENABLED` para **um UUID autorizado**. Os demais dispositivos seguem sem anúncios. Um rollout de produção mais amplo exige outra autorização.
4. Não publicar APK, Player, Frontend, migrations adicionais, nem mandar comandos a TVs sem aprovação específica.

**Decisão:** implantação de infraestrutura + backend OFF finalizada; divulgação comercial em dispositivos reais = **NO-GO** até piloto e liberação separados.
