# TODO

Known problems, not yet fixed.

## The hand tool warns on every render (fix waiting on a weasel release)

Since weasel 1.11.0 the `view` preset always registers the built-in hand tool, so the app's own
(`toolsPatch.hand`, rebuilt to restate its palette group) counts as an override and logs
`[SceneCanvas] tools prop overrides bundled "hand" tool` in development on every render. Seen
2026-10-18. A weasel fix is in progress; once it ships, bump the pins and check the console is quiet.
