// Catálogo dos efeitos de iluminação do firmware original.
// IDs são do protocolo e nunca mudam; nomes e descrições são só apresentação.

export type Anim = "off" | "static" | "breath" | "wave" | "rainbow" | "sparkle" | "reactive" | "fall";
export type DirKind = "none" | "horizontal" | "vertical";

export type Effect = {
  id: number;
  name: string;
  desc: string;
  color: boolean; // aceita cor escolhida
  rainbow: boolean; // aceita modo arco-íris
  speed: boolean;
  dir: DirKind;
  anim: Anim;
};

const e = (id: number, name: string, desc: string, anim: Anim, color = true, dir: DirKind = "none"): Effect => ({
  id,
  name,
  desc,
  color,
  rainbow: color,
  speed: id > 1,
  dir,
  anim,
});

export const EFFECTS: Effect[] = [
  e(0, "Desligado", "Todas as luzes apagadas", "off", false),
  e(1, "Estático", "Uma cor fixa no teclado todo", "static"),
  e(2, "Tecla acende", "A tecla pressionada acende", "reactive"),
  e(3, "Tecla apaga", "A tecla pressionada apaga", "reactive"),
  e(4, "Cintilante", "Teclas aleatórias piscam", "sparkle"),
  e(5, "Chuva", "Pontos de luz caem pelo teclado", "fall"),
  e(6, "Floral", "Padrão colorido fixo", "rainbow", false),
  e(7, "Respiração", "O teclado acende e apaga suave", "breath"),
  e(8, "Espectro", "Passa por todas as cores", "rainbow", false),
  e(9, "Expansão", "A cor se espalha do centro", "wave"),
  e(10, "Rolagem", "Faixas na vertical", "wave", true, "vertical"),
  e(11, "Onda", "Uma onda horizontal", "wave", true, "horizontal"),
  e(12, "Rotação", "Uma faixa gira pelo teclado", "wave", true, "horizontal"),
  e(13, "Explosão", "Explosão de luz ao digitar", "reactive"),
  e(14, "Lançamento", "Luz sai para os lados ao digitar", "reactive"),
  e(15, "Ondulação", "Ondas a partir da tecla", "reactive"),
  e(16, "Fluxo", "Fluxo contínuo na horizontal", "wave", true, "horizontal"),
  e(17, "Pulsação", "Ondas sobrepostas sobem e descem", "breath"),
  e(18, "Diagonal", "Riscos diagonais atravessam", "wave", true, "horizontal"),
  e(19, "Vaivém", "Uma faixa vai e volta", "wave"),
];

export const DIRECTIONS: Record<DirKind, { value: number; label: string }[]> = {
  none: [],
  horizontal: [
    { value: 0, label: "← Esquerda" },
    { value: 3, label: "Direita →" },
  ],
  vertical: [
    { value: 2, label: "↑ Cima" },
    { value: 1, label: "Baixo ↓" },
  ],
};

export const SWATCHES = ["#ff2d55", "#ff8a00", "#ffd60a", "#30d158", "#00e5ff", "#0a84ff", "#7c4dff", "#ff4fd8", "#ffffff"];
