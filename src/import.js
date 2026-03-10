import Database from "better-sqlite3";
import fs from "fs/promises";
import path from "path";

const INPUT = "./output/workouts_split.json";
const DB_PATH = "./output/workouts.db";

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS workouts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  file             TEXT NOT NULL,
  full_date        TEXT,
  workout_name     TEXT,
  workout_type     TEXT,
  duration_mins    REAL,
  rounds           INTEGER,
  source_type      TEXT,
  raw_text         TEXT,
  year             INTEGER,
  year_confidence  TEXT,
  year_source      TEXT
);

CREATE TABLE IF NOT EXISTS exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id    INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  name          TEXT,
  reps          INTEGER,
  sets          INTEGER,
  weight_kg     REAL,
  weight_note   TEXT,
  duration_secs INTEGER,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(full_date);
CREATE INDEX IF NOT EXISTS idx_workouts_name ON workouts(workout_name);
CREATE INDEX IF NOT EXISTS idx_exercises_workout ON exercises(workout_id);
CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);
`;

async function main() {
    const raw = await fs.readFile(INPUT, "utf8");
    const records = JSON.parse(raw);

    try {
        await fs.unlink(DB_PATH);
    } catch {}

    const db = new Database(DB_PATH);
    db.exec(SCHEMA);

    const insertWorkout = db.prepare(`
    INSERT INTO workouts
      (file, full_date, workout_name, workout_type, duration_mins, rounds,
       source_type, raw_text, year, year_confidence, year_source)
    VALUES
      (@file, @full_date, @workout_name, @workout_type, @duration_mins, @rounds,
       @source_type, @raw_text, @year, @year_confidence, @year_source)
  `);

    const insertExercise = db.prepare(`
    INSERT INTO exercises
      (workout_id, name, reps, sets, weight_kg, weight_note, duration_secs, notes)
    VALUES
      (@workout_id, @name, @reps, @sets, @weight_kg, @weight_note, @duration_secs, @notes)
  `);

    let totalWorkouts = 0;
    let totalExercises = 0;
    let skipped = 0;

    const importAll = db.transaction(() => {
        for (const r of records) {
            if (!r.file) {
                skipped++;
                continue;
            }

            const yr = r.year_resolution || {};
            const workoutId = insertWorkout.run({
                file: r.file,
                full_date: r.full_date ?? null,
                workout_name: r.workout_name ?? null,
                workout_type: r.workout_type ?? null,
                duration_mins: r.duration_mins ?? null,
                rounds: r.rounds ?? null,
                source_type: r.source_type ?? null,
                raw_text: r.raw_text ?? null,
                year: yr.year ?? null,
                year_confidence: yr.confidence ?? null,
                year_source: yr.source ?? null,
            }).lastInsertRowid;

            for (const ex of r.exercises || []) {
                insertExercise.run({
                    workout_id: workoutId,
                    name: ex.name ?? null,
                    reps: ex.reps ?? null,
                    sets: ex.sets ?? null,
                    weight_kg: ex.weight_kg ?? null,
                    weight_note: ex.weight_note ?? null,
                    duration_secs: ex.duration_secs ?? null,
                    notes: ex.notes ?? null,
                });
                totalExercises++;
            }
            totalWorkouts++;
        }
    });

    importAll();
    db.close();

    console.log(`✅ Импорт завершён:`);
    console.log(`   workouts  → ${totalWorkouts}`);
    console.log(`   exercises → ${totalExercises}`);
    if (skipped) console.log(`   пропущено → ${skipped}`);
    console.log(`   БД        → ${path.resolve(DB_PATH)}`);
}

main().catch(console.error);
