# Site navigation and discovery

The site separates discovery from experiment execution. The home page introduces
ARGOS, the catalog exposes all 23 workshops, and each workshop retains its own
model or recording reader, linked views, controls and measured comparisons.

## Routes and modes

- `/`: home, introductory workshop links and an explanation of the evidence.
- `/workshops/`: catalog with search, theme, difficulty and execution-mode filters.
- `/consensus/`: distributed average consensus, previously at the root.
- The other 22 workshop routes retain their existing addresses.

Known old root fragments, including `/#experiment`, `/#field-notes` and `/#model`,
redirect to the matching consensus section. This compatibility handler requires
JavaScript; a visible consensus link also remains on the home page. Home fragments
such as `/#about` stay on the home page.

Workshops 01–13 are **Interactive simulation**: computation in the browser over
explicit educational models. Workshops 14–23 are **Recorded replay**: saved
external software execution with synthetic inputs or simulated flight dynamics.
These mode labels are separate from fidelity. Several actual autopilot programs
can run against independent simulated worlds; workshop 23 instead uses one shared
Gazebo world. Neither browser mode connects to live mission execution.

The home terrain is an original schematic illustration. Its paths and links are
hand-composed visual relations, not planned trajectories, recorded telemetry or
evidence of mission success. Switching its layer changes only that illustration.

## Catalog behavior

`src/site/workshops.js` is the metadata source for IDs, routes, titles, questions,
themes, difficulties, preparation, execution modes and fidelity. It imports no
model, renderer or recording. The catalog combines independent filters and shows
active selections, the matching count and a clear empty state. URL parameters
preserve a selection for sharing and browser Back/Forward:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `q` | Case-insensitive words in workshop metadata | `q=ROS+2` |
| `theme` | Theme key | `theme=localization-and-mapping` |
| `difficulty` | Beginner, intermediate or advanced | `difficulty=beginner` |
| `mode` | Browser computation or recorded evidence | `mode=replay` |
| `start=1` | Beginner workshops with no workshop prerequisites | Workshops 01, 02, 03 and 05 |

Unknown filter values fall back to all values. Search text is displayed as text,
not HTML. A typing session creates one history entry; later edits in the same
session replace it, so Back does not step through every character. Other filter
changes create separate history entries.

Preparation is advice, not an access lock. Each workshop's expandable details
link to recommended and helpful prior workshops and explain its model limits.
The introductory selection excludes workshop 18, which has no prior-workshop
requirement but introduces autopilot and telemetry concepts at intermediate level.

## Static shell and browser enhancement

Vite's `scripts/site-plugin.js` renders common header/footer markers, compact
workshop navigation and catalog HTML in development and in the production build.
The catalog's 23 workshop links and preparation details are present in the HTML;
they remain usable without JavaScript. JavaScript adds filtering, URL restoration,
a mobile menu and a workshop selector. Previous/next and catalog links remain
available when the selector cannot run. Switching workshops starts a fresh
experiment or rewinds a recording.

`src/site/shell.css` styles the common navigation. `src/site/site.css` styles only
the editorial pages; experiment controls and their established styles remain
separate. Fonts are served locally with their [license notices](../public/fonts/README.md).
The home page has a static illustration fallback when its canvas cannot run.

The 25-page build includes home, catalog and the 23 workshops. A root-relative
Vite `base`, such as `/` or `/argos/`, prefixes authored and generated site links
as well as the build's assets.
No domain or hosting-specific canonical URL is embedded. Home and catalog load
neither Three.js nor the large replay datasets; those remain workshop resources.

## Verification

The registry tests check stable unique IDs/routes, preparation references and
cycles, existing lesson/result documents and absence of runtime imports. Browser
tests check discovery, filter intersections, history/share restoration, empty
states, preparation links, legacy consensus fragments, mobile keyboard navigation,
no-JavaScript discovery and absence of external/heavy requests on editorial pages.
The existing workshop suite retains its numerical, interaction, failure and replay
assertions, with navigation expectations updated for the compact selector.

Run `npm test`, `npm run test:e2e` and `npm run build` as described in the
[README](../README.md#run-locally). These checks do not establish cross-browser,
physical-flight, accessibility-conformance or real-device performance claims.
