# Route Planner 2 User Workflows

## Primary V1 Workflow: Blank Route Concept

1. Open Route Planner 2.
2. Create or rename a project.
3. Create a route.
4. Draw the route alignment.
5. Add stops along the alignment.
6. Mark start and end terminals.
7. Enter service assumptions.
8. Review operational feasibility outputs.
9. Duplicate the route to test another option.
10. Compare route metrics.
11. Review the on-screen summary.

## Project and Route Workflow

A project is the planning container. A route is one route option inside that project.

Required v1 actions:
- rename project
- create route
- rename route
- duplicate route
- delete route
- select active route
- mark one route as preferred when ready

V1 may store this state locally only. The workflow should still use stable IDs and a structure that can later move to Firebase.

Preferred route should be project-level state. Do not create competing “preferred” flags on multiple routes.

## Stop-Aware Authoring Workflow

The planner should be able to:
- add route points to form an alignment
- add stops
- reorder stops
- remove stops
- mark stop roles: regular stop, timed stop, start terminal, end terminal
- see warnings when terminal roles are missing or invalid

The route line is useful, but stops and terminals are what make the concept operationally meaningful.

## Service Assumption Workflow

The planner enters simple assumptions:
- first trip time
- last trip time
- target frequency
- start and end terminal layover minutes
- day type or planning period if needed

The output updates from these assumptions.

## Comparison Workflow

V1 comparison should be simple and table-based.

Compare routes by:
- stop count
- estimated one-way runtime
- cycle time
- buses required
- warning count
- confidence level

Map overlay comparison is future scope.

## Summary Workflow

V1 should provide an on-screen summary only.

The summary should include:
- route name
- stop count and terminal status
- service assumptions
- runtime/cycle/bus outputs
- runtime source and confidence
- warnings and notes

Future versions may turn this into a structured schedule handoff package.
