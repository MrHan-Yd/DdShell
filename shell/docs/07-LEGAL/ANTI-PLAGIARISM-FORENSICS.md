# Anti-Plagiarism Forensics Guide

This document defines practical anti-plagiarism and evidence-preservation practices for this project.

## Goal
- Allow open sharing under MIT.
- Improve traceability when unauthorized copy/resale happens.
- Keep evidence admissible and easy to organize.

## 1. Code Fingerprints
- Keep stable copyright headers in key source files.
- Keep unique project markers (naming patterns, constant keys, comment tags) that do not affect runtime behavior.
- Inject build metadata into binaries/releases:
  - commit hash
  - build time (UTC)
  - project identifier

## 2. Asset Watermarking
- Add subtle watermark/signature to UI assets (logo/splash/about/help screenshots).
- For exported docs/packages, append footer watermark:
  - project name
  - release version
  - release date

## 3. Release Evidence
- For every release, preserve:
  - source snapshot (tag)
  - release artifacts
  - SHA256 checksums
- Publish via immutable channels (e.g., Git tags + releases) to keep public timestamp evidence.
- Keep local backup of release bundles and hash manifests.

## 4. Legal and Notice Files
- Keep `LICENSE` and `README` disclaimer unchanged in meaning.
- Add/update a `NOTICE` file when needed for attribution history.
- If feasible, register name/logo trademark to reduce impersonation risk.

## 5. Incident Response Checklist
- Collect suspected infringing URL/package/app binary.
- Record evidence time, page screenshots, and download hashes.
- Compare fingerprints:
  - marker strings
  - asset watermark traits
  - binary build metadata
- Archive all evidence in a dated folder and preserve original files.

## 6. Important Boundary
- Watermarking does not prevent copying.
- It improves traceability and legal evidence quality.
- For legal actions, consult a qualified lawyer in your jurisdiction.
