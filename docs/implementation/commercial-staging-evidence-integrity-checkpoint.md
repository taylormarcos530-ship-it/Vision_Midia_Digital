# Rede Vision — checkpoint de integridade de evidências SHA-256

**Ponto de partida preservado:** `2b1c703707ce97bca59874c7c01845b98e496a72`  
**Branch isolada:** `fix/advertiser-portal-safety-20261013`  
**Conclusão:** a identidade dos bytes de **um artefato fictício** foi conferida com SHA-256. Isso **não** certifica a origem do arquivo, a veracidade de seu conteúdo, a autorização de staging ou a segurança do portal comercial em ambiente real.

## Resultado verificado

- **Regressão geral:** **465/465 testes PASS, 0 falhas**, com proteção dos arquivos operacionais aprovada: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/38734062780
- **Novos testes:** 18, para correspondência SHA-256, adulteração do arquivo, valor declarado desatualizado, caminho ausente, tamanho excessivo, symlink, hardlink, origem de evidência autodeclarada, JSON com propriedades inesperadas, diretório não autorizado e relatório sem conteúdo sensível.
- **Escopo:** nenhum arquivo operacional, SQL de produção, função Edge, banco, bucket, dispositivo, player, APK ou playlist foi alterado. Apenas arquivos de fixture, testes, ferramenta local somente leitura e esta documentação foram adicionados na branch isolada.

## Como funciona

1. O formulário original `docs/implementation/commercial-staging-evidence-template.json` permanece **inteiramente sem evidências**, com 15 requisitos `NOT_RUN` e dois requisitos `BLOCKED` (`SQL-01`, `SQL-02`).
2. `tests/fixtures/commercial-evidence-lab/EV-00000001.json` é um artefato **inteiramente sintético**, sem informações comerciais ou pessoais, que declara apenas `fixture=VISION-LAB-ONLY`, `gate=ENV-02`, referência opaca e `result=SIMULATED`. Nenhuma conta ou ambiente foi realmente verificado.
3. `docs/implementation/commercial-staging-evidence-lab-example.json` é uma **cópia separada do formulário**, com exatamente uma referência de origem **LAB**, ainda no estado `NOT_RUN`. O SHA-256 declarado para esse arquivo fictício é `3c3f14fb6e5a9bdb599797434c4b3c0db1f64f63168acd1c40fe65ec0e5f17bb`.
4. `tests/fixtures/commercial-evidence-integrity.cjs` chama primeiro o validador de estrutura do formulário, permite apenas a pasta sintética fixa ou diretórios temporários `vision-evidence-lab-*` para testes, constrói o nome de arquivo exclusivamente pela referência opaca validada e recusa links simbólicos, arquivos com links físicos adicionais, tamanho acima de 16 KiB e JSON que não identifique o artefato fictício esperado.
5. A rotina calcula SHA-256 dos **bytes realmente lidos** e compara com o digest declarado. Resultados: `MATCH`, `MISMATCH`, `MISSING`, `REJECTED` e `SOURCE_UNVERIFIED`. O relatório exibe apenas IDs opacos e resultados; não inclui os bytes, pathname completo ou o digest.
6. Evidência com origem `STAGING` **não é autenticada** por esse verificador de **LAB**: aparece como `SOURCE_UNVERIFIED` mesmo que seu hash declarado seja igual a bytes fictícios conhecidos. Um formulário inteiro com `PASS` autodeclarado também não concede acesso a staging ou deploy.
7. `tests/tools/commercial-evidence-hash-report.cjs` executa **somente a verificação da fixture fixa do repositório**, sem aceitar argumentos de caminho arbitrário e sem chamadas remotas ou gravação de arquivos.

Para reproduzir a conferência **no checkout local dessa branch**, sem dados reais:

```bash
node tests/tools/commercial-evidence-hash-report.cjs
npm test
```

O primeiro comando deve exibir `ENV-02 | EV-00000001 | LAB | MATCH` e avisar que staging e produção **não foram autorizados**. O segundo executa toda a regressão existente. Não usar hashes de dados de clientes nem copiar arquivos reais para essas fixtures.

## Limites de interpretação

Uma soma SHA-256 correspondente evidencia apenas que **o arquivo local corresponde ao hash que foi informado**, sob as premissas dessa máquina e desse teste. Não comprova que o hash foi aprovado por um revisor independente, que o conteúdo é verdadeiro, que a origem é um Supabase segregado, que o arquivo não contém dados ilícitos em outro contexto ou que algum requisito funcional foi homologado.

Em um futuro staging **expressamente autorizado**, a procedência exigirá um protocolo próprio de coleta e revisão de artefatos, identidade de executor e revisor, controle de acesso e auditoria. A ferramenta atual é propositalmente incapaz de acessar serviços externos, validar `source=STAGING` ou promover qualquer estado. O formulário permanece um inventário local, nunca uma credencial de autorização.

## Bloqueadores intactos

**0/17 critérios foram homologados em staging**; `SQL-01` e `SQL-02` continuam **BLOCKED** no SQL revisável `supabase/sql/advertiser-portal.sql`, que concede leitura ampla de revisões e utiliza `to_jsonb(r)` na RPC. A correção de projeção e privilégios segue exclusivamente em `tests/fixtures/commercial-safe-projection-lab.sql`, aplicada apenas ao PostgreSQL descartável de laboratório. O player oficial, TVs, playlists, gateway e conteúdo de estabelecimentos continuam preservados.

## Próxima etapa segura

Preparar uma checagem **offline** de consistência temporal e cadeia de referências redigidas: identificar duplicidade entre execuções, regressão de status, alteração de digest e tentativas de elevar evidências apenas `LAB` a `STAGING`. Sempre com dados sintéticos, sem fazer merge, alterar SQL ou conectar staging e produção.

**Regra permanente:** nenhuma alteração de serviços reais, deploy, migration, nova Edge Function ou atualização APK/TV sem autorização explícita e separada.
