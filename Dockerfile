FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Build-time configuration, and it has to be ARGs rather than container environment: Vite inlines
# VITE_* into the bundle at build time and this app has no runtime injection path, so a value that
# only exists in the running container reaches nothing.
#
# The defaults are empty on purpose. An empty value makes src/supabase-config.js:13 return
# `configured:false`, which renders the interactive demo -- so a build with no arguments produces
# exactly what this image produced before these ARGs existed. Adding the plumbing does not change
# any existing deploy.
#
# VITE_SUPABASE_ANON_KEY must be the ANON key. src/supabase-config.js:5 rejects a service_role key
# by decoding the JWT, and it is called from vite.config.mjs at config time -- so passing the wrong
# key fails the build outright rather than shipping a bundle that hands every visitor full
# row-level-security bypass.
#
# BuildKit lints both of these as "secrets used in ARG or ENV" on every build. That is a false
# positive here and is expected: the anon key is public by design and ships to every browser in the
# bundle either way, and the service key is never passed to this file. The lint stays on rather than
# being suppressed, because the day someone adds the SERVICE key as a build arg is exactly the day
# that warning should be read.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
# Left empty until counsel has signed the exact notice text: src/AuthenticatedIntake.jsx:121 locks
# guardian intake without it, and a version set early would make guardian_consents.notice_version
# record a notice nobody approved. Wired now so that clearing it later is one .env change and no
# code change.
ARG VITE_PRIVACY_NOTICE_VERSION=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_PRIVACY_NOTICE_VERSION=$VITE_PRIVACY_NOTICE_VERSION

RUN npm run build

FROM nginx:1.25-alpine
COPY --from=build /app/dist/client /usr/share/nginx/html
# Rendered to /etc/nginx/conf.d/default.conf by the image's envsubst entrypoint, so the CSP can
# name the API origin. NGINX_ENVSUBST_FILTER is load-bearing, not tidiness -- without it envsubst
# blanks `$uri` and breaks the SPA's deep-link fallback. See nginx.conf.template.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=BRITELINK_

# Re-declared because ARG scope is per-stage; this picks up the same --build-arg as the build stage.
ARG VITE_SUPABASE_URL=""

# The CSP origin is derived from the SAME build arg that configured the JS bundle, so the policy and
# the code agree by construction -- not by the caller remembering to pass both. Measured: run this
# image with no arguments and the CSP is `connect-src 'self'`; build it with an API origin and the
# same image renders `connect-src 'self' <origin>` with no runtime environment set at all.
#
# This is deliberately not overridable at run time. The bundle's API origin is fixed at BUILD time --
# Vite inlines it and there is no runtime injection -- so a runtime override could only ever set the
# policy to an origin the already-built JavaScript does not call. That is the precise failure this
# coupling exists to prevent: the app silently CSP-blocked against its own backend.
#
# MUST stay defined even when empty: the nginx entrypoint builds its substitution list from env
# names matching the filter, so an UNDEFINED value is left in the file as the literal text
# `${BRITELINK_API_ORIGIN}` -- which nginx then reads as a variable reference, fails with "unknown
# variable", and refuses to start. That is a total outage at container start, not a broken header.
ENV BRITELINK_API_ORIGIN=$VITE_SUPABASE_URL
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
