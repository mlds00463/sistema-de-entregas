# MotoControl Pro — Contexto do Projeto

## Objetivo

Criar um sistema web para controle de motoqueiros de delivery, com QR Code na loja, fila de disponibilidade, controle de entregas, GPS, tempo de entrega, ranking e financeiro.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase
- Supabase Auth
- Supabase Realtime
- PWA
- Deploy na Vercel

## Tipos de usuário

### Admin
- Gerencia empresas
- Gerencia lojas
- Gerencia motoqueiros
- Visualiza todos os pedidos
- Acompanha mapa
- Vê relatórios
- Controla financeiro

### Loja
- Lança entregas
- Chama motoqueiros
- Acompanha pedidos
- Vê fila de motoqueiros
- Marca pedido como entregue quando necessário

### Motoqueiro
- Faz login
- Escaneia QR Code da loja
- Fica online/disponível
- Aceita ou recusa entrega
- Marca saída
- Marca entrega concluída
- Vê ganhos do dia

## Regra principal do QR Code

Cada loja tem um QR Code fixo ou dinâmico.

Quando o motoqueiro chega na loja:

1. Escaneia o QR Code
2. O sistema identifica a loja
3. Ativa o GPS
4. Marca o motoqueiro como online
5. Marca como disponível
6. Coloca o motoqueiro na fila da loja

Quando o motoqueiro retorna para a loja:

1. Escaneia novamente o QR Code
2. O sistema confirma presença
3. Marca como disponível novamente
4. Coloca no fim da fila

## Status do motoqueiro

- offline
- online
- disponivel
- chamado
- em_entrega
- retornando
- bloqueado

## Status da entrega

- aguardando
- chamado
- aceito
- retirado
- em_rota
- entregue
- concluido
- cancelado

## Fluxo da entrega

1. Loja cria entrega
2. Sistema busca motoqueiro disponível na fila
3. Motoqueiro recebe chamada
4. Motoqueiro aceita ou recusa
5. Se aceitar, fica ocupado
6. Loja/motoqueiro marca retirada
7. Motoqueiro sai para entrega
8. Motoqueiro finaliza entrega
9. Sistema registra horário
10. Motoqueiro retorna para loja
11. Escaneia QR Code novamente
12. Fica disponível

## Controle de tempo

Registrar automaticamente:

- created_at
- called_at
- accepted_at
- picked_up_at
- route_started_at
- delivered_at
- completed_at
- returned_at

Calcular:

- tempo para aceitar
- tempo de retirada
- tempo em rota
- tempo total da entrega
- tempo de retorno
- tempo médio por motoqueiro
- tempo médio por loja

## Fila de motoqueiros

Regras:

- O primeiro que ficou disponível é o primeiro chamado
- Ao aceitar entrega, sai da fila
- Ao recusar, vai para o fim da fila
- Ao finalizar e voltar para loja, escaneia QR Code e entra no fim da fila
- Se não responder dentro do tempo limite, passa para o próximo
- Loja/Admin pode escolher motoqueiro manualmente

## GPS

Quando o motoqueiro fica online:

- Solicitar permissão de localização
- Atualizar latitude e longitude
- Gravar localização em driver_locations
- Mostrar posição no mapa
- Validar se está próximo da loja

O motoqueiro só pode ficar disponível se:

- escaneou o QR Code da loja
- ou está dentro do raio permitido da loja

## Relatórios

Criar relatórios por:

- dia
- semana
- mês
- loja
- motoqueiro

Métricas:

- quantidade de entregas
- tempo médio
- atrasos
- recusas
- faturamento
- valor a pagar
- ranking dos motoqueiros

## Financeiro

Controlar:

- valor por entrega
- adicional
- desconto
- cancelamento
- total do dia por motoqueiro
- total por loja
- pagamento pendente
- pagamento realizado

## Banco de dados sugerido

Tabelas:

- companies
- stores
- profiles
- drivers
- deliveries
- delivery_events
- driver_locations
- driver_queue
- qr_tokens
- payments
- alerts
- settings

## Segurança

Implementar:

- Supabase Auth
- Row Level Security
- Separação por empresa
- Usuário loja só vê dados da própria loja
- Motoqueiro só vê suas entregas
- Admin vê tudo da empresa

## MVP obrigatório

O sistema precisa permitir:

1. Admin fazer login
2. Cadastrar loja
3. Cadastrar motoqueiro
4. Gerar QR Code da loja
5. Motoqueiro fazer login
6. Motoqueiro escanear QR Code
7. Motoqueiro ficar disponível
8. Loja criar entrega
9. Sistema chamar motoqueiro disponível
10. Motoqueiro aceitar entrega
11. Motoqueiro marcar saída
12. Motoqueiro marcar entregue
13. Sistema calcular tempo total
14. Admin visualizar dashboard

## Prioridade de desenvolvimento

### Fase 1
- Estrutura do projeto
- Login
- Supabase
- Banco de dados
- RLS

### Fase 2
- Cadastro de loja
- Cadastro de motoqueiro
- QR Code por loja

### Fase 3
- Tela do motoqueiro
- Leitura de QR Code
- Ativação de disponibilidade
- GPS

### Fase 4
- Criação de entregas
- Fila automática
- Aceite e recusa

### Fase 5
- Dashboard
- Tempo de entrega
- Ranking
- Financeiro

## Instrução para o Codex

Sempre leia este arquivo antes de fazer alterações.

Não crie apenas mockup.

Crie código real, funcional, conectado ao Supabase e pronto para rodar.

Ao implementar uma funcionalidade, atualize este arquivo se alguma regra de negócio mudar.