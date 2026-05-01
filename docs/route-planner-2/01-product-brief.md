# Route Planner 2 Product Brief

## Product Statement

Route Planner 2 is a clean planning workspace for creating blank route concepts and testing their operational feasibility before any downstream schedule work.

It should help a planner answer: “If we ran this route concept, does it look operationally workable?”

## Why It Exists

Route concept work can become scattered across maps, spreadsheets, notes, and rough estimates. Route Planner 2 should bring the early planning workflow into one focused workspace without inheriting complexity from the old Route Planner.

## Primary User

Transit planners designing or testing early route concepts.

Secondary users:
- managers reviewing concept feasibility
- project leads preparing options for future service planning

## V1 Product Goal

Build an operational feasibility tool for a blank route concept.

A planner should be able to:
1. create a project
2. create one or more routes
3. draw a route concept
4. add and order stops
5. mark terminals
6. enter service assumptions
7. review runtime, cycle time, bus requirement, and warnings
8. compare routes in a simple metrics table
9. view an on-screen planning summary

## Product Principles

- Clean restart: do not import old Route Planner state, controllers, services, or assumptions.
- Planner controlled: the tool explains and warns; it does not make planning decisions silently.
- Operational first: map drawing only matters when it supports feasible service planning.
- Local first, Firebase ready: prove the workflow locally while keeping the data model suitable for future team-scoped persistence.
- Explain assumptions: runtime and bus outputs must show where numbers came from.

## Non-Goals for V1

Route Planner 2 v1 will not include:
- Firebase save/load
- population or employment coverage analysis
- downstream schedule handoff package
- old Route Planner migration
- GTFS feed editing or publishing; Route Planner 2 may import GTFS routes as local editable planning templates
- public trip planning
- dispatch or run cutting
- automatic publishing

## Success Criteria

V1 is successful when a planner can create a blank concept, add stops and service assumptions, and see whether the concept appears feasible enough to keep exploring.

Minimum success signals:
- project and route state are understandable
- stops and terminals drive the feasibility output
- runtime source and confidence are visible
- warnings are specific and actionable
- comparison helps choose which route deserves more work
