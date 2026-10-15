# Vision Mídia Digital — homologação Chromium do portal do anunciante com prévia segura

**Checkpoint de origem:** `a015d96186bbab523b09ab2173d1df169114d235`.  
**Branch preservada:** `fix/advertiser-portal-safety-20261013`.  
**Escopo desta etapa:** criar apenas testes Chromium, workflow isolado e documentação. **Nenhum deploy, nenhuma alteração em player/APK/gateway, nenhuma migration Supabase e nenhuma ativação comercial.**

## Evidência da execução

- **Chromium real:** 62 verificações aprovadas; janelas CSS de **320, 390, 768 e 1280 px** sem scroll horizontal; 0 `pageerror` e 0 pedidos de rede externos ao servidor de teste.
- **GitHub Actions Chromium:** https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38664274791 — SUCCESS.
- **Regressão geral:** 341/341 testes PASS, 0 FAIL; proteção de arquivos operacionais PASS. https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38664274766
- **Capturas:** disponíveis por 7 dias no artefato temporário [vision-commercial-portal-sanitized-browser](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38664274791/artifacts/11939679985), incluindo dashboard mobile 390px, desktop 1280px e versão com recusa do Storage.

## Arquivos novos

- `tests/browser/commercial-portal-sanitized-browser.cjs`: navegador real com servidor HTTP exclusivamente no loopback, allowlist de arquivos estáticos e bloqueio de toda requisição externa. Substitui a configuração Supabase por fixture local e responde às rotas fictícias de Auth, RPC e assinatura de Storage, sem contas ou tokens verdadeiros.
- `.github/workflows/commercial-portal-sanitized-chromium.yml`: executa somente na branch de laboratório, inclui controle de diff de arquivos operacionais protegidos, instala o Playwright Core temporariamente **sem editar lockfile**, usa Chromium do runner e publica capturas como artefatos de vida curta.
- Este relatório.

## Cenários validados

1. Renderização responsiva real das campanhas, métricas, pontos e cards de prévia em quatro larguras. Imagem comercial fictícia de fato decodificada pelo Chromium usando resposta `image/svg+xml` no endereço local de uma cópia com extensão `.webp`; isso **não comprova decodificação WebP real**, apenas carregamento de imagem e URL.
2. Elemento `video` gerado com controles e URL assinada equivalente à cópia comercial solicitada. O servidor envia conteúdo `video/mp4` vazio por opção, portanto **não comprova decode ou reprodução de MP4**.
3. Apenas caminhos `commercial-ads/<UUID>.webp` e `commercial-ads/<UUID>.mp4` são solicitados para assinatura. Um caminho fictício `private-owner/` não solicita assinatura nem aparece na prévia.
4. Recusa `403` do Storage mantém as campanhas visíveis e sinaliza que a prévia está indisponível, sem erro de script ou remoção da playlist.
5. URL assinada com domínio externo não é incorporada no DOM nem solicitada ao servidor externo.
6. Resposta `403 advertiser_unavailable` da RPC fecha o painel, apaga as campanhas da interface e limpa a sessão no browser.
7. Logout retorna ao formulário, remove os dados de campanha e limpa a sessão.
8. A resposta do portal inclui apenas campos comerciais exemplificativos: nenhum caminho, ID ou checksum de mídia original está presente na resposta fictícia.

## Limites importantes

- **Segurança do banco ainda pendente de homologação fora do laboratório.** O SQL revisável `supabase/sql/advertiser-portal.sql` continua inalterado e ainda tem o problema de exposição de metadados do estabelecimento se usado sem o patch isolado `tests/fixtures/commercial-safe-projection-lab.sql`. Os testes de browser NÃO fazem consultas Supabase reais.
- As respostas de autenticação e assinatura são simuladas; URL curta não garante por si só tenant isolation. A autorização definitiva depende de Storage RLS, token verificado e política de objetos no servidor.
- O vídeo não foi reproduzido, os codecs Android TV não foram testados e não foram utilizadas TVs dos clientes.
- Testes de interface e API emulado não provam exibição física, contagem auditável ou capacidade de cobrança de anúncios.

## Próxima etapa segura

Continuar na mesma branch, sem código operacional. Preparar fixture MP4 mínima verdadeira (produzida localmente no runner) para validar `loadedmetadata` e um ciclo de reprodução em Chromium, além de conferir o fallback de vídeo indisponível e a ausência de chamadas externas. Só então planejar o fluxo de prévia com Storage real em staging autorizado; **nunca atualizar a TV Box de cliente sem autorização explícita**.

## Preservação

Arquivos oficiais `player.js`, `android-player/`, `device-gateway/index.ts`, playlists, `playback_logs`, SQL Supabase operacional e parâmetros de Netlify/Vercel continuam inalterados; o workflow não publica produção, não cria contas nem acessa banco remoto.
