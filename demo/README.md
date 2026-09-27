# MasterLens

A browser-based 10-K analysis app with a dashboard, a chatbot, a currency converter and world clocks.

## Run it

It's a static site with no build step:

```bash
cd demo
python3 -m http.server 8000
# open http://localhost:8000
```

You can also open `index.html` directly. The app loads Chart.js, pdf.js and the Anthropic SDK from public CDNs, so it needs an internet connection.

## Features

| Tab | What it does |
|---|---|
| **Home** | Drag and drop a 10-K (PDF, HTML from SEC EDGAR, or TXT), or load the built-in fictional sample. Parsing happens in the browser. |
| **Big Tech** | Beginner view of 10 well-known US tech companies (Amazon, Apple, Alphabet, Microsoft, Meta, Nvidia, Tesla, IBM, Intel, Netflix) from their 10-K filings: who sells the most, who keeps the most, profit per $100, growth and revenue per employee, plus a live "sales since you opened the page" counter. |
| **10-K Analyzer** | KPI tiles with year-over-year change, revenue and net income by year, profitability bars, balance-sheet split, filing tone gauge, top risk themes from Item 1A, a clickable map of the filing's sections, and a table of every line item extracted. You can show the figures in any currency. |
| **Ask AI** | Chat with the filing. With no key it runs offline: BM25 passage search plus the extracted figures, with source chips that open the passage. If you add a Claude API key in **Settings**, answers stream from `claude-opus-5`, grounded in the most relevant passages. |
| **Currency** | Live rates for 150+ currencies (open.er-api.com), swap, a quick-view grid and a 30-day trend (frankfurter.app). Falls back to reference rates when offline. |
| **World Clock** | Analog clocks with brass rims and Roman numerals, day/night styling, UTC offset and "ahead/behind" labels. Add or remove cities (the list is saved), and use the time planner slider to see a chosen time everywhere. |

## Files

```
demo/
  index.html         app shell and views
  css/styles.css     theme (light and dark)
  js/parser.js       file-to-text, sections, line items, tone, risk themes
  js/bigtech.js      Big Tech beginner view and company data
  js/dashboard.js    10-K analyzer dashboard
  js/chat.js         retrieval and Claude API chat
  js/currency.js     rates and converter
  js/clocks.js       analog clocks and planner
  js/app.js          routing, theme, upload, settings
  js/sample.js       fictional sample 10-K
```

## Notes

- The line items come from heuristic parsing of the statement tables. Check important numbers against the filing.
- The API key is kept in browser storage and sent directly to the Claude API with `dangerouslyAllowBrowser`. That's fine for personal use; for a shared deployment, send the requests through your own backend instead.
- Scanned (image-only) PDFs contain no text to extract. Use the HTML version from EDGAR instead.
