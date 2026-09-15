# Evidências e estado da entrega

Execução em 2026-09-14. Base GitHub: a0f962e7d168f99995081a322801e2a0a59319c4.

| Verificação | Resultado real |
|---|---|
| Instalação do lockfile original | npm ci --ignore-scripts concluído. |
| Typecheck antes/depois | Frontend e backend aprovados. |
| Build antes/depois | TypeScript frontend/backend + Vite aprovados. |
| Testes novos | 4 aprovados: configuração Vercel, arquivos locais e protocolo S3 simulado. |
| Testes existentes isolados | 9 aprovados: fila de música, volume, provedores/embeds, SSRF e fila realtime. |
| npm audit final | 0 vulnerabilidades conhecidas reportadas; não é garantia de segurança absoluta. |
| git diff --check | Aprovado. |
| Migrations alteradas/aplicadas | Nenhuma; arquivos 001–016 preservados. |
| Busca de secrets | Apenas templates .env rastreados; sem correspondências nos formatos de chave procurados. Revisão não equivale a auditoria de credenciais nos painéis. |
| PostgreSQL/Supabase/Neon | Não conectado; pré-check SQL não executado; RLS e migrations não testados contra serviço real. |
| Cloudflare R2 | Adaptador testado com servidor S3 local; bucket real e transferência de arquivos não validados. |
| LiveKit Cloud/SMTP | Não conectados; voz/vídeo/tela e recebimento real de e-mail não validados. |
| Docker | Docker/PostgreSQL não disponíveis no runtime; imagem/compose não executados. |
| Navegador/e2e | Não executados; os 15 fluxos do roteiro permanecem pendentes em ambiente real. |
| Vercel | Nenhum deploy ou URL criados; roteamento WS pelo proxy exige validação real. |

Limitações da cópia local: o GitHub permitiu obter os arquivos de código e a maior
parte dos assets. O arquivo public/images/celebrate.gif excedeu a leitura disponível
do conector; continua preservado no repositório remoto e **não foi removido pelo PR**.
Assim, o build local aprovado não demonstra completude de todos os assets. Nenhum
novo site foi publicado a partir dessa cópia. Os screenshots antigos do repositório
não são evidência de testes desta execução.

Aviso do build: chunk de voz de aproximadamente 565 kB minificado (carregado
dinamicamente). Não foi feita refatoração de UI para silenciar o aviso.

## Mudanças

- .gitignore e .dockerignore: exclusões de chaves, backups, arquivos temporários
  e configuração local de deploy; exceções somente para templates revisados.
- package.json/package-lock.json: SDK S3 com versão exata, build:web e testes/configuração de deploy.
- server/config.ts: seleção explícita local/R2 e validação de endpoint/credenciais.
- server/object-store.ts e upload-store.ts: adaptadores; bucket privado, UUID,
  streams, limites de tempo, sem URLs públicas nem ACL pública.
- server/storage.ts: mantém validação e RLS; salva/lê via adaptador.
- server/worker.ts: limpeza dos objetos pelo mesmo driver da API.
- server/media.ts: preserva WSS quando configurado no endpoint LiveKit.
- server/tests/object-store.test.ts e scripts/configure-vercel.test.mjs: regressões isoladas.
- scripts/configure-vercel.mjs: gera vercel.json a partir de backend público
  informado, com frontend Vite, /api mesma origem, cache privado e CSP da página.
- .env.distributed.example e .env.migration.example: configuração sem secrets reais.
- compose.distributed.yaml: API/worker separados, migrator sob profile explícito.
- infra/database-preflight.sql: inspeção somente leitura de banco candidato.
- docs/production-audit.md: auditoria e plano antes das mudanças.
- docs/distributed-deploy.md: arquitetura, variáveis, limites, testes, deploy e rollback.

## Bloqueios para produção

Escolher Neon ou Supabase e projeto; verificar os papéis e public.digest; obter
contas/URLs de R2, LiveKit e SMTP; escolher host persistente para API/worker;
validar cookies, proxy e os 15 fluxos. Pausar em login, 2FA, criação de conta,
autorização de GitHub ou cobrança conforme solicitado. Nenhuma confirmação
financeira foi aceita. Não fazer merge/promover como produção validada.
