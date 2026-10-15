# Rede Vision — checkpoint: custódia independente simulada para a âncora SHA-256

**Checkpoint inicial preservado:** `a90c6f7e4ac1061b01ad21b936e2b59f6949eb99`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Escopo:** ensaio offline de **histórico de evidências sintéticas**, sem ações em Supabase, GitHub releases, storage externo, TVs, player, APK, Edge Functions, banco ou produção.

## Resultado auditável

- **Regressão total: 532/532 PASS, 0 FAIL**. Guarda dos arquivos operacionais **PASS**: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38769191056
- **24 testes novos** (21 de rotação/comparação de âncora e 3 de CLI), preservando todos os **508** do checkpoint anterior.
- Primeiro teste da implementação: 529/529 PASS, guardião aprovado: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38768972200
- Arquivos alterados apenas em `tests/` e nesta documentação. Sem alteração ou publicação no portal operacional, player Android, APK, playlists, gateway, banco, SQL, Storage ou clientes.

## O que foi adicionado

1. `tests/fixtures/commercial-evidence-external-anchor.cjs`: contrato de **âncoras de laboratório** com versão, número sequencial, quantidade de registros comprometidos, `headHash` da cadeia, `previousAnchorHash`, carimbo UTC declarado e `receiptHash` SHA-256. Usa prefixo de domínio criptográfico separado do hash de snapshots. O primeiro registro aponta para marcador inicial fixo; o seguinte aponta para o hash da âncora anterior.
2. `tests/commercial-evidence-external-anchor.test.cjs`: testa rotação 2→3 registros, checksum adulterado, datas regressivas, índice repetido, histórico reescrito, truncamento, extensão não ancorada, ponteiro incorreto, referência final conservada separadamente e tentativa de inserir conteúdo adicional não permitido.
3. `tests/tools/commercial-evidence-external-anchor-report.cjs`: comando somente leitura dos **três snapshots fictícios fixos**. O `independentlyHeldDigest` usado no exemplo é guardado somente na memória do mesmo processo; **não existe um custodiador independente real**.
4. `tests/commercial-evidence-external-anchor-cli.test.cjs`: verifica relatório legível, sem hashes completos/URLs e sem leitura de arquivos externos.
5. Este documento especifica a fronteira de confiança e os critérios para uma eventual aplicação futura.

## Testes de ameaça e resultados

| Situação | Resultado no laboratório |
|---|---|
| Duas âncoras válidas; a segunda compromete o registro 3 | A cadeia de registros e a rotação de âncoras permanecem consistentes |
| Registro antigo editado e histórico/recibos recalculados | A cadeia **interna** pode voltar a parecer válida, mas diverge do último digest **anteriormente guardado** fora da reescrita |
| Remover o registro 3, mantendo a âncora que compromete 3 | `ANCHORED_RECORD_MISSING` |
| Remover registro 3 **e** sua âncora | O prefixo pode parecer coerente **sem referência externa**; a referência da última âncora anterior revela `INDEPENDENT_HEAD_MISMATCH` |
| Adicionar registro ainda não ancorado | `UNANCHORED_HISTORY_TAIL`; exigir próxima rotação antes do arquivamento |
| Alterar `headHash`, `receiptHash` ou `previousAnchorHash` | Erros de vínculo, hash ou cabeça: `HISTORY_HEAD_MISMATCH`, `ANCHOR_RECEIPT_TAMPERED`, `ANCHOR_LINK_MISMATCH` |
| Reutilizar número, repetir checkpoint ou regredir horário | Registro recusado ou `ANCHOR_ROTATION_NOT_MONOTONIC` |
| Reescrever cadeia e **também** substituir a cópia da referência externa | Pode passar na checagem interna. A origem da âncora **não** é certificada pelo algoritmo |
| Digest fornecido separadamente coincide | Igualdade de bits; **não comprova** identidade, autoridade, procedência de staging ou permissão para deploy |

## Especificação para custódia realmente independente — NÃO IMPLEMENTADA

Para um uso real futuro, seria necessário desenhar e aprovar, fora do mesmo domínio de escrita do histórico:

- **Separação de responsabilidades:** executor produz histórico e `receiptHash`; guardião de auditoria independente recebe a referência; revisor consulta esse guardião por uma identidade/canal autenticados próprios. O executor **não pode alterar retroativamente** a referência publicada.
- **Armazenamento e retenção:** destino distinto do repositório/CI e das credenciais do aplicativo, registro append-only ou mecanismo equivalente com retenção, controle de versões e histórico de acesso. Regras de recuperação e renovação de chaves/sessões precisam de revisão de segurança.
- **Campos mínimos:** versão, ID opaco de lote, contador da âncora, número de registros, hash do último registro, hash da âncora anterior, hash do recibo, horário UTC declarado e, quando autorizado, confirmação assinada/registrada de recebimento pelo guardião. **Nenhum JWT, URL assinada, caminho de mídia de estabelecimento ou resposta bruta do Supabase.**
- **Rotação:** emitir próxima âncora quando um lote aprovado for arquivado; conferir contador estritamente crescente, digest anterior, cobertura integral do histórico e confirmação independente de persistência antes de considerar o lote guardado. Em conflito ou indisponibilidade, **bloquear a homologação** e manter a fila local não certificada; nunca aceitar “sucesso” por fallback silencioso.
- **Leitura e revisão:** revisor recupera a cabeça preservada de um canal independente, compara com histórico/recibos, registra divergências e verifica integridade e proveniência das provas **separadamente**. Um `MATCH` só informa integridade criptográfica sob essas premissas.
- **Proteções:** políticas de privilégio mínimo, segregação de credenciais, monitoramento de rotação e tratamento de exclusão acidental, restauração indevida ou comprometimento duplo. Um provedor/serviço concreto ainda teria de ser avaliado e expressamente autorizado.
- **Custo e privacidade:** medir bytes, operações e retenção com artefatos fictícios antes de contratar serviço, publicar chaves, mover evidências ou atribuir valor legal ao carimbo de hora.

**Não há nenhum serviço ou conta conectada para realizar esse armazenamento.** O código desta rodada apenas demonstra a comparação contra um digest passado pelo chamador, **sem autenticar quem guardou ou forneceu o digest**. Os campos `independentAnchorAuthenticityVerified`, `stagingOriginVerified`, `canConnectStaging`, `canRunRealStaging` e `canDeployToProduction` continuam permanentemente `false` no ensaio.

## Reprodução isolada

```bash
node tests/tools/commercial-evidence-external-anchor-report.cjs
npm test
```

O primeiro comando escreve apenas diagnóstico redigido: cadeia consistente, referência simulada coincidente e **custódia independente não demonstrada**. O segundo executa testes e guarda de regressão. Nenhum comando tenta entrar em banco, editar projeto, instalar software em TV ou fazer deploy.

## Bloqueios do produto mantidos

**Staging: 0/17 critérios homologados**. `SQL-01` e `SQL-02` continuam **BLOCKED**: o SQL revisável `supabase/sql/advertiser-portal.sql` expõe colunas `source_*` via leitura ampla/serialização `to_jsonb(r)`. A correção de projeção/GRANT permanece apenas na fixture descartável `tests/fixtures/commercial-safe-projection-lab.sql`; nenhum SQL remoto foi alterado. **O portal comercial não está autorizado para produção.**

**Próxima etapa segura:** revisar em laboratório o **modelo de acesso do guardião** e simular indisponibilidade, duas escritas conflitantes, recuperação de recibos e restauração de backups, ainda sem integração real nem credenciais. Registrar como pendência a decisão de política de entrega das prévias (URLs curtas com exposição residual ou autorização por GET/Range).

**Preservação:** não restaurar baseline, não fazer merge nem deploy, não atualizar APK, não alterar player, playlists, gateway, banco, Edge Functions, Storage ou TVs de clientes sem autorização específica.
