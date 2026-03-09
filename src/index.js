import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import pLimit from "p-limit";
import dotenv from "dotenv";
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const IMAGES_ROOT = process.env.IMAGES_ROOT || "./Tactical";
const OUTPUT_DIR = "./output";
const CONCURRENCY = 3; // параллельных запросов к API

// ─── Промпт для Claude ───────────────────────────────────────────────────────
const EXTRACT_PROMPT = `You are a fitness data extractor. Analyze this workout image and return ONLY valid JSON, no markdown, no explanation.

Extract:
- date_text: the date as written on image (e.g. "April 18", "3 февраля 2024")
- year_in_image: year if explicitly present in image, else null
- workout_name: workout name/title (e.g. "Charges", "Power", "Candy")
- workout_type: one of ["For time", "AMRAP", "EMOM", "Tabata", "Lifting", "Rounds", "Other"]
- duration_mins: number if specified, else null
- rounds: number if specified (e.g. "5 rounds"), else null
- exercises: array of { name, reps, sets, weight_kg, weight_note, duration_secs, notes }
- source_type: one of ["tactical_wod", "app_screenshot", "other"]
- raw_text: full raw text from image

Return only JSON. Example:
{
  "date_text": "April 18",
  "year_in_image": null,
  "workout_name": "Charges",
  "workout_type": "For time",
  "duration_mins": null,
  "rounds": null,
  "exercises": [
    { "name": "Burpees", "reps": 10, "sets": null, "weight_kg": null, "weight_note": null, "duration_secs": null, "notes": null }
  ],
  "source_type": "tactical_wod",
  "raw_text": "APRIL 18 CHARGES For time: 10 Burpees..."
}`;

// ─── Определение года для корневых файлов ────────────────────────────────────
const MONTH_MAP = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    января: 1,
    февраля: 2,
    марта: 3,
    апреля: 4,
    мая: 5,
    июня: 6,
    июля: 7,
    августа: 8,
    сентября: 9,
    октября: 10,
    ноября: 11,
    декабря: 12,
};

function parseMonthDay(dateText) {
    if (!dateText) return null;
    const lower = dateText.toLowerCase();
    for (const [monthName, monthNum] of Object.entries(MONTH_MAP)) {
        const match = lower.match(
            new RegExp(`(\\d{1,2})\\s+${monthName}|${monthName}\\s+(\\d{1,2})`),
        );
        if (match) {
            const day = parseInt(match[1] || match[2]);
            return { month: monthNum, day };
        }
    }
    return null;
}

// ─── Обработка одного изображения ───────────────────────────────────────────
async function processImage(imagePath, knownYear = null) {
    const imageBuffer = await fs.readFile(imagePath);
    const base64 = imageBuffer.toString("base64");

    // Определяем реальный формат по magic bytes, а не по расширению
    function detectMediaType(buf) {
        if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
        if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
        // WebP: "RIFF" at 0-3, "WEBP" at 8-11
        if (
            buf[0] === 0x52 &&
            buf[1] === 0x49 &&
            buf[8] === 0x57 &&
            buf[9] === 0x45
        )
            return "image/webp";
        if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
        const ext = path.extname(imagePath).toLowerCase().slice(1);
        return ext === "png" ? "image/png" : "image/jpeg";
    }
    const mediaType = detectMediaType(imageBuffer);

    // Для больших файлов используем Sonnet, для остальных Haiku
    const isLargeFile = path.basename(imagePath).match(/\d+-\d+/); // многодневные файлы
    const model = isLargeFile
        ? "claude-sonnet-4-20250514"
        : "claude-haiku-4-5-20251001";
    const maxTokens = isLargeFile ? 8192 : 4096;

    const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: mediaType,
                            data: base64,
                        },
                    },
                    { type: "text", text: EXTRACT_PROMPT },
                ],
            },
        ],
    });

    const text = response.content[0].text.trim();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        // На случай если модель всё же добавила ```json
        const clean = text.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
    }

    // Резолвим год
    const stats = await fs.stat(imagePath);
    let yearResolution;

    if (knownYear) {
        yearResolution = {
            year: knownYear,
            confidence: "high",
            source: "folder_name",
        };
    } else if (parsed.year_in_image) {
        yearResolution = {
            year: parsed.year_in_image,
            confidence: "high",
            source: "image_text",
        };
    } else {
        // Корневые файлы — скорее всего 2024, так как 2023 уже разложен по папке
        // Но проверяем mtime: если файл явно из 2023 — доверяем ему
        const fileYear = new Date(stats.mtime).getFullYear();
        if (fileYear === 2023) {
            yearResolution = {
                year: 2023,
                confidence: "medium",
                source: "file_mtime",
            };
        } else {
            yearResolution = {
                year: 2024,
                confidence: "high",
                source: "root_folder_default",
            };
        }
    }

    // Строим итоговую дату
    const md = parseMonthDay(parsed.date_text);
    let full_date = null;
    if (md) {
        full_date = `${yearResolution.year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
    }

    return {
        file: imagePath,
        full_date,
        year_resolution: yearResolution,
        ...parsed,
    };
}

// ─── Дедупликация ────────────────────────────────────────────────────────────
function buildExerciseFingerprint(exercises = []) {
    return exercises
        .map((e) => e.name?.toLowerCase().replace(/\s+/g, "_"))
        .filter(Boolean)
        .sort()
        .join("|");
}

function findDuplicates(workouts) {
    const seen = new Map();
    const duplicates = [];

    for (const w of workouts) {
        const key = `${w.full_date}__${buildExerciseFingerprint(w.exercises)}`;
        if (seen.has(key)) {
            duplicates.push({
                original: seen.get(key).file,
                duplicate: w.file,
                date: w.full_date,
            });
        } else {
            seen.set(key, w);
        }
    }
    return duplicates;
}

// ─── Главная функция ─────────────────────────────────────────────────────────
async function main() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Режим retry — обрабатываем только файлы из errors.json
    const RETRY_MODE = process.argv.includes("--retry");

    // Собираем все изображения
    const allImages = [];

    // 2023 папка
    const images2023 = await glob(`${IMAGES_ROOT}/2023/**/*.{jpg,jpeg,png}`, {
        nocase: true,
    });
    images2023.forEach((f) => allImages.push({ path: f, year: 2023 }));

    // 2024 папка
    const images2024 = await glob(`${IMAGES_ROOT}/2024/**/*.{jpg,jpeg,png}`, {
        nocase: true,
    });
    images2024.forEach((f) => allImages.push({ path: f, year: 2024 }));

    // Корень (год неизвестен)
    const imagesRoot = await glob(`${IMAGES_ROOT}/*.{jpg,jpeg,png}`, {
        nocase: true,
    });
    imagesRoot.forEach((f) => allImages.push({ path: f, year: null }));

    console.log(`📦 Найдено изображений: ${allImages.length}`);
    console.log(`  2023: ${images2023.length}`);
    console.log(`  2024: ${images2024.length}`);
    console.log(`  Неизвестный год: ${imagesRoot.length}`);

    // В режиме retry фильтруем только упавшие файлы
    let toProcess = allImages;
    if (RETRY_MODE) {
        const errorsRaw = await fs.readFile(
            `${OUTPUT_DIR}/errors.json`,
            "utf8",
        );
        const errorFiles = new Set(
            JSON.parse(errorsRaw).map((e) => path.resolve(e.file)),
        );
        toProcess = allImages.filter(({ path: p }) =>
            errorFiles.has(path.resolve(p)),
        );
        console.log(`🔄 Retry mode: ${toProcess.length} файлов`);
    }

    // Обрабатываем с ограничением параллелизма
    const limit = pLimit(CONCURRENCY);
    const results = [];
    const errors = [];
    let done = 0;

    await Promise.all(
        toProcess.map(({ path: imgPath, year }) =>
            limit(async () => {
                try {
                    const result = await processImage(imgPath, year);
                    results.push(result);
                } catch (err) {
                    errors.push({ file: imgPath, error: err.message });
                }
                done++;
                process.stdout.write(
                    `\r⚙️  Обработано: ${done}/${allImages.length}`,
                );
            }),
        ),
    );

    console.log("\n");

    // В retry режиме мержим с предыдущими результатами
    let finalResults = results;
    if (RETRY_MODE) {
        const prevRaw = await fs.readFile(
            `${OUTPUT_DIR}/workouts.json`,
            "utf8",
        );
        const prevResults = JSON.parse(prevRaw);
        // Нормализуем пути для корректного сравнения (Windows vs Unix)
        const norm = (p) => path.resolve(p).replace(/\\/g, "/");
        const newFiles = new Set(results.map((r) => norm(r.file)));
        finalResults = [
            ...prevResults.filter((r) => !newFiles.has(norm(r.file))),
            ...results,
        ];
    }

    finalResults.sort((a, b) => {
        if (!a.full_date) return 1;
        if (!b.full_date) return -1;
        return a.full_date.localeCompare(b.full_date);
    });

    // Дедупликация
    const duplicates = findDuplicates(finalResults);

    // Выделяем тренировки с низкой уверенностью в годе
    const unresolved = finalResults.filter(
        (r) => r.year_resolution?.confidence === "low",
    );

    // Сохраняем
    await fs.writeFile(
        `${OUTPUT_DIR}/workouts.json`,
        JSON.stringify(finalResults, null, 2), // было: results
    );
    await fs.writeFile(
        `${OUTPUT_DIR}/duplicates.json`,
        JSON.stringify(duplicates, null, 2),
    );
    await fs.writeFile(
        `${OUTPUT_DIR}/unresolved.json`,
        JSON.stringify(unresolved, null, 2),
    );
    await fs.writeFile(
        `${OUTPUT_DIR}/errors.json`,
        JSON.stringify(errors, null, 2),
    );

    console.log(`✅ Готово!`);
    console.log(`  workouts.json    → ${finalResults.length} тренировок`);
    console.log(`  duplicates.json  → ${duplicates.length} дублей`);
    console.log(
        `  unresolved.json  → ${unresolved.length} с неизвестным годом`,
    );
    console.log(`  errors.json      → ${errors.length} ошибок`);
}

main().catch(console.error);
