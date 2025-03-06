const fs = require('fs');
const gifFrames = require('gif-frames');
const { PNG } = require('pngjs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const INPUT_GIF = 'result.gif';
const OUTPUT_BIN = 'result.bin';

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

async function selectFramePercentage() {
    const framePercentage = parseInt(await prompt("🛠️ Ingrese el porcentaje de frames a conservar (1-100): "), 10);
    return Math.max(1, Math.min(100, framePercentage));
}

function prompt(question) {
    return new Promise(resolve => {
        process.stdout.write(question);
        process.stdin.once("data", data => resolve(data.toString().trim()));
    });
}

(async () => {
    const gifInfo = await analyzeGIF(INPUT_GIF);
    const framePercentage = await selectFramePercentage();
    await processGIF(INPUT_GIF, OUTPUT_BIN, framePercentage, gifInfo);
    process.exit(0);
})();

async function processGIF(input, outputBin, framePercentage, gifInfo) {
    const startTime = Date.now();
    const frames = await gifFrames({ url: input, frames: 'all', outputType: 'png' });

    const totalFrames = gifInfo.totalFrames;
    const frameSkip = Math.max(1, Math.round(100 / framePercentage));
    const selectedFrames = Math.ceil(totalFrames / frameSkip);

    console.log(`📉 Frames seleccionados: ${selectedFrames}`);

    const binStream = fs.createWriteStream(outputBin);

    // Escribimos la cabecera con ancho, alto y duración de frame
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
            const pngBuffer = await streamToBuffer(stream);
            const png = PNG.sync.read(pngBuffer);
            const pixels = png.data;

            const frameBuffer = Buffer.alloc(gifInfo.width * gifInfo.height * 3);
            let index = 0;
            for (let j = 0; j < pixels.length; j += 4) {
                frameBuffer[index++] = pixels[j];     // Red
                frameBuffer[index++] = pixels[j + 1]; // Green
                frameBuffer[index++] = pixels[j + 2]; // Blue
            }

            binStream.write(frameBuffer);
            processedFrames++;
        } catch (error) {
            console.error(`❌ Error procesando frame ${i + 1}:`, error);
        }
    }

    binStream.end();
    console.log(`✅ Archivo BIN generado: ${outputBin}`);
    console.log(`⏳ Proceso completado en ${(Date.now() - startTime) / 1000}s`);
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}
