# Checked-image preparation for Coolify

The requested target is checked main merges deploying through Coolify by immutable
image digest. Today production still uses the existing successful CI → SSH Deploy
workflow. Its backend is the separate self-hosted Supabase production stack.
No release owner, production route, database, permission or public build setting
has been changed by this preparation.

## Current preparation

CI now exports an explicitly unconfigured demo runtime image after build/tests,
the PostgreSQL migration harness and all six existing browser audits pass. A receipt
binds the archive checksum and image configuration to the repository, complete
source revision, workflow run and attempt. A separate runner imports that archive
without rebuilding, checks nginx startup/configuration and the runtime revision,
then tests response headers, deep-link fallback, real browser navigation and all
12 existing demo accessibility view/viewport combinations. It also verifies the
revision after restart. Browser requests to external providers are denied during
the navigation test. The accessibility script's external-runtime mode only accepts
an explicitly labelled loopback demo runtime in GitHub CI.

The Docker build now uses Node22, matching package.json's >=22.12 requirement and
the existing CI Node22 runtime. Nginx startup remains the standard nginx master and
worker arrangement; this is not a claim that the master runs unprivileged.

These artifacts are labelled demo and **must not be promoted to production**.
Production's Supabase URL, public anon key, approved privacy notice and attachment
flag are build-time inputs. Testing an unconfigured image does not verify a
configured production image. The artifact is temporary (seven days); separate
attempt names do not guarantee survival across full workflow reruns.

## Remaining work before the handoff

1. Preserve the exact currently serving frontend image and build configuration,
   together with the Supabase database/storage/configuration recovery package.
2. Prepare production-configured image creation using the reviewed public build
   settings. Never supply the service-role key or backend signing secret. Match
   the compiled API origin and public key to nginx CSP/calendar configuration.
3. Test that configured saved image with isolated authenticated backend/browser
   journeys. Preserve the tested image and durable source/run/attempt receipt,
   publish its immutable digest and establish the chosen VPS registry access.
4. Prepare the correct inactive Coolify frontend resource and a consumer bound to
   its resource/server/destination, reviewed backup and exact checked digest.
   Supabase adoption and migration ownership require their own reviewed handoff;
   do not rebuild or replace the existing production stack implicitly.
5. After the configured candidate and rollback pass, obtain the exact live handoff
   approval. Retire the old SSH trigger in the same reviewed transition so both
   release owners cannot compete. Verify public HTTPS/revision and core journeys.

The deploy workflow, runtime configuration, Sites support and production Supabase
data are preserved. No registry publication or Coolify promotion is implemented by
the initial demo image transport gate. The full consolidation goal remains open.
