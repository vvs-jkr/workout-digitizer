# Workout Digitizer

Extracts structured workout data from images using Claude Vision API and saves results to JSON.

## What it does

- Scans folders with workout images (JPG / PNG / WebP)
- Sends each image to Claude Vision — reads text, recognizes workout structure
- Extracts: date, workout name, type, rounds, duration, exercises with reps / sets / weight
- Resolves year from folder name or file metadata
- Detects and removes duplicates
- Retries failed images without re-processing the rest

## Project structure

```
workout-digitizer/
├── src/
│   ├── index.js          # Main script — scans images, calls Claude API, saves results
│   └── detect-multi.js   # Finds records with multiple workouts per day
├── images/
│   ├── <year>/           # Subfolder name is used as year (e.g. 2023, 2024)
│   └── *.jpg/png         # Root images — year resolved from file metadata
├── output/
│   ├── workouts.json     # All extracted workouts
│   ├── duplicates.json   # Detected duplicates
│   ├── unresolved.json   # Records with uncertain year
│   └── errors.json       # Failed files (used for --retry)
└── .env
```

## Setup

```bash
npm install
```

Create `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
IMAGES_ROOT=./images
```

## Usage

Full run:
```bash
node src/index.js
```

Retry failed files only:
```bash
node src/index.js --retry
```

Detect records with multiple workouts per day:
```bash
node src/detect-multi.js
```

## Output format

Each record in `workouts.json`:
```json
{
  "file": "images/2023/17.11.2023.jpg",
  "full_date": "2023-11-17",
  "year_resolution": { "year": 2023, "confidence": "high", "source": "folder_name" },
  "workout_name": "Charge",
  "workout_type": "For time",
  "rounds": 10,
  "exercises": [
    { "name": "Air Squat", "reps": 25, "sets": null, "weight_kg": null, "weight_note": null, "duration_secs": null, "notes": null }
  ],
  "raw_text": "NOVEMBER 17 Charge 10 ROUND FOR TIME..."
}
```

## Dependencies

- [anthropic](https://www.npmjs.com/package/@anthropic-ai/sdk) — Claude API client
- [glob](https://www.npmjs.com/package/glob) — file scanning
- [p-limit](https://www.npmjs.com/package/p-limit) — concurrency control
- [dotenv](https://www.npmjs.com/package/dotenv) — env config
