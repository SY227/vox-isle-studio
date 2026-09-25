# Singing Fox architecture

See [v1.3.0 architecture](VOCAL_INTELLIGENCE_V1.3.0.md).

The app remains Node HTTP/NDJSON plus browser-native modules. Vercel serves built static public/shared assets and a Node API adapter. Playback uses the original YouTube controller, while AI-generated timed score data drives visual states. The provider and musical accuracy limits are documented in the README and current QA report.
