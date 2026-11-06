# Self-Host Operator Legal Guide (DRAFT)

- Status: DRAFT — REQUIRES_LEGAL_REVIEW
- slug: `selfhost-operator-guide` · version: `0.1.0-draft` · content_hash: PENDING
- Applicability: Community (self-hosted deployments).
- Type: Notice — guidance, not legal advice; get your own counsel.

## 1. Your licence (Apache-2.0)

You may use, modify, and distribute under LICENSE terms: keep the
LICENCE copy, mark modified files, retain copyright/attribution notices,
and include NOTICE attributions in distributions. No trademark grant
(§6): "ToLLma" marks need permission — rebrand or ask.

## 2. No warranty, no liability shift (§7–§8)

The software is "as is". Self-hosting does not transfer risk to the
project maintainers; you are responsible for your deployment's security
patches, secrets (SECRET_KEY, database passwords), and TLS.

## 3. You may become a fiduciary

If others' personal data flows through your instance (team use, public
gateway), data-protection law likely treats YOU as the fiduciary/
controller: publish your own privacy notice (adapt `privacy-notice`),
honor rights requests (`dsr-procedure` as a model), set retention, and
sign DPAs with your own customers. The Cloud DPA does not cover you.

## 4. Upstream provider terms still apply

Your stored provider credentials call third-party APIs under those
providers' terms and data practices — review `model-provider-disclosure`
before routing other people's prompts. Zero-retention workspace settings
and credential rotation exist for exactly this purpose.
