Inspect `git status`, then run the smallest relevant test set (or all tests when
the request explicitly calls for it). Fix only failures caused by the requested
work; report pre-existing or unrelated failures without changing unrelated
files. Do not use `--no-verify`, update snapshots blindly, or weaken assertions
to force a pass.
