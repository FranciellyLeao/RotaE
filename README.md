# Rota de Entregas 📦

App para entregadores: carrega a planilha da Shopee, monta a melhor rota, mostra tudo no mapa e marca cada pacote.

## O que ele faz

- **Carrega a planilha da Shopee** (.xlsx ou .csv), com as colunas `SPX TN`, `Destination Address`, `Latitude` e `Longitude`.
- **Rota pelas ruas de verdade.** Usa o OSRM, um serviço gratuito que respeita mão única e retorno. Sem internet, calcula pela distância no mapa.
- **Cada rua junta**, numa parada só. Ruas muito longas, com mais de 450 m entre endereços, viram duas paradas.
- **Paradas de van.** Junta endereços a menos de ~140 m para entregar a pé, e diz onde estacionar.
- **Começa de onde você está** (GPS). O botão "Recalcular daqui" refaz a ordem só com os pacotes que faltam.
- **Mapa** com todas as paradas numeradas, a linha da rota, a próxima parada em destaque e você no mapa.
- **Leitor de código de barras.** Aponta a câmera para a etiqueta e o pacote é marcado como entregue.
- **Não entregue com motivo** (ausente, endereço não encontrado, recusado…).
- **Resumo** para compartilhar no WhatsApp ou baixar em CSV.
- **Tempo estimado** que diminui a cada entrega e se ajusta ao ritmo real.
- **Funciona sem internet** depois de aberto uma vez. O progresso fica salvo no celular.

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo `rota-entregas`).
2. Envie todos os arquivos desta pasta: `index.html`, `app.js`, `core.js`, `sw.js`, `manifest.webmanifest` e os ícones.
3. No repositório, vá em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)` e salve.
4. Em 1 ou 2 minutos, o site fica em `https://SEU-USUARIO.github.io/rota-entregas/`.
5. No celular, abra o link e use **"Adicionar à tela inicial"**. Ele vira um app.

> Precisa ser HTTPS (o GitHub Pages já é) para o GPS, a câmera e o modo sem internet funcionarem.

## Observações

- **Nome e telefone do cliente:** a planilha da Shopee não traz. Se vier uma coluna de nome ou telefone (`Nome`, `Destinatário`, `Recipient`, `Telefone`, `Celular`…), o app lê sozinho. Também dá para adicionar à mão no botão ⋯ → "Nome e telefone". Aparecem os botões de ligar e WhatsApp, e o contato vai junto no resumo e no CSV.
- **Dois celulares:** cada celular guarda o próprio progresso. Para sincronizar entre aparelhos, seria preciso ligar um banco online (ex.: Firebase).
- **OSRM:** o servidor público `router.project-osrm.org` é gratuito para uso leve. Se ele estiver fora do ar, o app usa a distância no mapa e avisa.
- **Leitor de código:** no Android/Chrome usa o leitor nativo do navegador. No iPhone carrega a biblioteca ZXing na primeira vez (precisa de internet).

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | Tela e estilos |
| `app.js` | Lista, mapa, câmera, resumo, tempo estimado |
| `core.js` | Leitura da planilha e cálculo da rota |
| `sw.js` | Modo sem internet |
| `manifest.webmanifest` + ícones | Instalar como app no celular |
