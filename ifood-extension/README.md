# Extensao Chrome para iFood

Esta extensao roda dentro do Gestor iFood e envia os pedidos visiveis para o app de motoqueiros em `http://localhost:3001/loja/dashboard`.

## Instalar

1. Abra `chrome://extensions`.
2. Ative `Modo do desenvolvedor`.
3. Desative ou remova a extensao antiga `Madalena iFood Bridge`, caso ela apareca.
4. Clique em `Carregar sem compactacao`.
5. Selecione a pasta `/Users/mauroluisdasilva/Desktop/sistemas/ifood-extension`.
6. Confira se a extensao carregada chama `Sistemas Pi iFood -> Motoqueiros`.
7. Abra o Gestor iFood normalmente no Chrome.

## Usar

1. Deixe a tela de pedidos do iFood aberta.
2. Use o painel `Sistemas Pi iFood -> Motoqueiros` no canto inferior direito.
3. Clique em `Diagnóstico` para confirmar quantos pedidos foram reconhecidos.
4. Clique em `Enviar lista` para mandar todos os pedidos reconhecidos para a fila do sistema.
5. No sistema, escolha o motoqueiro ou deixe em `Fila automatica`.

Por padrao a extensao abre o ambiente local `http://localhost:3001/loja/dashboard`.
Clique em `Usar produção` para trocar para `https://sistemas-pi.vercel.app/loja/dashboard`.
