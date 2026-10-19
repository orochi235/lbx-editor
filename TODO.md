# TODO

Known problems, not yet fixed.

## The hand tool warns on every render (fix waiting on a weasel release)

Weasel 1.11.0 logs `[SceneCanvas] tools prop overrides bundled "hand" tool` in development on every
render, because the app's `toolsPatch.hand` replaces the hand the `view` preset brings. The
replacement always happened; 1.11.0 is the first release whose dev warnings reach npm consumers.
Fixed on weasel `main` (2026-10-18, merge 42e56883d): replacing a preset's tool no longer warns.
Once a release carries it, bump the pins and check the console is quiet.
