# English Department Assessment Planner — Editable Source

This archive contains the editable application source. It intentionally excludes generated deployment and hosting output such as `out`, `dist`, `.next`, deployment caches, and `node_modules`.

Key files:

- `package.json` and `package-lock.json` — dependencies and scripts
- `next.config.ts` — Next.js configuration
- `app/` — application routes, interface, Firebase client configuration, and styles
- `components/` — component organization note and location map
- `firestore.rules` — Firebase Firestore security rules
- `public/` — static assets
- `db/` and `drizzle/` — included source data layer files

Install dependencies with `npm install`, then use the scripts defined in `package.json`.

## Updated assessment features

- Unlimited assessment columns
- Extra Credit Exam and Bonus assessment types
- Custom assessment names and maximum marks
- All-class or selected-student assignment
- Non-targeted students are excluded from that assessment's total calculation
- Individual student entry and Excel class upload
- Frozen Student ID and Student Name columns while scrolling horizontally

## GitHub Pages build

Run `npm install`, then `npm run build`. Upload everything inside `out` to the
root of the `assessment-follow-up` GitHub repository. Keep `.nojekyll` in the
repository root.
