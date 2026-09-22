# Noctis: Supabase + Railway + Vercel

## Estado verificado em 15/09/2026

O projeto Supabase `tzpneesenfpaqjlmtswl` está conectado com TLS validado.
As 16 migrações originais e a nova correção do `search_path` da auditoria foram
aplicadas: **17 migrações e 63 tabelas**. Os arquivos 001–016 foram preservados.
A verificação confirmou os checksums, as quatro conexões restritas, o hash de
auditoria, `LISTEN/NOTIFY` e o isolamento entre duas comunidades. Os registros
temporários usados nesse teste foram removidos.

O erro `pg_pgrst_no_exposed_schemas` recebeu a
[correção oficial](https://supabase.com/docs/guides/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist):
o PostgREST aponta para `pgrst_no_exposed_schemas`, um schema vazio. A Data API
continua sem acesso ao schema privado `noctis`. Erros antigos permanecem no
histórico do painel. O SQL e seu rollback estão em
[`infra/supabase-disabled-data-api.sql`](../infra/supabase-disabled-data-api.sql).

O Advisor não apontou avisos de segurança após a correção da função de auditoria.
Há uma informação de RLS sem política em `public.schema_migrations`: isso é
intencional, pois somente o proprietário de migração acessa o histórico.
Não criar uma política pública para eliminar essa informação.

**Ainda não há deploy público concluído.** Faltam acesso aos projetos Railway/Vercel,
a origem HTTPS final, o projeto LiveKit Cloud e a validação do remetente SMTP
de produção. O SMTP disponível usa um domínio de teste do MailerSend.

## Arquitetura confirmada

| Componente                 | Destino                                  |
| -------------------------- | ---------------------------------------- |
| Código                     | GitHub                                   |
| Frontend React/Vite        | Vercel                                   |
| API HTTP e WebSocket       | Railway, serviço API                     |
| Worker e FFmpeg            | Railway, segundo serviço                 |
| PostgreSQL                 | Supabase, pooler de sessão na porta 5432 |
| Autenticação               | Auth próprio do Noctis                   |
| Uploads no primeiro deploy | Volume persistente conectado à API       |
| Voz, vídeo e tela          | LiveKit Cloud                            |
| E-mail                     | MailerSend/Brevo com remetente validado  |
| R2                         | Adiado até o primeiro deploy estável     |
| Redis                      | Não utilizado                            |

## Configuração privada já preparada

- `.env.supabase`: conexão administrativa, usada somente na preparação.
- `.env.supabase.runtime`: API, autenticação, worker e listener, com usuários distintos.
- `.env.supabase.migration`: conexão do migrator, separada do runtime.
- `.env.railway.api` e `.env.railway.worker`: variáveis dos serviços; completar
  os valores vazios de frontend e LiveKit. As chaves de sessão e criptografia
  são aleatórias, distintas e compartilhadas entre os dois serviços.
- `.env.supabase.local`: perfil privado de verificação local, na porta 3301;
  usa e-mail em arquivo. Não é configuração de produção.

Todos esses arquivos são ignorados pelo Git e pelo contexto do Docker.
Não sobrescrever `ENCRYPTION_KEY` em um redeploy: ela protege dados persistidos.
O certificado público em `infra/supabase-ca.crt` é o CA distribuído pelo
[dashboard oficial do Supabase](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).
Na imagem, `DATABASE_CA=/app/certs/supabase-ca.crt`.

Os comandos reproduzíveis são:

```sh
npm run supabase:setup
npm run supabase:migrate
npm run supabase:verify
```

O setup exige os quatro usuários restritos já provisionados. Ele verifica as
permissões existentes; não concede CREATE de banco ou ADMIN OPTION. Em um
banco já inicializado, exige credenciais funcionais e não redefine senhas.
O adaptador preserva `pgcrypto` em `extensions` e cria apenas o wrapper
restrito `public.digest(bytea,text)` necessário às migrações originais.

Para testar isolamento com registros temporários identificados e limpeza:

```sh
npm run supabase:verify -- --isolation
```

O histórico da aplicação está em `public.schema_migrations`. O painel de
migrações do Supabase usa outro histórico, que também registra a correção da
Data API; sua contagem não representa as migrações do runner do Noctis.

## Railway: dois serviços a partir do mesmo repositório

1. Criar/conectar um projeto Railway e dois serviços GitHub apontando para este
   repositório. Usar raiz do repositório e o Dockerfile existente.
2. No serviço API, selecionar `/infra/railway-api.json` como arquivo de
   configuração. Importar `.env.railway.api` nas variáveis do serviço.
3. Conectar um volume à API em `/var/lib/noctis/uploads`. Manter uma réplica.
   O volume começa com propriedade root no Railway; `RAILWAY_RUN_UID=0` permite
   que o entrypoint prepare somente esse diretório e execute a API como `node`.
4. No worker, selecionar `/infra/railway-worker.json` e importar
   `.env.railway.worker`. Não expor porta pública nem configurar healthcheck HTTP.
   Esse serviço recebe somente a credencial PostgreSQL do worker, sem senha
   administrativa ou de migração.
5. Nos dois serviços, `UPLOAD_GC_OWNER=api`: o worker agenda a remoção no banco,
   e a API remove os arquivos no volume que realmente possui. Assim, o worker
   não confirma uma exclusão em um filesystem diferente.
6. Preencher os valores LiveKit Cloud e SMTP e gerar um domínio público HTTPS
   para a API. A prontidão é verificada em `/api/ready`.

Referências: [configuração Railway](https://docs.railway.com/config-as-code/reference)
e [volumes](https://docs.railway.com/volumes).

## Vercel: frontend com API na mesma origem

Após conhecer a URL real da API Railway, definir `NOCTIS_BACKEND_ORIGIN` no
terminal e executar `npm run configure:vercel`. Isso gera `vercel.json` antes
do deploy, com build `npm run build:web`, saída `dist` e rewrite de `/api/*`
para o Railway. O comando recusa destinos fictícios e não sobrescreve um
arquivo existente.

Selecionar a URL HTTPS final do frontend e preencher `APP_ORIGIN` igual nos
dois serviços Railway. Subir o frontend pela conta Vercel conectada. Nenhuma
credencial do banco deve ser definida em variáveis `VITE_*`.

Antes de promover, verificar cadastro e e-mail real, login/logout, mensagens
persistidas, WebSocket `/api/realtime`, sinalização `/api/media/rtc`, upload e
acesso ao arquivo após reiniciar a API. Confirmar Origin, cookies seguros e
encaminhamento de IP antes de definir `TRUST_PROXY_CIDR`; não usar confiança
irrestrita como atalho.

## Verificação e rollback

- Build e typecheck aprovados; seis testes de armazenamento/roteamento aprovados.
- Navegador local conectado ao Supabase: login e cadastro renderizados, sem erros
  JavaScript; `/api/health`, `/api/ready` e `/api/auth/providers` retornaram 200;
  sessão anônima retornou 401 conforme esperado.
- Login de usuário real, entrega SMTP, LiveKit Cloud e proxy público Vercel/Railway
  ainda exigem as configurações de produção e testes após o deploy.
- Preservar os volumes, banco e chaves. Não rodar down com exclusão de volumes.
- Não editar migrações aplicadas ou seus checksums. Fazer alterações futuras em
  novos arquivos gerados pela CLI e aplicados pelo runner existente.
- Para reativar a Data API, executar o rollback documentado no SQL antes de
  escolher explicitamente os schemas expostos. Manter `noctis` privado.
- Registrar a imagem/commit e a URL do deploy quando a publicação for concluída.
