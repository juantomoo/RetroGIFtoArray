const fs = require('fs');
const readline = require('readline');
const gifFrames = require('gif-frames');
const { PNG } = require('pngjs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const INPUT_GIF = 'ejemplo.gif';
const OUTPUT_BIN = 'pixels.bin';

// 🎨 Paletas de colores retro
const palettes = [
    { name: "Original", colors: null }, // Conserva los colores originales
    { name: "Game Boy", colors: [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]] },
    { name: "Game Boy Color", colors: [[0, 0, 0], [34, 59, 19], [68, 116, 34], [102, 170, 68], [170, 238, 136]] },
    { name: "SNES", colors: [[0, 0, 0], [94, 75, 153], [255, 255, 255], [222, 190, 153], [255, 94, 77]] },
    { name: "N64", colors: [[0, 0, 0], [89, 157, 220], [252, 239, 82], [252, 127, 0], [220, 38, 127]] },
    { name: "Retro Sunset", colors: [[255, 94, 77], [189, 46, 63], [95, 15, 64], [20, 12, 48]] }
];

async function analyzeGIF(input) {
    console.log("📊 Analizando el GIF...");
    const frames = await gifFrames({ url: input, frames: 'all', outputType: 'png' });

    if (!frames || frames.length === 0) {
        console.error("❌ Error: No se encontraron frames en el GIF.");
        process.exit(1);
    }

    const totalFrames = frames.length;
    const frameDuration = frames[0].frameInfo.delay * 10 || 100;
    const width = frames[0].frameInfo.width;
    const height = frames[0].frameInfo.height;

    console.log(`📏 Resolución: ${width}x${height}`);
    console.log(`🎞️ Total de frames: ${totalFrames}`);
    console.log(`⏳ Duración de cada frame: ${frameDuration}ms`);

    return { totalFrames, frameDuration, width, height };
}

async function selectOptions() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log("\n🎨 Selecciona una paleta de colores:");
    palettes.forEach((p, i) => console.log(`${i + 1}. ${p.name}`));

    const paletteIndex = await new Promise(resolve => {
        rl.question("\nIngrese el número de la paleta: ", answer => resolve(parseInt(answer) - 1));
    });

    const framePercentage = await new Promise(resolve => {
        rl.question("🛠️ Ingrese el porcentaje de frames a conservar (1-100): ", answer => resolve(Math.max(1, Math.min(100, parseInt(answer)))));
    });

    rl.close();
    return { palette: palettes[paletteIndex], framePercentage };
}

(async () => {
    const gifInfo = await analyzeGIF(INPUT_GIF);
    const { palette, framePercentage } = await selectOptions();
    await processGIF(INPUT_GIF, OUTPUT_BIN, framePercentage, gifInfo, palette);
})();

async function processGIF(input, outputBin, framePercentage, gifInfo, palette) {
    const startTime = Date.now();
    const frames = await gifFrames({ url: input, frames: 'all', outputType: 'png' });

    const totalFrames = gifInfo.totalFrames;
    const frameSkip = Math.max(1, Math.round(100 / framePercentage));

    console.log(`📉 Frames seleccionados: ${Math.ceil(totalFrames / frameSkip)}`);

    const binStream = fs.createWriteStream(outputBin);
    
    const header = Buffer.alloc(6);
    header.writeUInt16LE(gifInfo.width, 0);
    header.writeUInt16LE(gifInfo.height, 2);
    header.writeUInt16LE(gifInfo.frameDuration, 4);
    binStream.write(header);

    let processedFrames = 0;

    for (let i = 0; i < totalFrames; i += frameSkip) {
        console.log(`🚀 Procesando frame ${i + 1}/${totalFrames}...`);

        try {
            const frame = frames[i];
            if (!frame) continue;
            const stream = frame.getImage();
            await streamPipeline(stream, fs.createWriteStream(`frame_${i}.png`));

            const pngBuffer = fs.readFileSync(`frame_${i}.png`);
            const png = PNG.sync.read(pngBuffer);
            const pixels = png.data;

            const frameBuffer = Buffer.alloc(gifInfo.width * gifInfo.height * 3);
            let index = 0;
            for (let j = 0; j < pixels.length; j += 4) {
                let r = pixels[j];
                let g = pixels[j + 1];
                let b = pixels[j + 2];

                if (palette.colors) {
                    [r, g, b] = closestColor([r, g, b], palette.colors);
                }

                frameBuffer[index++] = r;
                frameBuffer[index++] = g;
                frameBuffer[index++] = b;
            }

            binStream.write(frameBuffer);
            fs.unlinkSync(`frame_${i}.png`);
            processedFrames++;
        } catch (error) {
            console.error(`❌ Error procesando frame ${i + 1}:`, error);
        }
    }

    binStream.end();
    console.log(`✅ Archivo BIN generado: ${outputBin}`);
    console.log(`⏳ Proceso completado en ${(Date.now() - startTime) / 1000}s`);
}

function closestColor(color, palette) {
    let closest = palette[0];
    let minDistance = Infinity;
    
    for (let p of palette) {
        let distance = Math.sqrt((color[0] - p[0]) ** 2 + (color[1] - p[1]) ** 2 + (color[2] - p[2]) ** 2);
        if (distance < minDistance) {
            minDistance = distance;
            closest = p;
        }
    }
    return closest;
}
