# Route Planner 2 Test Strategy

## Testing Goals

Tests should protect the Route Planner 2 clean boundary and the operational feasibility calculations.

Focus on:
- scenario operations
- map authoring state transitions
- feasibility calculations
- warning generation
- old Route Planner isolation

## Unit Tests

Recommended coverage:
- create/duplicate/delete scenarios
- preferred scenario selection
- preferred scenario single-source-of-truth behavior
- stop ordering
- terminal role validation
- runtime source priority
- cycle time calculation
- bus requirement calculation
- confidence calculation
- warning generation

## Component Tests

Recommended coverage:
- workspace renders with starter project/scenario
- scenario selection updates details panel
- editing scenario name/notes updates state
- comparison table reflects scenario metrics
- “not ready” states appear when inputs are missing

## Integration Tests

Recommended v1 flows:
1. create blank scenario
2. add route points
3. add stops
4. mark terminals
5. enter frequency and terminal layovers
6. see feasibility outputs
7. duplicate scenario
8. compare metrics

## Regression Guards

Route Planner 2 should not import old Route Planner modules.

A simple guard test can scan Route Planner 2 files for disallowed imports from:
- `utils/route-planner/`
- old Route Planner controller hooks
- old Route Planner project services
- old Route Planner draft storage

## Manual QA Checklist

Before calling v1 work complete:
- project name can be edited
- scenario can be created, renamed, duplicated, deleted
- stops can be ordered and terminal roles are clear
- feasibility output shows not-ready states before required inputs
- runtime confidence is visible
- warnings are actionable
- comparison table is understandable
- UI does not imply Firebase save/export works before it does
