# Project Context

## User Context
- **Experience Level**: New to coding. Explanations should be clear, step-by-step, and avoid overly technical jargon where possible.

## Project Overview
- **Name**: Bus Scheduler
- **Tech Stack**: React, Vite, TypeScript, Tailwind CSS
- **AI Integration**: Google Gemini (gemini-3-pro-preview) via `@google/genai` SDK.

## Key Features
### Data Parsing
- **Master Schedule (Demand)**: Parses `08.2025 Schedule Master (TOD).csv`. Separates requirements for **Weekday**, **Saturday**, and **Sunday**.
- **RideCo Shifts (Supply)**: Parses `RideCo - Template ToD Shifts.csv`.
    - Identifies day type (Weekday/Sat/Sun) from Row 11.
    - Extracts explicit break durations (Row 20) or calculates from window.
    - **Bus 10 Specifics**: Verified parsing for Bus 10 (12:15-22:15, 40m break).

### AI Optimization (Gemini)
- **Model**: `gemini-3-pro-preview`
- **Temperature**: `0.3` (Balanced for efficiency puzzle-solving).
- **Priority**: **Efficiency & Balance**.
    - Goal: Match demand curve closely.
    - Tolerance: Slight understaffing (max 1 bus) allowed to save hours.
- **Constraints**:
    - **Shift Length**: 5 to 10 hours.
    - **Breaks**: Mandatory 45m (3 slots) for shifts > 6 hours.
    - **Break Window**: 5th to 8th hour of shift.
- **Strategy**:
    - Mix of 5h, 8h, 10h shifts.
    - **Smart Breaks**: Place breaks during demand valleys to minimize service impact.
