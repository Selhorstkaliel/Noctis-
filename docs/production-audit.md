# Noctis — auditoria e plano de migração

Data: 2026-09-14. Fonte: repositório privado Selhorstkaliel/Noctis-, árvore
`a0f962e7d168f99995081a322801e2a0a59319c4` da main. O ZIP Noctis(4) deixou de estar
disponível no workspace: equivalência entre ZIP e GitHub **não validada**.
Este documento foi escrito antes das alterações de componentes.

## Diagnóstico

| Área                  | Evidência no código                                                                     | Consequência para migração                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend              | React 19, TypeScript, Vite 6, src/, public/                                             | Build estático; não é Next.js. Preservar componentes e imports.                                                                                                      |
| Backend               | Fastify 5, server/index.ts e app.ts                                                     | Processo Node 24, API HTTP, WebSocket e gateway de sinalização LiveKit integrados.                                                                                   |
| Banco                 | node-postgres, SQL, schema noctis                                                       | Sem ORM; 16 migrations com checksum, transação e advisory lock.                                                                                                      |
| Autorização           | RLS, funções SECURITY DEFINER com search_path, permissões por canal/servidor            | Preservar os papéis noctis_api, noctis_auth, noctis_worker e noctis_migrator. Não executar API como postgres.                                                        |
| Sessões               | Cookie opaco, token armazenado como hash, revogação em PostgreSQL                       | Não há necessidade comprovada de Redis para sessões. Cookie de produção __Host-noctis, Secure, HttpOnly, SameSite=Lax.                                               |
| CSRF                  | Origin exata + X-CSRF-Token; handshake WS com CSRF                                      | Frontend e /api devem continuar na mesma origem. Apenas mudar fetch para outro domínio quebraria cookies, uploads e OAuth.                                           |
| Senhas/MFA            | Argon2id; TOTP, recuperação e revogação em account-security                             | Preservar; não substituir por Supabase Auth nesta migração.                                                                                                          |
| E-mail                | security-mail.ts enfileira payload criptografado; worker entrega via SMTP com TLS       | Worker obrigatório também para cadastro/verificação/reset. Transporte file é proibido em produção.                                                                   |
| Uploads               | Multipart, até 8 MiB; avatares com limite próprio; sharp; tipos e assinaturas validados | Bytes ficam no disco; PostgreSQL já contém somente metadados e storage_key. Adaptar armazenamento e garbage collection juntos.                                       |
| Privacidade de anexos | GET /api/uploads/:id passa por sessão e RLS                                             | Bucket R2 privado; manter endpoint autorizado. Não tornar todas as URLs públicas.                                                                                    |
| Banners               | Seletor de imagens estáticas em ServerAdmin                                             | Upload livre de banners não existe no fluxo atual. Não declarar esta funcionalidade implementada pela migração.                                                      |
| WebSocket             | @fastify/websocket e ws, /api/realtime                                                  | Sem Socket.IO. LISTEN noctis_changes/noctis_music/noctis_signals em duas conexões de sessão.                                                                         |
| LiveKit               | Gateway /api/media/rtc e /api/media/rtc/v1; tokens curtos; grants; revalidação          | Cloud pode substituir o SFU preservando o gateway. Testar reconexão e revogação; não remover gateway sem substituir sua proteção.                                    |
| Voz/vídeo/tela        | src/voice-client.ts, VoiceRoom.tsx                                                      | Recursos e volume individual já implementados. Não validados com participantes reais nesta auditoria.                                                                |
| Música                | server/music; @livekit/rtc-node; ffmpeg; loop em worker.ts                              | Processo persistente. Links de YouTube/Spotify/SoundCloud usam metadados e embeds oficiais. Áudio nativo limitado a hosts autorizados; sem extração/DRM.             |
| Outros jobs           | Integrações, e-mails, limpeza, revogações de mídia no worker                            | Não desligar worker para economizar sem avaliar efeitos em segurança e entrega.                                                                                      |
| Docker                | compose.yaml, compose.full.yaml, compose.production.yaml, Dockerfile                    | PostgreSQL, SFU, API, worker, migração e Caddy. Runtime não-root; ffmpeg e dependências nativas.                                                                     |
| Configuração          | .env.example e .env.production.example; Zod em config.ts                                | Nenhum .env real no snapshot rastreado. Localhost aparece em desenvolvimento, testes, SFU e healthchecks. Manter defaults locais, exigir origem pública em produção. |

## Achados e bloqueios

1. **Backend não pronto para Functions sem trabalho adicional.** Há inicialização de
   listeners, timers, mapas de conexões, bridges de mídia e fechamento dependente
   de supervisor. A Vercel agora suporta WebSockets com Fluid Compute, mas encerra
   conexões no limite de duração e não garante afinidade entre instâncias. Portanto
   a existência de WebSocket não prova incompatibilidade; o ciclo de vida atual
   precisa de ensaio específico. Menor mudança inicial: frontend na Vercel e API +
   gateway + worker em containers. Host gratuito persistente ainda não selecionado.
2. **Franquia gratuita não garante operação 24/7.** O worker consulta PostgreSQL
   aproximadamente a cada segundo. Em Neon isso pode impedir scale-to-zero.
   Nenhum contrato/plano foi alterado. Supabase está em avaliação como alternativa.
3. **SMTP é uma dependência adicional ao plano original.** Usar Supabase somente
   como banco não faz os e-mails da autenticação própria passarem pelo Supabase Auth.
4. **Provisionamento atual presume DATABASE noctis e pgcrypto em public.** O banco
   padrão do Supabase é postgres; as funções de auditoria chamam public.digest.
   Verificar extensão, papéis, permissões e search_path antes de aplicar migrations.
   Não mover extensões de um projeto compartilhado nem editar migrations aplicadas.
5. **Estado e papéis no pooler.** LISTEN e advisory locks exigem conexão de sessão;
   pool transacional não serve para listener/migrator. Consultas usam nomes sem
   schema; o search_path dos quatro papéis precisa estar correto. TLS validado.
6. **Uploads antigos exigem cópia e verificação.** Mudar STORAGE_DRIVER não move
   arquivos existentes. Preservar chaves, tamanho e SHA-256; manter cópia para rollback.
7. **Proteções da página são servidas hoje pelo Fastify.** Frontend estático na
   Vercel precisa manter CSP e demais headers; uma configuração Vite genérica perderia isso.
8. **Rate limit depende do IP visto pelo proxy.** Não confiar indiscriminadamente
   em X-Forwarded-For. Configurar TRUST_PROXY_CIDR somente com cadeia confiável validada.
9. **Privacidade não é certificação de ausência de secrets.** Busca por formatos
   conhecidos e arquivos rastreados não encontrou credenciais aparentes. Histórico
   completo, painéis e segredos de integrações não foram inspecionados.

## Plano antes das alterações

1. Preservar src/, server/, shared/, infra/; sem reorganização cosmética de monorepo.
2. Reforçar .gitignore e .dockerignore; registrar alterações em branch de revisão.
3. Introduzir adaptador local/R2 privado mantendo URLs e autorização; ligar também
   limpeza do worker ao adaptador. Não alterar schema ou migrations.
4. Preparar configuração de frontend Vercel com build separado, /api na mesma
   origem e headers de segurança. Exigir backend HTTPS real; teste de upgrade WS
   e cookies é gate antes de promover. Não publicar UI incompleta como produção.
5. Aceitar URL HTTPS/WSS de LiveKit Cloud preservando gateway e grants existentes.
6. Redigir pré-verificação SQL somente de leitura para Neon/Supabase e instruções
   de provisionamento. Escolher projeto/org/plano antes de qualquer criação.
7. Validar typecheck, build, dependências, testes isolados de armazenamento; executar
   suítes integradas somente com banco de teste e serviços disponíveis.
8. Provisionar e testar progressivamente; pausar em autenticação, 2FA, criação de
   conta ou cobrança. Não aceitar custo nem adicionar cartão.

## Banco no Supabase: avaliação

**Aprovado com ressalvas para piloto**, apenas como PostgreSQL. Manter schema noctis
fora dos schemas expostos pela Data API; sem GRANT para anon/authenticated/service_role
e sem conexão administrativa no frontend. Os papéis próprios usam conexão direta
ou pooler session com username ROLE.PROJECT_REF, conforme URL do painel.
IPv6 na conexão direta gratuita; session pooler é alternativa IPv4 sem add-on pago.
Migrations continuam sob o runner atual, não sob um segundo histórico Supabase.
Compatibilidade real depende do pré-check e execução dos testes: **não validada**.

## Limites e custos consultados

| Serviço                | Franquia/limite relevante                                                                        | Estado                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| GitHub                 | Repositório privado já existente                                                                 | Acessível; nenhuma cobrança contratada nesta tarefa.                              |
| Vercel Hobby           | Uso pessoal não comercial; quotas de Functions e tráfego                                         | Conta/plano e consumo não inspecionados. Não presumir elegibilidade comercial.    |
| Supabase Free          | 500 MB banco, 5 GB egress, 2 projetos ativos; pausa após semana inativa; sem backups automáticos | Alternativa em avaliação; nenhum projeto criado.                                  |
| Neon Free              | Consultar franquia vigente de CU-hours e 0,5 GB; worker persistente consome compute              | Originalmente solicitado; sem projeto configurado.                                |
| R2 Standard            | 10 GB-mês, 1 milhão operações A, 10 milhões B; egress direto gratuito                            | Franquia não é bloqueio de cobrança por excedentes. Sem bucket criado.            |
| LiveKit Build          | US$0/mês, 5.000 minutos-participante, 100 conexões, 50 GB downstream                             | Sem projeto configurado. 10 pessoas por 60 min consomem 600 minutos-participante. |
| Upstash                | Não necessário no desenho atual, pois sessões/rate limits/filas/avisos estão em PostgreSQL       | Não provisionar.                                                                  |
| Host API/worker e SMTP | Ainda precisam de fornecedor/conta e verificação de limites                                      | Não é possível afirmar custo total zero.                                          |

Fontes oficiais, consultadas em 2026-09-14:

- https://vercel.com/docs/functions/websockets
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/routing/rewrites
- https://neon.com/pricing
- https://supabase.com/pricing
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/postgres/roles
- https://developers.cloudflare.com/r2/pricing/
- https://livekit.com/pricing

Custos efetivamente autorizados nesta execução: nenhum. Faturas atuais do usuário:
não consultadas. Não confundir esse registro com uma estimativa de operação gratuita.
