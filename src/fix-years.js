import Database from "better-sqlite3";

const db = new Database("./output/workouts.db");

// Пересчитываем full_date: 2023-MM-DD → 2024-MM-DD
// Только для записей где год был определён по mtime файла
const result = db
    .prepare(
        `
  UPDATE workouts
  SET
    year       = 2024,
    full_date  = '2024' || SUBSTR(full_date, 5),
    year_source = 'file_mtime_corrected'
  WHERE year_source = 'file_mtime'
    AND year = 2023
    AND full_date IS NOT NULL
`,
    )
    .run();

console.log(`✅ Обновлено записей: ${result.changes}`);

// Проверяем итог
const summary = db
    .prepare(
        `
  SELECT year, COUNT(DISTINCT full_date) as days, COUNT(*) as total
  FROM workouts WHERE year IN (2023, 2024) GROUP BY year
`,
    )
    .all();

console.log("\n📊 После исправления:");
for (const row of summary) {
    const expected = row.year === 2024 ? 366 : 365;
    const missing = expected - row.days;
    console.log(
        `  ${row.year}: ${row.days}/${expected} дней (${missing} пропущено), ${row.total} тренировок`,
    );
}

db.close();
