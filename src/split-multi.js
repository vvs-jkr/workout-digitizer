import fs from "fs/promises";

const INPUT = "./output/workouts.json";
const OUTPUT = "./output/workouts_split.json";

const BLOCK_NAMES = [
    "Endurance",
    "Tactical",
    "Charge",
    "Power",
    "Candy",
    "Flash",
    "Home",
    "Gym",
    "Street",
];

const TYPE_MARKERS = [
    { re: /(\d+)\s*rounds?\s+for\s+time/i, type: "For time" },
    { re: /for\s+time/i, type: "For time" },
    { re: /amrap/i, type: "AMRAP" },
    { re: /emom/i, type: "EMOM" },
    { re: /tabata/i, type: "Tabata" },
    { re: /(\d+)\s*rounds?/i, type: "Rounds" },
];

const SKIP_WORDS = new Set([
    "amrap",
    "emom",
    "tabata",
    "for",
    "time",
    "rounds",
    "round",
    "mins",
    "min",
    "minutes",
    "of",
    "in",
    "every",
    "minute",
    "on",
    "the",
    "and",
    "with",
    "station",
    "per",
    "rest",
    "kg",
    "lbs",
    "lb",
]);

// ─── Определение типа / раундов / длительности ───────────────────────────────
function detectWorkoutType(text) {
    for (const { re, type } of TYPE_MARKERS) {
        if (re.test(text)) return type;
    }
    return "Other";
}

function detectRounds(text) {
    const m = text.match(/(\d+)\s*rounds?/i);
    return m ? parseInt(m[1]) : null;
}

function detectDuration(text) {
    const m = text.match(/(\d+)\s*min/i);
    return m ? parseInt(m[1]) : null;
}

// ─── Парсинг упражнений ──────────────────────────────────────────────────────
function parseExercises(blockText) {
    const exercises = [];

    // Если есть "OF:" — берём только часть после него
    // Иначе убираем заголовочные слова в начале
    let cleaned;
    const ofIdx = blockText.search(/\bOF:\s*/i);
    if (ofIdx !== -1) {
        cleaned = blockText
            .slice(ofIdx)
            .replace(/\bOF:\s*/i, "")
            .trim();
    } else {
        cleaned = blockText
            .replace(
                /^.*?\b(?:amrap|emom|tabata|for\s+time|rounds?)\b[^:]*?:\s*/i,
                "",
            )
            .trim();
    }

    // Токенизируем: разбиваем на слова сохраняя дефисы внутри слов
    const tokens = cleaned.split(/\s+/).filter(Boolean);

    let i = 0;
    while (i < tokens.length) {
        const tok = tokens[i];

        // Если токен — число, следующие токены — название упражнения
        if (/^\d+$/.test(tok)) {
            const reps = parseInt(tok);
            i++;
            const nameParts = [];

            // Собираем слова до следующего числа
            while (i < tokens.length && !/^\d+$/.test(tokens[i])) {
                nameParts.push(tokens[i]);
                i++;
            }

            if (nameParts.length === 0) continue;

            // Разделяем по запятой (последнее слово может быть заметкой: L-ARM)
            const full = nameParts.join(" ");
            const commaIdx = full.lastIndexOf(",");
            const name =
                commaIdx !== -1 ? full.slice(0, commaIdx).trim() : full;
            const note =
                commaIdx !== -1 ? full.slice(commaIdx + 1).trim() : null;

            if (name.length < 2) continue;
            if (SKIP_WORDS.has(name.toLowerCase())) continue;

            const durMatch = note?.match(/(\d+)\s*min/i);
            exercises.push({
                name,
                reps,
                sets: null,
                weight_kg: null,
                weight_note: durMatch ? null : note,
                duration_secs: durMatch ? parseInt(durMatch[1]) * 60 : null,
                notes: null,
            });
        } else {
            i++;
        }
    }

    return exercises;
}

// ─── Сплит raw_text на блоки ─────────────────────────────────────────────────
function splitIntoBlocks(rawText) {
    if (!rawText) return null;

    const pattern = new RegExp(
        `(?:^|\\s)(${BLOCK_NAMES.join("|")})(?=\\s|$|\\n)`,
        "gi",
    );

    const matches = [];
    let m;
    while ((m = pattern.exec(rawText)) !== null) {
        matches.push({
            name: m[1],
            index: m.index + (m[0].length - m[1].length),
        });
    }

    if (matches.length <= 1) return null;

    return matches.map((match, i) => {
        const start = match.index;
        const end = matches[i + 1]?.index ?? rawText.length;
        return { name: match.name, text: rawText.slice(start, end).trim() };
    });
}

// ─── Главная функция ─────────────────────────────────────────────────────────
async function main() {
    const raw = await fs.readFile(INPUT, "utf8");
    const records = JSON.parse(raw);

    const output = [];
    let splitCount = 0;
    let keptCount = 0;

    for (const rec of records) {
        const blocks = splitIntoBlocks(rec.raw_text);

        if (!blocks) {
            output.push(rec);
            keptCount++;
            continue;
        }

        for (const block of blocks) {
            output.push({
                file: rec.file,
                full_date: rec.full_date,
                year_resolution: rec.year_resolution,
                date_text: rec.date_text,
                year_in_image: rec.year_in_image,
                workout_name: block.name,
                workout_type: detectWorkoutType(block.text),
                duration_mins: detectDuration(block.text),
                rounds: detectRounds(block.text),
                exercises: parseExercises(block.text),
                source_type: rec.source_type,
                raw_text: block.text,
            });
        }
        splitCount++;
    }

    output.sort((a, b) => {
        if (!a.full_date) return 1;
        if (!b.full_date) return -1;
        return a.full_date.localeCompare(b.full_date);
    });

    await fs.writeFile(OUTPUT, JSON.stringify(output, null, 2));

    console.log(`✅ Готово!`);
    console.log(`   Входных записей:   ${records.length}`);
    console.log(`   Сплитнуто:         ${splitCount}`);
    console.log(`   Без изменений:     ${keptCount}`);
    console.log(`   Итого записей:     ${output.length}`);
    console.log(`   → ${OUTPUT}`);
}

main().catch(console.error);
