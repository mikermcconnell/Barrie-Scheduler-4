# Skill maintenance

Portable repository skills have two intentional roots:

- `.agents/skills/` is canonical for shared, tool-neutral skills that may have Claude adapters.
- `.codex/skills/` contains intentional Codex-owned feature skills such as `feature-delivery-loop`.

`AGENTS.md` is the authoritative skill registry. Keep portable instructions tool-neutral, use repository-relative paths, and update the registry if a skill entrypoint moves.

`.claude/skills/` contains Claude-specific adapters. When shared behavior changes, update the portable skill first and mirror the behavior into its Claude adapter. Preserve intentional Claude terminology, lifecycle hooks, and `.claude/` references in the adapter; do not copy those tool-specific details back into the portable source.

Before finishing a skill change:

- verify every referenced repository path exists;
- keep required frontmatter (`name` and `description`) intact;
- prefer `rg` for repository searches;
- compare the portable skill with its adapter and confirm each difference is intentional.
