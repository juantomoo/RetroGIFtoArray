const fs = require("fs");
const gifFrames = require("gif-frames");
const { PNG } = require("pngjs");
const GIFEncoder = require("gifencoder");
const readline = require("readline");

// Opciones para reducción de color: 0 = Original, luego niveles de reducción
const colorLevels = [0, 2, 8, 16, 32, 64, 128, 256, 512, 1024];
// Opciones para escalado (pixelación): Cada opción indica el factor de reducción (menor valor = más pixelado)
const scaleOptions = [
  { label: "Original", factor: 1 },
  { label: "1/2", factor: 0.5 },
  { label: "1/4", factor: 0.25 },
  { label: "1/8", factor: 0.125 },
  { label: "1/16", factor: 0.0625 },
  { label: "1/32", factor: 0.03125 },
  { label: "1/64", factor: 0.015625 },
  { label: "1/128", factor: 0.0078125 }
];

// Configurar readline para entrada interactiva
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Función para cuantizar el color de un píxel
function quantizeColor(color, level) {
  if (level === 0) return color; // Si es Original, no modifica
  return color.map(c => Math.round(c / (256 / level)) * (256 / level));
}

// Función para reducir (downscale) la imagen usando nearest-neighbor
function downscaleImage(data, width, height, factor) {
  if (factor === 1) return { data, width, height };
  const newWidth = Math.max(1, Math.floor(width * factor));
  const newHeight = Math.max(1, Math.floor(height * factor));
  let newData = new Uint8Array(newWidth * newHeight * 4);
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const origX = Math.floor(x / factor);
      const origY = Math.floor(y / factor);
      const origIdx = (origY * width + origX) * 4;
      const newIdx = (y * newWidth + x) * 4;
      newData.set(data.slice(origIdx, origIdx + 4), newIdx);
    }
  }
  return { data: newData, width: newWidth, height: newHeight };
}

// Función para reescalar (upscale) la imagen reducida al tamaño original usando nearest-neighbor
function upscaleImage(smallData, smallWidth, smallHeight, origWidth, origHeight) {
  if (smallWidth === origWidth && smallHeight === origHeight) return { data: smallData, width: origWidth, height: origHeight };
  let upscaledData = new Uint8Array(origWidth * origHeight * 4);
  const xRatio = smallWidth / origWidth;
  const yRatio = smallHeight / origHeight;
  for (let y = 0; y < origHeight; y++) {
    for (let x = 0; x < origWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      const srcIdx = (srcY * smallWidth + srcX) * 4;
      const destIdx = (y * origWidth + x) * 4;
      upscaledData.set(smallData.slice(srcIdx, srcIdx + 4), destIdx);
    }
  }
  return { data: upscaledData, width: origWidth, height: origHeight };
}

// Función principal que procesa el GIF
async function processGIF(inputPath, outputPath, colorChoice, scaleChoice, framePercentage) {
  // Obtener todos los frames compuestos
  const frames = await gifFrames({
    url: inputPath,
    frames: "all",
    outputType: "png",
    cumulative: true
  });
  const totalFrames = frames.length;
  const framesToUse = Math.ceil((framePercentage / 100) * totalFrames);

  console.log(`🎞️ Frames totales en el GIF original: ${totalFrames}`);
  console.log(`🎯 Frames utilizados en la conversión: ${framesToUse}`);

  // Usar las dimensiones y delay del primer frame
  const sampleFrame = frames[0].frameInfo;
  const origWidth = sampleFrame.width;
  const origHeight = sampleFrame.height;
  let delay = sampleFrame.delay * 10; // delay en ms (por defecto)
  if (delay === 0) delay = 100;

  // Configurar el encoder para el nuevo GIF
  const encoder = new GIFEncoder(origWidth, origHeight);
  const gifStream = fs.createWriteStream(outputPath);
  encoder.createReadStream().pipe(gifStream);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(delay);
  encoder.setQuality(10);

  // Iterar sobre los frames seleccionados de forma uniforme
  for (let i = 0; i < framesToUse; i++) {
    const frameIndex = Math.floor((i / framesToUse) * totalFrames);
    const png = new PNG();
    await new Promise((resolve, reject) => {
      frames[frameIndex].getImage().pipe(png).on("parsed", () => {
        // Aplicar pixelación: reducir la imagen y luego reescalarla a tamaño original
        const scaleFactor = scaleOptions[scaleChoice].factor;
        const downscaled = downscaleImage(png.data, png.width, png.height, scaleFactor);
        const processed = upscaleImage(downscaled.data, downscaled.width, downscaled.height, png.width, png.height);

        // Aplicar reducción de color si se ha seleccionado (si colorChoice no es 0)
        for (let j = 0; j < processed.data.length; j += 4) {
          const pixel = processed.data.slice(j, j + 3);
          const newPixel = quantizeColor(pixel, colorChoice);
          processed.data.set(newPixel, j);
        }

        // Agregar el frame procesado al GIF
        encoder.addFrame(processed.data);
        console.log(`✅ Frame ${i + 1}/${framesToUse} procesado`);
        resolve();
      }).on("error", reject);
    });
  }

  encoder.finish();
  console.log(`📂 GIF simplificado guardado en ${outputPath}`);
}

// Función principal interactiva
(async () => {
  console.log("=== GIFSimply ===\n");

  // Selección de reducción de color
  console.log("Opciones de reducción de color:");
  colorLevels.forEach((level, index) => {
    console.log(`${index}. ${level === 0 ? "Original" : level + " colores"}`);
  });
  let colorInput = await askQuestion("Seleccione una opción (0-9): ");
  let colorChoiceIndex = parseInt(colorInput);
  if (isNaN(colorChoiceIndex) || colorChoiceIndex < 0 || colorChoiceIndex > 9) colorChoiceIndex = 0;
  const selectedColor = colorLevels[colorChoiceIndex]; // 0 indica Original

  // Selección de escalado
  console.log("\nOpciones de escalado:");
  scaleOptions.forEach((opt, index) => {
    console.log(`${index}. ${opt.label}`);
  });
  let scaleInput = await askQuestion("Seleccione una opción (0-7): ");
  let scaleChoice = parseInt(scaleInput);
  if (isNaN(scaleChoice) || scaleChoice < 0 || scaleChoice > 7) scaleChoice = 0;

  // Selección de porcentaje de frames a conservar
  console.log("\nPorcentaje de frames a conservar (1-100, 100 = todos):");
  let frameInput = await askQuestion("Ingrese un valor: ");
  let framePercentage = parseInt(frameInput);
  if (isNaN(framePercentage) || framePercentage <= 0 || framePercentage > 100) framePercentage = 100;

  rl.close();

  await processGIF("original.gif", "result.gif", selectedColor, scaleChoice, framePercentage);
})();
