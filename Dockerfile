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
# MUST stay defined, even empty. The entrypoint builds its substitution list from env names that
# match the filter, so an UNDEFINED BRITELINK_API_ORIGIN is left in the file as the literal text
# `${BRITELINK_API_ORIGIN}` -- and nginx then reads that `$BRITELINK_API_ORIGIN` as a variable
# reference, fails with "unknown variable", and refuses to start at all. Defined-but-empty
# substitutes cleanly to `connect-src 'self' ;`, which is valid and is the demo policy.
ENV BRITELINK_API_ORIGIN=""
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
