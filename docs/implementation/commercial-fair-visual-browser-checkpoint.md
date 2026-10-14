# Checkpoint — homologação visual isolada da distribuição comercial

**Repositório:** `taylormarcos530-ship-it/Vision_Midia_Digital`
**Branch:** `fix/advertiser-portal-safety-20261013`
**Base validada:** `579dac6203d16510ec22922f748e9b762fd1a983`
**Escopo:** somente scripts de teste e workflow próprio na branch de teste. Nenhuma alteração nas páginas do cliente, player, APK, gateway, banco Supabase ou Edge Functions. Sem deploy de nenhum site.

## Execução comprovada

- Criado `tests/browser/commercial-fair-visual-browser.cjs`: usa Chromium real via Playwright Core somente no runner GitHub, servidor HTTP temporário em `127.0.0.1` e allowlist explícita dos 4 arquivos de laboratório. Bloqueia e mede tentativas de requisições externas.
- Criado `.github/workflows/commercial-fair-visual-chromium.yml`: só roda na branch de testes; credenciais do checkout não são persistidas; `contents: read`, navegador instalado no runner; Playwright Core temporário sem mudar `package-lock.json`; etapas guardiãs conferem diff de arquivos operacionais e recusam rodar se houve mudança. Capturas disponibilizadas como artefato temporário GitHub Actions por 7 dias.
- **Chromium PASS:** 67 verificações em larguras 320, 390, 768 e 1280 CSS px, incluindo emulação de smartphone (viewport/touch), inicialização, fila, clicks de controles, dez rodadas com distribuição fictícia equitativa (4 anúncios concluídos por cada uma das cinco empresas em 10 rodadas), retirada de anunciante durante o item, preservação de todos os itens base, exclusão de callbacks antigos, erro de mídia comercial com interrupção segura, revalidação para rodada seguinte, desconexão/reconexão/reinício simulado, e TV sem playlist exibindo "Aguardando playlist".
- **Zero erros de página** e **zero pedidos de rede externos**. A interface permaneceu dentro da largura da viewport (sem scroll horizontal) em todos os tamanhos verificados. Capturas da tela móvel (390px), desktop (1280px) e móvel após desativação/playlist vazia foram inspecionadas visualmente: títulos, cards, indicadores e controles permanecem exibidos e legíveis.
- **17/17 testes de modelo e UI** no workflow Chromium. **244/244 testes totais** no workflow geral de segurança, sem falhas; verificação do guardião de arquivos operacionais também PASS.

CI:
- Segurança: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38642486971
- Browser: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38642487048
- Capturas: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38642487048/artifacts/11931565187 (artefato temporário).

## Limitações e continuidade

A emulação de smartphone com Chromium **não é** um teste do Android físico nem prova de execução na TV Box Smart Pro 3000. Não foi testada produção, Auth, storage real, plano de mídia operacional nem anunciante verdadeiro. A distribuição justa da bancada **ainda não está integrada ao gateway**: este não recebe automaticamente índices de rodada dos players dos clientes, logo não é correto prometer distribuição comercial equitativa real.

**Próximo passo seguro:** formalizar apenas em documento e testes de contrato offline a identidade da programação/rodada, regra de invalidação de mídia antiga, alteração de campanhas e compatibilidade de players legados; não mexer no player/APK/gateway até ter infraestrutura de homologação real e autorização.

**Invariantes permanentes:** nenhuma alteração em `player.js`, arquivos android-player, playlists, dados Supabase, Edge Functions, `device-gateway/index.ts` ou demais componentes em produção; nenhum deploy.
