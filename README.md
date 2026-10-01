# AK820 Studio

Software alternativo (Windows) para o teclado **AJAZZ AK820 Pro**, no lugar do programa oficial.
Funciona com o **firmware original**, sem precisar gravar nada no teclado.

### Tela (editor)
- Abre PNG, JPG, WebP e GIF/WebP animado, ou cola com **Ctrl+V**; várias imagens viram **slideshow** (com transição esmaecer/deslizar).
- Geradores: **letreiro animado** (texto rolando) e **fundos animados** (plasma, Matrix, fogo, estrelas, ondas, túnel…).
- Zoom, arrastar, girar, espelhar, cor de fundo; brilho, contraste, saturação, **matiz**, **filtros** (P&B, sépia, negativo, vintage, neon…), **pixel art**, **vinheta** e desfoque.
- Texto com **fontes**, posição livre, contorno, **brilho neon** e **piscar**.
- GIF: velocidade, **cortar início/fim**, **invertido** e **vaivém**, limite de quadros.
- **Desfazer/refazer** (Ctrl+Z / Ctrl+Y), **comparar com o original** e **exportar PNG/GIF**.

### Galeria
- **Favoritos**, busca e **ordenação**; **editar de novo**, **duplicar**, **exportar/importar** (.ak820).
- **Rotação automática** entre favoritos ou todos (intervalo e modo aleatório).

### Iluminação
- Os 20 efeitos do firmware com prévia, **perfis salvos** e **“usar a cor da tela”**.
- **RGB do PC por tecla** (experimental): **pintar teclas**, **efeitos do PC** (onda arco-íris, fogo, aurora, chuva, estrelas…) e **medidor de CPU/RAM** nas teclas.

### Música e wallpaper
- **Visualizador de música nas teclas**: ouve o som do PC (loopback do Windows, sem cabo virtual) — estilos Equalizador, Pulso, Arco-íris e Ondas.
- **Tocando agora na tela**: capa do álbum + nome da música (Spotify, YouTube, Apple Music…), troca sozinho a cada música.
- **Wallpaper do Windows ou do Wallpaper Engine** na tela (prévias animadas funcionam) e **cor do wallpaper no RGB**, automático quando o wallpaper muda.
- **Ambilight**: as teclas copiam as cores do monitor em tempo real.
- **Clima na tela** (Open-Meteo) com atualização automática e **Pomodoro nas teclas**.

### Automação e sistema
- **Perfis por aplicativo**: quando um programa abre (ex.: um jogo), aplica perfil/tela/RGB; ao fechar, volta ao anterior.
- **Agendador** por horário e dia (trocar tela, perfil, apagar/acender luzes, sincronizar relógio, rotação).
- **Atalhos globais** (Ctrl+Alt+→/←/L/P/T/1…5) e **menu da bandeja** com favoritos e perfis.
- Relógio sincronizado ao conectar e periodicamente, suspensão das luzes, **histórico de atividades**,
  **backup/restauração** das configurações, teste de comunicação e diagnóstico.

## Requisitos

- Teclado ligado com **cabo USB-C de dados** e a chave atrás dele no **modo com fio**
  (o 2.4G e o Bluetooth não expõem a interface de configuração).
- **Feche o software oficial da AJAZZ** (inclusive na bandeja), porque os dois disputam a mesma interface.

## Atualizações automáticas (GitHub)

1. Uma vez só: `powershell -ExecutionPolicy Bypass -File scripts\setup-github.ps1`
   (cria a chave de assinatura, envia o código para um repositório **público** seu e cadastra a chave no GitHub).
2. A cada versão nova: `powershell -ExecutionPolicy Bypass -File scripts\release.ps1`
   (pergunta o número da versão e o que mudou, envia a tag e o GitHub compila e publica).
3. Instale uma vez o instalador da página **Releases**. Daí em diante o app avisa
   “Versão X disponível” e se atualiza com um clique, mantendo galeria e configurações.

A chave fica em `%USERPROFILE%\.tauri\` — faça backup dela; sem ela não dá para publicar atualizações.
Compilações locais (`build-windows.ps1`) funcionam normalmente, só não se atualizam sozinhas.

## Compilar

### Opção 1: GitHub Actions (sem instalar nada)

1. Crie um repositório no GitHub e envie esta pasta.
2. O workflow `.github/workflows/build.yml` roda sozinho a cada push.
3. Baixe o instalador em **Actions → Build Windows → Artifacts → AK820-Studio-Windows**.

### Opção 2: no seu PC

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

O script instala o Node.js, o Rust e o Visual Studio Build Tools (C++) pelo `winget`, se faltarem,
e gera o instalador em `target\release\bundle\nsis\`.

Para desenvolver: `npm install` e `npm run tauri dev`. Rodando só `npm run dev`, a interface abre
no navegador em **modo demonstração** (nada é enviado ao teclado).

## Estrutura

```
crates/ak820-core   Protocolo do teclado (pacotes, payload da tela, sequências) + testes
src-tauri           App Tauri: transporte HID (hidapi), galeria, configurações, bandeja
src                 Interface React/TypeScript (editor, galeria, iluminação, sistema)
```

## Protocolo

- USB `0C45:8009`. Controle: relatórios de recurso de 64 bytes na usage page `FF13` (interface 3).
  Imagem: relatórios de saída de 4096 bytes na usage page `FF68` (interface 2), com ACK `01 5A 02 00` a cada bloco.
- Tela: 128×128, RGB565 little-endian. Cabeçalho de 256 bytes (nº de quadros + atraso de cada um em
  unidades de 2 ms) seguido dos quadros, completado com `0xFF` até um múltiplo de 4096 bytes.
- O software oficial limita animações a 140 quadros. O app usa esse limite por padrão
  (ajustável até 255).

Créditos pela engenharia reversa (projetos abertos):
[CraigSDel/ajazz-ak820-config](https://github.com/CraigSDel/ajazz-ak820-config) (MIT),
aar-rafi/aks075-linux, gohv/EPOMAKER-Ajazz-AK820-Pro,
[wsclx/ak820pro-modder](https://github.com/wsclx/ak820pro-modder) (MIT) e
[gusleig/ajazz-ak820-pro-mac](https://github.com/gusleig/ajazz-ak820-pro-mac) (MIT).

> Projeto independente, sem relação com a AJAZZ. Use por sua conta e não desconecte o teclado
> durante um envio.
