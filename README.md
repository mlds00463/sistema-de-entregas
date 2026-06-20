# Sistema de Entregas Supabase

MVP funcional em Next.js + Supabase para operação de entregas com login real, lojas, QR Code, motoqueiros, GPS, fila de disponíveis, aceite/recusa, status e relatórios.

## Instalação

1. Entre na pasta do projeto:
   ```bash
   cd /Users/mauroluisdasilva/Desktop/sistemas
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Crie um projeto no Supabase.

4. No Supabase, abra `SQL Editor` e rode todo o arquivo `schema.sql`.

5. Crie `.env.local` baseado em `.env.example`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-anon-publica
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

6. Inicie:
   ```bash
   npm run dev
   ```

7. Abra `http://localhost:3000`.

## Configuração Supabase

- Authentication > Providers: habilite Email.
- Para testar sem confirmação por email, desative temporariamente `Confirm email`.
- Database > Replication: habilite realtime para `deliveries` e `motorcyclists`.
- Rode `seed.sql` apenas se quiser criar exemplos depois de já ter usuários reais em `profiles`.

## Fluxo MVP

1. Crie uma conta `Gestor`.
2. Acesse `Lojas` e cadastre uma loja.
3. Use o QR Code gerado na loja.
4. Crie uma conta `Motoqueiro` em outro navegador ou celular.
5. No celular, acesse `Motoqueiro > Ler QR`, permita câmera e GPS, e leia o QR da loja.
6. O motoqueiro fica online/disponível.
7. Em `Loja`, crie uma entrega.
8. O sistema atribui o primeiro motoqueiro disponível da fila.
9. O motoqueiro aceita, marca `saiu para entrega` e depois `entregue`.
10. O dashboard do gestor mostra status e tempo total calculado pelo banco.

## Deploy na Vercel

1. Suba o projeto para um repositório Git.
2. Crie um projeto na Vercel apontando para o repositório.
3. Configure as variáveis:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_APP_URL`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Faça o deploy.
5. No Supabase Auth, adicione a URL da Vercel em `Authentication > URL Configuration > Site URL` e `Redirect URLs`.

Também dá para publicar pela Vercel CLI direto desta pasta:

```bash
npx vercel --prod
```

Durante o deploy, configure as mesmas variáveis de ambiente no projeto da Vercel antes de usar o sistema em produção.

## Telegram

A chamada automática de motoqueiros usa um bot do Telegram pelo backend em `app/api/telegram/send-delivery-call`.
Isso evita template aprovado e cobrança por conversa.

1. No Telegram, abra `@BotFather`, crie um bot e copie o token.
2. Na Vercel, configure:

```bash
NEXT_PUBLIC_APP_URL=https://sua-url.vercel.app
TELEGRAM_BOT_TOKEN=token-do-bot
TELEGRAM_WEBHOOK_SECRET=um-token-secreto-que-voce-escolher
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=usuario_do_bot_sem_@
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role-do-supabase
```

3. Rode `migration_telegram_integration.sql` no Supabase.
4. Configure o webhook do Telegram:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://sistemas-pi.vercel.app/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Em `Gestor > Motoqueiros`, envie o link individual de conexão para cada motoqueiro. Depois de conectado, o bot entende:

- `DISPONIVEL`: confirma disponibilidade pelo Telegram do motoqueiro.
- `ACEITAR`: aceita a corrida pendente.
- `RECUSAR`: recusa a corrida pendente e tenta chamar o próximo motoqueiro da loja.
- `SAIU`: marca a corrida como em rota.
- `CHEGUEI`: registra chegada ao cliente.
- `ENTREGUE`: finaliza a entrega e libera o motoqueiro.

## Arquivos principais

- `schema.sql`: tabelas, índices, RLS, funções RPC, view de relatórios.
- `seed.sql`: exemplos opcionais sem dados fixos no código.
- `app/gestor/dashboard`: dashboard do gestor e relatórios.
- `app/gestor/lojas`: cadastro real de lojas e QR Code.
- `app/loja/dashboard`: criação real de entregas.
- `app/motoqueiro/qrcode`: leitura real de QR Code e ativação com GPS.
- `app/motoqueiro/dashboard`: aceite, recusa e status da entrega.
