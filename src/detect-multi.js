import fs from "fs/promises";

const INPUT = "./output/workouts.json";

// Названия блоков Tactical WOD
const BLOCK_NAMES = [
    "charge",
    "power",
    "tactical",
    "home",
    "gym",
    "street",
    "endurance",
    "candy",
    "flash",
];

// Считаем сколько раз встречаются маркеры типов тренировок
const TYPE_MARKERS = [
    "for time",
    "amrap",
    "emom",
    "tabata",
    "every minute",
    "rounds for time",
];

function detectMultiple(raw) {
    if (!raw) return { isMulti: false, reason: null };
    const lower = raw.toLowerCase();

    // Считаем вхождения названий блоков
    const foundBlocks = BLOCK_NAMES.filter((b) => lower.includes(b));
    if (foundBlocks.length >= 2) {
        return { isMulti: true, reason: `blocks: ${foundBlocks.join(", ")}` };
    }

    // Считаем вхождения маркеров типов тренировок
    const markerCount = TYPE_MARKERS.reduce(
        (sum, m) => sum + (lower.split(m).length - 1),
        0,
    );
    if (markerCount >= 2) {
        return {
            isMulti: true,
            reason: `${markerCount}x workout type markers`,
        };
    }

    return { isMulti: false, reason: null };
}

async function main() {
    const raw = await fs.readFile(INPUT, "utf8");
    const records = JSON.parse(raw);

    const multi = [];
    const single = [];

    for (const r of records) {
        const { isMulti, reason } = detectMultiple(r.raw_text);
        if (isMulti) {
            multi.push({ file: r.file, date: r.full_date, reason });
        } else {
            single.push(r.file);
        }
    }

    console.log(`Всего записей:       ${records.length}`);
    console.log(`Одна тренировка:     ${single.length}`);
    console.log(`Несколько тренировок:${multi.length}`);
    console.log(`\nПримеры:`);
    multi
        .slice(0, 10)
        .forEach((m) => console.log(`  ${m.date}  ${m.file}  (${m.reason})`));

    // Сохраняем список для retry
    await fs.writeFile(
        "./output/multi_errors.json",
        JSON.stringify(
            multi.map((m) => ({ file: m.file })),
            null,
            2,
        ),
    );
    console.log(`\n→ Список сохранён в output/multi_errors.json`);
}

main().catch(console.error);
