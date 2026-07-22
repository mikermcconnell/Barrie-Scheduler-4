# Skill maintenance

`.agents/skills/` is the canonical home for portable repository skills. Keep these instructions tool-neutral and use repository-relative paths.

`.claude/skills/` contains Claude-specific adapters. When shared behavior changes, update the portable skill first and mirror the behavior into its Claude adapter. Preserve intentional Claude terminology, lifecycle hooks, and `.claude/` references in the adapter; do not copy those tool-specific details back into the portable source.

Before finishing a skill change:

- verify every referenced repository path exists;
- keep required frontmatter (`name` and `description`) intact;
- prefer `rg` for repository searches;
- compare the portable skill with its adapter and confirm each difference is intentional.
