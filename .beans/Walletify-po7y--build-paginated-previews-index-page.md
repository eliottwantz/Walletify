---
# Walletify-po7y
title: Build paginated previews index page
status: completed
type: task
priority: normal
created_at: 2026-03-23T23:10:01Z
updated_at: 2026-03-23T23:22:41Z
---

## Goal

Replace the PKPassAPI root endpoint with a simple HTML page that lists Tuist previews with pagination and install buttons.

## Todo

- [x] Inspect current server entrypoint and root route behavior
- [x] Implement Tuist previews fetch and HTML rendering for `/`
- [x] Add pagination and install links using `device_url`
- [x] Update docs for the new index page behavior
- [x] Run typecheck and fix any issues

## Summary of Changes

- Replaced the root JSON response with a server-rendered previews index page backed by the Tuist list previews endpoint.
- Added paginated preview cards with install buttons that use `device_url`, plus a secondary link back to the Tuist dashboard.
- Documented the new `/` behavior and the `TUIST_TOKEN` requirement in the PKPassAPI README.


## Follow-up

- [x] Add a typed Tuist build model for preview builds
- [x] Include preview build version in the index page details
- [x] Run typecheck and update the bean summary


- Added a concrete `TuistBuild` type and matching preview schema validation for preview build payloads.
- Included the preview `build_version` in the rendered preview metadata on the index page.
