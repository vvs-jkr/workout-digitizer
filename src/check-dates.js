import Database from "better-sqlite3";

const db = new Database("./output/workouts.db");

// Сводка по годам
const summary = db
    .prepare(
        `
  SELECT year, COUNT(DISTINCT full_date) as days, COUNT(*) as total
  FROM workouts WHERE year IN (2023, 2024) GROUP BY year
`,
    )
    .all();

console.log("\n📊 Сводка по годам:");
for (const row of summary) {
    const expected = row.year === 2024 ? 366 : 365;
    const missing = expected - row.days;
    console.log(
        `  ${row.year}: ${row.days}/${expected} дней (${missing} пропущено), ${row.total} тренировок`,
    );
}

// Находим пропущенные даты
for (const year of [2023, 2024]) {
    const days = db
        .prepare(
            `
    SELECT DISTINCT full_date FROM workouts
    WHERE year = ? AND full_date IS NOT NULL
    ORDER BY full_date
  `,
        )
        .all(year)
        .map((r) => r.full_date);

    const daysSet = new Set(days);
    const missing = [];

    const total = year === 2024 ? 366 : 365;
    for (let d = 0; d < total; d++) {
        const date = new Date(year, 0, 1 + d);
        const iso = date.toISOString().slice(0, 10);
        if (!daysSet.has(iso)) missing.push(iso);
    }

    console.log(`\n❌ Пропущенные дни ${year} (${missing.length}):`);
    // Группируем по месяцам для читаемости
    const byMonth = {};
    for (const d of missing) {
        const m = d.slice(0, 7);
        byMonth[m] = (byMonth[m] || 0) + 1;
    }
    for (const [month, cnt] of Object.entries(byMonth)) {
        console.log(`  ${month}: ${cnt} дней`);
    }
}

// Проверяем year_source для 2023
console.log("\n🔍 year_source для 2023:");
const sources = db
    .prepare(
        `
  SELECT year_source, COUNT(DISTINCT full_date) as days, COUNT(*) as total
  FROM workouts WHERE year = 2023
  GROUP BY year_source
`,
    )
    .all();
console.table(sources);

db.close();
