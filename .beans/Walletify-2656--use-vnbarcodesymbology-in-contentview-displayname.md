---
# Walletify-2656
title: Use VNBarcodeSymbology in ContentView displayName
status: completed
type: task
priority: normal
created_at: 2026-03-23T01:04:37Z
updated_at: 2026-03-23T03:15:46Z
---

## Todo
- [x] Inspect current displayName implementation in ContentView.swift
- [x] Update displayName to use VNBarcodeSymbology instead of rawValue strings
- [x] Verify the change compiles logically and summarize the result

## Summary of Changes
- Reworked `BarcodeScanResult.displayName(for:)` to switch directly on `VNBarcodeSymbology` cases instead of comparing normalized raw-value strings.
- Kept a `rawValue`-based fallback only for unknown or future symbologies so the UI still shows a readable label.
- Verified the app still builds for the `Walletify` scheme on the `iPhone 17 Pro` simulator destination.
