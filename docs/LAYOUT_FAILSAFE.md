# Layout failsafe — v1.1.2

The entire production skin is embedded in `public/index.html` as `#vox-production-style`.
`public/styles.css` remains the source/debug copy, but page layout does not depend on a second CSS HTTP request.

Reason: a user observed the application logic rendering while `/styles.css` was effectively unavailable, exposing raw browser HTML. Because the server already sends the HTML with `Cache-Control: no-store`, embedding the production skin eliminates that network/cache failure point.

Release gate: the browser must render the expected grid/panel layout even when external CSS files are not requested at all.
