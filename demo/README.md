# Transit On-Demand video demo

This capture presents a public-friendly, silent walkthrough of the On-Demand
workspace using illustrative CSV data. It starts with an empty workspace,
loads service requirements and anonymous contractor shifts, exposes a short
South-zone changeoff gap, moves one shift earlier, and confirms full coverage.

## Generate the video

From the repository root:

```powershell
npm.cmd run demo:ondemand
```

The command builds the application, starts a temporary local Vite server,
drives the real workspace in Chromium, records the interaction, adds the
on-screen narration, and exports:

`output/demo/transit-on-demand/transit-on-demand-demo-60s.webm`

The capture script fails if the delivery file exceeds 10 MB. It also writes
review frames to `output/demo/transit-on-demand/frames/`.

## One-time prerequisite

If Playwright Chromium is not installed on the computer:

```powershell
npx.cmd playwright install chromium
```

The two input files under `demo/fixtures/` are demonstration-only. They contain
no customer, driver, employee, or operational schedule information.
