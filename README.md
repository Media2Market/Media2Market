# Media to Market — MVP

This package is a safer rewrite of the original single-file prototype.

## Files
- `index.html` — public dashboard
- `api/scan.js` — server-side Vercel function that calls Anthropic
- `original.html` — original uploaded prototype for reference

## Deploy on Vercel
1. Create a free GitHub account/repository if you do not already have one.
2. Upload the contents of this folder to the repository root. Keep the `api` folder exactly named `api`.
3. Sign in to Vercel and choose **Add New > Project**, then import the GitHub repository.
4. Deploy it. No build command is required for this simple static site + function structure.
5. In the Vercel project, go to **Settings > Environment Variables**.
6. Add `ANTHROPIC_API_KEY` and paste your Anthropic API key as the value. Enable it for Production (and Preview if desired).
7. Redeploy after adding/changing the environment variable.
8. Test the generated `*.vercel.app` site and press **Run Weekly Scan**.
9. In **Settings > Domains**, add `media2market.com` and optionally `www.media2market.com`.
10. Vercel will show the DNS records required. Add those records at the registrar where you bought the domain. Use Vercel's displayed values rather than guessing.
11. Choose one canonical domain and redirect the other to it.

## Important
Do not put your Anthropic API key inside `index.html` or any browser JavaScript. It belongs only in the Vercel Environment Variable.

## Research roadmap
The current MVP still uses web reporting to describe market aftermath. The serious research version should replace that with structured timestamped market data, fixed event windows (1h, 1d, 3d, 5d, 30d), benchmarks/abnormal returns, a persistent database, primary-source transcript ingestion, and validation against an event-only baseline.
